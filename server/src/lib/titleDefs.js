/**
 * 称号 catalogue (pure data, no imports). The client draws a title from its `tier` (js/title-pure.js); a new title is one
 * entry here. Prices climb with the tier, and so does the look:
 *   plain   ink on paper, dashed border
 *   red     a red seal
 *   gold    gold plate
 *   shine   gold plate with a light sweep
 *   legend  dark plate, glowing gold lettering and a light sweep
 */
export const TITLES = Object.freeze([
  { id: "rookie", name: "韭菜新兵", desc: "刚入市，还没被割够", price: 200, tier: "plain" },
  { id: "bottom_fisher", name: "抄底达人", desc: "每次都抄在半山腰", price: 300, tier: "plain" },
  { id: "bag_holder", name: "站岗专业户", desc: "山顶的风景，我最熟", price: 500, tier: "red" },
  { id: "cut_veteran", name: "割肉老手", desc: "手起刀落，从不犹豫", price: 500, tier: "red" },
  { id: "limit_squad", name: "涨停敢死队", desc: "不是涨停，就是在涨停的路上", price: 800, tier: "red" },
  { id: "flat_artist", name: "空仓艺术家", desc: "最好的操作，是什么都不做", price: 800, tier: "red" },
  { id: "dragon_hunter", name: "龙头猎手", desc: "专抓领涨的那一只", price: 1200, tier: "gold" },
  { id: "leek_emperor", name: "一代韭皇", desc: "韭菜界的最高荣誉，割不动", price: 2000, tier: "shine" },
  { id: "market_god", name: "股市活财神", desc: "你买什么，什么就涨", price: 3000, tier: "shine" },
  { id: "a_share_legend", name: "A股传说", desc: "传说中的那一位，就是你", price: 5000, tier: "legend" },
]);

const BY_ID = new Map(TITLES.map((t) => [t.id, t]));

export function titleDef(id) {
  return BY_ID.get(id) || null;
}

export function isTitleId(id) {
  return typeof id === "string" && BY_ID.has(id);
}
