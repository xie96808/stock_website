/** Homepage IA Scheme A: root + 模拟盘二级 hub + 三级玩法选择 */

import {
  refreshDailyChallengeFlag,
  refreshDailyChallengeCard,
} from "./daily-challenge.js";
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

function hidePlayModesPanel() {
  const modes = playModesEl();
  if (modes) modes.hidden = true;
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

/** Root home: three primary entries only */
export function showHome() {
  prepareScreen(Route.HOME);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  hidePlayModesPanel();
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
  if (updateHash) setRouteHash(Route.SIM);
  // Intent to play: warm pack immediately (don't wait for Start / idle timer).
  prefetchStocksPack(gameState);
  refreshPuzzleChapterFlag()
    .then(() => refreshPuzzleChapterCard())
    .catch(() => {});
}

/** 三级玩法选择：今日挑战 / 经典 / 一把梭（hash 仍为 sim） */
export function showPlayModes() {
  prepareScreen(Route.SIM);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  const modes = playModesEl();
  if (home) home.hidden = true;
  if (hub) hub.hidden = true;
  if (modes) modes.hidden = false;
  setRouteHash(Route.SIM);
  prefetchStocksPack(gameState);
  refreshDailyChallengeFlag()
    .then(() => refreshDailyChallengeCard())
    .catch(() => {});
  refreshOneshotModeCard().catch(() => {});
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
  } else if (h !== "leaderboard") {
    applyHomeHashRoute(h);
  }
}
