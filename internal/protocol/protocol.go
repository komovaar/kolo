// Package protocol defines the JSON contract shared by hosts and hubs.
// It contains no server state, process supervision, or credentials.
package protocol

import (
	"time"

	"github.com/whosgotch/kolo/internal/detect"
)

// Process lifecycle is separate from the activity detected on its screen.
const (
	StatusStarting = "starting"
	StatusRunning  = "running"
	StatusFailed   = "failed"
	AllowAny       = "*"
	DirAny         = "*"
)

// Person is public identity; authentication secrets never cross this boundary.
type Person struct {
	ReadOnly bool   `json:"read_only,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name"`
}

// ContextReset is durable recovery history, including acknowledgement.
type ContextReset struct {
	ID              string    `json:"id"`
	At              time.Time `json:"at"`
	PreviousSession string    `json:"previous_session,omitempty"`
	Acknowledged    bool      `json:"acknowledged,omitempty"`
}

// Agent is a session snapshot. Label and ScreenState are populated by the hub.
type Agent struct {
	Name          string         `json:"name"`
	Label         string         `json:"label,omitempty"`
	Title         string         `json:"title,omitempty"`
	Host          string         `json:"host"`
	Dir           string         `json:"dir"`
	Command       string         `json:"command"`
	Status        string         `json:"status"`
	Error         string         `json:"error,omitempty"`
	ContextResets []ContextReset `json:"context_resets,omitempty"`
	// ScreenState is filled by the hub when listing agents. It is not process
	// lifecycle state and is omitted when a host sends or saves an Agent spec.
	ScreenState string    `json:"screen_state,omitempty"`
	CreatedBy   Person    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// ValidName accepts names safe for session URLs and log lines.
func ValidName(s string) bool {
	if len(s) == 0 || len(s) > 32 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' && i > 0 && i < len(s)-1:
		default:
			return false
		}
	}
	return true
}

type HostHello struct {
	Type    string   `json:"type"`
	Dirs    []string `json:"dirs"`
	Allow   []string `json:"allow"`
	Found   []string `json:"found"`
	ByName  []string `json:"by_name"`
	Agents  []Agent  `json:"agents"`
	Version string   `json:"version"`
	Error   string   `json:"error,omitempty"`
}

type HostWelcome struct {
	Type string `json:"type"`
	Org  string `json:"org"`
	Host string `json:"host"`
}

type ScreenHello struct {
	Type    string         `json:"type"`
	Cols    int            `json:"cols"`
	Rows    int            `json:"rows"`
	Markers detect.Markers `json:"markers"`
}

type AgentReport struct {
	Title         string         `json:"title,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	ContextResets []ContextReset `json:"context_resets,omitempty"`
	Type          string         `json:"type"`
	Name          string         `json:"name"`
	Request       uint64         `json:"request,omitempty"`
	Status        string         `json:"status"`
	Error         string         `json:"error"`
}

type AgentInput struct {
	Viewer string `json:"viewer,omitempty"`
	Cols   int    `json:"cols,omitempty"`
	Rows   int    `json:"rows,omitempty"`
	Type   string `json:"type"`
	Name   string `json:"name"`
	From   string `json:"from"`
	Keys   string `json:"keys,omitempty"`
}

type Spawn struct {
	Type  string `json:"type"`
	Agent Agent  `json:"agent"`
}

type Stop struct {
	Type    string `json:"type"`
	Name    string `json:"name"`
	Request uint64 `json:"request"`
}

type HostCommand struct {
	Viewer  string `json:"viewer,omitempty"`
	Cols    int    `json:"cols"`
	Rows    int    `json:"rows"`
	Reset   string `json:"reset,omitempty"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Request uint64 `json:"request"`
	From    string `json:"from"`
	Keys    string `json:"keys"`
	Agent   Agent  `json:"agent"`
}

type StoppedReport struct {
	CreatedAt     time.Time      `json:"created_at"`
	ContextResets []ContextReset `json:"context_resets,omitempty"`
	Type          string         `json:"type"`
	Name          string         `json:"name"`
	Request       uint64         `json:"request"`
}

type ContextReport struct {
	Type          string         `json:"type"`
	Name          string         `json:"name"`
	CreatedAt     time.Time      `json:"created_at"`
	ContextResets []ContextReset `json:"context_resets"`
	Request       uint64         `json:"request,omitempty"`
	Error         string         `json:"error,omitempty"`
}

type TitleReport struct {
	Type      string    `json:"type"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	Title     string    `json:"title"`
}

type StatusReport struct {
	Type   string `json:"type"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type HostReport struct {
	Type  string `json:"type"`
	Error string `json:"error,omitempty"`
}
