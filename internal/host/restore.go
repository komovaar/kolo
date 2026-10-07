package host

import (
	"fmt"
	"path/filepath"
	"slices"

	"github.com/whosgotch/kolo/internal/detect"
	"github.com/whosgotch/kolo/internal/hub"
)

// Restore retains every saved specification before any process can save its
// state. Rejected sessions are failed records, with no live process to start.
func (a *Agents) Restore() error {
	if a.state == "" {
		return nil
	}
	a.saveMu.Lock()
	names, err := a.loadState()
	a.saveMu.Unlock()
	if err != nil {
		return err
	}
	for _, name := range names {
		a.begin(name)
	}
	// Persist rejection reasons even when no saved session could launch.
	a.save()
	return nil
}

// Caller holds saveMu, so no writer can serialize a partially restored set.
func (a *Agents) loadState() ([]string, error) {
	a.mu.Lock()
	if a.restoring || a.closing || len(a.running) != 0 {
		a.mu.Unlock()
		return nil, fmt.Errorf("host: restore requires an empty, active host")
	}
	a.restoring = true
	a.mu.Unlock()
	refuse := func(err error) ([]string, error) {
		reason := fmt.Sprintf("cannot restore saved sessions: %v; session starts are disabled until the state file is repaired and the host restarted", err)
		a.mu.Lock()
		a.restoring, a.restoreErr = false, reason
		a.mu.Unlock()
		a.setHealth(reason)
		return nil, fmt.Errorf("%s", reason)
	}
	state, original, err := readState(a.state)
	if err != nil {
		return refuse(err)
	}
	if original != nil {
		// Keep the exact pre-restore bytes, including original directory/command grants,
		// labels and conversation identifiers. Routine saves never rotate it.
		if err := replaceState(a.state+".bak", original); err != nil {
			return refuse(fmt.Errorf("could not preserve %s.bak: %w", a.state, err))
		}
	}
	// Older state files need not have been sorted. Oldest work wins a
	// conflicting directory; the other records remain visible and removable.
	slices.SortStableFunc(state.Agents, func(x, y Record) int {
		return x.Spec.CreatedAt.Compare(y.Spec.CreatedAt)
	})
	desired := make(map[string]*process, len(state.Agents))
	var accepted []*process
	var rejected []statusReport
	for _, rec := range state.Agents {
		spec := rec.Spec
		spec.Dir = filepath.Clean(spec.Dir)
		p := newProcess(spec, rec.Fresh && spec.Status == hub.StatusFailed, rec.Session)
		p.since = rec.Since
		for _, state := range []detect.State{detect.Idle, detect.Busy, detect.Dialog} {
			if state.String() == rec.State {
				p.state = state
			}
		}
		desired[spec.Name] = p
		if spec.Status == hub.StatusFailed {
			p.status, p.error, p.supervising = hub.StatusFailed, spec.Error, false
			continue
		}
		err := a.permitted(spec)
		if err == nil {
			for _, other := range accepted {
				if err = conflict(spec, other.spec); err != nil {
					break
				}
			}
		}
		if err != nil {
			p.status, p.error, p.supervising = hub.StatusFailed, err.Error(), false
			rejected = append(rejected, statusReport{"status", spec.Name, hub.StatusFailed, err.Error()})
			continue
		}
		accepted = append(accepted, p)
	}
	a.mu.Lock()
	if a.closing {
		a.restoring = false
		a.mu.Unlock()
		return nil, fmt.Errorf("host: shutdown arrived during restore")
	}
	a.running, a.restoring, a.restoreErr = desired, false, ""
	for _, r := range rejected {
		a.report(r.Name, r.Status, r.Error)
	}
	a.mu.Unlock()
	a.setHealth("")
	names := make([]string, 0, len(accepted))
	for _, p := range accepted {
		names = append(names, p.spec.Name)
	}
	return names, nil
}
