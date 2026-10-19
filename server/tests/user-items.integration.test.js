/** Track R1 — inventory (DESIGN.md Rev 4 §8.2 / Batch R1 acceptance). */
import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";
const { openDb } = await import("../src/db/connection.js");
const { migrate } = await import("../src/db/migrate.js");
const I = await import("../src/lib/userItems.js");
const ctxRef = await startTestServer();
const { api, register, stop } = ctxRef;
test.after(async () => stop());
const db = () => openDb();
let seq = 0;
const uniq = (p) => `${p}${Date.now().toString(36)}${++seq}`;

test("migrations 027/028 applied, idempotent re-run, additive columns", () => {
  const ids = db().prepare(`SELECT id FROM schema_migrations`).all().map((r) => r.id);
  assert.ok(ids.includes("027_user_items.sql") && ids.includes("028_game_rewind_via.sql"));
  migrate(db()); // second run: no-op, no throw
  const cols = db().prepare(`PRAGMA table_info(game_sessions)`).all().map((c) => c.name);
  assert.ok(cols.includes("rewind_via"));
  const spinCols = db().prepare(`PRAGMA table_info(lucky_wheel_spins)`).all().map((c) => c.name);
  assert.ok(spinCols.includes("substitute_reason"));
  assert.equal(db().prepare(`SELECT COUNT(*) c FROM game_sessions WHERE rewind_via IS NOT NULL`).get().c, 0);
});

test("grant / consume: ledger rows, qty never negative, idempotent by ref, reconcile", async () => {
  const u = await register(uniq("inv"));
  const uid = u.user.id;
  const g = I.grantItem(db(), { userId: uid, itemType: "rewind_ticket", qty: 3, reason: "wheel_prize", refType: "wheel_spin", refId: "spin-1" });
  assert.equal(g.qtyAfter, 3);
  const g2 = I.grantItem(db(), { userId: uid, itemType: "rewind_ticket", qty: 3, reason: "wheel_prize", refType: "wheel_spin", refId: "spin-1" });
  assert.equal(g2.unchanged, true);
  assert.equal(I.getItemQty(db(), uid, "rewind_ticket"), 3);
  const c = I.consumeItem(db(), { userId: uid, itemType: "rewind_ticket", reason: "rewind_use", refType: "game", refId: "game-1" });
  assert.equal(c.qtyAfter, 2);
  assert.equal(I.consumeItem(db(), { userId: uid, itemType: "rewind_ticket", reason: "rewind_use", refId: "game-1" }).unchanged, true);
  assert.throws(() => I.consumeItem(db(), { userId: uid, itemType: "rewind_ticket", qty: 5, reason: "rewind_use", refId: "game-2" }), (e) => e.code === "NO_ITEM");
  assert.equal(I.getItemQty(db(), uid, "rewind_ticket"), 2);
  assert.throws(() => db().prepare(`UPDATE user_items SET qty = -1 WHERE user_id = ?`).run(uid), /CHECK/);
  assert.throws(() => I.grantItem(db(), { userId: uid, itemType: "gold_bar", qty: 1, reason: "admin_grant" }), (e) => e.code === "BAD_ITEM");
  const over = I.grantItem(db(), { userId: uid, itemType: "rewind_ticket", qty: 2, reason: "wheel_prize", refId: "spin-2", cap: 3 });
  assert.equal(over.overflow, true);
  assert.equal(I.getItemQty(db(), uid, "rewind_ticket"), 2);
  const sum = db().prepare(`SELECT SUM(delta) s FROM user_item_ledger WHERE user_id = ?`).get(uid).s;
  assert.equal(sum, 2);
  assert.deepEqual(I.reconcileItems(db()), []);
  const me = await api("/api/v1/me/items");
  assert.equal(me.status, 200);
  assert.equal(me.json.data.rewindTickets, 2);
  assert.equal(me.json.data.items[0].label, "后悔券");
});

test("20 parallel consumes of 1 ticket ⇒ exactly 1 success (transactions)", async () => {
  const u = await register(uniq("par"));
  I.grantItem(db(), { userId: u.user.id, itemType: "rewind_ticket", qty: 1, reason: "admin_grant", refId: "seed-par" });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => {
        try {
          return db().transaction(() => I.consumeItem(db(), { userId: u.user.id, itemType: "rewind_ticket", reason: "rewind_use", refId: `g-${i}` }))();
        } catch (e) {
          return { error: e.code };
        }
      })
    )
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.filter((r) => r.error === "NO_ITEM").length, 19);
  assert.equal(I.getItemQty(db(), u.user.id, "rewind_ticket"), 0);
  assert.deepEqual(I.reconcileItems(db()), []);
});

test("unauthenticated /me/items ⇒ 401", async () => {
  const { jar } = ctxRef;
  for (const k of Object.keys(jar)) delete jar[k];
  const r = await api("/api/v1/me/items");
  assert.equal(r.status, 401);
});
