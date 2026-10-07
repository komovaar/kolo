package host

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/whosgotch/kolo/internal/hub"
)

func savedState(t *testing.T, path string, state State) []byte {
	t.Helper()
	b, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	return b
}

func stopRestored(t *testing.T, a *Agents) {
	t.Helper()
	a.StopAll()
	waitFor(t, func() bool { return len(a.Names()) == 0 })
}

func TestPartialRestoreKeepsEveryDesiredSession(t *testing.T) {
	dir, noLongerLent, forbidden, missing := t.TempDir(), t.TempDir(), t.TempDir(), filepath.Join(t.TempDir(), "missing")
	path := filepath.Join(t.TempDir(), "agents.json")
	record := func(name, dir, command string, age int) Record {
		s := spec(name, dir, command)
		s.Label, s.CreatedAt = "Work "+name, time.Unix(int64(age), 0)
		return Record{Spec: s, Session: "conversation-" + name, State: "idle", Since: time.Unix(1, 0)}
	}
	oldFailure := record("old-failure", t.TempDir(), "true", 6)
	oldFailure.Spec.Status, oldFailure.Spec.Error, oldFailure.Fresh = hub.StatusFailed, "previous failure", true
	original := savedState(t, path, State{Lends: []string{dir, noLongerLent}, Allows: []string{"cat", "true"}, Agents: []Record{
		record("conflict", dir, "cat", 5), // Unsorted legacy file: oldest work must win.
		record("healthy", dir, "cat", 1),
		record("unlent", noLongerLent, "cat", 2),
		record("forbidden", forbidden, "true", 3),
		record("missing", missing, "cat", 4), oldFailure,
	}})
	cfg := Config{Dirs: []string{dir, forbidden, missing}, Allow: []string{"cat"}}
	a := NewAgents(cfg, path)
	t.Cleanup(func() { stopRestored(t, a) })
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		got, err := ReadState(path)
		if err != nil || len(got.Agents) != 6 {
			t.Fatalf("restore lost saved sessions: %+v, %v", got, err)
		}
		for _, rec := range got.Agents {
			if rec.Spec.Label != "Work "+rec.Spec.Name || rec.Spec.CreatedBy.ID != "artem" || rec.Session != "conversation-"+rec.Spec.Name {
				t.Fatalf("restore lost identity or conversation data: %+v", rec)
			}
			if rec.Spec.Name == "healthy" {
				if rec.Spec.Status != hub.StatusRunning {
					t.Fatalf("healthy session was not restored: %+v", rec)
				}
			} else if rec.Spec.Status != hub.StatusFailed || rec.Spec.Error == "" {
				t.Fatalf("unrestorable session has no diagnostic: %+v", rec)
			}
		}
	}
	check()
	for range 3 {
		a.save()
		check()
	}
	if got := a.Specs(); len(got) != 6 || a.Health() != "" {
		t.Fatalf("reconnect greeting is incomplete: %+v, health=%q", got, a.Health())
	}
	if err := a.Retry("conflict"); err == nil || !strings.Contains(err.Error(), "one cat") {
		t.Fatalf("retry bypassed a restored directory conflict: %v", err)
	}
	backup, err := os.ReadFile(path + ".bak")
	if err != nil || !bytes.Equal(backup, original) {
		t.Fatalf("pre-restore state changed: %v", err)
	}
	info, err := os.Stat(path + ".bak")
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("backup permissions: %v, %v", info, err)
	}
	stopRestored(t, a)
	// New permissions do not silently relaunch failures. A member retries the
	// same saved conversation after restoring the intended directory grant.
	cfg.Dirs = append(cfg.Dirs, noLongerLent)
	back := NewAgents(cfg, path)
	t.Cleanup(func() { stopRestored(t, back) })
	if err := back.Restore(); err != nil {
		t.Fatal(err)
	}
	if err := back.Retry("unlent"); err != nil {
		t.Fatal(err)
	}
	for _, got := range back.Specs() {
		if got.Name == "unlent" && got.Status != hub.StatusRunning {
			t.Fatalf("retry after repairing permissions: %+v", got)
		}
	}
	select {
	case <-back.Stop("forbidden"):
	case <-time.After(time.Second):
		t.Fatal("could not remove rejected record")
	}
	got, err := ReadState(path)
	if err != nil || len(got.Agents) != 5 {
		t.Fatalf("removing one rejected session lost others: %+v, %v", got, err)
	}
}

func TestAllRejectedSessionsAreSavedWithoutALiveProcess(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "agents.json")
	savedState(t, path, State{Agents: []Record{{Spec: spec("unlent", dir, "cat")}}})
	a := NewAgents(Config{Dirs: []string{t.TempDir()}, Allow: []string{"cat"}}, path)
	t.Cleanup(func() { stopRestored(t, a) })
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	if got := nextReport(t, a); got.Status != hub.StatusFailed || !strings.Contains(got.Error, "does not lend") {
		t.Fatalf("rejection: %+v", got)
	}
	state, err := ReadState(path)
	if err != nil || len(state.Agents) != 1 || state.Agents[0].Spec.Status != hub.StatusFailed {
		t.Fatalf("all-rejected state was not persisted: %+v, %v", state, err)
	}
	if processOf(t, a, "unlent") != nil {
		t.Fatal("a rejected record has a live process")
	}
}

func TestDamagedStateCannotBeOverwrittenByLaterActions(t *testing.T) {
	for _, damaged := range []string{
		``, `null`, `{}`, `{"agents":`, `{"agents":[],"future_recovery":{"id":"work"}}`,
		`{"agents":[],"agents":null}`, `{"agents":[],"Agents":null}`,
		`{"agents":[{"spec":{"name":"../bad","dir":"/work","command":"cat"}}]}`,
		`{"agents":[{"spec":{"name":"work","dir":"/work","command":"cat"}},{"spec":{"name":"work","dir":"/other","command":"cat"}}]}`,
		`{"agents":[{"spec":{"name":"work","dir":"/work","command":"cat","status":"future"}}]}`,
		`{"agents":[{"spec":{"name":"work","dir":"/work","command":"cat"},"future_session":"id"}]}`,
		`{"agents":[{"spec":{"name":"work","command":"cat"}}]}`,
	} {
		t.Run(damaged, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(t.TempDir(), "agents.json")
			backup := savedState(t, path+".bak", State{Agents: []Record{{Spec: spec("saved", dir, "cat")}}})
			if err := os.WriteFile(path, []byte(damaged), 0o600); err != nil {
				t.Fatal(err)
			}
			a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{"cat"}}, path)
			if err := a.Restore(); err == nil || a.Health() == "" {
				t.Fatalf("damaged file was treated as an empty state: %v, health=%q", err, a.Health())
			}
			if len(a.Names()) != 0 {
				t.Fatal("part of an ambiguous state was launched")
			}
			if err := a.Start(spec("new", dir, "cat")); err == nil || !strings.Contains(err.Error(), "disabled") {
				t.Fatalf("start after failed restore: %v", err)
			}
			a.save()
			a.StopAll()
			got, err := os.ReadFile(path)
			if err != nil || string(got) != damaged {
				t.Fatalf("damaged original was overwritten: %q, %v", got, err)
			}
			got, err = os.ReadFile(path + ".bak")
			if err != nil || !bytes.Equal(got, backup) {
				t.Fatalf("known-good backup was overwritten: %v", err)
			}
		})
	}
}

func TestBackupFailureLeavesOriginalAndBlocksStarts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "agents.json")
	original := savedState(t, path, State{Agents: []Record{{Spec: spec("saved", dir, "cat")}}})
	if err := os.Mkdir(path+".bak", 0o700); err != nil {
		t.Fatal(err)
	}
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{"cat"}}, path)
	t.Cleanup(func() { stopRestored(t, a) })
	if err := a.Restore(); err == nil || !strings.Contains(err.Error(), "could not preserve") {
		t.Fatalf("backup failure was ignored: %v", err)
	}
	if err := a.Start(spec("new", dir, "cat")); err == nil {
		t.Fatal("started after unsafe restore")
	}
	a.save()
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatalf("backup failure changed original: %v", err)
	}
	if err := os.Remove(path + ".bak"); err != nil {
		t.Fatal(err)
	}
	if err := a.Restore(); err != nil || a.Health() != "" {
		t.Fatalf("repair could not restore state: %v, health=%q", err, a.Health())
	}
}

func TestStateDamagedAfterStartupIsNotReplaced(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(t.TempDir(), "agents.json")
	original := savedState(t, path, State{Agents: []Record{{Spec: spec("saved", dir, "cat")}}})
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{"cat"}}, path)
	t.Cleanup(func() { stopRestored(t, a) })
	if err := a.Restore(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	a.save()
	if a.Health() == "" {
		t.Fatal("damage after startup was not reported")
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "broken" {
		t.Fatalf("save erased damaged state: %q, %v", got, err)
	}
	got, err = os.ReadFile(path + ".bak")
	if err != nil || !bytes.Equal(got, original) {
		t.Fatalf("save erased recovery backup: %v", err)
	}
}
