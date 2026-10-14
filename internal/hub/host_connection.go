package hub

import (
	"context"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/whosgotch/kolo/internal/session"
)

func (s *Server) handleHost(w http.ResponseWriter, r *http.Request) {
	h, ok := s.authenticateHost(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(controlLimit)

	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	go func() {
		select {
		case <-r.Context().Done():
			cancel()
		case <-ctx.Done():
		}
	}()

	go func() {
		defer cancel()
		session.Keepalive(ctx, conn, s.ping, s.pingBy)
	}()

	defer s.conns.add(held{id: h.ID, hash: h.TokenHash, isHost: true, cancel: cancel})()

	hello, err := read[hostHello](ctx, conn, helloTimeout)
	if err != nil || hello.Type != "hello" {
		conn.Close(websocket.StatusPolicyViolation, "expected a hello")
		return
	}

	if err := s.labels.join(s.registry, h.ID, hello.Dirs, hello.Allow, hello.Found, hello.ByName, hello.Agents, sender(s.ctx, conn)); err != nil {
		conn.Close(websocket.StatusPolicyViolation, err.Error())
		return
	}
	s.registry.SetHostError(h.ID, hello.Error)
	for _, a := range s.registry.Agents() {
		if a.Host == h.ID {
			s.recordContextResets(a.Name, a.ContextResets)
		}
	}
	log.Printf("hub: %s joined %s, running %s", h.ID, s.orgName(), build(hello.Version))
	defer func() {
		for _, name := range s.registry.Leave(h.ID) {
			s.journal.add(Entry{Agent: name, What: WhatGone, Text: h.ID + " disconnected"})
			s.journal.forget(name)
		}
	}()
	// Fail outstanding stops before the name can be claimed by a reconnect.
	defer s.stops.dropHost(h.ID)
	defer s.contextAcks.dropHost(h.ID)

	if err := write(ctx, conn, hostWelcome{Type: "welcome", Org: s.orgName(), Host: h.ID}); err != nil {
		return
	}

	for {
		report, err := read[agentReport](ctx, conn, 0)
		if err != nil {
			return
		}
		switch report.Type {
		case "title":
			s.registry.setTitle(h.ID, report.Name, report.CreatedAt, report.Title)
		case "status":
			accepted := s.registry.SetStatus(h.ID, report.Name, report.Status, label(report.Error, maxError))
			if accepted && report.Status == StatusFailed {
				s.journal.add(Entry{Agent: report.Name, What: WhatFailed, Text: report.Error})
			}
		case "context":
			if s.registry.setContextResets(h.ID, report.Name, report.CreatedAt, report.ContextResets) {
				s.recordContextResets(report.Name, report.ContextResets)
			}
		case "context-ack":
			if report.Error == "" && s.registry.setContextResets(h.ID, report.Name, report.CreatedAt, report.ContextResets) {
				s.recordContextResets(report.Name, report.ContextResets)
				s.contextAcks.resolve(h.ID, report.Name, report.Request, true)
			} else {
				s.contextAcks.resolve(h.ID, report.Name, report.Request, false)
			}
		case "host":
			s.registry.SetHostError(h.ID, report.Error)
		case "stopped":
			if s.registry.setContextResets(h.ID, report.Name, report.CreatedAt, report.ContextResets) {
				s.recordContextResets(report.Name, report.ContextResets)
			}
			s.stops.ack(h.ID, report.Name, report.Request)
		}
	}
}
