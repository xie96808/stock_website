#!/usr/bin/env bash
set -Eeuo pipefail
# Roll back API from a kept tarball. usage: rollback-api.sh REVISION
APP_ROOT=/srv/stock-website
REVISION="${1:-}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: rollback-api.sh REVISION" >&2; exit 2; }
ARCHIVE=""
for cand in "$APP_ROOT/api-releases/stock-website-api-$REVISION.tar.gz" "/home/stockdeploy/incoming/stock-website-api-$REVISION.tar.gz"; do
  if [[ -f "$cand" ]]; then ARCHIVE="$cand"; break; fi
done
[[ -n "$ARCHIVE" ]] || { echo "api archive not found for $REVISION" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
STAGING="$(mktemp -d)"
trap "rm -rf \"$STAGING\"" EXIT
tar -xzf "$ARCHIVE" -C "$STAGING" --no-same-owner --no-same-permissions
[[ -d "$STAGING/server" && -d "$STAGING/shared" ]] || { echo "bundle missing server/ or shared/" >&2; exit 1; }
systemctl stop stockgame-api || true
rsync -a --delete "$STAGING/server/" "$APP_ROOT/api/"
rsync -a --delete "$STAGING/shared/" "$APP_ROOT/shared/"
chown -R root:root "$APP_ROOT/api" "$APP_ROOT/shared"
chmod -R a+rX "$APP_ROOT/api" "$APP_ROOT/shared"
cd "$APP_ROOT/api"
# install prod deps as stockapi if lockfile present
systemctl start stockgame-api
echo "ROLLBACK_API_OK revision=$REVISION"
