#!/usr/bin/env bash
# Install as /usr/local/sbin/rollback-stockgame-apk (root:root 0755).
#   rollback-stockgame-apk VERSION VERSION_CODE [MIN_SUPPORTED_VERSION_CODE]
# Repoints stockgame.apk to an already-published stockgame-VERSION.apk and
# rewrites app-version.json for it.
# NOTE: Android refuses downgrades. Rolling back only stops *new* updates to the
# bad build; devices that already installed it stay on it. To actually fix them,
# ship a new higher versionCode instead.
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

DOWNLOADS=/srv/stock-website/downloads
LOCK=/srv/stock-website/apk-publish.lock
HOST=stockgame.xieyw.top

die() { printf 'rollback-apk: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 2 || $# -eq 3 ]] || die "usage: rollback-stockgame-apk VERSION VERSION_CODE [MIN_SUPPORTED_VERSION_CODE]"
VER="$1"; CODE="$2"; MIN="${3:-1}"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version"
[[ "$CODE" =~ ^[1-9][0-9]{0,8}$ ]] || die "invalid versionCode"
[[ "$MIN" =~ ^[0-9]{1,9}$ ]] && (( MIN <= CODE )) || die "invalid minSupportedVersionCode"
APK="$DOWNLOADS/stockgame-$VER.apk"
[[ -f "$APK" && ! -L "$APK" ]] || die "$APK not found (available: $(cd "$DOWNLOADS" && ls stockgame-*.apk 2>/dev/null | tr '\n' ' '))"

exec 9>"$LOCK"
flock -n 9 || die "another publish is running"

SHA="$(sha256sum "$APK" | awk '{print $1}')"
SIZE="$(stat -c %s "$APK")"
TMP="$DOWNLOADS/.app-version.json.tmp"
python3 - "$TMP" "$CODE" "$VER" "$SHA" "$SIZE" "$MIN" "$HOST" <<'PY'
import datetime, json, sys
out, code, ver, sha, size, mn, host = sys.argv[1:]
doc = {
    "versionCode": int(code), "versionName": ver,
    "apkUrl": f"https://{host}/download/stockgame-{ver}.apk",
    "sha256": sha, "size": int(size), "minSupportedVersionCode": int(mn),
    "notes": f"回滚到 {ver}",
    "publishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
chmod 0644 "$TMP"
mv -T "$TMP" "$DOWNLOADS/app-version.json"
ln -sfn "stockgame-$VER.apk" "$DOWNLOADS/.stockgame.apk.tmp"
mv -T "$DOWNLOADS/.stockgame.apk.tmp" "$DOWNLOADS/stockgame.apk"
printf 'ROLLBACK_OK version=%s versionCode=%s sha256=%s\n' "$VER" "$CODE" "$SHA"
