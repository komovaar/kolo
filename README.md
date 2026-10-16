<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-dark.png">
    <img src="brand/logo-light.png" width="330" alt="">
  </picture>
</p>

<h3 align="center">Kolo</h3>

<p align="center">
  Multiplayer AI coding agents.<br>
  One machine runs them. Everybody else opens a link.
</p>

<p align="center">
  <a href="https://github.com/komovaar/kolo/actions/workflows/ci.yml"><img src="https://github.com/komovaar/kolo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/komovaar/kolo/releases"><img src="https://img.shields.io/github/v/release/komovaar/kolo?include_prereleases&color=2C6F62&labelColor=1C2123" alt="Releases, including prereleases"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-2C6F62?labelColor=1C2123" alt="AGPL-3.0"></a>
</p>

<br>

## Install

Experimental alpha for trusted teams. On the machine you are lending, the
only one that installs anything, install the fixed alpha build:

```sh
curl -fsSL https://raw.githubusercontent.com/komovaar/kolo/main/install | KOLO_VERSION=v0.2.0-alpha.1 sh
```

Linux and macOS, on amd64 and arm64. Windows hosts need WSL2.
For rolling development builds, replace `v0.2.0-alpha.1` with `nightly`.
Other tagged builds are listed in [releases](https://github.com/komovaar/kolo/releases). Omitting `KOLO_VERSION`
selects the latest non-prerelease release, when one is available.

Agents have the host user's account permissions. Start in a dedicated VM with
only the projects and credentials you intend to share; see the
[alpha isolation setup](SECURITY.md#alpha-isolation-setup).

## Run

```
$ kolo up

api is up at http://192.168.0.12:7300
Lending /home/alex/work/api · claude opencode · 3 members

Invite  http://192.168.0.12:7300/join#kolo_yPNNK8ZnHdvgKFDiQV2Oc…
        10 uses left, until Mon 31 Aug 20:34
```

Send the link. Whoever opens it picks a name and is in. Nothing to install,
no token to paste.

**One screen, everybody on it.** Watch an agent work, type at it, take over
mid-sentence. Whoever typed last drives, and everyone sees who.

**Hosts dial out.** A machine running `kolo host` needs no inbound port or
tunnel. The hub still has to accept browser and host connections; `kolo up`
runs that hub on the same machine and listens on the address it prints.

**Anything that draws a terminal.** Claude Code, Codex CLI, and opencode out of the box,
and one small file describes another. See [tested versions and limits](docs/alpha-validation.md).

## Early

Kolo is an experimental alpha, so expect rough edges. It reads what an agent
is doing off that agent's own screen, so a CLI that changes its wording quietly
breaks the status line. `kolo doctor` says when that has happened.

The hub runs code on the host by design. Read [SECURITY.md](SECURITY.md)
before pointing kolo at anything you care about.

## Docs

`kolo help` is the manual. Beyond it:
[reference](docs/reference.md) · [security](SECURITY.md) · [contributing](CONTRIBUTING.md)

## License

[AGPL-3.0](LICENSE)
