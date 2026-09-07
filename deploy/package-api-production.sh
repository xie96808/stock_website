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

mkdir -p "$STAGING/bundle/server" "$STAGING/bundle/shared" "$OUTPUT_DIR"

[[ -d server && -f server/package.json && -d shared ]] || { echo "missing server/ or shared/" >&2; exit 1; }

tar -C server --exclude=node_modules --exclude=data --exclude=tests --exclude=.env -cf - . | tar -C "$STAGING/bundle/server" -xf -
find "$STAGING/bundle/server" -maxdepth 1 -type f -name '.env.*' ! -name '.env.example' -delete
[[ -f server/.env.example ]] && cp -a server/.env.example "$STAGING/bundle/server/.env.example"
tar -C shared -cf - . | tar -C "$STAGING/bundle/shared" -xf -
find "$STAGING/bundle" -name .DS_Store -delete

cat > "$STAGING/bundle/release.env" <<EOF
APP_GIT_SHA=$REVISION
APP_BUILD_TIME=$BUILD_TIME
APP_COMPONENT=api
EOF

ARCHIVE="$OUTPUT_DIR/stock-website-api-$REVISION.tar.gz"
COPYFILE_DISABLE=1 tar -C "$STAGING/bundle" -czf "$ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
else
  shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
fi
tar -tzf "$ARCHIVE" >/dev/null
printf '%s\n' "$ARCHIVE"
