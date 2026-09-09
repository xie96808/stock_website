import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { replayUserTombstones, listActiveTombstones } = await import("../src/lib/tombstones.js");
const { findValidSession } = await import("../src/lib/sessions.js");
const { sha256Hex } = await import("../src/lib/crypto.js");

config.adminEnabled = true;

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

/** Tighten limits for Phase 0 rate-limit assertions (helpers start with high ceilings). */
function tightenRateLimits() {
  config.rateLimit.loginFailPerAccountIp = 3;
  config.rateLimit.loginFailPerIp = 50;
  config.rateLimit.createGamePerUserMinute = 3;
  config.rateLimit.createGamePerUserDay = 50;
  resetRateLimitBuckets();
}

test.after(async () => {
  await stop();
});

function clearJar() {
  for (const k of Object.keys(jar)) delete jar[k];
}

function assertOk(status, json, expectStatus) {
  assert.equal(status, expectStatus, JSON.stringify(json));
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
}

test("rate limit: login failures return 429 Chinese error", async () => {
  tightenRateLimits();
  const stamp = Date.now().toString(36);
  const user = await register(`rl${stamp}`);
  clearJar();

  for (let i = 0; i < 3; i++) {
    const r = await api("/api/v1/auth/login", {
      method: "POST",
      body: { username: user.username, password: "wrong-password" },
    });
    assert.equal(r.status, 401, `fail ${i}`);
  }
  const limited = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: user.username, password: "wrong-password" },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.json?.error?.code, "RATE_LIMITED");
  assert.match(limited.json?.error?.message || "", /登录|频繁|稍后再试/);
  assert.ok(limited.res.headers.get("retry-after"));

  // correct password also blocked while limited
  const blockedOk = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: user.username, password: user.password },
  });
  assert.equal(blockedOk.status, 429);
  resetRateLimitBuckets();
});

test("rate limit: create-game burst returns 429", async () => {
  tightenRateLimits();
  const stamp = Date.now().toString(36);
  const auth = await register(`cg${stamp}`);

  let saw429 = false;
  for (let i = 0; i < 6; i++) {
    const r = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `cg-burst-${stamp}-${i}` },
      body: { fillMode: "next_open" },
    });
    if (r.status === 429) {
      saw429 = true;
      assert.equal(r.json?.error?.code, "RATE_LIMITED");
      assert.match(r.json?.error?.message || "", /开局|频繁/);
      break;
    }
    // abandon so next create is allowed by active-game rule
    if (r.status === 201 && r.json?.data?.gameId) {
      await api(`/api/v1/games/${r.json.data.gameId}/abandon`, {
        method: "POST",
        csrf: auth.csrfToken,
      });
    }
  }
  assert.equal(saw429, true);
  resetRateLimitBuckets();
});

test("absolute session expiry: idle refresh cannot extend past created_at+absolute", async () => {
  const stamp = Date.now().toString(36);
  const auth = await register(`sess${stamp}`);
  const cookieName = config.cookieName;
  const token = jar[cookieName];
  assert.ok(token);

  const tokenHash = sha256Hex(token);
  const pastCreated = new Date(Date.now() - config.sessionAbsoluteMs - 60_000).toISOString();
  openDb()
    .prepare(
      `UPDATE sessions SET created_at = ?, last_seen_at = datetime('now', '-10 minutes'),
        expires_at = datetime('now', '+1 day') WHERE token_hash = ?`
    )
    .run(pastCreated, tokenHash);

  const row = findValidSession(token);
  assert.equal(row, null);

  const me = await api("/api/v1/me");
  assert.equal(me.status, 401);
});

test("tombstone written on self-delete; replay keeps deleted", async () => {
  const stamp = Date.now().toString(36);
  const auth = await register(`tomb${stamp}`);
  const userId = auth.user.id;

  const del = await api("/api/v1/me", {
    method: "DELETE",
    csrf: auth.csrfToken,
    body: { currentPassword: auth.password, confirmation: "DELETE" },
  });
  assert.equal(del.status, 204);

  const stones = listActiveTombstones().filter((t) => t.user_id === userId);
  assert.equal(stones.length, 1);
  assert.equal(stones[0].source, "self");

  // Simulate restore resurrection then replay
  openDb()
    .prepare(
      `UPDATE users SET status = 'active', deleted_at = NULL, password_hash = 'restored',
        updated_at = datetime('now') WHERE id = ?`
    )
    .run(userId);

  const result = replayUserTombstones();
  assert.ok(result.applied >= 1);
  const row = openDb().prepare("SELECT status FROM users WHERE id = ?").get(userId);
  assert.equal(row.status, "deleted");
});

test("admin soft-delete + restore with reauth, reason, audit", async () => {
  resetRateLimitBuckets();
  const stamp = Date.now().toString(36);
  const victim = await register(`vic${stamp}`);
  const adminReg = await register(`adm${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);

  const denied = await api(`/api/v1/admin/users/${victim.user.id}/soft-delete`, {
    method: "POST",
    csrf: admin.csrfToken,
    body: { reason: "违规清理" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json?.error?.code, "ADMIN_REAUTH_REQUIRED");

  await reauth(admin.csrfToken, adminReg.password);

  const noReason = await api(`/api/v1/admin/users/${victim.user.id}/soft-delete`, {
    method: "POST",
    csrf: admin.csrfToken,
    body: { reason: " " },
  });
  assert.equal(noReason.status, 400);

  const soft = await api(`/api/v1/admin/users/${victim.user.id}/soft-delete`, {
    method: "POST",
    csrf: admin.csrfToken,
    body: { reason: "违规清理账号" },
  });
  assertOk(soft.status, soft.json, 200);
  assert.equal(soft.json.data.user.status, "deleted");

  const stones = listActiveTombstones().filter((t) => t.user_id === victim.user.id);
  assert.ok(stones.some((t) => t.source === "admin"));

  // victim cannot login
  clearJar();
  const loginFail = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: victim.username, password: victim.password },
  });
  assert.equal(loginFail.status, 401);

  const admin2 = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin2.csrfToken, adminReg.password);

  // search deleted
  const search = await api(`/api/v1/admin/users?status=deleted&q=${victim.user.id}`);
  assertOk(search.status, search.json, 200);
  assert.ok(search.json.data.items.some((u) => u.id === victim.user.id));

  const restore = await api(`/api/v1/admin/users/${victim.user.id}/restore`, {
    method: "POST",
    csrf: admin2.csrfToken,
    body: { reason: "误删恢复" },
  });
  assertOk(restore.status, restore.json, 200);
  assert.equal(restore.json.data.user.status, "active");

  const activeStones = listActiveTombstones().filter((t) => t.user_id === victim.user.id);
  assert.equal(activeStones.length, 0);

  const audit = await api(
    `/api/v1/admin/audit-logs?targetType=user&targetId=${victim.user.id}`
  );
  assertOk(audit.status, audit.json, 200);
  assert.ok(audit.json.data.items.some((a) => a.action === "user.soft_delete"));
  assert.ok(audit.json.data.items.some((a) => a.action === "user.restore"));

  // can login again
  const again = await loginAs(victim.username, victim.password);
  assert.equal(again.user.status, "active");
});

test("ban/unban still works alongside soft-delete APIs", async () => {
  resetRateLimitBuckets();
  const stamp = Date.now().toString(36);
  const victim = await register(`ban${stamp}`);
  const adminReg = await register(`admb${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin.csrfToken, adminReg.password);

  const ban = await api(`/api/v1/admin/users/${victim.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "disabled", reason: "临时禁用" },
  });
  assertOk(ban.status, ban.json, 200);
  assert.equal(ban.json.data.user.status, "disabled");

  const unban = await api(`/api/v1/admin/users/${victim.user.id}/status`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "active", reason: "解除禁用" },
  });
  assertOk(unban.status, unban.json, 200);
  assert.equal(unban.json.data.user.status, "active");
});
