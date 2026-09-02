#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT=/srv/stock-website
INCOMING_ROOT=/home/stockdeploy/incoming
DOMAIN=stockgame.xieyw.top
KEEP_RELEASES=8

die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 3 ]] || die "usage: deploy-release ARCHIVE REVISION SHA256"
ARCHIVE="$1"; REVISION="$2"; EXPECTED_SHA="$3"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || die "invalid revision"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || die "invalid checksum"
[[ "$ARCHIVE" == "$INCOMING_ROOT/stock-website-$REVISION.tar.gz" ]] || die "archive path is outside incoming area"
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || die "archive is missing"

exec 9>"$APP_ROOT/deploy.lock"
flock -n 9 || die "another deployment is running"

ACTUAL_SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || die "checksum mismatch"

RELEASES="$APP_ROOT/releases"
TARGET="$RELEASES/$REVISION"
TEMP="$TARGET.tmp"
PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
mkdir -p "$RELEASES" "$APP_ROOT/backups"

if [[ "$PREVIOUS" == "$TARGET" ]] && [[ -f "$TARGET/version.json" ]] && \
   grep -q "\"revision\":\"$REVISION\"" "$TARGET/version.json"; then
  rm -f "$ARCHIVE"
  printf 'DEPLOY_ALREADY_CURRENT revision=%s\n' "$REVISION"
  exit 0
fi
[[ "$PREVIOUS" == "$TARGET" ]] || rm -rf "$TARGET"

rollback() {
  local status=$?
  trap - ERR
  printf 'deploy failed (status %s); rolling back\n' "$status" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.rollback"
    mv -Tf "$APP_ROOT/current.rollback" "$APP_ROOT/current"
    nginx -t && systemctl reload nginx || true
  fi
  rm -rf "$TEMP"
  rm -f "$APP_ROOT/incoming-$REVISION.tar.gz"
  exit "$status"
}
trap rollback ERR

rm -rf "$TEMP"
mkdir -p "$TEMP"
ROOT_ARCHIVE="$APP_ROOT/incoming-$REVISION.tar.gz"
install -o root -g root -m 0600 "$ARCHIVE" "$ROOT_ARCHIVE"
[[ "$(sha256sum "$ROOT_ARCHIVE" | awk '{print $1}')" == "$EXPECTED_SHA" ]] || die "copied archive checksum mismatch"
python3 - "$ROOT_ARCHIVE" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
with tarfile.open(archive, "r:gz") as bundle:
    for member in bundle.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"unsafe archive path: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported archive member: {member.name}")
PY
tar -xzf "$ROOT_ARCHIVE" -C "$TEMP" --no-same-owner --no-same-permissions
rm -f "$ROOT_ARCHIVE"
[[ -f "$TEMP/index.html" ]] || die "index.html missing"
[[ -f "$TEMP/version.json" ]] || die "version.json missing"
[[ -f "$TEMP/release.env" ]] || die "release metadata missing"
grep -qx "APP_GIT_SHA=$REVISION" "$TEMP/release.env" || die "release revision mismatch"
grep -q "\"revision\":\"$REVISION\"" "$TEMP/version.json" || die "version.json revision mismatch"

chown -R root:root "$TEMP"
chmod -R a+rX "$TEMP"

mv "$TEMP" "$TARGET"
ln -sfn "$TARGET" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
nginx -t
systemctl reload nginx

verify_local() {
  local url="$1"
  curl -fsS --max-time 5 --resolve "$DOMAIN:80:127.0.0.1" "$url" | grep -q "\"revision\":\"$REVISION\""
}
if ! verify_local "http://$DOMAIN/version.json"; then
  curl -fsSk --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/version.json" | grep -q "\"revision\":\"$REVISION\""
fi

trap - ERR
rm -f "$ARCHIVE" "$ROOT_ARCHIVE"
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -path "$TARGET" -printf '%T@ %p\n' \
  | sort -rn | tail -n "+$KEEP_RELEASES" | cut -d' ' -f2- | xargs -r rm -rf
printf 'DEPLOY_OK revision=%s previous=%s\n' "$REVISION" "${PREVIOUS:-none}"
