import { openDb } from "../db/connection.js";
import { shanghaiDay, ONLINE_WINDOW_MS } from "./activity.js";

/**
 * Read-only numbers for the admin 「用户数据」 panel.
 *
 * - Everything is counted for `role = 'user'` accounts that are not deleted (admin accounts stay out).
 * - Days are Asia/Shanghai calendar days.
 * - 「活跃」= the user had a heartbeat, a login or started a game that day. Logins and games exist for the
 *   whole history, so DAU / retention can be back-filled; heartbeat-only numbers (online now, usage time,
 *   Top 3, peak hours) start accumulating when the heartbeat endpoint ships (`tracking.since`).
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const USER_OK = `u.role = 'user' AND u.status != 'deleted'`;

const num = (v) => Number(v || 0);
const rate = (a, b) => (b > 0 ? a / b : null);

/** Lifetime usage buckets (seconds). */
const BUCKETS = [
  { key: "lt5m", label: "< 5 分钟", max: 300 },
  { key: "m5_15", label: "5–15 分钟", max: 900 },
  { key: "m15_30", label: "15–30 分钟", max: 1800 },
  { key: "m30_60", label: "30–60 分钟", max: 3600 },
  { key: "h1_3", label: "1–3 小时", max: 10800 },
  { key: "gt3h", label: "3 小时以上", max: Infinity },
];

function median(sorted) {
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function getAdminAnalytics({ days = 30, now = Date.now() } = {}, db = openDb()) {
  const span = Math.min(90, Math.max(7, Math.floor(Number(days)) || 30));
  const today = shanghaiDay(now);
  const dayList = [];
  for (let i = span - 1; i >= 0; i -= 1) dayList.push(shanghaiDay(now - i * DAY_MS));
  const from = dayList[0];
  const d6 = shanghaiDay(now - 6 * DAY_MS);
  const d7 = shanghaiDay(now - 7 * DAY_MS);
  const d29 = shanghaiDay(now - 29 * DAY_MS);
  const yesterday = shanghaiDay(now - DAY_MS);
  // Activity window must cover: the chart, MAU, and the retention cohorts.
  const since = shanghaiDay(now - (Math.max(span, 30) + 8) * DAY_MS);
  const sinceUtc = shanghaiDay(Date.parse(`${since}T00:00:00Z`) - DAY_MS - 8 * HOUR_MS); // UTC date prefix, 1 day slack

  const ACT = `WITH act(user_id, day) AS (
      SELECT user_id, day FROM user_activity_daily WHERE day >= @since
      UNION SELECT user_id, date(created_at, '+8 hours') FROM sessions
        WHERE created_at >= @sinceUtc AND date(created_at, '+8 hours') >= @since
      UNION SELECT user_id, date(started_at, '+8 hours') FROM game_sessions
        WHERE started_at >= @sinceUtc AND date(started_at, '+8 hours') >= @since
    )`;
  const p = { since, sinceUtc };

  // ---- users ------------------------------------------------------------------------------
  const u = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN u.status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN u.status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
            SUM(u.leaderboard_opt_in) AS lb,
            SUM(u.jiu_coin_balance) AS coins
       FROM users u WHERE ${USER_OK}`
  ).get();
  const deletedCount = num(db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE u.role = 'user' AND u.status = 'deleted'`).get()?.n);
  const regRows = db.prepare(
    `SELECT date(u.created_at, '+8 hours') AS d, COUNT(*) AS n FROM users u
      WHERE ${USER_OK} AND date(u.created_at, '+8 hours') >= @d29 AND date(u.created_at, '+8 hours') >= @from2
      GROUP BY d`
  ).all({ d29, from2: shanghaiDay(now - (Math.max(span, 30) - 1) * DAY_MS) });
  const regByDay = new Map(regRows.map((r) => [r.d, num(r.n)]));
  const regOn = (d) => regByDay.get(d) || 0;
  const regSince = (d) => [...regByDay].reduce((s, [k, v]) => (k >= d ? s + v : s), 0);

  // ---- activity (DAU / WAU / MAU) -----------------------------------------------------------
  const activeRows = db.prepare(
    `${ACT} SELECT act.day AS day, COUNT(DISTINCT act.user_id) AS n FROM act
       JOIN users u ON u.id = act.user_id AND ${USER_OK} GROUP BY act.day`
  ).all(p);
  const activeByDay = new Map(activeRows.map((r) => [r.day, num(r.n)]));
  const distinctSince = (d) => num(db.prepare(
    `${ACT} SELECT COUNT(DISTINCT act.user_id) AS n FROM act JOIN users u ON u.id = act.user_id AND ${USER_OK} WHERE act.day >= @d`
  ).get({ ...p, d })?.n);
  const dau = activeByDay.get(today) || 0;
  const wau = distinctSince(d6);
  const mau = distinctSince(d29);
  const dormant = num(db.prepare(
    `${ACT} SELECT COUNT(*) AS n FROM users u
       WHERE ${USER_OK} AND u.status = 'active' AND date(u.created_at, '+8 hours') <= @d7
         AND u.id NOT IN (SELECT user_id FROM act WHERE day >= @d6)`
  ).get({ ...p, d7, d6 })?.n);

  // ---- usage time (heartbeat) -----------------------------------------------------------------
  const sinceRow = db.prepare(`SELECT MIN(day) AS d FROM user_activity_daily`).get();
  const timeRows = db.prepare(
    `SELECT d.day AS day, SUM(d.active_seconds) AS secs, COUNT(*) AS users, SUM(d.visits) AS visits
       FROM user_activity_daily d JOIN users u ON u.id = d.user_id AND ${USER_OK}
      WHERE d.day >= @from GROUP BY d.day`
  ).all({ from });
  const timeByDay = new Map(timeRows.map((r) => [r.day, { secs: num(r.secs), users: num(r.users), visits: num(r.visits) }]));
  let winSecs = 0; let winUserDays = 0; let winVisits = 0;
  for (const r of timeByDay.values()) { winSecs += r.secs; winUserDays += r.users; winVisits += r.visits; }
  const lifetime = db.prepare(
    `SELECT d.user_id AS id, SUM(d.active_seconds) AS s FROM user_activity_daily d
       JOIN users u ON u.id = d.user_id AND ${USER_OK} GROUP BY d.user_id`
  ).all().map((r) => num(r.s));
  lifetime.sort((a, b) => a - b);
  const lifeTotal = lifetime.reduce((s, v) => s + v, 0);
  const dist = BUCKETS.map((b) => ({ key: b.key, label: b.label, users: 0 }));
  for (const s of lifetime) dist[BUCKETS.findIndex((b) => s < b.max)].users += 1;
  const todayT = timeByDay.get(today);
  const d7T = [...timeByDay].filter(([k]) => k >= d6).reduce((a, [, v]) => ({ secs: a.secs + v.secs, users: a.users + v.users }), { secs: 0, users: 0 });

  // ---- Top 3 cumulative usage time -----------------------------------------------------------
  const top3 = db.prepare(
    `SELECT u.id AS id, u.username_normalized AS username, u.nickname AS nickname, u.avatar_id AS avatarId,
            u.avatar_custom_path AS avatarCustomPath, u.status AS status,
            SUM(d.active_seconds) AS totalSeconds, SUM(d.visits) AS visits, COUNT(*) AS activeDays, MAX(d.day) AS lastDay
       FROM user_activity_daily d JOIN users u ON u.id = d.user_id AND ${USER_OK}
      GROUP BY u.id ORDER BY totalSeconds DESC, u.id ASC LIMIT 3`
  ).all().map((r, i) => ({
    rank: i + 1,
    id: r.id,
    username: r.username,
    nickname: r.nickname,
    avatarId: r.avatarId,
    hasCustomAvatar: !!r.avatarCustomPath,
    status: r.status,
    totalSeconds: num(r.totalSeconds),
    visits: num(r.visits),
    activeDays: num(r.activeDays),
    lastDay: r.lastDay,
    avgSecondsPerActiveDay: r.activeDays ? Math.round(num(r.totalSeconds) / r.activeDays) : 0,
  }));

  // ---- online / peak hours --------------------------------------------------------------------
  const onlineNow = num(db.prepare(
    `SELECT COUNT(*) AS n FROM user_presence p JOIN users u ON u.id = p.user_id AND ${USER_OK} WHERE p.last_beat_at >= ?`
  ).get(now - ONLINE_WINDOW_MS)?.n);
  const online10m = num(db.prepare(
    `SELECT COUNT(*) AS n FROM user_presence p JOIN users u ON u.id = p.user_id AND ${USER_OK} WHERE p.last_beat_at >= ?`
  ).get(now - 10 * 60 * 1000)?.n);
  const curHour = Math.floor(now / HOUR_MS);
  const hourRows = db.prepare(
    `SELECT h.hour AS hour, COUNT(*) AS n FROM user_activity_hourly h JOIN users u ON u.id = h.user_id AND ${USER_OK}
      WHERE h.hour > ? GROUP BY h.hour`
  ).all(curHour - span * 24);
  const hourMap = new Map(hourRows.map((r) => [r.hour, num(r.n)]));
  const last24h = [];
  for (let h = curHour - 23; h <= curHour; h += 1) {
    last24h.push({ hour: new Date(h * HOUR_MS + 8 * HOUR_MS).getUTCHours(), users: hourMap.get(h) || 0 });
  }
  const byHourOfDay = Array.from({ length: 24 }, (_, hh) => ({ hour: hh, avgUsers: 0 }));
  const hourSum = new Array(24).fill(0);
  for (const [h, n] of hourMap) hourSum[new Date(h * HOUR_MS + 8 * HOUR_MS).getUTCHours()] += n;
  byHourOfDay.forEach((b) => { b.avgUsers = Math.round((hourSum[b.hour] / span) * 10) / 10; });
  const peak = byHourOfDay.reduce((best, b) => (b.avgUsers > (best?.avgUsers ?? 0) ? b : best), null);

  // ---- retention / activation -----------------------------------------------------------------
  const cohortFrom = shanghaiDay(now - (Math.max(span, 30) - 1) * DAY_MS);
  const retention = (offset, lastCohortDay) => {
    const r = db.prepare(
      `${ACT} SELECT COUNT(*) AS cohort,
              SUM(EXISTS(SELECT 1 FROM act a WHERE a.user_id = u.id AND a.day = date(u.created_at, '+8 hours', '+${offset} days'))) AS retained
         FROM users u
        WHERE ${USER_OK} AND date(u.created_at, '+8 hours') BETWEEN @cf AND @last`
    ).get({ ...p, cf: cohortFrom, last: lastCohortDay });
    return { cohort: num(r?.cohort), retained: num(r?.retained), rate: rate(num(r?.retained), num(r?.cohort)) };
  };
  const act = db.prepare(
    `SELECT COUNT(*) AS reg, SUM(EXISTS(SELECT 1 FROM game_sessions g WHERE g.user_id = u.id)) AS played
       FROM users u WHERE ${USER_OK} AND date(u.created_at, '+8 hours') >= @cf`
  ).get({ cf: cohortFrom });
  const everPlayed = num(db.prepare(
    `SELECT COUNT(*) AS n FROM users u WHERE ${USER_OK} AND EXISTS(SELECT 1 FROM game_sessions g WHERE g.user_id = u.id)`
  ).get()?.n);

  // ---- games / pvp ------------------------------------------------------------------------------
  const kindRows = db.prepare(
    `SELECT g.game_kind AS kind, COUNT(*) AS started, SUM(CASE WHEN g.status = 'settled' THEN 1 ELSE 0 END) AS settled
       FROM game_sessions g JOIN users u ON u.id = g.user_id AND ${USER_OK}
      WHERE g.started_at >= @sinceUtc AND date(g.started_at, '+8 hours') >= @from GROUP BY g.game_kind ORDER BY started DESC`
  ).all({ sinceUtc, from });
  const gameDayRows = db.prepare(
    `SELECT date(g.started_at, '+8 hours') AS d, COUNT(*) AS n
       FROM game_sessions g JOIN users u ON u.id = g.user_id AND ${USER_OK}
      WHERE g.started_at >= @sinceUtc AND date(g.started_at, '+8 hours') >= @from GROUP BY d`
  ).all({ sinceUtc, from });
  const gamesByDay = new Map(gameDayRows.map((r) => [r.d, num(r.n)]));
  let pvpByDay = new Map();
  try {
    const fromMs = Date.parse(`${from}T00:00:00Z`) - 8 * HOUR_MS;
    pvpByDay = new Map(db.prepare(
      `SELECT date(created_at / 1000, 'unixepoch', '+8 hours') AS d, COUNT(*) AS n FROM pvp_matches
        WHERE status = 'settled' AND created_at >= ? GROUP BY d`
    ).all(fromMs).map((r) => [r.d, num(r.n)]));
  } catch { /* pvp tables missing in odd test setups */ }
  const gamesTotal = kindRows.reduce((s, r) => s + num(r.started), 0);
  const pvpTotal = [...pvpByDay.values()].reduce((s, v) => s + v, 0);

  // ---- series ---------------------------------------------------------------------------------
  const series = dayList.map((d) => {
    const t = timeByDay.get(d);
    return {
      day: d,
      registered: regOn(d),
      active: activeByDay.get(d) || 0,
      avgSeconds: t && t.users ? Math.round(t.secs / t.users) : null,
      totalSeconds: t ? t.secs : 0,
      games: gamesByDay.get(d) || 0,
      pvpMatches: pvpByDay.get(d) || 0,
    };
  });

  const totalUsers = num(u?.total);
  return {
    generatedAt: new Date(now).toISOString(),
    timezone: "Asia/Shanghai",
    days: span,
    today,
    tracking: { since: sinceRow?.d || null, users: lifetime.length },
    online: { now: onlineNow, last10min: online10m, windowSeconds: ONLINE_WINDOW_MS / 1000 },
    users: {
      total: totalUsers,
      active: num(u?.active),
      disabled: num(u?.disabled),
      deleted: deletedCount,
      newToday: regOn(today),
      new7d: regSince(d6),
      new30d: regSince(d29),
      leaderboardOptIn: num(u?.lb),
      leaderboardOptInRate: rate(num(u?.lb), totalUsers),
    },
    activity: {
      dau,
      wau,
      mau,
      stickiness: rate(dau, mau),
      dormant7d: dormant,
    },
    usage: {
      avgSecondsPerActiveUserToday: todayT && todayT.users ? Math.round(todayT.secs / todayT.users) : null,
      avgSecondsPerActiveUser7d: d7T.users ? Math.round(d7T.secs / d7T.users) : null,
      avgSecondsPerActiveUserWindow: winUserDays ? Math.round(winSecs / winUserDays) : null,
      avgSecondsPerVisitWindow: winVisits ? Math.round(winSecs / winVisits) : null,
      avgVisitsPerActiveUserWindow: winUserDays ? Math.round((winVisits / winUserDays) * 10) / 10 : null,
      avgLifetimeSecondsPerUser: lifetime.length ? Math.round(lifeTotal / lifetime.length) : null,
      medianLifetimeSecondsPerUser: median(lifetime),
      totalSecondsWindow: winSecs,
      distribution: dist,
    },
    top3,
    hours: { last24h, byHourOfDay, peakHour: peak && peak.avgUsers > 0 ? peak.hour : null },
    retention: {
      cohortFrom,
      d1: retention(1, yesterday),
      d7: retention(7, d7),
      activation: { registered: num(act?.reg), played: num(act?.played), rate: rate(num(act?.played), num(act?.reg)) },
      everPlayedRate: rate(everPlayed, totalUsers),
    },
    games: {
      startedWindow: gamesTotal,
      perActiveUserDayWindow: rate(gamesTotal, [...activeByDay].filter(([k]) => k >= from).reduce((s, [, v]) => s + v, 0)),
      byKind: kindRows.map((r) => ({ kind: r.kind, started: num(r.started), settled: num(r.settled) })),
      pvpMatchesWindow: pvpTotal,
    },
    economy: {
      jiuCoinTotal: num(u?.coins),
      jiuCoinAvg: totalUsers ? Math.round(num(u?.coins) / totalUsers) : null,
    },
    series,
  };
}
