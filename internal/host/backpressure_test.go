package host

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/whosgotch/kolo/internal/hub"
)

func TestBlockedPTYCannotStallHostControls(t *testing.T) {
	defer quickRestarts()()
	for _, action := range []string{"stop", "restart"} {
		t.Run(action, func(t *testing.T) {
			dir := t.TempDir()
			script := fakeAgentNamed(t, dir, "non-reader", fmt.Sprintf(`
if [ ! -f %q ]; then
  touch %q
  stty raw -echo
  printf 'not reading input\r\n'
  sleep 30
else
  printf 'reading after restart\r\n'
  while IFS= read -r line; do printf 'heard [%%s]\r\n' "$line"; done
fi
`, filepath.Join(dir, "launched"), filepath.Join(dir, "launched")))
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
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			t.Cleanup(cancel)
			agents := NewAgents(Config{
				Hub: "http://" + server.Addr(), Token: hostToken, Dirs: []string{dir},
				Allow: []string{script, "cat"}, Version: "test",
			}, "")
			t.Cleanup(agents.StopAll)
			go Run(ctx, agents, nil)
			waitFor(t, func() bool { return len(server.Registry().Hosts()) == 1 })
			for name, command := range map[string]string{"blocked": script, "healthy": "cat"} {
				body, _ := json.Marshal(map[string]string{"name": name, "host": "devbox", "dir": dir, "command": command})
				resp := memberRequest(t, server, memberToken, "POST", "/v1/agents", string(body))
				resp.Body.Close()
				if resp.StatusCode != http.StatusCreated {
					t.Fatalf("create %s: %s", name, resp.Status)
				}
			}
			viewer := dialViewer(t, ctx, server, memberToken, "blocked")
			waitForOutput(t, ctx, viewer, "not reading input")
			agents.mu.Lock()
			old := agents.running["blocked"].writes
			agents.mu.Unlock()
			write := func(keys string) {
				t.Helper()
				body, _ := json.Marshal(map[string]string{"type": "keys", "keys": keys})
				if err := viewer.Write(ctx, websocket.MessageText, body); err != nil {
					t.Fatal(err)
				}
			}
			write(strings.Repeat("x", 64<<10))
			waitFor(t, func() bool {
				old.mu.Lock()
				defer old.mu.Unlock()
				return old.count == 1 && len(old.queue) == 0
			})
			time.Sleep(50 * time.Millisecond)
			old.mu.Lock()
			blocked := old.count == 1
			old.mu.Unlock()
			if !blocked {
				t.Fatal("the process did not exercise PTY backpressure")
			}
			write("old queued input\r")
			for range 4 {
				write(strings.Repeat("x", 64<<10))
			}
			refusalCtx, endRefusal := context.WithTimeout(ctx, 2*time.Second)
			defer endRefusal()
			for {
				kind, data, err := viewer.Read(refusalCtx)
				if err != nil {
					t.Fatalf("queue overflow was not reported to the viewer: %v", err)
				}
				var event struct{ Type, Text string }
				if kind == websocket.MessageText && json.Unmarshal(data, &event) == nil && event.Type == "refused" {
					if !strings.Contains(event.Text, "not reading input fast enough") {
						t.Fatalf("unexpected refusal: %+v", event)
					}
					break
				}
			}
			stop := func(name string) {
				t.Helper()
				requestCtx, stop := context.WithTimeout(ctx, 2*time.Second)
				defer stop()
				req, err := http.NewRequestWithContext(requestCtx, "DELETE", "http://"+server.Addr()+"/v1/agents/"+name, nil)
				if err != nil {
					t.Fatal(err)
				}
				req.Header.Set("Authorization", "Bearer "+memberToken)
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					t.Fatalf("stop %s stalled behind another agent's input: %v", name, err)
				}
				defer resp.Body.Close()
				if resp.StatusCode != http.StatusNoContent {
					body, _ := io.ReadAll(resp.Body)
					t.Fatalf("stop %s: %s: %s", name, resp.Status, body)
				}
			}
			stop("healthy")
			if action == "stop" {
				stop("blocked")
			} else {
				if err := viewer.Write(ctx, websocket.MessageText, []byte(`{"type":"restart"}`)); err != nil {
					t.Fatal(err)
				}
				waitFor(t, func() bool {
					agents.mu.Lock()
					defer agents.mu.Unlock()
					p := agents.running["blocked"]
					return p != nil && p.status == hub.StatusRunning && p.writes != old
				})
				restarted := dialViewer(t, ctx, server, memberToken, "blocked")
				waitForOutput(t, ctx, restarted, "reading after restart")
				if err := agents.Type("blocked", "new input\r"); err != nil {
					t.Fatal(err)
				}
				waitForOutput(t, ctx, restarted, "heard [new input]")
				if strings.Contains(screenOf(t, agents, "blocked").Text(), "old queued input") {
					t.Fatal("queued input from the old process reached the restarted process")
				}
				stop("blocked")
			}
			select {
			case <-old.done:
			case <-time.After(2 * time.Second):
				t.Fatal("blocked input worker leaked after stop/restart")
			}
			if names := agents.Names(); len(names) != 0 {
				t.Fatalf("stopped processes remained registered: %v", names)
			}
		})
	}
}
