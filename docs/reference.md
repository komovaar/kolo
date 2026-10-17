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

The new-session dialog accepts a folder path with suggestions from the host's
shared directories. By default, only the directory where you launch Kolo is
shared. To offer several projects, repeat `-dir`:

```sh
kolo up -dir /path/to/project-a -dir /path/to/project-b
```

To allow any directory on the host, explicitly use `kolo up -dir '*'` (or the
same flag on `kolo host`). The hub and host still enforce the host's directory
settings when starting a session. Leaving the session name blank generates a
name from the folder, program, and a random suffix; it can be renamed later.

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
Codex saves its conversation ID from its initial terminal title while it is
running, and can also read it from the exit message on its Kolo-owned screen.
Kolo never uses `resume --last` to select an unrelated local conversation.
If the ID is unavailable, Kolo starts fresh and shows a conversation-reset warning.

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

**Codex sessions use their conversation title automatically.** Kolo asks Codex
to emit its thread title as the terminal window title and displays it in
the sidebar, session header, log and alerts when available. Until then, the
session identifier is shown. Other programs keep their existing names.

**Session labels are saved on the hub.** Double-click a session's name in the
sidebar, or focus its row and press **F2**, to rename it. This changes its display label; the session identifier,
URLs and host command stay the same. A successful rename is saved before the
hub confirms it and survives browser reloads, host reconnects, and hub or host
restarts. Labels belong to the exact session, so stopping it and reusing the
identifier starts with a new label. The API can clear a label with
`PATCH /v1/agents/{name}` and `{"label":""}` to display its automatic title (or identifier when no title is available).

### Finding and sharing sessions

The overview lists sessions with their machine, working directory, and activity.
Search by session name, program, machine, or directory. **New session** is also
available in the sidebar while a terminal is open.
Connected machine details can be collapsed; they open when no machine is available.

Choose **Switch session**, or press **Ctrl+Shift+Space** (**Cmd+Shift+Space** on macOS),
to search sessions and common actions from any view. Use the arrow keys to
select a result, **Enter** to open it, and **Escape** to return to your work.
The shell's **Ctrl+K** shortcut remains available.

Open **Share session** in the terminal header to copy its link. This link opens
the same session for existing workspace members; new teammates need an invite
from the host. Invitations and member access remain managed by `kolo invite`,
`kolo who`, and the organization file.

The account menu switches between dark and light appearance. The preference
is saved for this hub and also applies to sign-in and invitation pages. The
terminal keeps its dark canvas for consistent program colours.
Activity entries link to sessions that are still available.

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

Switching sessions, reconnecting, and restarting replace the browser terminal
before replaying the snapshot. Old buffered output, partial escapes, terminal
modes, and program-selected colours stay with the previous screen. Input is
enabled after the new snapshot finishes rendering; leaving the session or
signing out immediately removes its terminal.

The host answers terminal queries through the same bounded input queue,
independently of viewers. Browser terminals do not send automatic query
answers or log them as somebody's typing. Supported queries include cursor
and device status, terminal identity, mode status, character-grid size,
scroll margins, drawing attributes, and palette/theme colours. Queries for
browser pixel dimensions are unanswered: viewers can have different displays.

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
Open your name menu and choose **Enable desktop alerts** to also receive a
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

**Failed sessions can be retried.** The session page shows the failure reason
and offers **Retry** to members with control access, even when no terminal
connection exists. Fix the executable, working directory, or agent credentials
on its machine, then retry the same session. Retry resets the automatic restart
budget and keeps the command, directory, and conversation recovery rules.
Failed records and their errors survive host reconnects and restarts; they
remain failed until retried or explicitly stopped. Unavailable and failed
screens stop reconnecting, while polling notices when a machine returns.

**What is running is written down**, to the file `-state` names. Restarting the
host, or the whole machine, brings the org's agents back in the order they were
created. Sessions whose permissions or directory conflicts prevent restore
are retained as failed sessions, with a reason on the page and in `kolo doctor`.
A successful restore never discards them. Restore does not launch an already
failed session; fix the problem and choose Retry, or Stop to remove its record.
If permissions changed, restart the host with the intended `-dir` and `-allow`
flags before retrying. Conflicting sessions must be stopped or moved to
separate checkouts before retrying.

**The previous state is recoverable.** Before restoring an existing valid
state file, kolo saves its exact contents as `<state>.bak` with owner-only
permissions. Routine saves do not replace this backup. An unreadable, damaged,
unsupported, or ambiguous state file disables new sessions and remains
untouched; the machine's health message and `kolo doctor` explain the problem.
Stop the host before repairing the file or copying `<state>.bak` back to the
state path, then restart it. Inspect the backup first: recovering it restores
the session set from that earlier startup, including sessions since removed.
The backup is refreshed only on a successful read at the next host startup.
If the backup cannot be written, restore leaves the original file untouched
and disables new sessions too.

**Resume works two ways:**

- ask for the last conversation, with `--continue` or similar
- name a conversation, with `--resume {session}`, where the id was either read
  off the screen or pinned when the agent first started

The id is kept in the state file, so it survives the machine restarting.

**An early resume exit triggers a visible fallback.** If a resume or continue
attempt exits within ten seconds, Kolo treats it as unsuccessful and starts a
fresh conversation automatically. This is a heuristic: the exit does not prove
that the previous history is missing or damaged. The session page keeps a
conversation-reset warning even after the replacement is running, across page
reloads, host reconnects, and machine restarts. When known, the warning includes
the previous conversation identifier so you can investigate it on the machine
using the agent's own recovery tools. Restart alone resumes the replacement.

Members with control access can choose **Acknowledge reset**. This dismisses
that event for everyone only after the host has saved the acknowledgement;
read-only members can see the warning. A later reset creates another warning.
Reset history stays in the session's state record until the session is stopped.
Pinned replacement identifiers are saved before launch. Hosts without a state
file keep this information for the current host run only.

**Start fresh** drops the conversation on purpose, and is logged like anything
else.

## The log

Every action a member takes is recorded on the hub, beside the org file, as
JSON lines in `<org-file>.journal.jsonl`. Read it on the page, under the list icon in the sidebar, or with
`GET /v1/log`.

Recorded: created, said, interrupted, restarted, started fresh, renamed,
retried, stopped, failed, automatic conversation resets, their acknowledgement,
and the host going away. Failures, automatic resets, and host disconnections
have no member attribution. Reset events carry their original timestamp and
previous conversation identifier when known. The host replays its saved reset
history after reconnects; retained events appear once in the log, including
when the hub restarts.

**Typed lines are rebuilt from keystrokes** and only written when you press
Enter, so a line you abandon halfway is never recorded. Because it is a
reconstruction, pasted text and menu choices made with arrow keys will not read
back exactly. A line longer than 500 bytes is marked as truncated. If more than
one member contributed to a line, the entry is left unattributed rather than
crediting the person who happened to press Enter.

**The browser reports log availability.** Failed refreshes retain previously
loaded entries and show that they may be out of date. When the hub cannot open
or continue writing its journal, the log warns that activity is only kept in
memory and will be lost on a hub restart.

**Nothing an agent prints is kept.** Only what people did.

The log records who used the shared controls. Read-only members can read it
too; it includes members' typed lines and may contain sensitive information.

## Screen size

The agent is one process on one PTY, and a PTY has one size. An agent draws a
full screen, boxes and all, sized to the width it was told, so there is no
version of this where it draws differently for different people.

Each browser keeps its own fit and zoom. Opening a second window, resizing a
passive viewer, or zooming while watching does not change the agent's layout.
When someone types or pastes, their available columns and rows become the PTY
size before their input reaches the app. That browser then controls layout
changes until another browser types. The other viewers fit the shared screen
locally. Separate tabs of the same member count as separate browsers.

On phones and narrow windows, **Sessions** opens a navigation drawer. Selecting
a session closes it. The terminal uses the available viewport, including when
the keyboard reduces the visible area. **+** enlarges text and **fit** restores
the default view. Viewers can zoom and pan; read-only viewers never resize the
agent. The person typing uses a readable default font, with the app redrawing
for their window and zoom.

## Clipboard

Selecting terminal text and copying uses the participant's browser clipboard,
including for read-only members. Ctrl+C copies when text is selected; otherwise
it remains terminal input. Ctrl+Shift+C and Command+C also copy a selection.
Paste uses the local browser paste event, including the running app's
bracketed-paste mode. Use the browser's paste shortcut (Ctrl+V, Ctrl+Shift+V, or
Command+V) rather than an app command that reads the host clipboard.

App copies using OSC 52 are delivered to the browser whose input the host most
recently processed. They do not overwrite other viewers' clipboards or get
replayed when someone joins. Browser clipboard reads are never exposed to the
app. If automatic copying is denied or unavailable on an HTTP origin, Kolo
shows selectable text for manual copying.

Newly started agents also receive session-local versions of `pbcopy`, `xclip`,
`xsel`, and `wl-copy` that send copied text through the PTY using OSC 52. Their
clipboard-read counterparts cannot read the host clipboard. These helpers
support text copied through standard input, up to 768 KiB. Applications that
access an OS clipboard directly or invoke a clipboard utility by absolute path
bypass these helpers; use terminal selection or configure such apps for OSC 52.
Existing agent processes need a restart to receive the helpers.

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

The hub saves session-label overrides in `<org-file>.labels`, with owner-only
permissions. Back up this file alongside the org file to preserve renamed
sessions. Confirmed stops remove the matching overrides; disconnects retain
them. An org created only in memory keeps labels for the current hub run.
If the label file is unreadable or uses an unsupported format, startup fails
and leaves it unchanged. Stop the hub, repair the file, then restart. Changes
made to this file while the hub runs must be read by restarting the hub;
a rename refuses to overwrite those edits.

## What works today

**Working, and tested across two machines:** watching, typing, stopping,
restart and resume (including pinned conversation ids), discovery of installed
agents (`-allow '*'`), and the log.

**Attention alerts:** a waiting count in the browser tab and optional desktop
notifications while the page is open. See [Attention alerts](#attention-alerts)
for browser requirements and delivery limits.

Interrupt, restart and start fresh travel on the watch websocket. The page
offers restart and uses `POST /v1/agents/{name}/retry` for failed sessions
(202 when accepted, 409 unless failed, 404 if unavailable).
`POST /v1/agents/{name}/context/ack` with `{"id":"<reset-id>"}` acknowledges a
conversation reset (204 after the host confirms persistence). Both require
control access. Reset identifiers are returned in the agent's `context_resets`
list. Interrupt and start fresh are protocol-only controls:
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
internal/protocol shared host-hub JSON messages, session snapshots, identity
internal/relay    sole writer to a PTY; keystroke gating rules
internal/session  one agent's screen fanned out to viewers
internal/term     vt10x-backed screen model and repaint
web               frontend source: pages, TypeScript/React, static assets
tests/browser     browser interactions and standalone binary integration
```

**Why the built page lives in `internal/hub/ui`.** `go:embed` can reach into a
directory below the package it is written in, but never outside one. A page in
a package of its own would be a package whose only job was holding one embed
directive. `internal` keeps it from becoming importable API the module would
owe compatibility on. Frontend source lives in `web/`; `npm run build:ui`
regenerates this embedded tree, including both entry pages and static assets.
The output is tracked so building or installing the Go binary needs no Node.

**The icons and token stylesheet are build output.** They are checked in under
`web/static`, and copied into `internal/hub/ui/assets` by the frontend build.
`node brand/build.mjs` regenerates them from `brand/ring.ts` and
`brand/tokens.css`; `node brand/favicon.mjs` regenerates the browser-theme tab
icons. That needs Node and a Chrome. Edit the sources under `brand/`, then run
`npm run build:ui` to refresh the embedded copies.

Disconnected sessions remain visible as **Machine disconnected** while the hub runs.
Their controls are unavailable. Reconnecting replaces the last-known list with
the sessions the host actually reports; this offline list is not persisted across hub restarts.

Older versions used `journal.jsonl` beside the org file. That file is left
untouched on upgrade because it may contain activity from several organizations.
The hub prints a migration notice when it finds legacy history without a new
journal. Stop the hub, verify which organization owns the history, and move it
to `<org-file>.journal.jsonl` before restarting to retain it in the UI. If a new
journal already exists, back up both files and review their contents before
merging; do not overwrite either history. Back up the org-specific journal
alongside the org file.
