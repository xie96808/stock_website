import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { api, register, stop, jar } = await startTestServer();
test.after(async () => { await stop(); });

const clearJar = () => { for (const k of Object.keys(jar)) delete jar[k]; };
const promote = (id) => openDb().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(id);
async function login(username, password) {
  clearJar();
  const r = await api("/api/v1/auth/login", { method: "POST", body: { username, password } });
  return r;
}
async function adminSession() {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const a = await register(`apw${stamp}`);
  promote(a.user.id);
  const l = await login(a.username, a.password);
  assert.equal(l.status, 200);
  return { ...a, csrf: l.json.data.csrfToken };
}

test("password reset: reauth required, temp password works, old fails, sessions revoked, audited", async () => {
  resetRateLimitBuckets();
  const victim = await register(`pwv${Date.now().toString(36)}`);
  const victimJar = { ...jar };
  const admin = await adminSession();
  // without reauth
  let r = await api(`/api/v1/admin/users/${victim.user.id}/password-reset`, { method: "POST", csrf: admin.csrf, body: { reason: "user asked" } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "ADMIN_REAUTH_REQUIRED");
  r = await api("/api/v1/admin/reauth", { method: "POST", csrf: admin.csrf, body: { password: admin.password } });
  assert.equal(r.status, 200);
  // reason required
  r = await api(`/api/v1/admin/users/${victim.user.id}/password-reset`, { method: "POST", csrf: admin.csrf, body: {} });
  assert.equal(r.status, 400);
  r = await api(`/api/v1/admin/users/${victim.user.id}/password-reset`, { method: "POST", csrf: admin.csrf, body: { reason: "user asked" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const temp = r.json.data.tempPassword;
  assert.match(temp, /^[A-Za-z2-9]{12}$/);
  assert.equal(r.res.headers.get("cache-control"), "no-store");
  // victim's old session revoked
  const live = openDb().prepare(`SELECT COUNT(*) c FROM sessions WHERE user_id=? AND revoked_at IS NULL`).get(victim.user.id).c;
  assert.equal(live, 0);
  void victimJar;
  // audit row without secret
  const audit = openDb().prepare(`SELECT * FROM audit_logs WHERE action='user.password_reset' AND target_id=?`).get(String(victim.user.id));
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit).includes(temp));
  // old password fails, temp works
  assert.equal((await login(victim.username, victim.password)).status, 401);
  assert.equal((await login(victim.username, temp)).status, 200);
});

test("password reset refuses self, other admins, deleted; rate limited per target", async () => {
  resetRateLimitBuckets();
  const other = await adminSession();
  const admin = await adminSession();
  await api("/api/v1/admin/reauth", { method: "POST", csrf: admin.csrf, body: { password: admin.password } });
  let r = await api(`/api/v1/admin/users/${admin.user.id}/password-reset`, { method: "POST", csrf: admin.csrf, body: { reason: "x" } });
  assert.equal(r.json.error.code, "SELF_RESET");
  r = await api(`/api/v1/admin/users/${other.user.id}/password-reset`, { method: "POST", csrf: admin.csrf, body: { reason: "x" } });
  assert.equal(r.json.error.code, "ADMIN_TARGET");
  const gone = await register(`pwd${Date.now().toString(36)}`);
  openDb().prepare(`UPDATE users SET status='deleted' WHERE id=?`).run(gone.user.id);
  clearJar();
  const l = await login(admin.username, admin.password);
  const csrf = l.json.data.csrfToken;
  await api("/api/v1/admin/reauth", { method: "POST", csrf, body: { password: admin.password } });
  r = await api(`/api/v1/admin/users/${gone.user.id}/password-reset`, { method: "POST", csrf, body: { reason: "x" } });
  assert.equal(r.json.error.code, "USER_DELETED");
  const t = await register(`pwt${Date.now().toString(36)}`);
  clearJar();
  const l2 = await login(admin.username, admin.password);
  const c2 = l2.json.data.csrfToken;
  await api("/api/v1/admin/reauth", { method: "POST", csrf: c2, body: { password: admin.password } });
  for (let i = 0; i < 3; i += 1) {
    r = await api(`/api/v1/admin/users/${t.user.id}/password-reset`, { method: "POST", csrf: c2, body: { reason: "x" } });
    assert.equal(r.status, 200);
  }
  r = await api(`/api/v1/admin/users/${t.user.id}/password-reset`, { method: "POST", csrf: c2, body: { reason: "x" } });
  assert.equal(r.status, 429);
});

test("non-admin cannot reset; user detail includes pvp stats", async () => {
  resetRateLimitBuckets();
  const u = await register(`pwn${Date.now().toString(36)}`);
  let r = await api(`/api/v1/admin/users/${u.user.id}/password-reset`, { method: "POST", csrf: u.csrfToken, body: { reason: "x" } });
  assert.equal(r.status, 403);
  const admin = await adminSession();
  r = await api(`/api/v1/admin/users/${u.user.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.data.user);
  assert.ok(r.json.data.pvp && typeof r.json.data.pvp.wins === "number", JSON.stringify(r.json.data.pvp));
  void admin;
});
