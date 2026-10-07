package term

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"testing"
)

func TestSnapshotInXterm(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is needed to compare snapshots with the vendored xterm parser")
	}
	type fixture struct {
		Name     string `json:"name"`
		Input    string `json:"input"`
		Next     string `json:"next"`
		Snapshot string `json:"snapshot"`
	}
	cases := []fixture{
		{Name: "defaults", Input: "hello", Next: " world"},
		{Name: "application input", Input: "\x1b[?1;2004h\x1b=ready", Next: "!"},
		{Name: "modes disabled again", Input: "\x1b[?1;2004h\x1b=\x1b[?1;2004l\x1b>ready", Next: "!"},
		{Name: "mouse and focus", Input: "\x1b[?1002;1004;1006hready", Next: "!"},
		{Name: "mouse any event", Input: "\x1b[?1003hready", Next: "!"},
		{Name: "mouse X10", Input: "\x1b[?9hready", Next: "!"},
		{Name: "reset inactive mouse mode", Input: "\x1b[?1003h\x1b[?1000lready", Next: "!"},
		{Name: "CSI application keypad", Input: "\x1b[?66hready", Next: "!"},
		{Name: "scroll margins", Input: "header\x1b[3;6r\x1b[6;1Hbottom", Next: "\r\nnext\r\nmore"},
		{Name: "origin mode", Input: "header\x1b[3;6r\x1b[?6h\x1b[2;4Hinside", Next: "\x1b[4;1Hlast\r\nscroll"},
		{Name: "custom tab stops", Input: "\x1b[3g\x1b[1;4H\x1bH\x1b[1;13H\x1bH\x1b[1;1Ha", Next: "\tb\tc"},
		{Name: "saved cursor and attributes", Input: "\x1b[31;1m\x1b[2;4H\x1b7\x1b[0m\x1b[5;2Hnow", Next: "\x1b8saved"},
		{Name: "continuing attributes", Input: "\x1b[31;44;1;3;4;5;7mtext", Next: "same"},
		{Name: "reverse default colours", Input: "\x1b[7mtext", Next: "same"},
		{Name: "line drawing continues", Input: "\x1b(0qqq", Next: "qq\x1b(B ascii"},
		{Name: "pending wrap", Input: "1234567890123456789012345678901234567890", Next: "wraps"},
		{Name: "saved pending wrap", Input: "1234567890123456789012345678901234567890\x1b7\x1b[2;1Hhere", Next: "\x1b8wraps"},
		{Name: "wrap disabled", Input: "\x1b[?7l1234567890123456789012345678901234567890", Next: "stays"},
		{Name: "insert mode", Input: "abcdef\x1b[1;3H\x1b[4h", Next: "XY"},
		{Name: "alternate screen", Input: "\x1b[?1049h\x1b[?1;2004h\x1b[31mTUI", Next: " still"},
		{Name: "split CSI", Input: "text\x1b[?200", Next: "4h more"},
		{Name: "split charset", Input: "text\x1b(", Next: "0qqq"},
		{Name: "split OSC", Input: "text\x1b]0;partial", Next: " title\x07 more"},
	}
	for i := range cases {
		s := New(40, 8)
		// Parse byte by byte to exercise modes/escapes across PTY boundaries.
		for _, b := range []byte(cases[i].Input) {
			s.Write([]byte{b})
		}
		cases[i].Snapshot = string(s.Snapshot())
	}
	input, err := json.Marshal(cases)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(node, "testdata/snapshot.cjs")
	cmd.Stdin = bytes.NewReader(input)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("xterm replay: %v\n%s", err, out)
	}
}

func TestTerminalQueryReplies(t *testing.T) {
	s := New(40, 8)
	input := "\x1b[3;6r\x1b[?6h\x1b[2;4H\x1b[?1;2004h" +
		"\x1b[5n\x1b[6n\x1b[?6n\x1b[c\x1b[>c\x1b[18t" +
		"\x1b[?2004$p\x1b[?7$p\x1b[?9999$p\x1bP$qr\x1b\\" +
		"\x1b]10;?\x07\x1b]11;?\x1b\\\x1b]4;1;?\x07"
	want := "\x1b[0n\x1b[2;4R\x1b[?2;4R\x1b[?1;2c\x1b[>0;0;0c\x1b[8;8;40t" +
		"\x1b[?2004;1$y\x1b[?7;1$y\x1b[?9999;0$y\x1bP1$r3;6r\x1b\\" +
		"\x1b]10;rgb:e7e7/e9e9/e4e4\x1b\\\x1b]11;rgb:1010/1313/1414\x1b\\" +
		"\x1b]4;1;rgb:cccc/0000/0000\x1b\\"
	var replies []byte
	for _, b := range []byte(input) {
		replies = append(replies, s.WriteWithReplies([]byte{b})...)
	}
	if string(replies) != want {
		t.Fatalf("replies = %q, want %q", replies, want)
	}
	if got := s.WriteWithReplies(s.Snapshot()); len(got) != 0 {
		t.Fatalf("snapshot itself generated terminal query replies: %q", got)
	}
}

func TestModesIgnoreStringPayloadAndReset(t *testing.T) {
	s := New(40, 8)
	s.Write([]byte("\x1b]0;fake \x1b[?2004h\x07"))
	if s.modes.paste {
		t.Fatal("interpreted a mode sequence inside an OSC string")
	}
	s.Write([]byte("\x1b[?2004h\x1b[3;6r\x1bc"))
	if s.modes.paste || s.modes.top != 0 || s.modes.bottom != 7 {
		t.Fatalf("reset did not clear replay state: %+v", s.modes)
	}
}

func TestNoOpResizePreservesModes(t *testing.T) {
	s := New(40, 8)
	s.Write([]byte("\x1b[3;6r\x1b[?6;2004hinside"))
	want := s.Snapshot()
	for _, size := range [][2]int{{40, 8}, {0, 8}, {40, -1}} {
		s.Resize(size[0], size[1])
		if got := s.Snapshot(); !bytes.Equal(got, want) {
			t.Fatalf("no-op resize to %v changed terminal state", size)
		}
	}
}
