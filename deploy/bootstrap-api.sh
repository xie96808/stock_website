#!/usr/bin/env bash
# Run as root on the production host after copying deploy artifacts.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

API_SRC="${1:-}"
[[ -n "$API_SRC" && -d "$API_SRC/server" && -d "$API_SRC/shared" ]] || {
  echo "usage: bootstrap-api.sh /path/to/unpacked-api-bundle" >&2
  exit 2
}

id stockapi >/dev/null 2>&1 || useradd --system --home /var/lib/stockgame --shell /usr/sbin/nologin stockapi
install -d -o root -g stockapi -m 0750 /etc/stockgame
install -d -o stockapi -g stockapi -m 0750 /var/lib/stockgame
install -d -o root -g root -m 0755 /srv/stock-website/api /srv/stock-website/shared

if [[ ! -f /etc/stockgame/api.env ]]; then
  install -o root -g stockapi -m 0640 "$SCRIPT_DIR/api.env.example" /etc/stockgame/api.env
  echo "EDIT /etc/stockgame/api.env before starting (CSRF_SECRET, PORT)" >&2
fi

rsync -a --delete "$API_SRC/server/" /srv/stock-website/api/
rsync -a --delete "$API_SRC/shared/" /srv/stock-website/shared/
chown -R root:root /srv/stock-website/api /srv/stock-website/shared
chmod -R a+rX /srv/stock-website/api /srv/stock-website/shared

cd /srv/stock-website/api
sudo -u stockapi npm ci --omit=dev
set -a
# shellcheck disable=SC1091
source /etc/stockgame/api.env
set +a
sudo -u stockapi -E npm run migrate

install -o root -g root -m 0644 "$SCRIPT_DIR/stockgame-api.service" /etc/systemd/system/stockgame-api.service
systemctl daemon-reload
systemctl enable stockgame-api
systemctl restart stockgame-api
systemctl --no-pager --full status stockgame-api || true

echo "Merge $SCRIPT_DIR/nginx-api-proxy.snippet.conf into the HTTPS server, then: nginx -t && systemctl reload nginx"
echo "BOOTSTRAP_API_OK"
