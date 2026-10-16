# Publishing Kolo

## Alpha installation

The README pins the named alpha so installations and bug reports refer to
the same build:

```sh
curl -fsSL https://raw.githubusercontent.com/komovaar/kolo/main/install | KOLO_VERSION=v0.1.0 sh
```

`KOLO_VERSION` must be set on `sh`, which runs the installer, rather than on
`curl`. Set `KOLO_VERSION=nightly` explicitly for the rolling development
build. The installer never silently switches from a version release to a
nightly. Without a version it looks for GitHub's latest non-prerelease;
when none exists, it explains how to select the alpha explicitly.

## Checks before publishing

Version releases resolve the selected tag to a commit before invoking the
reusable CI workflow. Nightlies resolve `main` once and skip publishing if
the existing nightly already covers it. Both run the full Linux/macOS matrix,
including workflow validation, the vulnerability scan, reproducible UI build,
installer tests, Go race tests, and Chromium/Firefox browser checks on Linux.
Packaging depends on that workflow succeeding and checks out the exact commit it tested.
Only the publishing jobs receive repository write permission.
CI also runs on branch pushes, so a candidate commit can pass the required
checks before it is fast-forwarded to `main`.

To publish a version, push a tag such as `v0.1.0`, or dispatch the
release workflow with an existing version tag. Tags containing a prerelease
suffix are marked as GitHub prereleases. The initial `v0.1.0` release is
also marked as a prerelease because it is the public alpha. Release notes
select that exact version, so their install command also works for prereleases. Version tags
must still point to the checked commit when publishing; moving one fails the
job. The rolling `nightly` tag deliberately advances to its checked commit.

Before announcing an alpha, install its archive into an empty directory and
invite another person from a second machine to use a real supported agent.
Check restart/resume and read-only access with the agent versions you intend
to support. Browser automation uses a real shell, so it does not replace this
agent-specific check. Use the [isolated alpha setup](../SECURITY.md#alpha-isolation-setup).
Record versions and results in [alpha validation](alpha-validation.md).
That page also describes the opt-in real-Codex browser check.

## Go toolchain and vulnerability checks

CI, version releases, and nightlies select the exact Go version from the
checked-out commit's `go.mod` and set `GOTOOLCHAIN=local` so Go cannot silently
switch compilers. Each job prints its compiler version.

Each workflow runs the pinned scanner
`golang.org/x/vuln/cmd/govulncheck@v1.8.0` before building. Reachable
vulnerabilities fail the job and block publishing. Verbose output also retains
advisories in dependencies whose vulnerable code is not reached for review.

Before publishing, keep the declared compiler on a patched version and run
the contributor checks with it. Use the same pinned scanner locally:

```sh
go version
GOTOOLCHAIN=local go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -show verbose ./...
```

Packaging disables CGO for Linux and macOS, on amd64 and arm64. After extracting
an archive, confirm its compiler with `go version -m /path/to/kolo`.
An already published binary is not patched by changing `go.mod`; publish a new
patch release for affected binaries.
