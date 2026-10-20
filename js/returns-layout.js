/**
 * Phone in-game layout for the key return figures (item: 收益率 visible without scrolling).
 *
 * Two candidate layouts, chosen by a quick toggle (Bill picks one later):
 *   A "card"  — 收益率 + 仓位 go into the top progress card, replacing 「市场在等待你的判断…」.
 *   B "strip" — a compact sticky strip on top of the fixed trade bar (收益率 · 仓位 · 当日涨跌).
 * Both fold the two hint lines into one line with an ⓘ that expands them, and slim the 快进 bar.
 * Trade buttons keep their size. Desktop (>900px) is unchanged.
 *
 * Toggle: ?rl=a | ?rl=b | ?rl=off (remembered in localStorage "sg_returns_layout").
 * Values are mirrored from the existing board nodes (#holdingPnl / #positionStatus / #dailyReturn),
 * so every solo mode (classic, 一把梭, 生存, 今日挑战, 残局) gets it without touching their code.
 */

const LS_KEY = "sg_returns_layout";
const LAYOUTS = new Set(["a", "b", "off"]);
export const DEFAULT_RETURNS_LAYOUT = "a";

export function resolveReturnsLayout(search = "", stored = null) {
  let q = null;
  try { q = new URLSearchParams(search || "").get("rl"); } catch { q = null; }
  const pick = String(q || stored || "").toLowerCase();
  return LAYOUTS.has(pick) ? pick : DEFAULT_RETURNS_LAYOUT;
}

/** Tone for the mirrored value from the board node's class. */
export function toneOf(className = "") {
  const c = ` ${className} `;
  if (c.includes(" positive ")) return "positive";
  if (c.includes(" negative ")) return "negative";
  if (c.includes(" locked ")) return "locked";
  return "neutral";
}

/** Apply a layout. Only an explicit choice (?rl=…) is remembered, so the default can still change later. */
export function setReturnsLayout(layout, { persist = false } = {}) {
  const value = LAYOUTS.has(layout) ? layout : DEFAULT_RETURNS_LAYOUT;
  if (persist) {
    try { localStorage.setItem(LS_KEY, value); } catch { /* private mode */ }
  }
  document.documentElement.dataset.returnsLayout = value;
  return value;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildCardSlot() {
  const box = el("span", "rl-card");
  box.id = "rlCard";
  box.setAttribute("aria-live", "polite");
  box.append(
    el("span", "rl-k", "收益率"),
    Object.assign(el("strong", "rl-v neutral", "0.00%"), { id: "rlCardPnl" }),
    Object.assign(el("span", "board-chip rl-chip neutral", "空仓"), { id: "rlCardPos" }),
    Object.assign(el("span", "rl-sub"), {}),
  );
  const sub = box.lastChild;
  sub.append(el("span", "rl-k", "当日涨跌"), Object.assign(el("span", "rl-v neutral", "--"), { id: "rlCardDaily" }));
  return box;
}

function buildStrip() {
  const box = el("div", "rl-strip");
  box.id = "rlStrip";
  box.setAttribute("aria-live", "polite");
  const item = (k, id, cls = "rl-v neutral") => {
    const w = el("span", "rl-item");
    w.append(el("span", "rl-k", k), Object.assign(el("strong", cls, "--"), { id }));
    return w;
  };
  box.append(item("收益率", "rlStripPnl"), item("仓位", "rlStripPos", "board-chip rl-chip neutral"), item("当日涨跌", "rlStripDaily"));
  return box;
}

function buildHintToggle() {
  const b = el("button", "rl-info");
  b.type = "button";
  b.id = "rlHintToggle";
  b.setAttribute("aria-label", "操作提示");
  b.setAttribute("aria-expanded", "false");
  b.append(el("span", "", "i"));
  b.addEventListener("click", () => {
    const open = !document.documentElement.classList.contains("rl-hints-open");
    document.documentElement.classList.toggle("rl-hints-open", open);
    b.setAttribute("aria-expanded", open ? "true" : "false");
  });
  return b;
}

function mirror(src, targets, { chip = false } = {}) {
  if (!src) return;
  const paint = () => {
    const text = (src.textContent || "").trim() || "--";
    const tone = toneOf(src.className);
    for (const t of targets) {
      if (!t) continue;
      t.textContent = text;
      t.className = chip ? `board-chip rl-chip ${tone}` : `rl-v ${tone}`;
    }
  };
  paint();
  new MutationObserver(paint).observe(src, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
}

let started = false;

export function initReturnsLayout(win = window) {
  if (started || typeof document === "undefined") return;
  started = true;
  let stored = null;
  try { stored = win.localStorage.getItem(LS_KEY); } catch { stored = null; }
  const search = win.location?.search || "";
  const layout = resolveReturnsLayout(search, stored);
  let explicit = false;
  try { explicit = LAYOUTS.has(String(new URLSearchParams(search).get("rl") || "").toLowerCase()); } catch { explicit = false; }
  setReturnsLayout(layout, { persist: explicit });

  const meta = document.querySelector("#gameProgressShell .game-progress-meta");
  const mood = document.getElementById("progressMood");
  const zone = document.querySelector("#gameScreen .action-zone");
  if (!meta || !zone) return;
  const card = buildCardSlot();
  if (mood) mood.after(card); else meta.append(card);
  const strip = buildStrip();
  zone.prepend(strip);
  const hint = document.getElementById("actionHint");
  if (hint) {
    // Wrapper is display:contents unless layout a/b is on, so desktop and rl=off are untouched.
    const row = el("span", "rl-hint-row");
    hint.before(row);
    row.append(hint, buildHintToggle());
  }

  mirror(document.getElementById("holdingPnl"), [document.getElementById("rlCardPnl"), document.getElementById("rlStripPnl")]);
  mirror(document.getElementById("positionStatus"), [document.getElementById("rlCardPos"), document.getElementById("rlStripPos")], { chip: true });
  mirror(document.getElementById("dailyReturn"), [document.getElementById("rlCardDaily"), document.getElementById("rlStripDaily")]);
}
