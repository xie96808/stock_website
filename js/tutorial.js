/**
 * Classic-mode newbie spotlight. Client-only (localStorage).
 * Does not change game math; blocks actions while open.
 */
import { getAuthState, showToast } from "./auth.js";

const LS_DONE = "sg_tutorial_v1";
const SS_FORCE = "sg_tutorial_force";
const PAD = 10;
const TRANS_MS = 240;

const STEPS = [
  {
    id: "kline",
    selectors: ["#kline-chart", ".chart-stage"],
    copy: "这是这段历史行情。先看趋势，再动手。",
  },
  {
    id: "day",
    selectors: ["#gameProgressDayLabel", "#gameProgressShell"],
    copy: "这里是第几天 / 共几天。每操作一次就推进一天。",
  },
  {
    id: "pnl",
    selectors: [".metric-stack", "#holdingPnlCard"],
    copy: "收益率是最终评分。仓位显示空仓或已全仓。红涨绿跌。",
  },
  {
    id: "actions",
    selectors: [".action-zone", "#buyBtn"],
    union: ["#buyBtn", "#sellBtn", "#holdBtn"],
    copy: "买入、卖出、观望。点一下就提交今日操作。",
  },
  {
    id: "done",
    selectors: [],
    copy: "教程结束。可以开玩了！随时可在「玩法选择」里再看一遍。",
  },
];

let root = null;
let step = 0;
let active = false;
let leaving = false;
let resizeObs = null;

function isDone() {
  try {
    return localStorage.getItem(LS_DONE) === "done";
  } catch {
    return false;
  }
}

export function markTutorialDone() {
  try {
    localStorage.setItem(LS_DONE, "done");
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(SS_FORCE);
  } catch {
    /* ignore */
  }
}

export function clearTutorialDone() {
  try {
    localStorage.removeItem(LS_DONE);
  } catch {
    /* ignore */
  }
}

export function requestTutorialReplay() {
  clearTutorialDone();
  try {
    sessionStorage.setItem(SS_FORCE, "1");
  } catch {
    /* ignore */
  }
}

function consumeForce() {
  try {
    if (sessionStorage.getItem(SS_FORCE) === "1") {
      sessionStorage.removeItem(SS_FORCE);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isTutorialBlocking() {
  return active;
}

function ensureDom() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "sgTutorial";
  root.className = "sg-tut";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "新手教程");
  root.innerHTML = `
    <div class="sg-tut__mask" data-tut-next></div>
    <div class="sg-tut__hole is-none" id="sgTutHole" aria-hidden="true"></div>
    <div class="sg-tut__bubble" id="sgTutBubble">
      <p class="sg-tut__copy" id="sgTutCopy"></p>
      <div class="sg-tut__actions">
        <span class="sg-tut__step" id="sgTutStep"></span>
        <div class="sg-tut__btns">
          <button type="button" class="sg-tut__btn" id="sgTutSkip">跳过</button>
          <button type="button" class="sg-tut__btn sg-tut__btn--primary" id="sgTutNext">下一步</button>
        </div>
      </div>
      <p class="sg-tut__hint">点任意处继续</p>
    </div>`;
  document.body.appendChild(root);
  root.querySelector("#sgTutSkip").addEventListener("click", (e) => {
    e.stopPropagation();
    finish(true);
  });
  root.querySelector("#sgTutNext").addEventListener("click", (e) => {
    e.stopPropagation();
    next();
  });
  root.addEventListener("click", (e) => {
    if (leaving) return;
    if (e.target.closest("#sgTutSkip") || e.target.closest("#sgTutNext")) return;
    next();
  });
  return root;
}

function unionRect(sels) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let any = false;
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    any = true;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!any) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function resolveTarget(spec) {
  if (spec.union && spec.union.length) {
    const u = unionRect(spec.union);
    if (u) return u;
  }
  for (const s of spec.selectors || []) {
    const el = document.querySelector(s);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return null;
}

function place() {
  const hole = document.getElementById("sgTutHole");
  const bubble = document.getElementById("sgTutBubble");
  const copy = document.getElementById("sgTutCopy");
  const stepEl = document.getElementById("sgTutStep");
  const nextBtn = document.getElementById("sgTutNext");
  if (!hole || !bubble || !copy) return;
  const spec = STEPS[step];
  copy.textContent = spec.copy;
  stepEl.textContent = `${step + 1} / ${STEPS.length}`;
  nextBtn.textContent = step >= STEPS.length - 1 ? "开始" : "下一步";

  // Scroll primary target into view so mobile sticky/offscreen modules get a real hole.
  const scrollSel = (spec.union && spec.union[0]) || (spec.selectors && spec.selectors[0]);
  if (scrollSel) {
    const el = document.querySelector(scrollSel);
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
      } catch {
        el.scrollIntoView(true);
      }
    }
  }

  const rect = resolveTarget(spec);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw <= 640;

  if (!rect) {
    hole.classList.add("is-none");
    hole.style.top = "0px";
    hole.style.left = "0px";
    hole.style.width = "0px";
    hole.style.height = "0px";
    bubble.classList.remove("is-sheet", "is-sheet-top");
    bubble.style.left = `${Math.max(16, (vw - 320) / 2)}px`;
    bubble.style.top = `${Math.max(80, vh * 0.36)}px`;
    bubble.style.bottom = "";
    bubble.style.width = "";
    return;
  }

  const t = Math.max(8, rect.top - PAD);
  const l = Math.max(8, rect.left - PAD);
  const w = Math.min(vw - l - 8, rect.width + PAD * 2);
  const h = Math.min(vh - t - 8, rect.height + PAD * 2);
  hole.classList.remove("is-none");
  hole.style.top = `${t}px`;
  hole.style.left = `${l}px`;
  hole.style.width = `${w}px`;
  hole.style.height = `${h}px`;

  // Measure bubble natural size (temporarily un-sheeted).
  bubble.classList.remove("is-sheet", "is-sheet-top");
  bubble.style.bottom = "";
  bubble.style.width = `${Math.min(340, vw - 32)}px`;
  bubble.style.left = "0px";
  bubble.style.top = "0px";
  const bh = bubble.offsetHeight || 130;
  const bw = Math.min(340, vw - 32);
  const holeMidY = t + h / 2;
  const preferAbove = holeMidY > vh * 0.45;

  if (narrow) {
    // Dock bubble to the opposite end from the hole so it never covers the module.
    bubble.classList.add("is-sheet");
    bubble.style.width = "";
    bubble.style.left = "";
    if (preferAbove) {
      bubble.classList.add("is-sheet-top");
      bubble.style.top = "";
      bubble.style.bottom = "";
    } else {
      bubble.classList.remove("is-sheet-top");
      bubble.style.top = "";
      bubble.style.bottom = "";
    }
    return;
  }

  let left = l + w / 2 - bw / 2;
  left = Math.max(16, Math.min(vw - bw - 16, left));
  let top;
  if (preferAbove) {
    top = Math.max(16, t - 12 - bh);
    if (top + bh > t - 4) {
      // not enough room above — try below
      top = Math.min(vh - bh - 16, t + h + 12);
    }
  } else {
    top = t + h + 12;
    if (top + bh > vh - 16) {
      top = Math.max(16, t - 12 - bh);
    }
  }
  // Final clamp + overlap avoidance: if still intersecting hole, push fully above or below.
  const overlaps = !(top + bh <= t + 2 || top >= t + h - 2);
  if (overlaps) {
    if (t > bh + 24) top = t - 12 - bh;
    else top = Math.min(vh - bh - 16, t + h + 12);
  }
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.width = `${bw}px`;
  bubble.style.bottom = "";
}


function lockGame(on) {
  const screen = document.getElementById("gameScreen");
  if (screen) screen.classList.toggle("is-tutorial-lock", on);
  ["buyBtn", "sellBtn", "holdBtn", "finishBtn", "rewindBtn", "fastForwardBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (on) {
      el.dataset.tutPrevDisabled = el.disabled ? "1" : "0";
      el.disabled = true;
    } else if (el.dataset.tutPrevDisabled != null) {
      el.disabled = el.dataset.tutPrevDisabled === "1";
      delete el.dataset.tutPrevDisabled;
    }
  });
}

function next() {
  if (!active || leaving) return;
  if (step >= STEPS.length - 1) {
    finish(true);
    return;
  }
  step += 1;
  place();
  requestAnimationFrame(() => place());
}

function finish(markDone) {
  if (!active || leaving) return;
  leaving = true;
  if (markDone) markTutorialDone();
  // Unlock immediately so game logic is never blocked by the fade-out.
  active = false;
  lockGame(false);
  if (resizeObs) {
    resizeObs.disconnect();
    resizeObs = null;
  }
  window.removeEventListener("resize", place);
  window.removeEventListener("orientationchange", place);
  const el = ensureDom();
  el.classList.add("is-leaving");
  window.setTimeout(() => {
    el.hidden = true;
    el.classList.remove("is-leaving");
    leaving = false;
  }, TRANS_MS);
}

/**
 * @param {{ force?: boolean, isResume?: boolean, gameKind?: string }} opts
 */
export function maybeOfferClassicTutorial(opts = {}) {
  const force = !!opts.force || consumeForce();
  if (opts.isResume && !force) return false;
  const kind = opts.gameKind || "classic";
  if (kind !== "classic" && !force) return false;
  const auth = getAuthState();
  if (!auth?.user || auth.status !== "authenticated") return false;
  if (isDone() && !force) return false;
  return startTutorial({ force: true });
}

export function startTutorial() {
  if (active) return true;
  const game = document.getElementById("gameScreen");
  if (!game || !game.classList.contains("active")) return false;
  ensureDom();
  step = 0;
  active = true;
  leaving = false;
  lockGame(true);
  root.hidden = false;
  root.classList.remove("is-leaving");
  place();
  requestAnimationFrame(() => place());
  window.addEventListener("resize", place);
  window.addEventListener("orientationchange", place);
  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => place());
    resizeObs.observe(document.getElementById("gameScreen") || document.body);
  }
  return true;
}

/** Mode-picker / settings: schedule replay or run now if in game. */
export function onReplayTutorialClick() {
  requestTutorialReplay();
  const game = document.getElementById("gameScreen");
  if (game && game.classList.contains("active")) {
    startTutorial();
    showToast("已重新打开新手教程", "success");
    return;
  }
  showToast("下次「开一局」进入对局时会再看一遍", "success");
}

export function initTutorialUi() {
  const modes = document.getElementById("playModes");
  if (modes && !document.getElementById("tutReplayBtn")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tutReplayBtn";
    btn.className = "tut-replay-link";
    btn.textContent = "再看新手教程";
    btn.addEventListener("click", onReplayTutorialClick);
    const back = modes.querySelector(".hub-back");
    if (back && back.nextSibling) modes.insertBefore(btn, back.nextSibling);
    else modes.prepend(btn);
  }
  // settings panel hook (optional)
  const settings = document.getElementById("authSettingsPanel");
  if (settings && !document.getElementById("tutReplaySettingsBtn")) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = "tutReplaySettingsBtn";
    b.className = "auth-secondary ctl ctl-secondary";
    b.style.marginTop = "8px";
    b.innerHTML = '<span class="ctl-label">再看新手教程</span>';
    b.addEventListener("click", onReplayTutorialClick);
    settings.appendChild(b);
  }
}

// Expose for Playwright / console
if (typeof window !== "undefined") {
  window.__stockgameTutorial = {
    start: startTutorial,
    maybe: maybeOfferClassicTutorial,
    replay: onReplayTutorialClick,
    clear: clearTutorialDone,
    isBlocking: isTutorialBlocking,
    isDone,
    STEPS,
  };
}
