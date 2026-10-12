import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";
import { normalizeSignature } from "../src/lib/validate.js";
import { openDb } from "../src/db/connection.js";

prepareTestEnv();
const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("normalizeSignature trims and caps at 40", () => {
  assert.equal(normalizeSignature("  你好世界  "), "你好世界");
  assert.equal(normalizeSignature(""), "");
  assert.equal(normalizeSignature("a".repeat(40)), "a".repeat(40));
  assert.equal(normalizeSignature("a".repeat(41)), null);
});

test("users.signature column exists after migrations", () => {
  const cols = openDb().prepare(`PRAGMA table_info(users)`).all().map((r) => r.name);
  assert.equal(cols.includes("signature"), true);
});

test("PATCH /me signature persists and clears", async () => {
  const auth = await register(`sig${Date.now().toString(36)}`);
  const patch = await api("/api/v1/me", {
    method: "PATCH",
    csrf: auth.csrfToken,
    body: { signature: "满仓才是真爱" },
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.json));
  assert.equal(patch.json.data.user.signature, "满仓才是真爱");

  const me = await api("/api/v1/me", { csrf: auth.csrfToken });
  assert.equal(me.json.data.user.signature, "满仓才是真爱");

  const clear = await api("/api/v1/me", {
    method: "PATCH",
    csrf: auth.csrfToken,
    body: { signature: "   " },
  });
  assert.equal(clear.status, 200, JSON.stringify(clear.json));
  assert.equal(clear.json.data.user.signature, "");
});

test("PATCH /me rejects signature over 40 chars", async () => {
  const auth = await register(`sigx${Date.now().toString(36)}`);
  const bad = await api("/api/v1/me", {
    method: "PATCH",
    csrf: auth.csrfToken,
    body: { signature: "字".repeat(41) },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "INVALID_SIGNATURE");
});
