# Publishing Kolo

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
