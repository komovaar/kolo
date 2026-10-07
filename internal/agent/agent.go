// Package agent runs a CLI agent under a pseudo-terminal.
package agent

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// KOLO_TOKEN and KOLO_JOIN are this machine's credential, and an agent is a
// shell somebody else is typing into.
var scrubbed = []string{
	"COLORTERM",
	"CLAUDE_CODE_CHILD_SESSION",
	"KOLO_TOKEN",
	"KOLO_JOIN",
}

type Agent struct {
	cmd *exec.Cmd
	pty *os.File

	mu sync.Mutex
}

// Start launches argv under a PTY; empty dir means the current one.
func Start(argv []string, dir string, cols, rows int) (*Agent, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("agent: no command given")
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = childEnv(os.Environ())

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, fmt.Errorf("agent: start %s: %w", argv[0], err)
	}
	pollable, err := pollablePTY(f)
	if err != nil {
		a := &Agent{cmd: cmd, pty: f}
		a.Close()
		a.Wait()
		return nil, fmt.Errorf("agent: cancellable PTY: %w", err)
	}
	f.Close()
	return &Agent{cmd: cmd, pty: pollable}, nil
}

func pollablePTY(f *os.File) (*os.File, error) {
	// PTY setup uses File.Fd, which switches an os.File to blocking I/O.
	// Rewrap a nonblocking duplicate so deadlines and Close can wake writes.
	syscall.ForkLock.RLock()
	fd, err := syscall.Dup(int(f.Fd()))
	if err == nil {
		syscall.CloseOnExec(fd)
	}
	syscall.ForkLock.RUnlock()
	if err != nil {
		return nil, err
	}
	if err := syscall.SetNonblock(fd, true); err != nil {
		syscall.Close(fd)
		return nil, err
	}
	pollable := os.NewFile(uintptr(fd), f.Name())
	if err := pollable.SetDeadline(time.Time{}); err != nil {
		pollable.Close()
		return nil, err
	}
	return pollable, nil
}

// Read reports io.EOF once the agent exits.
func (a *Agent) Read(p []byte) (int, error) { return a.pty.Read(p) }

func (a *Agent) Write(p []byte) (int, error) {
	return a.WriteContext(context.Background(), p)
}

func (a *Agent) WriteContext(ctx context.Context, p []byte) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	interrupted := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		a.pty.SetWriteDeadline(time.Now())
		close(interrupted)
	})
	n, err := a.pty.Write(p)
	if !stop() {
		<-interrupted
	}
	a.pty.SetWriteDeadline(time.Time{})
	if ctx.Err() != nil {
		return n, ctx.Err()
	}
	return n, err
}

func (a *Agent) Resize(cols, rows int) error {
	return pty.Setsize(a.pty, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (a *Agent) Wait() error { return a.cmd.Wait() }

// Close kills the process group and releases the PTY, ending any in-flight
// Read. The group, because closing the PTY only sends children a SIGHUP they
// are free to ignore.
func (a *Agent) Close() error {
	if p := a.cmd.Process; p != nil {
		if pgid, err := syscall.Getpgid(p.Pid); err == nil {
			syscall.Kill(-pgid, syscall.SIGKILL)
		}
		p.Kill()
	}
	return a.CloseTerminal()
}

// CloseTerminal releases the PTY after output has drained, without signalling
// a process that Wait may already have reaped.
func (a *Agent) CloseTerminal() error { return a.pty.Close() }

func childEnv(env []string) []string {
	drop := make(map[string]bool, len(scrubbed)+1)
	for _, k := range scrubbed {
		drop[k] = true
	}
	drop["TERM"] = true

	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if k, _, ok := strings.Cut(kv, "="); !ok || !drop[k] {
			out = append(out, kv)
		}
	}
	return append(out, "TERM=xterm-256color")
}
