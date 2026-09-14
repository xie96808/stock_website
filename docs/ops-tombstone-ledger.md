# Ops: external user tombstone ledger (R2)

## Why

Main SQLite is online-backed up and can be restored via CLI. Soft-deleted users used to leave tombstones **only** inside that same DB. Restoring an older backup could:

1. resurrect soft-deleted accounts, and
2. drop tombstone rows written after the backup.

## Design

| Store | Role |
| --- | --- |
| `user_tombstones` (SQLite) | Dual-write for live queries; may lag after restore |
| `STOCKGAME_DATA_DIR/user-tombstones.jsonl` | **Source of truth for post-restore replay** — not replaced by `db:restore` |

Override path: `STOCKGAME_TOMBSTONE_LEDGER_PATH`.

JSONL events (append-only):

- `{"v":1,"op":"add","user_id":…,"username_normalized":…,"source":"self"|"admin",…}`
- `{"v":1,"op":"reverse","user_id":…,"reversed_at":…}`

On first use, if the ledger file is missing/empty, active in-DB rows are seeded into the file.

## Restore procedure (server 29)

1. Stop `stockgame-api`.
2. `STOCKGAME_ALLOW_RESTORE=1 npm run db:restore -- --backup <path>`  
   → copies SQLite, then **auto-replays** from the external ledger.
3. Optionally revoke all sessions / rotate cookies as before.
4. Start API.

Manual / dry-run:

```bash
npm run db:replay-tombstones -- --dry-run
npm run db:replay-tombstones
```

No web admin “restore DB” button.

## Deploy note

API redeploy on server **29** after merge (user will ask). Ledger file lives under the data dir on the API host; back it up with the data dir (not only `.sqlite`).
