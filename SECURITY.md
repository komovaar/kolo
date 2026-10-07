# Security

Report privately through [GitHub's advisory form][form], never a public issue.

[form]: https://github.com/whosgotch/kolo/security/advisories/new

## By design, not bugs

Kolo runs agents on a machine somebody lends to their team:

- **Members with control access can start agents, type at them, and stop them.**
  Members marked `"read_only": true` can watch screens and read the activity log,
  but the hub rejects their create, rename, stop, keyboard and restart commands.
- **A running agent has the host user's whole account.** `-dir` and `-allow`
  bound what may be *started*, not what it can *reach*.
- **Read-only access includes every agent's screen and the log.** It is not
  suitable for somebody who must not see the team's code, output, or prompts.
  Existing members keep control access unless explicitly marked read-only.
- **Plain HTTP sends tokens in the clear.** Use `-tls-domain` off a trusted network.

## Browser sessions

Browser sign-in creates a separate, revocable session lasting up to 90 days.
Signing out revokes that session and closes its terminal streams in every
tab sharing the login. Other browser logins and member/host bearer credentials
remain valid. Removing a member or changing their credential revokes their
browser access too.

Hashed browser sessions are saved in `<org file>.sessions` with owner-only
permissions so logins survive a hub restart. Keep this file private and back
it up alongside the org file. Run one hub per org file; the session store
refuses concurrent owners. A failed session-file write refuses sign-in or
reports an unsuccessful durable sign-out, while closing the current streams.

Upgrading from cookies containing member tokens requires existing browsers
to sign in again with their member token or rejoin through an invitation.

## Worth reporting

Any of it without a valid credential, or with a revoked one. Forged or
recovered tokens. An invite spent past its limit. XSS, CSRF, or a token leaking
into a URL or a log.

Latest release and `main`.
