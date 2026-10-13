#!/usr/bin/env bash
# Deploy a packaged stockgame API release (bundled node_modules; NO npm on the server).
# usage (root on the ECS): deploy-api-release.sh <40-char SHA> <archive sha256>
# Order: checksum → stage → verify native modules load AS stockapi (before touching
# the live tree) → stop → DB backup → swap code → migrate → start → health/SHA verify.
# Failure: restores previous code + api.env; restores the DB backup if migrate failed.
set -Eeuo pipefail
SHA="${1:-}"; EXPECTED_SHA="${2:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ && "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "usage: $0 <sha40> <sha256>" >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
APP_ROOT=${APP_ROOT:-/srv/stock-website}
API_ENV=${API_ENV:-/etc/stockgame/api.env}
PORT=${PORT:-8790}
SVC=${SVC:-stockgame-api}
TS=$(date +%Y%m%d-%H%M%S)
for t in rsync curl python3 sudo node sha256sum; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }; done
log(){ echo "[deploy $(date +%T)] $*"; }
as_api(){ sudo -H -E -u stockapi "$@"; }   # sudoers env_reset: -E keeps STOCKGAME_*, -H sets HOME

ARCHIVE=""
for c in "/tmp/stock-website-api-$SHA.tar.gz" "/home/stockdeploy/incoming/stock-website-api-$SHA.tar.gz" "$APP_ROOT/api-releases/stock-website-api-$SHA.tar.gz"; do
  [[ -f "$c" ]] && ARCHIVE="$c" && break
done
[[ -n "$ARCHIVE" ]] || { echo "archive missing for $SHA" >&2; exit 1; }
ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
[[ "$ACTUAL" == "$EXPECTED_SHA" ]] || { echo "checksum mismatch: $ACTUAL != $EXPECTED_SHA" >&2; exit 1; }
[[ -f "$API_ENV" ]] || { echo "missing $API_ENV" >&2; exit 1; }

set -a; source "$API_ENV"; set +a
DATA_DIR="${STOCKGAME_DATA_DIR:-/var/lib/stockgame}"
DB="${STOCKGAME_DB_PATH:-$DATA_DIR/stockgame.sqlite}"
[[ -f "$DB" ]] || { echo "DB not found at $DB" >&2; exit 1; }
BACKUP_DIR="$DATA_DIR/backups/pre-$SHA-$TS"
PREV=$(grep -E '^APP_GIT_SHA=' "$APP_ROOT/api/release.env" 2>/dev/null | cut -d= -f2 || true)
[[ -n "$PREV" && -d "$APP_ROOT/api" ]] || { echo "no previous release; refusing (no rollback target)" >&2; exit 1; }
log "previous=$PREV new=$SHA db=$DB node=$(node -v)"

# Stage under APP_ROOT (same fs; readable by stockapi), not /tmp
STAGING="$APP_ROOT/api-staging-$SHA"
rm -rf "$STAGING"; mkdir -p "$STAGING"
cleanup_staging(){ rm -rf "$STAGING"; }
tar -xzf "$ARCHIVE" -C "$STAGING" --no-same-owner --no-same-permissions
[[ -d "$STAGING/server/node_modules" && -f "$STAGING/server/.native-bundle.json" ]] || { cleanup_staging; echo "bundle has no prebuilt node_modules (old-style package?) — refusing; no npm on server" >&2; exit 1; }
grep -qx "APP_GIT_SHA=$SHA" "$STAGING/release.env" || { cleanup_staging; echo "release.env SHA mismatch" >&2; exit 1; }
chown -R stockapi:stockapi "$STAGING"; chmod -R a+rX "$STAGING"

# Verify native modules load for the service user BEFORE swapping anything
as_api node "$STAGING/server/deploy/check-native-bundle.mjs" verify "$STAGING/server" \
  || { cleanup_staging; echo "native modules do not load on this host — nothing changed" >&2; exit 1; }

PREV_API="$APP_ROOT/api-prev-$PREV"; PREV_SHARED="$APP_ROOT/shared-prev-$PREV"
rm -rf "$PREV_API" "$PREV_SHARED"
cp -a "$APP_ROOT/api" "$PREV_API"
[[ -d "$APP_ROOT/shared" ]] && cp -a "$APP_ROOT/shared" "$PREV_SHARED"
cp -a "$API_ENV" "$API_ENV.bak.$SHA"

PHASE=prep; CODE_SWAPPED=0; DB_RESTORE=0
restore_db(){
  log "RESTORING DB from $BACKUP_DIR"
  systemctl stop "$SVC" || true
  rm -f "$DB-wal" "$DB-shm"
  cp -a "$BACKUP_DIR/$(basename "$DB")" "$DB"
  for s in -wal -shm; do [[ -f "$BACKUP_DIR/$(basename "$DB")$s" ]] && cp -a "$BACKUP_DIR/$(basename "$DB")$s" "$DB$s"; done
  chown stockapi:stockapi "$DB"* || true
}
rollback(){
  local rc=$?; trap - ERR; set +e
  echo "!!! DEPLOY FAILED phase=$PHASE rc=$rc — rolling back to $PREV" >&2
  systemctl stop "$SVC"
  [[ "$DB_RESTORE" == 1 ]] && restore_db
  if [[ "$CODE_SWAPPED" == 1 ]]; then
    rsync -a --delete "$PREV_API/" "$APP_ROOT/api/"
    [[ -d "$PREV_SHARED" ]] && rsync -a --delete "$PREV_SHARED/" "$APP_ROOT/shared/"
  fi
  cp -a "$API_ENV.bak.$SHA" "$API_ENV"
  systemctl start "$SVC"; sleep 4
  curl -fsS "http://127.0.0.1:$PORT/api/v1/health/ready"; echo
  grep APP_GIT_SHA "$APP_ROOT/api/release.env"
  cleanup_staging
  echo "DEPLOY_API_ROLLED_BACK revision=$PREV failed_phase=$PHASE db_restored=$DB_RESTORE backup=$BACKUP_DIR" >&2
  exit 1
}
trap rollback ERR

mkdir -p "$APP_ROOT/api-releases"
install -o root -g root -m 0644 "$ARCHIVE" "$APP_ROOT/api-releases/stock-website-api-$SHA.tar.gz"
echo "$EXPECTED_SHA  stock-website-api-$SHA.tar.gz" > "$APP_ROOT/api-releases/stock-website-api-$SHA.tar.gz.sha256"

PHASE=stop;   systemctl stop "$SVC"
PHASE=backup; mkdir -p "$BACKUP_DIR"
for f in "$DB" "$DB-wal" "$DB-shm"; do [[ -f "$f" ]] && cp -a "$f" "$BACKUP_DIR/"; done
cmp -s "$DB" "$BACKUP_DIR/$(basename "$DB")"
log "DB backup at $BACKUP_DIR"

PHASE=install; CODE_SWAPPED=1
rsync -a --delete "$STAGING/server/" "$APP_ROOT/api/"          # includes prebuilt node_modules
cp -a "$STAGING/release.env" "$APP_ROOT/api/release.env"
rsync -a --delete "$STAGING/shared/" "$APP_ROOT/shared/"
chown -R stockapi:stockapi "$APP_ROOT/api"; chmod -R a+rX "$APP_ROOT/api" "$APP_ROOT/shared"

# api.env: APP_GIT_SHA must match the release (was stale before); keep PVP bot settings
upsert_env(){ if grep -qE "^$1=" "$API_ENV"; then sed -i -E "s|^$1=.*|$1=$2|" "$API_ENV"; else printf '%s=%s\n' "$1" "$2" >> "$API_ENV"; fi; }
upsert_env APP_GIT_SHA "$SHA"
upsert_env PVP_BOTS_ENABLED 1
upsert_env PVP_MAX_BOT_MATCHES 3
upsert_env PVP_HUMAN_ROOM_RESERVE 2
set -a; source "$API_ENV"; set +a

PHASE=migrate; DB_RESTORE=1
(cd "$APP_ROOT/api" && as_api node src/db/migrate.js)
DB_RESTORE=0

PHASE=start; systemctl start "$SVC"
ok=0; for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/v1/health/ready" >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
[[ $ok == 1 ]]

PHASE=verify
curl -fsS "http://127.0.0.1:$PORT/api/v1/health/live"; echo
curl -fsS "http://127.0.0.1:$PORT/api/v1/health/ready"; echo
test "$(grep -E '^APP_GIT_SHA=' "$APP_ROOT/api/release.env" | cut -d= -f2)" = "$SHA"
test "$(grep -E '^APP_GIT_SHA=' "$API_ENV" | cut -d= -f2)" = "$SHA"
curl -fsS "http://127.0.0.1:$PORT/api/v1/config" | python3 -c 'import sys,json; f=json.load(sys.stdin)["data"]["features"]; assert f.get("pvpBots") is True, f; print("pvpBots on")'
systemctl is-active --quiet "$SVC"
P=$(systemctl show -p MainPID --value "$SVC"); grep -E 'VmRSS|VmHWM' "/proc/$P/status" || true
trap - ERR
cleanup_staging
echo "DEPLOY_API_OK revision=$SHA previous=$PREV db_backup=$BACKUP_DIR"
