package hub

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

type labelKey struct{ host, name, created string }

func keyForLabel(a Agent) labelKey {
	return labelKey{a.Host, a.Name, a.CreatedAt.UTC().Format(time.RFC3339Nano)}
}

type labelRecord struct {
	Host      string    `json:"host"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	Label     string    `json:"label"`
}

func (r labelRecord) key() labelKey {
	return keyForLabel(Agent{Host: r.Host, Name: r.Name, CreatedAt: r.CreatedAt})
}

type labelFile struct {
	Version int           `json:"version"`
	Labels  []labelRecord `json:"labels"`
}

// Labels belong to the hub. Host greetings may carry an older label; an
// override is scoped to that exact session, never just its reusable name.
type sessionLabels struct {
	mu      sync.Mutex
	path    string
	last    []byte
	records map[labelKey]labelRecord
	closed  bool
}

func openLabels(orgPath string) (*sessionLabels, error) {
	l := &sessionLabels{records: map[labelKey]labelRecord{}}
	if orgPath == "" {
		return l, nil
	}
	l.path = orgPath + ".labels"
	b, err := os.ReadFile(l.path)
	if os.IsNotExist(err) {
		return l, nil
	}
	if err != nil {
		return nil, fmt.Errorf("hub: read labels %s: %w", l.path, err)
	}
	var saved labelFile
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&saved); err != nil {
		return nil, fmt.Errorf("hub: parse labels %s: %w; file left unchanged", l.path, err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("hub: trailing data in labels %s; file left unchanged", l.path)
	}
	if saved.Version != 1 {
		return nil, fmt.Errorf("hub: unsupported labels version %d in %s; file left unchanged", saved.Version, l.path)
	}
	for _, r := range saved.Labels {
		if r.Host == "" || !ValidName(r.Name) || r.Label != label(r.Label, maxLabel) {
			return nil, fmt.Errorf("hub: invalid label record in %s; file left unchanged", l.path)
		}
		if _, found := l.records[r.key()]; found {
			return nil, fmt.Errorf("hub: duplicate label record in %s; file left unchanged", l.path)
		}
		l.records[r.key()] = r
	}
	l.last = b
	return l, nil
}

func (l *sessionLabels) join(r *Registry, id string, dirs, allow, found, byName []string, agents []Agent, send Sender) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return fmt.Errorf("hub: shutting down")
	}
	agents = slices.Clone(agents)
	for i := range agents {
		agents[i].Host = id
		if saved, ok := l.records[keyForLabel(agents[i])]; ok {
			agents[i].Label = saved.Label
		}
	}
	return r.Join(id, dirs, allow, found, byName, agents, send)
}

func (l *sessionLabels) rename(r *Registry, name, value string) (Agent, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return Agent{}, http.StatusServiceUnavailable, fmt.Errorf("hub is shutting down")
	}
	var writeErr error
	changed, err := r.setLabel(name, value, func(a Agent) error {
		next := maps.Clone(l.records)
		next[keyForLabel(a)] = labelRecord{Host: a.Host, Name: a.Name, CreatedAt: a.CreatedAt, Label: value}
		writeErr = l.saveLocked(next)
		if writeErr != nil {
			return fmt.Errorf("rename was not saved: %w", writeErr)
		}
		l.records = next
		return nil
	})
	if err != nil {
		status := http.StatusNotFound
		if writeErr != nil {
			status = http.StatusServiceUnavailable
		}
		return Agent{}, status, err
	}
	return changed, 0, nil
}

func (l *sessionLabels) forget(a Agent) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return nil
	}
	if _, ok := l.records[keyForLabel(a)]; !ok {
		return nil
	}
	next := maps.Clone(l.records)
	delete(next, keyForLabel(a))
	if err := l.saveLocked(next); err != nil {
		return err
	}
	l.records = next
	return nil
}

// Caller holds mu. Failed saves leave both the current label and previous
// bytes intact. A manual edit must be read by restarting the hub, not lost to
// an automatic rewrite using this process's earlier snapshot.
func (l *sessionLabels) saveLocked(records map[labelKey]labelRecord) error {
	if l.path == "" {
		return nil
	}
	previous, err := os.ReadFile(l.path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if !bytes.Equal(previous, l.last) || (err == nil && l.last == nil) || (os.IsNotExist(err) && l.last != nil) {
		return fmt.Errorf("%s changed outside this hub; restart the hub to read it", l.path)
	}
	saved := labelFile{Version: 1, Labels: make([]labelRecord, 0, len(records))}
	for _, r := range records {
		saved.Labels = append(saved.Labels, r)
	}
	slices.SortFunc(saved.Labels, func(a, b labelRecord) int {
		return cmp.Or(cmp.Compare(a.Host, b.Host), cmp.Compare(a.Name, b.Name), a.CreatedAt.Compare(b.CreatedAt))
	})
	b, err := json.MarshalIndent(saved, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	f, err := os.CreateTemp(filepath.Dir(l.path), filepath.Base(l.path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := cmp.Or(f.Sync(), f.Close()); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), l.path); err != nil {
		return err
	}
	l.last = b
	return nil
}

func (l *sessionLabels) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
}
