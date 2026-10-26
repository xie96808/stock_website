/**
 * 头像框 catalogue (pure data, no imports — safe to load from anywhere).
 * Art is drawn on the client (js/avatar-frame.js) from the same ids; a new frame = one entry here + one drawing there.
 *   kind 'shop'        → bought with 韭币 at `price`
 *   kind 'achievement' → no price; unlocked by an achievement whose `unlock` is `frame:<id>`
 * Some achievement-unlocked frames are also sold (owning it either way is enough).
 */
export const FRAMES = Object.freeze([
  { id: "ink_ring", name: "墨圈", desc: "两笔浓墨一圈，朴素但有范儿", kind: "shop", price: 300, hint: "也可通过成就「七日成瘾」免费获得" },
  { id: "bamboo", name: "青竹", desc: "竹节为环，叶影轻摇", kind: "shop", price: 500 },
  { id: "cinnabar", name: "朱砂", desc: "朱砂印泥，一圈红运", kind: "shop", price: 800 },
  { id: "gold", name: "金边", desc: "双层鎏金，闪着点点星光", kind: "shop", price: 1500 },
  { id: "laurel", name: "月桂", desc: "单局收益 +50% 才配戴的桂冠", kind: "achievement", hint: "成就「股神附体」：单局收益率 +50%" },
  { id: "crown", name: "韭王冠", desc: "头顶王冠，韭菜之王", kind: "achievement", hint: "成就「韭菜之王」：完成 200 局" },
]);

const BY_ID = new Map(FRAMES.map((f) => [f.id, f]));

export function frameDef(id) {
  return BY_ID.get(id) || null;
}

export function isFrameId(id) {
  return typeof id === "string" && BY_ID.has(id);
}
