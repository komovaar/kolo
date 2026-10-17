package agent

import (
	"os"
	"path/filepath"
	"strings"
)

// Applications commonly shell out to a platform clipboard utility. For a
// browser terminal those writes must travel over its PTY, rather than touching
// the machine running the agent. Reads stay with the browser's paste event.
func clipboardEnv(env []string) ([]string, func(), error) {
	dir, err := os.MkdirTemp("", "kolo-clipboard-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { os.RemoveAll(dir) }
	for _, name := range []string{"pbcopy", "pbpaste", "wl-copy", "wl-paste", "xclip", "xsel"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(clipboardCommand), 0700); err != nil {
			cleanup()
			return nil, nil, err
		}
	}
	path := ""
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if value, ok := strings.CutPrefix(kv, "PATH="); ok {
			path = value
		} else {
			out = append(out, kv)
		}
	}
	if path == "" {
		path = "/usr/local/bin:/usr/bin:/bin"
	}
	return append(out, "PATH="+dir+string(os.PathListSeparator)+path), cleanup, nil
}

const clipboardCommand = `#!/bin/sh
case "${0##*/}" in
 pbpaste|wl-paste) exit 1 ;;
esac
for arg do
 case "$arg" in
  -o|-out|--output|--paste|-help|--help|-version|--version) exit 1 ;;
 esac
done
# Bound the OSC payload and remove base64's platform-dependent line wrapping.
encoded=$(head -c 786433 | base64 | tr -d '\r\n') || exit 1
[ "${#encoded}" -le 1048576 ] || exit 1
printf '\033]52;c;%s\007' "$encoded" > /dev/tty
`
