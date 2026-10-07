package hub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const browserSessionLifetime = 90 * 24 * time.Hour

type browserRecord struct {
	MemberHash string    `json:"member_hash"`
	Expires    time.Time `json:"expires"`
}

type browserSession struct {
	browserRecord
	ctx    context.Context
	cancel context.CancelFunc
}

// Browser credentials are separate from member credentials: revoking one
// browser must not revoke another login or a program using a member token.
type browserSessions struct {
	mu          sync.Mutex
	ctx         context.Context
	path        string
	lockFile    *os.File
	records     map[string]*browserSession
	pendingSave bool
}

func openBrowserSessions(ctx context.Context, orgPath string) (*browserSessions, error) {
	b := &browserSessions{ctx: ctx, records: make(map[string]*browserSession)}
	if orgPath == "" {
		return b, nil
	}
	b.path = orgPath + ".sessions"
	// A second hub must not overwrite this hub's sessions or miss its
	// revocations. CLI org edits use a different lock and remain available.
	f, err := os.OpenFile(b.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("hub: browser sessions: %w", err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("hub: browser sessions already in use: %w", err)
	}
	b.lockFile = f
	data, err := os.ReadFile(b.path)
	if errors.Is(err, os.ErrNotExist) {
		return b, nil
	}
	if err != nil {
		b.close()
		return nil, fmt.Errorf("hub: browser sessions: %w", err)
	}
	var records map[string]browserRecord
	if err := json.Unmarshal(data, &records); err != nil {
		b.close()
		return nil, fmt.Errorf("hub: browser sessions: %w", err)
	}
	for hash, record := range records {
		if len(hash) != 64 || len(record.MemberHash) != 64 || record.Expires.IsZero() {
			b.close()
			return nil, fmt.Errorf("hub: invalid browser session record")
		}
		if time.Now().Before(record.Expires) {
			b.records[hash] = b.session(record)
		}
	}
	return b, nil
}

func (b *browserSessions) session(record browserRecord) *browserSession {
	ctx, cancel := context.WithDeadline(b.ctx, record.Expires)
	return &browserSession{browserRecord: record, ctx: ctx, cancel: cancel}
}

func (b *browserSessions) lookup(token string) (string, context.Context, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	record, ok := b.records[HashToken(token)]
	if !ok || record.ctx.Err() != nil || !time.Now().Before(record.Expires) {
		return "", nil, false
	}
	return record.MemberHash, record.ctx, true
}

func (b *browserSessions) create(memberHash, previous string) (string, error) {
	token, hash, err := NewToken()
	if err != nil {
		return "", err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ctx.Err(); err != nil {
		return "", err
	}
	for hash, record := range b.records {
		if !time.Now().Before(record.Expires) {
			record.cancel()
			delete(b.records, hash)
		}
	}
	oldHash := HashToken(previous)
	old := b.records[oldHash]
	delete(b.records, oldHash)
	fresh := b.session(browserRecord{MemberHash: memberHash, Expires: time.Now().Add(browserSessionLifetime)})
	b.records[hash] = fresh
	if err := b.save(); err != nil {
		fresh.cancel()
		delete(b.records, hash)
		if old != nil {
			b.records[oldHash] = old
		}
		return "", err
	}
	if old != nil {
		old.cancel()
	}
	b.pendingSave = false
	return token, nil
}

func (b *browserSessions) revoke(token string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ctx.Err(); err != nil {
		return err
	}
	hash := HashToken(token)
	if record, ok := b.records[hash]; ok {
		// Close streams and reject requests even if the disk write fails. The
		// caller reports that failure rather than claiming a durable sign-out.
		record.cancel()
		delete(b.records, hash)
		b.pendingSave = true
	} else if !b.pendingSave {
		return nil
	}
	if err := b.save(); err != nil {
		return err
	}
	b.pendingSave = false
	return nil
}

func (b *browserSessions) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, record := range b.records {
		record.cancel()
	}
	if b.lockFile != nil {
		syscall.Flock(int(b.lockFile.Fd()), syscall.LOCK_UN)
		b.lockFile.Close()
		b.lockFile = nil
	}
}

// Called under mu. Only hashes reach disk; atomic replacement prevents a
// partial write from silently discarding every browser's login.
func (b *browserSessions) save() error {
	if b.path == "" {
		return nil
	}
	records := make(map[string]browserRecord, len(b.records))
	for hash, record := range b.records {
		if time.Now().Before(record.Expires) {
			records[hash] = record.browserRecord
		}
	}
	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(b.path), filepath.Base(b.path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.Write(append(data, '\n')); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), b.path)
}
