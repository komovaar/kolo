package hub

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestRetryWithoutAScreenIsAuthorizedAndRecorded(t *testing.T) {
	s, token, _ := hubFixture(t)
	commands := make(chan any, 2)
	if err := s.registry.Join("devbox", []string{"/work"}, []string{"cat"}, nil, nil,
		[]Agent{{Name: "failed", Status: StatusFailed, Error: "exit status 1"}},
		func(c any) error { commands <- c; return nil }); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		token    string
		readOnly bool
		want     int
	}{{"", false, http.StatusUnauthorized}, {token, true, http.StatusForbidden}, {token, false, http.StatusAccepted}} {
		setReadOnly(t, s, token, tc.readOnly)
		resp := call(t, s, "POST", "/v1/agents/failed/retry", tc.token, "")
		if resp.StatusCode != tc.want {
			t.Fatalf("retry: got %s, want %d", resp.Status, tc.want)
		}
	}
	if len(commands) != 1 {
		t.Fatalf("dispatched %d retry commands", len(commands))
	}
	got, _ := s.registry.Agent("failed")
	if got.Status != StatusStarting || got.Error != "" {
		t.Fatalf("retry lifecycle: %+v", got)
	}
	if resp := call(t, s, "POST", "/v1/agents/failed/retry", token, ""); resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate retry: %s", resp.Status)
	}
	if resp := call(t, s, "POST", "/v1/agents/missing/retry", token, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing retry: %s", resp.Status)
	}
	entries := s.journal.tail("failed", 10)
	if len(entries) != 1 || entries[0].What != WhatRetried || entries[0].Who.Name != "Artem" {
		t.Fatalf("retry attribution: %+v", entries)
	}
}

func TestRetryDispatchFailurePreservesDiagnostic(t *testing.T) {
	s, token, _ := hubFixture(t)
	reason := "could not start " + strings.Repeat("long-checkout-path/", 10)
	if err := s.registry.Join("devbox", nil, nil, nil, nil,
		[]Agent{{Name: "failed", Status: StatusFailed, Error: reason}},
		func(any) error { return errors.New("connection closed") }); err != nil {
		t.Fatal(err)
	}
	if resp := call(t, s, "POST", "/v1/agents/failed/retry", token, ""); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("disconnected retry: %s", resp.Status)
	}
	got, _ := s.registry.Agent("failed")
	if got.Status != StatusFailed || got.Error != reason {
		t.Fatalf("retry lost the diagnostic: %+v", got)
	}
	if len(s.journal.tail("failed", 10)) != 0 {
		t.Fatal("undispatched retry was recorded")
	}
}

func TestRetryRollbackDoesNotChangeReplacementOrHostReport(t *testing.T) {
	for _, replacement := range []bool{false, true} {
		r := NewRegistry()
		r.Join("old", nil, nil, nil, nil, []Agent{{Name: "failed", Status: StatusFailed, Error: "old error"}}, func(any) error { return nil })
		previous, _, status := r.beginRetry("failed")
		if status != 0 {
			t.Fatal(status)
		}
		if replacement {
			r.Leave("old")
			r.Join("new", nil, nil, nil, nil, []Agent{{Name: "failed", Status: StatusStarting}}, func(any) error { return nil })
		} else {
			r.SetStatus("old", "failed", StatusRunning, "")
		}
		r.undoRetry(previous)
		got, _ := r.Agent("failed")
		if got.Error != "" || (!replacement && got.Status != StatusRunning) || (replacement && got.Host != "new") {
			t.Fatalf("rollback changed a newer session state: %+v", got)
		}
	}
}

func TestConcurrentRetryClaimsOnlyOnce(t *testing.T) {
	r := NewRegistry()
	r.Join("machine", nil, nil, nil, nil, []Agent{{Name: "failed", Status: StatusFailed}}, func(any) error { return nil })
	var wg sync.WaitGroup
	var accepted atomic.Int32
	for range 32 {
		wg.Go(func() {
			_, _, status := r.beginRetry("failed")
			if status == 0 {
				accepted.Add(1)
			}
		})
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d concurrent retries", accepted.Load())
	}
}

func TestOldRetryFailureCannotRollBackANewerRetry(t *testing.T) {
	r := NewRegistry()
	original := Agent{Name: "failed", Status: StatusFailed}
	r.Join("machine", nil, nil, nil, nil, []Agent{original}, func(any) error { return nil })
	old, _, _ := r.beginRetry("failed")
	r.Leave("machine")
	r.Join("machine", nil, nil, nil, nil, []Agent{original}, func(any) error { return nil })
	_, _, status := r.beginRetry("failed")
	if status != 0 {
		t.Fatal(status)
	}
	r.undoRetry(old)
	if got, _ := r.Agent("failed"); got.Status != StatusStarting {
		t.Fatalf("old dispatch error rolled back a new connection's retry: %+v", got)
	}
}
