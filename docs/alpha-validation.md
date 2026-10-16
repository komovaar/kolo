# Alpha compatibility checks

Last checked: 2026-10-16. These are observations from an opt-in test against
a real authenticated agent, separate from the shell-based CI browser tests.

## Environment

| Component | Tested |
|---|---|
| Kolo runtime source | `3169b1f` (same source tree as `d9d929c`) |
| Host | Linux, amd64 |
| Browser | Chromium 156.0.8078.4, headless, through Playwright |
| Codex CLI | 0.163.0 |
| Codex options | `--no-daemon -s read-only -a on-request` |
| Participants | Two independent controller browser contexts and one read-only context |

The hub, host, and browser processes ran on one machine over loopback.
The browser contexts used different member identities and cookies. This
checks the shared-session flow; it does not establish compatibility across
two physical machines, internet connections, or human keyboard layouts.

## Results

| Check | Result |
|---|---|
| Two members join through an invitation | Passed |
| Start the actual Codex TUI from the browser | Passed |
| Detect the ready agent after startup | Passed |
| First member sends a prompt; both see the response; working state is detected | Passed |
| Second member continues the same conversation | Passed |
| Reload a browser and continue the running conversation | Passed |
| Restart Codex and recover a value from the earlier conversation, without a reset warning | Passed |
| Both members see a real shell approval; the second approves one write to a disposable test file | Passed |
| Read-only member watches and receives HTTP 403 when attempting to stop the session | Passed |
| Revoke a member; its existing browser loses access, clears terminal content, and disables input | Passed |

Claude Code and opencode were not installed or authenticated in this test
environment, so no real-agent compatibility result is claimed for either.
The built-in adapters remain available. Real-agent behavior on macOS and
mobile browsers, and whole-host restart recovery, were not exercised in this
run. Linux/macOS CI and browser regression tests cover separate behavior.

## Repeat the Codex check

Install development dependencies and Playwright Chromium as described in
[Contributing](../CONTRIBUTING.md). Codex must be installed, authenticated,
and runnable from the same account that will run Kolo.

```sh
go build -o /tmp/kolo-smoke ./cmd/kolo
KOLO_SMOKE_BINARY=/tmp/kolo-smoke \
  KOLO_SMOKE_COMMAND='codex --no-daemon -s read-only -a on-request' \
  node scripts/smoke-agent.cjs
```

The script makes real model requests with the CLI's configured model. It
uses a disposable project, a loopback hub, and its own Kolo organization and
state files. It approves one write only to its temporary proof file. It
does not change the user's Codex authentication or approval configuration;
Codex retains its normal conversation history in its own storage.

The reported temporary directory contains a JSON result and terminal
screenshots for diagnosis. Keep those artifacts private. The script stops
its own agent and hub after success or failure. It is intentionally excluded
from CI because it requires a real account and uses model capacity.
