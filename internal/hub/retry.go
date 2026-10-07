package hub

import "net/http"

// beginRetry claims a failed session before dispatch, so concurrent viewers
// cannot each restart it. Dispatch must still use the host seen by this call.
func (r *Registry) beginRetry(name string) (Agent, Sender, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, h := r.find(name)
	if h == nil {
		return Agent{}, nil, http.StatusNotFound
	}
	if a.Status != StatusFailed {
		return Agent{}, nil, http.StatusConflict
	}
	previous := *a
	r.nextRetry++
	a.retry = r.nextRetry
	previous.retry = a.retry
	a.Status, a.Error = StatusStarting, ""
	return previous, h.send, 0
}

func (r *Registry) undoRetry(previous Agent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, h := r.find(previous.Name)
	if h != nil && h.info.ID == previous.Host && a.CreatedAt.Equal(previous.CreatedAt) && a.Status == StatusStarting && a.retry == previous.retry {
		a.Status, a.Error, a.retry = previous.Status, previous.Error, 0
	}
}

func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authorizeControl(w, r)
	if !ok {
		return
	}
	previous, send, status := s.registry.beginRetry(r.PathValue("name"))
	if status != 0 {
		message := "only a failed session can be retried"
		if status == http.StatusNotFound {
			message = "session unavailable"
		}
		http.Error(w, message, status)
		return
	}
	if err := send(struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}{"retry", previous.Name}); err != nil {
		s.registry.undoRetry(previous)
		http.Error(w, "the host went away before the session could be retried", http.StatusServiceUnavailable)
		return
	}
	s.journal.add(Entry{Agent: previous.Name, What: WhatRetried, Who: member.Person()})
	w.WriteHeader(http.StatusAccepted)
}
