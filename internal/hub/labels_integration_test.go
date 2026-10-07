package hub

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func joinLabeledHost(t *testing.T, ctx context.Context, s *Server, token string, a Agent) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws://"+s.Addr()+"/v1/host", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	if err := write(ctx, conn, hostHello{Type: "hello", Agents: []Agent{a}}); err != nil {
		t.Fatal(err)
	}
	var welcome hostWelcome
	readFrame(t, ctx, conn, &welcome)
	if welcome.Type != "welcome" {
		t.Fatal(welcome)
	}
	return conn
}

func TestRenamesPersistAcrossRealHostReconnectAndHubRestart(t *testing.T) {
	ctx := testContext(t)
	memberToken, memberHash, _ := NewToken()
	hostToken, hostHash, _ := NewToken()
	org := &Org{path: filepath.Join(t.TempDir(), "org.json"), Name: "acme", Members: []Member{{ID: "artem", Name: "Artem", TokenHash: memberHash}}, Hosts: []Host{{ID: "devbox", TokenHash: hostHash}}}
	start := func() *Server {
		s, err := Listen(org, "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { s.Close() })
		go s.Serve()
		return s
	}
	s := start()
	a := Agent{Name: "work", Host: "devbox", Label: "Older host title", CreatedAt: time.Now(), Status: StatusRunning, Dir: "/work", Command: "cat"}
	conn := joinLabeledHost(t, ctx, s, hostToken, a)
	resp := call(t, s, "PATCH", "/v1/agents/work", memberToken, `{"label":"Auth Refactor"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: %s", resp.Status)
	}
	disk, err := openLabels(org.path)
	if err != nil || disk.records[keyForLabel(a)].Label != "Auth Refactor" {
		t.Fatalf("successful HTTP rename not durable: %+v %v", disk, err)
	}
	conn.CloseNow()
	waitFor(t, func() bool { return len(s.registry.Hosts()) == 0 })
	conn = joinLabeledHost(t, ctx, s, hostToken, a)
	if got := list(t, s, memberToken).Agents[0]; got.Label != "Auth Refactor" || got.Name != a.Name {
		t.Fatalf("reconnect: %+v", got)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = start()
	conn = joinLabeledHost(t, ctx, s, hostToken, a)
	if got := list(t, s, memberToken).Agents[0]; got.Label != "Auth Refactor" {
		t.Fatalf("hub restart: %+v", got)
	}
	entries := s.journal.tail("work", 10)
	renames := 0
	for _, e := range entries {
		if e.What == WhatRelabeled {
			renames++
			if e.Who.Name != "Artem" || e.Text != "Auth Refactor" {
				t.Fatal(e)
			}
		}
	}
	if renames != 1 {
		t.Fatalf("rename log: %+v", entries)
	}
	// Clearing is a durable override too, even when the host still sends a title.
	resp = call(t, s, "PATCH", "/v1/agents/work", memberToken, `{"label":""}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear: %s", resp.Status)
	}
	conn.CloseNow()
	waitFor(t, func() bool { return len(s.registry.Hosts()) == 0 })
	conn = joinLabeledHost(t, ctx, s, hostToken, a)
	if got := list(t, s, memberToken).Agents[0]; got.Label != "" {
		t.Fatalf("cleared label reappeared: %+v", got)
	}
	stopped := deleteAsync(t, s, memberToken, a.Name)
	var cmd stop
	readFrame(t, ctx, conn, &cmd)
	acknowledgeStop(t, ctx, conn, cmd)
	if resp := awaitDelete(t, stopped); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("stop: %s", resp.Status)
	}
	disk, err = openLabels(org.path)
	if err != nil || len(disk.records) != 0 {
		t.Fatalf("confirmed stop retained label: %+v %v", disk, err)
	}
}

func TestRenameSaveFailureDoesNotChangeLabelOrLog(t *testing.T) {
	s, token, _ := hubFixture(t)
	a := Agent{Name: "work", Host: "devbox", Label: "Original", CreatedAt: time.Now()}
	if err := s.labels.join(s.registry, a.Host, nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	s.labels.path = filepath.Join(t.TempDir(), "missing-directory", "labels.json")
	resp := call(t, s, "PATCH", "/v1/agents/work", token, `{"label":"Unsaved"}`)
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("unsaved rename: %s", resp.Status)
	}
	got := list(t, s, token).Agents[0]
	if got.Label != "Original" || len(s.journal.tail("work", 10)) != 0 {
		t.Fatal("failed rename changed label or success log")
	}
	if _, err := os.Stat(s.labels.path); !os.IsNotExist(err) {
		t.Fatalf("failed rename created file: %v", err)
	}
	setReadOnly(t, s, token, true)
	resp = call(t, s, "PATCH", "/v1/agents/work", token, `{"label":"Read-only"}`)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only rename: %s", resp.Status)
	}
}

func TestInvalidLabelsPreventStartupAndReleaseBrowserSessionLock(t *testing.T) {
	dir := t.TempDir()
	org := &Org{path: filepath.Join(dir, "org.json"), Name: "acme"}
	if err := os.WriteFile(org.path+".labels", []byte(`{"version":`), 0600); err != nil {
		t.Fatal(err)
	}
	if server, err := Listen(org, "127.0.0.1:0"); err == nil {
		server.Close()
		t.Fatal("hub ignored corrupt labels")
	}
	if err := os.WriteFile(org.path+".labels", []byte(`{"version":1,"labels":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := Listen(org, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("browser-session lock leaked after startup error: %v", err)
	}
	s.Close()
}
