import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config, OVERRIDABLE_KEYS, clearSettingOverrides } = await import("../src/lib/config.js");
const { loadAppSettings } = await import("../src/lib/appSettings.js");
const { currentEconomy } = await import("../src/lib/pvp/config.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { api, register, stop, jar } = await startTestServer();
test.after(async () => { await stop(); });

const clearJar = () => { for (const k of Object.keys(jar)) delete jar[k]; };
async function adminSession({ verify = true } = {}) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const a = await register(`ast${stamp}`);
  openDb().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(a.user.id);
  clearJar();
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: a.username, password: a.password } });
  const csrf = l.json.data.csrfToken;
  if (verify) await api("/api/v1/admin/reauth", { method: "POST", csrf, body: { password: a.password } });
  return { ...a, csrf };
}
const put = (s, key, body) => api(`/api/v1/admin/settings/${key}`, { method: "PUT", csrf: s.csrf, body });

test("defaults: no rows => every value equals env/config; public features unchanged", async () => {
  resetRateLimitBuckets();
  assert.equal(openDb().prepare("SELECT COUNT(*) c FROM app_settings").get().c, 0);
  const s = await adminSession();
  const r = await api("/api/v1/admin/settings");
  assert.equal(r.status, 200);
  assert.equal(r.json.data.items.length, OVERRIDABLE_KEYS.length);
  for (const it of r.json.data.items) {
    assert.equal(it.overridden, false, it.key);
    assert.deepEqual(it.value, it.envValue, it.key);
  }
  const pub = await api("/api/v1/config");
  assert.equal(pub.json.data.features.registration, true);
  assert.equal(pub.json.data.features.pvpBattle, config.pvpBattleEnabled);
  void s;
});

test("writes need reauth, valid key/value and reason; audited; reset restores env", async () => {
  resetRateLimitBuckets();
  const nv = await adminSession({ verify: false });
  let r = await put(nv, "registrationEnabled", { value: false, reason: "维护中" });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "ADMIN_REAUTH_REQUIRED");
  const s = await adminSession();
  assert.equal((await put(s, "nope", { value: true, reason: "维护中" })).status, 404);
  assert.equal((await put(s, "registrationEnabled", { value: "no", reason: "维护中" })).status, 400);
  assert.equal((await put(s, "registrationEnabled", { value: false })).status, 400);
  assert.equal((await put(s, "pvpEntryCost", { value: 0, reason: "维护中" })).status, 400);
  assert.equal((await put(s, "pvpBotTier", { value: "hard", reason: "维护中" })).status, 400);
  r = await put(s, "registrationEnabled", { value: false, reason: "维护中" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.setting.overridden, true);
  assert.equal(config.registrationEnabled, false);
  assert.equal((await api("/api/v1/config")).json.data.features.registration, false);
  clearJar();
  const reg = await api("/api/v1/auth/register", { method: "POST", body: { username: `blk${Date.now().toString(36)}`, password: "pass1234", nickname: "x", termsVersion: "v1" } });
  assert.equal(reg.json.error.code, "REGISTRATION_DISABLED");
  const audit = openDb().prepare(`SELECT * FROM audit_logs WHERE action='settings.update' AND target_id='registrationEnabled'`).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.after_json).value, false);
  // reset
  clearJar();
  const l2 = await api("/api/v1/auth/login", { method: "POST", body: { username: s.username, password: s.password } });
  const s2 = { csrf: l2.json.data.csrfToken };
  await api("/api/v1/admin/reauth", { method: "POST", csrf: s2.csrf, body: { password: s.password } });
  r = await put(s2, "registrationEnabled", { value: null, reason: "维护结束" });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.setting.overridden, false);
  assert.equal(config.registrationEnabled, true);
  assert.equal(openDb().prepare("SELECT COUNT(*) c FROM app_settings").get().c, 0);
  assert.ok(openDb().prepare(`SELECT 1 FROM audit_logs WHERE action='settings.reset'`).get());
});

test("pvp params flow into new economy snapshots; overrides survive reload; bad rows ignored; tests may still assign base", async () => {
  resetRateLimitBuckets();
  const s = await adminSession();
  const env = config.pvpEntryCost;
  assert.equal((await put(s, "pvpEntryCost", { value: 50, reason: "活动" })).status, 200);
  assert.equal(currentEconomy(Date.now()).entryCost, 50);
  // simulate restart
  clearSettingOverrides();
  assert.equal(config.pvpEntryCost, env);
  openDb().prepare(`INSERT INTO app_settings (key, value_json) VALUES ('pvpWinReward', '"lots"')`).run();
  openDb().prepare(`INSERT INTO app_settings (key, value_json) VALUES ('ghostKey', 'true')`).run();
  loadAppSettings(openDb());
  assert.equal(config.pvpEntryCost, 50);
  assert.equal(config.pvpWinReward, 35);
  // assigning keeps the override on top but changes base
  config.pvpEntryCost = 7;
  assert.equal(config.pvpEntryCost, 50);
  assert.equal((await put(s, "pvpEntryCost", { value: null, reason: "活动结束" })).status, 200);
  assert.equal(config.pvpEntryCost, 7);
  config.pvpEntryCost = env;
  openDb().prepare(`DELETE FROM app_settings`).run();
  loadAppSettings(openDb());
});

test("non-admin cannot read or write settings", async () => {
  resetRateLimitBuckets();
  const u = await register(`asn${Date.now().toString(36)}`);
  clearJar();
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: u.username, password: u.password } });
  assert.equal((await api("/api/v1/admin/settings")).status, 403);
  assert.equal((await api("/api/v1/admin/settings/registrationEnabled", { method: "PUT", csrf: l.json.data.csrfToken, body: { value: false, reason: "xx" } })).status, 403);
});
