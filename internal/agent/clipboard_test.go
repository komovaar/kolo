package agent

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClipboardUtilitiesWriteToPTYAndNeverUseHostClipboard(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "host-clipboard")
	for _, name := range []string{"pbcopy", "pbpaste", "xclip", "xsel", "wl-copy", "wl-paste"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\nprintf touched > '"+marker+"'\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	script := `for utility in pbcopy 'xclip -selection clipboard' 'xsel --clipboard --input' wl-copy; do
 printf 'copy ✓\nsecond line' | $utility || exit 2
done
pbpaste; wl-paste; xclip -o; xsel --output
exit 0`
	a, err := Start([]string{"sh", "-c", script}, "", 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	a.pty.SetReadDeadline(time.Now().Add(5 * time.Second))
	got := readAll(t, a)
	if err := a.Wait(); err != nil {
		t.Fatal(err)
	}
	want := "\x1b]52;c;" + base64.StdEncoding.EncodeToString([]byte("copy ✓\nsecond line")) + "\x07"
	if strings.Count(got, want) != 4 {
		t.Fatalf("clipboard output = %q, want four %q", got, want)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("host clipboard utility ran: %v", err)
	}
	for _, kv := range a.cmd.Env {
		if path, ok := strings.CutPrefix(kv, "PATH="); ok {
			bridge := strings.Split(path, string(os.PathListSeparator))[0]
			if _, err := os.Stat(bridge); !os.IsNotExist(err) {
				t.Errorf("clipboard helpers survived Wait: %v", err)
			}
		}
	}
}
