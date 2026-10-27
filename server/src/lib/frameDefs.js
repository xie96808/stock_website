/**
 * 头像框 catalogue (pure data, no imports — safe to load from anywhere).
 * Art is drawn on the client (js/avatar-frame.js) from the same ids; a new frame = one entry here + one drawing there.
 *   kind 'shop'        → bought with 韭币 at `price`
 *   kind 'achievement' → no price; unlocked by an achievement whose `unlock` is `frame:<id>`
 * Some achievement-unlocked frames are also sold (owning it either way is enough).
 */
export const FRAMES = Object.freeze([
  { id: "ink_ring", name: "墨圈", desc: "一笔圆相，墨色未干，缺口盖一枚韭印", kind: "shop", price: 300, hint: "也可通过成就「七日成瘾」免费获得" },
  { id: "bamboo", name: "青竹", desc: "弯竹成环，节节向上，竹叶随风轻摆", kind: "shop", price: 500 },
  { id: "cinnabar", name: "朱砂", desc: "祥云托着朱印，一圈红火", kind: "shop", price: 800 },
  { id: "gold", name: "金边", desc: "鎏金镶边，一道流光绕圈而过", kind: "shop", price: 1500 },
  { id: "laurel", name: "月桂", desc: "红丝带系起的桂冠，单局收益 +50% 才配戴", kind: "achievement", hint: "成就「股神附体」：单局收益率 +50%" },
  { id: "crown", name: "韭王冠", desc: "韭菜叶编成的王冠，嵌一颗红宝石", kind: "achievement", hint: "成就「韭菜之王」：完成 200 局" },
]);

const BY_ID = new Map(FRAMES.map((f) => [f.id, f]));

export function frameDef(id) {
  return BY_ID.get(id) || null;
}

export function isFrameId(id) {
  return typeof id === "string" && BY_ID.has(id);
}
