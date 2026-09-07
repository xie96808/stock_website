import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, holds, actionsObj } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { forceResultRanking } = await import("../src/lib/leaderboard.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

test.after(async () => {
  await stop();
});

function assertOk(status, json, expectStatus) {
  assert.equal(status, expectStatus, JSON.stringify(json));
  assert.ok(json?.data != null || expectStatus === 204);
}

function clearJar() {
  for (const k of Object.keys(jar)) delete jar[k];
}

function promoteToAdmin(userId) {
  openDb()
    .prepare(`UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE id = ?`)
    .run(userId);
}

async function loginAs(username, password) {
  clearJar();
  const r = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assertOk(r.status, r.json, 200);
  return { user: r.json.data.user, csrfToken: r.json.data.csrfToken };
}

async function reauth(csrf, password) {
  const r = await api("/api/v1/admin/reauth", {
    method: "POST",
    csrf,
    body: { password },
  });
  assertOk(r.status, r.json, 200);
  assert.ok(r.json.data.verifiedAt);
  return r.json.data;
}

async function settleBuySell(auth, fillMode, key) {
  const create = await api("/api/v1/games", {
    method: "POST",
    csrf: auth.csrfToken,
    headers: { "Idempotency-Key": key },
    body: {
      fillMode,
      pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
    },
  });
  assertOk(create.status, create.json, 201);
  const gameId = create.json.data.gameId;
  const finish = await api(`/api/v1/games/${gameId}/finish`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { actions: actionsObj(["buy", "sell", ...holds(27)]), finish: true },
  });
  assertOk(finish.status, finish.json, 201);
  return gameId;
}

test("admin API 404 when ADMIN_ENABLED off", async () => {
  const prev = process.env.ADMIN_ENABLED;
  process.env.ADMIN_ENABLED = "0";
  // config module already loaded with ADMIN_ENABLED=1 — verify gate via dynamic check:
  // Instead hit with a forged path by temporarily flipping config.
  const { config } = await import("../src/lib/config.js");
  const was = config.adminEnabled;
  config.adminEnabled = false;
  try {
    const auth = await register(`admd${Date.now().toString(36)}`);
    promoteToAdmin(auth.user.id);
    const admin = await loginAs(auth.username, auth.password);
    const r = await api("/api/v1/admin/session");
    assert.equal(r.status, 404);
    assert.equal(r.json?.error?.code, "NOT_FOUND");
  } finally {
    config.adminEnabled = was;
    process.env.ADMIN_ENABLED = prev;
  }
});

test("non-admin cannot call admin API", async () => {
  const auth = await register(`adnu${Date.now().toString(36)}`);
  const r = await api("/api/v1/admin/session");
  assert.equal(r.status, 403);
  assert.equal(r.json?.error?.code, "FORBIDDEN");
});

test("ban user revokes session, drops from leaderboard, writes audit", async () => {
  const stamp = Date.now().toString(36);
  const victimReg = await register(`vic${stamp}`);
  // opt in + settle ranked game
  const opt = await api("/api/v1/me", {
    method: "PATCH",
    csrf: victimReg.csrfToken,
    body: { leaderboardOptIn: true },
  });
  assertOk(opt.status, opt.json, 200);
  const gameId = await settleBuySell(victimReg, "next_open", `ban-g-${stamp}`);
  forceResultRanking(gameId, {
    returnPpm: 654321,
    finishedAt: "2026-09-07T12:00:00.000Z",
  });

  let board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 654321));

  const adminReg = await register(`adm${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);

  // write without reauth → 403
  const denied = await api(`/api/v1/admin/users/${victimReg.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "disabled", reason: "刷榜测试" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json?.error?.code, "ADMIN_REAUTH_REQUIRED");

  await reauth(admin.csrfToken, adminReg.password);

  const ban = await api(`/api/v1/admin/users/${victimReg.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "disabled", reason: "刷榜测试禁用" },
  });
  assertOk(ban.status, ban.json, 200);
  assert.equal(ban.json.data.user.status, "disabled");

  // victim session should no longer work
  clearJar();
  // restore victim cookie by logging in — should fail as disabled
  const loginDisabled = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: victimReg.username, password: victimReg.password },
  });
  assert.equal(loginDisabled.status, 401);

  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 654321));

  // re-login admin and check audit
  const admin2 = await loginAs(adminReg.username, adminReg.password);
  const audit = await api("/api/v1/admin/audit-logs?targetType=user&targetId=" + victimReg.user.id);
  assertOk(audit.status, audit.json, 200);
  assert.ok(audit.json.data.items.some((a) => a.action === "user.disable"));
  const entry = audit.json.data.items.find((a) => a.action === "user.disable");
  assert.equal(entry.reason, "刷榜测试禁用");
  assert.equal(entry.after?.status, "disabled");
  assert.ok(entry.requestId);

  // unban
  await reauth(admin2.csrfToken, adminReg.password);
  const unban = await api(`/api/v1/admin/users/${victimReg.user.id}/status`, {
    method: "PATCH",
    csrf: admin2.csrfToken,
    body: { status: "active", reason: "误封恢复" },
  });
  assertOk(unban.status, unban.json, 200);
  assert.equal(unban.json.data.user.status, "active");

  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 654321));
});

test("unlist and invalidate with audit; next best can appear", async () => {
  const stamp = Date.now().toString(36);
  const player = await register(`pl${stamp}`);
  await api("/api/v1/me", {
    method: "PATCH",
    csrf: player.csrfToken,
    body: { leaderboardOptIn: true },
  });
  const best = await settleBuySell(player, "next_open", `ul-best-${stamp}`);
  forceResultRanking(best, {
    returnPpm: 900100,
    finishedAt: "2026-09-07T13:00:00.000Z",
  });
  const second = await settleBuySell(player, "next_open", `ul-2nd-${stamp}`);
  forceResultRanking(second, {
    returnPpm: 500100,
    finishedAt: "2026-09-07T13:30:00.000Z",
  });

  let board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 900100));
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 500100));

  const adminReg = await register(`adm2${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin.csrfToken, adminReg.password);

  // missing reason
  const bad = await api(`/api/v1/admin/games/${best}/moderation`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { action: "unlist", reason: " " },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json?.error?.code, "REASON_REQUIRED");

  const unlist = await api(`/api/v1/admin/games/${best}/moderation`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { action: "unlist", reason: "异常成绩仅下榜" },
  });
  assertOk(unlist.status, unlist.json, 200);
  assert.equal(unlist.json.data.game.leaderboardHidden, true);
  assert.equal(unlist.json.data.game.validity, "valid");

  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 900100));
  // next best should seat
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 500100));

  const auditUnlist = await api(
    `/api/v1/admin/audit-logs?targetType=game&targetId=${encodeURIComponent(best)}`
  );
  assertOk(auditUnlist.status, auditUnlist.json, 200);
  assert.ok(auditUnlist.json.data.items.some((a) => a.action === "game.unlist"));

  // invalidate second — removed from board and personal validity
  const inv = await api(`/api/v1/admin/games/${second}/moderation`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { action: "invalidate", reason: "判无效：规则外" },
  });
  assertOk(inv.status, inv.json, 200);
  assert.equal(inv.json.data.game.validity, "invalid");

  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(!board.json.data.top10.some((r) => r.returnPpm === 500100));

  const auditInv = await api(
    `/api/v1/admin/audit-logs?action=game.invalidate&targetId=${encodeURIComponent(second)}`
  );
  assertOk(auditInv.status, auditInv.json, 200);
  assert.ok(auditInv.json.data.items.length >= 1);
  assert.equal(auditInv.json.data.items[0].reason, "判无效：规则外");

  // restore + relist
  const restore = await api(`/api/v1/admin/games/${second}/moderation`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { action: "restore", reason: "复核后恢复有效" },
  });
  assertOk(restore.status, restore.json, 200);
  assert.equal(restore.json.data.game.validity, "valid");

  const relist = await api(`/api/v1/admin/games/${best}/moderation`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { action: "relist", reason: "恢复展示" },
  });
  assertOk(relist.status, relist.json, 200);
  assert.equal(relist.json.data.game.leaderboardHidden, false);

  board = await api("/api/v1/leaderboard?fillMode=next_open");
  assertOk(board.status, board.json, 200);
  assert.ok(board.json.data.top10.some((r) => r.returnPpm === 900100));
});

test("cannot disable self; reason required for ban", async () => {
  const stamp = Date.now().toString(36);
  const adminReg = await register(`adm3${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin.csrfToken, adminReg.password);

  const self = await api(`/api/v1/admin/users/${admin.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "disabled", reason: "自禁测试" },
  });
  assert.equal(self.status, 400);
  assert.equal(self.json?.error?.code, "CANNOT_DISABLE_SELF");

  const noReason = await api(`/api/v1/admin/users/${admin.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "active", reason: "" },
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json?.error?.code, "REASON_REQUIRED");
});

test("config reflects adminEnabled when on", async () => {
  const cfg = await api("/api/v1/config");
  assertOk(cfg.status, cfg.json, 200);
  assert.equal(cfg.json.data.features.adminPublic, false);
  assert.equal(cfg.json.data.features.adminEnabled, true);
});
