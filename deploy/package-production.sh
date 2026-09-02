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
for path in index.html css js data images; do
  [[ -e "$path" ]] || { echo "missing $path" >&2; exit 1; }
  cp -a "$path" "$STAGING/release/"
done
find "$STAGING/release" -name .DS_Store -delete

# Precompress text assets for nginx gzip_static (11MB JS -> ~2.5MB).
while IFS= read -r -d '' f; do
  gzip -9 -n -c "$f" > "$f.gz"
done < <(find "$STAGING/release" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' \) ! -name '*.gz' -print0)

cat > "$STAGING/release/version.json" <<EOF
{"revision":"$REVISION","builtAt":"$BUILD_TIME"}
EOF
cat > "$STAGING/release/release.env" <<EOF
APP_GIT_SHA=$REVISION
APP_BUILD_TIME=$BUILD_TIME
EOF
# version.json was written after the gzip pass
gzip -9 -n -c "$STAGING/release/version.json" > "$STAGING/release/version.json.gz"

ARCHIVE="$OUTPUT_DIR/stock-website-$REVISION.tar.gz"
COPYFILE_DISABLE=1 tar -C "$STAGING/release" -czf "$ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
else
  shasum -a 256 "$ARCHIVE" | awk '{print $1}' > "$ARCHIVE.sha256"
fi
tar -tzf "$ARCHIVE" >/dev/null
printf '%s\n' "$ARCHIVE"
