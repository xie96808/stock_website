/** Homepage arcade (C2 r6): decorative hero, guest-only CTA bounce, CTA wiring. */
import { getAuthState, selectAuthChromeMode } from "./auth.js";
import { refreshDailyChallengeFlag, isDailyChallengeEnabled } from "./daily-challenge.js";
import { pvpEnabled } from "./pvp/transport.js";

const PANEL = {
  total: "3,586,742.63",
  float: "+1,046,318.54",
  day: "+266,027.91",
  dayPct: "+8.01%",
  mv: "3,214,906.18",
  avail: "371,836.45",
  draw: "352,617.08",
};

let stopBounceTimer = 0;
let countdownTimer = 0;
let inited = false;

function $(id) {
  return document.getElementById(id);
}

function goBtn() {
  return $("homeArcadeGo");
}

/** Split shell (layout + hit targets). */
function goSplit() {
  return $("homeArcadeGoSplit") || goBtn();
}

/** Painted face that bounces — hit targets stay static. */
function goVisual() {
  return $("homeArcadeGoVisual") || goSplit();
}

function setAuthDataset(mode) {
  const root = document.documentElement;
  if (mode === "guest" || mode === "user" || mode === "pending") {
    root.dataset.auth = mode;
  }
}

/**
 * Guest-only bounce: wait for rest phase (48–100% of cycle) before removing class.
 * pending/user: no bounce (avoids flash while auth settles).
 */
export function setHomeCtaBounce(on) {
  const b = goVisual();
  if (!b) return;
  clearTimeout(stopBounceTimer);
  if (on) {
    b.classList.add("ha-bounce");
    setAuthDataset("guest");
    delete document.documentElement.dataset.authPending;
    return;
  }
  const finish = () => {
    b.removeEventListener("animationiteration", finish);
    clearTimeout(stopBounceTimer);
    if (document.documentElement.dataset.authPending === "user") {
      b.classList.remove("ha-bounce");
      setAuthDataset("user");
      delete document.documentElement.dataset.authPending;
    }
  };
  const anim = b.getAnimations
    ? b.getAnimations().find((a) => a.animationName === "ha-cta-bounce")
    : null;
  if (anim && anim.playState === "running") {
    const t = (anim.currentTime - 800) % 1400;
    document.documentElement.dataset.authPending = "user";
    if (t < 0 || t >= 0.48 * 1400) finish();
    else {
      b.addEventListener("animationiteration", finish);
      stopBounceTimer = setTimeout(finish, 0.48 * 1400 - t + 20);
    }
  } else {
    b.classList.remove("ha-bounce");
    setAuthDataset("user");
  }
}

function applyAuthChrome() {
  const mode = selectAuthChromeMode(getAuthState());
  if (mode === "guest") {
    setHomeCtaBounce(true);
  } else if (mode === "user") {
    setHomeCtaBounce(false);
  } else {
    // pending: no bounce, mark pending so CSS does not animate
    const b = goVisual();
    if (b) b.classList.remove("ha-bounce");
    setAuthDataset("pending");
  }
}

function paintPanel() {
  const map = {
    total: PANEL.total,
    float: PANEL.float,
    day: PANEL.day,
    dayPct: PANEL.dayPct,
    mv: PANEL.mv,
    avail: PANEL.avail,
    draw: PANEL.draw,
  };
  document.querySelectorAll("#homeArcadePanel [data-num]").forEach((el) => {
    const v = map[el.dataset.num];
    if (v == null) return;
    el.textContent = v;
    if (el.dataset.num === "float" || el.dataset.num === "day" || el.dataset.num === "dayPct") {
      el.classList.toggle("is-up", v.startsWith("+"));
      el.classList.toggle("is-down", v.startsWith("–") || v.startsWith("-") || v.startsWith("\u2212"));
    }
  });
}

function drawKline() {
  const el = $("homeArcadeKl");
  if (!el) return;
  const r2 = (v) => Math.round(v * 100) / 100;
  const lim = (p) => r2(p * 1.1);
  let s = 97;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bars = [];
  let p = 8.36;
  for (let i = 0; i < 10; i++) {
    const o = r2(p * (1 + (rnd() - 0.5) * 0.012));
    const drift = i < 3 ? -0.016 : 0.03;
    const c = r2(o * (1 + drift + (rnd() - 0.5) * 0.03));
    bars.push({
      o,
      c,
      h: r2(Math.max(o, c) * (1 + rnd() * 0.014)),
      l: r2(Math.min(o, c) * (1 - rnd() * 0.014)),
      t: "n",
    });
    p = c;
  }
  {
    const o = r2(p * 1.018);
    const c = r2(p * 1.068);
    bars.push({ o, c, h: r2(c * 1.01), l: r2(o * 0.992), t: "n" });
    p = c;
  }
  {
    const L = lim(p);
    const o = r2(p * 1.024);
    bars.push({ o, c: L, h: L, l: r2(o * 0.99), t: "zt" });
    p = L;
  }
  {
    const L = lim(p);
    bars.push({ o: L, c: L, h: L, l: L, t: "yz" });
    p = L;
  }
  {
    const L = lim(p);
    bars.push({ o: L, c: L, h: L, l: L, t: "yz" });
    p = L;
  }
  {
    const L = lim(p);
    bars.push({ o: L, c: L, h: L, l: r2(L * 0.937), t: "tz" });
  }

  const W = el.clientWidth || 600;
  const H = el.clientHeight || 300;
  const n = bars.length;
  const padT = 26;
  const padB = 6;
  const mn = Math.min(...bars.map((b) => b.l));
  const mx = Math.max(...bars.map((b) => b.h));
  const lg = Math.log;
  const y = (v) => padT + (1 - (lg(v) - lg(mn)) / (lg(mx) - lg(mn))) * (H - padT - padB);
  const st = W / n;
  const bw = Math.max(3, Math.min(12, st * 0.6));
  let g = "";
  bars.forEach((b, i) => {
    const x = i * st + st / 2;
    const up = b.c >= b.o;
    const cls = up ? "up" : "dn";
    const X = x.toFixed(1);
    if (b.t === "yz") {
      g += `<line class="board c" style="--i:${i}" x1="${(x - bw * 0.65).toFixed(1)}" x2="${(x + bw * 0.65).toFixed(1)}" y1="${y(b.c).toFixed(1)}" y2="${y(b.c).toFixed(1)}"/>`;
    } else if (b.t === "tz") {
      g += `<line class="up wick c" style="--i:${i}" x1="${X}" x2="${X}" y1="${y(b.c).toFixed(1)}" y2="${y(b.l).toFixed(1)}"/>`;
      g += `<line class="board c" style="--i:${i}" x1="${(x - bw * 0.65).toFixed(1)}" x2="${(x + bw * 0.65).toFixed(1)}" y1="${y(b.c).toFixed(1)}" y2="${y(b.c).toFixed(1)}"/>`;
    } else {
      g += `<line class="${cls} wick c" style="--i:${i}" x1="${X}" x2="${X}" y1="${y(b.h).toFixed(1)}" y2="${y(b.l).toFixed(1)}"/>`;
      const t = y(Math.max(b.o, b.c));
      const bt = y(Math.min(b.o, b.c));
      g += `<rect class="${cls} c" style="--i:${i}" x="${(x - bw / 2).toFixed(1)}" y="${t.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, bt - t).toFixed(1)}" rx="1"/>`;
    }
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>`;
}

function tickCountdown() {
  const el = document.querySelector("#homeArcadeDaily .ha-cd");
  if (!el) return;
  const now = Date.now();
  const sh = new Date(now + 8 * 3600e3);
  const left =
    86400 - ((sh.getUTCHours() * 3600 + sh.getUTCMinutes() * 60 + sh.getUTCSeconds()) % 86400);
  el.textContent = [Math.floor(left / 3600), Math.floor((left % 3600) / 60), left % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}

async function refreshDailyPill() {
  const pill = $("homeArcadeDaily");
  if (!pill) return;
  try {
    await refreshDailyChallengeFlag();
  } catch {
    /* ignore */
  }
  const on = typeof isDailyChallengeEnabled === "function" && isDailyChallengeEnabled();
  pill.classList.toggle("is-on", !!on);
  pill.hidden = !on;
}

async function refreshHomePvp() {
  const ticket = $("homeArcadePvp");
  if (!ticket) return;
  let on = false;
  try {
    on = await pvpEnabled();
  } catch {
    on = false;
  }
  ticket.hidden = !on;
}

/** Sync 开一局 label with resume banner visibility. */
export function syncHomeGoLabel() {
  const b = goBtn();
  if (!b) return;
  const banner = $("resumeGameBanner");
  const resume = banner && !banner.hidden;
  const title = b.querySelector("[data-ha-go-title]");
  const sub = b.querySelector("[data-ha-go-sub]");
  if (title) title.textContent = resume ? "继续对局" : "开一局";
  if (sub) sub.hidden = !!resume;
  b.setAttribute("aria-label", resume ? "继续对局" : "开一局");
  b.dataset.resume = resume ? "1" : "0";
}

function onGoClick() {
  const b = goBtn();
  if (b && b.dataset.resume === "1") {
    const cont = $("resumeGameContinueBtn");
    if (cont) {
      cont.click();
      return;
    }
  }
  if (typeof window.startClassicPractice === "function") window.startClassicPractice();
}

function wireClicks() {
  const go = goBtn();
  if (go) go.addEventListener("click", onGoClick);
  const modes = $("homeArcadeModes");
  if (modes) {
    modes.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.showPlayModes === "function") window.showPlayModes();
    });
  }
  const pvp = $("homeArcadePvp");
  if (pvp) {
    pvp.addEventListener("click", () => {
      if (typeof window.showPvpLobby === "function") window.showPvpLobby();
    });
  }
  const learn = $("homeArcadeLearn");
  if (learn) {
    learn.addEventListener("click", () => {
      if (typeof window.showAcademy === "function") window.showAcademy();
    });
  }
  const hind = $("homeArcadeHindsight");
  if (hind) {
    hind.addEventListener("click", () => {
      if (typeof window.showHindsight === "function") window.showHindsight();
    });
  }
  const dailyBtn = document.querySelector("#homeArcadeDaily button");
  if (dailyBtn) {
    dailyBtn.addEventListener("click", () => {
      if (typeof window.onDailyChallengeCardClick === "function") window.onDailyChallengeCardClick();
      else if (typeof window.showPlayModes === "function") window.showPlayModes();
    });
  }
}

export function initHomeArcade() {
  if (inited) return;
  inited = true;
  const lanes = $("homeLanes");
  if (!lanes || !lanes.classList.contains("home-arcade")) return;

  paintPanel();
  drawKline();
  let resizeT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(drawKline, 80);
  });

  wireClicks();
  applyAuthChrome();
  document.addEventListener("stockgame:auth-changed", applyAuthChrome);

  syncHomeGoLabel();
  const banner = $("resumeGameBanner");
  if (banner && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => syncHomeGoLabel()).observe(banner, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }
  document.addEventListener("stockgame:resume-changed", syncHomeGoLabel);

  tickCountdown();
  countdownTimer = window.setInterval(tickCountdown, 1000);

  void refreshDailyPill();
  void refreshHomePvp();
  document.addEventListener("stockgame:auth-changed", () => {
    void refreshHomePvp();
  });
}

export function refreshHomeArcadeChrome() {
  void refreshDailyPill();
  void refreshHomePvp();
  syncHomeGoLabel();
  applyAuthChrome();
}
