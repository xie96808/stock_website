/**
 * 头像框商店 — pure view helpers (no DOM) so node can test them.
 * `frame` is one entry of GET /api/v1/me/frames → frames[].
 */

/**
 * What the card's button does and says. kind: buy | confirm | poor | equip | unequip | locked.
 * `armed` = the player already tapped 购买 once and we are waiting for the confirming tap.
 */
export function actionFor(frame, armed = false) {
  if (!frame) return { kind: "none", label: "", disabled: true };
  if (frame.owned) {
    return frame.equipped
      ? { kind: "unequip", label: "卸下", disabled: false }
      : { kind: "equip", label: "装备", disabled: false };
  }
  if (!frame.buyable) return { kind: "locked", label: "成就解锁", disabled: true };
  if (!frame.affordable) return { kind: "poor", label: "韭币不足", disabled: true };
  return armed
    ? { kind: "confirm", label: `确认 -${frame.price}`, disabled: false }
    : { kind: "buy", label: `购买 ${frame.price}`, disabled: false };
}

/** Same as actionFor but the "poor" label says how many coins are missing. */
export function actionForBalance(frame, balance, armed = false) {
  const a = actionFor(frame, armed);
  if (a.kind === "poor") {
    const short = Math.max(0, (Number(frame.price) || 0) - (Number(balance) || 0));
    return { ...a, label: short > 0 ? `还差 ${short}` : a.label };
  }
  return a;
}

/** Small caption under the name: price, how to get it, or status. */
export function captionFor(frame) {
  if (!frame) return "";
  if (frame.equipped) return "使用中";
  if (frame.owned) return "已拥有";
  if (frame.kind === "achievement") return frame.hint || "成就解锁";
  return frame.hint ? frame.hint : frame.desc || "";
}

export function sortFrames(frames) {
  const list = Array.isArray(frames) ? frames : [];
  // shop frames first (cheapest first), achievement-only after; owned ones keep their slot.
  return [...list].sort((a, b) => {
    const ka = a.kind === "shop" ? 0 : 1;
    const kb = b.kind === "shop" ? 0 : 1;
    return ka - kb || (a.price || 0) - (b.price || 0);
  });
}

/** Visual tier of a card: 'prime' (≥ 2000), 'fine' (≥ 1000), otherwise 'plain'. Achievement-only frames are 'plain'. */
export function tierOf(frame) {
  const price = frame && frame.kind === "shop" ? Number(frame.price) || 0 : 0;
  if (price >= 2000) return "prime";
  if (price >= 1000) return "fine";
  return "plain";
}

export function buyToast(name, price) {
  return `已购买「${name}」-${price} 韭币，点「装备」戴上`;
}

export function errorToast(err) {
  const code = err && err.code;
  if (code === "INSUFFICIENT_FUNDS") return "韭币不足";
  if (code === "ALREADY_OWNED") return "你已经拥有这个头像框";
  if (code === "NOT_FOR_SALE") return "这个头像框只能通过成就解锁";
  if (code === "NOT_OWNED") return "你还没有这个头像框";
  return "操作失败，请稍后再试";
}
