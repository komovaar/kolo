#!/usr/bin/env bash
# Resolve a version tag once, so checks and packaging use the same commit.
set -euo pipefail

tag=${1:?usage: release-ref.sh <version-tag>}
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo "Expected a version tag such as v0.2.0 or v0.2.0-alpha.1" >&2
  exit 1
fi
git check-ref-format "refs/tags/$tag"
sha=$(git rev-parse --verify "refs/tags/$tag^{commit}")

version=${tag%%+*}
prerelease=false
case "$version" in
  *-*) prerelease=true ;;
esac

printf 'tag=%s\nsha=%s\nprerelease=%s\n' "$tag" "$sha" "$prerelease"
