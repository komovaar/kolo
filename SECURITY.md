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

## Worth reporting

Any of it without a valid credential, or with a revoked one. Forged or
recovered tokens. An invite spent past its limit. XSS, CSRF, or a token leaking
into a URL or a log.

Latest release and `main`.
