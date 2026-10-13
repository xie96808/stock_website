import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.ADMIN_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { resetRateLimitBuckets } = await import("../src/lib/rateLimit.js");
const { seedNearDailyChallenges, shanghaiYmdAt, challengeNow, getChallengeByDate } = await import("../src/lib/dailyChallenge.js");
const { listPublishedAnnouncements } = await import("../src/lib/announcements.js");
const { api, register, stop, jar } = await startTestServer();
test.after(async () => { await stop(); });

const clearJar = () => { for (const k of Object.keys(jar)) delete jar[k]; };
async function admin({ verify = true } = {}) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const a = await register(`acn${stamp}`);
  openDb().prepare(`UPDATE users SET role='admin' WHERE id=?`).run(a.user.id);
  clearJar();
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: a.username, password: a.password } });
  const csrf = l.json.data.csrfToken;
  if (verify) await api("/api/v1/admin/reauth", { method: "POST", csrf, body: { password: a.password } });
  return { ...a, csrf };
}

function withFkOff(fn) {
  const db = openDb();
  db.pragma("foreign_keys = OFF");
  try { return fn(db); } finally { db.pragma("foreign_keys = ON"); }
}

test("content overview is read-only and shaped", async () => {
  resetRateLimitBuckets();
  await admin();
  const before = openDb().prepare("SELECT COUNT(*) c FROM audit_logs").get().c;
  const r = await api("/api/v1/admin/content/overview");
  assert.equal(r.status, 200);
  assert.ok(r.json.data.quiz && Array.isArray(r.json.data.puzzles.chapters) && r.json.data.flags);
  assert.equal(openDb().prepare("SELECT COUNT(*) c FROM audit_logs").get().c, before);
});

test("daily board: hide removes from public board, unhide restores; cannot promote ineligible", async () => {
  resetRateLimitBuckets();
  const s = await admin();
  seedNearDailyChallenges();
  const ymd = shanghaiYmdAt(challengeNow());
  const ch = getChallengeByDate(ymd);
  assert.ok(ch, "challenge seeded");
  const u1 = await register(`dbu${Date.now().toString(36)}`);
  const u2 = await register(`dbv${Date.now().toString(36)}`);
  withFkOff((db) => {
    db.prepare(`INSERT INTO daily_challenge_attempts (id, challenge_id, challenge_date, user_id, game_id, status, board_eligible, return_ppm, mdd_ppm, settled_at)
      VALUES ('att-1', ?, ?, ?, 'g-att-1', 'settled', 1, 50000, 1000, datetime('now'))`).run(ch.id, ymd, u1.user.id);
    db.prepare(`INSERT INTO daily_challenge_attempts (id, challenge_id, challenge_date, user_id, game_id, status, board_eligible, return_ppm, mdd_ppm, settled_at)
      VALUES ('att-2', ?, ?, ?, 'g-att-2', 'settle_late', 0, 90000, 1000, datetime('now'))`).run(ch.id, ymd, u2.user.id);
  });
  clearJar();
  const l = await api("/api/v1/auth/login", { method: "POST", body: { username: s.username, password: s.password } });
  const csrf = l.json.data.csrfToken;
  await api("/api/v1/admin/reauth", { method: "POST", csrf, body: { password: s.password } });
  let r = await api(`/api/v1/admin/daily/board?date=${ymd}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.entries.length, 2);
  const pubBefore = (await api(`/api/v1/daily-challenge/leaderboard?date=${ymd}`)).json?.data?.total;
  assert.equal((await api(`/api/v1/admin/daily/attempts/att-1`, { method: "PATCH", csrf, body: { hide: true } })).status, 400);
  r = await api(`/api/v1/admin/daily/attempts/att-1`, { method: "PATCH", csrf, body: { hide: true, reason: "刷榜" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(openDb().prepare(`SELECT board_eligible b FROM daily_challenge_attempts WHERE id='att-1'`).get().b, 0);
  if (pubBefore != null) {
    const pubAfter = (await api(`/api/v1/daily-challenge/leaderboard?date=${ymd}`)).json.data.total;
    assert.equal(pubAfter, pubBefore - 1);
  }
  // repeat hide is a no-op (no second audit)
  r = await api(`/api/v1/admin/daily/attempts/att-1`, { method: "PATCH", csrf, body: { hide: true, reason: "刷榜" } });
  assert.equal(r.json.data.unchanged, true);
  assert.equal(openDb().prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action='daily.hide'`).get().c, 1);
  r = await api(`/api/v1/admin/daily/board?date=${ymd}`);
  assert.equal(r.json.data.entries.find((e) => e.attemptId === "att-1").hiddenByAdmin, true);
  r = await api(`/api/v1/admin/daily/attempts/att-2`, { method: "PATCH", csrf, body: { hide: false, reason: "试试" } });
  assert.equal(r.json.error.code, "NOT_HIDDEN_BY_ADMIN");
  r = await api(`/api/v1/admin/daily/attempts/att-1`, { method: "PATCH", csrf, body: { hide: false, reason: "误判" } });
  assert.equal(r.status, 200);
  assert.equal(openDb().prepare(`SELECT board_eligible b FROM daily_challenge_attempts WHERE id='att-1'`).get().b, 1);
  assert.equal((await api(`/api/v1/admin/daily/board?date=bad`)).status, 400);
});

test("share links list + revoke open only, audited", async () => {
  resetRateLimitBuckets();
  const s = await admin();
  const now = Date.now();
  withFkOff((db) => {
    db.prepare(`INSERT INTO pvp_share_links (code, from_user_id, status, created_at, expires_at) VALUES ('SHAREOPEN1', ?, 'open', ?, ?)`).run(s.user.id, now, now + 600000);
    db.prepare(`INSERT INTO pvp_share_links (code, from_user_id, status, created_at, expires_at) VALUES ('SHAREJOIN1', ?, 'joined', ?, ?)`).run(s.user.id, now - 5000, now + 600000);
  });
  let r = await api("/api/v1/admin/pvp/shares?status=open");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.items.map((i) => i.code), ["SHAREOPEN1"]);
  assert.equal((await api("/api/v1/admin/pvp/shares/SHAREOPEN1/revoke", { method: "POST", csrf: s.csrf, body: {} })).status, 400);
  r = await api("/api/v1/admin/pvp/shares/SHAREOPEN1/revoke", { method: "POST", csrf: s.csrf, body: { reason: "滥用" } });
  assert.equal(r.status, 200);
  assert.equal(openDb().prepare(`SELECT status FROM pvp_share_links WHERE code='SHAREOPEN1'`).get().status, "cancelled");
  r = await api("/api/v1/admin/pvp/shares/SHAREJOIN1/revoke", { method: "POST", csrf: s.csrf, body: { reason: "滥用" } });
  assert.equal(r.json.error.code, "SHARE_CLOSED");
  assert.ok(openDb().prepare(`SELECT 1 FROM audit_logs WHERE action='pvp.share.revoke' AND target_id='SHAREOPEN1'`).get());
});

test("announcement scheduling: draft stays hidden until due, then auto-publishes; cancel works", async () => {
  resetRateLimitBuckets();
  const s = await admin();
  const baseline = listPublishedAnnouncements().items.map((i) => i.id);
  let r = await api("/api/v1/admin/announcements", { method: "POST", csrf: s.csrf, body: { title: "定时", body: "明天见", status: "draft" } });
  const id = r.json.data.announcement.id;
  assert.equal((await api(`/api/v1/admin/announcements/${id}/schedule`, { method: "POST", csrf: s.csrf, body: { publishAt: new Date(Date.now() - 1000).toISOString() } })).status, 400);
  r = await api(`/api/v1/admin/announcements/${id}/schedule`, { method: "POST", csrf: s.csrf, body: { publishAt: new Date(Date.now() + 3600_000).toISOString() } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(listPublishedAnnouncements().items.map((i) => i.id), baseline);
  assert.ok(!(await api("/api/v1/announcements")).json.data.items.some((i) => i.id === id));
  assert.ok((await api("/api/v1/admin/announcements-scheduled")).json.data.scheduled[id]);
  // cancel + reschedule
  assert.equal((await api(`/api/v1/admin/announcements/${id}/schedule`, { method: "DELETE", csrf: s.csrf })).status, 200);
  assert.equal(openDb().prepare(`SELECT scheduled_at s FROM announcements WHERE id=?`).get(id).s, null);
  await api(`/api/v1/admin/announcements/${id}/schedule`, { method: "POST", csrf: s.csrf, body: { publishAt: new Date(Date.now() + 3600_000).toISOString() } });
  // due => promoted on next read, published_at = scheduled time
  openDb().prepare(`UPDATE announcements SET scheduled_at = datetime('now','-1 minute') WHERE id = ?`).run(id);
  const items = (await api("/api/v1/announcements")).json.data.items;
  assert.ok(items.some((i) => i.id === id));
  const row = openDb().prepare(`SELECT status, scheduled_at, published_at FROM announcements WHERE id=?`).get(id);
  assert.equal(row.status, "published");
  assert.equal(row.scheduled_at, null);
  assert.ok(row.published_at);
  // only drafts can be scheduled
  assert.equal((await api(`/api/v1/admin/announcements/${id}/schedule`, { method: "POST", csrf: s.csrf, body: { publishAt: new Date(Date.now() + 3600_000).toISOString() } })).json.error.code, "NOT_DRAFT");
});

test("feedback unread count + internal note (audited, admin only)", async () => {
  resetRateLimitBuckets();
  const u = await register(`fbu${Date.now().toString(36)}`);
  const info = openDb().prepare(`INSERT INTO user_feedback (user_id, body) VALUES (?, '按钮点不动')`).run(u.user.id);
  const fid = Number(info.lastInsertRowid);
  const s = await admin();
  let r = await api("/api/v1/admin/feedback-unread");
  assert.ok(r.json.data.count >= 1);
  r = await api(`/api/v1/admin/feedback/${fid}/note`, { method: "PUT", csrf: s.csrf, body: { note: "已复现，下版修" } });
  assert.equal(r.status, 200);
  r = await api(`/api/v1/admin/feedback/${fid}`);
  assert.equal(r.json.data.adminNote.note, "已复现，下版修");
  assert.equal(r.json.data.feedback.status, "new", "note does not change status");
  const audit = openDb().prepare(`SELECT * FROM audit_logs WHERE action='feedback.note' AND target_id=?`).get(String(fid));
  assert.ok(audit && !JSON.stringify(audit).includes("下版修"));
  const nv = await admin({ verify: false });
  assert.equal((await api(`/api/v1/admin/feedback/${fid}/note`, { method: "PUT", csrf: nv.csrf, body: { note: "x" } })).status, 403);
});
