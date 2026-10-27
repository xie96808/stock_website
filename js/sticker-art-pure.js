/**
 * 对战表情包 art (no DOM, node-testable): every sticker is a code-drawn "seal" — a rubber-stamp badge with an icon and
 * two big characters, in the same woodblock look as the avatar frames. Ids / packs / prices live on the server
 * (server/src/lib/cosmeticDefs.js); this file only knows how to draw an id, so anyone can SEE every sticker even if they
 * do not own its pack.
 *
 * No gradients / filters / ids in the markup (see avatar-frame-pure.js for why).
 */
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
});

export const STICKER_IDS = Object.freeze(Object.keys(STICKER_ART));

export function isStickerId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(STICKER_ART, id);
}

export function stickerLabel(id) {
  return isStickerId(id) ? STICKER_ART[id].text : "";
}

/** The sticker `<svg>` for an id ("" for anything unknown). viewBox 0 0 100 100; the stamp is slightly tilted. */
export function stickerSvg(id, { className = "stk" } = {}) {
  if (!isStickerId(id)) return "";
  const a = STICKER_ART[id];
  const [fill, fg] = TONES[a.tone];
  const body =
    a.shape === "round"
      ? `<circle cx="50" cy="50" r="45" fill="${fill}" stroke="${INK}" stroke-width="3.2"/>` +
        `<circle cx="50" cy="50" r="39" fill="none" stroke="${fg}" stroke-width="1.6" opacity=".85" stroke-dasharray="3.2 3"/>`
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
