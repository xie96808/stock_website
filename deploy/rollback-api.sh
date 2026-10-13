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
# Bundled releases carry node_modules; verify they load BEFORE stopping. Old-style
# archives (no node_modules) keep the currently installed node_modules.
EXCL=()
if [[ -f "$STAGING/server/.native-bundle.json" ]]; then
  chmod -R a+rX "$STAGING"
  sudo -H -E -u stockapi node "$STAGING/server/deploy/check-native-bundle.mjs" verify "$STAGING/server" || { echo "native modules fail to load; aborting rollback" >&2; exit 1; }
else
  EXCL=(--exclude node_modules)
fi
systemctl stop stockgame-api || true
rsync -a --delete "${EXCL[@]}" "$STAGING/server/" "$APP_ROOT/api/"
rsync -a --delete "$STAGING/shared/" "$APP_ROOT/shared/"
cp -a "$STAGING/release.env" "$APP_ROOT/api/release.env" 2>/dev/null || true
chown -R stockapi:stockapi "$APP_ROOT/api"
chmod -R a+rX "$APP_ROOT/api" "$APP_ROOT/shared"
cd "$APP_ROOT/api"
[[ -f /etc/stockgame/api.env ]] && sed -i -E "s|^APP_GIT_SHA=.*|APP_GIT_SHA=$REVISION|" /etc/stockgame/api.env
systemctl start stockgame-api
echo "ROLLBACK_API_OK revision=$REVISION"
