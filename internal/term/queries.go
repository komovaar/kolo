package term

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// Colour answers use the same defaults as the vendored xterm 5.5 palette and
// the browser theme. A host answers once, even with no controlling viewers.
var ansiColors = [...]uint32{
	0x2e3436, 0xcc0000, 0x4e9a06, 0xc4a000, 0x3465a4, 0x75507b, 0x06989a, 0xd3d7cf,
	0x555753, 0xef2929, 0x8ae234, 0xfce94f, 0x729fcf, 0xad7fa8, 0x34e2e2, 0xeeeeec,
}

func (s *Screen) stringReply(replies *bytes.Buffer) {
	m := &s.modes
	payload := string(m.sequence)
	if m.stringKind == 'P' && strings.HasPrefix(payload, "$q") {
		request := strings.TrimPrefix(payload, "$q")
		switch request {
		case "r":
			fmt.Fprintf(replies, "\x1bP1$r%d;%dr\x1b\\", m.top+1, m.bottom+1)
		case "m":
			var sgr bytes.Buffer
			writeAttributes(&sgr, s.term.Cursor().Attr)
			fmt.Fprintf(replies, "\x1bP1$r%s\x1b\\", strings.TrimPrefix(sgr.String(), "\x1b["))
		default:
			replies.WriteString("\x1bP0$r\x1b\\")
		}
		return
	}
	if m.stringKind != ']' {
		return
	}
	parts := strings.Split(payload, ";")
	command, err := strconv.Atoi(parts[0])
	if err != nil {
		return
	}
	if command == 104 {
		if len(parts) == 1 || parts[1] == "" {
			for index := range m.colors {
				if index < 256 {
					delete(m.colors, index)
				}
			}
		} else {
			for _, value := range parts[1:] {
				if index, err := strconv.Atoi(value); err == nil && index >= 0 && index < 256 {
					delete(m.colors, index)
				}
			}
		}
		return
	}
	if command >= 110 && command <= 112 {
		delete(m.colors, 256+command-110)
		return
	}
	if command == 4 {
		for i := 1; i+1 < len(parts); i += 2 {
			if index, err := strconv.Atoi(parts[i]); err == nil && index >= 0 && index < 256 {
				s.color(replies, index, parts[i+1], fmt.Sprintf("4;%d", index))
			}
		}
	} else if command >= 10 && command <= 12 {
		for i := 1; i < len(parts) && command+i-1 <= 12; i++ {
			s.color(replies, 256+command+i-11, parts[i], strconv.Itoa(command+i-1))
		}
	}
}

func (s *Screen) color(replies *bytes.Buffer, index int, value, prefix string) {
	m := &s.modes
	if value == "?" {
		color, ok := m.colors[index]
		if !ok {
			color = defaultColor(index)
		}
		fmt.Fprintf(replies, "\x1b]%s;%s\x1b\\", prefix, color)
	} else if color, ok := parseColor(value); ok {
		if m.colors == nil {
			m.colors = make(map[int]string)
		}
		m.colors[index] = color
	}
}

func parseColor(value string) (string, bool) {
	var channels []string
	if strings.HasPrefix(value, "rgb:") {
		channels = strings.Split(value[4:], "/")
	} else if strings.HasPrefix(value, "#") && (len(value)-1)%3 == 0 {
		n := (len(value) - 1) / 3
		if n >= 1 && n <= 4 {
			channels = []string{value[1 : 1+n], value[1+n : 1+2*n], value[1+2*n:]}
		}
	}
	if len(channels) != 3 {
		return "", false
	}
	for i, channel := range channels {
		if len(channel) < 1 || len(channel) > 4 {
			return "", false
		}
		n, err := strconv.ParseUint(channel, 16, 16)
		if err != nil {
			return "", false
		}
		n = n * 65535 / ((1 << (4 * len(channel))) - 1)
		channels[i] = fmt.Sprintf("%04x", n)
	}
	return "rgb:" + strings.Join(channels, "/"), true
}

func defaultColor(index int) string {
	var color uint32
	switch {
	case index < 16:
		color = ansiColors[index]
	case index < 232:
		cube := [...]uint32{0, 95, 135, 175, 215, 255}
		n := index - 16
		color = cube[n/36]<<16 | cube[n/6%6]<<8 | cube[n%6]
	case index < 256:
		v := uint32(8 + (index-232)*10)
		color = v<<16 | v<<8 | v
	case index == 256:
		color = 0xe7e9e4
	case index == 257:
		color = 0x101314
	case index == 258:
		color = 0x2c6f62
	}
	return fmt.Sprintf("rgb:%04x/%04x/%04x", (color>>16&255)*257, (color>>8&255)*257, (color&255)*257)
}
