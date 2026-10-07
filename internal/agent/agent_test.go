package agent

import (
	"context"
	"errors"
	"io"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestChildEnvScrubs(t *testing.T) {
	in := []string{
		"PATH=/usr/bin",
		"TERM=dumb",
		"COLORTERM=truecolor",
		"CLAUDE_CODE_CHILD_SESSION=1",
		"COLORTERM_LIKE=keep-me",
		"MALFORMED",
	}
	got := childEnv(in)

	for _, want := range []string{"PATH=/usr/bin", "COLORTERM_LIKE=keep-me", "MALFORMED", "TERM=xterm-256color"} {
		if !slices.Contains(got, want) {
			t.Errorf("childEnv dropped %q", want)
		}
	}
	for _, unwanted := range []string{"TERM=dumb", "COLORTERM=truecolor", "CLAUDE_CODE_CHILD_SESSION=1"} {
		if slices.Contains(got, unwanted) {
			t.Errorf("childEnv kept %q", unwanted)
		}
	}
}

func TestCancelledWriteLeavesANonReadingAgentAlive(t *testing.T) {
	a, err := Start([]string{"sh", "-c", "stty raw -echo; printf ready; sleep 30"}, "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close(); a.Wait() })
	if err := a.pty.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	ready := make([]byte, len("ready"))
	if _, err := io.ReadFull(a, ready); err != nil || string(ready) != "ready" {
		t.Fatalf("non-reading process not ready: %q, %v", ready, err)
	}
	a.pty.SetReadDeadline(time.Time{})
	// Resize must preserve the master's nonblocking I/O too.
	if err := a.Resize(100, 30); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := a.WriteContext(ctx, []byte(strings.Repeat("x", 256<<10)))
		result <- err
	}()
	select {
	case err := <-result:
		t.Fatalf("large write did not wait for a reader: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled write: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation could not wake a blocked PTY write")
	}
	if err := a.cmd.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("input cancellation killed the process: %v", err)
	}
}

func readAll(t *testing.T, a *Agent) string {
	t.Helper()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := a.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			return b.String()
		}
	}
}

func TestStartAppliesChildEnv(t *testing.T) {
	t.Setenv("COLORTERM", "truecolor")
	t.Setenv("CLAUDE_CODE_CHILD_SESSION", "1")

	a, err := Start([]string{"sh", "-c", `echo "term=$TERM colorterm=[$COLORTERM] child=[$CLAUDE_CODE_CHILD_SESSION]"`}, "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	if got, want := readAll(t, a), "term=xterm-256color colorterm=[] child=[]"; !strings.Contains(got, want) {
		t.Errorf("agent environment = %q, want it to contain %q", got, want)
	}
}

func TestStartSizesTheTerminal(t *testing.T) {
	a, err := Start([]string{"sh", "-c", "stty size"}, "", 120, 40)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	if got := readAll(t, a); !strings.Contains(got, "40 120") {
		t.Errorf("stty size = %q, want rows 40 cols 120", strings.TrimSpace(got))
	}
}

func TestResize(t *testing.T) {
	a, err := Start([]string{"sh", "-c", "sleep 0.5; stty size"}, "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	time.Sleep(100 * time.Millisecond)
	if err := a.Resize(100, 30); err != nil {
		t.Fatal(err)
	}
	if got := readAll(t, a); !strings.Contains(got, "30 100") {
		t.Errorf("stty size after resize = %q, want rows 30 cols 100", strings.TrimSpace(got))
	}
}

func TestWriteReachesTheAgent(t *testing.T) {
	a, err := Start([]string{"sh", "-c", "read line; echo \"got:$line\""}, "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()

	time.Sleep(100 * time.Millisecond)
	if _, err := a.Write([]byte("hello\r")); err != nil {
		t.Fatal(err)
	}
	if got := readAll(t, a); !strings.Contains(got, "got:hello") {
		t.Errorf("agent output = %q, want it to contain %q", got, "got:hello")
	}
}
