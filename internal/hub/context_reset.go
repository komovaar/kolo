package hub

import (
	"encoding/json"
	"net/http"
	"slices"
	"time"
)

// ContextReset survives process restarts and acknowledgement. A short-lived
// resume is only evidence of a failed attempt, not proof the old history is gone.
type ContextReset struct {
	ID              string    `json:"id"`
	At              time.Time `json:"at"`
	PreviousSession string    `json:"previous_session,omitempty"`
	Acknowledged    bool      `json:"acknowledged,omitempty"`
}

func (r *Registry) setContextResets(hostID, name string, created time.Time, resets []ContextReset) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, h := r.find(name)
	if h == nil || h.info.ID != hostID || !a.CreatedAt.Equal(created) {
		return false
	}
	// Reports and command completions can race. History and acknowledgements
	// only move forward; an older snapshot cannot reopen an acknowledged warning.
	merged := slices.Clone(a.ContextResets)
	for _, reset := range resets {
		if reset.ID == "" || len(reset.ID) > maxLabel || reset.At.IsZero() {
			continue
		}
		i := slices.IndexFunc(merged, func(x ContextReset) bool { return x.ID == reset.ID })
		if i >= 0 {
			merged[i].Acknowledged = merged[i].Acknowledged || reset.Acknowledged
			continue
		}
		reset.PreviousSession = label(reset.PreviousSession, maxError)
		merged = append(merged, reset)
	}
	a.ContextResets = merged
	return true
}

func (s *Server) recordContextResets(name string, resets []ContextReset) {
	for _, reset := range resets {
		text := "Resume attempt ended immediately; Kolo fell back to a fresh conversation."
		if reset.PreviousSession != "" {
			text += " Previous conversation: " + reset.PreviousSession
		}
		s.journal.contextReset(Entry{At: reset.At, Agent: name, What: WhatContextReset, Text: text, ResetID: reset.ID})
	}
}

func (s *Server) handleContextAck(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authorizeControl(w, r)
	if !ok {
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil || req.ID == "" {
		http.Error(w, "a reset identifier is required", http.StatusBadRequest)
		return
	}
	a, ok := s.registry.Agent(r.PathValue("name"))
	if !ok {
		http.Error(w, "session unavailable", http.StatusNotFound)
		return
	}
	i := slices.IndexFunc(a.ContextResets, func(x ContextReset) bool { return x.ID == req.ID })
	if i < 0 {
		http.Error(w, "this reset is no longer available; refresh the session", http.StatusConflict)
		return
	}
	if a.ContextResets[i].Acknowledged {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	pending, ok := s.contextAcks.begin(a.Host, a.Name)
	if !ok {
		http.Error(w, "acknowledgement is already pending", http.StatusConflict)
		return
	}
	defer s.contextAcks.finish(a.Name, pending)
	send, ok := s.registry.SenderFor(a)
	if !ok {
		http.Error(w, "the host went away", http.StatusServiceUnavailable)
		return
	}
	if err := send(struct {
		Type    string `json:"type"`
		Name    string `json:"name"`
		Reset   string `json:"reset"`
		Request uint64 `json:"request"`
	}{"context-ack", a.Name, req.ID, pending.id}); err != nil {
		http.Error(w, "the host went away", http.StatusServiceUnavailable)
		return
	}
	select {
	case confirmed := <-pending.result:
		if !confirmed {
			http.Error(w, "the host could not save the acknowledgement; the warning is still active", http.StatusServiceUnavailable)
			return
		}
	case <-time.After(stopTimeout):
		http.Error(w, "the host did not confirm the acknowledgement; refresh and try again", http.StatusGatewayTimeout)
		return
	case <-r.Context().Done():
		return
	}
	s.journal.add(Entry{Agent: a.Name, What: WhatContextAcknowledged, Who: member.Person(), Text: req.ID})
	w.WriteHeader(http.StatusNoContent)
}
