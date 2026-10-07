package host

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/whosgotch/kolo/internal/hub"
)

type contextReport struct {
	Type          string             `json:"type"`
	Name          string             `json:"name"`
	CreatedAt     time.Time          `json:"created_at"`
	ContextResets []hub.ContextReset `json:"context_resets"`
	Request       uint64             `json:"request,omitempty"`
	Error         string             `json:"error,omitempty"`
}

func (a *Agents) contextSnapshot(name string) contextReport {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p := a.running[name]; p != nil {
		return contextReport{Name: name, CreatedAt: p.spec.CreatedAt, ContextResets: p.spec.ContextResets}
	}
	return contextReport{Name: name}
}

// Publish an acknowledgement only after the host has saved it. Copy-on-write
// keeps hello, polling and JSON encoding from observing a changing slice.
func (a *Agents) acknowledgeContext(name, id string) error {
	a.saveMu.Lock()
	defer a.saveMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()
	p := a.running[name]
	if p == nil || p.stopping || a.closing || a.restoring || a.restoreErr != "" {
		return fmt.Errorf("session unavailable")
	}
	i := slices.IndexFunc(p.spec.ContextResets, func(x hub.ContextReset) bool { return x.ID == id })
	if i < 0 {
		return fmt.Errorf("unknown context reset")
	}
	if p.spec.ContextResets[i].Acknowledged {
		return nil
	}
	resets := slices.Clone(p.spec.ContextResets)
	resets[i].Acknowledged = true
	if a.state != "" {
		records := a.recordsLocked()
		for j := range records {
			if records[j].Spec.Name == name {
				records[j].Spec.ContextResets = resets
			}
		}
		b, err := json.MarshalIndent(State{Lends: a.cfg.Dirs, Allows: a.cfg.Allow, Agents: records}, "", "  ")
		if err == nil {
			err = writeState(a.state, b)
		}
		if err != nil {
			a.setHealth(fmt.Sprintf("state is not being saved: %v", err))
			return err
		}
		a.setHealth("")
	}
	p.spec.ContextResets = resets
	return nil
}

// Capture the process before Stop removes it. The completion report carries
// its final history, including a reset racing the stop, before the hub removes
// the session. Reading remains under mu even after the record has been removed.
func (a *Agents) finalContext(name string) func() contextReport {
	a.mu.Lock()
	p := a.running[name]
	a.mu.Unlock()
	return func() contextReport {
		a.mu.Lock()
		defer a.mu.Unlock()
		if p == nil {
			return contextReport{Name: name}
		}
		return contextReport{Name: name, CreatedAt: p.spec.CreatedAt, ContextResets: p.spec.ContextResets}
	}
}
