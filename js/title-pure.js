/**
 * 称号 view helpers (no DOM except the one small `setTitleChip`, so node can test the rest).
 * Ids / prices live on the server (server/src/lib/titleDefs.js); this file knows how to NAME and STYLE an id, so every
 * client can show a title it does not own. Looks (css/leek-shop.css): plain · red · gold · shine · legend.
 */
export const TITLE_ART = Object.freeze({
  rookie: { name: "韭菜新兵", tier: "plain" },
  bottom_fisher: { name: "抄底达人", tier: "plain" },
  bag_holder: { name: "站岗专业户", tier: "red" },
  cut_veteran: { name: "割肉老手", tier: "red" },
  limit_squad: { name: "涨停敢死队", tier: "red" },
  flat_artist: { name: "空仓艺术家", tier: "red" },
  dragon_hunter: { name: "龙头猎手", tier: "gold" },
  leek_emperor: { name: "一代韭皇", tier: "shine" },
  market_god: { name: "股市活财神", tier: "shine" },
  a_share_legend: { name: "A股传说", tier: "legend" },
});

export function isTitleId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(TITLE_ART, id);
}

export function titleName(id) {
  return isTitleId(id) ? TITLE_ART[id].name : "";
}

/** The chip as markup ("" for anything unknown, so callers can append it unconditionally). */
export function titleChipHtml(id, { size = "" } = {}) {
  if (!isTitleId(id)) return "";
  const a = TITLE_ART[id];
  return `<span class="ttl ttl--${a.tier}${size ? ` ttl--${size}` : ""}" data-ttl="${id}">${a.name}</span>`;
}

/** Put / swap / remove the chip right after `el` (idempotent). */
export function setTitleChip(el, id) {
  if (!el || !el.parentElement) return;
  const next = el.nextElementSibling;
  if (next && next.dataset && next.dataset.ttl !== undefined) next.remove();
  if (!isTitleId(id)) return;
  el.insertAdjacentHTML("afterend", titleChipHtml(id));
}
