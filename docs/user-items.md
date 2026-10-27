# 道具背包 · 后悔券 (Track R1)

Design: lucky-wheel DESIGN.md Rev 4 §8.2. Server: `server/src/lib/userItems.js`, migration `027_user_items.sql`.

- `user_items(user_id, item_type, qty CHECK 0..999)` + `user_item_ledger` (every change, same transaction, `qty_after`).
- Reasons: `wheel_prize` (ref = spin id, unique per item), `rewind_use` (ref = game id, unique ⇒ one ticket per game), `admin_grant` / `admin_revoke` (ref = admin op key, unique).
- `grantItem` is idempotent by ref; `consumeItem` is `UPDATE … WHERE qty >= n` (changes === 1) — never negative under concurrency.
- `GET /api/v1/me/items` → `{ items:[{type,label,qty}], rewindTickets, rewindEnabled, rewindTicketBoard }`.
- Wheel: `server/src/lib/wheelItems.js` registers the item granter at boot (so admin can save item sectors). There is no per-day limit on 后悔券 won from the wheel (removed 2026-10-27); the only supply cap is `rewindTicketHoldCap` (default 30). Over the hold cap, rewind off, or items unavailable ⇒ the spin pays `qty × ticketCoinValue` 韭币 with `substituted:true` and `prize.substituteReason` (`ticket_hold_cap` | `rewind_disabled` | `items_unavailable` | `spin_cap`; stored in `lucky_wheel_spins.substitute_reason`).
- 再转一次 at the 5-draws/day cap pays the active table's smallest coin prize (Table C: 58).
- Reconcile: `reconcileItems()` lists users where `SUM(ledger.delta) != qty` (must be empty).
- No expiry, not transferable, not on leaderboards.

## Table C (Bill, 2026-10-19) — not active until saved

`pos 0..7 = 58 · 后悔券×2 · 150 · 再转一次 · 200 · 888★(gold pos 5, 1%) · 后悔券×3 · 300`. Presets `TABLE_C1` (recommended) and `TABLE_C2` in `luckyWheel.js`; activate with admin 转盘 → 「载入表 C1」→ 保存新版本, or `node scripts/activate-wheel-table.mjs C1 --apply --reason "…"` (dry run without `--apply`). Roll back by restoring v1 (Table A) or `activate-wheel-table.mjs A --apply`.
