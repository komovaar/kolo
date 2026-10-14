# React migration

Kolo keeps its Go API, terminal transport, and single-binary distribution.
React owns interface state and rendering; xterm owns its terminal DOM and
streamed output. A component migration must remove its old DOM renderer so
that the same controls never have two owners.

## Checkpoints

- [x] Extract the inline workspace controller without changing behavior.
- [x] Add a pinned React, TypeScript, and Vite production build and CI checks.
- [ ] Migrate session creation to a customized shadcn/Radix dialog.
- [ ] Migrate session browsing and supporting workspace controls incrementally.
- [ ] Review desktop/mobile, keyboard access, permissions, polling, and recovery.
- [ ] Verify embedded assets through the Go server and a standalone binary.

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
