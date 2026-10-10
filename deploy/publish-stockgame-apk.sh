#!/usr/bin/env bash
# Install as /usr/local/sbin/publish-stockgame-apk (root:root 0755).
# Called by .github/workflows/android-release.yml via sudo:
#   publish-stockgame-apk INCOMING_APK VERSION SHA256 INCOMING_JSON
set -Eeuo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

INCOMING_ROOT=/home/stockdeploy/incoming
DOWNLOADS=/srv/stock-website/downloads
LOCK=/srv/stock-website/apk-publish.lock
HOST=stockgame.xieyw.top
KEEP_APKS=5

die() { printf 'publish-apk: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 4 ]] || die "usage: publish-stockgame-apk INCOMING_APK VERSION SHA256 INCOMING_JSON"
APK="$1"; VER="$2"; EXPECTED_SHA="$3"; JSON="$4"

[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || die "invalid checksum"
[[ "$APK" == "$INCOMING_ROOT/stockgame-$VER.apk" ]] || die "apk path is outside incoming area"
[[ "$JSON" == "$INCOMING_ROOT/app-version-$VER.json" ]] || die "json path is outside incoming area"
[[ -f "$APK" && ! -L "$APK" ]] || die "apk is missing or a symlink"
[[ -f "$JSON" && ! -L "$JSON" ]] || die "json is missing or a symlink"
[[ -d "$DOWNLOADS" && ! -L "$DOWNLOADS" ]] || die "downloads dir missing: install -d -m 0755 $DOWNLOADS"

exec 9>"$LOCK"
flock -n 9 || die "another publish is running"

TMPDIR_PUB="$(mktemp -d "$DOWNLOADS/.publish.XXXXXX")"
cleanup() { rm -rf "$TMPDIR_PUB"; }
trap cleanup EXIT

# Copy first (as root, into a root-owned dir), then validate the copies so the
# incoming files cannot be swapped between check and use.
install -o root -g root -m 0644 "$APK" "$TMPDIR_PUB/apk"
install -o root -g root -m 0644 "$JSON" "$TMPDIR_PUB/json"

ACTUAL_SHA="$(sha256sum "$TMPDIR_PUB/apk" | awk '{print $1}')"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || die "apk checksum mismatch"
SIZE="$(stat -c %s "$TMPDIR_PUB/apk")"
(( SIZE > 0 && SIZE <= 200*1024*1024 )) || die "apk size out of range"
# APK = zip: "PK\x03\x04"
[[ "$(head -c 4 "$TMPDIR_PUB/apk" | od -An -tx1 | tr -d ' \n')" == "504b0304" ]] || die "not an apk/zip"

python3 - "$TMPDIR_PUB/json" "$VER" "$EXPECTED_SHA" "$SIZE" "$HOST" "$TMPDIR_PUB/app-version.json" <<'PY' || die "manifest validation failed"
import json, re, sys
src, ver, sha, size, host, out = sys.argv[1:]
with open(src, encoding="utf-8") as f:
    raw = f.read()
if len(raw) > 64 * 1024:
    sys.exit("manifest too large")
d = json.loads(raw)
def need(cond, msg):
    if not cond:
        sys.exit(msg)
need(isinstance(d, dict), "not an object")
need(d.get("versionName") == ver, "versionName mismatch")
need(d.get("sha256") == sha, "sha256 mismatch")
need(type(d.get("versionCode")) is int and d["versionCode"] > 0, "bad versionCode")
need(type(d.get("size")) is int and d["size"] == int(size), "size mismatch")
mn = d.get("minSupportedVersionCode", 1)
need(type(mn) is int and 0 <= mn <= d["versionCode"], "bad minSupportedVersionCode")
need(d.get("apkUrl") == f"https://{host}/download/stockgame-{ver}.apk", "apkUrl mismatch")
need(isinstance(d.get("notes", ""), str), "bad notes")
need(isinstance(d.get("publishedAt", ""), str), "bad publishedAt")
clean = {k: d[k] for k in ("versionCode", "versionName", "apkUrl", "sha256", "size",
                           "minSupportedVersionCode", "notes", "publishedAt") if k in d}
with open(out, "w", encoding="utf-8") as f:
    json.dump(clean, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY

FINAL_APK="$DOWNLOADS/stockgame-$VER.apk"
if [[ -e "$FINAL_APK" || -L "$FINAL_APK" ]]; then
  [[ -f "$FINAL_APK" && ! -L "$FINAL_APK" ]] || die "$FINAL_APK exists and is not a regular file"
  [[ "$(sha256sum "$FINAL_APK" | awk '{print $1}')" == "$EXPECTED_SHA" ]] \
    || die "$FINAL_APK already exists with different content (bump the version)"
else
  mv -T "$TMPDIR_PUB/apk" "$DOWNLOADS/.stockgame-$VER.apk.tmp"
  mv -T "$DOWNLOADS/.stockgame-$VER.apk.tmp" "$FINAL_APK"
fi
chown root:root "$FINAL_APK"; chmod 0644 "$FINAL_APK"

# Manifest: atomic replace.
chmod 0644 "$TMPDIR_PUB/app-version.json"
mv -T "$TMPDIR_PUB/app-version.json" "$DOWNLOADS/.app-version.json.tmp"
mv -T "$DOWNLOADS/.app-version.json.tmp" "$DOWNLOADS/app-version.json"

# Stable link: atomic repoint.
ln -sfn "stockgame-$VER.apk" "$DOWNLOADS/.stockgame.apk.tmp"
mv -T "$DOWNLOADS/.stockgame.apk.tmp" "$DOWNLOADS/stockgame.apk"

# Keep the newest KEEP_APKS versioned APKs (never the one just published).
find "$DOWNLOADS" -maxdepth 1 -type f -regextype posix-extended \
  -regex '.*/stockgame-[0-9]+\.[0-9]+\.[0-9]+\.apk' -printf '%f\n' \
  | sed -E 's/^stockgame-(.*)\.apk$/\1/' | sort -t. -k1,1nr -k2,2nr -k3,3nr \
  | tail -n "+$((KEEP_APKS + 1))" \
  | while read -r old; do
      [[ "$old" == "$VER" ]] && continue
      rm -f -- "$DOWNLOADS/stockgame-$old.apk"
    done

rm -f -- "$APK" "$JSON"
printf 'PUBLISH_OK version=%s sha256=%s size=%s\n' "$VER" "$EXPECTED_SHA" "$SIZE"
