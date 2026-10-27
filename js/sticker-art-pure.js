/**
 * 对战表情包 art (no DOM, node-testable): every sticker is a code-drawn "seal" — a rubber-stamp badge with an icon and
 * two big characters, in the same woodblock look as the avatar frames. Ids / packs / prices live on the server
 * (server/src/lib/cosmeticDefs.js); this file only knows how to draw an id, so anyone can SEE every sticker even if they
 * do not own its pack.
 *
 * Kinds: `seal` (the flat stamps below), and — in js/sticker-art-premium.js — `face`, `fine` and `grand` (the last one
 * animates). The premium kinds are deliberately the expensive packs.
 *
 * No gradients / filters / ids in the markup (see avatar-frame-pure.js for why).
 */
import { faceSvgBody, medalSvgBody } from "./sticker-art-premium.js";

const INK = "#2b2622";
const CREAM = "#fff4e0";

/** tone → [body fill, inner line / icon / text colour] */
const TONES = Object.freeze({
  red: ["#d63b25", CREAM],
  green: ["#3f9a45", CREAM],
  gold: ["#f0bd2d", "#3a2a05"],
  ink: ["#3a342e", CREAM],
  blue: ["#3b72b8", CREAM],
});

/** Icons are drawn in a 24×24 box, filled / stroked with the sticker's foreground colour. */
const ICONS = Object.freeze({
  up: `<path d="M12 3L21 13H15V21H9V13H3Z" fill="currentColor"/>`,
  down: `<path d="M12 21L3 11H9V3H15V11H21Z" fill="currentColor"/>`,
  flame: `<path d="M12 2C13 6.5 18.5 8.5 18.5 14.5A6.5 6.5 0 0 1 5.5 14.5C5.5 11.5 7.5 9.8 8.2 7C9.8 8.2 11 7 12 2Z" fill="currentColor"/>`,
  flag: `<path d="M6 21V3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M6.5 4H19L15.5 8.5L19 13H6.5Z" fill="currentColor"/>`,
  candle: `<path d="M12 2V22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="7.5" y="7" width="9" height="10" rx="1.4" fill="currentColor"/>`,
  bolt: `<path d="M13.5 2L5 14H11L10 22L19 9.5H13Z" fill="currentColor"/>`,
  coin: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>`,
  scissors: `<circle cx="6.6" cy="17.4" r="3.1" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17.4" cy="17.4" r="3.1" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.6 15L18 3.5M15.4 15L6 3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  leek: `<path d="M12 22C8.6 16 8.6 8 12 2C15.4 8 15.4 16 12 22Z" fill="currentColor"/><path d="M7.6 21C4.4 16.5 4.4 11 6.4 7C8.6 11 9.4 16 7.6 21Z" fill="currentColor" opacity=".8"/><path d="M16.4 21C19.6 16.5 19.6 11 17.6 7C15.4 11 14.6 16 16.4 21Z" fill="currentColor" opacity=".8"/>`,
  lock: `<rect x="5.5" y="11" width="13" height="10" rx="2" fill="currentColor"/><path d="M8.2 11V8A3.8 3.8 0 0 1 15.8 8V11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  zzz: `<path d="M4.5 5.5H11L4.5 12.5H11M13.5 11.5H19.5L13.5 18.5H19.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  wave: `<path d="M2.5 8.500C5.500 4.500 8.500 4.500 11.500 8.500S17.500 12.500 21.500 8.500M2.500 15.500C5.500 11.500 8.500 11.500 11.500 15.500S17.500 19.500 21.500 15.500" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  rocket: `<path fill-rule="evenodd" d="M12 1.500C14.600 4.500 15.300 9 15 15H9C8.700 9 9.400 4.500 12 1.500ZM12 7.200a1.900 1.900 0 1 0 .01 0Z" fill="currentColor"/><path d="M9 10.500L4.300 16.500L9 15ZM15 10.500L19.700 16.500L15 15Z" fill="currentColor"/><path d="M10.200 17L12 22.500L13.800 17Z" fill="currentColor"/>`,
  sentry: `<circle cx="12" cy="5.500" r="3" fill="currentColor"/><path d="M12 9.500V17M6.500 12.500H17.500M12 17L8 22M12 17L16 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  plus: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M12 7.500V16.500M7.500 12H16.500" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>`,
  key: `<circle cx="7.500" cy="12" r="4.600" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 12H22M18 12V16.500M21.500 12V15" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>`,
  megaphone: `<path d="M3 10V14H7L15 19V5L7 10Z" fill="currentColor"/><path d="M18 9.500Q20.500 12 18 14.500M20.500 7Q24 12 20.500 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  cloudrain: `<path d="M6.500 15C3.500 15 2.500 11.500 5 10C5.500 6.500 10.500 5.500 12.500 8.500C15 6.500 19 8.500 18.500 12C21.500 12 21.500 15 18.500 15Z" fill="currentColor"/><path d="M8 17.500L6.500 21M13 17.500L11.500 21M18 17.500L16.500 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  heart: `<path d="M12 21C4 14.5 2.8 9.4 6.8 6.2C9.4 4.6 11.5 6 12 8.2C12.5 6 14.6 4.6 17.2 6.2C21.2 9.4 20 14.5 12 21Z" fill="currentColor"/>`,
});

/** id → drawing. `round` seals go with the 韭菜日常 pack, squares with 行情表情 — the pack is recognisable at a glance. */
export const STICKER_ART = Object.freeze({
  limit_up: { text: "涨停", tone: "red", icon: "up", shape: "square" },
  limit_down: { text: "跌停", tone: "green", icon: "down", shape: "square" },
  full_pos: { text: "满仓", tone: "red", icon: "flame", shape: "square" },
  empty_pos: { text: "空仓", tone: "ink", icon: "flag", shape: "square" },
  bottom_fish: { text: "抄底", tone: "blue", icon: "candle", shape: "square" },
  chase_high: { text: "追高", tone: "gold", icon: "bolt", shape: "square" },
  take_profit: { text: "止盈", tone: "gold", icon: "coin", shape: "square" },
  stop_loss: { text: "止损", tone: "ink", icon: "scissors", shape: "square" },
  got_cut: { text: "被割", tone: "green", icon: "leek", shape: "round" },
  trapped: { text: "套牢", tone: "ink", icon: "lock", shape: "round" },
  break_even: { text: "回本", tone: "blue", icon: "coin", shape: "round" },
  lie_flat: { text: "躺平", tone: "blue", icon: "zzz", shape: "round" },
  so_good: { text: "真香", tone: "red", icon: "heart", shape: "round" },
  crash: { text: "破防", tone: "red", icon: "bolt", shape: "round" },
  hold_on: { text: "稳住", tone: "green", icon: "flag", shape: "round" },
  all_in: { text: "梭哈", tone: "gold", icon: "flame", shape: "round" },
  // 老股民黑话 — octagon stamps
  wash_out: { text: "洗盘", tone: "blue", icon: "wave", shape: "oct" },
  pull_up: { text: "拉升", tone: "red", icon: "rocket", shape: "oct" },
  bag_hold: { text: "站岗", tone: "ink", icon: "sentry", shape: "oct" },
  add_pos: { text: "补仓", tone: "gold", icon: "plus", shape: "oct" },
  cut_meat: { text: "割肉", tone: "green", icon: "scissors", shape: "oct" },
  unlocked: { text: "解套", tone: "blue", icon: "key", shape: "oct" },
  good_news: { text: "利好", tone: "red", icon: "megaphone", shape: "oct" },
  bad_news: { text: "利空", tone: "green", icon: "cloudrain", shape: "oct" },
  // 情绪崩溃 — faces
  laugh_cry: { text: "笑哭", kind: "face", art: "laugh_cry" },
  cracked: { text: "裂开", kind: "face", art: "cracked" },
  dizzy: { text: "懵圈", kind: "face", art: "dizzy" },
  smirk: { text: "暗爽", kind: "face", art: "smirk" },
  cool: { text: "淡定", kind: "face", art: "cool" },
  hot: { text: "上头", kind: "face", art: "hot" },
  melon: { text: "吃瓜", kind: "face", art: "melon" },
  speechless: { text: "无语", kind: "face", art: "speechless" },
  // 牛熊对决 — gold-rimmed medallions
  bull: { text: "牛市", kind: "fine", art: "bull", tone: "red" },
  bear: { text: "熊市", kind: "fine", art: "bear", tone: "green" },
  big_up: { text: "大阳", kind: "fine", art: "sun_candle", tone: "navy" },
  big_down: { text: "大阴", kind: "fine", art: "cloud_candle", tone: "ink" },
  doubled: { text: "翻倍", kind: "fine", art: "double", tone: "plum" },
  halved: { text: "腰斩", kind: "fine", art: "chop", tone: "ink" },
  v_turn: { text: "V反", kind: "fine", art: "v_turn", tone: "navy" },
  new_high: { text: "新高", kind: "fine", art: "new_high", tone: "red" },
  // 暴富时刻 — animated
  fortune: { text: "发财", kind: "grand", art: "ingot", tone: "red" },
  liftoff: { text: "起飞", kind: "grand", art: "rocket", tone: "navy" },
  diamond: { text: "钻石", kind: "grand", art: "diamond", tone: "plum" },
  fireworks: { text: "烟花", kind: "grand", art: "firework", tone: "ink" },
  red_packet: { text: "红包", kind: "grand", art: "packet", tone: "red" },
  champion: { text: "夺冠", kind: "grand", art: "trophy", tone: "navy" },
  god_coin: { text: "财神", kind: "grand", art: "coin", tone: "plum" },
  crit_hit: { text: "暴击", kind: "grand", art: "crit", tone: "ink" },
});

export const STICKER_IDS = Object.freeze(Object.keys(STICKER_ART));

export function isStickerId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(STICKER_ART, id);
}

export function stickerLabel(id) {
  return isStickerId(id) ? STICKER_ART[id].text : "";
}

/** Regular octagon path centred (50,50) radius 46, rotated so a flat edge is on top. */
const OCT = (() => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    pts.push(`${Math.round((50 + 46 * Math.cos(a)) * 10) / 10} ${Math.round((50 + 46 * Math.sin(a)) * 10) / 10}`);
  }
  return `M${pts.join("L")}Z`;
})();
const OCT_INNER = OCT.replace(/[\d.]+ [\d.]+/g, (m) => {
  const [x, y] = m.split(" ").map(Number);
  return `${Math.round((50 + (x - 50) * 0.84) * 10) / 10} ${Math.round((50 + (y - 50) * 0.84) * 10) / 10}`;
});

/** The sticker `<svg>` for an id ("" for anything unknown). viewBox 0 0 100 100; seals are slightly tilted. */
export function stickerSvg(id, { className = "stk" } = {}) {
  if (!isStickerId(id)) return "";
  const a = STICKER_ART[id];
  const kind = a.kind || "seal";
  if (kind !== "seal") {
    const body = kind === "face" ? faceSvgBody(a) : medalSvgBody(a, kind === "grand");
    return `<svg class="${className} stk--${kind}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  const [fill, fg] = TONES[a.tone];
  const body =
    a.shape === "round"
      ? `<circle cx="50" cy="50" r="45" fill="${fill}" stroke="${INK}" stroke-width="3.2"/>` +
        `<circle cx="50" cy="50" r="39" fill="none" stroke="${fg}" stroke-width="1.6" opacity=".85" stroke-dasharray="3.2 3"/>`
      : a.shape === "oct"
        ? `<path d="${OCT}" fill="${fill}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>` +
          `<path d="${OCT_INNER}" fill="none" stroke="${fg}" stroke-width="1.6" opacity=".85" stroke-linejoin="round"/>`
        : `<rect x="7" y="7" width="86" height="86" rx="16" fill="${fill}" stroke="${INK}" stroke-width="3.2"/>` +
          `<rect x="14" y="14" width="72" height="72" rx="10" fill="none" stroke="${fg}" stroke-width="1.6" opacity=".85"/>`;
  return (
    `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g transform="rotate(-4 50 50)">` +
    body +
    `<g style="color:${fg}" transform="translate(33 17) scale(1.42)">${ICONS[a.icon]}</g>` +
    `<text x="50" y="79" text-anchor="middle" font-size="25" font-weight="800" letter-spacing="1.5" fill="${fg}" font-family="KaiTi, STKaiti, 'Kaiti SC', serif">${a.text}</text>` +
    `</g></svg>`
  );
}
