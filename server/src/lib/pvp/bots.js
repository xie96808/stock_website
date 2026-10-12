import crypto from "node:crypto";
import { config } from "../config.js";
import { decideAction, pickBotDelayMs } from "../../../../shared/pvpBotPolicy.js";
import { botsFeatureOn } from "./botUsers.js";
import { lockBotAction } from "./match.js";

/** matchId → { round, dueAt, botUserId } */
const schedules = new Map();

export function clearBotSchedules() {
  schedules.clear();
}

function barsOf(match) {
  try {
    const snapshot = JSON.parse(match.snapshot_json || "null");
    return Array.isArray(snapshot?.bars) ? snapshot.bars : null;
  } catch {
    return null;
  }
}

function parseActions(raw, k) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else {
    try {
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list.slice(0, k);
}

function humanLockedThisRound(db, matchId, round, botUserId) {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM pvp_actions
       WHERE match_id = ? AND round = ? AND user_id <> ? AND source IN ('player', 'bot')`
    )
    .get(matchId, round, botUserId);
  return !!row;
}

/**
 * Scan playing bot matches and lock when the scheduled delay elapses.
 */
export function tickBots(db, now = Date.now()) {
  if (!botsFeatureOn()) return [];
  const rows = db
    .prepare(
      `SELECT m.id AS match_id, m.resolved_rounds, m.round_opens_at, m.round_deadline_at,
              m.economy_json, m.snapshot_json, p.user_id AS bot_user_id, p.actions_json
       FROM pvp_matches m
       JOIN pvp_match_players p ON p.match_id = m.id
       JOIN users u ON u.id = p.user_id AND u.is_bot = 1
       WHERE m.status = 'playing'`
    )
    .all();

  const done = [];
  for (const row of rows) {
    const k = Number(row.resolved_rounds) || 0;
    if (k >= 29) {
      schedules.delete(row.match_id);
      continue;
    }
    const round = k + 1;
    if (row.round_opens_at == null || now < row.round_opens_at) continue;
    if (row.round_deadline_at != null && now >= row.round_deadline_at) {
      schedules.delete(row.match_id);
      continue;
    }
    const already = db
      .prepare(`SELECT 1 AS hit FROM pvp_actions WHERE match_id = ? AND user_id = ? AND round = ?`)
      .get(row.match_id, row.bot_user_id, round);
    if (already) {
      schedules.delete(row.match_id);
      continue;
    }

    const lockedHuman = humanLockedThisRound(db, row.match_id, round, row.bot_user_id);
    let sched = schedules.get(row.match_id);
    if (!sched || sched.round !== round) {
      let dayMs = 30_000;
      try {
        dayMs = JSON.parse(row.economy_json || "null")?.dayMs || 30_000;
      } catch {
        dayMs = 30_000;
      }
      const delay = pickBotDelayMs({ dayMs, humanLocked: lockedHuman, rng: Math.random });
      const dueAt = lockedHuman ? now + delay : row.round_opens_at + delay;
      sched = { round, dueAt, botUserId: row.bot_user_id };
      schedules.set(row.match_id, sched);
    } else if (lockedHuman && sched.dueAt > now + 2000) {
      sched.dueAt = now + pickBotDelayMs({ humanLocked: true, rng: Math.random });
    }

    if (now < sched.dueAt) continue;

    const bars = barsOf(row);
    const prior = parseActions(row.actions_json, k);
    const action = decideAction({
      bars,
      priorActions: prior,
      revealedBars: k + 1,
      tier: config.pvpBotTier || "normal",
      rng: Math.random,
    });
    const commandKey = `bot-${row.match_id}-${round}-${crypto.randomBytes(8).toString("hex")}`;
    const result = lockBotAction(db, {
      matchId: row.match_id,
      userId: row.bot_user_id,
      round,
      action,
      commandKey,
      now,
    });
    schedules.delete(row.match_id);
    done.push({ matchId: row.match_id, ...result });
  }
  return done;
}
