package host

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/whosgotch/kolo/internal/hub"
)

func TestRestoredContextResetReachesHubAndAcknowledgementReturnsToDisk(t *testing.T) {
	memberToken, memberHash, _ := hub.NewToken()
	hostToken, hostHash, _ := hub.NewToken()
	server, err := hub.Listen(&hub.Org{Name: "acme", Members: []hub.Member{{ID: "artem", Name: "Artem", TokenHash: memberHash}}, Hosts: []hub.Host{{ID: "machine", TokenHash: hostHash}}}, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	go server.Serve()
	dir := t.TempDir()
	path := filepath.Join(dir, "agents.json")
	wanted := spec("work", dir, "cat")
	wanted.Status = hub.StatusFailed
	wanted.ContextResets = []hub.ContextReset{{ID: "event", At: time.Now(), PreviousSession: "saved-id"}}
	savedState(t, path, State{Agents: []Record{{Spec: wanted, Session: "replacement"}}})
	a := NewAgents(Config{Hub: "http://" + server.Addr(), Token: hostToken, Dirs: []string{dir}, Allow: []string{"cat"}}, path)
	t.Cleanup(a.StopAll)
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { Run(ctx, a, nil); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	waitFor(t, func() bool {
		resp := memberRequest(t, server, memberToken, "GET", "/v1/agents", "")
		defer resp.Body.Close()
		var list struct{ Agents []hub.Agent }
		json.NewDecoder(resp.Body).Decode(&list)
		return len(list.Agents) == 1 && len(list.Agents[0].ContextResets) == 1
	})
	// Reconnect with identical host history, then allow periodic reports too.
	cancel()
	<-done
	ctx2, cancel2 := context.WithCancel(context.Background())
	done2 := make(chan struct{})
	t.Cleanup(func() { cancel2(); <-done2 })
	go func() { Run(ctx2, a, nil); close(done2) }()
	waitFor(t, func() bool {
		resp := memberRequest(t, server, memberToken, "GET", "/v1/agents", "")
		defer resp.Body.Close()
		var list struct{ Agents []hub.Agent }
		json.NewDecoder(resp.Body).Decode(&list)
		return len(list.Agents) == 1
	})
	resp := memberRequest(t, server, memberToken, "POST", "/v1/agents/work/context/ack", `{"id":"event"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ack: %s", resp.Status)
	}
	persisted, err := ReadState(path)
	if err != nil || !persisted.Agents[0].Spec.ContextResets[0].Acknowledged {
		t.Fatalf("not durable when HTTP completed: %+v, %v", persisted, err)
	}
	resp = memberRequest(t, server, memberToken, "GET", "/v1/log", "")
	defer resp.Body.Close()
	var log struct{ Entries []hub.Entry }
	json.NewDecoder(resp.Body).Decode(&log)
	resets, acks := 0, 0
	for _, e := range log.Entries {
		if e.What == hub.WhatContextReset {
			resets++
			if e.ResetID != "event" {
				t.Fatal(e)
			}
		}
		if e.What == hub.WhatContextAcknowledged {
			acks++
			if e.Who.Name != "Artem" {
				t.Fatal(e)
			}
		}
	}
	if resets != 1 || acks != 1 {
		t.Fatalf("replayed log: %+v", log.Entries)
	}
}
