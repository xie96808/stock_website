/**
 * 对战装扮 catalogue (pure data, no imports). Art is drawn on the client from the same ids
 * (js/sticker-art-pure.js, js/entrance-fx.js) — a new item = one entry here + one drawing there.
 *   PACKS      sticker packs: buying a pack unlocks every sticker in it for in-match use.
 *   ENTRANCES  entrance effects: one can be equipped; it plays on the player's seat when a match starts, for both seats.
 */
export const PACKS = Object.freeze([
  {
    id: "pack_market",
    name: "行情表情",
    desc: "涨停跌停全在这，拍给对手看",
    price: 200,
    stickers: Object.freeze(["limit_up", "limit_down", "full_pos", "empty_pos", "bottom_fish", "chase_high", "take_profit", "stop_loss"]),
  },
  {
    id: "pack_leek",
    name: "韭菜日常",
    desc: "被割、套牢、真香，韭菜的喜怒哀乐",
    price: 300,
    stickers: Object.freeze(["got_cut", "trapped", "break_even", "lie_flat", "so_good", "crash", "hold_on", "all_in"]),
  },
]);

export const ENTRANCES = Object.freeze([
  { id: "ink_splash", name: "泼墨", desc: "一团浓墨在座位后晕开", price: 400 },
  { id: "seal_stamp", name: "盖印", desc: "一枚朱红大印当头砸下", price: 400 },
  { id: "leek_rain", name: "韭菜雨", desc: "韭菜叶漫天落下，场面不太对", price: 600 },
  { id: "gold_burst", name: "金光", desc: "万道金光，出场自带气势", price: 800 },
]);

const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));
const ENTRANCE_BY_ID = new Map(ENTRANCES.map((e) => [e.id, e]));
const STICKER_PACK = new Map(PACKS.flatMap((p) => p.stickers.map((s) => [s, p.id])));

export const packDef = (id) => PACK_BY_ID.get(id) || null;
export const entranceDef = (id) => ENTRANCE_BY_ID.get(id) || null;
/** The pack a sticker belongs to, or null for an unknown sticker. */
export const stickerPack = (stickerId) => STICKER_PACK.get(stickerId) || null;
export const isEntranceId = (id) => typeof id === "string" && ENTRANCE_BY_ID.has(id);
export const isStickerId = (id) => typeof id === "string" && STICKER_PACK.has(id);
/** Any purchasable item (pack or entrance): { kind, def } | null. */
export function itemDef(id) {
  if (PACK_BY_ID.has(id)) return { kind: "pack", def: PACK_BY_ID.get(id) };
  if (ENTRANCE_BY_ID.has(id)) return { kind: "entrance", def: ENTRANCE_BY_ID.get(id) };
  return null;
}
