# Stockgame production API

See sibling files in deploy/ for nginx, systemd unit, env example, and packaging.

Keep static root at /srv/stock-website/current. Put API at /srv/stock-website/api with shared sibling. Data under /var/lib/stockgame. Env at /etc/stockgame/api.env.

Port 8787 is canonical; on Aliyun host it may conflict with another Node app - use 8790 then.

CI remains static-only; first API rollout is manual. HTTPS nginx is Certbot-managed - merge nginx-api-proxy.snippet.conf into the 443 server only.

## Layout

- current/: static only (existing package-production.sh)
- api/: server package (WorkingDirectory for stockgame-api.service)
- shared/: sibling of api/ so ../../../shared imports resolve
- /var/lib/stockgame: STOCKGAME_DATA_DIR
- /etc/stockgame/api.env: from api.env.example (do not commit secrets)

## Ops checklist

1. Ensure dedicated runtime account and dirs listed above exist
2. Install api.env from api.env.example; set CSRF_SECRET, ORIGIN_ALLOWLIST, PORT, STOCKGAME_DATASET_PATH
3. Unpack API tarball from package-api-production.sh into api/ and shared/
4. Install production Node deps in api/ and run migrate with env loaded
5. Install stockgame-api.service and start the unit
6. Merge nginx-api-proxy.snippet.conf into live HTTPS server before location /; validate config; reload

Runtime user: stockapi preferred. stockdeploy sudo today cannot edit nginx or add accounts.

## Session cookies

Production: __Host-stockgame_session, httpOnly, secure, sameSite=lax, path=/, 30d maxAge; idle 7d server-side. Matches server/src/lib/config.js and sessions.js.

Exact root install helper: deploy/bootstrap-api.sh (pass path to unpacked API bundle).


## Stage 5 minimal admin (non-public)

- Default: admin API is **off** (`ADMIN_ENABLED` unset). Public players never see an admin entry.
- To enable on VPS: set `ADMIN_ENABLED=1` in `/etc/stockgame/api.env`, optionally `ADMIN_IP_ALLOWLIST`, restart `stockgame-api`.
- Prefer nginx `allow`/`deny` (or VPN) for `/admin/` and `/api/v1/admin/` before enabling.
- Static shell ships at `/admin/` (override folder name via `ADMIN_UI_PATH` is documented for future; current package path is `admin/`).
- Promote an operator: on the API host with env loaded, `cd /srv/stock-website/api && node scripts/admin-promote.mjs <username>`.
- Writes require password reauth (`POST /api/v1/admin/reauth`, 15 minutes).

## Stage 6 ops

See deploy/README-ops-stage6.md for backup, restore-check, packaging whitelist, rollback, and ops env switches. Admin remains non-public.
