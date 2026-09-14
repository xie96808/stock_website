# R1 — Immutable static assets

Status: Wave A · R1 (architecture restart handoff).

## What changed

Production packaging no longer relies on `?v=<git-sha>` query busting for js/css.
`deploy/fingerprint-assets.mjs` (called from `package-production.sh`) renames assets to
`name.<10-hex>.ext` based on a **dependency-aware content hash**, then rewrites HTML / ESM
`import` / `new URL(..., import.meta.url)` / CSS `@import` to the hashed paths.

- `index.html`, `version.json`, and `data/pack-meta.json` stay **no-store** / unhashed entry points.
- Release tree prefers **hashed filenames only** for fingerprinted assets (unhashed sources remain for local dev).
- `deploy/precompress-assets.mjs` still walks the tree, so `.gz` / `.br` are produced for hashed names.
- `deploy/stamp-asset-revision.mjs` is **deprecated** for packaging (kept for emergency `?v=` on an unfingerprinted tree).

## nginx (repo + server 29)

Repo conf: `deploy/nginx-stockgame.xieyw.top.conf`

- Fingerprinted js/css/images: `Cache-Control: public, max-age=31536000, immutable`
- Unhashed static leftovers: 7d `must-revalidate`
- `index.html` / `version.json` / `pack-meta.json`: `no-store`

**Server 29 does not auto-apply nginx conf from the static tarball.** After merge, merge the
new location blocks into the live Certbot 443 server and `nginx -t && systemctl reload nginx`.
Until then, hashed files still download but may only get the generic 7d header.

## QA

1. Package: `OUTPUT_DIR=/tmp/sw-rel bash deploy/package-production.sh "$(git rev-parse HEAD)"`
2. Confirm `index.html` references `js/*.*.js` / `css/*.*.css` (no `?v=` needed).
3. Deploy static → DevTools Network: hashed js/css show `immutable` (after nginx reload on 29).
