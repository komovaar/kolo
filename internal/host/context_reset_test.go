package host

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/whosgotch/kolo/internal/detect"
	"github.com/whosgotch/kolo/internal/hub"
	"github.com/whosgotch/kolo/internal/session"
)

func TestRefusedResumeKeepsDurableResetAndReplacement(t *testing.T) {
	defer quickRestarts()()
	dir := t.TempDir()
	script := fakeAgentNamed(t, dir, "claude", `case "$*" in *--resume*) exit 1 ;; esac
printf '? for shortcuts\r\n'
sleep 30
`)
	path := filepath.Join(dir, "agents.json")
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, path)
	t.Cleanup(a.StopAll)
	if err := a.Start(spec("work", dir, script)); err != nil {
		t.Fatal(err)
	}
	previous := sessionOf(t, a, "work")
	if err := a.Restart("work", "Artem"); err != nil {
		t.Fatal(err)
	}
	var saved State
	waitFor(t, func() bool {
		s, err := ReadState(path)
		if err != nil || len(s.Agents) != 1 {
			return false
		}
		saved = s
		r := s.Agents[0]
		return r.Spec.Status == hub.StatusRunning && !r.Fresh && len(r.Spec.ContextResets) == 1 && r.Session != "" && r.Session != previous
	})
	reset := saved.Agents[0].Spec.ContextResets[0]
	if reset.PreviousSession != previous || reset.ID == "" || reset.At.IsZero() || reset.Acknowledged {
		t.Fatalf("reset: %+v", reset)
	}
	replacement := saved.Agents[0].Session
	// A delayed screen watcher cannot restore the refused identifier.
	a.remember("work", session.New(80, 24, detect.Markers{}), previous)
	if got := sessionOf(t, a, "work"); got != replacement {
		t.Fatalf("stale watcher replaced %s with %s", replacement, got)
	}
	before := a.Specs()[0]
	if err := a.acknowledgeContext("work", reset.ID); err != nil {
		t.Fatal(err)
	}
	if before.ContextResets[0].Acknowledged {
		t.Fatal("encoding snapshot was mutated")
	}
	saved, err := ReadState(path)
	if err != nil || !saved.Agents[0].Spec.ContextResets[0].Acknowledged {
		t.Fatalf("ack not saved: %+v, %v", saved, err)
	}
	// A subsequent automatic fallback is a distinct warning. A stale ack only
	// acknowledges its own event, even though the session name has not changed.
	if err := a.Restart("work", "Artem"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(a.Specs()[0].ContextResets) == 2 && a.Specs()[0].Status == hub.StatusRunning })
	if err := a.acknowledgeContext("work", reset.ID); err != nil {
		t.Fatal(err)
	}
	latest := a.Specs()[0].ContextResets[1]
	if latest.ID == reset.ID || latest.PreviousSession != replacement || latest.Acknowledged {
		t.Fatalf("second reset: %+v", latest)
	}
	// Damage after startup must keep the warning active rather than claiming an
	// acknowledgement that will disappear when the host next starts.
	if err := os.WriteFile(path, []byte(`{"agents":`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.acknowledgeContext("work", latest.ID); err == nil {
		t.Fatal("ack accepted without saving")
	}
	if a.Specs()[0].ContextResets[1].Acknowledged || !strings.Contains(a.Health(), "state is not being saved") {
		t.Fatal("failed save hid the warning")
	}
}

func TestRestoreRetainsAcknowledgedAndUnacknowledgedContextResets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agents.json")
	wanted := spec("work", dir, "cat")
	wanted.Status = hub.StatusFailed
	wanted.ContextResets = []hub.ContextReset{
		{ID: "first", At: time.Now(), PreviousSession: "old", Acknowledged: true},
		{ID: "second", At: time.Now(), PreviousSession: "new"},
	}
	savedState(t, path, State{Agents: []Record{{Spec: wanted, Session: "replacement"}}})
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{"cat"}}, path)
	t.Cleanup(a.StopAll)
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	got := a.Specs()[0].ContextResets
	if len(got) != 2 || !got[0].Acknowledged || got[1].Acknowledged || sessionOf(t, a, "work") != "replacement" {
		t.Fatalf("restored resets: %+v", got)
	}
	if err := a.acknowledgeContext("work", "missing"); err == nil {
		t.Fatal("unknown reset acknowledged")
	}
	if err := a.acknowledgeContext("work", "second"); err != nil {
		t.Fatal(err)
	}
	persisted, err := ReadState(path)
	if err != nil || !persisted.Agents[0].Spec.ContextResets[1].Acknowledged {
		t.Fatalf("persisted: %+v, %v", persisted, err)
	}
}

func TestIntentionalFreshDoesNotWarnAboutFailedResume(t *testing.T) {
	defer quickRestarts()()
	dir := t.TempDir()
	script := fakeAgentNamed(t, dir, "claude", "printf '? for shortcuts\\r\\n'\nsleep 30\n")
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, "")
	t.Cleanup(a.StopAll)
	if err := a.Start(spec("work", dir, script)); err != nil {
		t.Fatal(err)
	}
	previous := sessionOf(t, a, "work")
	if err := a.Fresh("work", "Artem"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return a.Specs()[0].Status == hub.StatusRunning && sessionOf(t, a, "work") != previous })
	if len(a.Specs()[0].ContextResets) != 0 {
		t.Fatal("intentional fresh reported as a failed resume")
	}
}

func TestContinueFallbackAlsoRecordsContextReset(t *testing.T) {
	defer quickRestarts()()
	dir := t.TempDir()
	script := fakeAgentNamed(t, dir, "claude", `case "$*" in *--continue*) exit 1 ;; esac
printf '? for shortcuts\r\n'
sleep 30
`)
	path := filepath.Join(dir, "agents.json")
	wanted := spec("work", dir, script)
	wanted.Status = hub.StatusRunning
	savedState(t, path, State{Agents: []Record{{Spec: wanted}}})
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, path)
	t.Cleanup(a.StopAll)
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return len(a.Specs()[0].ContextResets) == 1 && a.Specs()[0].Status == hub.StatusRunning })
	r := a.Specs()[0].ContextResets[0]
	if r.PreviousSession != "" || r.Acknowledged {
		t.Fatalf("continue reset: %+v", r)
	}
	final := a.finalContext("work")
	<-a.Stop("work")
	if got := final(); len(got.ContextResets) != 1 || got.ContextResets[0].ID != r.ID {
		t.Fatalf("stop completion lost reset history: %+v", got)
	}
}
