/**
 * 出场特效 runner: plays one effect centred on an element (a PvP seat avatar, or a preview box in the shop) on a fixed
 * overlay layer. Web Animations API, transforms / opacity only; the layer removes itself when the effect ends.
 * `prefers-reduced-motion` gets a short still fade instead of the motion.
 */
import { inkBlobPath, droplets, rayPath, bladePath, rainDrops, isEntranceId } from "./entrance-fx-pure.js";

const STAGE = 280;
const NS = "http://www.w3.org/2000/svg";
const INK = "#2b2622";

function reduced() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

function stageSvg(layer) {
  return svgEl("svg", {
    viewBox: `${-STAGE / 2} ${-STAGE / 2} ${STAGE} ${STAGE}`, width: STAGE, height: STAGE, class: "fx-svg", "aria-hidden": "true",
  }, layer);
}

const anim = (el, frames, opts) => el.animate(frames, { fill: "forwards", ...opts });

/** Each builder draws its parts into `svg` and returns { anims, ms }. */
const BUILDERS = {
  ink_splash(svg) {
    const g = svgEl("g", {}, svg);
    svgEl("path", { d: inkBlobPath(9, 54), fill: INK, opacity: ".9" }, g);
    svgEl("path", { d: inkBlobPath(21, 30), fill: "#f6eddc", opacity: ".16" }, g);
    const anims = [
      anim(g, [
        { transform: "scale(.15)", opacity: 0 },
        { transform: "scale(1.1)", opacity: 1, offset: 0.3 },
        { transform: "scale(1.5)", opacity: 0.9, offset: 0.62 },
        { transform: "scale(1.9)", opacity: 0 },
      ], { duration: 1500, easing: "cubic-bezier(.2,.8,.3,1)" }),
    ];
    droplets(5, 11, 70, 125).forEach((d, i) => {
      const c = svgEl("circle", { r: d.r, fill: INK }, svg);
      anims.push(anim(c, [
        { transform: "translate(0px,0px) scale(.3)", opacity: 0.95 },
        { transform: `translate(${d.x}px,${d.y}px) scale(1)`, opacity: 0.95, offset: 0.45 },
        { transform: `translate(${d.x * 1.08}px,${d.y * 1.08 + 8}px) scale(.8)`, opacity: 0 },
      ], { duration: 1300, delay: 40 + i * 18, easing: "cubic-bezier(.1,.7,.3,1)" }));
    });
    return { anims, ms: 1700 };
  },

  seal_stamp(svg) {
    const g = svgEl("g", {}, svg);
    svgEl("rect", { x: -44, y: -44, width: 88, height: 88, rx: 11, fill: "#d63b25", stroke: INK, "stroke-width": 3 }, g);
    svgEl("rect", { x: -35, y: -35, width: 70, height: 70, rx: 6, fill: "none", stroke: "#fff4e0", "stroke-width": 1.8, opacity: ".85" }, g);
    const t = svgEl("text", {
      x: 0, y: 19, "text-anchor": "middle", "font-size": 56, "font-weight": 800, fill: "#fff4e0",
      "font-family": "KaiTi, STKaiti, 'Kaiti SC', serif",
    }, g);
    t.textContent = "战";
    const ring = svgEl("circle", { r: 40, fill: "none", stroke: "#d63b25", "stroke-width": 4 }, svg);
    const anims = [
      anim(g, [
        { transform: "scale(3) rotate(-14deg)", opacity: 0 },
        { transform: "scale(1) rotate(-6deg)", opacity: 1, offset: 0.22 },
        { transform: "scale(1.06) rotate(-6deg)", opacity: 1, offset: 0.3 },
        { transform: "scale(1) rotate(-6deg)", opacity: 1, offset: 0.4 },
        { transform: "scale(1) rotate(-6deg)", opacity: 1, offset: 0.8 },
        { transform: "scale(1.04) rotate(-6deg)", opacity: 0 },
      ], { duration: 1500, easing: "cubic-bezier(.2,1.2,.4,1)" }),
      anim(ring, [
        { transform: "scale(.8)", opacity: 0, offset: 0 },
        { transform: "scale(.9)", opacity: 0.9, offset: 0.22 },
        { transform: "scale(2.6)", opacity: 0 },
      ], { duration: 900, easing: "ease-out" }),
    ];
    const shake = document.getElementById("pvpBattleTop");
    if (shake && shake.animate) {
      anims.push(shake.animate([
        { transform: "translate(0,0)" }, { transform: "translate(0,3px)", offset: 0.1 }, { transform: "translate(-2px,-2px)", offset: 0.22 },
        { transform: "translate(2px,1px)", offset: 0.34 }, { transform: "translate(0,0)" },
      ], { duration: 360, delay: 200 }));
    }
    return { anims, ms: 1650 };
  },

  leek_rain(svg) {
    const anims = [];
    rainDrops(13, 18).forEach((d) => {
      const g = svgEl("g", {}, svg);
      svgEl("path", { d: bladePath(d.h, d.h * 0.24), fill: "#58b955", stroke: INK, "stroke-width": 1.2, "stroke-linejoin": "round" }, g);
      svgEl("path", { d: `M0 ${-d.h * 0.12}L0 ${-d.h * 0.84}`, stroke: "#c9f0a2", "stroke-width": d.h * 0.05, "stroke-linecap": "round" }, g);
      anims.push(anim(g, [
        { transform: `translate(${d.x}px,-150px) rotate(${d.rot}deg)`, opacity: 0 },
        { transform: `translate(${d.x + d.sway * 0.4}px,-90px) rotate(${d.rot + 20}deg)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${d.x + d.sway}px,70px) rotate(${d.rot + 120}deg)`, opacity: 1, offset: 0.82 },
        { transform: `translate(${d.x + d.sway * 1.2}px,110px) rotate(${d.rot + 160}deg)`, opacity: 0 },
      ], { duration: d.dur, delay: d.delay, easing: "ease-in" }));
    });
    return { anims, ms: 2150 };
  },

  gold_burst(svg) {
    const rays = svgEl("g", {}, svg);
    svgEl("path", { d: rayPath(14, 128), fill: "#f6c93a", opacity: ".9" }, rays);
    svgEl("path", { d: rayPath(14, 96, 2.2), fill: "#fff3b0" }, rays);
    const glow = svgEl("circle", { r: 34, fill: "#ffe27a", opacity: ".75" }, svg);
    const anims = [
      anim(rays, [
        { transform: "scale(.2) rotate(0deg)", opacity: 0 },
        { transform: "scale(1) rotate(28deg)", opacity: 1, offset: 0.32 },
        { transform: "scale(1.25) rotate(58deg)", opacity: 0 },
      ], { duration: 1400, easing: "cubic-bezier(.2,.8,.3,1)" }),
      anim(glow, [
        { transform: "scale(.3)", opacity: 0 },
        { transform: "scale(1.5)", opacity: 0.85, offset: 0.25 },
        { transform: "scale(2.4)", opacity: 0 },
      ], { duration: 1100, easing: "ease-out" }),
    ];
    droplets(17, 10, 55, 120).forEach((d, i) => {
      const s = svgEl("path", { d: "M0-7L2-2L7 0L2 2L0 7L-2 2L-7 0L-2-2Z", fill: "#fff3b0", stroke: "#d9a521", "stroke-width": ".9" }, svg);
      anims.push(anim(s, [
        { transform: "translate(0,0) scale(.2) rotate(0deg)", opacity: 0 },
        { transform: `translate(${d.x * 0.7}px,${d.y * 0.7}px) scale(${0.8 + d.r / 5}) rotate(90deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${d.x}px,${d.y}px) scale(.3) rotate(180deg)`, opacity: 0 },
      ], { duration: 1200, delay: 60 + i * 30, easing: "ease-out" }));
    });
    return { anims, ms: 1550 };
  },
};

/** Play `id` centred on `anchor` (an element). Resolves when it is over. Unknown ids / missing anchors do nothing. */
export function playEntranceFx(id, anchor) {
  if (!isEntranceId(id) || !anchor || !anchor.isConnected || typeof document === "undefined") return Promise.resolve(false);
  const rect = anchor.getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return Promise.resolve(false);
  const layer = document.createElement("div");
  layer.className = `fx-layer fx-layer--${id}`;
  layer.setAttribute("aria-hidden", "true");
  layer.style.left = `${rect.left + rect.width / 2}px`;
  layer.style.top = `${rect.top + rect.height / 2}px`;
  document.body.append(layer);
  const svg = stageSvg(layer);

  if (reduced() || typeof layer.animate !== "function") {
    // Still, calm: just a soft ring that fades.
    svgEl("circle", { r: 46, fill: "none", stroke: id === "gold_burst" ? "#f0bd2d" : id === "leek_rain" ? "#58b955" : id === "seal_stamp" ? "#d63b25" : INK, "stroke-width": 5, opacity: ".8" }, svg);
    return new Promise((resolve) => {
      window.setTimeout(() => { layer.remove(); resolve(true); }, 700);
    });
  }

  const { anims, ms } = BUILDERS[id](svg);
  return new Promise((resolve) => {
    window.setTimeout(() => {
      for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } }
      layer.remove();
      resolve(true);
    }, ms);
  });
}
