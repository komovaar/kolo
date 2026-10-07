package host

import (
	"context"
	"errors"
	"sync"

	"github.com/whosgotch/kolo/internal/agent"
)

// Includes the write in progress, so a non-reading process has bounded
// memory use even if members keep sending pastes or single keystrokes.
const (
	maxInputCommands = 64
	maxInputBytes    = 256 << 10
)

var errInputFull = errors.New("this session is not reading input fast enough; that input was not sent. Try again or restart it")

type inputWrite struct {
	bytes int
	apply func() error
}

type inputQueue struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	queue  chan inputWrite
	mu     sync.Mutex
	count  int
	bytes  int
}

func newInputQueue(parent context.Context, refused func(error)) *inputQueue {
	ctx, cancel := context.WithCancel(parent)
	q := &inputQueue{ctx: ctx, cancel: cancel, done: make(chan struct{}), queue: make(chan inputWrite, maxInputCommands)}
	go q.run(refused)
	return q
}

func (q *inputQueue) enqueue(bytes int, apply func() error) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.ctx.Err() != nil {
		return errors.New("this session is no longer accepting input")
	}
	if q.count >= maxInputCommands || bytes > maxInputBytes-q.bytes {
		return errInputFull
	}
	q.count++
	q.bytes += bytes
	q.queue <- inputWrite{bytes: bytes, apply: apply}
	return nil
}

func (q *inputQueue) run(refused func(error)) {
	defer close(q.done)
	defer q.cancel()
	for {
		select {
		case <-q.ctx.Done():
			return
		case write := <-q.queue:
			if q.ctx.Err() != nil {
				return
			}
			err := write.apply()
			q.mu.Lock()
			q.count--
			q.bytes -= write.bytes
			q.mu.Unlock()
			if err != nil && q.ctx.Err() == nil {
				refused(err)
			}
		}
	}
}

// A cancelled write sets a deadline on just the PTY's input side, allowing
// restart/stop to discard pending input without blocking the host loop.
type inputSender struct {
	ctx   context.Context
	agent *agent.Agent
}

func (s inputSender) Write(p []byte) (int, error) { return s.agent.WriteContext(s.ctx, p) }
