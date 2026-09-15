/**
 * Puzzle 同题周榜 — one featured level per Shanghai ISO week; rank best returnPpm.
 * Flag: PUZZLE_WEEKLY_ENABLED (default OFF). Does not mix into classic / daily boards.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { shanghaiYmd } from "./jiuCoin.js";
import { seedAllPuzzleChapters } from "./puzzleChapter.js";
import { levelDefByKey } from "./puzzleLevels.js";
import { GAME_KIND_PUZZLE } from "../../../shared/protocol.js";
import { formatReturnPct } from "../../../shared/puzzleEngine.js";

const WEEK_PREFIX = "puzzle-weekly:";

export function requirePuzzleWeeklyEnabled() {
  if (!config.puzzleWeeklyEnabled) {
    const err = new Error("残局同题周榜暂未开放");
    err.code = "PUZZLE_WEEKLY_DISABLED";
    err.status = 404;
    throw err;
  }
}

/**
 * Shanghai calendar date → ISO week id `YYYY-Www` (Mon–Sun, ISO-8601).
 * Documented rule: use Asia/Shanghai local YMD, then standard ISO week-year / week.
 */
export function shanghaiIsoWeekId(date = new Date()) {
  const ymd = shanghaiYmd(date);
  const [y, m, d] = ymd.split("-").map(Number);
  // Noon UTC on the Shanghai calendar day — China has no DST; date components stable.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay() || 7; // Mon=1 … Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // Thursday of this ISO week
  const weekYear = dt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNo = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${weekYear}-W${String(weekNo).padStart(2, "0")}`;
}

/** Monday 00:00+08 … next Monday 00:00+08 for an ISO week id. */
export function shanghaiIsoWeekBounds(weekId) {
  const m = String(weekId || "").match(/^(\d{4})-W(\d{2})$/);
  if (!m) {
    const err = new Error("invalid week id");
    err.code = "INVALID_WEEK";
    err.status = 400;
    throw err;
  }
  const weekYear = Number(m[1]);
  const weekNo = Number(m[2]);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(weekYear, 0, 4, 12, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (weekNo - 1) * 7);
  const y = monday.getUTCFullYear();
  const mo = monday.getUTCMonth() + 1;
  const d = monday.getUTCDate();
  const startYmd = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const startMs = Date.parse(`${startYmd}T00:00:00+08:00`);
  const endMs = startMs + 7 * 24 * 60 * 60 * 1000;
  return {
    weekId: `${weekYear}-W${String(weekNo).padStart(2, "0")}`,
    startYmd,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

function publishedCh1Ch2LevelKeys(db) {
  const rows = db
    .prepare(
      `SELECT level_key FROM (
         SELECT level_key, MAX(version) AS max_version
         FROM puzzle_versions
         WHERE status = 'published' AND chapter_id IN ('ch1', 'ch2')
         GROUP BY level_key
       )
       ORDER BY level_key ASC`
    )
    .all();
  return rows.map((r) => r.level_key);
}

/** Deterministic featured levelKey for a week id (same for all players). */
export function featuredLevelKeyForWeek(weekId, db = openDb()) {
  const keys = publishedCh1Ch2LevelKeys(db);
  if (!keys.length) return null;
  const hash = crypto.createHash("sha256").update(`${WEEK_PREFIX}${weekId}`, "utf8").digest("hex");
  const idx = Number.parseInt(hash.slice(0, 8), 16) % keys.length;
  return keys[idx];
}

function levelPublicMeta(levelKey) {
  const def = levelDefByKey(levelKey);
  if (!def) {
    return { levelKey, title: levelKey, theme: null, chapterId: null };
  }
  return {
    levelKey: def.levelKey,
    title: def.title,
    theme: def.theme,
    chapterId: def.levelKey.startsWith("ch2") ? "ch2" : "ch1",
    gameDays: def.gameDays,
    teachingBrief: def.teachingBrief || null,
  };
}

/**
 * Weekly meta + optional board preview.
 * @param {{ weekId?: string, userId?: number|null, limit?: number, includeBoard?: boolean }} opts
 */
export function getPuzzleWeekly({
  weekId = null,
  userId = null,
  limit = 50,
  includeBoard = true,
} = {}) {
  requirePuzzleWeeklyEnabled();
  // Ensure published levels exist for selection (idempotent).
  if (config.puzzleChapterEnabled) {
    seedAllPuzzleChapters();
  }
  const db = openDb();
  const wid = weekId || shanghaiIsoWeekId();
  const bounds = shanghaiIsoWeekBounds(wid);
  const levelKey = featuredLevelKeyForWeek(bounds.weekId, db);
  if (!levelKey) {
    return {
      ready: false,
      weekId: bounds.weekId,
      startYmd: bounds.startYmd,
      startIso: bounds.startIso,
      endIso: bounds.endIso,
      message: "本周同题关卡准备中",
      level: null,
      entries: [],
      total: 0,
      mine: null,
    };
  }

  const level = levelPublicMeta(levelKey);
  let entries = [];
  let total = 0;
  let mine = null;

  if (includeBoard) {
    const board = queryWeeklyBoard(db, {
      levelKey,
      startIso: bounds.startIso,
      endIso: bounds.endIso,
      limit,
      userId,
    });
    entries = board.entries;
    total = board.total;
    mine = board.mine;
  } else if (userId) {
    mine = queryMyBest(db, {
      userId,
      levelKey,
      startIso: bounds.startIso,
      endIso: bounds.endIso,
    });
  }

  return {
    ready: true,
    weekId: bounds.weekId,
    startYmd: bounds.startYmd,
    startIso: bounds.startIso,
    endIso: bounds.endIso,
    selectionRule: "sha256(puzzle-weekly:<weekId>)[0:8] % published(ch1+ch2) ordered by levelKey",
    level,
    total,
    entries,
    mine,
  };
}

function queryMyBest(db, { userId, levelKey, startIso, endIso }) {
  const row = db
    .prepare(
      `SELECT
         gs.id AS game_id,
         gr.return_ppm AS return_ppm,
         gr.mdd_ppm AS mdd_ppm,
         gs.finished_at AS finished_at
       FROM game_sessions gs
       JOIN game_results gr ON gr.game_id = gs.id
       JOIN puzzle_versions pv ON pv.id = gs.puzzle_version_id
       WHERE gs.user_id = ?
         AND gs.game_kind = ?
         AND gs.status = 'settled'
         AND pv.level_key = ?
         AND gs.finished_at >= ?
         AND gs.finished_at < ?
       ORDER BY gr.return_ppm DESC, gr.mdd_ppm ASC, gs.finished_at ASC, gs.id ASC
       LIMIT 1`
    )
    .get(userId, GAME_KIND_PUZZLE, levelKey, startIso, endIso);
  if (!row) return null;
  return {
    gameId: row.game_id,
    returnPpm: row.return_ppm,
    returnPct: formatReturnPct(row.return_ppm),
    mddPpm: row.mdd_ppm,
    finishedAt: row.finished_at,
  };
}

function queryWeeklyBoard(db, { levelKey, startIso, endIso, limit, userId }) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const bestRows = db
    .prepare(
      `WITH ranked AS (
         SELECT
           gs.user_id AS user_id,
           gs.id AS game_id,
           gr.return_ppm AS return_ppm,
           gr.mdd_ppm AS mdd_ppm,
           gs.finished_at AS finished_at,
           ROW_NUMBER() OVER (
             PARTITION BY gs.user_id
             ORDER BY gr.return_ppm DESC, gr.mdd_ppm ASC, gs.finished_at ASC, gs.id ASC
           ) AS rn
         FROM game_sessions gs
         JOIN game_results gr ON gr.game_id = gs.id
         JOIN puzzle_versions pv ON pv.id = gs.puzzle_version_id
         WHERE gs.game_kind = ?
           AND gs.status = 'settled'
           AND pv.level_key = ?
           AND gs.finished_at >= ?
           AND gs.finished_at < ?
       )
       SELECT
         r.user_id AS user_id,
         r.game_id AS game_id,
         r.return_ppm AS return_ppm,
         r.mdd_ppm AS mdd_ppm,
         r.finished_at AS finished_at,
         u.nickname AS nickname,
         u.avatar_id AS avatar_id,
         u.avatar_custom_path AS avatar_custom_path,
         DENSE_RANK() OVER (
           ORDER BY r.return_ppm DESC, r.mdd_ppm ASC, r.finished_at ASC, r.user_id ASC
         ) AS rank
       FROM ranked r
       JOIN users u ON u.id = r.user_id
       WHERE r.rn = 1 AND u.status = 'active'
       ORDER BY r.return_ppm DESC, r.mdd_ppm ASC, r.finished_at ASC, r.user_id ASC
       LIMIT ?`
    )
    .all(GAME_KIND_PUZZLE, levelKey, startIso, endIso, lim);

  const totalRow = db
    .prepare(
      `SELECT COUNT(DISTINCT gs.user_id) AS c
       FROM game_sessions gs
       JOIN game_results gr ON gr.game_id = gs.id
       JOIN puzzle_versions pv ON pv.id = gs.puzzle_version_id
       JOIN users u ON u.id = gs.user_id
       WHERE gs.game_kind = ?
         AND gs.status = 'settled'
         AND pv.level_key = ?
         AND gs.finished_at >= ?
         AND gs.finished_at < ?
         AND u.status = 'active'`
    )
    .get(GAME_KIND_PUZZLE, levelKey, startIso, endIso);

  const entries = bestRows.map((r) => {
    const custom = r.avatar_custom_path || null;
    return {
      rank: r.rank,
      userId: r.user_id,
      nickname: r.nickname,
      avatarId: r.avatar_id,
      avatarCustomPath: custom,
      avatarUrl: custom ? `/api/v1/avatars/${encodeURIComponent(custom)}` : null,
      gameId: r.game_id,
      returnPpm: r.return_ppm,
      returnPct: formatReturnPct(r.return_ppm),
      mddPpm: r.mdd_ppm,
      finishedAt: r.finished_at,
    };
  });

  let mine = null;
  if (userId) {
    const myBest = queryMyBest(db, { userId, levelKey, startIso, endIso });
    if (myBest) {
      const rankRow = db
        .prepare(
          `WITH ranked AS (
             SELECT
               gs.user_id AS user_id,
               gr.return_ppm AS return_ppm,
               gr.mdd_ppm AS mdd_ppm,
               gs.finished_at AS finished_at,
               ROW_NUMBER() OVER (
                 PARTITION BY gs.user_id
                 ORDER BY gr.return_ppm DESC, gr.mdd_ppm ASC, gs.finished_at ASC, gs.id ASC
               ) AS rn
             FROM game_sessions gs
             JOIN game_results gr ON gr.game_id = gs.id
             JOIN puzzle_versions pv ON pv.id = gs.puzzle_version_id
             WHERE gs.game_kind = ?
               AND gs.status = 'settled'
               AND pv.level_key = ?
               AND gs.finished_at >= ?
               AND gs.finished_at < ?
           ),
           best AS (
             SELECT r.user_id, r.return_ppm, r.mdd_ppm, r.finished_at
             FROM ranked r
             JOIN users u ON u.id = r.user_id
             WHERE r.rn = 1 AND u.status = 'active'
           )
           SELECT DENSE_RANK() OVER (
             ORDER BY return_ppm DESC, mdd_ppm ASC, finished_at ASC, user_id ASC
           ) AS rank
           FROM best
           WHERE user_id = ?`
        )
        .get(GAME_KIND_PUZZLE, levelKey, startIso, endIso, userId);
      mine = { ...myBest, rank: rankRow?.rank ?? null };
    }
  }

  return {
    entries,
    total: Number(totalRow?.c) || 0,
    mine,
  };
}

export function getPuzzleWeeklyBoard(opts = {}) {
  return getPuzzleWeekly({ ...opts, includeBoard: true });
}
