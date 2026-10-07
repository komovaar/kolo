# Kolo reference

How kolo works, and why it works that way.

To *run* it, the binary is the better manual: `kolo help`, `kolo help <command>`
and `kolo <command> -h` cover every command and flag. For the threat model and
how to report a hole, see [SECURITY.md](../SECURITY.md).

## Contents

- [The shape of it](#the-shape-of-it)
- [Agents](#agents)
- [Typing and control](#typing-and-control)
- [Attention alerts](#attention-alerts)
- [Restart and resume](#restart-and-resume)
- [The log](#the-log)
- [Screen size](#screen-size)
- [Where files live](#where-files-live)
- [What works today](#what-works-today)
- [Repo layout](#repo-layout)

## The shape of it

Kolo runs long-lived CLI agents (Claude Code, opencode, anything that draws a
terminal) so a whole team can use them.

There are two halves:

- a **host**, a machine somebody lends to the team, which runs the agents under
  pseudo-terminals
- a **hub**, the server everyone opens in a browser

```
   browser      browser                       host machine
   (dana)       (artem)                     ┌─────────────────┐
      │            │                        │ kolo host       │
      └─────┬──────┘                        │   ├ agent (PTY) │
            ▼                               │   ├ agent (PTY) │
        ┌───────┐ ◄── outbound websockets ──┤   └ agent (PTY) │
        │  hub  │                           └─────────────────┘
        └───────┘
```

`kolo up` runs both halves in one process, which is the usual way to start.
`kolo serve` and `kolo host` split them across machines.

**The host dials out.** It opens a control websocket and one screen websocket
per running agent, and never accepts an inbound connection. A separate host
needs no open port, firewall rule, or tunnel. The hub does accept connections;
with `kolo up`, the hub and host happen to run in the same process.

**Only hosts install kolo.** Everyone else opens a link. It is one Go binary
with nothing beside it.

**Agents are communal.** Members normally can watch, type at, and control any
agent. A member marked `"read_only": true` in the org file can watch every
agent and read the activity log, but cannot create, rename, type at, interrupt,
restart, start fresh, or stop agents. The hub enforces this for HTTP requests
and every WebSocket command, including connections already open when access
changes. File edits take effect on the hub's next reload, usually within two
seconds. Existing members without the field keep control access.

An invite may also carry `"read_only": true`; members who claim it inherit
that access. Changing or withdrawing an invite does not change members who
already joined. Change those members individually in the org file.

Create a read-only invitation with `kolo invite -id observers -read-only`, or
a direct member token with `kolo token -id observer -read-only`. `kolo who`
and `kolo invite -list` show each member or link's access. Renewing a link
preserves its access. To change it, use `kolo invite -id observers -new
-read-only=false` (or `true`). This replaces the invitation, not existing
members' access.

The browser identifies these members as **read-only** beneath their name,
hides create, stop and restart controls, and disables terminal input and
renaming. Watching screens, reading the log, zooming, and attention alerts
remain available. If access changes while the page is open, its next refresh
updates these controls; the server independently checks every command.

## Agents

Any command that draws a terminal will run. The org can watch it, type at it,
and stop it without kolo knowing anything about it.

Two things do need kolo to know the kind of agent, and it reads both off the
agent's own screen:

1. **What state it is in** (idle, busy, or asking a question), so the agent
   list can say what each one is doing instead of showing black rectangles.
2. **How to resume its conversation.** Without this, every restart starts over.

Kolo ships descriptions for `claude`, `codex`, and `opencode`.
Codex restarts with `codex resume --last`, which selects the most recent
conversation in that working directory. If another Codex session uses the same
directory, it may become the one Kolo resumes.

### Describing another kind

Put it in `~/.kolo/kinds.json` on the host. An entry there replaces a shipped
kind completely. The two are never merged.

```json
{
  "robo": {
    "markers": {
      "idle": ["type a message"],
      "busy": "working",
      "dialogFooter": "Press enter to continue",
      "dialogSelected": "›"
    },
    "resume": ["--continue"]
  }
}
```

**Reading the screen.** These say how to tell what the agent is doing.

| field | what it is |
|---|---|
| `idle` | hints the input box shows when it can take a line. Any one of them matching is enough |
| `busy` | what the screen says while the agent is working. Without it, working looks the same as waiting |
| `dialogFooter`, `dialogSelected` | how to recognise that a question is up. Never used to answer one |
| `settle` | how long the screen must sit unchanged before it reads as idle, in seconds (`3`, or `1.5`) or as a duration (`"1500ms"`). For agents whose idle state is silence |

**Resuming a conversation.** These say how to bring one back after a restart.

| field | what it is |
|---|---|
| `resume` | arguments appended to continue the last conversation |
| `continue` | arguments used when a restart has no id to resume by. Only safe while this agent is alone in its directory |
| `pin` | arguments carrying `{session}`, filled with an id kolo mints at first launch. The same id goes back into `resume`. For agents that accept a session id at start, like `claude --session-id` |
| `session` | a pattern whose capture is the conversation id, read off the screen. For agents that print their id. Use it when `resume` carries `{session}` |

**Stopping it.**

| field | what it is |
|---|---|
| `interrupt` | the key that stops this agent: `esc`, `ctrl+c`, or a single character. Defaults to `esc`. Only sent while the `busy` marker is on screen |

### Getting the markers right

Markers are literal strings copied from a real screen, not guesses. Record a
real session with `cmd/kolorec` and read them off the dump.

After an agent updates, run `kolo doctor`. It says whether each kind still fits
what the agent draws, what this machine can run and lend, and exits non-zero,
so it can be the last line of a setup script.

An agent kolo has no description for still runs, and the org can still watch it
and type at it. What it loses is its status in the list and its conversation
across restarts. Its screen reads as *unknown*, and kolo claims nothing more
about it.

### One of each kind per directory

Most agents resume by asking for "the last conversation in this directory", so
two of the same kind in one directory would come back as each other. Kolo
refuses that.

Agents that name or pin their conversations can prove which one is theirs, so
they are allowed to share a directory.

Sharing a directory still means sharing its files. Kolo does not referee that.

## Typing and control

Any member with control access can type at any agent. There is no lock to take
and nobody to ask. Read-only members can watch the same screen.

Keystrokes go to the agent as you press them. Whoever typed last is shown to
everyone else as the typist. Everything typed goes into the log under your
name.

If two people type at once their keystrokes interleave, and everyone watching
sees it happen. It works the way two people reaching for one keyboard works.

Nothing is gated, because you can see the screen your keys are landing on.
Pressing Enter at a question is a decision made with your eyes open.

A paste arrives as one message rather than a key at a time, and goes through
whole up to 64 KB. Past that the host refuses it and says so on the screen,
because a paste that quietly went nowhere would look like one that worked.

Each agent has its own ordered input queue, bounded to 64 commands and
256 KiB including the write in progress. A process that stops reading input
cannot stall controls for another agent. When its queue fills, further input
is refused on the screen; retry it after the process catches up or restart it.
Stop and restart cancel blocked writes and discard that process's pending
input. Pending input is never replayed into a restarted process. Queued
interrupts recheck the current screen before pressing the interrupt key.

Joining or reconnecting restores the screen together with application cursor
and keypad modes, bracketed paste, mouse and focus reporting, scroll margins,
tab stops, cursor state, and drawing attributes. Arrow keys and pastes keep
the encoding the running program requested.

The host answers terminal queries through the same bounded input queue,
independently of viewers. Browser terminals do not send automatic query
answers or log them as somebody's typing. Supported queries include cursor
and device status, terminal identity, mode status, character-grid size,
scroll margins, drawing attributes, and palette/theme colours. Queries for
browser pixel dimensions are unanswered: each viewer scales the shared grid
to its own window.

### What kolo can press for you

| action | offered by | allowed when |
|---|---|---|
| stop | the page | always |
| interrupt | the protocol only | only while that kind's `busy` marker is on screen, using that kind's key |
| restart | the page and protocol | always |
| start fresh | the protocol only | always |

The page offers stop in the agent list and restart below the open screen.
Restart asks for confirmation before interrupting work and attempts to resume
the conversation when the agent supports it. Interrupt and start fresh remain
available through the watch websocket. The log records each action.

### Why there is no button to answer a question

Kolo tells you a question is up. It does not tell you what the question is, and
it will not answer one for you. The question is on the screen, and answering it
means typing.

An earlier version read the choices off dialogs and drew buttons. It worked for
exactly one agent's dialog and guessed at everyone else's. If an agent ever
offers its questions through a real interface, kolo will use that instead.

## Attention alerts

The browser tab title counts running agents whose screens show a question.
Open your name menu and choose **enable desktop alerts** to also receive a
desktop notification when an agent starts waiting for an answer. Your browser
asks permission only when you choose this option. The preference is saved in
this browser for this hub; use the same menu to disable it.

Click an alert to open that agent. Alerts contain its name, never terminal
content. A question already visible in your focused agent screen does not
produce an alert. Repeated status refreshes do not repeat the alert while the
same question remains detected. Loading the page shows the waiting count
without replaying old questions as notifications.

Keep a Kolo tab open. This version uses the agent list's three-second refresh;
background tabs may be throttled or suspended by the browser, so delivery is
best effort. Desktop alerts require a supported desktop browser and HTTPS
(or localhost). Plain HTTP on a LAN address and unsupported mobile browsers
still show the waiting count. There is no delivery after all tabs are closed,
no email or push service, and no guarantee that nobody else is watching.
Alerts depend on the same screen markers as the agent list; unknown agent
kinds cannot report questions. Two questions without an observed idle or busy
state between them count as one waiting episode.

## Restart and resume

**Agents are supervised.** If one exits, kolo starts it again. One that will
not stay up is marked failed rather than restarted forever. A restart somebody
asked for does not count toward giving up.

**What is running is written down**, to the file `-state` names. Restarting the
host, or the whole machine, brings the org's agents back in the order they were
created.

**Resume works two ways:**

- ask for the last conversation, with `--continue` or similar
- name a conversation, with `--resume {session}`, where the id was either read
  off the screen or pinned when the agent first started

The id is kept in the state file, so it survives the machine restarting.

**A failed resume starts clean and says so.** Losing context quietly is worse
than losing it visibly.

**Start fresh** drops the conversation on purpose, and is logged like anything
else.

## The log

Every action a member takes is recorded on the hub, beside the org file, as
JSON lines. Read it on the page, under the list icon in the sidebar, or with
`GET /v1/log`.

Recorded: created, said, interrupted, restarted, started fresh, renamed,
stopped, failed, and the host going away. The last two are nobody's doing, so
they are written down with no name against them.

**Typed lines are rebuilt from keystrokes** and only written when you press
Enter, so a line you abandon halfway is never recorded. Because it is a
reconstruction, pasted text and menu choices made with arrow keys will not read
back exactly. A line longer than 500 bytes is marked as truncated. If more than
one member contributed to a line, the entry is left unattributed rather than
crediting the person who happened to press Enter.

**Nothing an agent prints is kept.** Only what people did.

The log records who used the shared controls. Read-only members can read it
too; it includes members' typed lines and may contain sensitive information.

## Screen size

The agent is one process on one PTY, and a PTY has one size. An agent draws a
full screen, boxes and all, sized to the width it was told, so there is no
version of this where it draws differently for different people.

That size is the host's, settled when the agent starts, and nothing in a
browser moves it. What each window does with the grid is its own: the whole
screen is drawn at whatever size that window has room for, so a large monitor
gets large text and a laptop gets the same screen smaller, and neither is felt
by the other. The zoom control on the screen goes off fit for one person
without touching anybody else's window.

No window is a vote. Smallest wins, the way tmux settles it, put one phone on
the invite link in charge of the agent's whole interface, for the people
sitting at the machine included; largest wins only moves who pays for it.

## Where files live

Everything a machine remembers is in `~/.kolo`.

| | |
|---|---|
| `$KOLO_HOME` | moves the whole directory |
| `-org` | moves the org file |
| `-state` | moves the record of what is running |
| `-tls-cache` | moves the certificate store |

The org file also holds `hub`, the address the hub last started on. Nothing
reads it at runtime: it is there so `kolo invite` and `kolo token` print a
link that works from another machine. `-hub` overrides it.

## What works today

**Working, and tested across two machines:** watching, typing, stopping,
restart and resume (including pinned conversation ids), discovery of installed
agents (`-allow '*'`), and the log.

**Attention alerts:** a waiting count in the browser tab and optional desktop
notifications while the page is open. See [Attention alerts](#attention-alerts)
for browser requirements and delivery limits.

Interrupt, restart and start fresh travel on the watch websocket. The page
offers restart; interrupt and start fresh are protocol-only controls:
see [What kolo can press for you](#what-kolo-can-press-for-you).

## Repo layout

```
brand             the mark: geometry, tokens, and the icon build
cmd/kolo          the binary: up, serve, host, invite, token, who, doctor
cmd/kolorec       records an agent session as a test fixture, and its scripts
internal/adapter  agent-kind table: markers, resume, pin, interrupt
internal/agent    PTY process management
internal/config   ~/.kolo
internal/detect   screen state classification
internal/host     the machine half: supervision, state file, streaming
internal/hub      the server half: auth, registry, screens, journal, the page
internal/relay    sole writer to a PTY; keystroke gating rules
internal/session  one agent's screen fanned out to viewers
internal/term     vt10x-backed screen model and repaint
```

**Why the page lives in `internal/hub/ui`.** `go:embed` can reach into a
directory below the package it is written in, but never outside one. A page in
a package of its own would be a package whose only job was holding one embed
directive. `internal` keeps it from becoming importable API the module would
owe compatibility on.

**The icons and token stylesheet are build output.** They are checked in under
`internal/hub/ui/assets`, but `node brand/build.mjs` regenerates them from
`brand/ring.ts` and `brand/tokens.css`. That needs Node and a Chrome. Edit the
sources under `brand/`, never the generated files.
