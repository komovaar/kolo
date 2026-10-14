package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authenticate(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	agents := s.registry.Agents()
	for i := range agents {
		if live, ok := s.screens.get(agents[i].Name); ok {
			agents[i].ScreenState = live.State().String()
		}
	}
	writeJSON(w, http.StatusOK, listResponse{
		Org:    s.orgName(),
		You:    member.Person(),
		Hosts:  s.registry.Hosts(),
		Agents: agents,
	})
}

func (s *Server) handleLog(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.authenticate(r); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	limit := defaultEntries
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil {
		limit = min(max(n, 0), keepEntries)
	}
	writeJSON(w, http.StatusOK, logResponse{
		Entries:    s.journal.tail(r.URL.Query().Get("agent"), limit),
		Persistent: s.journal.persistent(),
	})
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authorizeControl(w, r)
	if !ok {
		return
	}
	var req createRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		http.Error(w, "unreadable request", http.StatusBadRequest)
		return
	}
	if !ValidName(req.Name) {
		http.Error(w, "a name is 1-32 characters of a-z, 0-9 and dashes", http.StatusBadRequest)
		return
	}

	agent := Agent{
		Name:      req.Name,
		Host:      req.Host,
		Dir:       req.Dir,
		Command:   req.Command,
		CreatedBy: member.Person(),
	}
	send, err := s.registry.Add(agent)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	created, ok := s.registry.Agent(agent.Name)
	if !ok {
		// Deleted between the add and this read; spawning it now would ask the
		// host for an agent nothing here is tracking.
		http.Error(w, "the agent was stopped before it started", http.StatusConflict)
		return
	}
	s.journal.add(Entry{
		Agent: created.Name, What: WhatCreated, Who: member.Person(),
		Text: created.Dir + " · " + created.Command,
	})
	if err := send(spawn{Type: "spawn", Agent: created}); err != nil {
		s.registry.Remove(agent.Name)
		s.journal.add(Entry{Agent: agent.Name, What: WhatFailed, Text: "the host went away"})
		http.Error(w, "the host went away", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleRelabel(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authorizeControl(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	var req relabelRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		http.Error(w, "unreadable request", http.StatusBadRequest)
		return
	}
	newLabel := label(req.Label, maxLabel)
	agent, status, err := s.labels.rename(s.registry, name, newLabel)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	s.journal.add(Entry{Agent: name, What: WhatRelabeled, Who: member.Person(), Text: newLabel})
	writeJSON(w, http.StatusOK, agent)
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	member, ok := s.authorizeControl(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	agent, ok := s.registry.Agent(name)
	if !ok {
		http.Error(w, "no agent called "+name, http.StatusNotFound)
		return
	}
	pending, ok := s.stops.begin(agent.Host, name)
	if !ok {
		http.Error(w, "this agent is already stopping", http.StatusConflict)
		return
	}
	defer s.stops.finish(name, pending)
	send, ok := s.registry.SenderFor(agent)
	if !ok {
		http.Error(w, "the host went away before the agent could be stopped", http.StatusServiceUnavailable)
		return
	}
	if err := send(stop{Type: "stop", Name: name, Request: pending.id}); err != nil {
		http.Error(w, "the host went away before the agent could be stopped", http.StatusServiceUnavailable)
		return
	}
	select {
	case stopped := <-pending.result:
		if !stopped {
			http.Error(w, "the host went away before the agent could be stopped", http.StatusServiceUnavailable)
			return
		}
	case <-time.After(stopTimeout):
		http.Error(w, "the host did not confirm the stop", http.StatusGatewayTimeout)
		return
	}
	if !s.registry.RemoveIf(agent) {
		http.Error(w, "the agent was already stopped", http.StatusConflict)
		return
	}
	if err := s.labels.forget(agent); err != nil {
		log.Printf("hub: could not remove label for stopped session %s: %v", name, err)
	}
	s.journal.add(Entry{Agent: name, What: WhatStopped, Who: member.Person()})
	s.journal.forget(name)
	w.WriteHeader(http.StatusNoContent)
}
