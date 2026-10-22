import { publicNickname } from "./names.js";

export const TAUNT_LINES = Object.freeze([
  "买买买",
  "割了割了",
  "给我加仓猛干！",
  "技术回调，慌个锤子",
]);

const LINE_SET = new Set(TAUNT_LINES);
export const MAX_TAUNT_CODEPOINTS = 32;
const MIN_GAP_MS = 2500;
const MATCH_CAP = 20;
const KEEP_MS = 60_000;

const events = [];
let seq = 1;

export function resetTaunts() {
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
 * Ephemeral in-match taunt. Preset lines and short plain text are accepted.
 * Caller should push the event to both seats over WS.
 */
export function sendTaunt(db, { matchId, fromUserId, text, now = Date.now() }) {
  if (typeof text !== "string") return deny("BAD_PAYLOAD", "消息格式无效", 400);
  const cleanText = text.trim();
  const codepoints = [...cleanText].length;
  if (!cleanText || codepoints > MAX_TAUNT_CODEPOINTS || /[\u0000-\u001f\u007f-\u009f]/u.test(cleanText)) {
    return deny("BAD_PAYLOAD", `消息须为 1-${MAX_TAUNT_CODEPOINTS} 字，且不能含控制字符`, 400);
  }
  const isCustom = !LINE_SET.has(cleanText);
  const players = db.prepare(
    `SELECT user_id FROM pvp_match_players WHERE match_id = ?`
  ).all(matchId);
  const mine = players.find((player) => player.user_id === fromUserId);
  if (!mine || players.length !== 2) return deny("NOT_FOUND", "对局不存在", 404);
  const match = db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match || match.status !== "playing") {
    return deny("NOT_PLAYING", "对局不在进行中", 409);
  }
  prune(now);
  const sent = events.filter((event) => event.matchId === matchId && event.fromUserId === fromUserId);
  const last = sent[sent.length - 1];
  if (last && now - last.at < MIN_GAP_MS) return deny("RATE_LIMITED", "消息发太快了", 429);
  if (sent.length >= MATCH_CAP) return deny("RATE_LIMITED", "这局消息已经够多了", 429);
  const user = db.prepare(`SELECT nickname, status FROM users WHERE id = ?`).get(fromUserId);
  const event = {
    id: seq,
    matchId,
    fromUserId,
    text: cleanText,
    isCustom,
    nickname: publicNickname(user),
    at: now,
  };
  seq += 1;
  events.push(event);
  return {
    ok: true,
    event: {
      id: event.id,
      matchId: event.matchId,
      fromUserId: event.fromUserId,
      text: event.text,
      isCustom: event.isCustom,
      nickname: event.nickname,
      at: event.at,
    },
    userIds: players.map((player) => player.user_id),
  };
}
