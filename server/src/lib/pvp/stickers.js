import { isStickerId, stickerPack } from "../cosmeticDefs.js";
import { ownedItemIds, pvpCosmeticsEnabled } from "../cosmetics.js";
import { publicNickname } from "./names.js";

const MIN_GAP_MS = 2500;
const MATCH_CAP = 20;
const KEEP_MS = 60_000;

const events = [];
let seq = 1;

export function resetStickers() {
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
 * In-match sticker (from a bought pack). Ephemeral like taunts; the caller pushes the event to both seats over WS.
 * Only the sender needs to own the pack — the opponent just sees it.
 */
export function sendSticker(db, { matchId, fromUserId, stickerId, now = Date.now() }) {
  if (!pvpCosmeticsEnabled()) return deny("FEATURE_DISABLED", "对战装扮暂未开放", 404);
  if (!isStickerId(stickerId)) return deny("BAD_PAYLOAD", "不认识这个表情", 400);
  const players = db.prepare(`SELECT user_id FROM pvp_match_players WHERE match_id = ?`).all(matchId);
  if (!players.find((p) => p.user_id === fromUserId) || players.length !== 2) return deny("NOT_FOUND", "对局不存在", 404);
  if (!ownedItemIds(fromUserId, db).has(stickerPack(stickerId))) return deny("NOT_OWNED", "你还没有这套表情", 403);
  const match = db.prepare(`SELECT status FROM pvp_matches WHERE id = ?`).get(matchId);
  if (!match || match.status !== "playing") return deny("NOT_PLAYING", "对局不在进行中", 409);
  prune(now);
  const sent = events.filter((e) => e.matchId === matchId && e.fromUserId === fromUserId);
  const last = sent[sent.length - 1];
  if (last && now - last.at < MIN_GAP_MS) return deny("RATE_LIMITED", "表情发太快了", 429);
  if (sent.length >= MATCH_CAP) return deny("RATE_LIMITED", "这局表情已经够多了", 429);
  const user = db.prepare(`SELECT nickname, status FROM users WHERE id = ?`).get(fromUserId);
  const event = { id: seq, matchId, fromUserId, stickerId, nickname: publicNickname(user), at: now };
  seq += 1;
  events.push(event);
  return { ok: true, event: { id: event.id, matchId, fromUserId, stickerId, nickname: event.nickname, at: now } };
}
