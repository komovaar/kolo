# React migration

Kolo keeps its Go API, terminal transport, and single-binary distribution.
React owns interface state and rendering; xterm owns its terminal DOM and
streamed output. A component migration must remove its old DOM renderer so
that the same controls never have two owners.

## Checkpoints

- [x] Extract the inline workspace controller without changing behavior.
- [x] Add a pinned React, TypeScript, and Vite production build and CI checks.
- [x] Migrate session creation to a customized shadcn/Radix dialog.
- [x] Migrate session browsing and supporting workspace controls incrementally.
- [x] Review desktop/mobile, keyboard access, permissions, polling, and recovery.
- [x] Verify embedded assets through the Go server and a standalone binary.

Each checkpoint is a separate, tested commit. The existing browser suite is
the behavior baseline, including Firefox shortcuts and terminal fitting.
Type checking and reproducible frontend builds join the existing JS and Go
checks. Compiled assets are committed so Go-only builds and `go install` keep
working; CI verifies that they match the source.

## Design

Retain Kolo's compact graphite/celadon design tokens and bundled typography.
Use shadcn component source selectively, adapting it to existing CSS instead
of installing a dashboard template. Accessible primitives handle dialogs and
menus; terminal routing, access checks, and stream recovery retain their
existing semantics. Avoid animation and new product sections.

Users need no Node runtime, frontend service, or internet-hosted UI assets.
Contributors need Node to change and build React source. Production builds
must not contain development servers, source maps, or external dependencies.

## Implemented boundaries

React owns the session browser, session creation, session switcher, and sharing
popover. The customized shadcn Dialog and Command compositions use Radix and
cmdk for their interaction behavior. Source, compiled JavaScript, and bundled
third-party notices ship together.

The static frame, explorer, account menu, and activity log retain their existing
controllers. They can migrate separately if a concrete interaction benefits;
this migration does not rebuild working terminal transport or navigation just
to put every element in React. Controllers update React-owned regions through
the typed `KoloUI` boundary instead of replacing their DOM children.

Terminal streams, parsing, fitting, and input gating remain outside React.
Metadata snapshots use stable session keys; streaming bytes never trigger a
component render. Authentication loss closes overlays synchronously, clears
private form data, and invalidates pending responses. Delayed clipboard results
cannot update a newly opened session's sharing panel.

## Verified checkpoints

- 50 layout/interaction tests in Chromium and Firefox, including failed bundle
  loading, rendering recovery, draft preservation, and late response handling.
- A real-binary browser test in both engines: build into an empty temporary
  directory, join, create a shell, send input, receive actual PTY output, reload,
  switch/share, and stop the session. No external UI asset requests.
- 62 JavaScript logic tests; Go race tests, vet, and build with both the installed
  compiler and Go 1.26.9 from `go.mod`.
- Type checking, reproducible generated assets, correct embedded JavaScript
  content types, and a live Vite proxy/reload check.
- npm audit reported no production vulnerabilities. The pinned Go scanner found
  no reachable or imported-package vulnerabilities; its module-level advisory
  concerns unused `golang.org/x/crypto/openpgp`.

The migration adds a production UI bundle of approximately 330 KB (104 KB if
gzip-compressed). Gzip size is a build measurement; this does not claim that
the Go server enables HTTP compression. Users still receive one binary.
