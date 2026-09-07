#!/usr/bin/env bash
set -Eeuo pipefail
# Verify a release tarball does not contain forbidden private paths (OPS-01).
ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "usage: verify-package-whitelist.sh ARCHIVE.tar.gz" >&2; exit 2; }
LIST="$(tar -tzf "$ARCHIVE")"
fail=0
check() {
  local pat="$1"
  if printf "%s" "$LIST" | grep -E "$pat" >/dev/null; then
    echo "FORBIDDEN matched: $pat" >&2
    fail=1
  fi
}
check "(^|/)\.git(/|$)"
check "(^|/)\.env$"
# allow .env.example only; block other .env.* secrets
if printf "%s" "$LIST" | grep -E "(^|/)\.env\." | grep -v "\.env\.example$" >/dev/null; then
  echo "FORBIDDEN matched: .env.* (non-example)" >&2
  fail=1
fi
check "\.sqlite(-wal|-shm)?$"
check "(^|/)node_modules(/|$)"
check "(^|/)server/tests(/|$)"
check "(^|/)backups(/|$)"
check "backup-status\.json"
if [[ "$fail" -ne 0 ]]; then
  echo "WHITELIST_FAIL $ARCHIVE" >&2
  exit 1
fi
echo "WHITELIST_OK $ARCHIVE"
