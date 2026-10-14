package hub

import (
	"context"
	"errors"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

const (
	sessionCookie = "kolo_session"
	formLimit     = 4 << 10
)

func (s *Server) authenticate(r *http.Request) (Member, bool) {
	member, _, ok := s.authenticateViewer(r)
	return member, ok
}

func (s *Server) authenticateViewer(r *http.Request) (Member, context.Context, bool) {
	if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		member, valid := s.verifyMember(token)
		return member, s.ctx, valid
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		hash, ctx, valid := s.browsers.lookup(c.Value)
		if valid {
			s.orgMu.RLock()
			member, ok := s.org.memberForHash(hash)
			s.orgMu.RUnlock()
			return member, ctx, ok
		}
	}
	return Member{}, nil, false
}

func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	page, err := fs.ReadFile(pages, "index.html")
	if err != nil {
		http.Error(w, "no page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, formLimit)
	token := strings.TrimSpace(r.FormValue("token"))
	if _, ok := s.verifyMember(token); !ok {
		http.Redirect(w, r, "/?refused=1", http.StatusSeeOther)
		return
	}
	if !s.signIn(w, r, token) {
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) signIn(w http.ResponseWriter, r *http.Request, memberToken string) bool {
	previous := ""
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		previous = cookie.Value
	}
	token, err := s.browsers.create(HashToken(memberToken), previous)
	if err != nil {
		log.Printf("hub: could not save browser session: %v", err)
		http.Error(w, "could not sign in", http.StatusInternalServerError)
		return false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		// Mutating routes are POST or DELETE, and cross-site ones carry no cookie.
		SameSite: http.SameSiteLaxMode,
		Secure:   overTLS(r),
		MaxAge:   int(browserSessionLifetime.Seconds()),
	})
	return true
}

// The invite rides in the URL fragment, which never reaches the server.
func (s *Server) handleJoinPage(w http.ResponseWriter, r *http.Request) {
	page, err := template.ParseFS(pages, "join.html")
	if err != nil {
		http.Error(w, "no page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	page.Execute(w, struct{ Org string }{s.orgName()})
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, formLimit)
	invite := strings.TrimSpace(r.FormValue("invite"))
	name := strings.TrimSpace(r.FormValue("name"))
	if invite == "" || name == "" {
		http.Redirect(w, r, "/join?refused=1", http.StatusSeeOther)
		return
	}

	path := s.orgPath()
	if path == "" {
		http.Error(w, "this hub cannot take new members", http.StatusNotImplemented)
		return
	}

	s.orgFile.Lock()
	defer s.orgFile.Unlock()

	org, member, token, err := Claim(path, invite, name)
	if err != nil {
		if errors.Is(err, ErrNoInvite) || errors.Is(err, ErrInviteSpent) || errors.Is(err, ErrNoMemberName) {
			http.Redirect(w, r, "/join?refused=1", http.StatusSeeOther)
			return
		}
		http.Error(w, "could not join", http.StatusInternalServerError)
		return
	}
	s.orgMu.Lock()
	s.org = org
	s.orgMu.Unlock()
	log.Printf("hub: %s joined %s as %s", member.Name, org.Name, member.ID)

	if !s.signIn(w, r, token) {
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if err := s.browsers.revoke(cookie.Value); err != nil {
			log.Printf("hub: could not save browser sign-out: %v", err)
			http.Error(w, "could not save sign-out; retry before restarting the hub", http.StatusInternalServerError)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Path: "/", HttpOnly: true, MaxAge: -1,
		SameSite: http.SameSiteLaxMode, Secure: overTLS(r),
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func overTLS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

func (s *Server) authenticateHost(r *http.Request) (Host, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return Host{}, false
	}
	return s.verifyHost(token)
}

func (s *Server) authorizeControl(w http.ResponseWriter, r *http.Request) (Member, bool) {
	member, ok := s.authenticate(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return Member{}, false
	}
	if member.ReadOnly {
		http.Error(w, "read-only access: you can watch agents but cannot control them", http.StatusForbidden)
		return Member{}, false
	}
	return member, true
}
