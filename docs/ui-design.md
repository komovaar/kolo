# Kolo interface

Kolo is a shared terminal workspace. Its shell should give the terminal room,
keep sessions easy to find, and make connection and permission states legible.

## Identity

The interface uses neutral graphite surfaces, a celadon accent, Inter for
controls, and JetBrains Mono for terminals and technical metadata. The Kolo
ring and monospace wordmark identify the workspace. Amber means attention is
needed; red communicates a failure. Routine activity uses neutral text.

The dark explorer sits below the workspace in brightness, so navigation recedes
and terminal content stays central. Headers share the canvas tone; borders and
neutral selected rows establish hierarchy without tinting large surfaces.
Celadon remains reserved for actions, focus, and small selection indicators.

`brand/tokens.css` is the canonical source for workspace tokens. Its served
copy, `internal/hub/ui/assets/tokens.css`, must stay identical. The original
brand hues remain available for artwork and CLI output.

Use the semantic surface tokens for the canvas, sidebar, header, input, and
overlay. Use `--kolo-fg`, `--kolo-fg-subtle`, and `--kolo-fg-muted` for primary,
secondary, and supporting information. Selection and focus use the accent;
avoid assigning new colours to individual components.

## Type and geometry

- Interface text: 14px on a 20px line; supporting text: 12px, generally on
  an 18px line; pane titles: 14px.
- Entry headings: 20px. Mobile text fields use 16px to avoid focus zoom.
- Terminal text starts at 14px and is fitted through the existing PTY rules.
- Spacing uses 4, 8, 12, 16, 24, and 32px tokens. Optical adjustments belong
  inside controls, rather than changing the layout grid.
- Terminal identity headers are 56px, with a session name above technical
  context. Compact utility headers are 44px; the status bar starts at 28px.
- Ordinary controls are 32px tall. Touch controls receive larger targets.
- Small controls use 4px radii; menus use 6px; modal frames use 8px.
- Interface icons use a 1.5px stroke. Vendor marks retain their own geometry.

## Layout and interaction

The sidebar groups compact session rows by machine and directory. Shared paths
appear once in collapsible directory headings, with counts that remain useful
when closed. Group state and keyboard focus survive polling. The workspace
name is the sidebar's primary identity; Kolo's mark and wordmark accompany it.
Stop controls are revealed on hover or keyboard focus; read-only viewers keep
their activity indicators. Full names and paths are available in native
tooltips. Activity is a separate navigation destination.

The overview fills the available workspace width, with 24px content insets and
a modest page title. A dedicated toolbar precedes compact 40px session rows.
Search combines with machine and activity filters. Needs attention includes
waiting, failed, and disconnected sessions; ordinary startup is separate.
Filtering preserves the machine choice during interruptions and offers one
reset action. Polling moves focus to search when a focused result no longer
matches, and authentication loss clears all filters.
Session, program, directory, machine, and activity have separate columns so
technical details can be compared across sessions. At narrower widths, machine
and directory move into row metadata without losing their values. Connected
machines form a separate ledger and can be collapsed;
recovery guidance opens when machine availability is lost. Avoid metric cards,
repeated headings, and decorative content added to fill an empty area.

The terminal has a compact context header and status bar, with no surrounding
card. Connection and access appear on the left, while last input, zoom, and
restart controls occupy the right. Read-only access stays visible on phones.
Input remains gated by the existing connection and snapshot checks.

The session switcher uses Ctrl+Shift+Space, or Cmd+Shift+Space on macOS.
It supports arrow keys, Enter, Escape, and focus restoration. Ctrl+K remains
available to the shell. Dialogs follow the visible viewport when a software
keyboard reduces the available space.

Share links open a session for existing members. Invitations and member
permissions remain managed through the host CLI and organization file.
Activity entries link to sessions that still exist, and retain plain text for
retired sessions.

## Maintenance and review

Shared controls and entry forms live in `assets/ui.css`; workspace styles live
in `assets/workspace.css`. Reuse these treatments before adding another style.
React workflows live in `public/app` and reuse these same tokens and CSS.
Customized shadcn components provide dialog and command behavior without
changing Kolo's visual language. See [React migration](react-migration.md) for
the ownership boundaries and build workflow.
Fonts are bundled locally; their source and licenses are recorded in
`assets/fonts/NOTICE.md` and the accompanying OFL files.

Review the overview, terminal, creation dialog, switcher, sharing, activity,
sign-in, and join pages in dark and light appearance. Check wide windows,
phone widths, short viewports, long names, numerous sessions, read-only access,
reconnecting, and errors. Active selection and focus must remain readable
during appearance changes. Functional loading motion respects reduced-motion
preferences; selection changes are immediate.

Run the browser checks with Chromium and Firefox, plus the existing JavaScript
and Go checks. Keep behavioural improvements and visual refinements in small,
separately tested commits.
