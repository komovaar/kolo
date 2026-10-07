package host

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/whosgotch/kolo/internal/hub"
)

func TestRestoreFailuresAreVisibleToMembers(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "partial", true: "corrupt"}[corrupt], func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(t.TempDir(), "agents.json")
			original := savedState(t, path, State{Agents: []Record{
				{Spec: spec("healthy", dir, "cat")},
				{Spec: spec("unlent", t.TempDir(), "cat"), Session: "saved-conversation"},
			}})
			if corrupt {
				original = []byte(`{"agents":`)
				if err := os.WriteFile(path, original, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			memberToken, memberHash, err := hub.NewToken()
			if err != nil {
				t.Fatal(err)
			}
			hostToken, hostHash, err := hub.NewToken()
			if err != nil {
				t.Fatal(err)
			}
			server, err := hub.Listen(&hub.Org{
				Name: "acme", Members: []hub.Member{{ID: "artem", Name: "Artem", TokenHash: memberHash}},
				Hosts: []hub.Host{{ID: "devbox", TokenHash: hostHash}},
			}, "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { server.Close() })
			go server.Serve()
			a := NewAgents(Config{Hub: "http://" + server.Addr(), Token: hostToken,
				Dirs: []string{dir}, Allow: []string{"cat"}}, path)
			t.Cleanup(func() { stopRestored(t, a) })
			if err := a.Restore(); (err != nil) != corrupt {
				t.Fatalf("restore: %v", err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			go Run(ctx, a, nil)
			var data struct {
				Agents []hub.Agent
				Hosts  []hub.HostInfo
			}
			refresh := func() {
				resp := memberRequest(t, server, memberToken, "GET", "/v1/agents", "")
				defer resp.Body.Close()
				if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
					t.Fatal(err)
				}
			}
			waitFor(t, func() bool { refresh(); return len(data.Hosts) == 1 })
			if !corrupt {
				if len(data.Agents) != 2 {
					t.Fatalf("member cannot see rejected session: %+v", data)
				}
				for _, got := range data.Agents {
					if got.Name == "unlent" && (got.Status != hub.StatusFailed || !strings.Contains(got.Error, "does not lend")) {
						t.Fatalf("restore diagnostic missing: %+v", got)
					}
				}
			} else {
				if len(data.Agents) != 0 || !strings.Contains(data.Hosts[0].Error, ".bak") || !strings.Contains(data.Hosts[0].Error, "disabled") {
					t.Fatalf("blocked recovery is not visible: %+v", data)
				}
				body, _ := json.Marshal(map[string]string{"name": "new", "host": "devbox", "dir": dir, "command": "cat"})
				resp := memberRequest(t, server, memberToken, "POST", "/v1/agents", string(body))
				resp.Body.Close()
				if resp.StatusCode != http.StatusCreated {
					t.Fatal(resp.Status)
				}
				waitFor(t, func() bool { refresh(); return len(data.Agents) == 1 && data.Agents[0].Status == hub.StatusFailed })
				if !strings.Contains(data.Agents[0].Error, "disabled") || len(a.Names()) != 0 {
					t.Fatalf("host started a session after unsafe restore: %+v", data)
				}
				got, err := os.ReadFile(path)
				if err != nil || string(got) != string(original) {
					t.Fatalf("member request erased corrupt state: %q, %v", got, err)
				}
			}
		})
	}
}
