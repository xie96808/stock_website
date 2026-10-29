/**
 * 对战装扮 — pure view helpers (no DOM, node-testable). `state` is GET /api/v1/me/cosmetics.
 * Buy / equip button logic is the same shape as the frame shop's, so it is reused from there.
 */
import { actionForBalance as frameAction } from "./frame-shop-pure.js";
export { poorToast } from "./frame-shop-pure.js";

/**
 * Button for a pack or an entrance effect. A sticker pack is owned forever and has nothing to equip (the tray
 * offers every sticker of every owned pack), so an owned pack shows a quiet 「已拥有」; only entrance effects
 * are equipped / unequipped. (An owned pack used to get the frame shop's 「装备」, which asked the server to
 * equip a pack id as an entrance effect and failed with 「操作失败」.)
 */
export function actionForBalance(item, balance, armed = false) {
  if (item && item.kind === "pack" && item.owned) return { kind: "owned", label: "已拥有", disabled: true };
  return frameAction(item, balance, armed);
}

/** Sticker ids the player may send: every sticker of every owned pack, in pack order. */
export function ownedStickerIds(state) {
  const packs = Array.isArray(state?.packs) ? state.packs : [];
  return packs.filter((p) => p.owned).flatMap((p) => p.stickers || []);
}

/** The packs the player owns, cheapest first (the order the tray shows its tabs in). */
export function ownedPacks(state) {
  const packs = Array.isArray(state?.packs) ? state.packs : [];
  return packs.filter((p) => p.owned).sort((a, b) => (a.price || 0) - (b.price || 0));
}

/** The packs the player does not own yet (what the tray advertises). */
export function lockedPacks(state) {
  const packs = Array.isArray(state?.packs) ? state.packs : [];
  return packs.filter((p) => !p.owned);
}

/** Text under an entrance effect's name. */
export function entranceCaption(item) {
  if (!item) return "";
  if (item.equipped) return "使用中";
  if (item.owned) return "已拥有";
  return item.desc || "";
}

/** Text under a pack's name. */
export function packCaption(item) {
  if (!item) return "";
  if (item.owned) return `已拥有 · ${(item.stickers || []).length} 个表情`;
  return item.desc || "";
}

/** Entrance first-play guard: play once per match, and only when the match is just starting (no round resolved yet). */
export function shouldPlayEntrance({ status, resolvedRounds, playedFor, matchId }) {
  return status === "playing" && !!matchId && playedFor !== matchId && Number(resolvedRounds || 0) === 0;
}

/** Toast after a purchase: packs work straight away, effects still need equipping. */
export function cosBuyToast(item) {
  if (!item) return "";
  const tail = item.kind === "entrance" ? "，点「装备」使用" : "，进对局就能用";
  return `已购买「${item.name}」-${item.price} 韭币${tail}`;
}

export function errorToast(err) {
  const code = err && err.code;
  if (code === "INSUFFICIENT_FUNDS") return "韭币不足";
  if (code === "ALREADY_OWNED") return "你已经拥有它了";
  if (code === "NOT_OWNED") return "你还没有这个商品";
  if (code === "FEATURE_DISABLED") return "对战装扮暂未开放";
  return "操作失败，请稍后再试";
}
