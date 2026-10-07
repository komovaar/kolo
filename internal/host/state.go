package host

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/whosgotch/kolo/internal/adapter"
	"github.com/whosgotch/kolo/internal/hub"
)

// ReadState reads a machine's saved sessions. A missing file is an empty set;
// malformed or unsupported files are errors, never an empty successful read.
func ReadState(path string) (State, error) {
	state, _, err := readState(path)
	return state, err
}

func readState(path string) (State, []byte, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return State{}, nil, nil
	}
	if err != nil {
		return State{}, nil, fmt.Errorf("host: read %s: %w", path, err)
	}
	state, err := decodeState(b)
	if err != nil {
		return State{}, nil, fmt.Errorf("host: parse %s: %w; file left unchanged. Stop the host, repair the file or recover %s.bak, then restart", path, err, path)
	}
	return state, b, nil
}

func decodeState(b []byte) (State, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(b, &fields); err != nil {
		return State{}, err
	}
	// The standard parser first enforces syntax and its nesting limit.
	if err := uniqueStateFields(json.NewDecoder(bytes.NewReader(b))); err != nil {
		return State{}, err
	}
	if _, ok := fields["agents"]; !ok {
		return State{}, fmt.Errorf("expected a state object containing agents")
	}
	var state State
	decoder := json.NewDecoder(bytes.NewReader(b))
	// Unknown fields may carry future recovery data. Do not silently erase
	// them by reading with an older binary and writing only the fields it knows.
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return State{}, err
	}
	names := make(map[string]bool, len(state.Agents))
	for _, rec := range state.Agents {
		spec := rec.Spec
		if !hub.ValidName(spec.Name) || names[spec.Name] {
			return State{}, fmt.Errorf("invalid or duplicate session name %q", spec.Name)
		}
		names[spec.Name] = true
		if spec.Dir == "" || len(adapter.Argv(spec.Command)) == 0 {
			return State{}, fmt.Errorf("session %q needs a directory and command", spec.Name)
		}
		switch rec.State {
		case "", "unknown", "idle", "busy", "dialog":
		default:
			return State{}, fmt.Errorf("unsupported screen state %q for session %q", rec.State, spec.Name)
		}
		switch spec.Status {
		case "", hub.StatusStarting, hub.StatusRunning, hub.StatusFailed:
		default:
			return State{}, fmt.Errorf("unsupported status %q for session %q", spec.Status, spec.Name)
		}
	}
	return state, nil
}

// encoding/json accepts duplicate object fields by keeping the last value.
// For saved recovery data that could turn two agent sets into just one.
func uniqueStateFields(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	switch token {
	case json.Delim('{'):
		seen := map[string]bool{}
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return err
			}
			name := strings.ToLower(key.(string))
			if seen[name] {
				return fmt.Errorf("duplicate state field %q", key)
			}
			seen[name] = true
			if err := uniqueStateFields(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
	case json.Delim('['):
		for decoder.More() {
			if err := uniqueStateFields(decoder); err != nil {
				return err
			}
		}
		_, err = decoder.Token()
	}
	return err
}

// Validate the previous file before replacing it, including when somebody
// edits or damages it after startup. Its backup is changed only by Restore.
func writeState(path string, b []byte) error {
	if _, _, err := readState(path); err != nil {
		return err
	}
	return replaceState(path, b)
}

// replaceState replaces a state file only after its whole replacement reached
// disk. Its unique temporary name keeps two host processes from clobbering
// each other's in-progress write.
func replaceState(path string, b []byte) error {
	dir, base := filepath.Split(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("make directory: %w", err)
	}
	f, err := os.CreateTemp(dir, base+".*")
	if err != nil {
		return fmt.Errorf("make temporary file: %w", err)
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	defer f.Close()

	if _, err := f.Write(b); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replace: %w", err)
	}
	return nil
}
