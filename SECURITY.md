# Security

Report privately through [GitHub's advisory form][form], never a public issue.

[form]: https://github.com/komovaar/kolo/security/advisories/new

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

## Alpha isolation setup

Kolo does not provide a process sandbox or isolate sessions from each other.
For this alpha, use a dedicated virtual machine for each trusted team or
project group. Treat everything inside it as accessible to members with
control access, including credentials used by agents. This contains access
to the VM; it does not separate teammates inside it.

1. Create a disposable Linux VM. Do not share your personal home directory,
   SSH agent, Docker socket, or host filesystem with it. Run Kolo as a normal
   user without sudo or membership in privileged groups such as `docker`.
2. Install Git, the coding agents you want to offer, and Kolo inside the VM.
   Clone only the intended repositories. Authenticate the agents there with
   credentials limited to those projects; do not copy your personal credential
   stores or cloud administrator keys into the VM.
3. In a checkout, run `kolo up -dir "$PWD" -allow claude`, replacing `claude`
   with an installed agent. Use a trusted network, or add
   `-tls-domain hub.example.com` with DNS and ports 80/443 configured as
   described in `kolo help up`. Network and cloud permissions available to
   the VM are also available to its agents; limit those outside Kolo.
4. Invite only people you trust with that environment. Use
   `kolo invite -id observers -read-only` for people who only need to watch.
   Read-only access still exposes every session's screen and the activity log.
5. Before using valuable data, create a browser session and check that an
   agent can work on the intended checkout. Confirm the VM has no mounts,
   credentials, or network access that would expose your personal machine
   or unrelated services. Recreate the VM when you no longer need it.

A separate OS account reduces accidental access but is not equivalent to a
VM boundary. Containers also need deliberate mount, capability, credential,
and network restrictions; mounting a project read-write lets the container
change that project's files on its host. Neither `-dir` nor `-allow` adds
those restrictions. See Docker's [security](https://docs.docker.com/engine/security/)
and [bind mount](https://docs.docker.com/engine/storage/bind-mounts/) guidance.

If the hub is on a separate machine, keep its organization file and browser
session store there. A host user can read and modify files in their own
account, including Kolo's control files when hub and host share that account.
Do not offer this alpha as a service for mutually untrusted users.

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
