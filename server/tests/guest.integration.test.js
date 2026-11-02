import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj, cookieHeader } from "./helpers.js";

prepareTestEnv();

const { config } = await import("../src/lib/config.js");
const { openDb } = await import("../src/db/connection.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { purgeGuestUsers } = await import("../src/lib/users.js");
const { getAdminAnalytics } = await import("../src/lib/adminAnalytics.js");
const { findValidSession, createSession } = await import("../src/lib/sessions.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

test.after(async () => {
  await stop();
});

function clearJar() {
  for (const k of Object.keys(jar)) delete jar[k];
}

async function newGuest() {
  clearJar();
  const r = await api("/api/v1/auth/guest", { method: "POST" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { user: r.json.data.user, csrf: r.json.data.csrfToken };
}

let keySeq = 0;
function createGame(g, extra = {}) {
  keySeq += 1;
  return api("/api/v1/games", {
    method: "POST",
    csrf: g.csrf,
    headers: { "Idempotency-Key": `guest-key-${Date.now()}-${keySeq}` },
    body: { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 }, ...extra },
  });
}

test("config advertises guestPlay; /me for a fresh visitor is still a plain guest-less null", async () => {
  clearJar();
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.json.data.features.guestPlay, true);
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user, null);
});

test("POST /auth/guest creates a guest with 100 coins, a cookie and isGuest=true; no CSRF needed", async () => {
  clearJar();
  const r = await api("/api/v1/auth/guest", { method: "POST" });
  assert.equal(r.status, 201);
  const u = r.json.data.user;
  assert.equal(u.isGuest, true);
  assert.equal(u.jiuCoinBalance, 100);
  assert.equal(u.leaderboardOptIn, false);
  assert.equal(u.guestGamesLeft, 1);
  assert.match(u.nickname, /^游客\d{4}$/);
  assert.ok(r.json.data.csrfToken);
  assert.ok(Object.keys(jar).length >= 1, "session cookie set");

  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.isGuest, true);
});

test("a guest cookie lasts 30 days and its session row follows the guest limits", async () => {
  clearJar();
  const res = await fetch(`${ctx.base}/api/v1/auth/guest`, { method: "POST" });
  const raw = res.headers.getSetCookie().join(";");
  const maxAge = Number((raw.match(/Max-Age=(\d+)/i) || [])[1]);
  assert.equal(maxAge, Math.floor(config.guestSessionMs / 1000));
  assert.ok(maxAge >= 29 * 86400);
});

test("POST /auth/guest is idempotent for a visitor that already holds a guest session", async () => {
  const g = await newGuest();
  const again = await api("/api/v1/auth/guest", { method: "POST", csrf: g.csrf });
  assert.equal(again.status, 200);
  assert.equal(again.json.data.user.id, g.user.id);
  const n = openDb().prepare("SELECT COUNT(*) AS n FROM users WHERE is_guest = 1").get().n;
  const after = await api("/api/v1/auth/guest", { method: "POST", csrf: g.csrf });
  assert.equal(after.json.data.user.id, g.user.id);
  assert.equal(openDb().prepare("SELECT COUNT(*) AS n FROM users WHERE is_guest = 1").get().n, n);
});

test("a signed-in registered user cannot mint a guest", async () => {
  const auth = await register(`reg${Date.now().toString(36)}`);
  const r = await api("/api/v1/auth/guest", { method: "POST", csrf: auth.csrfToken });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "ALREADY_SIGNED_IN");
});

test("a stale cookie does not block guest creation", async () => {
  clearJar();
  jar[config.cookieName] = "not-a-real-session";
  const r = await api("/api/v1/auth/guest", { method: "POST" });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.user.isGuest, true);
});

test("guest creation is rate limited per IP (separate from registration)", async () => {
  const save = { h: config.rateLimit.guestPerIpHour, d: config.rateLimit.guestPerIpDay };
  config.rateLimit.guestPerIpHour = 2;
  resetRateLimitBuckets();
  try {
    await newGuest();
    await newGuest();
    clearJar();
    const r = await api("/api/v1/auth/guest", { method: "POST" });
    assert.equal(r.status, 429);
    assert.ok(r.res.headers.get("retry-after"));
    // registration has its own bucket and is unaffected
    const reg = await register(`rl${Date.now().toString(36)}`);
    assert.ok(reg.user.id);
  } finally {
    config.rateLimit.guestPerIpHour = save.h;
    config.rateLimit.guestPerIpDay = save.d;
    resetRateLimitBuckets();
  }
});

test("kill switch: guestPlayEnabled=false -> 403 GUEST_DISABLED and features.guestPlay=false", async () => {
  config.guestPlayEnabled = false;
  try {
    clearJar();
    const r = await api("/api/v1/auth/guest", { method: "POST" });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, "GUEST_DISABLED");
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.json.data.features.guestPlay, false);
  } finally {
    config.guestPlayEnabled = true;
  }
});

test("registration closed also closes guest play", async () => {
  config.registrationEnabled = false;
  try {
    clearJar();
    const r = await api("/api/v1/auth/guest", { method: "POST" });
    assert.equal(r.status, 403);
    assert.equal((await api("/api/v1/config")).json.data.features.guestPlay, false);
  } finally {
    config.registrationEnabled = true;
  }
});

test("guest can create, play and finish ONE classic game (cost 20 -> balance 80)", async () => {
  const g = await newGuest();
  const create = await createGame(g);
  assert.equal(create.status, 201, JSON.stringify(create.json));
  const gameId = create.json.data.gameId;

  const state = await api(`/api/v1/games/${gameId}/state`);
  assert.equal(state.status, 200);
  const active = await api("/api/v1/games/active");
  assert.equal(active.status, 200);

  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: g.csrf,
    body: { actions: actionsObj(["buy", "sell", ...holds(27)]), finish: true },
  });
  assert.equal(finish.status, 201, JSON.stringify(finish.json));

  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.jiuCoinBalance, 80);
  assert.equal(me.json.data.user.isGuest, true);
  assert.equal(me.json.data.user.guestGamesLeft, 0, "the client routes to register on this");
});

test("guestGamesLeft is only present on guests, and a registered user's /me has no such field", async () => {
  const acct = await register(`gl${Date.now().toString(36)}`);
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.isGuest, false);
  assert.equal("guestGamesLeft" in me.json.data.user, false);
  assert.ok(acct.user.id);
});

test("a guest cannot open a second game after the first settled (GUEST_GAME_LIMIT)", async () => {
  const g = await newGuest();
  const first = await createGame(g);
  assert.equal(first.status, 201);
  const fin = await api(`/api/v1/games/${first.json.data.gameId}/finish`, {
    method: "POST",
    csrf: g.csrf,
    body: { actions: actionsObj(holds(29)), finish: true },
  });
  assert.equal(fin.status, 201);
  const second = await createGame(g);
  assert.equal(second.status, 403);
  assert.equal(second.json.error.code, "GUEST_GAME_LIMIT");
  assert.equal((await api("/api/v1/me")).json.data.user.jiuCoinBalance, 80, "no charge for the refused game");
});

test("abandoning the first game still uses up the guest's one game", async () => {
  const g = await newGuest();
  const first = await createGame(g);
  assert.equal(first.status, 201);
  const ab = await api(`/api/v1/games/${first.json.data.gameId}/abandon`, { method: "POST", csrf: g.csrf });
  assert.equal(ab.status, 204);
  const second = await createGame(g);
  assert.equal(second.status, 403);
  assert.equal(second.json.error.code, "GUEST_GAME_LIMIT");
});

test("replaying the same create (same Idempotency-Key) returns the game, it is not a second game", async () => {
  const g = await newGuest();
  const headers = { "Idempotency-Key": `guest-idem-${Date.now()}` };
  const body = { fillMode: "next_open", pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 } };
  const a = await api("/api/v1/games", { method: "POST", csrf: g.csrf, headers, body });
  const b = await api("/api/v1/games", { method: "POST", csrf: g.csrf, headers, body });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.json.data.gameId, a.json.data.gameId);
});

test("an unfinished first game is reported as ACTIVE_GAME_EXISTS, not as the limit", async () => {
  const g = await newGuest();
  const first = await createGame(g);
  assert.equal(first.status, 201);
  const again = await createGame(g);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "ACTIVE_GAME_EXISTS");
});

test("guests may only open classic games (oneshot / survival / stake are GUEST_RESTRICTED)", async () => {
  const g = await newGuest();
  for (const gameKind of ["oneshot", "survival", "stake", "daily"]) {
    const r = await createGame(g, { gameKind, stake: 50 });
    assert.ok([400, 403].includes(r.status), `${gameKind} -> ${r.status}`);
    if (gameKind !== "daily") assert.equal(r.json.error.code, "GUEST_RESTRICTED", gameKind);
  }
  assert.equal(
    openDb().prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE user_id = ?").get(g.user.id).n,
    0,
    "nothing was created",
  );
});

test("requireUser is closed to guests by default: every registered-only route answers GUEST_RESTRICTED", async () => {
  const g = await newGuest();
  const calls = [
    ["POST", "/api/v1/games/00000000-0000-4000-8000-000000000001/rewind"],
    ["GET", "/api/v1/me/games"],
    ["GET", "/api/v1/me/stats"],
    ["GET", "/api/v1/me/jiu-coin"],
    ["POST", "/api/v1/me/jiu-coin/daily"],
    ["PATCH", "/api/v1/me"],
    ["POST", "/api/v1/daily-challenge/start"],
    ["POST", "/api/v1/feedback"],
  ];
  for (const [method, path] of calls) {
    const r = await api(path, { method, csrf: g.csrf, body: method === "GET" ? undefined : {} });
    assert.ok(r.status === 403 || r.status === 404 || r.status === 405, `${method} ${path} -> ${r.status}`);
    if (r.status === 403) assert.equal(r.json.error.code, "GUEST_RESTRICTED", `${method} ${path}`);
  }
  // the ones that certainly exist must be the guest-restricted 403, not 404
  for (const [method, path] of calls.slice(0, 5)) {
    const r = await api(path, { method, csrf: g.csrf, body: method === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
});

test("a guest is not on any leaderboard", async () => {
  const g = await newGuest();
  const first = await createGame(g);
  await api(`/api/v1/games/${first.json.data.gameId}/finish`, {
    method: "POST",
    csrf: g.csrf,
    body: { actions: actionsObj(holds(29)), finish: true },
  });
  const lb = await api("/api/v1/leaderboard?fillMode=next_open");
  assert.equal(lb.status, 200);
  const names = JSON.stringify(lb.json.data);
  assert.ok(!names.includes(g.user.nickname));
});

test("registering with a guest session upgrades the SAME user: id, game and leftover coins kept, +500", async () => {
  const g = await newGuest();
  const first = await createGame(g);
  const fin = await api(`/api/v1/games/${first.json.data.gameId}/finish`, {
    method: "POST",
    csrf: g.csrf,
    body: { actions: actionsObj(["buy", ...holds(28)]), finish: true },
  });
  assert.equal(fin.status, 201);

  const username = `up${Date.now().toString(36)}`;
  const reg = await api("/api/v1/auth/register", {
    method: "POST",
    body: { username, password: "pass1234", nickname: "升级玩家", termsVersion: "v1" },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const u = reg.json.data.user;
  assert.equal(u.id, g.user.id, "same user id");
  assert.equal(u.isGuest, false);
  assert.equal(u.username, username);
  assert.equal(u.nickname, "升级玩家");
  assert.equal(u.jiuCoinBalance, 80 + 500);
  assert.equal(u.leaderboardOptIn, true, "registered players default to the board");

  const csrf = reg.json.data.csrfToken;
  const games = await api("/api/v1/me/games", { csrf });
  assert.equal(games.status, 200);
  assert.equal(games.json.data.items.length, 1, "the guest's game is now in the player's history");

  const ledger = openDb()
    .prepare("SELECT reason FROM jiu_coin_ledger WHERE user_id = ? ORDER BY id")
    .all(g.user.id)
    .map((r) => r.reason);
  assert.deepEqual(ledger, ["guest_grant", "game_create", "register_grant"]);
});

test("after upgrading, the old guest session is revoked and the new one is a normal session", async () => {
  const g = await newGuest();
  const oldToken = jar[config.cookieName];
  const reg = await api("/api/v1/auth/register", {
    method: "POST",
    body: { username: `sw${Date.now().toString(36)}`, password: "pass1234", nickname: "换新会话", termsVersion: "v1" },
  });
  assert.equal(reg.status, 201);
  assert.notEqual(jar[config.cookieName], oldToken);
  assert.equal(findValidSession(oldToken), null, "guest session is dead");
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.isGuest, false);
  // registered-only routes now open
  const r = await api("/api/v1/me/jiu-coin");
  assert.equal(r.status, 200);
  assert.equal(g.user.id, me.json.data.user.id);
});

test("a taken username keeps the visitor a guest and loses nothing", async () => {
  const taken = `tk${Date.now().toString(36)}`;
  await register(taken);
  const g = await newGuest();
  const reg = await api("/api/v1/auth/register", {
    method: "POST",
    body: { username: taken, password: "pass1234", nickname: "撞名", termsVersion: "v1" },
  });
  assert.equal(reg.status, 409);
  assert.equal(reg.json.error.code, "USERNAME_TAKEN");
  const me = await api("/api/v1/me");
  assert.equal(me.json.data.user.id, g.user.id);
  assert.equal(me.json.data.user.isGuest, true);
  assert.equal(me.json.data.user.jiuCoinBalance, 100);
  const grants = openDb()
    .prepare("SELECT COUNT(*) AS n FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'register_grant'")
    .get(g.user.id).n;
  assert.equal(grants, 0, "no register grant on a failed upgrade");
});

test("registering twice from the same guest cannot double-grant (second request is just a normal sign-up)", async () => {
  const g = await newGuest();
  const cookie = cookieHeader(jar);
  const body = (n) => JSON.stringify({ username: `dbl${n}${Date.now().toString(36)}`, password: "pass1234", nickname: "并发", termsVersion: "v1" });
  const post = (n) =>
    fetch(`${ctx.base}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body(n),
    });
  const [a, b] = await Promise.all([post("a"), post("b")]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const grants = openDb()
    .prepare("SELECT COUNT(*) AS n FROM jiu_coin_ledger WHERE user_id = ? AND reason = 'register_grant'")
    .get(g.user.id).n;
  assert.equal(grants, 1, "exactly one register grant on the guest row");
});

test("logging in to an EXISTING account discards the guest and its data", async () => {
  const acct = await register(`ex${Date.now().toString(36)}`);
  const g = await newGuest();
  const first = await createGame(g);
  assert.equal(first.status, 201);

  const login = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: acct.username, password: acct.password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.data.user.id, acct.user.id);
  assert.equal(login.json.data.user.isGuest, false);

  const db = openDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(g.user.id).n, 0, "guest row gone");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE user_id = ?").get(g.user.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jiu_coin_ledger WHERE user_id = ?").get(g.user.id).n, 0);
});

test("a guest username can never be used to log in", async () => {
  const g = await newGuest();
  const row = openDb().prepare("SELECT username_normalized AS u FROM users WHERE id = ?").get(g.user.id);
  const r = await api("/api/v1/auth/login", { method: "POST", body: { username: row.u, password: "!" } });
  // normalizeUsername rejects the placeholder before any lookup: a person can never type a guest username.
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "INVALID_CREDENTIALS");
});

test("PVP websocket upgrade is closed to guests (defence in depth)", async () => {
  const g = await newGuest();
  const t = await api("/api/v1/pvp/ticket", { method: "POST", csrf: g.csrf, body: {} });
  assert.ok([403, 404].includes(t.status), `ticket -> ${t.status}`);
});

test("guest sessions slide to 30 days; other sessions keep the normal 7-day limit", async () => {
  const g = await newGuest();
  const token = jar[config.cookieName];
  const row = findValidSession(token);
  assert.ok(Date.parse(row.expires_at) - Date.now() > 29 * 86400_000);

  const acct = await register(`sess${Date.now().toString(36)}`);
  const row2 = findValidSession(jar[config.cookieName]);
  assert.ok(Date.parse(row2.expires_at) - Date.now() < 8 * 86400_000);
  assert.equal(row2.is_guest, 0);
  assert.ok(acct.user.id);
  assert.ok(g.user.id);
  assert.ok(typeof createSession === "function");
});

test("cleanup purges guests idle >30 days, keeps recent guests, registered users and guests with a live game", async () => {
  const db = openDb();
  const old = await newGuest();
  const recent = await newGuest();
  const liveGame = await newGuest();
  const lg = await createGame(liveGame);
  assert.equal(lg.status, 201);
  const registered = await register(`keep${Date.now().toString(36)}`);

  const longAgo = "2020-01-01 00:00:00";
  db.prepare("UPDATE users SET last_active_at = ?, created_at = ? WHERE id IN (?, ?)").run(longAgo, longAgo, old.user.id, liveGame.user.id);

  const res = purgeGuestUsers({ maxIdleMs: 30 * 86400_000 });
  assert.equal(res.skipped, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(old.user.id).n, 0, "idle guest purged");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(recent.user.id).n, 1, "recent guest kept");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(liveGame.user.id).n, 1, "guest with a running game kept");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(registered.user.id).n, 1, "registered user never purged");
});

test("cleanup removes a settled old guest together with its game, results, commands, ledger and sessions", async () => {
  const db = openDb();
  const g = await newGuest();
  const first = await createGame(g);
  const fin = await api(`/api/v1/games/${first.json.data.gameId}/finish`, {
    method: "POST",
    csrf: g.csrf,
    body: { actions: actionsObj(["buy", ...holds(28)]), finish: true },
  });
  assert.equal(fin.status, 201);
  db.prepare("UPDATE users SET last_active_at = '2020-01-01 00:00:00' WHERE id = ?").run(g.user.id);

  const res = purgeGuestUsers({ maxIdleMs: 30 * 86400_000 });
  assert.equal(res.skipped, 0);
  assert.equal(res.purged >= 1, true);
  for (const [table, col] of [["users", "id"], ["game_sessions", "user_id"], ["jiu_coin_ledger", "user_id"], ["sessions", "user_id"]]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(g.user.id).n, 0, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM game_results WHERE game_id = ?").get(first.json.data.gameId).n, 0);
});

test("purgeGuestUsers never touches a non-guest even when asked for its id", async () => {
  const acct = await register(`np${Date.now().toString(36)}`);
  const res = purgeGuestUsers({ ids: [acct.user.id] });
  assert.equal(res.purged, 0);
  assert.equal(openDb().prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(acct.user.id).n, 1);
});

test("admin analytics: guests are excluded from user counts and reported in a guest funnel", async () => {
  const before = getAdminAnalytics({ days: 30 });
  const g1 = await newGuest();
  const g2 = await newGuest();
  const f1 = await createGame(g2);
  await api(`/api/v1/games/${f1.json.data.gameId}/finish`, {
    method: "POST",
    csrf: g2.csrf,
    body: { actions: actionsObj(holds(29)), finish: true },
  });
  // g2 registers -> converted
  await api("/api/v1/auth/register", {
    method: "POST",
    body: { username: `fn${Date.now().toString(36)}`, password: "pass1234", nickname: "漏斗", termsVersion: "v1" },
  });
  const after = getAdminAnalytics({ days: 30 });
  assert.equal(after.guests.created - before.guests.created, 2);
  assert.equal(after.guests.converted - before.guests.converted, 1);
  assert.equal(after.guests.played - before.guests.played, 1);
  assert.equal(after.guests.settled - before.guests.settled, 1);
  assert.equal(after.guests.waiting - before.guests.waiting, 1);
  // only the converted guest became a registered user
  assert.equal(after.users.total - before.users.total, 1);
  assert.ok(g1.user.id);
});
