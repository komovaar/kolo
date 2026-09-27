package hub

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func setReadOnly(t *testing.T, s *Server, token string, value bool) {
	t.Helper()
	s.orgMu.Lock()
	defer s.orgMu.Unlock()
	for i := range s.org.Members {
		if s.org.Members[i].TokenHash == HashToken(token) {
			s.org.Members[i].ReadOnly = value
			return
		}
	}
	t.Fatal("member not found")
}

func TestReadOnlyMemberCanReadButCannotMutate(t *testing.T) {
	ctx := testContext(t)
	s, token, _, _ := withAgent(t, ctx)
	setReadOnly(t, s, token, true)
	if got := list(t, s, token); !got.You.ReadOnly || len(got.Agents) != 1 {
		t.Fatalf("read-only list = %+v", got)
	}
	if got := call(t, s, "GET", "/v1/log", token, ""); got.StatusCode != http.StatusOK {
		t.Fatalf("read log: %s", got.Status)
	}
	before := len(s.journal.tail("", 100))
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/v1/agents", `{"name":"new","host":"devbox","dir":"/work/web","command":"claude","read_only":false}`},
		{"PATCH", "/v1/agents/checkups", `{"label":"changed"}`},
		{"DELETE", "/v1/agents/checkups", ""},
	} {
		resp := call(t, s, tc.method, tc.path, token, tc.body)
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s: %s", tc.method, tc.path, resp.Status)
		}
	}
	if a, ok := s.registry.Agent("checkups"); !ok || a.Label != "" {
		t.Fatalf("agent was changed: %+v, exists=%v", a, ok)
	}
	if len(s.registry.Agents()) != 1 || len(s.journal.tail("", 100)) != before {
		t.Fatal("refused mutation changed agents or journal")
	}
}

func TestReadOnlyWebSocketRejectsEveryControlAndKeepsStreaming(t *testing.T) {
	for _, demote := range []bool{false, true} {
		t.Run(map[bool]string{false: "read-only on connection", true: "demoted while connected"}[demote], func(t *testing.T) {
			ctx := testContext(t)
			s, token, _, screen := withAgent(t, ctx)
			if !demote {
				setReadOnly(t, s, token, true)
			}
			viewer := watch(t, ctx, s, token, "checkups")
			readUntilBytes(t, ctx, viewer)
			if demote {
				setReadOnly(t, s, token, true)
			}
			before := len(s.journal.tail("", 100))
			for _, action := range []string{"keys", "interrupt", "restart", "fresh"} {
				if err := write(ctx, viewer, viewerMessage{Type: action, Keys: "not allowed\r"}); err != nil {
					t.Fatal(err)
				}
				for {
					var msg struct{ Type, Text string }
					readFrame(t, ctx, viewer, &msg)
					if msg.Type != "refused" {
						continue
					}
					if !strings.Contains(msg.Text, "read-only") {
						t.Fatalf("wrong refusal: %+v", msg)
					}
					break
				}
			}
			if len(s.journal.tail("", 100)) != before {
				t.Fatal("read-only input reached the action log")
			}
			if _, ok := s.typists.get("checkups"); ok {
				t.Fatal("read-only member acquired the keyboard")
			}
			if err := screen.Write(ctx, websocket.MessageBinary, []byte("still watching")); err != nil {
				t.Fatal(err)
			}
			if got := readUntilBytes(t, ctx, viewer); string(got) != "still watching" {
				t.Fatalf("stream after refused commands: %q", got)
			}
		})
	}
}

func TestReadOnlyInviteClaimsPersistAccess(t *testing.T) {
	path := newOrgFile(t)
	_, invite, err := SetReadOnlyInvite(path, "observers", time.Now().Add(time.Hour), 1)
	if err != nil {
		t.Fatal(err)
	}
	_, member, token, err := Claim(path, invite, "Observer")
	if err != nil {
		t.Fatal(err)
	}
	org, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := org.VerifyMember(token)
	if !ok || !got.ReadOnly || !member.Person().ReadOnly {
		t.Fatalf("read-only access lost: %+v, %+v", member, got)
	}
}

func TestLegacyMemberRetainsControl(t *testing.T) {
	var member Member
	if err := json.Unmarshal([]byte(`{"id":"dana","name":"Dana","token_hash":"ab"}`), &member); err != nil {
		t.Fatal(err)
	}
	if member.ReadOnly || member.Person().ReadOnly {
		t.Fatal("an existing member lost control")
	}
}
