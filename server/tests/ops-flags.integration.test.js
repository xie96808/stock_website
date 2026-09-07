import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.REGISTRATION_ENABLED = "0";
process.env.CLOUD_GAMES_ENABLED = "0";
process.env.LEADERBOARD_ENABLED = "0";
process.env.ADMIN_ENABLED = "1";

// Force re-import of config-bound modules by using startTestServer after env set.
// helpers.closeDb + dynamic import happens inside startTestServer.


const { migrate } = await import("../src/db/migrate.js");
migrate();
const { hashPassword } = await import("../src/lib/crypto.js");
const { insertUser } = await import("../src/lib/users.js");
const password = "pass1234";
const passwordHash = await hashPassword(password);
insertUser({
  username: "opsflaguser",
  passwordHash,
  nickname: "开关",
  avatarId: 1,
  leaderboardOptIn: false,
});

const { closeDb } = await import("../src/db/connection.js");
closeDb();

const ctx = await startTestServer();

test("registration disabled returns 403", async () => {
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const { status, json } = await ctx.api("/api/v1/auth/register", {
    method: "POST",
    body: {
      username: "newopsuser",
      password: "pass1234",
      nickname: "新人",
      termsVersion: "v1",
    },
  });
  assert.equal(status, 403);
  assert.equal(json?.error?.code, "REGISTRATION_DISABLED");
});

test("cloud games disabled returns 403", async () => {
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const login = await ctx.api("/api/v1/auth/login", {
    method: "POST",
    body: { username: "opsflaguser", password },
  });
  assert.equal(login.status, 200);
  const csrf = login.json.data.csrfToken;
  const { status, json } = await ctx.api("/api/v1/games", {
    method: "POST",
    csrf,
    body: { fillMode: "next_open" },
  });
  assert.equal(status, 403);
  assert.equal(json?.error?.code, "CLOUD_GAMES_DISABLED");
});

test("leaderboard disabled returns 403", async () => {
  const { status, json } = await ctx.api("/api/v1/leaderboard?fillMode=next_open");
  assert.equal(status, 403);
  assert.equal(json?.error?.code, "LEADERBOARD_DISABLED");
});

test("config and ready expose feature flags and backup field", async () => {
  const cfg = await ctx.api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.registration, false);
  assert.equal(cfg.json.data.features.cloudGames, false);
  assert.equal(cfg.json.data.features.leaderboard, false);

  const ready = await ctx.api("/api/v1/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.json.data.status, "ready");
  assert.ok("backup" in ready.json.data);
  assert.equal(ready.json.data.features.cloudGames, false);
});

test("cleanup", async () => {
  await ctx.stop();
});
