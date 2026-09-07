import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";
import { validatePassword } from "../src/lib/validate.js";

prepareTestEnv();
const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;

test.after(async () => {
  await stop();
});

test("Stage2 AUTH register+login+me+logout", async () => {
  const auth = await register(`auth${Date.now().toString(36)}`);
  assert.ok(auth.csrfToken);
  assert.ok(auth.user.id);

  const me = await api("/api/v1/me", { csrf: auth.csrfToken });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.user.username, auth.username);

  const logout = await api("/api/v1/auth/logout", {
    method: "POST",
    csrf: auth.csrfToken,
  });
  assert.equal(logout.status, 204);

  const me2 = await api("/api/v1/me");
  assert.equal(me2.status, 401);
});

test("Stage2 AUTH username uniqueness case-insensitive", async () => {
  const name = `case${Date.now().toString(36)}`;
  const a = await register(name);
  assert.ok(a.user);
  for (const k of Object.keys(jar)) delete jar[k];
  const b = await api("/api/v1/auth/register", {
    method: "POST",
    body: {
      username: name.toUpperCase(),
      password: "pass1234",
      nickname: "另一人",
      termsVersion: "v1",
    },
  });
  assert.equal(b.status, 409);
  assert.equal(b.json.error.code, "USERNAME_TAKEN");
});

test("password policy min4 unicode, allow simple", () => {
  assert.match(validatePassword("123") || "", /4/);
  assert.equal(validatePassword("1234"), null);
  assert.equal(validatePassword("abcd"), null);
  assert.equal(validatePassword("password"), null);
  assert.equal(validatePassword("pass1234"), null);
  assert.equal(validatePassword("好好学习"), null);
  assert.equal(validatePassword("GoodPass9"), null);
});

test("register rejects too-short passwords but allows simple ones", async () => {
  for (const k of Object.keys(jar)) delete jar[k];
  const short = await api("/api/v1/auth/register", {
    method: "POST",
    body: { username: `pw${Date.now().toString(36)}a`, password: "abc", nickname: "测友", termsVersion: "v1" },
  });
  assert.equal(short.status, 400);
  assert.equal(short.json.error.code, "INVALID_PASSWORD");

  const simple = await api("/api/v1/auth/register", {
    method: "POST",
    body: { username: `pw${Date.now().toString(36)}b`, password: "1234", nickname: "测友", termsVersion: "v1" },
  });
  assert.equal(simple.status, 201, JSON.stringify(simple.json));
  assert.ok(simple.json.data.user);
});

test("avatar upload png + serve", async () => {
  const auth = await register(`av${Date.now().toString(36)}`);
  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const boundary = "----stockBoundary7MA4YWxk";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const h = {
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "X-CSRF-Token": auth.csrfToken,
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
  };
  const res = await fetch(`${ctx.base}/api/v1/me/avatar`, { method: "POST", headers: h, body });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.ok(json.data.user.avatarUrl);
  assert.match(json.data.user.avatarUrl, /^\/api\/v1\/avatars\/[a-f0-9]+\.png$/);

  const get = await fetch(`${ctx.base}${json.data.user.avatarUrl}`);
  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type") || "", /image\/png/);
  const got = Buffer.from(await get.arrayBuffer());
  assert.ok(got.length >= 8);
  assert.equal(got[0], 0x89);
});
