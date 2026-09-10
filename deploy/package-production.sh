#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REVISION="${1:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "revision must be a 40-char git SHA" >&2; exit 2; }
BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/release/production}"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$STAGING/release" "$OUTPUT_DIR"
for path in index.html favicon.ico favicon.png css js data images shared admin; do
  [[ -e "$path" ]] || { echo "missing $path" >&2; exit 1; }
  cp -a "$path" "$STAGING/release/"
done
find "$STAGING/release" -name .DS_Store -delete

# Cache-bust local js/css references with ?v=<short-sha> (release tree only).
if command -v node >/dev/null 2>&1; then
  node "$ROOT_DIR/deploy/stamp-asset-revision.mjs" "$STAGING/release" "$REVISION"
else
  echo "node required for stamp-asset-revision.mjs" >&2
  exit 1
fi

cat > "$STAGING/release/version.json" <<VEOF
{"revision":"$REVISION","builtAt":"$BUILD_TIME"}
VEOF
cat > "$STAGING/release/release.env" <<EEOF
APP_GIT_SHA=$REVISION
APP_BUILD_TIME=$BUILD_TIME
EEOF

# Precompress for nginx gzip_static + brotli_static (.gz + .br).
# Includes data/stocks_data.json (~55MB); brotli q5 for large files.
# Requires Node zlib (no system brotli package needed on CI/VPS pack host).
node "$ROOT_DIR/deploy/precompress-assets.mjs" "$STAGING/release"

ARCHIVE="$OUTPUT_DIR/stock-website-$REVISION.tar.gz"
COPYFILE_DISABLE=1 tar -C "$STAGING/release" -czf "$ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
else
  shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
fi
tar -tzf "$ARCHIVE" >/dev/null
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$SCRIPT_DIR/verify-package-whitelist.sh" ]]; then
  "$SCRIPT_DIR/verify-package-whitelist.sh" "$ARCHIVE"
fi
printf '%s\n' "$ARCHIVE"
