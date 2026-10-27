/**
 * 出场特效 — pure part (no DOM, node-testable): ids, names and the geometry the effects are built from.
 * Ids / prices live on the server (server/src/lib/cosmeticDefs.js); the animation itself is in entrance-fx.js.
 */
export const ENTRANCE_IDS = Object.freeze(["ink_splash", "seal_stamp", "leek_rain", "gold_burst"]);

export const ENTRANCE_NAMES = Object.freeze({
  ink_splash: "泼墨",
  seal_stamp: "盖印",
  leek_rain: "韭菜雨",
  gold_burst: "金光",
});

export function isEntranceId(id) {
  return typeof id === "string" && ENTRANCE_IDS.includes(id);
}

/** Tiny deterministic PRNG so an effect looks the same on both phones (and in tests). */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/** A rough ink blob around (0,0): radius ~`base`, wobbling, as an SVG path. */
export function inkBlobPath(seed = 7, base = 52, points = 20) {
  const rand = rng(seed);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rad = base * (0.72 + rand() * 0.5) * (i % 5 === 0 ? 1.18 : 1);
    pts.push([r1(Math.cos(a) * rad), r1(Math.sin(a) * rad)]);
  }
  // smooth closed curve through the midpoints (quadratic corners at the points)
  const mid = (p, q) => [r1((p[0] + q[0]) / 2), r1((p[1] + q[1]) / 2)];
  let d = `M${mid(pts[points - 1], pts[0]).join(" ")}`;
  for (let i = 0; i < points; i++) d += `Q${pts[i].join(" ")} ${mid(pts[i], pts[(i + 1) % points]).join(" ")}`;
  return `${d}Z`;
}

/** Droplets flung out of a blob / burst: [{x, y, r}] at deterministic angles. */
export function droplets(seed = 3, count = 9, minD = 62, maxD = 118) {
  const rand = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const a = ((i + rand() * 0.8) / count) * Math.PI * 2;
    const d = minD + rand() * (maxD - minD);
    return { x: r1(Math.cos(a) * d), y: r1(Math.sin(a) * d), r: r1(2 + rand() * 4.5) };
  });
}

/** `n` thin triangles fanning from the centre, as one SVG path (radius `len`). */
export function rayPath(n = 14, len = 120, halfWidthDeg = 4.2) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const p = (deg, rad) => [r1(Math.cos((deg * Math.PI) / 180) * rad), r1(Math.sin((deg * Math.PI) / 180) * rad)].join(" ");
    const long = i % 2 === 0 ? len : len * 0.7;
    d += `M0 0L${p(a - halfWidthDeg, long)}L${p(a + halfWidthDeg, long)}Z`;
  }
  return d;
}

/** One leek blade standing on (0,0), `h` tall, as an SVG path. */
export function bladePath(h = 46, w = 11) {
  return `M${-w / 2} 0C${r1(-w * 0.62)} ${r1(-h * 0.4)} ${r1(-w * 0.3)} ${r1(-h * 0.82)} 0 ${-h}C${r1(w * 0.3)} ${r1(-h * 0.82)} ${r1(w * 0.62)} ${r1(-h * 0.4)} ${w / 2} 0Z`;
}

/** Leek-rain layout: [{x, delay, dur, h, rot, sway}] — x across the stage, delays spread over `spread` ms. */
export function rainDrops(seed = 11, count = 16, spread = 520) {
  const rand = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: r1(-118 + (236 * (i + rand() * 0.7)) / count),
    delay: Math.round(rand() * spread),
    dur: Math.round(950 + rand() * 600),
    h: r1(34 + rand() * 22),
    rot: r1(-40 + rand() * 80),
    sway: r1(-14 + rand() * 28),
  }));
}
