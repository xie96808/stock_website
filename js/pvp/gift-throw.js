/**
 * Sender-side gift throw: the gift arcs from the picker button and smashes into
 * the opponent's avatar (squash, avatar shake, item-flavoured particles, fade).
 * Transforms/opacity only via the Web Animations API; one fixed overlay layer
 * on <body>, so closing/hiding the picker mid-flight does not cut it off.
 * Receiver-side animation (notices.js showGift) is untouched.
 */
import { giftArtNode } from "./gift-art.js";

const EMOJI = { flower: "🌸", tomato: "🍅", pipe: "💨", coffee: "☕", fish: "🐟", leaf: "🥬" };
const OPP_AVATARS = ["pvpWinOppAvatar", "pvpResultOppAvatar", "pvpSeatOppAvatar"];
export const THROW_MAX = 3;
const FLIGHT_MS = 480;
const IMPACT_MS = 260;
const PARTICLES = 9;
const active = new Set();

function reducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function layer() {
  let node = document.getElementById("pvpThrowLayer");
  if (node) return node;
  node = document.createElement("div");
  node.id = "pvpThrowLayer";
  node.className = "pvp-throw-layer";
  node.setAttribute("aria-hidden", "true");
  document.body.append(node);
  return node;
}

function visibleRect(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
  return r;
}

function findTarget() {
  for (const id of OPP_AVATARS) {
    const el = document.getElementById(id);
    const r = visibleRect(el);
    if (r) return { el, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  // Avatar scrolled away: a temporary stand-in avatar pops in at the upper right.
  const src = OPP_AVATARS.map((id) => document.getElementById(id)).find((el) => el?.currentSrc || el?.src);
  return {
    el: null,
    proxySrc: src ? (src.currentSrc || src.src) : "",
    x: innerWidth - Math.min(64, innerWidth * 0.16),
    y: Math.min(130, Math.max(90, innerHeight * 0.16)),
  };
}

function makeProxy(entry, target) {
  const wrap = document.createElement("div");
  wrap.className = "pvp-throw-target";
  wrap.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
  const face = document.createElement(target.proxySrc ? "img" : "span");
  face.className = "pvp-throw-target-face";
  if (target.proxySrc) { face.src = target.proxySrc; face.alt = ""; }
  else face.textContent = "对手";
  wrap.append(face);
  entry.node.before(wrap);
  entry.extra.push(wrap);
  entry.anims.push(face.animate([
    { transform: "scale(0.3)", opacity: 0 },
    { transform: "scale(1.08)", opacity: 1, offset: 0.6 },
    { transform: "scale(1)", opacity: 1 },
  ], { duration: 260, easing: "ease-out", fill: "forwards" }));
  return face;
}

function finish(entry) {
  if (!entry || entry.done) return;
  entry.done = true;
  window.clearTimeout(entry.timer);
  for (const a of entry.anims) { try { a.cancel(); } catch { /* ignore */ } }
  entry.node.remove();
  for (const n of entry.extra) n.remove();
  active.delete(entry);
}

/** Number of throws currently on screen (for tests / QA). */
export function activeThrowCount() {
  return active.size;
}

/**
 * Play the throw. `from` is the element the gift leaves from (picker button).
 * Returns a promise that resolves once the nodes are removed.
 */
export function playGiftThrow(kind, from) {
  const k = EMOJI[kind] ? kind : "flower";
  if (typeof document === "undefined" || !document.body) return Promise.resolve();
  // Cap concurrent throws: retire the oldest instantly.
  while (active.size >= THROW_MAX) finish(active.values().next().value);

  const fr = from?.getBoundingClientRect?.();
  const sx = fr && fr.width ? fr.left + fr.width / 2 : innerWidth * 0.25;
  const sy = fr && fr.height ? fr.top + fr.height / 2 : innerHeight * 0.75;
  const target = findTarget();
  const dx = target.x - sx;
  const dy = target.y - sy;

  const node = document.createElement("div");
  node.className = `pvp-throw pvp-throw-${k}`;
  const proj = document.createElement("div");
  proj.className = "pvp-throw-proj";
  const art = giftArtNode(k, { size: 44, className: "pvp-throw-img" });
  if (art) proj.append(art);
  else {
    const e = document.createElement("span");
    e.className = "pvp-throw-emoji";
    e.textContent = EMOJI[k];
    proj.append(e);
  }
  node.append(proj);
  node.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
  layer().append(node);

  const entry = { node, anims: [], extra: [], done: false, timer: 0 };
  active.add(entry);
  const total = reducedMotion() ? 360 : FLIGHT_MS + IMPACT_MS;
  entry.timer = window.setTimeout(() => finish(entry), total + 400); // safety net

  if (reducedMotion()) {
    node.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
    const a = proj.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: 360, easing: "ease-out", fill: "forwards" });
    entry.anims.push(a);
    return a.finished.catch(() => {}).then(() => finish(entry));
  }

  if (!target.el) target.el = makeProxy(entry, target);
  const proxy = target.el?.classList?.contains("pvp-throw-target-face") ? target.el : null;

  // Arc: sample a parabola so a single element moves along the curve.
  const lift = Math.max(70, Math.min(180, Math.abs(dx) * 0.35 + 60));
  const spin = dx >= 0 ? 540 : -540;
  const frames = [];
  const N = 10;
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const x = sx + dx * t;
    const y = sy + dy * t - 4 * lift * t * (1 - t);
    const s = 0.7 + 0.5 * Math.sin(Math.PI * t) + 0.1 * t;
    frames.push({ transform: `translate3d(${x}px, ${y}px, 0) rotate(${spin * t}deg) scale(${s.toFixed(3)})`, offset: t });
  }
  const fly = node.animate(frames, { duration: FLIGHT_MS, easing: "cubic-bezier(.3,.05,.6,1)", fill: "forwards" });
  entry.anims.push(fly);

  return fly.finished.catch(() => {}).then(() => {
    if (entry.done) return;
    node.classList.add("is-hit");
    // Squash on contact, then pop and fade.
    entry.anims.push(proj.animate([
      { transform: "scale(1.1, 0.9)", opacity: 1 },
      { transform: "scale(1.45, 0.55)", opacity: 1, offset: 0.25 },
      { transform: "scale(0.9, 1.15)", opacity: 0.85, offset: 0.55 },
      { transform: "scale(1.25, 1.25)", opacity: 0 },
    ], { duration: IMPACT_MS, easing: "ease-out", fill: "forwards" }));
    // Burst ring.
    const ring = document.createElement("span");
    ring.className = "pvp-throw-ring";
    node.append(ring);
    entry.anims.push(ring.animate([
      { transform: "scale(0.2)", opacity: 0.9 },
      { transform: "scale(1.6)", opacity: 0 },
    ], { duration: IMPACT_MS, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }));
    // Splat particles.
    for (let i = 0; i < PARTICLES; i += 1) {
      const p = document.createElement("span");
      p.className = "pvp-throw-bit";
      node.append(p);
      const ang = (Math.PI * 2 * i) / PARTICLES + (i % 2 ? 0.3 : -0.2);
      const dist = 26 + (i % 3) * 12;
      const px = Math.cos(ang) * dist;
      const py = Math.sin(ang) * dist + (k === "pipe" ? -14 : 8);
      entry.anims.push(p.animate([
        { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
        { transform: `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) scale(${k === "pipe" ? 1.8 : 0.4})`, opacity: 0 },
      ], { duration: IMPACT_MS + (i % 3) * 25, easing: "cubic-bezier(.15,.8,.3,1)", fill: "forwards" }));
    }
    // Opponent avatar shake (transform only, cancelled on finish so styles restore).
    if (target.el && target.el.isConnected && typeof target.el.animate === "function") {
      entry.anims.push(target.el.animate([
        { transform: "translate(0,0) rotate(0)" },
        { transform: "translate(-4px,1px) rotate(-6deg) scale(0.92,1.06)" },
        { transform: "translate(4px,-1px) rotate(5deg)" },
        { transform: "translate(-3px,0) rotate(-3deg)" },
        { transform: "translate(2px,0) rotate(1deg)" },
        { transform: "translate(0,0) rotate(0)" },
      ], { duration: 280, easing: "ease-out" }));
    }
    if (proxy) {
      entry.anims.push(proxy.parentNode.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: IMPACT_MS + 60, easing: "ease-in", fill: "forwards" }));
    }
    return Promise.all(entry.anims.map((a) => a.finished.catch(() => {}))).then(() => finish(entry));
  });
}
