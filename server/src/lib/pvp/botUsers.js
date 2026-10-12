import { config } from "../config.js";
import { titleForRating, PVP_RATING_INITIAL } from "../../../../shared/pvpRating.js";
import { maxActiveMatches } from "./config.js";
import { isBlocked } from "./eligibility.js";
import { isAvailable } from "./presence.js";

const BOT_SEED = [
  { username: "__pvp_bot_1", nickname: "做T机器神", avatarId: 2 },
  { username: "__pvp_bot_2", nickname: "波段菠菜机", avatarId: 7 },
  { username: "__pvp_bot_3", nickname: "追涨小白条", avatarId: 11 },
];

export function botsFeatureOn() {
  return !!(config.pvpBattleEnabled && config.pvpBotsEnabled);
}

export function isBotRow(row) {
  return !!(row && Number(row.is_bot) === 1);
}

export function isBotUser(db, userId) {
  const row = db.prepare(`SELECT is_bot FROM users WHERE id = ?`).get(userId);
  return isBotRow(row);
}

export function listBotUsers(db) {
  return db
    .prepare(
      `SELECT id, nickname, avatar_id, avatar_custom_path, is_bot, status, jiu_coin_balance
       FROM users WHERE is_bot = 1 AND status = 'active'
       ORDER BY id ASC`
    )
    .all();
}

/** Idempotent seed for tests / older DBs that somehow missed migration inserts. */
export function ensureBotsSeeded(db) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO users (
      username_normalized, password_hash, nickname, avatar_id,
      role, status, leaderboard_opt_in, jiu_coin_balance, is_bot
    ) VALUES (?, '!', ?, ?, 'user', 'active', 0, 10000000, 1)`
  );
  for (const bot of BOT_SEED) {
    insert.run(bot.username, bot.nickname, bot.avatarId);
  }
  return listBotUsers(db);
}

function busyUserIds(db, userIds) {
  const busy = new Set();
  if (!userIds.length) return busy;
  const rows = db
    .prepare(`SELECT user_id FROM pvp_active_members WHERE user_id IN (${userIds.map(() => "?").join(",")})`)
    .all(...userIds);
  for (const row of rows) busy.add(row.user_id);
  return busy;
}

export function countActiveBotMatches(db) {
  return Number(
    db
      .prepare(
        `SELECT COUNT(DISTINCT m.id) AS c
         FROM pvp_matches m
         JOIN pvp_match_players p ON p.match_id = m.id
         JOIN users u ON u.id = p.user_id AND u.is_bot = 1
         WHERE m.status IN ('waiting_ready', 'playing')`
      )
      .get().c
  ) || 0;
}

function activeMatchCount(db) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`).get().c
  ) || 0;
}

/**
 * Prefer humans at peak: refuse new bot matches when near the room cap
 * or when concurrent bot matches already hit the soft cap.
 */
export function botMatchAllowed(db) {
  if (!botsFeatureOn()) return false;
  const active = activeMatchCount(db);
  const max = maxActiveMatches();
  const reserve = Math.max(0, Number(config.pvpHumanRoomReserve) || 0);
  if (active >= max) return false;
  if (active >= Math.max(0, max - reserve)) return false;
  const botActive = countActiveBotMatches(db);
  const botCap = Math.max(1, Number(config.pvpMaxBotMatches) || 3);
  if (botActive >= botCap) return false;
  return true;
}

export function isIdleBot(db, userId) {
  if (!botsFeatureOn()) return false;
  const row = db.prepare(`SELECT id, is_bot, status FROM users WHERE id = ?`).get(userId);
  if (!isBotRow(row) || row.status !== "active") return false;
  const locked = db.prepare(`SELECT 1 AS hit FROM pvp_active_members WHERE user_id = ?`).get(userId);
  return !locked;
}

/** True if the target can be challenged: human presence or idle bot. */
export function isChallengeableTarget(db, userId, now = Date.now()) {
  if (isAvailable(userId, now)) return true;
  return isIdleBot(db, userId);
}

function avatarUrl(row) {
  if (!row?.avatar_custom_path) return null;
  return `/api/v1/avatars/${encodeURIComponent(row.avatar_custom_path)}`;
}

function recentOutcomes(db, userId) {
  return db
    .prepare(
      `SELECT p.outcome AS outcome
       FROM pvp_match_players p
       JOIN pvp_matches m ON m.id = p.match_id
       WHERE p.user_id = ? AND m.status = 'settled' AND m.finished_at IS NOT NULL
       ORDER BY m.finished_at DESC, m.id DESC
       LIMIT 5`
    )
    .all(userId)
    .map((row) => row.outcome)
    .filter(Boolean);
}

function botEntry(db, row, busy) {
  const rating = db.prepare(`SELECT rating, games FROM pvp_ratings WHERE user_id = ?`).get(row.id);
  const title = titleForRating(rating?.rating ?? PVP_RATING_INITIAL, rating?.games ?? 0);
  return {
    userId: row.id,
    nickname: row.nickname || "对手",
    avatarId: row.avatar_id || 1,
    avatarUrl: avatarUrl(row),
    title: title.inPlacement ? `${title.name} · 定级中` : title.name,
    inPlacement: title.inPlacement,
    recent: recentOutcomes(db, row.id),
    busy: busy.has(row.id),
    isBot: true,
  };
}

/** Idle bots for lobby injection (caller places them after humans). */
export function listIdleBotEntries(db, viewerId, { now = Date.now() } = {}) {
  if (!botsFeatureOn()) return [];
  const bots = listBotUsers(db);
  const ids = bots.map((b) => b.id);
  const busy = busyUserIds(db, ids);
  const out = [];
  for (const row of bots) {
    if (Number(row.id) === Number(viewerId)) continue;
    if (isBlocked(db, viewerId, row.id)) continue;
    if (busy.has(row.id)) continue;
    out.push(botEntry(db, row, busy));
  }
  return out;
}

export function idleBotCount(db, viewerId = null) {
  if (!botsFeatureOn()) return 0;
  return listIdleBotEntries(db, viewerId).length;
}
