/**
 * 头像框 art + view helpers (no DOM, so node can test them). The art is code-drawn SVG — no image assets.
 * Ids and prices live on the server (server/src/lib/frameDefs.js); this file only knows how to draw an id.
 *
 * Geometry: every drawing uses viewBox "-10 -10 120 120" — the avatar is the circle of radius 50 at (50,50), so
 * ring art sits at radius ~52–58 and (via .avf-art being 120% of the avatar) outside the avatar's own box.
 */
export const FRAME_IDS = Object.freeze(["ink_ring", "bamboo", "cinnabar", "gold", "laurel", "crown"]);

export const FRAME_NAMES = Object.freeze({
  ink_ring: "墨圈",
  bamboo: "青竹",
  cinnabar: "朱砂",
  gold: "金边",
  laurel: "月桂",
  crown: "韭王冠",
});

export function isFrameId(id) {
  return typeof id === "string" && FRAME_IDS.includes(id);
}

const r1 = (n) => Math.round(n * 10) / 10;
const polar = (deg, radius, cx = 50, cy = 50) => {
  const a = (deg * Math.PI) / 180;
  return [r1(cx + radius * Math.cos(a)), r1(cy + radius * Math.sin(a))];
};

function inkRing() {
  return (
    `<path d="M50 -3C78 -4 104 20 103 50C102 80 78 104 50 103C20 102 -4 79 -3 50C-2 20 22 -2 50 -3Z" fill="none" stroke="#2a2622" stroke-width="3.6" stroke-linecap="round"/>` +
    `<path d="M50 1.5C75 0 98.5 24 98.5 50C97.5 76 76 99.5 50 98.5C24 97.5 1.5 76 1.5 50C1.5 24 25 1.5 50 1.5Z" fill="none" stroke="#2a2622" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`
  );
}

function bamboo() {
  let ticks = "";
  for (let i = 0; i < 10; i++) {
    const [x1, y1] = polar(i * 36 + 8, 49.5);
    const [x2, y2] = polar(i * 36 + 8, 55.5);
    ticks += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#2f5d33" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  const leaf = (deg, rot) => {
    const [x, y] = polar(deg, 55);
    return `<ellipse cx="${x}" cy="${y}" rx="9" ry="3.6" transform="rotate(${rot} ${x} ${y})" fill="#6aa84f" stroke="#2f5d33" stroke-width="1"/>`;
  };
  return (
    `<circle cx="50" cy="50" r="52.5" fill="none" stroke="#5b9a55" stroke-width="5.2"/>` +
    `<circle cx="50" cy="50" r="50.4" fill="none" stroke="#9fd18a" stroke-width="1" opacity=".8"/>` +
    ticks + leaf(-48, -48 + 90 - 40) + leaf(-30, -30 + 90 + 30)
  );
}

function cinnabar() {
  let dots = "";
  for (let i = 0; i < 12; i++) {
    const [x, y] = polar(i * 30 + 15, 59);
    dots += `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.2 : 1.5}" fill="#c0392b" opacity=".9"/>`;
  }
  return (
    `<circle cx="50" cy="50" r="52" fill="none" stroke="#c0392b" stroke-width="4.8"/>` +
    `<circle cx="50" cy="50" r="48.8" fill="none" stroke="#8e2417" stroke-width="1" opacity=".7"/>` +
    dots +
    `<g transform="rotate(8 88 88)"><rect x="79" y="79" width="18" height="18" rx="2.5" fill="#c0392b"/>` +
    `<text x="88" y="92.4" text-anchor="middle" font-size="12" font-weight="700" fill="#fff6e6" font-family="serif">韭</text></g>`
  );
}

function sparkle(x, y, s) {
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -5L1.4 -1.4L5 0L1.4 1.4L0 5L-1.4 1.4L-5 0L-1.4 -1.4Z" fill="#fff3b0" stroke="#d9a521" stroke-width=".7"/>`;
}

function gold() {
  const [ax, ay] = polar(-45, 56);
  const [bx, by] = polar(135, 56);
  const [cx, cy] = polar(45, 56);
  const [dx, dy] = polar(225, 56);
  return (
    `<circle cx="50" cy="50" r="57.5" fill="none" stroke="#b8860b" stroke-width="1.2"/>` +
    `<circle cx="50" cy="50" r="52.5" fill="none" stroke="#e0ac24" stroke-width="5.4"/>` +
    `<circle cx="50" cy="50" r="48.6" fill="none" stroke="#fbe289" stroke-width="1.6"/>` +
    sparkle(ax, ay, 1.35) + sparkle(bx, by, 1) + sparkle(cx, cy, 1.1) + sparkle(dx, dy, 1.2)
  );
}

function laurel() {
  let leaves = "";
  for (let i = 0; i < 8; i++) {
    const deg = 106 + i * 13.5; // left branch, from the bottom up the left side
    const [x, y] = polar(deg, 54);
    const rot = deg + 90;
    const mx = r1(100 - x);
    leaves += `<ellipse cx="${x}" cy="${y}" rx="7.8" ry="3.3" transform="rotate(${rot} ${x} ${y})" fill="#7aa23e" stroke="#40601f" stroke-width=".9"/>`;
    leaves += `<ellipse cx="${mx}" cy="${y}" rx="7.8" ry="3.3" transform="rotate(${-rot} ${mx} ${y})" fill="#7aa23e" stroke="#40601f" stroke-width=".9"/>`;
  }
  const [tx, ty] = polar(100, 55.5);
  return (
    `<path d="M${polar(100, 53).join(" ")}A53 53 0 0 1 ${polar(205, 53).join(" ")}" fill="none" stroke="#c9a227" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${polar(80, 53).join(" ")}A53 53 0 0 0 ${polar(-25, 53).join(" ")}" fill="none" stroke="#c9a227" stroke-width="2" stroke-linecap="round"/>` +
    leaves +
    `<path d="M${tx} ${ty + 1}L50 ${ty + 6}L${r1(100 - tx)} ${ty + 1}" fill="none" stroke="#c0392b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function crown() {
  return (
    `<circle cx="50" cy="50" r="52" fill="none" stroke="#d9a521" stroke-width="3.6"/>` +
    `<circle cx="50" cy="50" r="49" fill="none" stroke="#fbe289" stroke-width="1.1"/>` +
    `<path d="M29 4L33 -17L42 -6L50 -22L58 -6L67 -17L71 4Z" fill="#f2c230" stroke="#a97c00" stroke-width="1.7" stroke-linejoin="round"/>` +
    `<path d="M29 4L71 4" stroke="#a97c00" stroke-width="2.2" stroke-linecap="round"/>` +
    `<circle cx="33" cy="-17" r="2.4" fill="#c0392b"/><circle cx="50" cy="-22" r="2.8" fill="#c0392b"/><circle cx="67" cy="-17" r="2.4" fill="#c0392b"/>` +
    `<circle cx="50" cy="-3" r="2" fill="#fff3b0" stroke="#a97c00" stroke-width=".6"/>`
  );
}

const ART = { ink_ring: inkRing, bamboo, cinnabar, gold, laurel, crown };

/** The overlay `<svg>` for a frame id, or "" for anything unknown. */
export function frameSvg(id) {
  if (!isFrameId(id)) return "";
  return `<svg class="avf-art" viewBox="-10 -10 120 120" aria-hidden="true" focusable="false">${ART[id]()}</svg>`;
}

/**
 * Wrap an avatar `<img …>` string with its frame. Unknown / missing id → the string is returned untouched,
 * so un-framed players render exactly as before.
 */
export function wrapAvatarHtml(imgHtml, frameId) {
  if (!isFrameId(frameId)) return imgHtml;
  return `<span class="avf avf--${frameId}">${imgHtml}${frameSvg(frameId)}</span>`;
}
