/** Homepage IA: sole L1 entry; L2 retired; L3 playModes = direction-C sheet */

import { loadChunk } from "./chunk-reload.js";
import {
  primeDailyChallengeFlag,
  refreshDailyChallengeCard,
} from "./daily-challenge.js";
import { refreshGhostDuelFlag } from "./ghost-duel.js";
import {
  primePuzzleChapterFlag,
  refreshPuzzleChapterFlag,
  refreshPuzzleChapterCard,
} from "./puzzle-chapter.js";

import { prefetchStocksPack } from "./pack-store.js";
import { refreshResumeBanner } from "./resume-banner.js";
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
  if (modes) {
    modes.hidden = true;
    modes.classList.remove("pm-sheet-open", "is-dragging");
    modes.style.transform = "";
  }
  const bd = document.getElementById("playModesBackdrop");
  if (bd) {
    bd.hidden = true;
    bd.setAttribute("aria-hidden", "true");
  }
  document.documentElement.classList.remove("pm-sheet-open");
  teardownPlayModesSheetChrome();
}

function hidePuzzleChaptersPanel() {
  const chapters = puzzleChaptersEl();
  if (chapters) chapters.hidden = true;
}

let playModesChromeBound = false;
let playModesPopState = null;
let playModesTouch = null;

function closePlayModesSheet() {
  const owned = !!(history.state && history.state.pmSheet);
  hidePlayModesPanel();
  // Restore home chrome without relying on showHome's hash churn first
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  hidePuzzleChaptersPanel();
  setHubMascotLevel(1);
  setRouteHash(Route.HOME);
  refreshResumeBanner().catch(() => {});
  import("./home-arcade.js")
    .then((m) => m.refreshHomeArcadeChrome && m.refreshHomeArcadeChrome())
    .catch(() => {});
  if (owned) {
    try {
      history.back();
    } catch { /* ignore */ }
  }
}

function setPlayModesLoading(isLoading) {
  const list = document.getElementById("playModesList");
  const skel = document.getElementById("playModesSkel");
  if (list) {
    list.setAttribute("aria-busy", isLoading ? "true" : "false");
    list.hidden = !!isLoading;
  }
  if (skel) skel.hidden = !isLoading;
}

function setPlayModesError(show) {
  const err = document.getElementById("playModesError");
  if (err) err.hidden = !show;
}

function revealClassicMode() {
  const classic = document.getElementById("classicModeCard");
  if (classic) classic.hidden = false;
}

async function refreshPlayModesFlags() {
  setPlayModesError(false);
  setPlayModesLoading(true);

  let features = null;
  try {
    const res = await fetch("/api/v1/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    features = json?.data?.features || null;
    if (!res.ok || !features) throw new Error("config");
  } catch {
    setPlayModesLoading(false);
    setPlayModesError(true);
    revealClassicMode();
    const daily = document.getElementById("dailyChallengeCard");
    const board = document.getElementById("dailyChallengeBoardBtn");
    const oneshot = document.getElementById("oneshotModeCard");
    const survival = document.getElementById("survivalModeCard");
    if (daily) daily.hidden = true;
    if (board) board.hidden = true;
    if (oneshot) oneshot.hidden = true;
    if (survival) survival.hidden = true;
    return false;
  }

  setPlayModesLoading(false);
  revealClassicMode();

  // One /config read decides every card, so the list paints once in its final
  // order. Before, 今日挑战 / 一把梭 / 生存 / 残局 popped in one by one over ~5s
  // (each behind another /config + status call) and 经典练习 slid down ~130px
  // under the player's finger. Card bodies keep their own 「加载中…」 copy until
  // their status call below returns.
  primeDailyChallengeFlag(features);
  primePuzzleChapterFlag(features);
  const daily = document.getElementById("dailyChallengeCard");
  if (daily) daily.hidden = !features.dailyChallenge;
  const oneshot = document.getElementById("oneshotModeCard");
  if (oneshot) oneshot.hidden = !features.oneshotMode;
  const survival = document.getElementById("survivalModeCard");
  if (survival) survival.hidden = !features.survivalMode;
  const puzzle = document.getElementById("puzzleChapterCard");
  if (puzzle) puzzle.hidden = !features.puzzleChapter;

  await Promise.allSettled([
    refreshDailyChallengeCard(),
    refreshGhostDuelFlag(),
    refreshPuzzleChapterCard(),
  ]);

  return true;
}

function bindPlayModesSheetChrome() {
  if (playModesChromeBound) return;
  playModesChromeBound = true;

  const bd = document.getElementById("playModesBackdrop");
  const closeBtn = document.getElementById("playModesClose");
  const retry = document.getElementById("playModesRetry");
  const grab = document.getElementById("playModesGrab");
  const sheet = playModesEl();

  bd?.addEventListener("click", (ev) => {
    // Only the dimmed area — ignore if a child somehow receives it
    if (ev.target === bd) closePlayModesSheet();
  });
  closeBtn?.addEventListener("click", closePlayModesSheet);
  retry?.addEventListener("click", () => {
    refreshPlayModesFlags().catch(() => {});
  });

  // Android / browser back → close sheet (push a sentinel history entry)
  playModesPopState = () => {
    const m = playModesEl();
    if (m && !m.hidden) {
      // History already popped — just tear down the sheet
      hidePlayModesPanel();
      const home = document.getElementById("homeLanes");
      if (home) home.hidden = false;
      setHubMascotLevel(1);
      setRouteHash(Route.HOME);
      refreshResumeBanner().catch(() => {});
    }
  };
  window.addEventListener("popstate", playModesPopState);

  // Swipe-down on grab handle to dismiss
  if (grab && sheet) {
    const baseTransform = () =>
      window.matchMedia("(min-width: 900px)").matches
        ? "translate(-50%, -50%)"
        : "translateX(-50%)";
    const onStart = (ev) => {
      const pt = ev.touches ? ev.touches[0] : ev;
      playModesTouch = { y0: pt.clientY, dy: 0 };
      sheet.classList.add("is-dragging");
    };
    const onMove = (ev) => {
      if (!playModesTouch) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      playModesTouch.dy = Math.max(0, pt.clientY - playModesTouch.y0);
      const dy = playModesTouch.dy;
      sheet.style.transform = window.matchMedia("(min-width: 900px)").matches
        ? `translate(-50%, calc(-50% + ${dy}px))`
        : `translateX(-50%) translateY(${dy}px)`;
      if (ev.cancelable) ev.preventDefault();
    };
    const onEnd = () => {
      if (!playModesTouch) return;
      const dy = playModesTouch.dy;
      playModesTouch = null;
      sheet.classList.remove("is-dragging");
      sheet.style.transform = "";
      if (dy > 96) closePlayModesSheet();
    };
    grab.addEventListener("touchstart", onStart, { passive: true });
    grab.addEventListener("touchmove", onMove, { passive: false });
    grab.addEventListener("touchend", onEnd);
    grab.addEventListener("touchcancel", onEnd);
  }
}

function teardownPlayModesSheetChrome() {
  // Keep listeners (idempotent bind); only clear drag state
  playModesTouch = null;
}

/**
 * Swap start-screen mascot art by hub depth.
 * 1 = home, 2 = simHub (retired), 3 = puzzleChapters
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

/** Root home: C2 arcade */
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
  refreshResumeBanner().catch(() => {});
  import("./home-arcade.js")
    .then((m) => m.refreshHomeArcadeChrome && m.refreshHomeArcadeChrome())
    .catch(() => {});
}

/**
 * L2 simHub retired (SIM-PAGES-SYNC): homepage is the sole entry.
 * Deep links and legacy callers redirect to home. Extra cards (残局/战绩/榜)
 * now live under the playModes sheet.
 */
export function showSimHub(opts = {}) {
  void opts;
  showHome();
}

/**
 * Light mode picker (direction C sheet): 今日挑战 / 经典 / 一把梭 / 生存
 * + 残局 / 战绩 / 榜. Close × / backdrop / swipe / Android back → homepage.
 */
export function showPlayModes() {
  prepareScreen(Route.HOME);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  const modes = playModesEl();
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  hidePuzzleChaptersPanel();
  if (modes) {
    modes.hidden = false;
    modes.classList.add("pm-sheet-open");
    modes.style.transform = "";
  }
  const bd = document.getElementById("playModesBackdrop");
  if (bd) {
    bd.hidden = false;
    bd.setAttribute("aria-hidden", "false");
  }
  document.documentElement.classList.add("pm-sheet-open");
  setHubMascotLevel(1);
  setRouteHash(Route.HOME);
  refreshResumeBanner().catch(() => {});
  prefetchStocksPack(gameState);
  bindPlayModesSheetChrome();
  // History sentinel so Android back closes the sheet first
  try {
    if (!history.state || !history.state.pmSheet) {
      history.pushState({ pmSheet: true }, "");
    }
  } catch { /* ignore */ }
  refreshPlayModesFlags().catch(() => {});
}

export function showPuzzleChapters() {
  prepareScreen(Route.HOME);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  const chapters = puzzleChaptersEl();
  if (home) home.hidden = true;
  if (hub) hub.hidden = true;
  hidePlayModesPanel();
  if (chapters) chapters.hidden = false;
  setHubMascotLevel(3);
  setRouteHash(Route.HOME);
  prefetchStocksPack(gameState);
  refreshPuzzleChapterFlag()
    .then(() => refreshPuzzleChapterCard())
    .catch(() => {});
}

/**
 * Restore start UI after leaving game / LB / my-games.
 * Homepage (C2 arcade) is now the main entry — do not dump users on the old L2 hub.
 */
export function restoreSimShell() {
  showHome();
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
    // Retired L2: deep link #/sim lands on homepage.
    showHome();
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

/* 「进入模拟盘」 bounce (css/start.css .cta-bounce) stops while the tab is hidden. */
if (typeof document !== "undefined" && document.documentElement) {
  const syncDocHidden = () => document.documentElement.classList.toggle("is-doc-hidden", !!document.hidden);
  document.addEventListener("visibilitychange", syncDocHidden);
  syncDocHidden();
}
