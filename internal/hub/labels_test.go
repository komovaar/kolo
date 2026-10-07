package hub

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func labelsFixture(t *testing.T) (*sessionLabels, *Registry, Agent) {
	t.Helper()
	l, err := openLabels(filepath.Join(t.TempDir(), "org.json"))
	if err != nil {
		t.Fatal(err)
	}
	r := NewRegistry()
	a := Agent{Name: "work", Host: "machine", CreatedAt: time.Now(), Label: "Original"}
	if err := l.join(r, "machine", nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	return l, r, a
}

func TestLabelsSurviveReconnectAndReloadAndEmptyOverride(t *testing.T) {
	l, r, a := labelsFixture(t)
	for _, value := range []string{"Auth Refactor", "Latest title", ""} {
		got, status, err := l.rename(r, a.Name, value)
		if err != nil || status != 0 || got.Label != value || got.Name != a.Name {
			t.Fatalf("rename: %+v %d %v", got, status, err)
		}
		disk, err := openLabels(strings.TrimSuffix(l.path, ".labels"))
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(l.path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("label permissions: %v %v", info, err)
		}
		r.Leave(a.Host)
		if err := disk.join(r, a.Host, nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
			t.Fatal(err)
		}
		restored, _ := r.Agent(a.Name)
		if restored.Label != value {
			t.Fatalf("older host label overwrote %q: %+v", value, restored)
		}
	}
}

func TestLabelsAreScopedToSessionIdentity(t *testing.T) {
	l, r, a := labelsFixture(t)
	if _, _, err := l.rename(r, a.Name, "Saved title"); err != nil {
		t.Fatal(err)
	}
	for _, other := range []Agent{
		{Name: a.Name, Host: a.Host, CreatedAt: a.CreatedAt.Add(time.Second)},
		{Name: a.Name, Host: "another", CreatedAt: a.CreatedAt},
		{Name: "another", Host: a.Host, CreatedAt: a.CreatedAt},
	} {
		r = NewRegistry()
		if err := l.join(r, other.Host, nil, nil, nil, nil, []Agent{other}, func(any) error { return nil }); err != nil {
			t.Fatal(err)
		}
		got, _ := r.Agent(other.Name)
		if got.Label != "" {
			t.Fatalf("new session inherited a label: %+v", got)
		}
	}
	// A time serialized in another zone still identifies the same creation.
	a.CreatedAt = a.CreatedAt.In(time.FixedZone("other", 7200))
	r = NewRegistry()
	if err := l.join(r, a.Host, nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	got, _ := r.Agent(a.Name)
	if got.Label != "Saved title" {
		t.Fatalf("timezone changed identity: %+v", got)
	}
}

func TestLabelsRefuseFailedWritesAndExternalChanges(t *testing.T) {
	l, r, a := labelsFixture(t)
	l.path = filepath.Join(t.TempDir(), "missing-directory", "labels.json")
	if _, status, err := l.rename(r, a.Name, "Unsaved"); err == nil || status != 503 {
		t.Fatalf("write failure: %d %v", status, err)
	}
	got, _ := r.Agent(a.Name)
	if got.Label != a.Label || len(l.records) != 0 {
		t.Fatal("failed write changed current label")
	}
	l.path = filepath.Join(t.TempDir(), "labels.json")
	if _, _, err := l.rename(r, a.Name, "Saved title"); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{`{"version":1,"labels":[]}`, `{"version":`} {
		if err := os.WriteFile(l.path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := l.rename(r, a.Name, "Must not overwrite"); err == nil {
			t.Fatal("outside edit overwritten")
		}
		data, _ := os.ReadFile(l.path)
		got, _ = r.Agent(a.Name)
		if string(data) != content || got.Label != "Saved title" {
			t.Fatalf("failed write lost current label or edited bytes: %q %+v", data, got)
		}
	}
}

func TestConcurrentRenamesPreserveAllSessionsAndMatchTheRegistry(t *testing.T) {
	l, r, a := labelsFixture(t)
	agents := make([]Agent, 16)
	for i := range agents {
		agents[i] = Agent{Name: fmt.Sprintf("work-%d", i), Host: "other", CreatedAt: a.CreatedAt}
	}
	if err := l.join(r, "other", nil, nil, nil, nil, agents, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := range agents {
		wg.Go(func() {
			if _, _, err := l.rename(r, agents[i].Name, fmt.Sprintf("Title %d", i)); err != nil {
				t.Error(err)
			}
		})
	}
	for i := range 16 {
		wg.Go(func() {
			if _, _, err := l.rename(r, a.Name, fmt.Sprintf("Concurrent %d", i)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	disk, err := openLabels(strings.TrimSuffix(l.path, ".labels"))
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range r.Agents() {
		saved, ok := disk.records[keyForLabel(current)]
		if !ok || saved.Label != current.Label {
			t.Fatalf("disk and registry diverged: %+v %+v", current, saved)
		}
	}
}

func TestForgetLabelOnlyRemovesItsExactSession(t *testing.T) {
	l, r, a := labelsFixture(t)
	if _, _, err := l.rename(r, a.Name, "Old title"); err != nil {
		t.Fatal(err)
	}
	r.Leave(a.Host)
	newer := a
	newer.CreatedAt = a.CreatedAt.Add(time.Second)
	if err := l.join(r, newer.Host, nil, nil, nil, nil, []Agent{newer}, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := l.rename(r, a.Name, "New title"); err != nil {
		t.Fatal(err)
	}
	if err := l.forget(a); err != nil {
		t.Fatal(err)
	}
	disk, err := openLabels(strings.TrimSuffix(l.path, ".labels"))
	if err != nil {
		t.Fatal(err)
	}
	if len(disk.records) != 1 || disk.records[keyForLabel(newer)].Label != "New title" {
		t.Fatalf("old stop removed a replacement's label: %+v", disk.records)
	}
	l.close()
	if _, _, err := l.rename(r, a.Name, "After shutdown"); err == nil {
		t.Fatal("rename accepted after closing")
	}
}

func TestUnreadableOrUnsupportedLabelsAreNotOverwritten(t *testing.T) {
	for _, content := range []string{
		`{`, `{"version":2,"labels":[]}`, `{"version":1,"labels":[],"future":true}`,
		`{"version":1,"labels":[]} {}`, `{"version":1,"labels":[{"host":"machine","name":"bad/name","label":"x"}]}`,
		`{"version":1,"labels":[{"host":"machine","name":"work","label":"one"},{"host":"machine","name":"work","label":"two"}]}`,
	} {
		t.Run(content, func(t *testing.T) {
			org := filepath.Join(t.TempDir(), "org.json")
			if err := os.WriteFile(org+".labels", []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openLabels(org); err == nil {
				t.Fatal("unreadable labels accepted")
			}
			data, _ := os.ReadFile(org + ".labels")
			if string(data) != content {
				t.Fatal("failed read changed existing file")
			}
		})
	}
}

func TestReconnectRacingRenamesKeepsTheSavedTitle(t *testing.T) {
	l, r, a := labelsFixture(t)
	var wg sync.WaitGroup
	wg.Go(func() {
		for i := range 32 {
			_, status, err := l.rename(r, a.Name, fmt.Sprintf("Title %d", i))
			if err != nil && status != 404 {
				t.Error(err)
			}
		}
	})
	for range 32 {
		r.Leave(a.Host)
		if err := l.join(r, a.Host, nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
	if _, _, err := l.rename(r, a.Name, "Final title"); err != nil {
		t.Fatal(err)
	}
	r.Leave(a.Host)
	if err := l.join(r, a.Host, nil, nil, nil, nil, []Agent{a}, func(any) error { return nil }); err != nil {
		t.Fatal(err)
	}
	got, _ := r.Agent(a.Name)
	disk, err := openLabels(strings.TrimSuffix(l.path, ".labels"))
	if err != nil || got.Label != "Final title" || disk.records[keyForLabel(a)].Label != got.Label {
		t.Fatalf("reconnect restored an older title: %+v %v", got, err)
	}
}
