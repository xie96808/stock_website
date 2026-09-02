#!/usr/bin/env bash
set -Eeuo pipefail
APP_ROOT=/srv/stock-website
REVISION="${1:-}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: rollback-release REVISION" >&2; exit 2; }
TARGET="$APP_ROOT/releases/$REVISION"
[[ -d "$TARGET" ]] || { echo "release not found: $TARGET" >&2; exit 1; }
exec 9>"$APP_ROOT/deploy.lock"; flock -n 9
PREVIOUS="$(readlink -f "$APP_ROOT/current")"
ln -sfn "$TARGET" "$APP_ROOT/current.next"; mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
if nginx -t && systemctl reload nginx; then
  echo "ROLLBACK_OK revision=$REVISION"
else
  ln -sfn "$PREVIOUS" "$APP_ROOT/current.next"; mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
  nginx -t && systemctl reload nginx || true
  exit 1
fi
