/**
 * Track R2 admin: move 后悔券 games between boards, and rewind-fairness stats.
 * Design: lucky-wheel DESIGN.md Rev 4 §8.1.5. assist_class stays the ONLY board input; rewind_via is the audit fact.
 */
import { openDb } from "../db/connection.js";
import { writeAuditLog } from "./audit.js";
import { invalidateLeaderboardCache } from "./leaderboard.js";
import { challengeNow } from "./dailyChallenge.js";
import { shanghaiYmd } from "./jiuCoin.js";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (n) => Math.round(n * 100) / 100;

function cleanReason(reason) {
  const r = typeof reason === "string" ? reason.trim() : "";
  return r.length >= 2 && r.length <= 200 ? r : null;
}

/**
 * POST /admin/rewind-tickets/reclassify { to:'undo'|'clean', since?:'YYYY-MM-DD' (Asia/Shanghai, by started_at), dryRun, reason }
 * Only rows with rewind_via='ticket' move. game_sessions and game_results are updated together.
 */
export function adminReclassifyTicketGames({ actorId, to, since = null, dryRun = false, reason, requestId = null }) {
  if (to !== "undo" && to !== "clean") return { ok: false, status: 400, code: "BAD_TARGET", message: "to 须为 undo 或 clean" };
  if (since != null && since !== "" && (typeof since !== "string" || !YMD_RE.test(since))) {
    return { ok: false, status: 400, code: "BAD_DATE", message: "since 须为 YYYY-MM-DD" };
  }
  const why = cleanReason(reason);
  if (!why) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "原因需 2–200 字" };
  const db = openDb();
  const sinceSql = since ? ` AND date(s.started_at, '+8 hours') >= ?` : "";
  const args = since ? [since] : [];
  const from = to === "undo" ? "clean" : "undo";
  const pick = `SELECT s.id FROM game_sessions s WHERE s.rewind_via = 'ticket' AND s.assist_class = '${from}'${sinceSql}`;
  const sessions = db.prepare(`SELECT COUNT(*) AS c FROM (${pick})`).get(...args).c;
  const results = db
    .prepare(`SELECT COUNT(*) AS c FROM game_results r WHERE r.game_id IN (${pick}) AND (r.assist_class IS NULL OR r.assist_class != ?)`)
    .get(...args, to).c;
  if (dryRun) return { ok: true, dryRun: true, to, since: since || null, sessions, results };
  db.transaction(() => {
    db.prepare(`UPDATE game_results SET assist_class = ? WHERE game_id IN (${pick})`).run(to, ...args);
    db.prepare(`UPDATE game_sessions SET assist_class = ? WHERE id IN (${pick})`).run(to, ...args);
    writeAuditLog({
      actorId,
      action: "rewind_tickets.reclassify",
      targetType: "games",
      targetId: "rewind_via=ticket",
      reason: why,
      after: { to, since: since || null, sessions, results },
      requestId,
    });
  })();
  invalidateLeaderboardCache();
  return { ok: true, dryRun: false, to, since: since || null, sessions, results };
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

function meanSd(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, sd: null };
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd };
}

export const FAIRNESS_MIN_N = 200;

/** GET /admin/rewind/stats?days= */
export function adminRewindStats({ days = 30, now = challengeNow() } = {}) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 90);
  const db = openDb();
  const today = shanghaiYmd(now);
  const start = addDaysYmd(today, -(n - 1));
  const d8 = (col) => `date(${col}, '+8 hours')`;

  const coinByDay = db
    .prepare(`SELECT ${d8("created_at")} AS d, COUNT(*) AS c FROM jiu_coin_ledger WHERE reason = 'game_rewind' AND ${d8("created_at")} >= ? GROUP BY d`)
    .all(start);
  const ticketByDay = db
    .prepare(`SELECT ${d8("created_at")} AS d, COUNT(*) AS c FROM user_item_ledger WHERE reason = 'rewind_use' AND ${d8("created_at")} >= ? GROUP BY d`)
    .all(start);
  const cm = new Map(coinByDay.map((r) => [r.d, r.c]));
  const tm = new Map(ticketByDay.map((r) => [r.d, r.c]));
  const series = [];
  for (let i = 0; i < n; i++) {
    const d = addDaysYmd(start, i);
    series.push({ date: d, coin: cm.get(d) || 0, ticket: tm.get(d) || 0 });
  }

  // Settled classic games in the window, by board / way.
  const settled = db
    .prepare(
      `SELECT s.fill_mode AS fillMode, s.dataset_version AS datasetVersion, s.undo_count AS undo, s.rewind_via AS via,
              r.assist_class AS assist, r.return_ppm AS ppm
       FROM game_results r JOIN game_sessions s ON s.id = r.game_id
       WHERE COALESCE(s.game_kind, 'classic') = 'classic' AND s.status = 'settled' AND r.validity = 'valid'
         AND ${d8("s.finished_at")} >= ?`
    )
    .all(start);
  const cleanBoard = settled.filter((g) => g.assist === "clean");
  const cleanWithTicket = cleanBoard.filter((g) => g.via === "ticket").length;

  // Mean return: ticket games vs un-rewound games, same fill mode + dataset version.
  const groups = new Map();
  for (const g of settled) {
    const key = `${g.fillMode}|${g.datasetVersion}`;
    if (!groups.has(key)) groups.set(key, { fillMode: g.fillMode, datasetVersion: g.datasetVersion, ticket: [], none: [], coin: [] });
    const bucket = groups.get(key);
    if (g.via === "ticket") bucket.ticket.push(g.ppm / 10000);
    else if ((g.undo ?? 0) === 0) bucket.none.push(g.ppm / 10000);
    else bucket.coin.push(g.ppm / 10000);
  }
  const returns = [...groups.values()].map((b) => {
    const t = meanSd(b.ticket);
    const u = meanSd(b.none);
    const c = meanSd(b.coin);
    let pooled = null;
    if (t.n > 1 && u.n > 1) pooled = Math.sqrt(((t.n - 1) * t.sd ** 2 + (u.n - 1) * u.sd ** 2) / (t.n + u.n - 2));
    const enough = t.n >= FAIRNESS_MIN_N && u.n >= FAIRNESS_MIN_N;
    const diff = t.mean != null && u.mean != null ? t.mean - u.mean : null;
    return {
      fillMode: b.fillMode,
      datasetVersion: b.datasetVersion,
      ticket: { n: t.n, meanPct: t.mean == null ? null : r2(t.mean), sdPct: t.sd == null ? null : r2(t.sd) },
      unrewound: { n: u.n, meanPct: u.mean == null ? null : r2(u.mean), sdPct: u.sd == null ? null : r2(u.sd) },
      coin: { n: c.n, meanPct: c.mean == null ? null : r2(c.mean) },
      diffPct: diff == null ? null : r2(diff),
      pooledSdPct: pooled == null ? null : r2(pooled),
      enoughData: enough,
      warning: !!(enough && pooled != null && diff != null && diff > pooled),
    };
  });

  const topUsers = db
    .prepare(
      `SELECT l.user_id AS userId, u.username_normalized AS username, u.nickname, COUNT(*) AS ticketRewinds
       FROM user_item_ledger l JOIN users u ON u.id = l.user_id
       WHERE l.reason = 'rewind_use' AND ${d8("l.created_at")} >= ?
       GROUP BY l.user_id ORDER BY ticketRewinds DESC, l.user_id LIMIT 10`
    )
    .all(start);
  const sumBy = (reason) =>
    db.prepare(`SELECT COALESCE(SUM(ABS(delta)), 0) AS q FROM user_item_ledger WHERE item_type = 'rewind_ticket' AND reason = ? AND ${d8("created_at")} >= ?`).get(reason, start).q;
  const held = db.prepare(`SELECT COALESCE(SUM(qty), 0) AS q, COUNT(CASE WHEN qty > 0 THEN 1 END) AS holders FROM user_items WHERE item_type = 'rewind_ticket'`).get();
  const issuedWheel = sumBy("wheel_prize");
  const issuedAdmin = sumBy("admin_grant");
  const redeemed = sumBy("rewind_use");
  return {
    days: n,
    from: start,
    to: today,
    series,
    totals: {
      coinRewinds: series.reduce((a, s) => a + s.coin, 0),
      ticketRewinds: series.reduce((a, s) => a + s.ticket, 0),
      cleanBoardGames: cleanBoard.length,
      cleanBoardTicketGames: cleanWithTicket,
      cleanBoardTicketSharePct: cleanBoard.length ? r2((cleanWithTicket / cleanBoard.length) * 100) : null,
    },
    returns,
    warning: returns.some((r) => r.warning),
    minN: FAIRNESS_MIN_N,
    topUsers,
    tickets: {
      issuedWheel,
      issuedAdmin,
      revokedAdmin: sumBy("admin_revoke"),
      redeemed,
      redeemRatePct: issuedWheel + issuedAdmin ? r2((redeemed / (issuedWheel + issuedAdmin)) * 100) : null,
      held: held.q,
      holders: held.holders,
    },
  };
}
