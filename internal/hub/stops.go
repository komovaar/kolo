package hub

import "sync"

// stopRequests pairs a member's delete with the host's completion report.
// A request ID keeps a late report from completing a later attempt.
type stopRequests struct {
	mu      sync.Mutex
	next    uint64
	pending map[string]*pendingStop
}

type pendingStop struct {
	host   string
	id     uint64
	result chan bool
	done   bool
}

func newStopRequests() *stopRequests {
	return &stopRequests{pending: map[string]*pendingStop{}}
}

func (s *stopRequests) begin(host, name string) (*pendingStop, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.pending[name]; exists {
		return nil, false
	}
	s.next++
	p := &pendingStop{host: host, id: s.next, result: make(chan bool, 1)}
	s.pending[name] = p
	return p, true
}

func (s *stopRequests) finish(name string, p *pendingStop) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending[name] == p {
		delete(s.pending, name)
	}
}

func (s *stopRequests) ack(host, name string, id uint64) {
	s.resolve(host, name, id, true)
}

func (s *stopRequests) resolve(host, name string, id uint64, confirmed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p := s.pending[name]; p != nil && p.host == host && p.id == id && !p.done {
		p.done = true
		p.result <- confirmed
	}
}

func (s *stopRequests) dropHost(host string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range s.pending {
		if p.host == host && !p.done {
			p.done = true
			p.result <- false
		}
	}
}
