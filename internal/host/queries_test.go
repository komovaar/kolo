package host

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAgentReceivesQueryReplyWithoutViewers(t *testing.T) {
	dir := t.TempDir()
	script := fakeAgentNamed(t, dir, "terminal-query", `
stty raw -echo
printf '\033[3;4H\033[6n'
dd bs=1 count=6 of=reply 2>/dev/null
printf 'query answered'
sleep 30
`)
	a := NewAgents(Config{Dirs: []string{dir}, Allow: []string{script}}, "")
	t.Cleanup(a.StopAll)
	if err := a.Start(spec("query", dir, script)); err != nil {
		t.Fatal(err)
	}
	nextReport(t, a)
	waitFor(t, func() bool {
		reply, _ := os.ReadFile(filepath.Join(dir, "reply"))
		return len(reply) == 6
	})
	reply, err := os.ReadFile(filepath.Join(dir, "reply"))
	if err != nil || string(reply) != "\x1b[3;4R" {
		t.Fatalf("PTY query reply = %q, %v", reply, err)
	}
}
