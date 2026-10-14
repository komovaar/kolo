# Contributing

Contributions are welcome. A patch, a bug report, or a note saying something
confused you are all useful, and kolo is early enough that any of them still
changes its shape. Thank you for caring about it.

```
npm ci
npm run build:ui        # after changing web/; includes type checking
go install ./cmd/kolo    # onto $(go env GOPATH)/bin, which may not be on PATH
go run ./cmd/kolo up     # a hub, lending this directory
go test ./...
npm run test:ui
```

Frontend source lives in `web/`: entry pages at its root, TypeScript and React
under `src/`, and styles, fonts, icons, and vendored scripts under `static/`.
`src/app` composes the page; `src/features` owns product workflows;
`src/core` holds shared primitives and runtime types. Terminal transport,
fitting, and input live in `src/terminal`, outside React's render lifecycle.
Controllers receive page state and browser dependencies explicitly and install
listeners once at startup. Unit tests beside these modules import their actual
operations; `web/test` holds the shared test fixture.

Vite and TypeScript configuration and the single npm package live at the
repository root. Node 22.12+ is needed to change the UI. Everything under
`internal/hub/ui` is generated, committed, and embedded in the Go binary;
users and Go-only builders do not need Node. Edit `web/`, run
`npm run build:ui`, and commit source and output together. CI runs
`npm run check:ui` to compare the complete embedded tree with a fresh build.

Go entry points live in `cmd/`. `internal/hub` owns HTTP, authentication,
registry state, and host/viewer connections; `internal/host` owns machine
connections, process supervision, and persistence. Both consume the JSON
contract in `internal/protocol`; host implementation code does not import the
hub. Registry dispatch claims stay private to the hub. Smaller packages own
PTY processes (`agent`), screen fan-out (`session`), terminal emulation (`term`),
serialized input (`relay`), and agent descriptions and detection (`adapter`,
`detect`). Go tests stay beside their packages; full browser and standalone
binary tests live in `tests/browser`.

For frontend live reload, start the hub and then `npm run dev:ui`. Open the
Vite URL; API requests and terminal WebSockets proxy to `127.0.0.1:7300`.
Set `KOLO_DEV_HUB` to use a different hub address. Production runs only Go.

The browser checks include layout, phone sizes, keyboard navigation, and a
standalone binary that serves the UI and controls a real shell. They require
Go as well as the browser development dependencies:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

These are development dependencies only; the shipped binary still embeds all
browser assets. Linux CI installs Chromium and runs the same checks.
Set `KOLO_SCREENSHOT_DIR=/tmp/kolo-layout` when running them to save screenshots.

The session switcher also has Firefox keyboard checks:

```sh
npx playwright install firefox
KOLO_BROWSER=firefox node --test --test-name-pattern='session switcher' tests/browser/layout.browser.cjs
```

To run all browser checks in Firefox, use `KOLO_BROWSER=firefox npm run test:browser`.
Firefox phone checks use narrow viewports and touch input; Playwright's
`isMobile` emulation is Chromium-only.

Interface tokens, layout, and review guidance are in [UI design](docs/ui-design.md).

## What lands

Build, vet, `gofmt -l .` and the tests clean. CI runs those on Linux and macOS.
A test for anything whose behaviour changed; `-race` is the run that counts.
Docs fixed in the commit that made them wrong.

CI and release builds use the exact Go version in `go.mod`. Use that version
when checking release readiness; a newer local compiler can hide standard
library vulnerabilities present in the release compiler. CI prints its version
and sets `GOTOOLCHAIN=local` to prevent automatic toolchain changes.

Run the same pinned vulnerability scanner locally:

```sh
go version
GOTOOLCHAIN=local go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -show verbose ./...
```

Reachable vulnerabilities fail CI and block publishing. Verbose output also
shows advisories in dependencies whose vulnerable code is not reached; review
those as maintenance follow-ups. Keep the scanner version here and in CI in
sync when upgrading it.

## Commits

Small, and a plain sentence about what changed for somebody using kolo.

```
feat: one link an org keeps, not a drawer of them
fix(hub): one agent of each kind to a directory, not one agent
```

## Comments

Say what the code cannot: why it is this way, what breaks if it changes. Never
restate the line below.

## Agent kinds

Markers are literal strings off a real screen. Record one rather than guess:

```
go run ./cmd/kolorec -script cmd/kolorec/scripts/claude-turn.txt -dir /tmp/x claude
```

Recordings are gitignored and stay that way: they are a picture of somebody's
screen.

AGPL-3.0, like the project.
