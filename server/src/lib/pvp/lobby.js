import { config } from "../config.js";
import { frameProp } from "../frameProp.js";
import { entranceProp } from "../cosmeticProp.js";
import { getJiuCoinBalance, shanghaiYmd } from "../jiuCoin.js";
import { roundHalfUp } from "../../../../shared/engine.js";
import { PVP_RATING_INITIAL, titleForRating } from "../../../../shared/pvpRating.js";
import { assessSelf, isBlocked } from "./eligibility.js";
import { currentEconomy, maxActiveMatches } from "./config.js";
import { readDrain } from "./drain.js";
import { publicNickname } from "./names.js";
import { idleBotCount, listIdleBotEntries } from "./botUsers.js";
import { isAvailable, listAvailableIds } from "./presence.js";

function avatarUrl(row) {
  if (!row?.avatar_custom_path) return null;
  return `/api/v1/avatars/${encodeURIComponent(row.avatar_custom_path)}`;
}

export function lobbySummary(db, now = Date.now(), viewerId = null) {
  if (!config.pvpBattleEnabled) {
    return { availableCount: 0, acceptingNew: false, disabledReason: "对战未开放" };
  }
  const draining = readDrain(db);
  const active = db
    .prepare(`SELECT COUNT(*) AS c FROM pvp_matches WHERE status IN ('waiting_ready', 'playing')`)
    .get().c;
  const full = Number(active) >= maxActiveMatches();
  const acceptingNew = !draining && !full;
  let disabledReason = null;
  if (draining) disabledReason = "对战已停止接受新局";
  else if (full) disabledReason = "对战房间已满";
  const viewer = viewerId == null ? null : Number(viewerId);
  const humanCount = listAvailableIds(now).filter((id) => id !== viewer).length;
  const availableCount = humanCount + idleBotCount(db, viewer);
  return {
    availableCount,
    acceptingNew,
    disabledReason,
  };
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


/** Public card for opponent modal / match seat enrichment. */
export function publicPlayerCard(db, userId) {
  const user = db
    .prepare(`SELECT id, nickname, avatar_id, avatar_custom_path, avatar_frame, pvp_entrance, signature, status FROM users WHERE id = ?`)
    .get(userId);
  if (!user) return null;
  const rating = db.prepare(`SELECT rating, games, wins, losses, draws FROM pvp_ratings WHERE user_id = ?`).get(userId);
  const title = titleForRating(rating?.rating ?? PVP_RATING_INITIAL, rating?.games ?? 0);
  const wins = Number(rating?.wins) || 0;
  const losses = Number(rating?.losses) || 0;
  const draws = Number(rating?.draws) || 0;
  return {
    userId: user.id,
    nickname: publicNickname(user),
    avatarId: user.avatar_id || 1,
    avatarUrl: avatarUrl(user),
    ...frameProp(user.avatar_frame),
    ...entranceProp(user.pvp_entrance),
    signature: user.signature == null ? "" : String(user.signature),
    title: title.inPlacement ? `${title.name} · 定级中` : title.name,
    titleName: title.name,
    iconPath: title.iconPath,
    inPlacement: !!title.inPlacement,
    rating: rating?.rating ?? PVP_RATING_INITIAL,
    wins,
    losses,
    draws,
    recent: recentOutcomes(db, userId),
  };
}

function entryFor(db, userId, busy) {
  const user = db
    .prepare(`SELECT id, nickname, avatar_id, avatar_custom_path, avatar_frame, signature FROM users WHERE id = ?`)
    .get(userId);
  if (!user) return null;
  const rating = db.prepare(`SELECT rating, games FROM pvp_ratings WHERE user_id = ?`).get(userId);
  const title = titleForRating(rating?.rating ?? PVP_RATING_INITIAL, rating?.games ?? 0);
  return {
    userId: user.id,
    nickname: user.nickname || "对手",
    avatarId: user.avatar_id || 1,
    avatarUrl: avatarUrl(user),
    ...frameProp(user.avatar_frame),
    signature: user.signature == null ? "" : String(user.signature),
    title: title.inPlacement ? `${title.name} · 定级中` : title.name,
    titleName: title.name,
    iconPath: title.iconPath,
    inPlacement: title.inPlacement,
    recent: recentOutcomes(db, userId),
    busy: busy.has(userId),
  };
}

export function listLobby(db, viewerId, { cursor = 0, limit = 20, now = Date.now() } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  const after = Number(cursor) || 0;
  const ids = listAvailableIds(now).filter((id) => id !== Number(viewerId) && id > after);
  const page = [];
  let nextCursor = null;
  const candidates = [];
  for (const id of ids) {
    if (isBlocked(db, viewerId, id)) continue;
    candidates.push(id);
  }
  const take = candidates.slice(0, size);
  if (candidates.length > size) nextCursor = String(take[take.length - 1]);
  const busy = new Set();
  if (take.length) {
    const marks = db
      .prepare(`SELECT user_id FROM pvp_active_members WHERE user_id IN (${take.map(() => "?").join(",")})`)
      .all(...take);
    for (const row of marks) busy.add(row.user_id);
  }
  for (const id of take) {
    const entry = entryFor(db, id, busy);
    if (entry) page.push(entry);
  }
  // Idle bots after humans. First page only so cursor pagination stays human-id based.
  if (after === 0) {
    const bots = listIdleBotEntries(db, viewerId, { now });
    const seen = new Set(page.map((e) => e.userId));
    for (const bot of bots) {
      if (seen.has(bot.userId)) continue;
      if (page.length >= size) break;
      page.push(bot);
      seen.add(bot.userId);
    }
  }
  return { entries: page, nextCursor };
}

function selfProfile(db, userId) {
  const user = db
    .prepare(`SELECT id, nickname, avatar_id, avatar_custom_path, avatar_frame, signature FROM users WHERE id = ?`)
    .get(userId);
  if (!user) return null;
  const rating = db.prepare(`SELECT rating, games, wins, losses, draws FROM pvp_ratings WHERE user_id = ?`).get(userId);
  const title = titleForRating(rating?.rating ?? PVP_RATING_INITIAL, rating?.games ?? 0);
  const wins = Number(rating?.wins) || 0;
  const losses = Number(rating?.losses) || 0;
  const draws = Number(rating?.draws) || 0;
  return {
    nickname: user.nickname || "我",
    avatarId: user.avatar_id || 1,
    avatarUrl: avatarUrl(user),
    ...frameProp(user.avatar_frame),
    signature: user.signature == null ? "" : String(user.signature),
    title: title.name,
    iconPath: title.iconPath,
    inPlacement: title.inPlacement,
    rating: rating?.rating ?? PVP_RATING_INITIAL,
    wins,
    losses,
    draws,
    empty: wins + losses + draws === 0,
  };
}

function challengeCard(db, row, viewerId) {
  const otherId = row.from_user_id === viewerId ? row.to_user_id : row.from_user_id;
  const other = db
    .prepare(`SELECT nickname, status, avatar_id, avatar_custom_path, avatar_frame FROM users WHERE id = ?`)
    .get(otherId);
  return {
    challengeId: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    direction: row.from_user_id === viewerId ? "outbound" : "inbound",
    nickname: publicNickname(other),
    avatarId: other?.avatar_id || 1,
    avatarUrl: avatarUrl(other),
    ...frameProp(other?.avatar_frame),
    expiresAt: row.expires_at,
  };
}

export function readPvpState(db, userId, now = Date.now()) {
  const gate = assessSelf(db, userId, now);
  const balance = getJiuCoinBalance(userId, db);
  const active = db
    .prepare(
      `SELECT m.id AS match_id, m.status AS status
       FROM pvp_active_members a
       JOIN pvp_matches m ON m.id = a.match_id
       WHERE a.user_id = ?`
    )
    .get(userId);
  const pending = db
    .prepare(
      `SELECT * FROM pvp_challenges
       WHERE status = 'pending' AND expires_at > ?
         AND (from_user_id = ? OR to_user_id = ?)
       ORDER BY created_at ASC, id ASC`
    )
    .all(now, userId, userId)
    .map((row) => challengeCard(db, row, userId));
  const economy = currentEconomy(now);
  return {
    available: isAvailable(userId, now),
    outbound: pending.find((row) => row.direction === "outbound") || null,
    inbound: pending.filter((row) => row.direction === "inbound"),
    activeMatchId: active?.match_id || null,
    activeMatchStatus: active?.status || null,
    eligibility: gate.ok ? { ok: true } : { ok: false, code: gate.code, message: gate.message },
    balance,
    economy: { entryCost: economy.entryCost, winReward: economy.winReward },
    me: selfProfile(db, userId),
    serverNow: now,
  };
}

export function challengeCountToday(db, userId, now = Date.now()) {
  const ymd = shanghaiYmd(new Date(now));
  const start = Date.parse(`${ymd}T00:00:00+08:00`);
  return Number(
    db.prepare(`SELECT COUNT(*) AS c FROM pvp_challenges WHERE from_user_id = ? AND created_at >= ?`).get(userId, start).c
  ) || 0;
}

export function readMyStats(db, userId) {
  const rating = db.prepare(`SELECT * FROM pvp_ratings WHERE user_id = ?`).get(userId);
  const wins = Number(rating?.wins) || 0;
  const losses = Number(rating?.losses) || 0;
  const draws = Number(rating?.draws) || 0;
  const scored = wins + losses + draws;
  const completedGames = Number(rating?.completed_games) || 0;
  const title = titleForRating(rating?.rating ?? PVP_RATING_INITIAL, rating?.games ?? 0);
  const best = db.prepare(
    `SELECT MAX(p.return_ppm) AS best
     FROM pvp_match_players p
     JOIN pvp_settlements s ON s.match_id = p.match_id
     WHERE p.user_id = ? AND s.terminal_type = 'completed' AND p.return_ppm IS NOT NULL`
  ).get(userId).best;
  const recent = db.prepare(
    `SELECT p.outcome AS outcome, s.reason AS reason
     FROM pvp_match_players p
     JOIN pvp_settlements s ON s.match_id = p.match_id
     WHERE p.user_id = ?
       AND s.terminal_type IN ('completed', 'forfeited')
       AND p.outcome IN ('win', 'loss', 'draw')
     ORDER BY s.id DESC
     LIMIT 20`
  ).all(userId);
  return {
    empty: scored === 0,
    rating: rating?.rating ?? PVP_RATING_INITIAL,
    title: {
      name: title.name,
      inPlacement: title.inPlacement,
      pointsToNext: title.pointsToNext,
    },
    wins,
    losses,
    draws,
    winRate: scored === 0 ? null : roundHalfUp((wins / scored) * 1e6) / 1e6,
    recent: recent.map((row) => row.outcome),
    completedGames,
    meanCompletedReturnPpm: completedGames > 0
      ? roundHalfUp(rating.completed_return_sum_ppm / completedGames)
      : null,
    bestCompletedReturnPpm: best == null ? null : Number(best),
    recentForfeits: recent.filter((row) => row.reason === "forfeit" && row.outcome === "loss").length,
  };
}

export function listMyMatches(db, userId, { cursor = "", limit = 20 } = {}) {
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  let afterFinished = Number.MAX_SAFE_INTEGER;
  let afterId = "";
  if (cursor) {
    const split = String(cursor).split(":");
    afterFinished = Number(split[0]);
    afterId = split.slice(1).join(":");
  }
  const rows = db
    .prepare(
      `SELECT m.id AS match_id, m.finished_at, m.status, m.terminal_reason,
              me.outcome, me.return_ppm, me.mdd_ppm, me.coin_delta, me.actual_rating_delta,
              opp.user_id AS opponent_id, ou.nickname AS opponent_nickname, ou.status AS opponent_status
       FROM pvp_match_players me
       JOIN pvp_matches m ON m.id = me.match_id
       JOIN pvp_match_players opp ON opp.match_id = m.id AND opp.user_id <> me.user_id
       JOIN users ou ON ou.id = opp.user_id
       WHERE me.user_id = ? AND m.finished_at IS NOT NULL
         AND (m.finished_at < ? OR (m.finished_at = ? AND m.id < ?))
       ORDER BY m.finished_at DESC, m.id DESC
       LIMIT ?`
    )
    .all(userId, afterFinished, afterFinished, afterId, size + 1);
  const slice = rows.slice(0, size);
  const last = slice[slice.length - 1];
  return {
    entries: slice.map((row) => ({
      matchId: row.match_id,
      finishedAt: row.finished_at,
      status: row.status,
      terminalReason: row.terminal_reason,
      outcome: row.outcome,
      returnPpm: row.return_ppm,
      mddPpm: row.mdd_ppm,
      coinDelta: row.coin_delta,
      ratingDelta: row.actual_rating_delta,
      opponentUserId: row.opponent_id,
      opponentNickname: publicNickname({ nickname: row.opponent_nickname, status: row.opponent_status }),
    })),
    nextCursor: rows.length > size && last ? `${last.finished_at}:${last.match_id}` : null,
  };
}
