/**
 * 幸运转盘 modal (client). Lazy-loaded from jiu-coin.js when GET /me/jiu-coin carries `wheel.enabled`.
 *
 * - Everything on the wheel (labels, colours' order, odds, free spins) is drawn from GET /me/lucky-wheel.
 * - POST /me/lucky-wheel/spin decides the result; the animation always lands on the server `sector`
 *   (θ = 360·n − (45·k + j), j = server landJitterDeg). No client randomness.
 * - One Idempotency-Key per spin attempt; the key is kept after network errors so a retry replays instead of re-spinning.
 */
import { api, getAuthState, showToast } from "./auth.js";
import { openCtlOverlay, closeCtlOverlay } from "./controls.js";
import * as P from "./lucky-wheel-pure.js";

const V = P.LW_ASSET_V;
const ASSET_DIR = "assets/lucky-wheel/";

const S = {
  root: null,
  els: {},
  state: null, // last GET /me/lucky-wheel payload (enabled)
  configVersion: null,
  phase: "idle", // idle | loading | spinning | popup
  angle: 0, // current rest angle (deg, normalised)
  pendingKey: null,
  session: 0, // bumped to cancel in-flight spins (logout, forced close)
  raf: 0,
  pAng: 0,
  lastTick: null,
  fx: null,
  hooks: { onChange: null },
  clock: 0,
  sectorsKey: "",
  preloaded: false,
};

/* ------------------------------------------------------------------ helpers */

const prefersReduced = () => {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
};

const url = (name, ext = "webp") => `${ASSET_DIR}${name}.${ext}?v=${V}`;
const url2x = (name) => `${ASSET_DIR}${name}@2x.webp?v=${V}`;
function imgHtml(name, cls = "", extra = "") {
  return `<img class="${cls}" src="${url(name)}" srcset="${url2x(name)} 2x" alt="" draggable="false" decoding="async" ${extra}>`;
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const $ = (sel, root = S.root) => root.querySelector(sel);

const PRELOAD = [
  "lw-go-press", "lw-go-disabled", "lw-go-loading", "lw-hub-press", "lw-hub-disabled", "lw-hub-spinning",
  "lw-close-press", "lw-glow", "lw-flash", "lw-result-card", "lw-prize-1", "lw-prize-2", "lw-prize-3", "lw-prize-4",
  "lw-prize-5", "lw-prize-ticket-2", "lw-prize-ticket-3", "lw-prize-spin",
];
export function preloadLuckyWheelArt() {
  if (S.preloaded) return;
  S.preloaded = true;
  const go = () => {
    for (const n of PRELOAD) {
      const i = new Image();
      i.decoding = "async";
      i.src = url2x(n);
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

const sectors = () => (S.state?.sectors ? [...S.state.sectors].sort((a, b) => a.pos - b.pos) : []);
const remaining = () => Number(S.state?.freeSpins?.total ?? 0);

/* ------------------------------------------------------------------ DOM */

function ensureDom() {
  if (S.root) return S.root;
  const root = el(`<div class="lw-modal" id="luckyWheelModal" hidden aria-hidden="true">
    <div class="lw-dialog" role="dialog" aria-modal="true" aria-labelledby="lwTitle"><div class="lw-fit" id="lwFit">
      <div class="lw-ribbon">${imgHtml("lw-ribbon")}<h2 class="lw-title" id="lwTitle">幸运转盘</h2></div>
      <button type="button" class="lw-close" id="lwClose" aria-label="关闭"><span></span></button>
      <div class="lw-stage is-loading" id="lwStage">
        <div class="lw-disc" id="lwDisc">
          <div class="lw-fills"></div>
          ${imgHtml("lw-face", "lw-face")}
          ${imgHtml("lw-glow", "lw-glow")}
          <div class="lw-flash-pos" id="lwFlashPos"><div class="lw-flash">${imgHtml("lw-flash")}</div></div>
          <div class="lw-hits" id="lwHits"></div>
          <div class="lw-labels" id="lwLabels"></div>
        </div>
        ${imgHtml("lw-rim", "lw-rim")}
        ${imgHtml("lw-rim-light", "lw-rimlight")}
        <div class="lw-pointer" id="lwPointer">${imgHtml("lw-pointer")}</div>
        <button type="button" class="lw-hub" id="lwHub" data-state="default" aria-label="启动转盘"></button>
        <div class="lw-error" id="lwError" hidden><div id="lwErrorMsg">加载失败</div><button type="button" id="lwRetry">重试</button></div>
      </div>
      <div class="lw-free" id="lwFree"><span class="lw-free-inner">免费次数：<span class="lw-free-n" id="lwFreeN">–</span>次</span></div>
      <button type="button" class="lw-go" id="lwGo" data-state="loading" disabled><span class="lw-go-label" id="lwGoLabel">载入中…</span></button>
      <p class="lw-reset" id="lwReset" aria-live="polite"></p>
      <button type="button" class="lw-odds-btn" id="lwOddsBtn" aria-expanded="false">概率说明</button>
    </div></div>
    <div class="lw-odds" id="lwOdds" hidden role="dialog" aria-label="概率说明"></div>
    <div class="lw-pop" id="lwPop" hidden role="dialog" aria-modal="true" aria-labelledby="lwPopTitle"></div>
    <canvas class="lw-fx" id="lwFx" hidden aria-hidden="true"></canvas>
    <div id="lwLive" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)" aria-live="assertive"></div>
  </div>`);
  document.body.appendChild(root);
  S.root = root;
  S.els = {
    dialog: $(".lw-dialog"), fit: $("#lwFit"), stage: $("#lwStage"), disc: $("#lwDisc"), hits: $("#lwHits"), labels: $("#lwLabels"),
    pointer: $("#lwPointer"), hub: $("#lwHub"), go: $("#lwGo"), goLabel: $("#lwGoLabel"), free: $("#lwFree"),
    freeN: $("#lwFreeN"), reset: $("#lwReset"), close: $("#lwClose"), odds: $("#lwOdds"), oddsBtn: $("#lwOddsBtn"),
    pop: $("#lwPop"), err: $("#lwError"), errMsg: $("#lwErrorMsg"), retry: $("#lwRetry"), fx: $("#lwFx"),
    flashPos: $("#lwFlashPos"), live: $("#lwLive"),
  };
  wire();
  return root;
}

function wire() {
  const { go, hub, close, oddsBtn, retry, odds, pop } = S.els;
  const press = (node, on) => {
    if (!node || node.disabled || node.getAttribute("aria-disabled") === "true") return;
    const st = node.dataset.state;
    if (on) {
      if (st === "disabled" || st === "loading") return;
      node.dataset.prev = st || "default";
      node.dataset.state = "press";
    } else if (node.dataset.state === "press") {
      node.dataset.state = node.dataset.prev || "default";
    }
  };
  for (const node of [go, hub, close, oddsBtn]) {
    node.addEventListener("pointerdown", () => press(node, true));
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) node.addEventListener(ev, () => press(node, false));
  }
  go.addEventListener("click", onSpinClick);
  hub.addEventListener("click", onSpinClick);
  close.addEventListener("click", () => requestClose());
  oddsBtn.addEventListener("click", () => toggleOdds());
  retry.addEventListener("click", () => loadState({ force: true }));
  S.root.addEventListener("click", (e) => {
    if (e.target === S.root) {
      if (!odds.hidden && odds.classList.contains("is-open")) toggleOdds(false);
      else requestClose();
    }
  });
  pop.addEventListener("click", (e) => {
    if (e.target === pop && S.phase === "popup") closePop();
  });
  S.root.addEventListener("keydown", onKeydown);
  document.addEventListener("stockgame:auth-changed", () => {
    if (!getAuthState().user) forceClose();
  });
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", scheduleFit);
}

/**
 * Very short / narrow viewports: scale the dialog (and the pop-up) down about their centre so every control stays reachable.
 * transform (not CSS zoom) keeps hit-testing and getBoundingClientRect consistent. The modal is a centred flex box with
 * overflow hidden, so an oversized layout box overflows symmetrically and the scaled result is centred.
 */
function fitView() {
  if (!S.root || S.root.hidden) return;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const { fit } = S.els;
  const s = Math.min(1, (vh - 12) / (fit.offsetHeight + 6), (vw - 12) / Math.max(1, fit.offsetWidth));
  fit.style.transform = s < 0.995 ? `scale(${s.toFixed(3)})` : "";
  const wrap = S.els.pop.hidden ? null : $(".lw-pop-wrap", S.els.pop);
  if (wrap) {
    const jackpot = S.els.pop.classList.contains("is-jackpot");
    const up = wrap.offsetHeight / 2 + (jackpot ? 150 : 6);
    const down = wrap.offsetHeight / 2 + 6;
    const ps = Math.min(1, (vh - 10) / (2 * Math.max(up, down)), (vw - 10) / Math.max(1, wrap.offsetWidth + 10));
    wrap.style.transform = ps < 0.995 ? `scale(${ps.toFixed(3)})` : "";
    wrap.style.transformOrigin = "50% 50%";
  }
}
let fitTimer = 0;
function scheduleFit() {
  window.clearTimeout(fitTimer);
  fitTimer = window.setTimeout(fitView, 60);
}

function onKeydown(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    if (!S.els.pop.hidden && S.phase === "popup") closePop();
    else if (!S.els.odds.hidden && S.els.odds.classList.contains("is-open")) toggleOdds(false);
    else requestClose();
    return;
  }
  if (e.key !== "Tab") return;
  const scope = !S.els.pop.hidden ? S.els.pop : !S.els.odds.hidden ? S.els.odds : S.els.dialog;
  const nodes = [...scope.querySelectorAll("button:not([disabled])")].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!nodes.length) {
    e.preventDefault();
    return;
  }
  const i = nodes.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) {
    e.preventDefault();
    nodes[nodes.length - 1].focus();
  } else if (!e.shiftKey && i === nodes.length - 1) {
    e.preventDefault();
    nodes[0].focus();
  }
}

/* ------------------------------------------------------------------ render from server data */

function renderSectors() {
  const list = sectors();
  const key = JSON.stringify([S.state?.configVersion, list.map((s) => [s.pos, s.kind, s.amount, s.item, s.qty, s.art, s.isJackpot])]);
  if (key === S.sectorsKey) return;
  S.sectorsKey = key;
  const { hits, labels } = S.els;
  hits.textContent = "";
  labels.textContent = "";
  for (const s of list) {
    const k = s.pos;
    const hit = document.createElement("div");
    hit.className = "lw-hit";
    hit.dataset.sector = String(k);
    hit.style.transform = `rotate(${k * P.LW_STEP}deg)`;
    hits.appendChild(hit);
    const lab = P.sectorLabel(s);
    const sec = document.createElement("div");
    const cls = ["lw-sec"];
    if (s.isJackpot) cls.push("is-big");
    if (lab.len >= 4) cls.push("is-long");
    if (s.kind !== "jiu_coin") cls.push("is-text");
    sec.className = cls.join(" ");
    sec.dataset.sector = String(k);
    sec.style.transform = `rotate(${k * P.LW_STEP}deg)`;
    sec.setAttribute("role", "img");
    sec.setAttribute("aria-label", P.sectorAria(s));
    sec.innerHTML = `${imgHtml(P.artFile(s), "lw-sec-ico")}<div class="lw-sec-txt">${esc(lab.text)}</div>`;
    labels.appendChild(sec);
  }
  // sector colours come from the CSS vars (positions 0..7); expose as inline for robustness
  list.forEach((s) => S.els.stage.style.setProperty(`--lw-s${s.pos}`, P.LW_SECTOR_COLORS[s.pos]));
  renderOdds();
  // warm the jackpot pack (only when a jackpot sector exists)
  if (list.some((s) => s.isJackpot)) warmFx();
}

function renderOdds() {
  const list = sectors();
  const pct = new Map((S.state?.odds || []).map((o) => [o.pos, o.pct]));
  const rows = list
    .map((s) => {
      const p = pct.get(s.pos);
      const shown = p == null ? "" : `${Number.isInteger(p) ? p : Math.round(p * 100) / 100}%`;
      const name = s.kind === "jiu_coin" ? `${s.amount} 韭币${s.isJackpot ? "（大奖）" : ""}` : P.sectorAria(s);
      return `<li><span class="lw-chip" style="background:${P.LW_SECTOR_COLORS[s.pos]}"></span><span class="lw-odds-name">${esc(name)}</span><span class="lw-odds-pct">${shown}</span></li>`;
    })
    .join("");
  const hasItem = list.some((s) => s.kind === "item");
  const hasSpin = list.some((s) => s.kind === "spin");
  const notes = [
    "每日 0 点（北京时间）刷新免费次数。每次转盘由服务器独立抽取，结果与动画无关，也不受之前结果影响。",
    hasItem ? "后悔券：放入背包，可在单人局反悔时使用。" : "",
    hasSpin ? "再转一次：额外获得 1 次转盘机会（每日有上限，超出时折算为韭币）。" : "",
  ].filter(Boolean);
  S.els.odds.innerHTML = `<h3>概率说明</h3><ul>${rows}</ul>${notes.map((n) => `<p>${esc(n)}</p>`).join("")}<button type="button" class="lw-odds-close" id="lwOddsClose">知道了</button>`;
  const c = $("#lwOddsClose");
  c.addEventListener("pointerdown", () => (c.dataset.state = "press"));
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) c.addEventListener(ev, () => (c.dataset.state = "default"));
  c.addEventListener("click", () => toggleOdds(false));
}

function toggleOdds(force) {
  const { odds, oddsBtn } = S.els;
  const open = force == null ? !odds.classList.contains("is-open") : !!force;
  if (open) {
    if (!S.state?.odds) return;
    odds.hidden = false;
    void odds.offsetWidth;
    odds.classList.add("is-open");
    oddsBtn.setAttribute("aria-expanded", "true");
    $("#lwOddsClose").focus?.();
  } else {
    odds.classList.remove("is-open");
    oddsBtn.setAttribute("aria-expanded", "false");
    window.setTimeout(() => {
      if (!odds.classList.contains("is-open")) odds.hidden = true;
    }, 200);
    if (!S.els.pop.hidden) return;
    try { oddsBtn.focus(); } catch { /* ignore */ }
  }
}

function setGo(state, label) {
  const { go, hub, goLabel } = S.els;
  go.dataset.state = state;
  go.disabled = state === "disabled" || state === "loading";
  hub.dataset.state = state === "default" ? "default" : state;
  hub.disabled = go.disabled;
  goLabel.textContent = label;
  go.setAttribute("aria-busy", state === "loading" ? "true" : "false");
}

function renderControls() {
  const left = remaining();
  const { freeN, free, reset } = S.els;
  if (freeN.textContent !== String(left)) {
    freeN.textContent = String(left);
    free.classList.remove("is-bump");
    void free.offsetWidth;
    if (S.phase !== "loading") free.classList.add("is-bump");
  }
  if (S.phase === "idle") {
    if (left > 0) setGo("default", "启动转盘");
    else setGo("disabled", "明日再来");
  }
  scheduleFit();
  if (S.phase === "idle") S.els.close.removeAttribute("aria-disabled");
  const cd = P.resetCountdownText(S.state?.nextResetAt);
  reset.textContent = left > 0 ? `每日 0 点（北京时间）刷新 · ${cd}` : `今日次数已用完 · ${cd}`;
}

function tickClock() {
  window.clearInterval(S.clock);
  S.clock = window.setInterval(() => {
    if (S.root.hidden) return;
    const t = Date.parse(S.state?.nextResetAt || "");
    if (Number.isFinite(t) && t <= Date.now() && S.phase === "idle") loadState({ force: true, quiet: true });
    else if (S.phase === "idle") renderControls();
  }, 30000);
}

/* ------------------------------------------------------------------ data */

async function loadState({ force = false, quiet = false } = {}) {
  const sess = S.session;
  if (!quiet) {
    S.els.err.hidden = true;
    if (!S.state || force) S.els.stage.classList.add("is-loading");
    if (!S.state) setGo("loading", "载入中…");
  }
  try {
    const { data } = await api("/me/lucky-wheel");
    if (sess !== S.session) return null;
    if (!data?.enabled) {
      S.state = null;
      return { enabled: false };
    }
    S.state = data;
    renderSectors();
    S.els.stage.classList.remove("is-loading");
    S.els.err.hidden = true;
    if (S.phase === "idle") renderControls();
    notify();
    return { enabled: true };
  } catch (e) {
    if (sess !== S.session) return null;
    if (!S.state) {
      S.els.errMsg.textContent = e?.status === 401 ? "请先登录" : "转盘载入失败";
      S.els.err.hidden = false;
      setGo("disabled", "启动转盘");
    }
    return { enabled: null, error: e };
  }
}

function notify() {
  try {
    S.hooks.onChange?.({
      freeSpins: S.state?.freeSpins || null,
      balance: S.state?.balance,
      nextResetAt: S.state?.nextResetAt,
    });
  } catch {
    /* ignore hook errors */
  }
}

async function postSpin(key) {
  const auth = getAuthState();
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  let timer = 0;
  const timeout = new Promise((_, rej) => {
    timer = window.setTimeout(() => {
      try { ctrl?.abort(); } catch { /* ignore */ }
      rej(new Error("请求超时"));
    }, P.LW_T.requestTimeout);
  });
  const headers = { Accept: "application/json", "Idempotency-Key": key, "Content-Type": "application/json" };
  if (auth.csrfToken) headers["X-CSRF-Token"] = auth.csrfToken;
  const run = (async () => {
    const res = await fetch("/api/v1/me/lucky-wheel/spin", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: "{}",
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.error?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = json?.error?.code;
      err.payload = json;
      throw err;
    }
    return json.data;
  })();
  try {
    return { ok: true, data: await Promise.race([run, timeout]) };
  } catch (err) {
    run.catch(() => {});
    return { ok: false, err };
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ spin */

function applyAngle(a) {
  S.els.disc.style.transform = `rotate(${a.toFixed(3)}deg)`;
  S.els.disc.dataset.angle = a.toFixed(2);
}

function flick(speed) {
  S.pAng = -Math.min(26, 9 + speed / 55);
}

async function onSpinClick(e) {
  if (e) e.preventDefault?.();
  if (S.phase !== "idle" || !S.state?.enabled || S.root.hidden) return;
  if (remaining() <= 0) return;
  S.phase = "loading"; // synchronous lock: second click in the same task is a no-op
  S.root.dataset.phase = "loading";
  S.els.close.setAttribute("aria-disabled", "true"); // a spin in flight cannot be abandoned
  const sess = S.session;
  clearWin();
  toggleOdds(false);
  setGo("loading", "转盘中…");
  const key = S.pendingKey || (S.pendingKey = P.newIdemKey());
  const reqP = postSpin(key);
  const outcome = await driveSpin(sess, reqP);
  if (sess !== S.session || !outcome) return; // cancelled (logout / forced close)
  if (!outcome.ok) {
    const plan = P.spinErrorPlan(outcome.err);
    if (!plan.keepKey) S.pendingKey = null;
    S.phase = "idle";
    S.root.dataset.phase = "idle";
    showToast(plan.toast, "error");
    if (plan.kind === "noSpins" || plan.kind === "disabled" || plan.kind === "auth") {
      if (plan.kind === "noSpins" && S.state) {
        S.state.freeSpins = { ...(S.state.freeSpins || {}), total: 0 };
        if (outcome.err?.payload?.error?.details?.nextResetAt) S.state.nextResetAt = outcome.err.payload.error.details.nextResetAt;
      }
      if (plan.kind === "auth") {
        try { await api("/me"); } catch { /* chrome handles 401 */ }
        forceClose();
        return;
      }
      if (plan.kind === "disabled") {
        S.state = null;
        notify();
        forceClose();
        S.hooks.onChange?.({ disabled: true });
        return;
      }
    }
    renderControls();
    loadState({ force: true, quiet: true });
    return;
  }
  S.pendingKey = null;
  settle(outcome.data);
}

/** rAF-driven timeline. Resolves {ok,data} after landing, {ok:false,err} after an error, or null if cancelled. */
function driveSpin(sess, reqP) {
  return new Promise((resolve) => {
    const { disc, pointer } = S.els;
    const reduced = prefersReduced();
    const a0 = S.angle;
    const t0 = performance.now();
    let resp = null;
    let mode = reduced ? "wait" : "lead";
    let plan = null;
    let tD = 0;
    let aD = 0;
    let tS = 0;
    let aFrom = 0;
    let backFrom = 0;
    let cur = a0;
    let prevA = a0;
    let prevT = t0;
    let finalAngle = a0;
    let result = null;
    disc.classList.add("is-moving");
    S.pAng = 0;
    S.lastTick = P.tickIndex(a0);
    S.els.hub.dataset.state = "loading";
    reqP.then((r) => {
      resp = r;
    });
    const finish = (r) => {
      S.angle = P.mod360(finalAngle);
      applyAngle(S.angle);
      disc.classList.remove("is-moving");
      pointer.style.transform = "";
      S.pAng = 0;
      S.raf = 0;
      resolve(r);
    };
    const frame = (now) => {
      if (sess !== S.session) {
        disc.classList.remove("is-moving");
        S.raf = 0;
        return resolve(null);
      }
      const t = now - t0;
      const dt = Math.max(1, now - prevT);
      if (mode === "wait") {
        if (resp) {
          if (resp.ok) {
            const k = Number(resp.data.sector);
            const j = P.clampJitter(resp.data.landJitterDeg);
            const n = Math.ceil((cur + 360 + P.LW_STEP * k + j) / 360);
            finalAngle = P.restAngle(k, j, n);
            result = resp;
            mode = "reduced";
            tS = now;
            aFrom = cur;
          } else {
            return finish(resp);
          }
        }
      } else if (mode === "lead") {
        cur = P.leadAngle(t, a0);
        if (resp && !resp.ok) {
          const v = P.leadVelocity(t) * 1; // deg/s
          if (v < 200) {
            mode = "back";
            tS = now;
            backFrom = cur;
          } else {
            const sec = P.sectorUnderPointer(cur + 720);
            plan = P.planDecel(cur, v, sec, 0);
            finalAngle = plan.finalAngle;
            tD = t;
            aD = cur;
            mode = "decel";
            result = resp;
          }
        } else if (resp && resp.ok && t >= P.LW_T.minCruiseUntil && t >= P.LW_T.windup + P.LW_T.accel) {
          const k = Number(resp.data.sector);
          const j = P.clampJitter(resp.data.landJitterDeg);
          plan = P.planDecel(cur, P.leadVelocity(t), k, j);
          finalAngle = plan.finalAngle;
          tD = t;
          aD = cur;
          mode = "decel";
          result = resp;
        }
      } else if (mode === "decel") {
        const u = t - tD;
        if (u >= plan.T) {
          cur = finalAngle + P.LW_T.overshootDeg;
          mode = "settle";
          tS = now;
        } else {
          cur = aD + P.decelOffset(u, plan);
        }
      } else if (mode === "settle") {
        const u = Math.min(1, (now - tS) / P.LW_T.settle);
        cur = finalAngle + P.LW_T.overshootDeg * (1 - P.easeOutQuad(u));
        if (u >= 1) {
          cur = finalAngle;
          applyAngle(cur);
          return finish(result);
        }
      } else if (mode === "back") {
        const u = Math.min(1, (now - tS) / 220);
        cur = backFrom + (a0 - backFrom) * P.easeOutCubic(u);
        if (u >= 1) {
          finalAngle = a0;
          applyAngle(a0);
          return finish(resp);
        }
      } else if (mode === "reduced") {
        const u = Math.min(1, (now - tS) / 420);
        cur = aFrom + (finalAngle - aFrom) * P.easeOutCubic(u);
        if (u >= 1) {
          cur = finalAngle;
          applyAngle(cur);
          return finish(result);
        }
      }
      // pointer flick on each divider crossing
      if (!reduced) {
        const tk = P.tickIndex(cur);
        if (tk !== S.lastTick) {
          S.lastTick = tk;
          flick(Math.abs(cur - prevA) / (dt / 1000));
        }
        S.pAng *= Math.exp(-dt / 55);
        pointer.style.transform = Math.abs(S.pAng) > 0.15 ? `rotate(${S.pAng.toFixed(2)}deg)` : "";
      }
      applyAngle(cur);
      prevA = cur;
      prevT = now;
      S.raf = requestAnimationFrame(frame);
    };
    S.raf = requestAnimationFrame(frame);
  });
}

function clearWin() {
  const { disc, stage } = S.els;
  disc.classList.remove("is-win", "is-win-static");
  stage.classList.remove("is-jackpot-win", "is-jackpot-static");
  S.els.dialog.classList.remove("is-shake");
  delete disc.dataset.landed;
}

function settle(res) {
  const k = Number(res.sector);
  const { disc, stage, dialog, flashPos } = S.els;
  const reduced = prefersReduced();
  const jackpot = !!res.isJackpot;
  disc.dataset.landed = String(k);
  disc.style.setProperty("--lw-k", String(k));
  const glow = $(".lw-glow", disc);
  glow.style.transform = `rotate(${k * P.LW_STEP}deg)`;
  flashPos.style.transform = `rotate(${k * P.LW_STEP}deg)`;
  void disc.offsetWidth;
  disc.classList.add("is-win");
  if (res.isJackpot) {
    if (reduced) stage.classList.add("is-jackpot-static");
    else {
      stage.classList.add("is-jackpot-win");
      dialog.classList.add("is-shake");
      window.setTimeout(() => dialog.classList.remove("is-shake"), 460);
      startJackpotBurst({ fromStage: true });
    }
  }
  // state from the response
  if (S.state) {
    S.state.freeSpins = res.freeSpins || S.state.freeSpins;
    S.state.balance = res.balance;
    if (res.nextResetAt) S.state.nextResetAt = res.nextResetAt;
    if (res.configVersion != null && S.state.configVersion != null && res.configVersion !== S.state.configVersion) {
      // config changed under us: refresh sectors in the background (does not alter this result)
      loadState({ force: true, quiet: true });
    }
  }
  try {
    const a = getAuthState();
    if (a.user && Number.isFinite(Number(res.balance))) a.user.jiuCoinBalance = res.balance;
  } catch { /* ignore */ }
  S.phase = "loading"; // stays locked until the pop-up is dismissed
  const delay = reduced ? 260 : res.isJackpot ? 1000 : 650;
  const sess = S.session;
  window.setTimeout(() => {
    if (sess !== S.session) return;
    openPop(res, jackpot);
    renderControls();
    notify();
  }, delay);
}

/* ------------------------------------------------------------------ result pop-up (§4.10 (2)) */

function openPop(res, jackpot) {
  const { pop } = S.els;
  const secList = sectors();
  const drawn = secList.find((s) => s.pos === Number(res.sector));
  const copy = P.prizeCopy(res.prize, {
    isJackpot: !!res.isJackpot,
    replayed: !!res.replayed,
    freeSpinsTotal: Number(res.freeSpins?.total ?? 0),
    drawnKind: drawn?.kind || null,
  });
  const accent = P.LW_SECTOR_COLORS[Number(res.sector)] || P.LW_SECTOR_COLORS[0];
  const art = P.artFile({ ...res.prize, art: res.prize?.kind === "jiu_coin" && !res.prize?.substituted ? drawn?.art : null });
  const prizeArt = res.isJackpot ? "lw-prize-5" : art;
  const amountHtml =
    copy.kind === "coin"
      ? `<div class="lw-pop-amount" id="lwPopAmt"><span class="lw-plus">+</span><span class="lw-num" data-to="${esc(copy.amount)}">${esc(copy.amount)}</span><span class="lw-unit">${copy.unit}</span></div>`
      : `<div class="lw-pop-headline">${esc(copy.headline)}</div>`;
  const bal = Number(res.balance);
  const balHtml = copy.kind === "coin" && Number.isFinite(bal) ? `<div class="lw-pop-bal">当前余额 ${bal} 韭币</div>` : "";
  const lines = copy.lines.length ? `<ul class="lw-pop-lines">${copy.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  pop.className = `lw-pop kind-${copy.kind}${jackpot ? " is-jackpot" : ""}`;
  pop.style.setProperty("--lw-accent", accent);
  pop.dataset.kind = copy.kind;
  pop.dataset.sector = String(res.sector);
  pop.dataset.jackpot = res.isJackpot ? "1" : "0";
  pop.innerHTML = `<div class="lw-pop-wrap">
      <div class="lw-rays" aria-hidden="true">${imgHtml("lw-jackpot-rays")}</div>
      <div class="lw-card">
        <h3 class="lw-card-title" id="lwPopTitle">${esc(copy.title)}</h3>
        <div class="lw-jackpot-banner" aria-hidden="true">${imgHtml("lw-popup-jackpot-banner")}<div class="lw-jackpot-title">${esc(jackpot ? "888 大奖" : "")}</div></div>
        <div class="lw-prize-disc">${imgHtml(prizeArt)}</div>
        ${amountHtml}
        ${copy.kind === "coin" ? `<div class="lw-pop-headline">${esc(copy.headline)}</div>` : ""}
        ${lines}
        ${balHtml}
        <div class="lw-pop-actions">
          <button type="button" class="lw-pop-primary" id="lwPopOk" data-act="${copy.kind === "spin" && copy.secondary ? "again" : "ok"}">${esc(copy.primary)}</button>
          ${copy.secondary ? `<button type="button" class="lw-pop-secondary" id="lwPopLater" data-act="ok">${esc(copy.secondary)}</button>` : ""}
        </div>
      </div>
    </div>`;
  if (!res.isJackpot) $(".lw-jackpot-banner", pop).remove();
  if (!res.isJackpot) $(".lw-rays", pop).remove();
  S.els.live.textContent = copy.announce;
  for (const b of pop.querySelectorAll("button")) {
    b.addEventListener("pointerdown", () => (b.dataset.state = "press"));
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, () => (b.dataset.state = "default"));
    b.addEventListener("click", () => closePop(b.dataset.act === "again" ? "again" : null));
  }
  pop.hidden = false;
  fitView();
  S.phase = "popup";
  S.root.dataset.phase = "popup";
  S.els.close.removeAttribute("aria-disabled");
  void pop.offsetWidth;
  pop.classList.add("is-open");
  if (copy.kind === "coin" && !prefersReduced()) countUp($(".lw-num", pop), Number(copy.amount));
  if (res.isJackpot && !prefersReduced()) startJackpotBurst({ fromStage: false });
  window.setTimeout(() => {
    try { $("#lwPopOk", pop)?.focus(); } catch { /* ignore */ }
  }, 60);
}

function countUp(node, to) {
  if (!node || !Number.isFinite(to) || to <= 0) return;
  const dur = Math.min(900, 380 + to);
  const t0 = performance.now();
  const sess = S.session;
  const step = (now) => {
    if (sess !== S.session || !node.isConnected) return;
    const u = Math.min(1, (now - t0) / dur);
    node.textContent = String(Math.round(to * P.easeOutCubic(u)));
    if (u < 1) requestAnimationFrame(step);
    else node.textContent = String(to);
  };
  node.textContent = "0";
  requestAnimationFrame(step);
}

function closePop(then) {
  const { pop } = S.els;
  if (pop.hidden || pop.classList.contains("is-leaving")) return;
  pop.classList.add("is-leaving");
  pop.classList.remove("is-open");
  stopFx();
  const sess = S.session;
  window.setTimeout(() => {
    pop.hidden = true;
    pop.classList.remove("is-leaving");
    if (sess !== S.session) return;
    S.phase = "idle";
    S.root.dataset.phase = "idle";
    clearWin();
    renderControls();
    if (then === "again" && remaining() > 0) onSpinClick();
    else {
      try { S.els.go.disabled ? S.els.close.focus() : S.els.go.focus(); } catch { /* ignore */ }
    }
  }, prefersReduced() ? 100 : 180);
}

/* ------------------------------------------------------------------ jackpot effect (canvas coin burst) */

const fxImgs = { atlas: null, confetti: [] };
function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.decoding = "async";
    i.src = src;
  });
}
async function warmFx() {
  if (fxImgs.atlas || fxImgs._loading) return;
  fxImgs._loading = true;
  fxImgs.atlas = await loadImg(url2x("lw-coin-sprite-atlas"));
  fxImgs.confetti = (await Promise.all([1, 2, 3, 4, 5, 6].map((n) => loadImg(url2x(`lw-confetti-${n}`))))).filter(Boolean);
}

function startJackpotBurst({ fromStage }) {
  if (prefersReduced()) return;
  const canvas = S.els.fx;
  const rect = S.root.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!S.fx || !S.fx.running) {
    canvas.hidden = false;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    S.fx = { running: true, parts: [], ctx: canvas.getContext("2d"), dpr, w: rect.width, h: rect.height, last: 0, id: 0, t0: performance.now(), sess: S.session };
    S.fx.id = requestAnimationFrame(fxFrame);
  }
  const fx = S.fx;
  let ox;
  let oy;
  if (fromStage) {
    const r = S.els.stage.getBoundingClientRect();
    ox = r.left - rect.left + r.width / 2;
    oy = r.top - rect.top + r.height * 0.3;
  } else {
    const c = $(".lw-card", S.els.pop)?.getBoundingClientRect();
    ox = c ? c.left - rect.left + c.width / 2 : rect.width / 2;
    oy = c ? c.top - rect.top + 20 : rect.height * 0.3;
  }
  const n = fromStage ? 26 : 34;
  const coinScale = Math.max(0.8, Math.min(1.25, rect.width / 420));
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const sp = (360 + Math.random() * 520) * Math.max(0.8, Math.min(1.4, rect.height / 640));
    const confetti = i % 3 === 2 && fxImgs.confetti.length;
    fx.parts.push({
      x: ox + (Math.random() - 0.5) * 40,
      y: oy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 9,
      size: (confetti ? 16 : 28) * coinScale * (0.8 + Math.random() * 0.5),
      age: 0,
      life: 1.9 + Math.random() * 1.1,
      confetti: confetti ? fxImgs.confetti[i % fxImgs.confetti.length] : null,
      f0: Math.floor(Math.random() * 6),
    });
  }
}

function fxFrame(now) {
  const fx = S.fx;
  if (!fx || !fx.running) return;
  if (fx.sess !== S.session) return stopFx();
  const dt = fx.last ? Math.min(0.05, (now - fx.last) / 1000) : 0.016;
  fx.last = now;
  const { ctx, dpr } = fx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, fx.w, fx.h);
  const parts = fx.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    p.vy += 1500 * dt;
    p.vx *= 1 - 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.age >= p.life || p.y > fx.h + 40) {
      parts.splice(i, 1);
      continue;
    }
    const a = p.age > p.life - 0.4 ? Math.max(0, (p.life - p.age) / 0.4) : 1;
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.confetti ? p.rot : 0);
    if (p.confetti) {
      ctx.drawImage(p.confetti, -p.size / 2, -p.size / 2, p.size, p.size);
    } else if (fxImgs.atlas) {
      const cell = fxImgs.atlas.height; // 80 @2x
      const f = (p.f0 + Math.floor(p.age * 14)) % 6;
      ctx.drawImage(fxImgs.atlas, f * cell, 0, cell, cell, -p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (!parts.length && now - fx.t0 > 1500) return stopFx();
  fx.id = requestAnimationFrame(fxFrame);
}

function stopFx() {
  const fx = S.fx;
  if (fx) {
    fx.running = false;
    cancelAnimationFrame(fx.id);
  }
  S.fx = null;
  const c = S.els.fx;
  if (c) {
    c.hidden = true;
    try { c.getContext("2d")?.clearRect(0, 0, c.width, c.height); } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ open / close */

function requestClose() {
  if (S.phase === "loading" || S.phase === "spinning") {
    // never abandon a spin whose result is not yet shown
    return false;
  }
  if (S.phase === "popup") {
    closePop();
    return false;
  }
  closeModal();
  return true;
}

function closeModal() {
  if (!S.root || S.root.hidden) return Promise.resolve();
  toggleOdds(false);
  window.clearInterval(S.clock);
  return closeCtlOverlay(S.root).then(() => {
    if (!S.root.hidden) return;
    stopFx();
    clearWin();
  });
}

/** Hard stop (logout / flag turned off): cancel animation, drop any result, close. */
function forceClose() {
  S.session += 1;
  cancelAnimationFrame(S.raf);
  S.raf = 0;
  S.phase = "idle";
  S.pendingKey = null;
  if (!S.root) return;
  S.root.dataset.phase = "idle";
  S.els.disc.classList.remove("is-moving");
  S.els.pointer.style.transform = "";
  S.els.pop.hidden = true;
  S.els.pop.classList.remove("is-open", "is-leaving");
  stopFx();
  clearWin();
  if (!S.root.hidden) closeModal();
  S.state = null;
  S.sectorsKey = "";
}

/**
 * Open the modal. Resolves { enabled: true } when shown, { enabled: false } when the server says the wheel is off
 * (caller falls back to the legacy flow), { enabled: null } when the state could not be loaded (modal stays open with retry).
 */
export async function openLuckyWheel({ onChange } = {}) {
  if (onChange) S.hooks.onChange = onChange;
  ensureDom();
  const auth = getAuthState();
  if (!auth.user) return { enabled: false };
  S.els.close.removeAttribute("aria-disabled");
  S.els.pop.hidden = true;
  S.els.pop.classList.remove("is-open", "is-leaving");
  if (S.phase !== "idle") {
    // a spin from an earlier open is still being resolved — just show the modal
    openCtlOverlay(S.root, { focusSelector: "#lwGo:not([disabled]), #lwClose" });
    return { enabled: true };
  }
  if (S.state) {
    renderSectors();
    renderControls();
    S.els.stage.classList.remove("is-loading");
  } else {
    S.els.stage.classList.add("is-loading");
    setGo("loading", "载入中…");
    S.els.freeN.textContent = "–";
    S.els.reset.textContent = "";
  }
  applyAngle(S.angle);
  preloadLuckyWheelArt();
  const loading = loadState({ force: !S.state, quiet: !!S.state });
  openCtlOverlay(S.root, { focusSelector: "#lwGo:not([disabled]), #lwClose" });
  fitView();
  tickClock();
  const r = await loading;
  if (r && r.enabled === false) {
    await closeModal();
    return { enabled: false };
  }
  return r || { enabled: null };
}

export function closeLuckyWheel() {
  return S.root ? requestClose() : true;
}

export function isLuckyWheelBusy() {
  return S.phase !== "idle";
}
