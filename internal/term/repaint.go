package term

import (
	"bytes"
	"fmt"
	"slices"

	"github.com/hinshun/vt10x"
)

// Snapshot renders the current screen as terminal bytes for a joining viewer.
// Rows are positioned absolutely, so replaying it cannot scroll.
func (s *Screen) Snapshot() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.term.Lock()
	defer s.term.Unlock()

	cols, rows := s.term.Size()
	var b bytes.Buffer

	// Only enter-alt-screen is emitted, never exit: a fresh terminal starts on
	// the normal screen, and vt10x turns a no-op exit into an enter (state.go).
	if s.term.Mode()&vt10x.ModeAltScreen != 0 {
		b.WriteString("\x1b[?1049h")
	}
	// Paint independently of modes left by a previous snapshot. In particular,
	// origin/insert/wrap modes otherwise move or overwrite reconstructed cells.
	b.WriteString("\x1b[?6l\x1b[4l\x1b[?7l\x1b[r\x1b(B\x0f\x1b[0m\x1b[2J\x1b[3J")
	// Restore program-selected colours as well as indexed cell attributes.
	indices := make([]int, 0, len(s.modes.colors))
	for index := range s.modes.colors {
		indices = append(indices, index)
	}
	slices.Sort(indices)
	for _, index := range indices {
		if index < 256 {
			fmt.Fprintf(&b, "\x1b]4;%d;%s\x1b\\", index, s.modes.colors[index])
		} else {
			fmt.Fprintf(&b, "\x1b]%d;%s\x1b\\", index-246, s.modes.colors[index])
		}
	}

	cur := defaultStyle()
	for y := range rows {
		last := -1
		for x := range cols {
			if !isBlank(s.term.Cell(x, y)) {
				last = x
			}
		}
		if last < 0 {
			continue
		}
		fmt.Fprintf(&b, "\x1b[%d;1H", y+1)
		for x := 0; x <= last; x++ {
			g := s.term.Cell(x, y)
			if st := styleOf(g); st != cur {
				writeSGR(&b, st)
				cur = st
			}
			if g.Char == 0 {
				b.WriteRune(' ')
			} else {
				b.WriteRune(g.Char)
			}
		}
	}

	s.restore(&b)
	if s.term.CursorVisible() {
		b.WriteString("\x1b[?25h")
	} else {
		b.WriteString("\x1b[?25l")
	}
	// Complete a control sequence that was split at the snapshot boundary.
	switch s.modes.state {
	case 'E':
		b.WriteByte(0x1b)
	case 'C':
		b.WriteString("\x1b[")
		b.Write(s.modes.sequence)
	case 'I':
		b.WriteByte(0x1b)
		b.Write(s.modes.sequence)
	case 'S':
		b.WriteByte(0x1b)
		b.WriteByte(s.modes.stringKind)
		b.Write(s.modes.sequence)
		if s.modes.stringEsc {
			b.WriteByte(0x1b)
		}
	}
	return b.Bytes()
}

func writeMode(b *bytes.Buffer, private bool, number int, set bool) {
	prefix, final := "", 'l'
	if private {
		prefix = "?"
	}
	if set {
		final = 'h'
	}
	fmt.Fprintf(b, "\x1b[%s%d%c", prefix, number, final)
}

func (s *Screen) restore(b *bytes.Buffer) {
	m := &s.modes
	// Reset mouse protocols first: enabling one then disabling another would
	// clear the active protocol again in both vt10x and xterm.
	b.WriteString("\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l")
	for _, mode := range privateModes {
		if mode.number == 25 || mode.number == 66 {
			continue
		}
		set := s.modeStatus(true, mode.number) == 1
		if mode.flag&vt10x.ModeMouseMask == 0 || set {
			writeMode(b, true, mode.number, set)
		}
	}
	if m.keypad {
		b.WriteString("\x1b=")
	} else {
		b.WriteString("\x1b>")
	}
	writeMode(b, false, 20, s.term.Mode()&vt10x.ModeCRLF != 0)
	b.WriteString("\x1b[3g")
	for x, set := range m.tabs {
		if set {
			fmt.Fprintf(b, "\x1b[1;%dH\x1bH", x+1)
		}
	}
	fmt.Fprintf(b, "\x1b[%d;%dr", m.top+1, m.bottom+1)
	if m.hasSaved {
		s.restoreCursor(b, m.saved)
		b.WriteString("\x1b7")
	}
	c := s.term.Cursor()
	s.restoreCursor(b, c)
	writeMode(b, false, 4, s.term.Mode()&vt10x.ModeInsert != 0)
}

func (s *Screen) restoreCursor(b *bytes.Buffer, c vt10x.Cursor) {
	cols, rows := s.term.Size()
	c.X, c.Y = min(c.X, cols-1), min(c.Y, rows-1)
	origin := c.State&cursorOrigin != 0
	writeMode(b, true, 6, origin)
	y := c.Y
	if origin {
		y -= s.modes.top
	}
	fmt.Fprintf(b, "\x1b[%d;%dH", y+1, c.X+1)
	if c.State&cursorWrapNext != 0 {
		// CUP clears pending wrap. Rewriting the final cell recreates it without
		// scrolling, including when this is the saved cursor's wrap state.
		b.WriteString("\x1b(B")
		g := s.term.Cell(c.X, c.Y)
		writeSGR(b, styleOf(g))
		if g.Char == 0 {
			b.WriteRune(' ')
		} else {
			b.WriteRune(g.Char)
		}
	}
	writeAttributes(b, c.Attr)
	writeCharset(b, c.Attr)
}

func writeCharset(b *bytes.Buffer, attr vt10x.Glyph) {
	if attr.Mode&attrGfx != 0 {
		b.WriteString("\x1b(0")
	} else {
		b.WriteString("\x1b(B")
	}
}

// Cursor attributes are raw; unlike stored cells, reverse and bold colours
// have not been applied. Restore them for output that follows the snapshot.
func writeAttributes(b *bytes.Buffer, attr vt10x.Glyph) {
	writeSGR(b, styleOf(attr))
	if attr.Mode&attrReverse != 0 {
		b.WriteString("\x1b[7m")
	}
}

func defaultStyle() style {
	return style{fg: vt10x.DefaultFG, bg: vt10x.DefaultBG}
}

func isBlank(g vt10x.Glyph) bool {
	return (g.Char == ' ' || g.Char == 0) && styleOf(g) == defaultStyle()
}

// Reverse video is reconstructed, not read off the glyph: vt10x already swapped
// fg/bg (styleOf), and a default in the wrong slot is swapped back + SGR 7.
func writeSGR(b *bytes.Buffer, st style) {
	fg, bg := st.fg, st.bg
	reverse := fg == vt10x.DefaultBG || bg == vt10x.DefaultFG
	if reverse {
		fg, bg = bg, fg
	}

	b.WriteString("\x1b[0")
	if reverse {
		b.WriteString(";7")
	}
	if st.bold {
		b.WriteString(";1")
	}
	if st.italic {
		b.WriteString(";3")
	}
	if st.underline {
		b.WriteString(";4")
	}
	if st.blink {
		b.WriteString(";5")
	}
	writeColor(b, fg, 3)
	writeColor(b, bg, 4)
	b.WriteString("m")
}

// writeColor appends one SGR colour parameter; base is 3 (fg) or 4 (bg). vt10x
// packs 24-bit colour into palette space, so COLORTERM is scrubbed (internal/agent).
func writeColor(b *bytes.Buffer, c vt10x.Color, base int) {
	switch {
	case c >= 1<<24: // DefaultFG, DefaultBG, DefaultCursor
		fmt.Fprintf(b, ";%d9", base)
	case c < 8:
		fmt.Fprintf(b, ";%d%d", base, c)
	case c < 16:
		fmt.Fprintf(b, ";%d%d", base+6, c-8)
	case c < 256:
		fmt.Fprintf(b, ";%d8;5;%d", base, c)
	default:
		fmt.Fprintf(b, ";%d8;2;%d;%d;%d", base, c>>16&0xff, c>>8&0xff, c&0xff)
	}
}
