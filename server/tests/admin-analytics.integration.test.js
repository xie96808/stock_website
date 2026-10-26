import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { recordHeartbeat, shanghaiDay, ONLINE_WINDOW_MS } = await import("../src/lib/activity.js");
const { getAdminAnalytics } = await import("../src/lib/adminAnalytics.js");

const ctx = await startTestServer();
const { api, register, stop, jar } = ctx;
test.after(async () => { await stop(); });

const stamp = Date.now().toString(36);
const clearJar = () => { for (const k of Object.keys(jar)) delete jar[k]; };
const DAY = 86400000;

async function mkUser(name) {
  const r = await register(`${name}${stamp}`);
  return r;
}
async function loginAs(username, password) {
  clearJar();
  const r = await api("/api/v1/auth/login", { method: "POST", body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data.csrfToken;
}
function rowsFor(uid) {
  return openDb().prepare(`SELECT day, active_seconds AS s, visits AS v FROM user_activity_daily WHERE user_id = ? ORDER BY day`).all(uid);
}
const totalSeconds = (uid) => rowsFor(uid).reduce((s, r) => s + r.s, 0);
const totalVisits = (uid) => rowsFor(uid).reduce((s, r) => s + r.v, 0);

test("heartbeat accounting: visits, credited seconds, de-dupe and gap rules", async () => {
  const u = await mkUser("hb");
  const uid = u.user.id;
  const t0 = Date.now() - 3 * 3600 * 1000;
  assert.deepEqual(recordHeartbeat(uid, t0), { accepted: true, creditedSeconds: 0, newVisit: true });
  assert.equal(recordHeartbeat(uid, t0 + 30_000).creditedSeconds, 30);
  assert.equal(recordHeartbeat(uid, t0 + 35_000).accepted, false, "a beat <10s after the last is ignored");
  assert.equal(recordHeartbeat(uid, t0 + 65_000).creditedSeconds, 35);
  // 100s gap (< 5 min visit gap) is capped at 75s credit
  assert.equal(recordHeartbeat(uid, t0 + 165_000).creditedSeconds, 75);
  // 10 min gap => new visit, nothing credited for the gap
  const gap = recordHeartbeat(uid, t0 + 165_000 + 600_000);
  assert.deepEqual(gap, { accepted: true, creditedSeconds: 0, newVisit: true });
  assert.equal(totalSeconds(uid), 30 + 35 + 75);
  assert.equal(totalVisits(uid), 2);
  // garbage ids are ignored
  assert.equal(recordHeartbeat(0).accepted, false);
  assert.equal(recordHeartbeat("x").accepted, false);
});

test("a heartbeat that crosses Shanghai midnight lands on the new day", () => {
  const db = openDb();
  const uid = db.prepare(`SELECT id FROM users ORDER BY id LIMIT 1`).get().id;
  db.prepare(`DELETE FROM user_presence WHERE user_id = ?`).run(uid);
  db.prepare(`DELETE FROM user_activity_daily WHERE user_id = ?`).run(uid);
  // 2026-03-10 23:59:40 Shanghai == 15:59:40Z
  const before = Date.parse("2026-03-10T15:59:40Z");
  recordHeartbeat(uid, before);
  recordHeartbeat(uid, before + 30_000); // 00:00:10 on 03-11
  const days = rowsFor(uid);
  assert.deepEqual(days.map((d) => d.day), ["2026-03-10", "2026-03-11"]);
  assert.equal(days[1].s, 30);
  assert.equal(shanghaiDay(Date.parse("2026-03-10T16:00:00Z")), "2026-03-11");
});

test("POST /me/heartbeat: login required, repeat calls are no-ops, admins are not tracked", async () => {
  clearJar();
  const anon = await api("/api/v1/me/heartbeat", { method: "POST" });
  assert.equal(anon.status, 401);

  const u = await mkUser("web");
  const csrf = await loginAs(u.username, u.password);
  const first = await api("/api/v1/me/heartbeat", { method: "POST", csrf });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.accepted, true);
  const again = await api("/api/v1/me/heartbeat", { method: "POST", csrf });
  assert.equal(again.json.data.accepted, false);

  const adm = await mkUser("hbadm");
  openDb().prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(adm.user.id);
  const acsrf = await loginAs(adm.username, adm.password);
  const ar = await api("/api/v1/me/heartbeat", { method: "POST", csrf: acsrf });
  assert.equal(ar.status, 200);
  assert.equal(ar.json.data.accepted, false);
  assert.equal(rowsFor(adm.user.id).length, 0);
  assert.equal(openDb().prepare(`SELECT COUNT(*) AS n FROM user_presence WHERE user_id = ?`).get(adm.user.id).n, 0);
});

test("GET /admin/analytics is admin only and returns the full shape", async () => {
  const plain = await mkUser("an");
  const pcsrf = await loginAs(plain.username, plain.password);
  const denied = await api("/api/v1/admin/analytics", { csrf: pcsrf });
  assert.equal(denied.status, 403);
  clearJar();
  assert.equal((await api("/api/v1/admin/analytics")).status, 401);

  const adm = await mkUser("analyt");
  openDb().prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(adm.user.id);
  await loginAs(adm.username, adm.password);
  const r = await api("/api/v1/admin/analytics?days=14");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  for (const k of ["online", "users", "activity", "usage", "top3", "hours", "retention", "games", "economy", "series", "tracking"]) {
    assert.ok(k in d, `missing ${k}`);
  }
  assert.equal(d.days, 14);
  assert.equal(d.series.length, 14);
  assert.equal(d.series[13].day, d.today);
  assert.equal(d.hours.last24h.length, 24);
  assert.equal(d.hours.byHourOfDay.length, 24);
  // days is clamped
  assert.equal((await api("/api/v1/admin/analytics?days=9999")).json.data.days, 90);
  assert.equal((await api("/api/v1/admin/analytics?days=abc")).json.data.days, 30);
});

test("analytics numbers: admins/deleted excluded, Top 3 by lifetime time, online window, retention", async () => {
  const db = openDb();
  const now = Date.now();
  const mk = async (n) => (await mkUser(n)).user.id;
  const a = await mk("ta");
  const b = await mk("tb");
  const c = await mk("tc");
  const d = await mk("td");
  const gone = await mk("tg");
  const adm = await mk("tadm");
  db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(adm);

  db.exec(`DELETE FROM user_activity_daily; DELETE FROM user_activity_hourly;`); // earlier tests left rows
  const put = (uid, day, secs, visits = 1) => db.prepare(
    `INSERT INTO user_activity_daily (user_id, day, active_seconds, visits) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET active_seconds = active_seconds + excluded.active_seconds, visits = visits + excluded.visits`
  ).run(uid, day, secs, visits);
  const day = (i) => shanghaiDay(now - i * DAY);
  // lifetime: b 5000 > a 3000 > c 1000 > d 100; "gone" and the admin would win but must not show up
  put(a, day(1), 1200, 2); put(a, day(0), 1800, 1);
  put(b, day(2), 5000, 3);
  put(c, day(0), 1000, 1);
  put(d, day(0), 100, 1);
  put(gone, day(1), 99999, 1);
  put(adm, day(1), 88888, 1);
  db.prepare(`UPDATE users SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?`).run(gone);

  // presence: a and c online now, d only 5 min ago
  db.prepare(`DELETE FROM user_presence`).run();
  const pres = (uid, ago) => db.prepare(`INSERT INTO user_presence (user_id, last_beat_at) VALUES (?, ?)`).run(uid, now - ago);
  pres(a, 10_000); pres(c, ONLINE_WINDOW_MS - 1000); pres(d, 5 * 60_000); pres(adm, 1000); pres(gone, 1000);

  // retention: two users registered 3 days ago, only one comes back the next day
  const cohortDay = day(3);
  const created = new Date(now - 3 * DAY).toISOString().replace("T", " ").slice(0, 19);
  db.prepare(`UPDATE users SET created_at = ? WHERE id IN (?, ?)`).run(created, c, d);
  db.prepare(`DELETE FROM user_activity_daily WHERE user_id IN (?, ?) AND day = ?`).run(c, d, day(2));
  put(c, day(2), 60, 1); // c is active the day after registering

  const out = getAdminAnalytics({ days: 30, now });
  assert.deepEqual(out.top3.map((t) => t.id), [b, a, c]);
  assert.deepEqual(out.top3.map((t) => t.totalSeconds), [5000, 3000, 1060]);
  assert.equal(out.top3[0].rank, 1);
  assert.equal(out.top3[1].activeDays, 2);
  assert.equal(out.top3[1].visits, 3);
  assert.equal(out.top3[1].avgSecondsPerActiveDay, 1500);
  assert.ok(!out.top3.some((t) => t.id === gone || t.id === adm));

  assert.equal(out.online.now, 2);
  assert.equal(out.online.last10min, 3);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND status != 'deleted'`).get().n;
  assert.equal(out.users.total, total);
  assert.equal(out.users.deleted >= 1, true);

  assert.equal(out.tracking.users, 4, "tracked users = a,b,c,d (not deleted, not admin)");
  assert.equal(out.usage.distribution.reduce((s, x) => s + x.users, 0), 4);
  assert.equal(out.usage.distribution.find((x) => x.key === "lt5m").users, 1); // d (100s)
  assert.equal(out.usage.avgLifetimeSecondsPerUser, Math.round((5000 + 3000 + 1060 + 100) / 4));
  assert.equal(out.usage.medianLifetimeSecondsPerUser, Math.round((1060 + 3000) / 2));

  assert.deepEqual(out.retention.d1, { cohort: 2, retained: 1, rate: 0.5 });
  assert.equal(out.retention.cohortFrom <= cohortDay, true);
  assert.equal(out.series.find((s) => s.day === day(2)).active >= 2, true); // b and c

  const todayRow = out.series[out.series.length - 1];
  assert.equal(todayRow.day, day(0));
  assert.equal(out.activity.dau, todayRow.active);
  assert.ok(out.activity.wau >= out.activity.dau);
  assert.ok(out.activity.mau >= out.activity.wau);
});

test("analytics on an empty database does not throw and reports nulls, not NaN", async () => {
  const db = openDb();
  db.exec(`DELETE FROM user_activity_daily; DELETE FROM user_presence; DELETE FROM user_activity_hourly;`);
  const out = getAdminAnalytics({ days: 7, now: Date.now() });
  assert.deepEqual(out.top3, []);
  assert.equal(out.usage.avgLifetimeSecondsPerUser, null);
  assert.equal(out.usage.medianLifetimeSecondsPerUser, null);
  assert.equal(out.tracking.since, null);
  assert.equal(out.hours.peakHour, null);
  assert.equal(out.online.now, 0);
  assert.ok(!JSON.stringify(out).includes("NaN"));
});
