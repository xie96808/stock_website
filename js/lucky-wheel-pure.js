/**
 * 幸运转盘 — pure helpers (no DOM). Unit-tested in tests/lucky-wheel-pure.test.js.
 * Geometry convention (assets/lucky-wheel/MANIFEST.md): angles are degrees clockwise from the pointer (12 o'clock);
 * at rest sector k is centred at 45·k°; boundaries sit at 22.5° + k·45°; landing rotation θ = 360·n − (45·k + j).
 */

export const LW_ASSET_V = "20261019w";
export const LW_INK = "#26211d"; // label ink (>= 5.5:1 on every sector colour)
export const LW_SECTOR_COLORS = Object.freeze([
  "#8CC5B0", "#E4796A", "#F3DB93", "#AE9FD0", "#8DBBE0", "#F2B83B", "#F0A8B8", "#92B96F",
]);
export const LW_SECTOR_NAMES = Object.freeze(["青瓷", "朱砂", "米黄", "藤紫", "天青", "金", "桃粉", "松绿"]);

export const LW_SECTORS = 8;
export const LW_STEP = 360 / LW_SECTORS; // 45°
export const LW_JITTER_MAX = 13;

/** Timeline (ms / deg). Fast-reply total ≈ 4.0–4.4 s, always inside the 3.8–4.8 s window. */
export const LW_T = Object.freeze({
  windup: 150,
  windupDeg: -10,
  accel: 550,
  cruiseDps: 720,
  minCruiseUntil: 1300, // never start slowing before this (so an instant reply still feels weighty)
  decelTarget: 2400,
  nMin: 1.7,
  nMax: 2.8,
  turnsMin: 2, // decel travels 2..3 turns
  overshootDeg: 3,
  settle: 300,
  requestTimeout: 6000,
  watchdog: 9000,
});

export const mod360 = (x) => ((x % 360) + 360) % 360;

export function sectorCenterDeg(k) {
  return k * LW_STEP;
}

/** Final rest rotation for sector k with jitter j and n full turns. */
export function restAngle(k, j, n) {
  return 360 * n - (LW_STEP * k + j);
}

/** Which sector sits under the pointer when the disc is rotated by θ. */
export function sectorUnderPointer(theta) {
  const a = mod360(-theta); // disc-frame angle under the pointer
  return Math.floor((a + LW_STEP / 2) / LW_STEP) % LW_SECTORS;
}

/** Signed offset (deg) of the pointer from the centre of the sector under it. */
export function pointerOffsetFromCenter(theta) {
  const a = mod360(-theta);
  const k = sectorUnderPointer(theta);
  let d = a - k * LW_STEP;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Boundary-crossing index (changes each time a divider passes the pointer). */
export function tickIndex(theta) {
  return Math.floor((-theta + LW_STEP / 2) / LW_STEP);
}

/**
 * Plan the deceleration from the cruise state.
 * @param {number} angle   current disc angle (deg, unbounded, increasing while spinning)
 * @param {number} v0      current velocity (deg/s)
 * @param {number} sector  server sector 0..7
 * @param {number} jitter  server landJitterDeg
 */
export function planDecel(angle, v0, sector, jitter) {
  const j = clampJitter(jitter);
  const minD = LW_T.turnsMin * 360;
  // smallest rest angle (n turns) that is at least minD ahead of the current angle
  let n = Math.ceil((angle + minD + LW_STEP * sector + j) / 360);
  let F = restAngle(sector, j, n);
  while (F - angle < minD) {
    n += 1;
    F = restAngle(sector, j, n);
  }
  const D = F + LW_T.overshootDeg - angle; // decel curve ends at the overshoot point
  let expo = (v0 * (LW_T.decelTarget / 1000)) / D;
  expo = Math.min(LW_T.nMax, Math.max(LW_T.nMin, expo));
  const T = ((D * expo) / v0) * 1000; // ms; keeps velocity continuous with cruise
  return { finalAngle: F, D, n: expo, T, turns: n };
}

export function clampJitter(j) {
  const x = Number(j);
  if (!Number.isFinite(x)) return 0;
  return Math.max(-LW_JITTER_MAX, Math.min(LW_JITTER_MAX, x));
}

/** x(t) = D·(1−(1−t/T)^n), t in ms. */
export function decelOffset(t, plan) {
  const u = Math.min(1, Math.max(0, t / plan.T));
  return plan.D * (1 - Math.pow(1 - u, plan.n));
}

export const easeOutQuad = (u) => 1 - (1 - u) * (1 - u);
export const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);

/** Disc angle during wind-up + accelerate + cruise (t ms since press), start angle a0. */
export function leadAngle(t, a0) {
  const { windup, windupDeg, accel, cruiseDps } = LW_T;
  if (t <= windup) return a0 + windupDeg * easeOutQuad(t / windup);
  const a1 = a0 + windupDeg;
  const ta = t - windup;
  if (ta <= accel) {
    const u = ta / accel;
    return a1 + (cruiseDps * (accel / 1000) * u * u * u) / 3;
  }
  const aAccel = a1 + (cruiseDps * (accel / 1000)) / 3;
  return aAccel + cruiseDps * ((ta - accel) / 1000);
}

export function leadVelocity(t) {
  const { windup, accel, cruiseDps } = LW_T;
  if (t <= windup) return 0;
  const ta = t - windup;
  if (ta <= accel) {
    const u = ta / accel;
    return cruiseDps * u * u;
  }
  return cruiseDps;
}

/* ------------------------------------------------------------------ prize / label copy */

/** Sprite name (no extension) for a server sector or prize. */
export function artFile(view) {
  const art = view?.art || "";
  let m = /^coin-t([1-5])$/.exec(art);
  if (m) return `lw-prize-${m[1]}`;
  m = /^ticket-x(\d+)$/.exec(art);
  if (m) return Number(m[1]) >= 3 ? "lw-prize-ticket-3" : "lw-prize-ticket-2";
  if (art === "spin-again") return "lw-prize-spin";
  if (view?.kind === "jiu_coin") return `lw-prize-${coinTier(view.amount)}`;
  if (view?.kind === "item") return Number(view.qty) >= 3 ? "lw-prize-ticket-3" : "lw-prize-ticket-2";
  return "lw-prize-spin";
}

export function coinTier(amount) {
  const a = Number(amount) || 0;
  if (a < 75) return 1;
  if (a < 120) return 2;
  if (a < 200) return 3;
  if (a < 600) return 4;
  return 5;
}

/** Backdrop taps are ignored for this long after the result pop-up opens (a fast double tap must not dismiss it unseen). */
export const LW_BACKDROP_GUARD_MS = 400;

/**
 * May a tap on the blank backdrop close the wheel (or its pop-up)? Never while a spin is resolving / animating
 * (phase loading | spinning), never while a GET /me/lucky-wheel is in flight, and not in the pop-up's first 400 ms.
 */
export function backdropCloseAllowed({ phase = "idle", inflight = 0, popAgeMs = Infinity } = {}) {
  if (phase === "loading" || phase === "spinning") return false;
  if (Number(inflight) > 0) return false;
  if (phase === "popup" && !(Number(popAgeMs) >= LW_BACKDROP_GUARD_MS)) return false;
  return true;
}

/** Text drawn on a wheel sector from server sector data. */
export function sectorLabel(view) {
  if (!view) return { text: "", len: 0 };
  if (view.kind === "jiu_coin") return { text: String(view.amount), len: String(view.amount).length };
  if (view.kind === "item") return { text: `×${view.qty}`, len: 2 };
  return { text: "再转", len: 2 };
}

export function sectorAria(view) {
  if (!view) return "";
  if (view.kind === "jiu_coin") return `${view.amount} 韭币`;
  if (view.kind === "item") return `${view.label || "道具"} ×${view.qty}`;
  return "再转一次";
}

/** Track R: why a drawn item / spin sector paid coins instead (server `prize.substituteReason`). */
export function substituteLine(reason, drawnKind = null) {
  switch (reason) {
    case "ticket_daily_cap": return "今日后悔券已达上限，已折算为韭币";
    case "ticket_hold_cap": return "后悔券持有已达上限，已折算为韭币";
    case "spin_cap": return "今日再转次数已达上限，已折算为韭币";
    case "rewind_disabled":
    case "items_unavailable": return "道具暂时无法发放，已折算为韭币";
    default:
      if (drawnKind === "spin") return "今日再转次数已达上限，已折算为韭币";
      if (drawnKind === "item") return "道具暂时无法发放，已折算为韭币";
      return "奖品已折算为韭币";
  }
}

/**
 * Pop-up copy for a server prize (§4.10 (2)). Everything comes from the response; nothing is inferred
 * except presentation. kind ∈ coin | ticket | spin; extra lines carry the substituted / replay notes.
 */
export function prizeCopy(prize, { isJackpot = false, replayed = false, freeSpinsTotal = 0, drawnKind = null } = {}) {
  const p = prize || {};
  const jackpot = !!isJackpot;
  const lines = [];
  if (p.substituted && p.kind === "jiu_coin") lines.push(substituteLine(p.substituteReason, p.drawnKind || drawnKind));
  if (replayed) lines.push("这是你上一次转盘的结果");
  if (p.kind === "jiu_coin") {
    return {
      kind: "coin",
      title: jackpot ? "大奖！" : "获得奖品",
      headline: jackpot ? "恭喜中大奖！" : "获得韭币",
      amount: p.amount,
      unit: "韭币",
      lines,
      primary: "好的",
      secondary: null,
      announce: `${jackpot ? "大奖！" : ""}获得 ${p.amount} 韭币`,
    };
  }
  if (p.kind === "item") {
    return {
      kind: "ticket",
      title: "获得奖品",
      headline: `${p.label || "后悔券"} ×${p.qty}`,
      amount: p.qty,
      unit: "张",
      lines: [...lines, "已放入背包 · 可在单人局反悔时使用"],
      primary: "好的",
      secondary: null,
      announce: `获得 ${p.label || "后悔券"} ${p.qty} 张`,
    };
  }
  const more = freeSpinsTotal > 0;
  return {
    kind: "spin",
    title: "再来一次",
    headline: "再转一次！",
    amount: null,
    unit: "",
    lines: [...lines, more ? "已为你增加 1 次转盘机会" : "今日次数已用完，明天再来"],
    primary: more ? "再转一次" : "好的",
    secondary: more ? "好的" : null,
    announce: "获得 再转一次",
  };
}

/* ------------------------------------------------------------------ misc */

export function newIdemKey() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return `lw-${globalThis.crypto.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `lw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Remaining time to Asia/Shanghai midnight, e.g. "3 小时 12 分". nextResetAt is an ISO string with +08:00. */
export function resetCountdownText(nextResetAt, now = Date.now()) {
  const t = Date.parse(nextResetAt || "");
  if (!Number.isFinite(t) || t <= now) return "北京时间 0 点刷新";
  const mins = Math.max(1, Math.ceil((t - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} 小时 ${m} 分后刷新` : `${m} 分钟后刷新`;
}

/** Relative luminance contrast of two #rrggbb colours (WCAG). */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Classify an error from the spin POST: should the idempotency key be kept for a retry? */
export function spinErrorPlan(err) {
  const status = err?.status;
  const code = err?.code;
  if (status == null) return { keepKey: true, toast: "网络不稳，稍后再试", kind: "network" };
  if (status === 409 && code === "NO_SPINS_LEFT") return { keepKey: false, toast: "今日次数已用完", kind: "noSpins" };
  if (status === 403 && code === "FEATURE_DISABLED") return { keepKey: false, toast: "幸运转盘暂未开放", kind: "disabled" };
  if (status === 429) return { keepKey: true, toast: "转得太快了，请稍后再试", kind: "rate" };
  if (status === 401) return { keepKey: false, toast: "登录已失效，请重新登录", kind: "auth" };
  if (status >= 500) return { keepKey: true, toast: "服务暂时不可用，稍后再试", kind: "server" };
  return { keepKey: false, toast: err?.message || "转盘失败", kind: "other" };
}
