/**
 * Track R2 — pay the existing 反悔 with a 后悔券 (DESIGN.md Rev 4 §8.1.3–§8.1.6).
 * The 50-coin path is covered by the UNMODIFIED game-rewind*.integration tests plus the golden test here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestEnv, startTestServer, holds } from "./helpers.js";

prepareTestEnv();
process.env.EVENT_PROTOCOL_ENABLED = "1";
process.env.GAME_REWIND_ENABLED = "1";
process.env.ADMIN_ENABLED = "1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getSessionRow } = await import("../src/lib/games.js");
const { grantItem, getItemQty, reconcileItems } = await import("../src/lib/userItems.js");
const { getJiuCoinBalance } = await import("../src/lib/jiuCoin.js");
const { invalidateLeaderboardCache } = await import("../src/lib/leaderboard.js");
const { ASSIST_CLEAN, ASSIST_UNDO } = await import("../../shared/protocol.js");

const { api, register, stop, jar } = await startTestServer();
test.after(async () => {
  await stop();
});

const db = () => openDb();
let seq = 0;
const uniq = (p) => `${p}${Date.now().toString(36)}${++seq}`;
const key = (p = "k") => `${p}-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

async function createEventGame(auth, fillMode = "next_open") {
  // one active classic game per user: retire the previous one (tests run games sequentially)
  db().prepare(`UPDATE game_sessions SET status = 'abandoned' WHERE user_id = ? AND status = 'active'`).run(auth.user.id);
  if (getJiuCoinBalance(auth.user.id) < 20) db().prepare(`UPDATE users SET jiu_coin_balance = 20 WHERE id = ?`).run(auth.user.id);
  const r = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key("create") },
    body: { fillMode, pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  // the 20-coin create fee is not what these tests are about: restore the player's intended balance
  if (auth._coins != null) db().prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`).run(auth._coins, auth.user.id);
  return r.json.data.gameId;
}
async function decide(auth, gameId, expectedRevision, action) {
  const r = await api(`/api/v1/games/${gameId}/decisions`, {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key("dec") },
    body: { expectedRevision, action },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}
function rewind(auth, gameId, body, k = key("rw")) {
  return api(`/api/v1/games/${gameId}/rewind`, { method: "POST", csrf: auth.csrfToken, headers: { "Idempotency-Key": k }, body });
}
function giveTickets(userId, qty) {
  return grantItem(db(), { userId, itemType: "rewind_ticket", qty, reason: "admin_grant", refId: key("seed") });
}
const coinRows = (userId) => db().prepare(`SELECT * FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'game_rewind'`).all(userId);
const claimRows = (userId) => db().prepare(`SELECT * FROM reward_claims WHERE user_id = ? AND reward_key LIKE 'game:%:rewind'`).all(userId);
const useRows = (userId) => db().prepare(`SELECT * FROM user_item_ledger WHERE user_id = ? AND reason = 'rewind_use'`).all(userId);

async function newPlayer(prefix, { tickets = 0, coins = null } = {}) {
  const auth = await register(uniq(prefix));
  if (coins != null) db().prepare(`UPDATE users SET jiu_coin_balance = ? WHERE id = ?`).run(coins, auth.user.id);
  auth._coins = coins;
  if (tickets) giveTickets(auth.user.id, tickets);
  return auth;
}
async function relogin(auth) {
  for (const k of Object.keys(jar)) delete jar[k];
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: auth.username, password: auth.password } });
  assert.equal(l.status, 200);
  auth.csrfToken = l.json.data.csrfToken;
  return auth;
}

/* ------------------------------------------------------------------ golden coin path */

test("golden: coin path (payWith omitted and 'coin') — same response keys, DB rows and board as before R2", async () => {
  // Expected shape captured from main @9d5c4f3 (before Track R) for a rewind after one 'hold'.
  const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "rewind-coin-golden.json"), "utf8"));
  for (const variant of ["omitted", "coin"]) {
    const auth = await newPlayer(`gold${variant}`, { tickets: 3, coins: 200 });
    const gameId = await createEventGame(auth);
    await decide(auth, gameId, 0, "hold");
    const body = variant === "omitted" ? { expectedRevision: 1 } : { expectedRevision: 1, payWith: "coin" };
    const r = await rewind(auth, gameId, body);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(Object.keys(r.json.data).sort(), GOLDEN.responseKeys, variant);
    assert.equal(r.json.data.rewindVia, undefined);
    assert.equal(r.json.data.paidWith, undefined);
    assert.equal(r.json.data.assistClass, ASSIST_UNDO);
    assert.equal(r.json.data.balanceBefore, 200);
    assert.equal(r.json.data.balanceAfter, 150);
    const s = getSessionRow(gameId);
    assert.equal(s.undo_count, 1);
    assert.equal(s.assist_class, ASSIST_UNDO);
    assert.equal(s.rewind_via, null, "coin path never writes rewind_via");
    const cmd = db().prepare(`SELECT * FROM game_commands WHERE game_id = ? AND type = 'rewind'`).get(gameId);
    assert.deepEqual(Object.keys(JSON.parse(cmd.event_json)).sort(), GOLDEN.eventKeys);
    assert.equal(coinRows(auth.user.id).length, 1);
    assert.equal(coinRows(auth.user.id)[0].delta, -50);
    assert.equal(claimRows(auth.user.id).length, 1);
    assert.equal(getItemQty(db(), auth.user.id, "rewind_ticket"), 3, "tickets untouched by a coin rewind");
    assert.equal(useRows(auth.user.id).length, 0);
    const state = await api(`/api/v1/games/${gameId}/state`);
    assert.deepEqual(Object.keys(state.json.data).sort(), GOLDEN.stateKeys);
  }
});

test("coin path with balance 49 and tickets > 0 still 402 when payWith omitted (no silent ticket use)", async () => {
  const auth = await newPlayer("c49", { tickets: 2, coins: 49 });
  const gameId = await createEventGame(auth);
  await decide(auth, gameId, 0, "hold");
  const r = await rewind(auth, gameId, { expectedRevision: 1 });
  assert.equal(r.status, 402);
  assert.equal(r.json.error.code, "INSUFFICIENT_FUNDS");
  assert.equal(getItemQty(db(), auth.user.id, "rewind_ticket"), 2);
  assert.equal(getSessionRow(gameId).undo_count, 0);
});

/* ------------------------------------------------------------------ ticket path */

test("ticket rewind: qty −1, balance unchanged, no coin rows, undo_count=1, assist clean, rewind_via=ticket, audit rows", async () => {
  const auth = await newPlayer("tk", { tickets: 2, coins: 0 });
  const gameId = await createEventGame(auth);
  await decide(auth, gameId, 0, "buy");
  const bal = getJiuCoinBalance(auth.user.id);
  assert.equal(bal, 0, "ticket path has no 50-coin pre-check");
  const r = await rewind(auth, gameId, { expectedRevision: 1, payWith: "ticket" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.equal(d.paidWith, "ticket");
  assert.equal(d.ticketsLeft, 1);
  assert.equal(d.rewindVia, "ticket");
  assert.equal(d.assistClass, ASSIST_CLEAN);
  assert.equal(d.undoCount, 1);
  assert.equal(d.canRewind, false);
  assert.equal(d.balanceBefore, 0);
  assert.equal(d.balanceAfter, 0);
  assert.equal(d.revokedAction, "buy");
  assert.equal(d.restoredDecisionDay, 1);
  assert.deepEqual(d.actions, []);
  const s = getSessionRow(gameId);
  assert.equal(s.undo_count, 1);
  assert.equal(s.assist_class, ASSIST_CLEAN);
  assert.equal(s.rewind_via, "ticket");
  assert.equal(getItemQty(db(), auth.user.id, "rewind_ticket"), 1);
  assert.equal(getJiuCoinBalance(auth.user.id), 0);
  assert.equal(coinRows(auth.user.id).length, 0, "no jiu_coin_ledger row");
  assert.equal(claimRows(auth.user.id).length, 0, "no reward_claims row");
  const use = useRows(auth.user.id);
  assert.equal(use.length, 1);
  assert.equal(use[0].ref_type, "game");
  assert.equal(use[0].ref_id, gameId);
  assert.equal(use[0].delta, -1);
  assert.equal(JSON.parse(use[0].meta_json).restoredDecisionDay, 1);
  const cmd = db().prepare(`SELECT * FROM game_commands WHERE game_id = ? AND type = 'rewind'`).get(gameId);
  assert.equal(JSON.parse(cmd.event_json).paidWith, "ticket");
  const st = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(st.json.data.rewindVia, "ticket");
  assert.equal(st.json.data.assistClass, ASSIST_CLEAN);
  assert.equal(st.json.data.canRewind, false);
  const items = await api("/api/v1/me/items");
  assert.equal(items.json.data.rewindTickets, 1);
  assert.equal(items.json.data.rewindTicketBoard, "clean");
  assert.deepEqual(reconcileItems(db()), []);
});

test("no ticket ⇒ 409 NO_TICKET, game unchanged, no coin fallback", async () => {
  const auth = await newPlayer("nt", { tickets: 0, coins: 500 });
  const gameId = await createEventGame(auth);
  await decide(auth, gameId, 0, "hold");
  const r = await rewind(auth, gameId, { expectedRevision: 1, payWith: "ticket" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "NO_TICKET");
  const s = getSessionRow(gameId);
  assert.equal(s.undo_count, 0);
  assert.equal(s.revision, 1);
  assert.equal(getJiuCoinBalance(auth.user.id), 500);
  assert.equal(coinRows(auth.user.id).length, 0);
});

test("bad payWith ⇒ 400; rewind feature off ⇒ 403 and ticket untouched", async () => {
  const auth = await newPlayer("bp", { tickets: 1 });
  const gameId = await createEventGame(auth);
  await decide(auth, gameId, 0, "hold");
  const bad = await rewind(auth, gameId, { expectedRevision: 1, payWith: "gold" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "INVALID_PAY_WITH");
  config.gameRewindEnabled = false;
  try {
    const off = await rewind(auth, gameId, { expectedRevision: 1, payWith: "ticket" });
    assert.equal(off.status, 403);
    assert.equal(off.json.error.code, "GAME_REWIND_DISABLED");
  } finally {
    config.gameRewindEnabled = true;
  }
  assert.equal(getItemQty(db(), auth.user.id, "rewind_ticket"), 1);
});

test("cap 1 per game: coin then ticket ⇒ REWIND_ALREADY_USED, ticket kept; ticket then coin ⇒ no 50 deducted", async () => {
  const a = await newPlayer("capa", { tickets: 2, coins: 200 });
  const g1 = await createEventGame(a);
  await decide(a, g1, 0, "hold");
  await decide(a, g1, 1, "hold");
  assert.equal((await rewind(a, g1, { expectedRevision: 2 })).status, 200);
  const t = await rewind(a, g1, { expectedRevision: 3, payWith: "ticket" });
  assert.equal(t.status, 409);
  assert.equal(t.json.error.code, "REWIND_ALREADY_USED");
  assert.equal(getItemQty(db(), a.user.id, "rewind_ticket"), 2);

  const g2 = await createEventGame(a);
  await decide(a, g2, 0, "hold");
  await decide(a, g2, 1, "hold");
  const bal = getJiuCoinBalance(a.user.id);
  assert.equal((await rewind(a, g2, { expectedRevision: 2, payWith: "ticket" })).status, 200);
  const c = await rewind(a, g2, { expectedRevision: 3 });
  assert.equal(c.status, 409);
  assert.equal(c.json.error.code, "REWIND_ALREADY_USED");
  assert.equal(getJiuCoinBalance(a.user.id), bal, "no 50 deducted");
  assert.equal(getItemQty(db(), a.user.id, "rewind_ticket"), 1);
});

test("parallel ticket + coin on one game ⇒ exactly one applies", async () => {
  const a = await newPlayer("par", { tickets: 1, coins: 200 });
  const g = await createEventGame(a);
  await decide(a, g, 0, "hold");
  const [x, y] = await Promise.all([
    rewind(a, g, { expectedRevision: 1, payWith: "ticket" }),
    rewind(a, g, { expectedRevision: 1 }),
  ]);
  const okCount = [x, y].filter((r) => r.status === 200).length;
  assert.equal(okCount, 1, JSON.stringify([x.json, y.json]));
  const s = getSessionRow(g);
  assert.equal(s.undo_count, 1);
  const ticketUsed = getItemQty(db(), a.user.id, "rewind_ticket") === 0;
  const coinUsed = coinRows(a.user.id).length === 1;
  assert.ok(ticketUsed !== coinUsed, "exactly one payment");
  assert.equal(s.rewind_via, ticketUsed ? "ticket" : null);
  assert.equal(s.assist_class, ticketUsed ? ASSIST_CLEAN : ASSIST_UNDO);
});

test("20 parallel ticket rewinds (different keys) on one game with 5 tickets ⇒ exactly 1 applies, 1 ticket used", async () => {
  const a = await newPlayer("p20", { tickets: 5 });
  const g = await createEventGame(a);
  await decide(a, g, 0, "hold");
  const rs = await Promise.all(Array.from({ length: 20 }, () => rewind(a, g, { expectedRevision: 1, payWith: "ticket" })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.ok(rs.filter((r) => r.status !== 200).every((r) => ["REWIND_ALREADY_USED", "REVISION_CONFLICT"].includes(r.json.error.code)));
  assert.equal(getItemQty(db(), a.user.id, "rewind_ticket"), 4);
  assert.equal(useRows(a.user.id).length, 1);
  assert.deepEqual(reconcileItems(db()), []);
});

test("failures never consume a ticket: revision conflict, no decision, settled, expired, wrong kind", async () => {
  const a = await newPlayer("fail", { tickets: 5 });
  const g = await createEventGame(a);
  const none = await rewind(a, g, { expectedRevision: 0, payWith: "ticket" });
  assert.equal(none.json.error.code, "NO_DECISION_TO_REWIND");
  await decide(a, g, 0, "hold");
  const conflict = await rewind(a, g, { expectedRevision: 0, payWith: "ticket" });
  assert.equal(conflict.json.error.code, "REVISION_CONFLICT");
  // expired
  const ge = await createEventGame(a);
  await decide(a, ge, 0, "hold");
  db().prepare(`UPDATE game_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(ge);
  const exp = await rewind(a, ge, { expectedRevision: 1, payWith: "ticket" });
  assert.equal(exp.status, 410);
  // settled
  const gs = await createEventGame(a);
  db().prepare(`UPDATE game_sessions SET canonical_actions_json = ?, revision = 29 WHERE id = ?`).run(JSON.stringify(holds(29)), gs);
  const fin = await api(`/api/v1/games/${gs}/finish`, { method: "POST", csrf: a.csrfToken, headers: { "Idempotency-Key": key("fin") }, body: { expectedRevision: 29, finish: true } });
  assert.ok(fin.status === 200 || fin.status === 201, JSON.stringify(fin.json));
  const st = await rewind(a, gs, { expectedRevision: 30, payWith: "ticket" });
  assert.equal(st.json.error.code, "GAME_NOT_ACTIVE");
  // wrong kind (forced)
  const gk = await createEventGame(a);
  await decide(a, gk, 0, "hold");
  db().prepare(`UPDATE game_sessions SET game_kind = 'oneshot' WHERE id = ?`).run(gk);
  const kind = await rewind(a, gk, { expectedRevision: 1, payWith: "ticket" });
  assert.equal(kind.status, 409);
  assert.equal(getItemQty(db(), a.user.id, "rewind_ticket"), 5);
  assert.equal(useRows(a.user.id).length, 0);
});

test("idempotency: same key replays (qty −1 once); same key with different payWith ⇒ IDEMPOTENCY_CONFLICT", async () => {
  const a = await newPlayer("idem", { tickets: 3, coins: 200 });
  const g = await createEventGame(a);
  await decide(a, g, 0, "hold");
  const k = key("same");
  const r1 = await rewind(a, g, { expectedRevision: 1, payWith: "ticket" }, k);
  const r2 = await rewind(a, g, { expectedRevision: 1, payWith: "ticket" }, k);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.json.data, r1.json.data);
  assert.equal(getItemQty(db(), a.user.id, "rewind_ticket"), 2);
  const r3 = await rewind(a, g, { expectedRevision: 1 }, k);
  assert.equal(r3.status, 409);
  assert.equal(r3.json.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(getJiuCoinBalance(a.user.id), 200);
});

/* ------------------------------------------------------------------ boards */

async function settleAfterTicket(a, { ppm = 77777 } = {}) {
  const g = await createEventGame(a);
  await decide(a, g, 0, "hold");
  const r = await rewind(a, g, { expectedRevision: 1, payWith: "ticket" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // fast-forward the remaining decisions (keeps undo_count/assist/rewind_via as written by the rewind)
  db().prepare(`UPDATE game_sessions SET canonical_actions_json = ?, revision = 40 WHERE id = ?`).run(JSON.stringify(holds(29)), g);
  const fin = await api(`/api/v1/games/${g}/finish`, { method: "POST", csrf: a.csrfToken, headers: { "Idempotency-Key": key("fin") }, body: { expectedRevision: 40, finish: true } });
  assert.ok(fin.status === 200 || fin.status === 201, JSON.stringify(fin.json));
  db().prepare(`UPDATE game_results SET trade_count = 1, return_ppm = ? WHERE game_id = ?`).run(ppm, g);
  invalidateLeaderboardCache();
  return { g, fin: fin.json.data };
}
async function boards() {
  invalidateLeaderboardCache();
  const out = {};
  for (const a of ["clean", "undo", "all"]) {
    const b = await api(`/api/v1/leaderboard?fillMode=next_open&metric=best&assistClass=${a}`);
    assert.equal(b.status, 200);
    out[a] = b.json.data.myRank;
  }
  return out;
}

test("board semantics: ticket game settles clean — on 纯净 and 总榜, absent from 反悔; /me/stats default counts it", async () => {
  const a = await newPlayer("brd", { tickets: 2 });
  db().prepare(`UPDATE users SET leaderboard_opt_in = 1 WHERE id = ?`).run(a.user.id);
  const { g, fin } = await settleAfterTicket(a);
  assert.equal(fin.assistClass, ASSIST_CLEAN);
  assert.equal(fin.rewindVia, "ticket");
  const res = db().prepare(`SELECT assist_class FROM game_results WHERE game_id = ?`).get(g);
  assert.equal(res.assist_class, ASSIST_CLEAN);
  assert.equal(getSessionRow(g).assist_class, ASSIST_CLEAN);
  const b = await boards();
  assert.ok(b.clean != null, "on clean board");
  assert.ok(b.all != null, "on 总榜");
  assert.equal(b.undo, null, "not on undo board");
  const stats = await api("/api/v1/me/stats?fillMode=next_open");
  assert.equal(stats.json.data.filters.assistClass, ASSIST_CLEAN);
  assert.ok(stats.json.data.count >= 1);
  const detail = await api(`/api/v1/games/${g}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.rewindVia, "ticket");
  assert.equal(detail.json.data.assistClass, ASSIST_CLEAN);
});

test("grep-gate: no leaderboard / stats SQL reads rewind_via", () => {
  const src = path.resolve(__dirname, "../src/lib");
  assert.equal(fs.readFileSync(path.join(src, "leaderboard.js"), "utf8").includes("rewind_via"), false, "leaderboard.js");
  for (const f of ["games.js", "gameProtocol.js", "gameResultDto.js"]) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    const hits = [...text.matchAll(/(\S*)rewind_via/g)].map((m) => m[1]);
    // only DTO echoes of the row field are allowed (row.rewind_via / sessionRow?.rewind_via), never SQL
    assert.ok(hits.every((h) => /(^|\W)(row|sessionRow\??)\.$/.test(h)), `${f}: ${hits.join(",")}`);
  }
});

/* ------------------------------------------------------------------ switch + reclassify (admin) */

async function adminSession() {
  const a = await register(uniq("adm"));
  db().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(a.user.id);
  await relogin(a);
  await api("/api/v1/admin/reauth", { method: "POST", csrf: a.csrfToken, body: { password: a.password } });
  return a;
}

test("switch rewindTicketBoard='undo' ⇒ new ticket rewinds get assist undo; reclassify moves existing games both ways", async () => {
  const p = await newPlayer("sw", { tickets: 5 });
  db().prepare(`UPDATE users SET leaderboard_opt_in = 1 WHERE id = ?`).run(p.user.id);
  const first = await settleAfterTicket(p, { ppm: 50000 });
  // a coin-undo game of the same user must never move
  const gc = await createEventGame(p);
  db().prepare(`UPDATE users SET jiu_coin_balance = 500 WHERE id = ?`).run(p.user.id);
  await decide(p, gc, 0, "hold");
  assert.equal((await rewind(p, gc, { expectedRevision: 1 })).status, 200);

  config.rewindTicketBoard = "undo";
  try {
    const items = await api("/api/v1/me/items");
    assert.equal(items.json.data.rewindTicketBoard, "undo");
    const g = await createEventGame(p);
    await decide(p, g, 0, "hold");
    const r = await rewind(p, g, { expectedRevision: 1, payWith: "ticket" });
    assert.equal(r.json.data.assistClass, ASSIST_UNDO);
    assert.equal(getSessionRow(g).rewind_via, "ticket");
  } finally {
    config.rewindTicketBoard = "clean";
  }

  const playerCsrf = p.csrfToken;
  const adm = await adminSession();
  const noReason = await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: adm.csrfToken, body: { to: "undo" } });
  assert.equal(noReason.json.error.code, "REASON_REQUIRED");
  const dry = await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: adm.csrfToken, body: { to: "undo", dryRun: true, reason: "试算" } });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.ok(dry.json.data.sessions >= 1);
  assert.equal(getSessionRow(first.g).assist_class, ASSIST_CLEAN, "dryRun writes nothing");
  const mv = await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: adm.csrfToken, body: { to: "undo", reason: "券局改记反悔榜" } });
  assert.equal(mv.status, 200);
  assert.equal(mv.json.data.sessions, dry.json.data.sessions);
  assert.equal(getSessionRow(first.g).assist_class, ASSIST_UNDO);
  assert.equal(db().prepare(`SELECT assist_class a FROM game_results WHERE game_id=?`).get(first.g).a, ASSIST_UNDO);
  assert.equal(getSessionRow(gc).assist_class, ASSIST_UNDO, "coin game untouched");
  const again = await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: adm.csrfToken, body: { to: "undo", reason: "重复执行" } });
  assert.equal(again.json.data.sessions, 0, "repeat is a no-op");
  const audit = db().prepare(`SELECT * FROM audit_logs WHERE action='rewind_tickets.reclassify' ORDER BY id DESC LIMIT 1`).get();
  assert.equal(JSON.parse(audit.after_json).to, "undo");

  await relogin(p);
  let b = await boards();
  assert.equal(b.clean, null, "after reclassify: off the clean board");
  assert.ok(b.undo != null);

  await relogin(adm);
  await api("/api/v1/admin/reauth", { method: "POST", csrf: adm.csrfToken, body: { password: adm.password } });
  const back = await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: adm.csrfToken, body: { to: "clean", reason: "改回普通榜" } });
  assert.equal(back.status, 200);
  assert.equal(getSessionRow(first.g).assist_class, ASSIST_CLEAN);
  assert.equal(getSessionRow(gc).assist_class, ASSIST_UNDO, "coin undo game never moves to clean");
  await relogin(p);
  b = await boards();
  assert.ok(b.clean != null);
  void playerCsrf;
});

test("admin: non-admin 403; reclassify / item adjust need reauth; game detail + inventory ledger + stats", async () => {
  const u = await newPlayer("nadm", { tickets: 1 });
  assert.equal((await api("/api/v1/admin/rewind/stats")).status, 403);
  assert.equal((await api("/api/v1/admin/rewind-tickets/reclassify", { method: "POST", csrf: u.csrfToken, body: { to: "undo", reason: "xx" } })).status, 403);
  const g = await createEventGame(u);
  await decide(u, g, 0, "hold");
  assert.equal((await rewind(u, g, { expectedRevision: 1, payWith: "ticket" })).status, 200);

  const adm = await register(uniq("adm2"));
  db().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(adm.user.id);
  await relogin(adm);
  const noAuth = await api(`/api/v1/admin/users/${u.user.id}/items`, { method: "POST", csrf: adm.csrfToken, body: { delta: 2, reason: "补偿" } });
  assert.equal(noAuth.status, 403);
  await api("/api/v1/admin/reauth", { method: "POST", csrf: adm.csrfToken, body: { password: adm.password } });
  const grant = await api(`/api/v1/admin/users/${u.user.id}/items`, { method: "POST", csrf: adm.csrfToken, headers: { "Idempotency-Key": "op-grant-1" }, body: { delta: 2, reason: "补偿" } });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.equal(grant.json.data.qty, 2);
  const dup = await api(`/api/v1/admin/users/${u.user.id}/items`, { method: "POST", csrf: adm.csrfToken, headers: { "Idempotency-Key": "op-grant-1" }, body: { delta: 2, reason: "补偿" } });
  assert.equal(dup.json.data.unchanged, true);
  assert.equal(dup.json.data.qty, 2);
  const neg = await api(`/api/v1/admin/users/${u.user.id}/items`, { method: "POST", csrf: adm.csrfToken, body: { delta: -5, reason: "扣除" } });
  assert.equal(neg.status, 409);
  assert.equal(neg.json.error.code, "WOULD_GO_NEGATIVE");
  const rev = await api(`/api/v1/admin/users/${u.user.id}/items`, { method: "POST", csrf: adm.csrfToken, body: { delta: -1, reason: "扣除一张" } });
  assert.equal(rev.json.data.qty, 1);
  const inv = await api(`/api/v1/admin/users/${u.user.id}/items`);
  assert.equal(inv.status, 200);
  assert.equal(inv.json.data.items[0].qty, 1);
  const reasons = inv.json.data.ledger.map((l) => l.reason);
  assert.ok(reasons.includes("rewind_use") && reasons.includes("admin_grant") && reasons.includes("admin_revoke"));
  assert.equal(inv.json.data.ledger.find((l) => l.reason === "rewind_use").refId, g);
  const gd = await api(`/api/v1/admin/games/${g}`);
  assert.equal(gd.status, 200, JSON.stringify(gd.json));
  assert.equal(gd.json.data.game.rewindVia, "ticket");
  assert.equal(gd.json.data.game.rewindPaidWith, "ticket");
  assert.equal(gd.json.data.game.assistClass, ASSIST_CLEAN);
  const st = await api("/api/v1/admin/rewind/stats?days=7");
  assert.equal(st.status, 200);
  assert.ok(st.json.data.totals.ticketRewinds >= 1);
  assert.ok(st.json.data.tickets.redeemed >= 1);
  assert.ok(st.json.data.tickets.issuedAdmin >= 2);
  assert.ok(Array.isArray(st.json.data.returns));
  assert.ok(st.json.data.topUsers.some((t) => t.userId === u.user.id));
  const auditRow = db().prepare(`SELECT * FROM audit_logs WHERE action='items.grant' AND target_id=? ORDER BY id DESC LIMIT 1`).get(String(u.user.id));
  assert.ok(auditRow);
  assert.deepEqual(reconcileItems(db()), []);
});

test("coin ledger reconciles for ticket games (no coin delta)", async () => {
  const a = await newPlayer("rec", { tickets: 1 });
  const before = db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=?`).get(a.user.id).s;
  const g = await createEventGame(a);
  await decide(a, g, 0, "hold");
  const mid = db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=?`).get(a.user.id).s;
  await rewind(a, g, { expectedRevision: 1, payWith: "ticket" });
  const after = db().prepare(`SELECT COALESCE(SUM(delta),0) s FROM jiu_coin_ledger WHERE user_id=?`).get(a.user.id).s;
  assert.equal(after, mid);
  assert.equal(after, getJiuCoinBalance(a.user.id));
  assert.ok(before >= after);
});
