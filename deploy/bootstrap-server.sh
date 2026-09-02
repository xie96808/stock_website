#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT=/srv/stock-website
NGINX_SITE=/etc/nginx/sites-available/xietest.cc.cd
NGINX_LINK=/etc/nginx/sites-enabled/xietest.cc.cd

id stockdeploy >/dev/null 2>&1 || { echo "stockdeploy user missing; bootstrap yanpan first" >&2; exit 1; }

install -d -o root -g root -m 0755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/backups"
install -d -o stockdeploy -g stockdeploy -m 0700 /home/stockdeploy/.ssh /home/stockdeploy/incoming

install -o root -g root -m 0755 "$SCRIPT_DIR/deploy-release.sh" /usr/local/sbin/deploy-stock-website-release
install -o root -g root -m 0755 "$SCRIPT_DIR/rollback-release.sh" /usr/local/sbin/rollback-stock-website-release
install -o root -g root -m 0440 "$SCRIPT_DIR/stockdeploy-stock-website.sudoers" /etc/sudoers.d/stockdeploy-stock-website
visudo -cf /etc/sudoers.d/stockdeploy-stock-website

install -o root -g root -m 0644 "$SCRIPT_DIR/nginx-xietest.cc.cd.conf" "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_LINK"

if [[ ! -e "$APP_ROOT/current" ]]; then
  PLACEHOLDER="$APP_ROOT/releases/placeholder"
  mkdir -p "$PLACEHOLDER"
  printf '%s\n' '{"revision":"placeholder","builtAt":"bootstrap"}' > "$PLACEHOLDER/version.json"
  printf '%s\n' '<!doctype html><title>stock_website</title><p>awaiting first release</p>' > "$PLACEHOLDER/index.html"
  ln -sfn "$PLACEHOLDER" "$APP_ROOT/current"
fi

nginx -t
systemctl reload nginx
printf 'BOOTSTRAP_OK app_root=%s\n' "$APP_ROOT"
