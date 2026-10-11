import { publicNickname } from "./names.js";

export const REACTION_KINDS = Object.freeze(["flower", "tomato", "pipe"]);
const KIND_SET = new Set(REACTION_KINDS);
const MIN_GAP_MS = 1200;
const MATCH_CAP = 12;
const KEEP_MS = 45_000;

const events = [];
let seq = 1;

export function resetReactions() {
  events.length = 0;
  seq = 1;
}

function prune(now) {
  const floor = now - KEEP_MS;
  let drop = 0;
  while (drop < events.length && events[drop].at < floor) drop += 1;
  if (drop) events.splice(0, drop);
}

function deny(code, message, status) {
  return { ok: false, code, message, status };
}

/**
 * A short-lived gift from one settled seat to the other.
 * Stored in memory: the animation only needs to last a few seconds.
 */
export function sendReaction(db, { matchId, fromUserId, kind, now = Date.now() }) {
  if (!KIND_SET.has(kind)) return deny("BAD_PAYLOAD", "不认识这个反馈", 400);
  const players = db.prepare(
    `SELECT user_id FROM pvp_match_players WHERE match_id = ?`
  ).all(matchId);
  const mine = players.find((player) => player.user_id === fromUserId);
  const opponent = players.find((player) => player.user_id !== fromUserId);
  if (!mine || !opponent || players.length !== 2) return deny("NOT_FOUND", "对局不存在", 404);
  const match = db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match || (match.status !== "settled" && match.status !== "aborted")) {
    return deny("NOT_FINISHED", "这局还没结束", 409);
  }
  prune(now);
  const sent = events.filter((event) => event.matchId === matchId && event.fromUserId === fromUserId);
  const last = sent[sent.length - 1];
  if (last && now - last.at < MIN_GAP_MS) return deny("RATE_LIMITED", "送得太快了", 429);
  if (sent.length >= MATCH_CAP) return deny("RATE_LIMITED", "这局的反馈已经够多了", 429);
  const user = db.prepare(`SELECT nickname, status FROM users WHERE id = ?`).get(fromUserId);
  const event = {
    id: seq,
    matchId,
    fromUserId,
    toUserId: opponent.user_id,
    kind,
    nickname: publicNickname(user),
    at: now,
  };
  seq += 1;
  events.push(event);
  return { ok: true, event: { id: event.id, kind: event.kind, at: event.at } };
}

export function listIncoming(userId, after = 0, now = Date.now()) {
  prune(now);
  const cursor = Number(after) || 0;
  return {
    now,
    events: events
      .filter((event) => event.toUserId === userId && event.id > cursor)
      .map((event) => ({
        id: event.id,
        matchId: event.matchId,
        kind: event.kind,
        nickname: event.nickname,
        at: event.at,
      })),
  };
}
