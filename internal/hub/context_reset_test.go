package hub

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"
)

func TestContextResetJournalSurvivesReplayAndHubRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.jsonl")
	j, err := openJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	reset := Entry{Agent: "work", At: time.Now().Add(-time.Minute), What: WhatContextReset, ResetID: "event", Text: "Previous conversation: old-conversation"}
	j.contextReset(reset)
	j.contextReset(reset)
	if got := j.tail("work", 10); len(got) != 1 || !got[0].At.Equal(reset.At) {
		t.Fatalf("replay: %+v", got)
	}
	j.Close()
	j, err = openJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	j.contextReset(reset)
	if got := j.tail("work", 10); len(got) != 1 || got[0].ResetID != reset.ResetID {
		t.Fatalf("restart replay: %+v", got)
	}
	reset.At, reset.ResetID = time.Now().Add(-keepFor-time.Hour), "expired"
	j.contextReset(reset)
	if len(j.tail("work", 10)) != 1 {
		t.Fatal("expired event resurrected")
	}
}

func TestContextHistoryRejectsStaleAndForeignReports(t *testing.T) {
	r := NewRegistry()
	created := time.Now()
	r.Join("machine", nil, nil, nil, nil, []Agent{{Name: "work", CreatedAt: created}}, func(any) error { return nil })
	reset := ContextReset{ID: "first", At: time.Now(), PreviousSession: "old"}
	if r.setContextResets("other", "work", created, []ContextReset{reset}) || r.setContextResets("machine", "work", created.Add(-time.Second), []ContextReset{reset}) {
		t.Fatal("accepted report for another owner or session")
	}
	r.setContextResets("machine", "work", created, []ContextReset{reset})
	reset.Acknowledged = true
	r.setContextResets("machine", "work", created, []ContextReset{reset})
	reset.Acknowledged = false
	r.setContextResets("machine", "work", created, []ContextReset{reset, {ID: "second", At: time.Now()}})
	r.setContextResets("machine", "work", created, []ContextReset{reset})
	got, _ := r.Agent("work")
	if len(got.ContextResets) != 2 || !got.ContextResets[0].Acknowledged || got.ContextResets[1].Acknowledged {
		t.Fatalf("stale snapshot changed history: %+v", got.ContextResets)
	}
}

func TestContextAckRequiresControlAndHostConfirmation(t *testing.T) {
	for _, confirmed := range []bool{true, false} {
		t.Run(map[bool]string{true: "saved", false: "save-refused"}[confirmed], func(t *testing.T) {
			s, token, _ := hubFixture(t)
			created := time.Now()
			reset := ContextReset{ID: "event", At: time.Now(), PreviousSession: "old"}
			dispatched := 0
			s.registry.Join("machine", nil, nil, nil, nil, []Agent{{Name: "work", CreatedAt: created, ContextResets: []ContextReset{reset}}}, func(c any) error {
				dispatched++
				b, _ := json.Marshal(c)
				var req struct {
					Request uint64
					Reset   string
				}
				json.Unmarshal(b, &req)
				if req.Reset != reset.ID {
					t.Fatalf("wrong reset in command: %s", b)
				}
				if confirmed {
					reset.Acknowledged = true
					s.registry.setContextResets("machine", "work", created, []ContextReset{reset})
				}
				s.contextAcks.resolve("machine", "work", req.Request, confirmed)
				return nil
			})
			for _, tc := range []struct {
				token    string
				readOnly bool
				status   int
			}{{"", false, 401}, {token, true, 403}} {
				setReadOnly(t, s, token, tc.readOnly)
				resp := call(t, s, "POST", "/v1/agents/work/context/ack", tc.token, `{"id":"event"}`)
				resp.Body.Close()
				if resp.StatusCode != tc.status {
					t.Fatalf("authorization: %s", resp.Status)
				}
			}
			setReadOnly(t, s, token, false)
			resp := call(t, s, "POST", "/v1/agents/work/context/ack", token, `{"id":"missing"}`)
			resp.Body.Close()
			if resp.StatusCode != http.StatusConflict || dispatched != 0 {
				t.Fatal("stale acknowledgement dispatched")
			}
			resp = call(t, s, "POST", "/v1/agents/work/context/ack", token, `{"id":"event"}`)
			resp.Body.Close()
			want := http.StatusServiceUnavailable
			if confirmed {
				want = http.StatusNoContent
			}
			if resp.StatusCode != want || dispatched != 1 {
				t.Fatalf("confirmation: %s, dispatches %d", resp.Status, dispatched)
			}
			got, _ := s.registry.Agent("work")
			if got.ContextResets[0].Acknowledged != confirmed {
				t.Fatal("warning changed without durable confirmation")
			}
			entries := s.journal.tail("work", 10)
			if confirmed && (len(entries) != 1 || entries[0].Who.Name != "Artem" || entries[0].What != WhatContextAcknowledged) {
				t.Fatalf("ack attribution: %+v", entries)
			}
			if !confirmed && len(entries) != 0 {
				t.Fatal("failed acknowledgement logged as successful")
			}
		})
	}
}
