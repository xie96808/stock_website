/**
 * 头像框 art + view helpers (no DOM, so node can test them). The art is code-drawn SVG — no image assets.
 * Ids and prices live on the server (server/src/lib/frameDefs.js); this file only knows how to draw an id.
 *
 * Look: woodblock-print — flat colour shapes with a thin ink outline and one highlight, so it sits in the paper / ink
 * theme and still reads at 40px (a PvP seat) as well as at 90px (the shop). No gradients / filters / ids: nothing in the
 * markup can collide when the same frame is on screen many times, and a hidden copy cannot break a visible one.
 *
 * Geometry: every drawing uses viewBox "-10 -10 120 120" — the avatar is the circle of radius 50 at (50,50), the ring
 * art sits at radius ~50–58 and (via .avf-art being 120% of the avatar) may spill a little outside it.
 *
 * Motion lives in css/avatar-frame.css (classes `avf-sway`, `avf-sheen`, `avf-twinkle`, `avf-pulse`); every moving part
 * is a `<g>` with one of those classes, and `prefers-reduced-motion` switches them all off.
 */
export const FRAME_IDS = Object.freeze(["jiu_huang", "ink_ring", "bamboo", "cinnabar", "gold", "laurel", "crown"]);

export const FRAME_NAMES = Object.freeze({
  jiu_huang: "韭皇",
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

const INK = "#2b2622";
const PAPER = "#f6eddc";

const r1 = (n) => Math.round(n * 10) / 10;
const polar = (deg, radius, cx = 50, cy = 50) => {
  const a = (deg * Math.PI) / 180;
  return [r1(cx + radius * Math.cos(a)), r1(cy + radius * Math.sin(a))];
};
const at = (deg, radius) => polar(deg, radius).join(" ");

/** Pointed leaf lying along +x from (0,0): length L, half-width W. */
const leafPath = (L, W) =>
  `M0 0C${r1(L * 0.25)} ${-r1(W)} ${r1(L * 0.7)} ${-r1(W * 0.95)} ${r1(L)} 0C${r1(L * 0.7)} ${r1(W * 0.95)} ${r1(L * 0.25)} ${r1(W)} 0 0Z`;

/** A leaf with outline, fill and centre vein, placed at (x,y) pointing `rot` degrees. */
function leaf(x, y, rot, L, W, fill, vein) {
  return (
    `<g transform="translate(${x} ${y}) rotate(${r1(rot)})">` +
    `<path d="${leafPath(L, W)}" fill="${fill}" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="M${r1(L * 0.12)} 0L${r1(L * 0.86)} 0" stroke="${vein}" stroke-width=".7" stroke-linecap="round"/></g>`
  );
}

/** A blank red seal (闲章) centred on (cx,cy): a square with an inner border and a window-lattice mark — no characters. */
function chop(cx, cy, size) {
  const h = size / 2;
  const i = h - size * 0.17;
  const m = size * 0.2;
  return (
    `<rect x="${r1(cx - h)}" y="${r1(cy - h)}" width="${size}" height="${size}" rx="${r1(size * 0.14)}" fill="#c8321f" stroke="${INK}" stroke-width=".85"/>` +
    `<rect x="${r1(cx - i)}" y="${r1(cy - i)}" width="${r1(i * 2)}" height="${r1(i * 2)}" rx="1" fill="none" stroke="#fff4e0" stroke-width=".6" opacity=".85"/>` +
    `<path d="M${r1(cx - m)} ${r1(cy)}L${r1(cx + m)} ${r1(cy)}M${r1(cx)} ${r1(cy - m)}L${r1(cx)} ${r1(cy + m)}" stroke="#fff4e0" stroke-width=".75" stroke-linecap="round" opacity=".9"/>`
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** 墨圈 — one brush stroke (圆相): heavy where the brush lands, thinning to a dry tail, red seal in the gap. */
function inkRing() {
  const R = 54;
  const a0 = -56;
  const span = 316;
  const N = 84;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = a0 + span * t;
    const w = 1.1 + 6.3 * Math.pow(1 - t, 1.2) + 1.4 * Math.sin(t * 11) * (1 - t) * 0.5;
    const wob = 0.45 * Math.sin(t * 19 + 1.3);
    outer.push(polar(a, R + w * 0.6 + wob).join(" "));
    inner.push(polar(a, R - w * 0.4 + wob).join(" "));
  }
  const shape = `M${outer.join("L")}L${inner.reverse().join("L")}Z`;
  const [sx, sy] = polar(a0, R);
  const dry = (from, to, off) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(polar(a0 + span * (from + ((to - from) * i) / 14), R + off).join(" "));
    return `<path d="M${pts.join("L")}" fill="none" stroke="${PAPER}" stroke-width=".55" stroke-linecap="round" opacity=".55"/>`;
  };
  const [gx, gy] = polar(a0 + span + (360 - span) / 2, R + 0.5);
  const drop = (deg, rad, r) => {
    const [x, y] = polar(deg, rad);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;
  };
  // The brush is drawn in currentColor so the dark theme can flip it to light ink (css/avatar-frame.css).
  return (
    `<g class="avf-ink">` +
    `<path d="${shape}" fill="none" stroke="${PAPER}" stroke-width="2.4" stroke-linejoin="round" opacity=".55" class="avf-ink-halo"/>` +
    `<path d="${shape}" fill="currentColor"/>` +
    `<circle cx="${sx}" cy="${sy}" r="3.9" fill="currentColor"/>` +
    dry(0.03, 0.42, -0.7) + dry(0.06, 0.3, 1.1) +
    drop(a0 - 11, R + 8.6, 1.7) + drop(a0 - 19, R + 6.2, 1) + drop(a0 + 7, R + 9.2, 0.8) +
    `</g>` +
    `<g class="avf-pulse" transform="rotate(5 ${gx} ${gy})">` +
    chop(gx, gy, 10.4) + `</g>`
  );
}

/** 青竹 — a living bamboo stalk bent round the avatar: jointed, glossy, with two sprigs that sway. */
function bamboo() {
  const R = 54.5;
  const from = 196;
  const to = -16;
  const arc = (r) => `M${at(from, r)}A${r} ${r} 0 1 0 ${at(to, r)}`;
  let nodes = "";
  for (let i = 1; i <= 5; i++) {
    const a = from - ((from - to) * i) / 6;
    const [x1, y1] = polar(a, R - 4.6);
    const [x2, y2] = polar(a, R + 4.6);
    const [cx, cy] = polar(a, R);
    nodes += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>`;
    nodes += `<ellipse cx="${cx}" cy="${cy}" rx="2.1" ry="5.5" transform="rotate(${r1(a)} ${cx} ${cy})" fill="#4d9a52" stroke="${INK}" stroke-width=".9"/>`;
  }
  // two sprigs fanning out of the stalk ends, drawn upright then rotated to follow the tangent
  const sprig = (deg, dir) => {
    const [x, y] = polar(deg, R);
    const base = deg + (dir > 0 ? -90 : 90);
    const leaves = [
      [base - 34 * dir, 21, 5.6],
      [base + 4 * dir, 24, 6.2],
      [base + 42 * dir, 18, 5],
    ];
    return leaves
      .map(([rot, L, W], i) =>
        `<g transform="translate(${x} ${y})"><g class="avf-sway" style="animation-delay:${i * 0.35 + (dir > 0 ? 0 : 0.6)}s">` +
        `<g transform="rotate(${r1(rot)})"><path d="${leafPath(L, W)}" fill="${i === 1 ? "#6cbf5c" : "#58aa4e"}" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
        `<path d="M2 0L${r1(L - 3)} 0" stroke="#c6efae" stroke-width=".7" stroke-linecap="round"/></g></g></g>`)
      .join("");
  };
  return (
    `<path d="${arc(R)}" fill="none" stroke="${INK}" stroke-width="8.2" stroke-linecap="round"/>` +
    `<path d="${arc(R)}" fill="none" stroke="#4d9a52" stroke-width="6.1" stroke-linecap="round"/>` +
    `<path d="${arc(R - 1.5)}" fill="none" stroke="#2f6e3a" stroke-width="1.6" opacity=".8"/>` +
    `<path d="${arc(R + 1.3)}" fill="none" stroke="#b6e69a" stroke-width="1.4" stroke-linecap="round" opacity=".95"/>` +
    nodes + sprig(from - 2, 1) + sprig(to + 2, -1)
  );
}

/** One 祥云 scroll: sits on the ring at `deg`, tail along the ring, curl facing outward. */
function cloud(deg) {
  const [x, y] = polar(deg, 54);
  const d =
    "M-13 1.4C-9 1.4-6 .4-4.4-1.8C-2.8-4-.6-6 2.2-5.6C5.2-5.2 6.2-1.8 4-.3C2.3.8 .4-.4 1.2-2.1" +
    "M5 1.4C8 1.4 10.5 1 13 -.4";
  return (
    `<g transform="translate(${x} ${y}) rotate(${r1(deg + 90)}) scale(1.22) translate(0 -2.4)" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${d}" stroke="${INK}" stroke-width="4.2"/><path d="${d}" stroke="#d63b25" stroke-width="2.3"/></g>`
  );
}

/** 朱砂 — vermilion seal-ink ring with 祥云 scrolls, glowing red beads and a blank chop. */
function cinnabar() {
  const beads = [-45, -135, 45, 135];
  let dots = "";
  beads.forEach((a, i) => {
    const [x, y] = polar(a, 52.6);
    dots += `<g class="avf-twinkle" style="animation-delay:${i * 0.45}s"><circle cx="${x}" cy="${y}" r="1.9" fill="#ffe3c2" stroke="${INK}" stroke-width=".6"/></g>`;
  });
  const [sx, sy] = polar(90, 55.5);
  return (
    `<circle cx="50" cy="50" r="52.6" fill="none" stroke="${INK}" stroke-width="6.4"/>` +
    `<circle cx="50" cy="50" r="52.6" fill="none" stroke="#d63b25" stroke-width="4.4"/>` +
    `<circle cx="50" cy="50" r="51.2" fill="none" stroke="#f4906c" stroke-width="1" opacity=".85"/>` +
    cloud(-90) + cloud(180) + cloud(0) + dots +
    `<g class="avf-pulse" transform="rotate(-6 ${sx} ${sy})">` +
    chop(sx + 0.2, sy + 0.4, 14) +
    `</g>`
  );
}

/** 金边 — gilded band with beads, four crest diamonds and a highlight that travels round the ring. */
function gold() {
  const R = 53;
  let beads = "";
  for (let i = 0; i < 20; i++) {
    const a = i * 18 + 9;
    if ([-90, 0, 90, 180].some((c) => Math.abs((((a - c + 540) % 360) - 180)) < 8)) continue;
    const [x, y] = polar(a, R);
    beads += `<circle cx="${x}" cy="${y}" r="1.45" fill="#fff6d2" stroke="#8c5b00" stroke-width=".45"/>`;
  }
  const gem = (deg, s) => {
    const [x, y] = polar(deg, R + 3.2);
    return (
      `<g transform="translate(${x} ${y}) rotate(${deg + 90}) scale(${s})">` +
      `<path d="M0-8L4.6 0L0 8L-4.6 0Z" fill="#f6cc47" stroke="${INK}" stroke-width=".95" stroke-linejoin="round"/>` +
      `<path d="M0-8L0 8M-4.6 0L4.6 0" stroke="#a8730a" stroke-width=".5" opacity=".7"/>` +
      `<circle r="1.7" fill="#d63b25" stroke="${INK}" stroke-width=".5"/></g>`
    );
  };
  const arc = (from, len, r) => `M${at(from, r)}A${r} ${r} 0 0 1 ${at(from + len, r)}`;
  return (
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${INK}" stroke-width="7.6"/>` +
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="#e3a920" stroke-width="5.6"/>` +
    `<circle cx="50" cy="50" r="${R + 2.1}" fill="none" stroke="#a8730a" stroke-width="1.1"/>` +
    `<circle cx="50" cy="50" r="${R - 2.1}" fill="none" stroke="#fff0a8" stroke-width="1.3"/>` +
    beads +
    `<g class="avf-sheen"><path d="${arc(-120, 46, R)}" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" opacity=".38"/>` +
    `<path d="${arc(-108, 16, R)}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".95"/></g>` +
    gem(-90, 1.3) + gem(0, 0.95) + gem(90, 0.95) + gem(180, 0.95)
  );
}

/** 月桂 — a proper two-branch wreath tied with a red ribbon; victory gold on the stems and berries. */
function laurel() {
  const R = 54.5;
  let out = "";
  const branch = (side) => {
    const fx = (p) => (side < 0 ? p : [r1(100 - p[0]), p[1]]);
    const start = 92;
    const end = 238;
    const stem = [];
    for (let i = 0; i <= 12; i++) stem.push(fx(polar(start + ((end - start) * i) / 12, R)).join(" "));
    out += `<path d="M${stem.join("L")}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
    out += `<path d="M${stem.join("L")}" fill="none" stroke="#c9a227" stroke-width="1.8" stroke-linecap="round"/>`;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = start + 5 + ((end - start - 14) * i) / (n - 1);
      const k = 1 - (i / (n - 1)) * 0.38; // leaves shrink towards the tip
      const [x, y] = fx(polar(a, R));
      const tang = a + 90; // growth direction (clockwise in screen space)
      const mirror = (deg) => (side < 0 ? deg : 180 - deg);
      const outer = mirror(tang - 38);
      const innerRot = mirror(tang + 38);
      const hue = i % 2 ? "#6fae48" : "#82bd52";
      out += leaf(x, y, outer, 13 * k, 4.6 * k, hue, "#d4eba0");
      out += leaf(x, y, innerRot, 12 * k, 4.2 * k, i % 2 ? "#82bd52" : "#6fae48", "#d4eba0");
    }
    // berry at the tip
    const [bx, by] = fx(polar(end + 6, R));
    out += `<circle cx="${bx}" cy="${by}" r="2.3" fill="#d63b25" stroke="${INK}" stroke-width=".8"/>`;
  };
  branch(-1);
  branch(1);
  const bow =
    `<path d="M50 105L41.5 114L46 114.6L50 110.4L54 114.6L58.5 114Z" fill="#c8321f" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="M50 102.6C44 97.4 37.6 99.6 39.2 104C40.8 108.2 47 106.4 50 102.6C53 106.4 59.2 108.2 60.8 104C62.4 99.6 56 97.4 50 102.6Z" fill="#d63b25" stroke="${INK}" stroke-width=".95" stroke-linejoin="round"/>` +
    `<circle cx="50" cy="103.2" r="2.4" fill="#c8321f" stroke="${INK}" stroke-width=".8"/>`;
  return out + bow;
}

/** One leek blade standing on (0,0): height H, base width W. */
function blade(H, W, fill) {
  return (
    `<path d="M${-W / 2} 0C${r1(-W * 0.62)} ${r1(-H * 0.4)} ${r1(-W * 0.3)} ${r1(-H * 0.82)} 0 ${-H}C${r1(W * 0.3)} ${r1(-H * 0.82)} ${r1(W * 0.62)} ${r1(-H * 0.4)} ${W / 2} 0Z" fill="${fill}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M0 ${r1(-H * 0.12)}L0 ${r1(-H * 0.86)}" stroke="#c9f0a2" stroke-width="${r1(W * 0.2)}" stroke-linecap="round" opacity=".9"/>`
  );
}

/** 韭王冠 — the crown is made of leeks: five blades fanning out of a gold band set with a ruby. */
function crown() {
  const R = 52.5;
  const arcTop = (r, a, b) => `M${at(a, r)}A${r} ${r} 0 0 1 ${at(b, r)}`;
  const place = (deg, H, W, fill, lean) => {
    const [x, y] = polar(deg, R - 1);
    return `<g transform="translate(${x} ${y}) rotate(${deg + 90 + lean})">${blade(H, W, fill)}</g>`;
  };
  return (
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${INK}" stroke-width="5.4"/>` +
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="#e3a920" stroke-width="3.6"/>` +
    `<circle cx="50" cy="50" r="${R - 1.3}" fill="none" stroke="#fff0a8" stroke-width=".9"/>` +
    `<g class="avf-sway avf-sway--slow">` +
    place(-90 - 46, 15, 8, "#3f9a45", -6) + place(-90 + 46, 15, 8, "#3f9a45", 6) +
    place(-90 - 24, 21, 9.5, "#4aa84d", -3) + place(-90 + 24, 21, 9.5, "#4aa84d", 3) +
    place(-90, 27, 11, "#58b955", 0) +
    `</g>` +
    `<path d="${arcTop(R, -131, -49)}" fill="none" stroke="${INK}" stroke-width="7.2" stroke-linecap="round"/>` +
    `<path d="${arcTop(R, -131, -49)}" fill="none" stroke="#f0bd2d" stroke-width="5.2" stroke-linecap="round"/>` +
    `<path d="${arcTop(R + 1.6, -126, -54)}" fill="none" stroke="#fff0a8" stroke-width="1.1" stroke-linecap="round"/>` +
    `<g class="avf-twinkle"><path d="M50-3.4L54.2 0.6L50 4.6L45.8 0.6Z" fill="#e53a2a" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="M48.6-.4L50-1.9" stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".9"/></g>`
  );
}

/** 韭皇 — the starter frame and the only one that carries the character: a leek-green ring with a red 韭皇 plaque. */
function jiuHuang() {
  const R = 52.5;
  const [px, py] = polar(90, R + 3);
  return (
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${INK}" stroke-width="5.6"/>` +
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="#4aa84d" stroke-width="3.8"/>` +
    `<circle cx="50" cy="50" r="${R - 1.2}" fill="none" stroke="#b8e8a0" stroke-width=".9" opacity=".9"/>` +
    leaf(r1(px - 15), r1(py - 4), 200, 11, 3.8, "#58b955", "#c9f0a2") +
    leaf(r1(px + 15), r1(py - 4), -20, 11, 3.8, "#58b955", "#c9f0a2") +
    `<g class="avf-pulse"><rect x="${r1(px - 15)}" y="${r1(py - 7.4)}" width="30" height="14.8" rx="3.4" fill="#c8321f" stroke="${INK}" stroke-width=".95"/>` +
    `<rect x="${r1(px - 13)}" y="${r1(py - 5.4)}" width="26" height="10.8" rx="2" fill="none" stroke="#f3c53a" stroke-width=".8"/>` +
    `<text x="${px}" y="${r1(py + 3.5)}" text-anchor="middle" font-size="9.6" font-weight="700" letter-spacing=".6" fill="#ffe27a" font-family="serif">韭皇</text></g>`
  );
}

const ART = { jiu_huang: jiuHuang, ink_ring: inkRing, bamboo, cinnabar, gold, laurel, crown };

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
