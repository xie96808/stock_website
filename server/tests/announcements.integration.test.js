import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");

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
  return r.json.data;
}

const SEED_BODY = "欢迎各位来访！登录后再开玩，和我的朋友们一起 PK～";

test("public list returns published seed newest-first; hides draft/archived", async () => {
  clearJar();
  const pub = await api("/api/v1/announcements");
  assertOk(pub.status, pub.json, 200);
  const items = pub.json.data.items;
  assert.ok(Array.isArray(items));
  assert.ok(items.some((n) => n.body === SEED_BODY), "seed notice present");
  for (const n of items) {
    assert.ok(n.id);
    assert.equal(typeof n.body, "string");
    assert.ok(n.publishedAt);
    assert.equal(n.status, undefined, "public payload omits status");
  }

  // Insert draft + archived directly; public must ignore them
  const db = openDb();
  db.prepare(
    `INSERT INTO announcements (title, body, status, published_at)
     VALUES ('draft-t', 'draft-body-hidden', 'draft', NULL)`
  ).run();
  db.prepare(
    `INSERT INTO announcements (title, body, status, published_at)
     VALUES ('arch-t', 'archived-body-hidden', 'archived', datetime('now'))`
  ).run();
  db.prepare(
    `INSERT INTO announcements (title, body, status, published_at)
     VALUES ('newer', 'newer published', 'published', datetime('now', '+1 minute'))`
  ).run();

  const pub2 = await api("/api/v1/announcements");
  assertOk(pub2.status, pub2.json, 200);
  const bodies = pub2.json.data.items.map((n) => n.body);
  assert.ok(!bodies.includes("draft-body-hidden"));
  assert.ok(!bodies.includes("archived-body-hidden"));
  assert.equal(bodies[0], "newer published");
});

test("non-admin cannot mutate announcements; admin needs reauth for CRUD", async () => {
  const stamp = Date.now().toString(36);
  const user = await register(`anu${stamp}`);
  const denied = await api("/api/v1/admin/announcements", {
    method: "POST",
    csrf: user.csrfToken,
    body: { body: "nope", status: "published" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json?.error?.code, "FORBIDDEN");

  const adminReg = await register(`ana${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);

  const needReauth = await api("/api/v1/admin/announcements", {
    method: "POST",
    csrf: admin.csrfToken,
    body: { title: "t1", body: "admin draft", status: "draft" },
  });
  assert.equal(needReauth.status, 403);
  assert.equal(needReauth.json?.error?.code, "ADMIN_REAUTH_REQUIRED");

  await reauth(admin.csrfToken, adminReg.password);

  const created = await api("/api/v1/admin/announcements", {
    method: "POST",
    csrf: admin.csrfToken,
    body: { title: "上线提示", body: "第二则公告内容", status: "draft" },
  });
  assertOk(created.status, created.json, 201);
  const id = created.json.data.announcement.id;
  assert.equal(created.json.data.announcement.status, "draft");

  // draft not public
  clearJar();
  let pub = await api("/api/v1/announcements");
  assert.ok(!pub.json.data.items.some((n) => n.id === id));

  const admin2 = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin2.csrfToken, adminReg.password);

  const published = await api(`/api/v1/admin/announcements/${id}`, {
    method: "PATCH",
    csrf: admin2.csrfToken,
    body: { status: "published" },
  });
  assertOk(published.status, published.json, 200);
  assert.equal(published.json.data.announcement.status, "published");
  assert.ok(published.json.data.announcement.publishedAt);

  clearJar();
  pub = await api("/api/v1/announcements");
  assert.ok(pub.json.data.items.some((n) => n.id === id && n.body === "第二则公告内容"));

  const admin3 = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin3.csrfToken, adminReg.password);
  const archived = await api(`/api/v1/admin/announcements/${id}/archive`, {
    method: "POST",
    csrf: admin3.csrfToken,
    body: {},
  });
  assertOk(archived.status, archived.json, 200);
  assert.equal(archived.json.data.announcement.status, "archived");

  clearJar();
  pub = await api("/api/v1/announcements");
  assert.ok(!pub.json.data.items.some((n) => n.id === id));

  // audit trail
  const admin4 = await loginAs(adminReg.username, adminReg.password);
  const audit = await api(
    `/api/v1/admin/audit-logs?targetType=announcement&targetId=${id}`
  );
  assertOk(audit.status, audit.json, 200);
  const actions = audit.json.data.items.map((a) => a.action);
  assert.ok(actions.includes("announcement.create"));
  assert.ok(actions.some((a) => a === "announcement.update" || a === "announcement.archive"));
});

test("admin list can filter by status", async () => {
  const stamp = Date.now().toString(36);
  const adminReg = await register(`anl${stamp}`);
  promoteToAdmin(adminReg.user.id);
  const admin = await loginAs(adminReg.username, adminReg.password);
  await reauth(admin.csrfToken, adminReg.password);

  const list = await api("/api/v1/admin/announcements?status=published");
  assertOk(list.status, list.json, 200);
  assert.ok(list.json.data.items.every((a) => a.status === "published"));
  assert.ok(list.json.data.items.some((a) => a.body === SEED_BODY));
});
