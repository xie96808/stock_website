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

Production: __Host-stockgame_session, httpOnly, secure, sameSite=lax, path=/, maxAge = absolute lifetime (default 7d Phase 0); idle sliding within absolute (default 7d). See SESSION_*_DAYS and README-ops-stage6.md §8.

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

## Phase 0 launch hardening

See deploy/README-ops-stage6.md §8: rate limits, absolute session expiry, user tombstones, admin soft-delete/restore. Password min 4 unchanged. Full DB restore remains CLI-only (`db:restore` + `db:replay-tombstones`). Co-deploy API + static when shipping admin UI changes; **API redeploy required**.

## Prebuilt node_modules (S1, memory plan)
The API package now ships `server/node_modules`, so the server **never runs `npm ci`**. On 10-12, running `npm ci` on the 1.6 GB ECS exhausted memory and the box hung.

- **Build target:** the Node version in `/.nvmrc` (prod is Node 22.x, ABI 127; host report says v22.23.2) on glibc ≤ 2.35 (prod is Ubuntu 22.04).
- **Build in CI:** `.github/workflows/api-package.yml` runs on `ubuntu-22.04` with `setup-node` reading `.nvmrc` and uploads the tarball as an artifact. It does not deploy.
- **Build locally:** `bash deploy/package-api-production.sh <sha>` works on any Linux with the same Node major. It refuses another major.
- **Package checks:** `deploy/check-native-bundle.mjs write` loads better-sqlite3 + argon2 and rejects addons needing a glibc newer than `MAX_GLIBC` (default 2.35). It records ABI/glibc in `server/.native-bundle.json`.
- **Deploy:** `deploy/deploy-api-release.sh <sha> <sha256>` (root):
  1. verifies the checksum, stages under `/srv/stock-website/api-staging-<sha>`, and runs `check-native-bundle.mjs verify` **as stockapi** (`sudo -H -E -u stockapi`) **before** stopping anything;
  2. stops the service, backs up the DB, rsyncs the code with node_modules, and upserts `APP_GIT_SHA` in api.env;
  3. runs `node src/db/migrate.js` as stockapi, starts the service, and checks health/ready plus SHA in release.env and api.env;
  4. on failure, rolls back the code and api.env, and restores the DB backup if migrate failed.

  It refuses old-style packages that have no node_modules.
- **Rollback:** `deploy/rollback-api.sh <sha>` verifies the native modules before stopping when the archive is bundled. For old archives it keeps the installed node_modules.
