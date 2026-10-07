package hub

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func browserLogin(t *testing.T, s *Server, token string, previous *http.Cookie) *http.Cookie {
	t.Helper()
	response := post(t, s, "/login", url.Values{"token": {token}}, previous)
	cookie := sessionOf(response)
	if response.StatusCode != http.StatusSeeOther || cookie == nil || cookie.Value == token {
		t.Fatalf("browser login did not mint a separate credential: %s, %+v", response.Status, cookie)
	}
	return cookie
}

func browserRequest(t *testing.T, s *Server, cookie *http.Cookie) int {
	t.Helper()
	req, err := http.NewRequest("GET", "http://"+s.Addr()+"/v1/agents", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func browserWatch(t *testing.T, ctx context.Context, s *Server, cookie *http.Cookie) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws://"+s.Addr()+"/v1/watch/checkups", &websocket.DialOptions{
		HTTPHeader: http.Header{"Cookie": {cookie.String()}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	conn.SetReadLimit(screenLimit)
	return conn
}

func expectBrowserClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		kind, _, err := conn.Read(ctx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("signed-out browser stream remained open")
			}
			return
		}
		if kind == websocket.MessageBinary {
			t.Fatal("signed-out browser received terminal output")
		}
	}
}

func TestBrowserLogoutRevokesAllItsStreamsAndCookie(t *testing.T) {
	ctx := testContext(t)
	s, token, _, screen := withAgent(t, ctx)
	cookie := browserLogin(t, s, token, nil)
	otherCookie := browserLogin(t, s, token, nil)
	tabs := []*websocket.Conn{browserWatch(t, ctx, s, cookie), browserWatch(t, ctx, s, cookie)}
	other := browserWatch(t, ctx, s, otherCookie)
	program := watch(t, ctx, s, token, "checkups")
	for _, conn := range append(append([]*websocket.Conn{}, tabs...), other, program) {
		readUntilBytes(t, ctx, conn)
	}
	if out := post(t, s, "/logout", nil, cookie); out.StatusCode != http.StatusSeeOther {
		t.Fatalf("logout: %s", out.Status)
	}
	if err := screen.Write(ctx, websocket.MessageBinary, []byte("after sign-out")); err != nil {
		t.Fatal(err)
	}
	for _, tab := range tabs {
		expectBrowserClosed(t, tab)
		_ = write(ctx, tab, viewerMessage{Type: "keys", Keys: "signed-out-input"})
	}
	if got := browserRequest(t, s, cookie); got != http.StatusUnauthorized {
		t.Fatalf("replayed signed-out cookie: %d", got)
	}
	conn, response, err := websocket.Dial(ctx, "ws://"+s.Addr()+"/v1/watch/checkups", &websocket.DialOptions{
		HTTPHeader: http.Header{"Cookie": {cookie.String()}},
	})
	if err == nil {
		conn.CloseNow()
		t.Fatal("signed-out cookie reconnected")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reconnect refusal: %+v, %v", response, err)
	}
	if got := browserRequest(t, s, otherCookie); got != http.StatusOK {
		t.Fatalf("another login was revoked: %d", got)
	}
	for _, conn := range []*websocket.Conn{other, program} {
		if got := readUntilBytes(t, ctx, conn); string(got) != "after sign-out" {
			t.Fatalf("independent stream: %q", got)
		}
	}
	if got := list(t, s, token); got.You.ID != "artem" {
		t.Fatal("member credential was revoked by browser sign-out")
	}
	if _, typed := s.typists.get("checkups"); typed {
		t.Fatal("signed-out input reached the agent")
	}
}

func TestBrowserLoginReplacementAndLegacyCookie(t *testing.T) {
	s, token, _ := hubFixture(t)
	old := browserLogin(t, s, token, nil)
	fresh := browserLogin(t, s, token, old)
	for _, cookie := range []*http.Cookie{old, {Name: sessionCookie, Value: token}} {
		if got := browserRequest(t, s, cookie); got != http.StatusUnauthorized {
			t.Fatalf("superseded or legacy credential accepted: %d", got)
		}
	}
	if got := browserRequest(t, s, fresh); got != http.StatusOK {
		t.Fatalf("replacement login: %d", got)
	}
	s.orgMu.Lock()
	s.org.Members = nil
	s.orgMu.Unlock()
	if got := browserRequest(t, s, fresh); got != http.StatusUnauthorized {
		t.Fatalf("removed member's browser stayed authorized: %d", got)
	}
}

func TestBrowserSessionPersistenceAndDurableRevocation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "org.json")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sessions, err := openBrowserSessions(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sessions.close)
	memberToken, memberHash, _ := NewToken()
	token, err := sessions.create(memberHash, "")
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path + ".sessions")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), token) || strings.Contains(string(data), memberToken) {
		t.Fatal("raw credentials stored on disk")
	}
	info, err := os.Stat(path + ".sessions")
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("session file permissions: %v, %v", info, err)
	}
	cancel()
	sessions.close()
	restartedCtx, stop := context.WithCancel(context.Background())
	defer stop()
	restarted, err := openBrowserSessions(restartedCtx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restarted.close)
	hash, streamCtx, ok := restarted.lookup(token)
	if !ok || hash != memberHash || streamCtx.Err() != nil {
		t.Fatal("browser login did not survive restart")
	}
	if err := restarted.revoke(token); err != nil {
		t.Fatal(err)
	}
	if streamCtx.Err() == nil {
		t.Fatal("revocation did not cancel the stream context")
	}
	restarted.close()
	reloaded, err := openBrowserSessions(restartedCtx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reloaded.close)
	if _, _, ok := reloaded.lookup(token); ok {
		t.Fatal("revoked cookie returned after restart")
	}
}

func TestBrowserSessionExpiresWithoutAnotherRequest(t *testing.T) {
	ctx := testContext(t)
	path := filepath.Join(t.TempDir(), "org.json")
	token, hash, _ := NewToken()
	data, _ := json.Marshal(map[string]browserRecord{hash: {
		MemberHash: HashToken("member"), Expires: time.Now().Add(200 * time.Millisecond),
	}})
	if err := os.WriteFile(path+".sessions", data, 0o600); err != nil {
		t.Fatal(err)
	}
	sessions, err := openBrowserSessions(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sessions.close)
	_, streamCtx, ok := sessions.lookup(token)
	if !ok {
		t.Fatal("fresh session expired early")
	}
	select {
	case <-streamCtx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("expiration did not end the stream context")
	}
	if _, _, ok := sessions.lookup(token); ok {
		t.Fatal("expired session accepted")
	}
	sessions.close()
	reloaded, err := openBrowserSessions(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reloaded.close)
	if _, _, ok := reloaded.lookup(token); ok {
		t.Fatal("expired session restored")
	}
}

func TestBrowserSessionWriteFailureDoesNotMintCookie(t *testing.T) {
	s, token, _ := hubFixture(t)
	s.browsers.path = filepath.Join(t.TempDir(), "missing", "org.json.sessions")
	resp := post(t, s, "/login", url.Values{"token": {token}}, nil)
	if resp.StatusCode != http.StatusInternalServerError || sessionOf(resp) != nil {
		t.Fatalf("failed persistence handed out a cookie: %s, %+v", resp.Status, sessionOf(resp))
	}
}

func TestBrowserLogoutWriteFailureIsReportedAndEndsStreams(t *testing.T) {
	s, token, _ := hubFixture(t)
	savedPath := filepath.Join(t.TempDir(), "org.json.sessions")
	s.browsers.path = savedPath
	cookie := browserLogin(t, s, token, nil)
	_, streamCtx, ok := s.browsers.lookup(cookie.Value)
	if !ok {
		t.Fatal("login was not recorded")
	}
	s.browsers.path = filepath.Join(t.TempDir(), "missing", "org.json.sessions")
	resp := post(t, s, "/logout", nil, cookie)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("failed durable logout was reported as successful: %s", resp.Status)
	}
	if streamCtx.Err() == nil || browserRequest(t, s, cookie) != http.StatusUnauthorized {
		t.Fatal("failed persistence left the running session authorized")
	}
	s.browsers.path = savedPath
	if retry := post(t, s, "/logout", nil, cookie); retry.StatusCode != http.StatusSeeOther {
		t.Fatalf("retrying a failed sign-out: %s", retry.Status)
	}
	data, err := os.ReadFile(savedPath)
	if err != nil || strings.Contains(string(data), HashToken(cookie.Value)) {
		t.Fatalf("retried sign-out did not persist the revocation: %s, %v", data, err)
	}
}

func TestUnknownBrowserLogoutDoesNotRequireSessionFileWrite(t *testing.T) {
	s, _, _ := hubFixture(t)
	s.browsers.path = filepath.Join(t.TempDir(), "missing", "org.json.sessions")
	response := post(t, s, "/logout", nil, &http.Cookie{Name: sessionCookie, Value: "unknown"})
	if response.StatusCode != http.StatusSeeOther || sessionOf(response).MaxAge >= 0 {
		t.Fatalf("unknown login could not sign out without writing sessions: %s", response.Status)
	}
}

func TestBrowserSessionStoreHasOneOwnerAndRefusesCorruption(t *testing.T) {
	ctx := testContext(t)
	path := filepath.Join(t.TempDir(), "org.json")
	first, err := openBrowserSessions(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(first.close)
	if second, err := openBrowserSessions(ctx, path); err == nil {
		second.close()
		t.Fatal("two hubs could overwrite each other's browser sessions")
	}
	first.close()
	if err := os.WriteFile(path+".sessions", []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if sessions, err := openBrowserSessions(ctx, path); err == nil {
		sessions.close()
		t.Fatal("corrupted browser sessions were silently reset")
	}
	if err := os.WriteFile(path+".sessions", []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	repaired, err := openBrowserSessions(ctx, path)
	if err != nil {
		t.Fatalf("failed open leaked the store lock: %v", err)
	}
	repaired.close()
}
