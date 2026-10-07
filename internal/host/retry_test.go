package host

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/whosgotch/kolo/internal/hub"
)

func TestFailedLaunchSurvivesRestartAndCanBeRepaired(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "agents.json")
	script := filepath.Join(dir, "missing-agent")
	cfg := Config{Dirs: []string{dir}, Allow: []string{script}}
	a := NewAgents(cfg, path)
	t.Cleanup(a.StopAll)
	if err := a.Start(spec("repair", dir, script)); err == nil {
		t.Fatal("missing executable launched")
	}
	failed := nextReport(t, a)
	if failed.Status != hub.StatusFailed || failed.Error == "" {
		t.Fatalf("failure report: %+v", failed)
	}
	state, err := ReadState(path)
	if err != nil || len(state.Agents) != 1 || state.Agents[0].Spec.Error != failed.Error || state.Agents[0].Spec.Status != hub.StatusFailed {
		t.Fatalf("persisted failure: %+v, %v", state, err)
	}
	a.StopAll()
	back := NewAgents(cfg, path)
	t.Cleanup(back.StopAll)
	if err := back.Restore(); err != nil {
		t.Fatal(err)
	}
	if got := back.Specs(); len(got) != 1 || got[0].Status != hub.StatusFailed || got[0].Error != failed.Error {
		t.Fatalf("restored failure: %+v", got)
	}
	select {
	case report := <-back.reports:
		t.Fatalf("restored failed session launched automatically: %+v", report)
	default:
	}
	if err := back.Retry("repair"); err == nil {
		t.Fatal("retry before repair succeeded")
	}
	if got := nextReport(t, back); got.Status != hub.StatusFailed {
		t.Fatalf("second failure: %+v", got)
	}
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexec cat\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := back.Retry("repair"); err != nil {
		t.Fatal(err)
	}
	if got := nextReport(t, back); got.Status != hub.StatusRunning || got.Error != "" {
		t.Fatalf("repaired retry: %+v", got)
	}
	if err := back.Retry("repair"); err == nil {
		t.Fatal("retry restarted a running process")
	}
	if got := back.Specs(); len(got) != 1 || got[0].Command != script || got[0].Dir != dir || got[0].Error != "" {
		t.Fatalf("retry changed the spec or retained the error: %+v", got)
	}
	select {
	case <-back.Stop("repair"):
	case <-time.After(time.Second):
		t.Fatal("stop did not complete")
	}
	state, err = ReadState(path)
	if err != nil || len(state.Agents) != 0 {
		t.Fatalf("stopped session persisted: %+v, %v", state, err)
	}
}

func TestRetryChecksCurrentPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "agents.json")
	script := filepath.Join(dir, "missing-agent")
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, path)
	if err := a.Start(spec("repair", dir, script)); err == nil {
		t.Fatal("missing executable launched")
	}
	a.StopAll()
	back := NewAgents(Config{Dirs: []string{dir}, Allow: []string{"cat"}}, path)
	t.Cleanup(back.StopAll)
	if err := back.Restore(); err != nil {
		t.Fatal(err)
	}
	if got := back.Specs(); len(got) != 1 || got[0].Status != hub.StatusFailed {
		t.Fatalf("failed record was lost after permissions changed: %+v", got)
	}
	if err := back.Retry("repair"); err == nil {
		t.Fatal("retry accepted an unlent command")
	}
	if got := back.Specs(); got[0].Status != hub.StatusFailed || got[0].Error == "" {
		t.Fatalf("permission refusal: %+v", got)
	}
}

func TestFailedSessionCanReconnectAndRetryWithoutAViewer(t *testing.T) {
	defer quickRestarts()()
	dir := t.TempDir()
	script := fakeAgentNamed(t, dir, "recoverable", `
[ -f repaired ] || exit 1
printf 'repaired and ready\r\n'
exec cat
`)
	memberToken, memberHash, err := hub.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	hostToken, hostHash, err := hub.NewToken()
	if err != nil {
		t.Fatal(err)
	}
	server, err := hub.Listen(&hub.Org{
		Name:    "acme",
		Members: []hub.Member{{ID: "artem", Name: "Artem", TokenHash: memberHash}},
		Hosts:   []hub.Host{{ID: "devbox", TokenHash: hostHash}},
	}, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	go server.Serve()
	a := NewAgents(Config{Hub: "http://" + server.Addr(), Token: hostToken,
		Dirs: []string{dir}, Allow: []string{script}}, filepath.Join(t.TempDir(), "agents.json"))
	t.Cleanup(a.StopAll)
	startHost := func() context.CancelFunc {
		ctx, cancel := context.WithCancel(context.Background())
		t.Cleanup(cancel)
		go Run(ctx, a, nil)
		return cancel
	}
	list := func() ([]hub.Agent, []hub.HostInfo) {
		resp := memberRequest(t, server, memberToken, "GET", "/v1/agents", "")
		defer resp.Body.Close()
		var data struct {
			Agents []hub.Agent
			Hosts  []hub.HostInfo
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			t.Fatal(err)
		}
		return data.Agents, data.Hosts
	}
	cancel := startHost()
	waitFor(t, func() bool { _, hosts := list(); return len(hosts) == 1 })
	body, _ := json.Marshal(map[string]string{"name": "repair", "host": "devbox", "dir": dir, "command": script})
	resp := memberRequest(t, server, memberToken, "POST", "/v1/agents", string(body))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatal(resp.Status)
	}
	waitFor(t, func() bool { agents, _ := list(); return len(agents) == 1 && agents[0].Status == hub.StatusFailed })
	before, _ := list()
	if before[0].Error != "exit status 1" {
		t.Fatalf("failure diagnostic: %+v", before)
	}
	cancel()
	waitFor(t, func() bool { _, hosts := list(); return len(hosts) == 0 })
	startHost()
	waitFor(t, func() bool { agents, _ := list(); return len(agents) == 1 && agents[0].Status == hub.StatusFailed })
	after, _ := list()
	if after[0].Error != before[0].Error || !after[0].CreatedAt.Equal(before[0].CreatedAt) {
		t.Fatalf("host reconnect changed the failed session: %+v", after)
	}
	if err := os.WriteFile(filepath.Join(dir, "repaired"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	resp = memberRequest(t, server, memberToken, "POST", "/v1/agents/repair/retry", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatal(resp.Status)
	}
	ctx := context.Background()
	viewer := dialViewer(t, ctx, server, memberToken, "repair")
	waitForOutput(t, ctx, viewer, "repaired and ready")
	waitFor(t, func() bool {
		agents, _ := list()
		return len(agents) == 1 && agents[0].Status == hub.StatusRunning && agents[0].Error == ""
	})
	resp = memberRequest(t, server, memberToken, "DELETE", "/v1/agents/repair", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatal(resp.Status)
	}
	if got := a.Names(); len(got) != 0 {
		t.Fatalf("stopped retry retained: %v", got)
	}
}

func TestStoppingDuringRetryAlwaysCompletes(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "missing-agent")
	for range 30 {
		a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, "")
		a.Start(spec("repair", dir, script))
		retried := make(chan struct{})
		go func() { a.Retry("repair"); close(retried) }()
		select {
		case <-a.Stop("repair"):
		case <-time.After(time.Second):
			t.Fatal("stop raced a retry and never completed")
		}
		<-retried
		if len(a.Names()) != 0 {
			t.Fatal("retry resurrected a stopped session")
		}
	}
}

func TestWildcardMissingProgramCanBeInstalledAndRetried(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{hub.AllowAny}}, "")
	t.Cleanup(a.StopAll)
	if err := a.Start(spec("repair", dir, "newly-installed-agent")); err == nil {
		t.Fatal("uninstalled executable launched")
	}
	if got := nextReport(t, a); got.Status != hub.StatusFailed {
		t.Fatalf("failure: %+v", got)
	}
	if err := os.WriteFile(filepath.Join(dir, "newly-installed-agent"), []byte("#!/bin/sh\nexec cat\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := a.Retry("repair"); err != nil {
		t.Fatal(err)
	}
	if got := nextReport(t, a); got.Status != hub.StatusRunning {
		t.Fatalf("installed retry: %+v", got)
	}
	select {
	case <-a.Stop("repair"):
	case <-time.After(time.Second):
		t.Fatal("stop did not complete")
	}
}
