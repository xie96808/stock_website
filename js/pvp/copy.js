export function pvpEntryVisible(features) {
  return !!(features && features.pvpBattle);
}

export function formatPpm(ppm) {
  if (ppm == null || !Number.isFinite(Number(ppm))) return "—";
  const value = Number(ppm) / 10000;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Uses the server win rate. Null means there is no scored game yet. */
export function formatWinRate(winRate) {
  if (winRate == null || !Number.isFinite(Number(winRate))) return "";
  return `${(Number(winRate) * 100).toFixed(1)}%`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Color a yield percent. Positive is red, negative is green, zero stays plain.
 * Amplitude, range position, and loss magnitude are left as written.
 */
export function colorReturnHtml(html) {
  // A-share: positive red, negative green. Skip amplitude/position/loss magnitude labels.
  return String(html ?? "")
    .replace(
      /(振幅|位置|亏损)(\s*)([+-]?\d+(?:\.\d+)?)%|([+-]?\d+(?:\.\d+)?)%/g,
      (full, skip, _gap, _skipped, num) => {
        if (skip) return full;
        const value = Number(num);
        if (!Number.isFinite(value) || value === 0) return full;
        const cls = value > 0 ? "pvp-up" : "pvp-down";
        return `<span class="${cls}">${num}%</span>`;
      },
    )
    .replace(
      /(^|[^\w.])([+-]\d+(?:\.\d+)?)(?!%|[\d.])/g,
      (full, lead, num) => {
        const value = Number(num);
        if (!Number.isFinite(value) || value === 0) return full;
        const cls = value > 0 ? "pvp-up" : "pvp-down";
        return `${lead}<span class="${cls}">${num}</span>`;
      },
    );
}

/** Calendar span of a finished match. Empty until the server reveals it. */
export function formatWindow(identity) {
  const start = identity?.periodStart;
  const end = identity?.periodEnd;
  if (!start || !end) return "";
  return `${start} 至 ${end}`;
}

export function formatCoin(delta) {
  if (delta == null || !Number.isFinite(Number(delta))) return "—";
  const value = Number(delta);
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

/** Decision rounds are 1–29. */
export function roundCaption(view) {
  if (!view || view.status !== "playing") return "";
  if (!view.round) return "等待下一手";
  return `决策回合 ${view.round}/29`;
}

export function lockCaption({ submitting = false, locked = false } = {}) {
  if (submitting) return "提交中";
  if (locked) return "已锁定";
  return "尚未锁定";
}

/** Opponent lock is only these two words. */
export function opponentLockText(locked) {
  return locked ? "已锁定" : "未锁定";
}

const REASON_LABEL = {
  completed_return: "",
  completed_drawdown: "回撤决胜",
  completed_draw: "平局",
  forfeit: "认输",
  afk: "缺席",
  both_afk: "双方缺席",
  account_unavailable: "账号不可用",
  both_unavailable: "双方账号不可用",
  admin_abort: "系统结束",
  ready_timeout: "准备超时",
  ready_cancelled: "取消准备",
  boot_recovery: "系统退款",
  system_stall: "系统退款",
  system_restart: "系统退款",
  mtm_mismatch: "系统退款",
};

export function reasonLabel(reason) {
  if (Object.prototype.hasOwnProperty.call(REASON_LABEL, reason)) return REASON_LABEL[reason];
  return "已结束";
}

export function resultHeadline(view) {
  const reason = view?.terminal?.reason;
  const outcome = view?.me?.outcome;
  if (reason === "completed_return" && outcome === "win") return "收益更高，你赢了";
  if (reason === "completed_return" && outcome === "loss") return "收益较低，你输了";
  if (reason === "completed_drawdown" && outcome === "win") return "收益相同，回撤更小，你赢了";
  if (reason === "completed_drawdown" && outcome === "loss") return "收益相同，回撤更大，你输了";
  if (reason === "completed_draw") return "收益和回撤相同，这局是平局";
  if (reason === "forfeit" && outcome === "win") return "对手认输，你赢了";
  if (reason === "forfeit" && outcome === "loss") return "你已认输";
  if (reason === "afk" && outcome === "win") return "对手缺席，你赢了";
  if (reason === "afk" && outcome === "loss") return "缺席次数达到上限，你输了";
  if (reason === "ready_timeout") return "准备超时，本局没有扣费";
  if (reason === "ready_cancelled") return "准备已取消，本局没有扣费";
  if (reason === "both_afk") return "双方缺席，这局已结束";
  if (reason === "account_unavailable" && outcome === "win") return "对手账号不能继续，你赢了";
  if (reason === "account_unavailable" && outcome === "loss") return "账号不能继续，这局已结束";
  if (reason === "account_unavailable") return "有账号不能继续，这局已结束";
  if (reason === "both_unavailable") return "双方账号不可用，这局已结束";
  if (reason === "admin_abort") return "系统结束了这局";
  if (reason === "boot_recovery" || reason === "system_stall" || reason === "system_restart" || reason === "mtm_mismatch") {
    return "系统中断了这局，入场费已退回";
  }
  if (outcome === "win") return "你赢了";
  if (outcome === "loss") return "你输了";
  if (outcome === "draw") return "平局";
  return "这局已结束";
}

export function remainingMs(deadlineAt, serverNow, fetchedAt) {
  if (deadlineAt == null || serverNow == null || fetchedAt == null) return null;
  return deadlineAt - (Date.now() + (serverNow - fetchedAt));
}

export function formatRemain(ms) {
  if (ms == null) return "";
  const left = Math.max(0, Math.ceil(ms / 1000));
  return `${left} 秒`;
}

/** Buy/sell on round d fills on the next game bar. */
export function marksFromView(view) {
  const marks = [];
  const rows = Array.isArray(view?.resolvedActions) ? view.resolvedActions : [];
  for (const row of rows) {
    const label = `d${row.round + 1}`;
    if (row.me === "buy" || row.me === "sell") marks.push({ label, side: "me", kind: row.me });
    if (row.opponent === "buy" || row.opponent === "sell") marks.push({ label, side: "opponent", kind: row.opponent });
  }
  if (view?.terminal?.type === "completed" && view.market?.bars?.some((bar) => bar.label === "d30")) {
    marks.push({ label: "d30", side: "me", kind: "valuation" });
  }
  return marks;
}

const SHARE_SITE = "早知道当初不炒了";
const SHARE_TITLE = `来【${SHARE_SITE}】模拟盘对战`;
/**
 * The one invite line used everywhere a battle invite goes out: system share,
 * 复制链接, and the 保存邀请图 card. Final wording is still being chosen —
 * change it here only.
 */
export const PVP_INVITE_SHARE_TEXT = "我在模拟盘对战里等你，点开就能进房间。";
const SHARE_TEXT = PVP_INVITE_SHARE_TEXT;

/** Path-based invite URL (not hash) so WeChat/iMessage can fetch OG and show a link card. */
export function buildBattleInviteUrl(code, origin = "") {
  const normalized = String(code || "").trim().toLowerCase();
  if (!/^[a-z2-9]{8}$/.test(normalized)) return "";
  const base = String(origin || "").replace(/\/$/, "") || "https://stockgame.xieyw.top";
  return `${base}/invite.html?c=${encodeURIComponent(normalized)}`;
}

export function buildBattleSharePayload(code, origin = "") {
  const url = buildBattleInviteUrl(code, origin);
  return {
    title: SHARE_TITLE,
    text: SHARE_TEXT,
    url,
    clipboard: url ? `${SHARE_TEXT}\n${url}` : "",
  };
}
