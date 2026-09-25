/** Homepage IA Scheme A: root + 模拟盘二级 hub + 三级玩法/残局章节选择 */

import {
  refreshDailyChallengeFlag,
  refreshDailyChallengeCard,
} from "./daily-challenge.js";
import { refreshGhostDuelFlag } from "./ghost-duel.js";
import {
  refreshPuzzleChapterFlag,
  refreshPuzzleChapterCard,
} from "./puzzle-chapter.js";

import { prefetchStocksPack } from "./pack-store.js";
import { gameState } from "./state.js";
import {
  Route,
  prepareScreen,
  setRouteHash,
  parseRouteHash,
} from "./screen-router.js";

function playModesEl() {
  return document.getElementById("playModes");
}

function puzzleChaptersEl() {
  return document.getElementById("puzzleChapters");
}

function hidePlayModesPanel() {
  const modes = playModesEl();
  if (modes) modes.hidden = true;
  stopIntradayCardTimer();
}

function hidePuzzleChaptersPanel() {
  const chapters = puzzleChaptersEl();
  if (chapters) chapters.hidden = true;
}

/**
 * Swap start-screen mascot art by hub depth.
 * 1 = home, 2 = simHub, 3 = playModes | puzzleChapters
 */
export function setHubMascotLevel(level) {
  const n = Math.max(1, Math.min(3, Number(level) || 1));
  const start = document.getElementById("startScreen");
  const frame = start?.querySelector?.(".frame");
  if (start) start.setAttribute("data-hub-level", String(n));
  if (frame) frame.setAttribute("data-hub-level", String(n));
}

async function refreshOneshotModeCard() {
  const card = document.getElementById("oneshotModeCard");
  if (!card) return;
  let on = false;
  try {
    const res = await fetch("/api/v1/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    on = !!(json?.data?.features?.oneshotMode);
  } catch {
    on = false;
  }
  card.hidden = !on;
}

async function refreshSurvivalModeCard() {
  const card = document.getElementById("survivalModeCard");
  if (!card) return;
  let on = false;
  try {
    const res = await fetch("/api/v1/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    on = !!(json?.data?.features?.survivalMode);
  } catch {
    on = false;
  }
  card.hidden = !on;
}

/** Public phases. Not a private replay clock. Long is 21:05, flat stays 21:00. */
const FLAT_JOIN_LEAD_MS = 60_000;
const FLAT_TAPE_MS = 241 * 100;
const FLAT_PHASE_PERIOD_MS = 24 * 60 * 60 * 1000;
const FLAT_CARD_META = "模拟 T+0 · 上海时间 21:00 同题 · 24.1 秒 · 没有名次奖励";
const LONG_CARD_META = "模拟 T+0 · 上海时间 21:05 同题 · 24.1 秒 · 每根 100ms · 没有名次奖励";

let intradayHubStatus = null;
let intradayHubOffsetMs = 0;
let intradayCardTimer = 0;
let intradayStatusRefresh = null;
let intradayBoardWired = false;

function intradayCardEl() {
  return document.getElementById("intradayModeCard");
}

function intradayLongCardEl() {
  return document.getElementById("intradayLongModeCard");
}

function intradayBoardBtnEl() {
  return document.getElementById("intradayBoardBtn");
}

function hideIntradayHub() {
  const card = intradayCardEl();
  if (card) card.hidden = true;
  const longCard = intradayLongCardEl();
  if (longCard) longCard.hidden = true;
  const btn = intradayBoardBtnEl();
  if (btn) btn.hidden = true;
  stopIntradayCardTimer();
  intradayHubStatus = null;
}

function stopIntradayCardTimer() {
  if (!intradayCardTimer) return;
  clearInterval(intradayCardTimer);
  intradayCardTimer = 0;
}

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

function describeRankedPhaseCard(status, nowMs, startMode) {
  const long = startMode === "long";
  const meta = long ? LONG_CARD_META : FLAT_CARD_META;
  const clock = long ? "21:05" : "21:00";
  const chanceLabel = long ? "已持有" : "空仓";
  const base = { meta, disabled: true, cta: "稍后再来", state: "分时题库准备中" };
  if (!status || status.ready !== true) {
    return { ...base, state: status?.message || "分时题库准备中" };
  }
  const phaseMs = Date.parse(status.phaseStartsAt?.[startMode] || "");
  if (!Number.isFinite(phaseMs)) return base;
  if (status.activeSession?.sessionId) {
    return { ...base, disabled: false, cta: "继续分时", state: "进行中 · 可继续（不扣币）" };
  }
  const openMs = phaseMs - FLAT_JOIN_LEAD_MS;
  const closedMs = phaseMs + FLAT_TAPE_MS;
  const chanceUsed = status.remainingChance?.[startMode] === 0;
  if (chanceUsed) {
    return { ...base, cta: "今日已用", state: `今日${chanceLabel}机会已用完` };
  }
  if (!Number.isFinite(nowMs) || nowMs < openMs) {
    const left = Number.isFinite(nowMs) ? formatCountdown(phaseMs - nowMs) : "—";
    return { ...base, cta: "未到相位", state: `距离 ${clock} 还有 ${left}` };
  }
  if (nowMs >= closedMs) {
    const left = formatCountdown(phaseMs + FLAT_PHASE_PERIOD_MS - nowMs);
    return { ...base, cta: "明日再来", state: `今日${chanceLabel}正式局已结束 · 距离下一场 ${clock} 还有 ${left}` };
  }
  if (nowMs < phaseMs) {
    return {
      ...base,
      disabled: false,
      cta: "提前进入",
      state: `可提前入场 · 预加载空图表 · ${formatCountdown(phaseMs - nowMs)}`,
    };
  }
  return {
    ...base,
    disabled: false,
    cta: "进入正式局",
    state: "相位进行中 · 迟到的分钟不能补",
  };
}

/**
 * Card copy from GET /api/v1/intraday `ready` and flat `phaseStartsAt`.
 * Outside the 21:00 phase the state line is a countdown.
 */
export function describeFlatRankedCard(status, nowMs) {
  return describeRankedPhaseCard(status, nowMs, "flat");
}

/** Opening-long card. Uses phaseStartsAt.long (21:05), not the flat phase. */
export function describeLongRankedCard(status, nowMs) {
  return describeRankedPhaseCard(status, nowMs, "long");
}

/**
 * A cached phase stays closed until the next day's join lead.
 * Repainting that snapshot would leave the card disabled through the new 60s window.
 */
export function shouldRefetchFlatRankedStatus(status, nowMs) {
  const phaseMs = Date.parse(status?.phaseStartsAt?.flat || "");
  if (!Number.isFinite(phaseMs) || !Number.isFinite(nowMs)) return false;
  return nowMs >= phaseMs + FLAT_PHASE_PERIOD_MS - FLAT_JOIN_LEAD_MS;
}

/** Same join lead, measured from phaseStartsAt.long so a stale long phase does not stay closed. */
export function shouldRefetchLongRankedStatus(status, nowMs) {
  const phaseMs = Date.parse(status?.phaseStartsAt?.long || "");
  if (!Number.isFinite(phaseMs) || !Number.isFinite(nowMs)) return false;
  return nowMs >= phaseMs + FLAT_PHASE_PERIOD_MS - FLAT_JOIN_LEAD_MS;
}

function paintRankedLane(card, model) {
  if (!card || card.hidden) return;
  const meta = card.querySelector("[id$='ModeCardMeta']");
  const stateEl = card.querySelector("[id$='ModeCardState']");
  const cta = card.querySelector("[id$='ModeCardCta']");
  if (meta) meta.textContent = model.meta;
  if (stateEl) stateEl.textContent = model.state;
  if (cta) cta.textContent = model.cta;
  card.classList.toggle("is-disabled", model.disabled);
  const cost = Number(intradayHubStatus?.cost?.ranked);
  const badge = card.querySelector(".jiu-price-badge");
  if (badge && Number.isFinite(cost) && cost > 0) {
    badge.setAttribute("data-jiu-price", String(cost));
    badge.setAttribute("aria-label", `消耗 ${cost} 韭币`);
    const num = badge.querySelector(".jiu-price-num");
    if (num) num.textContent = String(cost);
  }
}

function paintIntradayHubCard() {
  const nowMs = Date.now() + intradayHubOffsetMs;
  paintRankedLane(intradayCardEl(), describeFlatRankedCard(intradayHubStatus, nowMs));
  paintRankedLane(intradayLongCardEl(), describeLongRankedCard(intradayHubStatus, nowMs));
}

function paintIntradayHubError() {
  for (const card of [intradayCardEl(), intradayLongCardEl()]) {
    if (!card) continue;
    card.hidden = false;
    card.classList.remove("is-disabled");
    const stateEl = card.querySelector("[id$='ModeCardState']");
    const cta = card.querySelector("[id$='ModeCardCta']");
    if (stateEl) stateEl.textContent = "状态加载失败，点此重试";
    if (cta) cta.textContent = "重试";
  }
}

async function refetchIntradayHubStatus() {
  if (intradayStatusRefresh) return intradayStatusRefresh;
  intradayStatusRefresh = (async () => {
    try {
      const status = await fetchIntradayStatus();
      const modes = playModesEl();
      if (!modes || modes.hidden) return;
      intradayHubStatus = status;
      if (Number.isFinite(status?.serverNowMs)) {
        intradayHubOffsetMs = status.serverNowMs - Date.now();
      }
      paintIntradayHubCard();
    } catch (err) {
      if (err.status === 404 || err.code === "INTRADAY_DISABLED") hideIntradayHub();
    } finally {
      intradayStatusRefresh = null;
    }
  })();
  return intradayStatusRefresh;
}

function startIntradayCardTimer() {
  stopIntradayCardTimer();
  intradayCardTimer = setInterval(() => {
    const modes = playModesEl();
    if (!modes || modes.hidden) {
      stopIntradayCardTimer();
      return;
    }
    const nowMs = Date.now() + intradayHubOffsetMs;
    if (
      shouldRefetchFlatRankedStatus(intradayHubStatus, nowMs)
      || shouldRefetchLongRankedStatus(intradayHubStatus, nowMs)
    ) {
      void refetchIntradayHubStatus();
      return;
    }
    paintIntradayHubCard();
  }, 1000);
}

async function fetchIntradayStatus() {
  const res = await fetch("/api/v1/intraday", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || "分时状态加载失败");
    err.code = json?.error?.code;
    err.status = res.status;
    throw err;
  }
  return json.data;
}

/** Flag off hides the lane. Flag on follows ready + the flat public phase. */
export async function refreshIntradayModeCard() {
  const card = intradayCardEl();
  if (!card) return;
  stopIntradayCardTimer();
  let on = false;
  try {
    const res = await fetch("/api/v1/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    on = !!(json?.data?.features?.intradayMode);
  } catch {
    on = false;
  }
  if (!on) {
    hideIntradayHub();
    return;
  }
  const modes = playModesEl();
  if (!modes || modes.hidden) return;
  card.hidden = false;
  const longCard = intradayLongCardEl();
  if (longCard) longCard.hidden = false;
  const boardBtn = intradayBoardBtnEl();
  if (boardBtn) boardBtn.hidden = false;
  try {
    intradayHubStatus = await fetchIntradayStatus();
    intradayHubOffsetMs = Number.isFinite(intradayHubStatus?.serverNowMs)
      ? intradayHubStatus.serverNowMs - Date.now()
      : 0;
  } catch (err) {
    if (err.status === 404 || err.code === "INTRADAY_DISABLED") {
      hideIntradayHub();
      return;
    }
    paintIntradayHubError();
    return;
  }
  if (!playModesEl() || playModesEl().hidden) return;
  paintIntradayHubCard();
  startIntradayCardTimer();
}

/** Player module stays off the home graph until a card is clicked. */
export async function onIntradayModeCardClick() {
  const card = intradayCardEl();
  if (!card || card.hidden || card.classList.contains("is-disabled")) return;
  const { startIntradayRankedFlat } = await import("./intraday.js");
  await startIntradayRankedFlat();
}

export async function onIntradayLongModeCardClick() {
  const card = intradayLongCardEl();
  if (!card || card.hidden || card.classList.contains("is-disabled")) return;
  const { startIntradayRankedLong } = await import("./intraday.js");
  await startIntradayRankedLong();
}

function intradayBoardModalEl() {
  return document.getElementById("intradayBoardModal");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hideIntradayBoard() {
  const modal = intradayBoardModalEl();
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
}

function ensureIntradayBoardDismiss() {
  if (intradayBoardWired) return;
  const modal = intradayBoardModalEl();
  if (!modal) return;
  intradayBoardWired = true;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideIntradayBoard();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) hideIntradayBoard();
  });
  document.getElementById("intradayBoardFlatTab")?.addEventListener("click", () => {
    showIntradayBoardPane("flat");
  });
  document.getElementById("intradayBoardLongTab")?.addEventListener("click", () => {
    showIntradayBoardPane("long");
  });
}

let intradayBoardShown = "flat";

function intradayBoardPane(startMode) {
  const id = startMode === "long" ? "intradayBoardLongPane" : "intradayBoardFlatPane";
  return document.getElementById(id);
}

function showIntradayBoardPane(startMode) {
  intradayBoardShown = startMode === "long" ? "long" : "flat";
  const flat = intradayBoardPane("flat");
  const long = intradayBoardPane("long");
  if (flat) flat.hidden = intradayBoardShown !== "flat";
  if (long) long.hidden = intradayBoardShown !== "long";
  const flatTab = document.getElementById("intradayBoardFlatTab");
  const longTab = document.getElementById("intradayBoardLongTab");
  if (flatTab) flatTab.setAttribute("aria-selected", intradayBoardShown === "flat" ? "true" : "false");
  if (longTab) longTab.setAttribute("aria-selected", intradayBoardShown === "long" ? "true" : "false");
  const title = document.getElementById("intradayBoardTitle");
  if (title) title.textContent = intradayBoardShown === "long" ? "分时已持有榜" : "分时空仓榜";
}

async function fetchIntradayBoard(startMode) {
  const mode = startMode === "long" ? "long" : "flat";
  try {
    const res = await fetch(`/api/v1/intraday/leaderboard?startMode=${mode}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: json?.error?.message || "榜单加载失败" };
    return { ok: true, data: json.data || {} };
  } catch (err) {
    return { ok: false, message: err.message || "榜单加载失败" };
  }
}

/** One startMode, one table. Callers pass flat and long separately. */
export function renderIntradayBoardPane(data, label) {
  if (!data || data.ready !== true) {
    return `<p>${escapeHtml((data && data.message) || "分时题库准备中")}</p>`;
  }
  const symbol = data.pastCutoff && data.entries?.[0]?.symbol
    ? ` · ${escapeHtml(data.entries[0].symbol)}`
    : "";
  const heading = `${escapeHtml(label)}${data.date ? ` · ${escapeHtml(data.date)}` : ""}${symbol}`;
  if (!data.entries?.length) {
    return `<p class="intraday-board-heading">${heading}</p><p>暂无上榜成绩（参与 ${Number(data.total) || 0}）· 没有名次奖励</p>`;
  }
  const rows = data.entries.map((e) => `<tr>
      <td>${escapeHtml(e.rank)}</td>
      <td>${escapeHtml(e.nickname || "玩家")}</td>
      <td>${escapeHtml(e.returnPct)}%</td>
      <td>${escapeHtml(e.tradeCount)}</td>
    </tr>`).join("");
  return `
    <p class="intraday-board-heading">${heading}</p>
    <p class="daily-challenge-board-meta">上榜 ${Number(data.total) || 0} 人 · 收益率↓ · 成交笔数↑ · 没有名次奖励</p>
    <table class="daily-challenge-table">
      <thead><tr><th>名次</th><th>昵称</th><th>收益</th><th>成交</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function paintIntradayBoardResult(startMode, result) {
  const pane = intradayBoardPane(startMode);
  if (!pane) return;
  const label = startMode === "long" ? "分时已持有榜" : "分时空仓榜";
  if (!result || result.ok === false) {
    pane.innerHTML = `<p>${escapeHtml((result && result.message) || "加载失败")}</p>`;
    return;
  }
  pane.innerHTML = renderIntradayBoardPane(result.data, label);
}

export async function showIntradayBoard() {
  ensureIntradayBoardDismiss();
  const modal = intradayBoardModalEl();
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  showIntradayBoardPane(intradayBoardShown || "flat");
  const flatPane = intradayBoardPane("flat");
  const longPane = intradayBoardPane("long");
  if (flatPane) flatPane.innerHTML = '<p class="daily-challenge-board-loading">加载中…</p>';
  if (longPane) longPane.innerHTML = '<p class="daily-challenge-board-loading">加载中…</p>';
  const [flatResult, longResult] = await Promise.all([
    fetchIntradayBoard("flat"),
    fetchIntradayBoard("long"),
  ]);
  paintIntradayBoardResult("flat", flatResult);
  paintIntradayBoardResult("long", longResult);
}

export function onIntradayBoardClick(ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const modal = intradayBoardModalEl();
  if (modal && !modal.hidden) {
    hideIntradayBoard();
    return;
  }
  void showIntradayBoard();
}

/** Root home: three primary entries only */
export function showHome() {
  prepareScreen(Route.HOME);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  hidePlayModesPanel();
  hidePuzzleChaptersPanel();
  setHubMascotLevel(1);
  setRouteHash(Route.HOME);
}

/** 模拟盘二级 hub: 玩法入口 / 残局 / 我的战绩 / 练习榜 */
export function showSimHub(opts = {}) {
  const { updateHash = true } = opts;
  prepareScreen(Route.SIM);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = true;
  if (hub) hub.hidden = false;
  hidePlayModesPanel();
  hidePuzzleChaptersPanel();
  setHubMascotLevel(2);
  if (updateHash) setRouteHash(Route.SIM);
  // Intent to play: warm pack immediately (don't wait for Start / idle timer).
  prefetchStocksPack(gameState);
  refreshPuzzleChapterFlag()
    .then(() => refreshPuzzleChapterCard())
    .catch(() => {});
}

/** 三级玩法选择：今日挑战 / 经典 / 一把梭 / 生存 / 分时空仓 / 分时已持有（hash 仍为 sim） */
export function showPlayModes() {
  prepareScreen(Route.SIM);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  const modes = playModesEl();
  if (home) home.hidden = true;
  if (hub) hub.hidden = true;
  hidePuzzleChaptersPanel();
  if (modes) modes.hidden = false;
  setHubMascotLevel(3);
  setRouteHash(Route.SIM);
  prefetchStocksPack(gameState);
  refreshDailyChallengeFlag()
    .then(() => refreshDailyChallengeCard())
    .catch(() => {});
  refreshGhostDuelFlag().catch(() => {});
  refreshOneshotModeCard().catch(() => {});
  refreshSurvivalModeCard().catch(() => {});
  refreshIntradayModeCard().catch(() => {});
}

/** 三级残局章节选择：第一～四章已开放（hash 仍为 sim） */
export function showPuzzleChapters() {
  prepareScreen(Route.SIM);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  const chapters = puzzleChaptersEl();
  if (home) home.hidden = true;
  if (hub) hub.hidden = true;
  hidePlayModesPanel();
  if (chapters) chapters.hidden = false;
  setHubMascotLevel(3);
  setRouteHash(Route.SIM);
  prefetchStocksPack(gameState);
  refreshPuzzleChapterFlag()
    .then(() => refreshPuzzleChapterCard())
    .catch(() => {});
}

/**
 * Restore start UI after leaving game / LB / my-games.
 * Prefers 模拟盘 hub because those flows live under it.
 */
export function restoreSimShell() {
  showSimHub({ updateHash: true });
}

function openAcademyRoute() {
  if (typeof window.showAcademy === "function") window.showAcademy();
}

function openHindsightRoute() {
  if (typeof window.showHindsight === "function") window.showHindsight();
}

/** Apply a resolved home-owned hash route (used by unified hash router). */
export function applyHomeHashRoute(hash = parseRouteHash()) {
  if (hash === "leaderboard") return; // leaderboard owns this via registerHashRoute
  if (hash === "sim") {
    showSimHub({ updateHash: false });
    return;
  }
  if (hash === "knowledge" || hash === "academy") {
    openAcademyRoute();
    return;
  }
  if (hash === "harmony" || hash === "hindsight") {
    openHindsightRoute();
    return;
  }
  if (!hash || hash === "home") {
    showHome();
  }
}

/** @deprecated Use initAppHashRouting from screen-router; kept for any leftover callers. */
export function initHomeIaRouting() {
  const h = parseRouteHash();
  if (!h) {
    const home = document.getElementById("homeLanes");
    const hub = document.getElementById("simHub");
    if (home) home.hidden = false;
    if (hub) hub.hidden = true;
    hidePlayModesPanel();
    hidePuzzleChaptersPanel();
    setHubMascotLevel(1);
  } else if (h !== "leaderboard") {
    applyHomeHashRoute(h);
  }
}
