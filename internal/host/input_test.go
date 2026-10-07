package host

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func closeInput(t *testing.T, q *inputQueue) {
	t.Helper()
	q.cancel()
	select {
	case <-q.done:
	case <-time.After(2 * time.Second):
		t.Fatal("input worker did not stop")
	}
}

func TestInputQueueBoundsPendingBytesAndCommands(t *testing.T) {
	for _, size := range []int{1, 64 << 10} {
		t.Run(fmt.Sprintf("%d-byte writes", size), func(t *testing.T) {
			q := newInputQueue(context.Background(), func(err error) { t.Errorf("unexpected refusal: %v", err) })
			t.Cleanup(func() { closeInput(t, q) })
			started := make(chan struct{})
			if err := q.enqueue(size, func() error {
				close(started)
				<-q.ctx.Done()
				return q.ctx.Err()
			}); err != nil {
				t.Fatal(err)
			}
			<-started
			limit := min(maxInputCommands, maxInputBytes/size)
			for range limit - 1 {
				if err := q.enqueue(size, func() error {
					t.Error("cancelled queue delivered pending input")
					return nil
				}); err != nil {
					t.Fatalf("queue refused input below its limit: %v", err)
				}
			}
			if err := q.enqueue(size, func() error { return nil }); !errors.Is(err, errInputFull) {
				t.Fatalf("queue overflow: %v", err)
			}
			closeInput(t, q)
			if err := q.enqueue(1, func() error { return nil }); err == nil {
				t.Fatal("stopped worker accepted more input")
			}
		})
	}
}

func TestInputQueuePreservesOrderAndReportsWriteFailure(t *testing.T) {
	failure := errors.New("PTY write failed")
	refusals := make(chan error, 1)
	q := newInputQueue(context.Background(), func(err error) { refusals <- err })
	t.Cleanup(func() { closeInput(t, q) })
	gate := make(chan struct{})
	var order []int
	drained := make(chan struct{})
	for i := range 5 {
		if err := q.enqueue(1, func() error {
			select {
			case <-gate:
			case <-q.ctx.Done():
				return q.ctx.Err()
			}
			order = append(order, i)
			if i == 4 {
				close(drained)
			}
			if i == 2 {
				return failure
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	close(gate)
	select {
	case <-drained:
	case <-time.After(2 * time.Second):
		t.Fatal("input did not drain")
	}
	if !reflect.DeepEqual(order, []int{0, 1, 2, 3, 4}) {
		t.Fatalf("input order: %v", order)
	}
	select {
	case err := <-refusals:
		if !errors.Is(err, failure) {
			t.Fatalf("write failure was lost: %v", err)
		}
	default:
		t.Fatal("write failure was not reported")
	}
}
