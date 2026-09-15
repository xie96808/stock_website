import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer, cookieHeader } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");

const ctx = await startTestServer();
const { api, register, stop, jar, base } = ctx;

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

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function postMultipartFeedback({ csrf, bodyText, images = [] }) {
  const boundary = "----fbBoundary7MA4YWxk";
  const parts = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n${bodyText}\r\n`
    )
  );
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="a${i}.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      img,
      Buffer.from("\r\n")
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const h = {
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "X-CSRF-Token": csrf,
    Cookie: cookieHeader(jar),
  };
  const res = await fetch(`${base}/api/v1/feedback`, { method: "POST", headers: h, body });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test("unauthenticated feedback returns 401", async () => {
  clearJar();
  const r = await api("/api/v1/feedback", {
    method: "POST",
    body: { body: "hello" },
  });
  assert.equal(r.status, 401);
  assert.equal(r.json?.error?.code, "UNAUTHORIZED");
});

test("text-only feedback creates row; empty body rejected", async () => {
  const auth = await register(`fb${Date.now().toString(36)}`);
  const bad = await api("/api/v1/feedback", {
    method: "POST",
    csrf: auth.csrfToken,
    body: { body: "   " },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json?.error?.code, "INVALID_BODY");

  const ok = await api("/api/v1/feedback", {
    method: "POST",
    csrf: auth.csrfToken,
    body: { body: "首页点头像后希望能反馈卡顿问题" },
  });
  assertOk(ok.status, ok.json, 201);
  const fb = ok.json.data.feedback;
  assert.ok(fb.id);
  assert.equal(fb.body, "首页点头像后希望能反馈卡顿问题");
  assert.equal(fb.status, "new");
  assert.equal(fb.imageCount, 0);
});

test("multipart feedback with image stores file and admin can list/view", async () => {
  const stamp = Date.now().toString(36);
  const user = await register(`fbi${stamp}`, "pass1234");
  const created = await postMultipartFeedback({
    csrf: user.csrfToken,
    bodyText: "附图：结算页空白",
    images: [PNG_1X1],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const fb = created.json.data.feedback;
  assert.equal(fb.imageCount, 1);
  assert.ok(fb.id);

  // Non-admin cannot list
  const denied = await api("/api/v1/admin/feedback");
  assert.equal(denied.status, 403);

  // Promote + re-login as admin
  promoteToAdmin(user.user.id);
  const admin = await loginAs(user.username, "pass1234");
  await reauth(admin.csrfToken, "pass1234");

  const list = await api("/api/v1/admin/feedback");
  assertOk(list.status, list.json, 200);
  assert.ok(list.json.data.items.some((x) => x.id === fb.id));
  assert.equal(list.json.data.items[0].id, Math.max(...list.json.data.items.map((x) => x.id)));

  const detail = await api(`/api/v1/admin/feedback/${fb.id}`);
  assertOk(detail.status, detail.json, 200);
  assert.equal(detail.json.data.feedback.body, "附图：结算页空白");
  assert.equal(detail.json.data.feedback.images.length, 1);

  const imgUrl = detail.json.data.feedback.images[0].url;
  const imgRes = await fetch(`${base}${imgUrl}`, {
    headers: { Cookie: cookieHeader(jar) },
  });
  assert.equal(imgRes.status, 200);
  assert.match(imgRes.headers.get("content-type") || "", /image\/png/);

  const marked = await api(`/api/v1/admin/feedback/${fb.id}`, {
    method: "PATCH",
    csrf: admin.csrfToken,
    body: { status: "read" },
  });
  assertOk(marked.status, marked.json, 200);
  assert.equal(marked.json.data.feedback.status, "read");
});

test("feedback rate limit returns 429", async () => {
  const auth = await register(`fbrl${Date.now().toString(36)}`);
  // Tighten only for this test, then restore high limits used by suite helpers.
  config.rateLimit.feedbackPerUserHour = 2;
  config.rateLimit.feedbackPerIpHour = 10_000;
  resetRateLimitBuckets();

  const a = await api("/api/v1/feedback", {
    method: "POST",
    csrf: auth.csrfToken,
    body: { body: "rate-1" },
  });
  assertOk(a.status, a.json, 201);
  const b = await api("/api/v1/feedback", {
    method: "POST",
    csrf: auth.csrfToken,
    body: { body: "rate-2" },
  });
  assertOk(b.status, b.json, 201);
  const c = await api("/api/v1/feedback", {
    method: "POST",
    csrf: auth.csrfToken,
    body: { body: "rate-3" },
  });
  assert.equal(c.status, 429);
  assert.equal(c.json?.error?.code, "RATE_LIMITED");

  config.rateLimit.feedbackPerUserHour = 10_000;
  config.rateLimit.feedbackPerIpHour = 10_000;
  resetRateLimitBuckets();
});
