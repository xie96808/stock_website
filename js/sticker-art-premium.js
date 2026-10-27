/**
 * 对战表情 — the richer sticker kinds (no DOM, node-testable). Same rules as sticker-art-pure.js: code-drawn SVG in a
 * 100×100 box, flat colour with an ink outline, and NO gradients / filters / ids / defs in the markup.
 *
 *   face   a round emoji-style face with a caption ribbon                       (pack 情绪崩溃)
 *   fine   a gold-rimmed medallion around a small illustration, caption banner (pack 牛熊对决)
 *   grand  the same medallion on a rotating sunburst, and the illustration MOVES (pack 暴富时刻)
 *
 * Motion is CSS only (css/cosmetics.css, classes `stk-*`); every moving part is a `<g>` carrying one of those classes and
 * `prefers-reduced-motion` freezes them all, so a still sticker is always complete.
 */
const INK = "#2b2622";
const CREAM = "#fff4e0";
const GOLD = "#f0bd2d";
const GOLD_D = "#a8730a";
const GOLD_L = "#fff0a8";
const RED = "#d63b25";
const RED_D = "#8f1710";
const GREEN = "#3f9a45";

const r1 = (n) => Math.round(n * 10) / 10;
const polar = (deg, radius, cx = 50, cy = 50) => {
  const a = (deg * Math.PI) / 180;
  return [r1(cx + radius * Math.cos(a)), r1(cy + radius * Math.sin(a))];
};

const ol = (w = 1.6) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Caption banner along the bottom edge. */
function banner(text, { fill = INK, fg = CREAM, rim = null } = {}) {
  return (
    `<rect x="19" y="74" width="62" height="19" rx="6" fill="${fill}" ${ol(2.2)}/>` +
    (rim ? `<rect x="22" y="77" width="56" height="13" rx="3.5" fill="none" stroke="${rim}" stroke-width=".9" opacity=".9"/>` : "") +
    `<text x="50" y="88.6" text-anchor="middle" font-size="15.5" font-weight="800" letter-spacing="1.2" fill="${fg}" font-family="KaiTi, STKaiti, 'Kaiti SC', serif">${text}</text>`
  );
}

/** A four-point sparkle centred on (0,0). */
const star4 = (r) => {
  const k = r1(r * 0.16);
  return `M0 ${-r}C${k} ${-k} ${k} ${-k} ${r} 0C${k} ${k} ${k} ${k} 0 ${r}C${-k} ${k} ${-k} ${k} ${-r} 0C${-k} ${-k} ${-k} ${-k} 0 ${-r}Z`;
};
function spark(x, y, r, delay = 0, fill = GOLD_L, cls = "stk-twinkle") {
  return `<g transform="translate(${x} ${y})"><g class="${cls}" style="animation-delay:${delay}s"><path d="${star4(r)}" fill="${fill}" stroke="${GOLD_D}" stroke-width=".5" stroke-linejoin="round"/></g></g>`;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* face                                                                                                              */
/* ---------------------------------------------------------------------------------------------------------------- */

const FACE_FILL = "#f6c431";
const FACE_SHADE = "#e0a516";

function faceBase(fill = FACE_FILL, shade = FACE_SHADE) {
  return (
    `<circle cx="50" cy="40" r="34" fill="${fill}" ${ol(3)}/>` +
    `<path d="M22 52A30 30 0 0 0 78 52" fill="none" stroke="${shade}" stroke-width="3.2" stroke-linecap="round" opacity=".9"/>` +
    `<path d="M30 22A27 27 0 0 1 48 12" fill="none" stroke="#fff6c8" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>`
  );
}

const FACES = {
  laugh_cry: () =>
    faceBase() +
    `<path d="M29 38Q36 28 43 38M57 38Q64 28 71 38" fill="none" ${ol(3.2)}/>` +
    `<path d="M31 49Q50 78 69 49Z" fill="${INK}" ${ol(2)}/>` +
    `<path d="M36 52Q50 56 64 52L62 56Q50 60 38 56Z" fill="${CREAM}"/>` +
    `<path d="M40 61Q50 69 60 61Q50 66 40 61Z" fill="#e8654f"/>` +
    `<g class="stk-tear"><path d="M26 44C21 51 20 56 24 58C28 59 30 53 26 44Z" fill="#6cc4f5" ${ol(1.3)}/></g>` +
    `<g class="stk-tear stk-tear--b"><path d="M74 44C79 51 80 56 76 58C72 59 70 53 74 44Z" fill="#6cc4f5" ${ol(1.3)}/></g>`,
  cracked: () =>
    faceBase() +
    `<circle cx="39" cy="38" r="7.5" fill="${CREAM}" ${ol(2)}/><circle cx="61" cy="38" r="7.5" fill="${CREAM}" ${ol(2)}/>` +
    `<circle cx="40.5" cy="39.5" r="2.7" fill="${INK}"/><circle cx="59.5" cy="39.5" r="2.7" fill="${INK}"/>` +
    `<ellipse cx="50" cy="58" rx="6" ry="7.5" fill="${INK}" ${ol(1.6)}/>` +
    `<path d="M50 7L45 19L54 27L44 38L55 47L47 56" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M50 7L45 19L54 27L44 38L55 47L47 56" fill="none" stroke="#fff6c8" stroke-width=".8" stroke-linejoin="round" stroke-linecap="round" transform="translate(1.6 0)"/>`,
  dizzy: () => {
    const spiral = (cx) => {
      let d = `M${cx} 38`;
      for (let i = 1; i <= 24; i++) {
        const t = (i / 24) * Math.PI * 4;
        const rad = (i / 24) * 7.2;
        d += `L${r1(cx + rad * Math.cos(t))} ${r1(38 + rad * Math.sin(t))}`;
      }
      return `<path d="${d}" fill="none" ${ol(2)}/>`;
    };
    return (
      faceBase() +
      `<circle cx="38" cy="38" r="9" fill="${CREAM}" ${ol(1.8)}/><circle cx="62" cy="38" r="9" fill="${CREAM}" ${ol(1.8)}/>` +
      `<g class="stk-spin-fast" style="transform-origin:38px 38px">${spiral(38)}</g>` +
      `<g class="stk-spin-fast" style="transform-origin:62px 38px">${spiral(62)}</g>` +
      `<path d="M36 58Q42 53 47 58T58 58T66 57" fill="none" ${ol(2.6)}/>`
    );
  },
  smirk: () =>
    faceBase() +
    `<path d="M29 36L45 38" fill="none" ${ol(3)}/><path d="M55 33L71 29" fill="none" ${ol(3)}/>` +
    `<path d="M31 41Q38 46 45 41Z" fill="${INK}"/><path d="M55 39Q62 44 69 39Z" fill="${INK}"/>` +
    `<circle cx="29" cy="52" r="5" fill="#ff9a8a" opacity=".85"/><circle cx="71" cy="52" r="5" fill="#ff9a8a" opacity=".85"/>` +
    `<path d="M36 58Q52 66 68 51" fill="none" ${ol(3)}/>`,
  cool: () =>
    faceBase() +
    `<path d="M24 34H76" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M27 34H47V43Q47 50 37 50Q27 50 27 43Z" fill="#26232b" ${ol(2)}/><path d="M53 34H73V43Q73 50 63 50Q53 50 53 43Z" fill="#26232b" ${ol(2)}/>` +
    `<path d="M31 37L38 37M57 37L64 37" stroke="#7aa8ff" stroke-width="2" stroke-linecap="round"/>` +
    `<g class="stk-glint"><path d="M33 41L36 38" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></g>` +
    `<path d="M40 59Q50 63 60 59" fill="none" ${ol(2.8)}/>`,
  hot: () =>
    faceBase("#f3735a", "#d4513a") +
    `<g class="stk-steam"><path d="M33 11Q29 6 33 1M50 8Q46 3 50 -2M67 11Q63 6 67 1" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/></g>` +
    `<path d="M30 34L44 38M70 34L56 38" fill="none" ${ol(3)}/>` +
    `<circle cx="39" cy="42" r="4" fill="${INK}"/><circle cx="61" cy="42" r="4" fill="${INK}"/>` +
    `<path d="M33 54Q50 72 67 54Z" fill="${INK}" ${ol(2)}/><path d="M38 56Q50 60 62 56L60 60Q50 64 40 60Z" fill="${CREAM}"/>`,
  melon: () =>
    faceBase() +
    `<circle cx="38" cy="37" r="7" fill="${CREAM}" ${ol(1.8)}/><circle cx="62" cy="37" r="7" fill="${CREAM}" ${ol(1.8)}/>` +
    `<circle cx="42" cy="38" r="3" fill="${INK}"/><circle cx="66" cy="38" r="3" fill="${INK}"/>` +
    `<path d="M32 29L44 29M56 29L68 29" fill="none" ${ol(2.4)}/>` +
    `<path d="M38 56Q46 59 54 56" fill="none" ${ol(2.6)}/>` +
    `<g class="stk-bob"><path d="M58 52A17 17 0 0 0 88 52Z" fill="#e8394d" ${ol(2.2)}/><path d="M58 52A17 17 0 0 0 88 52" fill="none" stroke="#3f9a45" stroke-width="3.4" stroke-linecap="round" transform="translate(0 .3)"/>` +
    `<circle cx="67" cy="57" r="1.4" fill="${INK}"/><circle cx="73" cy="61" r="1.4" fill="${INK}"/><circle cx="79" cy="57" r="1.4" fill="${INK}"/></g>`,
  speechless: () =>
    faceBase() +
    `<path d="M30 38H44M56 38H70" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
    `<path d="M38 58H62" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<g class="stk-tear"><path d="M72 18C67 26 66 31 70 33C74 34 76 28 72 18Z" fill="#6cc4f5" ${ol(1.3)}/></g>` +
    `<circle cx="20" cy="22" r="2.2" fill="${INK}" opacity=".85"/><circle cx="27" cy="16" r="2.2" fill="${INK}" opacity=".85"/><circle cx="35" cy="12" r="2.2" fill="${INK}" opacity=".85"/>`,
};

export function faceSvgBody(a) {
  return FACES[a.art]() + banner(a.text, { fill: INK, fg: CREAM });
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* medallions: fine + grand                                                                                          */
/* ---------------------------------------------------------------------------------------------------------------- */

const MEDAL_TONES = {
  red: ["#c9321f", "#ff8a6a"],
  green: ["#2f7d3a", "#8be0a8"],
  ink: ["#2b2a33", "#8d8aa8"],
  navy: ["#243b73", "#8fb0ff"],
  plum: ["#5a2152", "#e39ad6"],
};

/** Gold-rimmed round medallion; the illustration sits in the upper part, a banner across the bottom. */
function medal({ tone, grand }) {
  const [fill, glow] = MEDAL_TONES[tone] || MEDAL_TONES.red;
  let rays = "";
  if (grand) {
    for (let i = 0; i < 14; i++) {
      const a = (360 / 14) * i;
      const [x1, y1] = polar(a - 7.5, 41, 50, 42);
      const [x2, y2] = polar(a + 7.5, 41, 50, 42);
      rays += `<path d="M50 42L${x1} ${y1}L${x2} ${y2}Z" fill="${GOLD}" opacity="${i % 2 ? 0.95 : 0.7}"/>`;
    }
    rays = `<g class="stk-spin-slow" style="transform-origin:50px 42px">${rays}</g>`;
  }
  return (
    rays +
    `<circle cx="50" cy="42" r="${grand ? 34 : 39}" fill="${GOLD}" ${ol(2.6)}/>` +
    `<circle cx="50" cy="42" r="${grand ? 30.8 : 35.6}" fill="${fill}" ${ol(1.6)}/>` +
    `<circle cx="50" cy="42" r="${grand ? 27.8 : 32.4}" fill="none" stroke="${glow}" stroke-width="1" opacity=".75" stroke-dasharray="2.6 2.6"/>` +
    `<path d="M${polar(200, grand ? 32.5 : 37, 50, 42).join(" ")}A${grand ? 32.5 : 37} ${grand ? 32.5 : 37} 0 0 1 ${polar(262, grand ? 32.5 : 37, 50, 42).join(" ")}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>` +
    (grand ? "" : `<g class="stk-glint-sweep"><path d="M26 66L40 18" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".22"/></g>`)
  );
}

const candle = (x, top, bot, w, fill, hi) =>
  `<path d="M${x} ${top - 6}V${bot + 6}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>` +
  `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${bot - top}" rx="1.6" fill="${fill}" ${ol(1.8)}/>` +
  `<path d="M${x - w / 2 + 2.2} ${top + 2.5}V${bot - 2.5}" stroke="${hi}" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>`;

const FINE = {
  bull: () =>
    `<path d="M37 28C28 28 22 23 21 13C27 19 33 20 40 22Z" fill="${CREAM}" ${ol(1.7)}/><path d="M63 28C72 28 78 23 79 13C73 19 67 20 60 22Z" fill="${CREAM}" ${ol(1.7)}/>` +
    `<ellipse cx="31" cy="35" rx="6" ry="3.4" transform="rotate(-24 31 35)" fill="#e0a516" ${ol(1.5)}/><ellipse cx="69" cy="35" rx="6" ry="3.4" transform="rotate(24 69 35)" fill="#e0a516" ${ol(1.5)}/>` +
    `<path d="M37 26C42 23 58 23 63 26L66 40C66 52 59 59 50 61C41 59 34 52 34 40Z" fill="#f4c542" ${ol(2)}/>` +
    `<ellipse cx="50" cy="53" rx="11" ry="7" fill="${CREAM}" ${ol(1.6)}/><circle cx="46" cy="53" r="1.7" fill="${INK}"/><circle cx="54" cy="53" r="1.7" fill="${INK}"/>` +
    `<circle cx="43" cy="39" r="2.6" fill="${INK}"/><circle cx="57" cy="39" r="2.6" fill="${INK}"/>` +
    `<circle cx="50" cy="59.4" r="3.4" fill="none" stroke="${GOLD_D}" stroke-width="1.8"/>`,
  bear: () =>
    `<circle cx="35" cy="26" r="7.5" fill="#8a5a3b" ${ol(1.8)}/><circle cx="65" cy="26" r="7.5" fill="#8a5a3b" ${ol(1.8)}/>` +
    `<circle cx="35" cy="26" r="3.6" fill="#d9a77c"/><circle cx="65" cy="26" r="3.6" fill="#d9a77c"/>` +
    `<circle cx="50" cy="40" r="18" fill="#a06c46" ${ol(2)}/>` +
    `<ellipse cx="50" cy="47" rx="9.5" ry="7.2" fill="#e8c9a0" ${ol(1.5)}/><ellipse cx="50" cy="43.6" rx="3.6" ry="2.6" fill="${INK}"/>` +
    `<path d="M50 46V50M46.6 51.4Q50 53.4 53.4 51.4" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="42" cy="36" r="2.4" fill="${INK}"/><circle cx="58" cy="36" r="2.4" fill="${INK}"/>` +
    `<path d="M39.5 31L45 33.4M60.5 31L55 33.4" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M66 44C69 50 69 55 66 57C63 56 63 50 66 44Z" fill="#6cc4f5" ${ol(1.1)}/>`,
  sun_candle: () => {
    let rays = "";
    for (let i = 0; i < 9; i++) {
      const a = -160 + i * 17.5;
      const [x1, y1] = polar(a, 16, 50, 32);
      const [x2, y2] = polar(a, 25, 50, 32);
      rays += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${GOLD}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    return `<g class="stk-pulse">${rays}</g><circle cx="50" cy="32" r="11" fill="${GOLD}" ${ol(1.6)} opacity=".95"/>` + candle(50, 28, 58, 13, "#e23a2b", "#ff9a82");
  },
  cloud_candle: () =>
    candle(50, 38, 62, 13, GREEN, "#8be0a8") +
    `<path d="M30 30C26 30 24 26 27 23C28 18 35 17 38 21C41 15 50 16 51 22C57 19 64 22 63 27C68 27 70 32 66 33H31Z" fill="#9aa3ad" ${ol(1.7)}/>` +
    `<g class="stk-rain"><path d="M36 37L33 44M46 37L43 44M56 37L53 44M64 36L61 43" stroke="#6cc4f5" stroke-width="2" stroke-linecap="round"/></g>`,
  double: () =>
    `<ellipse cx="42" cy="56" rx="14" ry="5.4" fill="${GOLD_D}" ${ol(1.6)}/><ellipse cx="42" cy="52" rx="14" ry="5.4" fill="${GOLD}" ${ol(1.6)}/>` +
    `<ellipse cx="42" cy="47" rx="14" ry="5.4" fill="${GOLD_D}" ${ol(1.6)}/><ellipse cx="42" cy="43" rx="14" ry="5.4" fill="${GOLD}" ${ol(1.6)}/>` +
    `<ellipse cx="42" cy="38" rx="14" ry="5.4" fill="${GOLD_D}" ${ol(1.6)}/><ellipse cx="42" cy="34" rx="14" ry="5.4" fill="${GOLD_L}" ${ol(1.6)}/>` +
    `<rect x="39" y="31.6" width="6" height="4.8" rx=".8" fill="none" stroke="${GOLD_D}" stroke-width="1.2"/>` +
    `<g class="stk-bob"><path d="M64 44V22M56.5 29L64 21L71.5 29" fill="none" stroke="${CREAM}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M64 44V22M56.5 29L64 21L71.5 29" fill="none" stroke="#e23a2b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  chop: () =>
    `<g class="stk-chop-a"><path d="M36 18H64V40L36 36Z" fill="#e23a2b" ${ol(1.8)}/><path d="M36 18V36" stroke="#ff9a82" stroke-width="2" opacity=".8"/></g>` +
    `<g class="stk-chop-b"><path d="M36 41L64 45V64H36Z" fill="#e23a2b" ${ol(1.8)}/><path d="M40 47V60" stroke="#ff9a82" stroke-width="2" opacity=".8" stroke-linecap="round"/></g>` +
    `<path d="M28 44L72 38" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M24 47L33 43M70 36L78 33" stroke="${GOLD_L}" stroke-width="2" stroke-linecap="round"/>`,
  v_turn: () =>
    `<path d="M26 22L46 56L74 22" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M26 22L46 56" fill="none" stroke="${GREEN}" stroke-width="4.2" stroke-linecap="round"/>` +
    `<path d="M46 56L74 22" fill="none" stroke="#ff5a43" stroke-width="4.2" stroke-linecap="round"/>` +
    `<path d="M66 20L76 20L76 31" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M66 20L76 20L76 31" fill="none" stroke="#ff5a43" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="46" cy="56" r="3.6" fill="${GOLD_L}" ${ol(1.4)}/>`,
  new_high: () =>
    `<path d="M24 62L38 44L46 52L64 26" fill="none" stroke="${INK}" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M24 62L38 44L46 52L64 26" fill="none" stroke="#ff5a43" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M64 26V10" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><path d="M64.6 10.6H78L73 16L78 21.6H64.6Z" fill="${GOLD}" ${ol(1.5)}/>` +
    `<circle cx="64" cy="26" r="3.4" fill="${GOLD_L}" ${ol(1.4)}/>`,
};

/* ----- grand: every one of these moves ------------------------------------------------------------------------- */

const GRAND = {
  ingot: () =>
    `<g class="stk-bob">` +
    `<path d="M20 40C21 54 33 62 50 62C67 62 79 54 80 40C73 45 64 45 58 40C56 35 44 35 42 40C36 45 27 45 20 40Z" fill="${GOLD}" ${ol(2)}/>` +
    `<path d="M20 40C27 45 36 45 42 40C44 35 56 35 58 40C64 45 73 45 80 40C76 31 66 27 50 27C34 27 24 31 20 40Z" fill="${GOLD_L}" ${ol(2)}/>` +
    `<path d="M34 34C40 30 60 30 66 34" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".9"/>` +
    `<path d="M30 52C36 56 44 57 50 57" fill="none" stroke="${GOLD_D}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>` +
    `</g>` +
    spark(24, 22, 5, 0) + spark(78, 26, 4, 0.6) + spark(70, 12, 3.2, 1.1) + spark(30, 56, 3, 1.6),
  rocket: () =>
    `<g class="stk-shake" style="transform-origin:50px 40px"><g transform="rotate(38 50 42)">` +
    `<g class="stk-flame" style="transform-origin:50px 56px"><path d="M43 54C44 62 47 66 50 71C53 66 56 62 57 54Z" fill="#ff7b2e" ${ol(1.6)}/><path d="M46.5 54C47.5 59 49 62 50 64C51 62 52.500 59 53.500 54Z" fill="#ffe27a"/></g>` +
    `<path d="M50 14C60 22 62 38 59 54H41C38 38 40 22 50 14Z" fill="${CREAM}" ${ol(2)}/>` +
    `<path d="M50 14C54 17 56.500 21 58 26H42C43.500 21 46 17 50 14Z" fill="#e23a2b" ${ol(1.8)}/>` +
    `<circle cx="50" cy="36" r="6" fill="#6cc4f5" ${ol(1.8)}/><path d="M47.500 34L49.500 32.500" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="M41 46L32 58L41 55Z" fill="#e23a2b" ${ol(1.7)}/><path d="M59 46L68 58L59 55Z" fill="#e23a2b" ${ol(1.7)}/>` +
    `</g></g>` +
    spark(22, 22, 4, 0.2) + spark(78, 18, 3.4, 0.9) + spark(80, 52, 3, 1.4) + spark(20, 56, 2.6, 0.5),
  diamond: () =>
    `<g class="stk-bob">` +
    `<path d="M30 30H70L82 42L50 70L18 42Z" fill="#6fd6ff" ${ol(2)}/>` +
    `<path d="M18 42H82M30 30L38 42L50 70L62 42L70 30M38 42L50 30L62 42" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" opacity=".95"/>` +
    `<path d="M30 30L38 42H18Z" fill="#a8ecff"/><path d="M50 30L38 42H62Z" fill="#c9f4ff"/><path d="M38 42L50 70L18 42Z" fill="#42b8e8" opacity=".9"/>` +
    `<path d="M30 30H70L82 42L50 70L18 42Z" fill="none" ${ol(2)}/>` +
    `</g>` +
    `<g class="stk-glint-diamond"><path d="M26 28L38 28" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>` +
    spark(80, 24, 5.4, 0) + spark(22, 18, 3.4, 0.7) + spark(74, 62, 3, 1.3),
  firework: () => {
    let burst = "";
    const cols = ["#ff5a43", GOLD, "#6cc4f5", "#ff8ad8", "#8be0a8"];
    for (let i = 0; i < 12; i++) {
      const a = i * 30;
      const [x1, y1] = polar(a, 8, 50, 40);
      const [x2, y2] = polar(a, i % 2 ? 22 : 29, 50, 40);
      const [x3, y3] = polar(a, i % 2 ? 26 : 34, 50, 40);
      burst += `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${cols[i % cols.length]}" stroke-width="3" stroke-linecap="round"/><circle cx="${x3}" cy="${y3}" r="2.4" fill="${cols[(i + 2) % cols.length]}"/>`;
    }
    return `<g class="stk-burst" style="transform-origin:50px 40px">${burst}</g><circle cx="50" cy="40" r="5" fill="#fff"/>` + spark(24, 18, 3.6, 0.3) + spark(78, 60, 3.2, 1);
  },
  packet: () =>
    `<g class="stk-swing" style="transform-origin:50px 14px">` +
    `<rect x="31" y="16" width="38" height="50" rx="5" fill="#e23a2b" ${ol(2)}/>` +
    `<path d="M31 24C40 36 60 36 69 24" fill="#c9321f" ${ol(2)}/>` +
    `<circle cx="50" cy="38" r="8.5" fill="${GOLD}" ${ol(1.8)}/><rect x="47" y="35" width="6" height="6" rx="1" fill="none" stroke="${GOLD_D}" stroke-width="1.5"/>` +
    `<path d="M36 50H64M36 56H58" stroke="${GOLD}" stroke-width="2" stroke-linecap="round" opacity=".9"/>` +
    `<path d="M34 20V62" stroke="#ff9a82" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>` +
    `</g>` +
    spark(22, 30, 4.2, 0) + spark(79, 38, 3.6, 0.7) + spark(74, 62, 3, 1.3),
  trophy: () =>
    `<g class="stk-bob">` +
    `<path d="M33 20H67V34C67 45 59 52 50 52C41 52 33 45 33 34Z" fill="${GOLD}" ${ol(2)}/>` +
    `<path d="M33 24H25C25 36 30 40 36 40M67 24H75C75 36 70 40 64 40" fill="none" ${ol(2)}/>` +
    `<path d="M44 52H56L58 60H42Z" fill="${GOLD_D}" ${ol(1.7)}/><rect x="36" y="60" width="28" height="7" rx="2" fill="${GOLD}" ${ol(1.8)}/>` +
    `<path d="M39 24V36" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".7"/>` +
    `<path d="M50 26L52.600 31.500L58.500 32.200L54.200 36.200L55.300 42L50 39.200L44.700 42L45.800 36.200L41.500 32.200L47.400 31.500Z" fill="${GOLD_L}" ${ol(1.2)}/>` +
    `</g>` +
    `<g class="stk-fall"><rect x="24" y="8" width="4" height="7" rx="1" fill="#ff5a43" transform="rotate(20 26 11)"/></g>` +
    `<g class="stk-fall" style="animation-delay:.5s"><rect x="72" y="6" width="4" height="7" rx="1" fill="#6cc4f5" transform="rotate(-25 74 9)"/></g>` +
    `<g class="stk-fall" style="animation-delay:1s"><rect x="48" y="4" width="4" height="7" rx="1" fill="#8be0a8" transform="rotate(35 50 7)"/></g>` +
    `<g class="stk-fall" style="animation-delay:1.4s"><rect x="84" y="12" width="4" height="7" rx="1" fill="#ff8ad8" transform="rotate(-10 86 15)"/></g>`,
  coin: () =>
    `<g class="stk-flip" style="transform-origin:50px 40px">` +
    `<circle cx="50" cy="40" r="26" fill="${GOLD}" ${ol(2.2)}/><circle cx="50" cy="40" r="21" fill="none" stroke="${GOLD_D}" stroke-width="1.6"/>` +
    `<rect x="42" y="32" width="16" height="16" rx="2.4" fill="${INK}" ${ol(1.6)}/><rect x="45" y="35" width="10" height="10" rx="1.2" fill="none" stroke="${GOLD_L}" stroke-width="1" opacity=".5"/>` +
    `<path d="M32 28A20 20 0 0 1 44 20" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>` +
    `</g>` +
    spark(20, 20, 4.4, 0.1) + spark(80, 26, 3.6, 0.8) + spark(76, 62, 4, 1.3) + spark(24, 58, 3, 0.5),
  crit: () => {
    let pts = "";
    for (let i = 0; i < 16; i++) {
      const [x, y] = polar(i * 22.5 - 90, i % 2 ? 17 : 33, 50, 40);
      pts += `${i ? "L" : "M"}${x} ${y}`;
    }
    return (
      `<g class="stk-pulse" style="transform-origin:50px 40px"><path d="${pts}Z" fill="${GOLD}" ${ol(2.2)}/><path d="${pts}Z" fill="none" stroke="${GOLD_L}" stroke-width="1" transform="translate(0 0) scale(.82)" style="transform-origin:50px 40px"/></g>` +
      `<path d="M55 14L40 42H50L44 66L63 36H52Z" fill="#e23a2b" ${ol(2)}/>` +
      `<path d="M53 20L45 38" stroke="#ff9a82" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>` +
      spark(18, 16, 3.6, 0.2) + spark(82, 62, 3.6, 0.9)
    );
  },
};

export function medalSvgBody(a, grand) {
  const table = grand ? GRAND : FINE;
  const banners = grand
    ? banner(a.text, { fill: "#7a1d12", fg: GOLD_L, rim: GOLD })
    : banner(a.text, { fill: INK, fg: GOLD_L, rim: GOLD_D });
  return medal({ tone: a.tone, grand }) + table[a.art]() + banners;
}

/** Ids of the drawings, for the catalogue test. */
export const FACE_ARTS = Object.freeze(Object.keys(FACES));
export const FINE_ARTS = Object.freeze(Object.keys(FINE));
export const GRAND_ARTS = Object.freeze(Object.keys(GRAND));
