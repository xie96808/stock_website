import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

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
