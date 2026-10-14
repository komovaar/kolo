package hub

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

// ui is generated from web/ and tracked so Go-only builds need no Node.
//
//go:embed ui
var files embed.FS

// Rooted at ui, so every path below is the path a browser asks for.
var pages, _ = fs.Sub(files, "ui")

const (
	helloTimeout = 10 * time.Second
	writeTimeout = 10 * time.Second
	stopTimeout  = 15 * time.Second
)

// coder/websocket reads 32 KiB by default, which a repaint outgrows: a 120x40
// grid in per-cell colour measures over 100 KB.
const (
	screenLimit   = 4 << 20
	controlLimit  = 1 << 20
	maxScreenCols = 500
	maxScreenRows = 200
)

const (
	pingEvery  = 20 * time.Second
	pingWithin = 10 * time.Second
)

// Server is the hub: one org, its hosts, and the agents running on them.
type Server struct {
	// Replaced wholesale on claim or reload; read under the lock.
	orgMu       sync.RWMutex
	org         *Org
	registry    *Registry
	stops       *stopRequests
	contextAcks *stopRequests
	screens     *screens
	typists     *typists
	journal     *journal
	labels      *sessionLabels
	// Held across any read-modify-write of the org file.
	orgFile sync.Mutex
	// Last read error for the org file, so a lasting one is logged once.
	// Under orgFile.
	unreadable string
	// Open connections, so revocation reaches streams, not just next requests.
	conns    *conns
	browsers *browserSessions
	ln       net.Listener
	srv      *http.Server
	// Set by Secure; both nil for plain http.
	acme       *autocert.Manager
	challenges net.Listener
	// Added by AlsoServe; too late once Serve has begun.
	startMu sync.Mutex
	serving bool
	extra   []net.Listener

	ping, pingBy time.Duration

	// Cancelled by Close, the only way to reach hijacked websockets.
	ctx    context.Context
	cancel context.CancelFunc
}

// Listen binds addr, a host:port; use 0.0.0.0 to serve other machines.
func Listen(org *Org, addr string) (*Server, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("hub: listen: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Server{
		org: org, registry: NewRegistry(), stops: newStopRequests(), contextAcks: newStopRequests(), screens: newScreens(),
		typists: newTypists(), conns: newConns(), ln: ln, ctx: ctx, cancel: cancel,
		ping: pingEvery, pingBy: pingWithin,
	}
	s.browsers, err = openBrowserSessions(ctx, org.path)
	if err != nil {
		cancel()
		ln.Close()
		return nil, err
	}

	s.labels, err = openLabels(org.path)
	if err != nil {
		cancel()
		ln.Close()
		s.browsers.close()
		return nil, err
	}

	journalFile := journalPath(org.path)
	if org.path != "" {
		legacy := filepath.Join(filepath.Dir(org.path), "journal.jsonl")
		if _, err := os.Stat(journalFile); errors.Is(err, os.ErrNotExist) {
			if _, err := os.Stat(legacy); err == nil {
				log.Printf("hub: legacy journal %s left untouched; verify which org owns it before moving it to %s with the hub stopped", legacy, journalFile)
			}
		}
	}
	s.journal, err = openJournal(journalFile)
	if err != nil {
		log.Printf("hub: %v. This run is not being written down", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/host", s.handleHost)
	mux.HandleFunc("GET /v1/agents", s.handleList)
	mux.HandleFunc("POST /v1/agents", s.handleCreate)
	mux.HandleFunc("POST /v1/agents/{name}/retry", s.handleRetry)
	mux.HandleFunc("POST /v1/agents/{name}/context/ack", s.handleContextAck)
	mux.HandleFunc("PATCH /v1/agents/{name}", s.handleRelabel)
	mux.HandleFunc("DELETE /v1/agents/{name}", s.handleDelete)
	mux.HandleFunc("GET /v1/log", s.handleLog)
	mux.HandleFunc("GET /v1/agent/{name}", s.handleScreen)
	mux.HandleFunc("GET /v1/watch/{name}", s.handleWatch)
	mux.HandleFunc("GET /join", s.handleJoinPage)
	mux.HandleFunc("POST /join", s.handleJoin)
	mux.HandleFunc("POST /login", s.handleLogin)
	mux.HandleFunc("POST /logout", s.handleLogout)
	mux.Handle("GET /assets/", http.FileServerFS(pages))
	mux.HandleFunc("GET /{$}", s.handlePage)

	// No other site's page may make kolo do something on a member's behalf.
	// /login mints a session rather than requiring one, so without this a page
	// elsewhere could put somebody on a member they did not choose.
	s.srv = &http.Server{Handler: http.NewCrossOriginProtection().Handler(mux)}
	return s, nil
}

// Addr is the listening address, with a requested port of 0 resolved.
func (s *Server) Addr() string { return s.ln.Addr().String() }

func (s *Server) Registry() *Registry { return s.registry }

func (s *Server) verifyMember(token string) (Member, bool) {
	s.orgMu.RLock()
	defer s.orgMu.RUnlock()
	return s.org.VerifyMember(token)
}

func (s *Server) verifyHost(token string) (Host, bool) {
	s.orgMu.RLock()
	defer s.orgMu.RUnlock()
	return s.org.VerifyHost(token)
}

func (s *Server) orgName() string {
	s.orgMu.RLock()
	defer s.orgMu.RUnlock()
	return s.org.Name
}

func (s *Server) orgPath() string {
	s.orgMu.RLock()
	defer s.orgMu.RUnlock()
	return s.org.path
}

func (s *Server) Serve() error {
	go s.watchOrg()
	s.startMu.Lock()
	s.serving = true
	extra := slices.Clone(s.extra)
	s.startMu.Unlock()

	for _, ln := range extra {
		go func() {
			if err := s.srv.Serve(ln); err != nil && !isClosed(err) {
				log.Printf("hub: %v", err)
			}
		}()
	}
	serve := s.srv.Serve
	if s.acme != nil {
		go s.serveChallenges()
		// Empty paths: the certificate comes from the autocert manager, not disk.
		serve = func(ln net.Listener) error { return s.srv.ServeTLS(ln, "", "") }
	}
	if err := serve(s.ln); err != nil && !isClosed(err) {
		return err
	}
	return nil
}

func isClosed(err error) bool {
	return errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed)
}

// Close stops serving and disconnects every host.
func (s *Server) Close() error {
	s.cancel()
	if s.challenges != nil {
		s.challenges.Close()
	}
	for _, ln := range s.extra {
		ln.Close()
	}
	s.journal.Close()
	err := s.srv.Close()
	s.labels.close()
	s.browsers.close()
	return err
}
func build(version string) string {
	if version == "" {
		return "an unknown build"
	}
	return "kolo " + version
}
