package term

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"

	"github.com/hinshun/vt10x"
)

// vt10x exposes input modes and cursor attributes, but not bracketed paste,
// scroll margins, tab stops, or the saved cursor. Track only that missing
// state alongside its parser, including escapes split across PTY reads.
type replayState struct {
	paste         bool
	keypad        bool
	mouse         int
	top, bottom   int
	tabs          []bool
	saved         vt10x.Cursor
	hasSaved      bool
	state         byte
	sequence      []byte
	stringKind    byte
	stringEsc     bool
	stringTooLong bool
	colors        map[int]string
}

func (m *replayState) reset(cols, rows int) {
	*m = replayState{bottom: rows - 1, tabs: make([]bool, cols)}
	for x := 8; x < cols; x += 8 {
		m.tabs[x] = true
	}
}

func (m *replayState) resize(cols, rows int) {
	m.top, m.bottom = 0, rows-1
	tabs := make([]bool, cols)
	copy(tabs, m.tabs)
	for x := len(m.tabs); x < cols; x++ {
		tabs[x] = x%8 == 0
	}
	m.tabs = tabs
}

// Flush the emulator at complete escapes before consulting its cursor/modes.
// Ordinary text stays batched; strings are bounded and never interpreted as
// CSI, even if they contain bytes resembling a mode change.
func (s *Screen) write(p []byte) []byte {
	m := &s.modes
	start := 0
	var replies bytes.Buffer
	flush := func(end int) {
		s.term.Write(p[start:end])
		start = end
	}
	for i, c := range p {
		if m.state == 'S' {
			if c == 0x18 || c == 0x1a || c == 7 || m.stringEsc && c == '\\' {
				flush(i + 1)
				if !m.stringTooLong && c != 0x18 && c != 0x1a {
					s.stringReply(&replies)
				}
				m.state, m.sequence, m.stringEsc = 0, nil, false
			} else if c == 0x1b {
				m.stringEsc = true
			} else {
				if m.stringEsc && len(m.sequence) < 4096 {
					m.sequence = append(m.sequence, 0x1b)
				}
				if len(m.sequence) < 4096 {
					m.sequence = append(m.sequence, c)
				} else {
					m.stringTooLong = true
				}
				m.stringEsc = false
			}
			continue
		}
		if c == 0x1b {
			m.state, m.sequence = 'E', nil
			continue
		}
		if c == 0x18 || c == 0x1a {
			m.state, m.sequence = 0, nil
			continue
		}
		if c < 0x20 || c == 0x7f {
			continue
		}
		switch m.state {
		case 'E':
			switch c {
			case '[':
				m.state = 'C'
			case ']', 'P', '_', '^', 'k':
				m.state, m.stringKind, m.stringEsc, m.stringTooLong = 'S', c, false, false
			case '(', ')', '*', '+', '#':
				m.state, m.sequence = 'I', []byte{c}
			default:
				flush(i + 1)
				s.escape(c, &replies)
				m.state = 0
			}
		case 'I':
			m.state, m.sequence = 0, nil
		case 'C':
			if len(m.sequence) < 256 {
				m.sequence = append(m.sequence, c)
			}
			if c >= 0x40 && c <= 0x7e {
				flush(i + 1)
				s.control(string(m.sequence), &replies)
				m.state, m.sequence = 0, nil
			}
		}
	}
	flush(len(p))
	return replies.Bytes()
}

func (s *Screen) escape(c byte, replies *bytes.Buffer) {
	m := &s.modes
	switch c {
	case 'c':
		cols, rows := s.term.Size()
		m.reset(cols, rows)
	case '7':
		m.saved, m.hasSaved = s.term.Cursor(), true
	case 'H':
		m.tabs[s.term.Cursor().X] = true
	case 'Z':
		replies.WriteString("\x1b[?1;2c")
	case '=', '>':
		m.keypad = c == '='
	}
}

func (s *Screen) control(seq string, replies *bytes.Buffer) {
	if len(seq) == 0 {
		return
	}
	m := &s.modes
	final := seq[len(seq)-1]
	params := seq[:len(seq)-1]
	priv := strings.HasPrefix(params, "?")
	if priv {
		params = params[1:]
	}
	if final == 'p' && strings.HasSuffix(params, "$") {
		mode, err := strconv.Atoi(strings.TrimSuffix(params, "$"))
		if err == nil {
			prefix := ""
			if priv {
				prefix = "?"
			}
			fmt.Fprintf(replies, "\x1b[%s%d;%d$y", prefix, mode, s.modeStatus(priv, mode))
		}
		return
	}
	if final == 'c' {
		switch params {
		case "", "0":
			replies.WriteString("\x1b[?1;2c")
		case ">", ">0":
			replies.WriteString("\x1b[>0;0;0c")
		}
		return
	}
	args, ok := numericParams(params)
	if !ok {
		return
	}
	arg := func(i, def int) int {
		if i >= len(args) || args[i] == 0 {
			return def
		}
		return args[i]
	}
	switch final {
	case 'h', 'l':
		if priv {
			for _, mode := range args {
				switch mode {
				case 9, 1000, 1002, 1003:
					if final == 'h' {
						m.mouse = mode
					} else {
						m.mouse = 0
					}
				case 66:
					m.keypad = final == 'h'
				case 2004:
					m.paste = final == 'h'
				case 1048, 1049:
					if final == 'h' {
						m.saved, m.hasSaved = s.term.Cursor(), true
					}
				}
			}
		}
	case 'r':
		if !priv {
			_, rows := s.term.Size()
			m.top = min(max(arg(0, 1)-1, 0), rows-1)
			m.bottom = min(max(arg(1, rows)-1, 0), rows-1)
			if m.top > m.bottom {
				m.top, m.bottom = m.bottom, m.top
			}
		}
	case 's':
		if !priv {
			m.saved, m.hasSaved = s.term.Cursor(), true
		}
	case 'g':
		if !priv {
			switch args[0] {
			case 0:
				m.tabs[s.term.Cursor().X] = false
			case 3:
				clear(m.tabs)
			}
		}
	case 'n':
		switch args[0] {
		case 5:
			if !priv {
				replies.WriteString("\x1b[0n")
			}
		case 6:
			c := s.term.Cursor()
			y := c.Y
			if c.State&cursorOrigin != 0 {
				y -= m.top
			}
			prefix := ""
			if priv {
				prefix = "?"
			}
			fmt.Fprintf(replies, "\x1b[%s%d;%dR", prefix, y+1, c.X+1)
		}
	case 't':
		if !priv && args[0] == 18 {
			cols, rows := s.term.Size()
			fmt.Fprintf(replies, "\x1b[8;%d;%dt", rows, cols)
		}
	}
}

func numericParams(params string) ([]int, bool) {
	parts := strings.Split(params, ";")
	args := make([]int, len(parts))
	for i, p := range parts {
		if p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil, false
		}
		args[i] = n
	}
	return args, true
}

const (
	cursorWrapNext = 2
	cursorOrigin   = 4
)

var privateModes = []struct {
	number int
	flag   vt10x.ModeFlag
}{
	{1, vt10x.ModeAppCursor}, {7, vt10x.ModeWrap},
	{9, vt10x.ModeMouseX10}, {25, 0}, {66, vt10x.ModeAppKeypad},
	{1000, vt10x.ModeMouseButton}, {1002, vt10x.ModeMouseMotion},
	{1003, vt10x.ModeMouseMany}, {1004, vt10x.ModeFocus},
	{1006, vt10x.ModeMouseSgr}, {2004, 0},
}

func (s *Screen) modeStatus(priv bool, number int) int {
	set := false
	if priv {
		switch number {
		case 6:
			set = s.term.Cursor().State&cursorOrigin != 0
		case 25:
			set = s.term.CursorVisible()
		case 47, 1047, 1049:
			set = s.term.Mode()&vt10x.ModeAltScreen != 0
		case 2004:
			set = s.modes.paste
		case 66:
			set = s.modes.keypad
		case 9, 1000, 1002, 1003:
			set = s.modes.mouse == number
		default:
			found := false
			for _, mode := range privateModes {
				if mode.number == number {
					set, found = s.term.Mode()&mode.flag != 0, true
					break
				}
			}
			if !found {
				return 0
			}
		}
	} else {
		switch number {
		case 4:
			set = s.term.Mode()&vt10x.ModeInsert != 0
		case 20:
			set = s.term.Mode()&vt10x.ModeCRLF != 0
		default:
			return 0
		}
	}
	if set {
		return 1
	}
	return 2
}
