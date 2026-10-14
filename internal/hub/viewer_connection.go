package hub

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/coder/websocket"
	"github.com/whosgotch/kolo/internal/session"
)

func (s *Server) handleScreen(w http.ResponseWriter, r *http.Request) {
	h, ok := s.authenticateHost(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	name := r.PathValue("name")
	a, ok := s.registry.Agent(name)
	if !ok || a.Host != h.ID {
		http.Error(w, "no agent called "+name+" here", http.StatusNotFound)
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(screenLimit)

	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	defer s.conns.add(held{id: h.ID, hash: h.TokenHash, isHost: true, cancel: cancel})()
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

	hello, err := read[screenHello](ctx, conn, helloTimeout)
	if err != nil || hello.Type != "screen" || hello.Cols <= 0 || hello.Rows <= 0 ||
		hello.Cols > maxScreenCols || hello.Rows > maxScreenRows {
		conn.Close(websocket.StatusPolicyViolation, "expected a reasonable screen size")
		return
	}

	live := s.screens.open(name, hello.Cols, hello.Rows, hello.Markers)
	defer s.screens.close(name, live)

	for {
		kind, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if kind == websocket.MessageBinary {
			live.Write(data)
		} else {
			var control struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if json.Unmarshal(data, &control) == nil && control.Type == "size" {
				if control.Cols < 1 || control.Rows < 1 || control.Cols > maxScreenCols || control.Rows > maxScreenRows {
					return
				}
				live.Resize(control.Cols, control.Rows)
			} else {
				live.Announce(json.RawMessage(data))
			}
		}
	}
}

func (s *Server) handleWatch(w http.ResponseWriter, r *http.Request) {
	member, authCtx, ok := s.authenticateViewer(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	name := r.PathValue("name")
	live, ok := s.screens.get(name)
	if !ok {
		http.Error(w, "no screen for "+name, http.StatusNotFound)
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(controlLimit)

	ctx, cancel := context.WithCancel(authCtx)
	defer cancel()
	defer s.conns.add(held{id: member.ID, hash: member.TokenHash, cancel: cancel})()
	go func() {
		defer cancel()
		s.takeFrom(ctx, conn, member, name)
	}()
	go func() {
		defer cancel()
		session.Keepalive(ctx, conn, s.ping, s.pingBy)
	}()

	backlog, updates, unsubscribe := live.Subscribe()
	defer unsubscribe()

	for _, m := range backlog {
		if err := session.Send(ctx, conn, m); err != nil {
			return
		}
	}
	if err := session.Send(ctx, conn, catchUp(live)); err != nil {
		return
	}
	// To this joiner alone. Announce would send it to everybody watching, who
	// have known who holds the keyboard since they arrived.
	if who, typed := s.typists.get(name); typed {
		b, err := json.Marshal(struct {
			Type string `json:"type"`
			Who  string `json:"who"`
			ID   string `json:"id"`
		}{"keyboard", who.Name, who.ID})
		if err == nil {
			if err := session.Send(ctx, conn, session.Message{Control: true, Data: b}); err != nil {
				return
			}
		}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-updates:
			if !ok {
				return
			}
			if err := session.Send(ctx, conn, m); err != nil {
				return
			}
		}
	}
}

func catchUp(live *session.Session) session.Message {
	b, _ := json.Marshal(struct {
		Type  string `json:"type"`
		State string `json:"state"`
	}{"state", live.State().String()})
	return session.Message{Control: true, Data: b}
}

// Who a message is from comes from the connection's credentials, never from
// the message.
func (s *Server) takeFrom(ctx context.Context, conn *websocket.Conn, member Member, name string) {
	for {
		msg, err := read[viewerMessage](ctx, conn, 0)
		if err != nil {
			return
		}
		if ctx.Err() != nil {
			return
		}
		if msg.Type == "keys" && msg.Keys == "" {
			continue
		}
		if msg.Type != "keys" && msg.Type != "interrupt" && msg.Type != "restart" && msg.Type != "fresh" && msg.Type != "resize" {
			continue
		}
		if msg.Type == "resize" && (msg.Cols < 2 || msg.Rows < 2 || msg.Cols > maxScreenCols || msg.Rows > maxScreenRows) {
			continue
		}
		// Recheck each command: a connection may outlive a change to its access.
		s.orgMu.RLock()
		current, allowed := s.org.memberForHash(member.TokenHash)
		s.orgMu.RUnlock()
		if !allowed {
			return
		}
		if current.ReadOnly {
			if err := write(ctx, conn, struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}{"refused", "read-only access: you can watch agents but cannot control them"}); err != nil {
				return
			}
			continue
		}
		member = current
		send, ok := s.registry.Sender(name)
		if !ok {
			s.refuseViewer(name, "the agent is no longer available")
			continue
		}
		if err := send(toAgent{Type: msg.Type, Name: name, From: member.Name, Keys: msg.Keys, Cols: msg.Cols, Rows: msg.Rows}); err != nil {
			s.refuseViewer(name, "the host went away before the command could be delivered")
			continue
		}

		switch msg.Type {
		case "resize":
			// Geometry changes are not keyboard or activity-log events.
		case "keys":
			if was, changed := s.typists.set(name, member.Person()); changed {
				s.sayKeyboard(name, member.Person(), was)
			}
			s.journal.typed(name, member.Person(), msg.Keys)
		default:
			s.journal.add(Entry{Agent: name, What: done(msg.Type), Who: member.Person()})
			s.journal.forget(name)
		}
	}
}

func (s *Server) refuseViewer(name, reason string) {
	live, ok := s.screens.get(name)
	if !ok {
		return
	}
	live.Announce(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{"refused", reason})
}

func done(action string) string {
	switch action {
	case "interrupt":
		return WhatInterrupted
	case "restart":
		return WhatRestarted
	default:
		return WhatFresh
	}
}

func (s *Server) sayKeyboard(name string, who, was Person) {
	live, ok := s.screens.get(name)
	if !ok {
		return
	}
	live.Announce(struct {
		Type string `json:"type"`
		Who  string `json:"who,omitempty"`
		ID   string `json:"id,omitempty"`
		Was  string `json:"was,omitempty"`
	}{"keyboard", who.Name, who.ID, was.Name})
}

// Serialises writes to one host: two members dispatching at once must not
// interleave frames on one websocket.
