/**
 * Admin batch 3: read-only content stats, daily-board moderation, PvP share links,
 * announcement scheduling, feedback notes. Every write is audited.
 */
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { writeAuditLog } from "./audit.js";
import { shanghaiYmdAt, challengeNow, getChallengeByDate } from "./dailyChallenge.js";

function count(db, sql, ...p) {
  try {
    return Number(db.prepare(sql).get(...p)?.c) || 0;
  } catch {
    return 0;
  }
}

function reasonOk(reason) {
  const r = typeof reason === "string" ? reason.trim() : "";
  return r.length >= 2 && r.length <= 200 ? r : null;
}

const bad = (status, code, message) => ({ ok: false, status, code, message });

/* ---------- content overview (read-only) ---------- */
export function adminContentOverview(db = openDb()) {
  const today = shanghaiYmdAt(challengeNow());
  const quizSet = db.prepare(`SELECT * FROM quiz_daily_sets WHERE set_date = ?`).get(today) || null;
  const quiz = {
    enabled: !!config.quizRewardsEnabled,
    activeQuestions: count(db, `SELECT COUNT(*) c FROM quiz_questions WHERE active = 1`),
    today,
    todaySet: quizSet
      ? {
          questions: JSON.parse(quizSet.question_ids_json || "[]").length,
          rewardComplete: quizSet.reward_complete,
          rewardBonus: quizSet.reward_bonus,
          bonusMinCorrect: quizSet.bonus_min_correct,
        }
      : null,
    attemptsToday: count(db, `SELECT COUNT(*) c FROM quiz_attempts WHERE set_date = ?`, today),
    settledToday: count(db, `SELECT COUNT(*) c FROM quiz_attempts WHERE set_date = ? AND status = 'settled'`, today),
    coinsToday: count(db, `SELECT COALESCE(SUM(reward_amount),0) c FROM quiz_attempts WHERE set_date = ? AND status = 'settled'`, today),
    attempts7d: count(db, `SELECT COUNT(*) c FROM quiz_attempts WHERE created_at >= datetime('now','-7 days')`),
  };
  const chapters = db
    .prepare(
      `SELECT chapter_id,
              COUNT(DISTINCT level_key) AS levels,
              COUNT(DISTINCT CASE WHEN status = 'published' THEN level_key END) AS published
       FROM puzzle_versions GROUP BY chapter_id ORDER BY chapter_id`
    )
    .all()
    .map((r) => ({
      chapterId: r.chapter_id,
      levels: r.levels,
      published: r.published,
      players: count(db, `SELECT COUNT(DISTINCT user_id) c FROM puzzle_progress WHERE chapter_id = ?`, r.chapter_id),
      twoStarClears: count(db, `SELECT COUNT(*) c FROM puzzle_progress WHERE chapter_id = ? AND best_stars >= 2`, r.chapter_id),
      played7d: count(db, `SELECT COUNT(*) c FROM puzzle_progress WHERE chapter_id = ? AND last_played_at >= datetime('now','-7 days')`, r.chapter_id),
    }));
  const daily = getChallengeByDate(today, db);
  return {
    flags: {
      quizRewards: !!config.quizRewardsEnabled,
      puzzleChapter: !!config.puzzleChapterEnabled,
      puzzleWeekly: !!config.puzzleWeeklyEnabled,
      dailyChallenge: !!config.dailyChallengeEnabled,
      ghostDuel: !!config.ghostDuelEnabled,
    },
    quiz,
    puzzles: { chapters },
    daily: daily
      ? {
          date: today,
          stockCode: daily.stock_code,
          stockName: daily.stock_name,
          attempts: count(db, `SELECT COUNT(*) c FROM daily_challenge_attempts WHERE challenge_id = ?`, daily.id),
          settled: count(db, `SELECT COUNT(*) c FROM daily_challenge_attempts WHERE challenge_id = ? AND status = 'settled'`, daily.id),
        }
      : { date: today, missing: true },
  };
}

/* ---------- daily challenge board (admin view, incl. hidden) ---------- */
function isValidYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function adminDailyBoard(db = openDb(), { date } = {}) {
  const ymd = date || shanghaiYmdAt(challengeNow());
  if (!isValidYmd(ymd)) return bad(400, "BAD_DATE", "日期格式须为 YYYY-MM-DD");
  const ch = getChallengeByDate(ymd, db);
  if (!ch) return { ok: true, date: ymd, challenge: null, entries: [] };
  const hidden = new Set(
    db
      .prepare(
        `SELECT target_id FROM audit_logs a
         WHERE a.target_type = 'daily_attempt' AND a.action = 'daily.hide'
           AND NOT EXISTS (SELECT 1 FROM audit_logs b WHERE b.target_type = 'daily_attempt'
             AND b.target_id = a.target_id AND b.action = 'daily.unhide' AND b.id > a.id)`
      )
      .all()
      .map((r) => r.target_id)
  );
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, a.game_id, a.status, a.board_eligible, a.return_ppm, a.mdd_ppm, a.settled_at,
              u.nickname, u.username_normalized AS username, u.status AS user_status
       FROM daily_challenge_attempts a JOIN users u ON u.id = a.user_id
       WHERE a.challenge_id = ?
       ORDER BY (a.status = 'settled') DESC, a.return_ppm DESC, a.mdd_ppm ASC, a.settled_at ASC, a.user_id ASC
       LIMIT 200`
    )
    .all(ch.id);
  return {
    ok: true,
    date: ymd,
    challenge: {
      id: ch.id,
      stockCode: ch.stock_code,
      stockName: ch.stock_name,
      opensAt: ch.opens_at,
      closesAt: ch.closes_at,
      gameDays: ch.game_days,
    },
    entries: rows.map((r) => ({
      attemptId: r.id,
      userId: r.user_id,
      username: r.username,
      nickname: r.nickname,
      userStatus: r.user_status,
      gameId: r.game_id,
      status: r.status,
      boardEligible: !!r.board_eligible,
      hiddenByAdmin: hidden.has(r.id),
      returnPpm: r.return_ppm,
      mddPpm: r.mdd_ppm,
      settledAt: r.settled_at,
    })),
  };
}

/** Hide = board_eligible 0. Unhide only reverses an admin hide (never promotes a late/ineligible run). */
export function adminDailySetHidden(db, { attemptId, hide, actorId, reason, requestId }) {
  const r = reasonOk(reason);
  if (!r) return bad(400, "REASON_REQUIRED", "原因需 2–200 字");
  if (typeof hide !== "boolean") return bad(400, "BAD_PAYLOAD", "hide 须为 true/false");
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM daily_challenge_attempts WHERE id = ?`).get(attemptId);
    if (!row) return bad(404, "NOT_FOUND", "挑战记录不存在");
    const lastAdmin = db
      .prepare(
        `SELECT action FROM audit_logs WHERE target_type = 'daily_attempt' AND target_id = ?
         AND action IN ('daily.hide','daily.unhide') ORDER BY id DESC LIMIT 1`
      )
      .get(attemptId);
    const hiddenByAdmin = lastAdmin?.action === "daily.hide";
    if (hide) {
      if (hiddenByAdmin) return { ok: true, unchanged: true };
      if (!row.board_eligible) return bad(409, "NOT_ON_BOARD", "该记录本来就不在榜上");
      db.prepare(`UPDATE daily_challenge_attempts SET board_eligible = 0 WHERE id = ?`).run(attemptId);
    } else {
      if (!hiddenByAdmin) return bad(409, "NOT_HIDDEN_BY_ADMIN", "只能恢复被后台隐藏的记录");
      db.prepare(`UPDATE daily_challenge_attempts SET board_eligible = 1 WHERE id = ?`).run(attemptId);
    }
    writeAuditLog({
      actorId,
      action: hide ? "daily.hide" : "daily.unhide",
      targetType: "daily_attempt",
      targetId: attemptId,
      reason: r,
      before: { status: row.board_eligible ? "on_board" : "off_board" },
      after: { status: hide ? "off_board" : "on_board" },
      requestId,
    });
    return { ok: true, attemptId, hidden: hide };
  })();
}

/* ---------- PvP share links ---------- */
export function adminListShares(db = openDb(), { status = "", cursor = "", limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const clauses = [];
  const params = [];
  if (["open", "joined", "cancelled", "expired"].includes(status)) {
    clauses.push("s.status = ?");
    params.push(status);
  }
  if (cursor) {
    clauses.push("s.rowid < ?");
    params.push(Number(cursor));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT s.rowid AS rowid, s.*, u.nickname, u.username_normalized AS username
       FROM pvp_share_links s LEFT JOIN users u ON u.id = s.from_user_id
       ${where} ORDER BY s.rowid DESC LIMIT ?`
    )
    .all(...params, lim + 1);
  const page = rows.slice(0, lim);
  const now = Date.now();
  return {
    items: page.map((r) => ({
      code: r.code,
      fromUserId: r.from_user_id,
      nickname: r.nickname,
      username: r.username,
      status: r.status === "open" && r.expires_at <= now ? "expired" : r.status,
      storedStatus: r.status,
      matchId: r.match_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
    nextCursor: rows.length > lim ? String(page[page.length - 1].rowid) : null,
  };
}

export function adminRevokeShare(db, { code, actorId, reason, requestId }) {
  const r = reasonOk(reason);
  if (!r) return bad(400, "REASON_REQUIRED", "原因需 2–200 字");
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM pvp_share_links WHERE code = ?`).get(code);
    if (!row) return bad(404, "NOT_FOUND", "分享链接不存在");
    if (row.status !== "open") return bad(409, "SHARE_CLOSED", `链接已是 ${row.status}，无需作废`);
    db.prepare(`UPDATE pvp_share_links SET status = 'cancelled' WHERE code = ? AND status = 'open'`).run(code);
    writeAuditLog({
      actorId,
      action: "pvp.share.revoke",
      targetType: "pvp_share",
      targetId: code,
      reason: r,
      before: { status: row.status },
      after: { status: "cancelled" },
      requestId,
    });
    return { ok: true, code, status: "cancelled" };
  })();
}

/* ---------- announcement scheduling ---------- */
function toSqlUtc(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function adminScheduleAnnouncement(db, { id, publishAt, actorId, requestId }) {
  const when = new Date(publishAt);
  if (typeof publishAt !== "string" || Number.isNaN(when.getTime())) return bad(400, "BAD_TIME", "发布时间无效");
  const now = Date.now();
  if (when.getTime() < now + 60_000) return bad(400, "BAD_TIME", "定时发布须晚于当前 1 分钟以上；立即发布请用「发布」");
  if (when.getTime() > now + 90 * 86400_000) return bad(400, "BAD_TIME", "最多提前 90 天");
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(id);
    if (!row) return bad(404, "NOT_FOUND", "公告不存在");
    if (row.status !== "draft") return bad(409, "NOT_DRAFT", "只有草稿可以定时发布（已发布的无需定时，已归档的不能发布）");
    const at = toSqlUtc(when);
    db.prepare(`UPDATE announcements SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?`).run(at, id);
    writeAuditLog({
      actorId,
      action: "announcement.schedule",
      targetType: "announcement",
      targetId: String(id),
      reason: `schedule ${at} UTC`,
      before: { status: row.status },
      after: { status: "draft" },
      requestId,
    });
    return { ok: true, id, scheduledAt: at };
  })();
}

export function adminCancelSchedule(db, { id, actorId, requestId }) {
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(id);
    if (!row) return bad(404, "NOT_FOUND", "公告不存在");
    if (row.status !== "draft" || !row.scheduled_at) return bad(409, "NOT_SCHEDULED", "该公告没有待发布的定时");
    db.prepare(`UPDATE announcements SET scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
    writeAuditLog({
      actorId,
      action: "announcement.unschedule",
      targetType: "announcement",
      targetId: String(id),
      reason: "unschedule",
      requestId,
    });
    return { ok: true, id };
  })();
}

/** id -> scheduled_at for admin list display. */
export function scheduledAnnouncementMap(db = openDb()) {
  try {
    return Object.fromEntries(
      db.prepare(`SELECT id, scheduled_at FROM announcements WHERE scheduled_at IS NOT NULL`).all().map((r) => [r.id, r.scheduled_at])
    );
  } catch {
    return {};
  }
}

/* ---------- feedback ---------- */
export function adminFeedbackUnread(db = openDb()) {
  return { count: count(db, `SELECT COUNT(*) c FROM user_feedback WHERE status = 'new'`) };
}

export function adminFeedbackNote(db, id) {
  try {
    const r = db.prepare(`SELECT admin_note, admin_note_by, admin_note_at FROM user_feedback WHERE id = ?`).get(id);
    return r ? { note: r.admin_note || "", by: r.admin_note_by, at: r.admin_note_at } : null;
  } catch {
    return null;
  }
}

export function adminSetFeedbackNote(db, { id, note, actorId, requestId }) {
  if (typeof note !== "string") return bad(400, "BAD_PAYLOAD", "备注须为字符串");
  const n = note.trim();
  if ([...n].length > 1000) return bad(400, "NOTE_TOO_LONG", "备注最多 1000 字");
  return db.transaction(() => {
    const row = db.prepare(`SELECT id, admin_note FROM user_feedback WHERE id = ?`).get(id);
    if (!row) return bad(404, "NOT_FOUND", "反馈不存在");
    db.prepare(
      `UPDATE user_feedback SET admin_note = ?, admin_note_by = ?, admin_note_at = datetime('now') WHERE id = ?`
    ).run(n || null, actorId ?? null, id);
    writeAuditLog({
      actorId,
      action: "feedback.note",
      targetType: "feedback",
      targetId: String(id),
      reason: n ? "note" : "note cleared",
      requestId,
    });
    return { ok: true, id, note: adminFeedbackNote(db, id) };
  })();
}
