/** Homepage IA Scheme A: root (模拟盘/知识馆/悔棋局) + 模拟盘二级 hub */

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

/** Root home: three primary entries only */
export function showHome() {
  prepareScreen(Route.HOME);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  setRouteHash(Route.HOME);
}

/** 模拟盘二级 hub: 开始游戏 / 我的战绩 / 练习榜 */
export function showSimHub(opts = {}) {
  const { updateHash = true } = opts;
  prepareScreen(Route.SIM);
  const home = document.getElementById("homeLanes");
  const hub = document.getElementById("simHub");
  if (home) home.hidden = true;
  if (hub) hub.hidden = false;
  if (updateHash) setRouteHash(Route.SIM);
  // Intent to play: warm pack immediately (don't wait for Start / idle timer).
  prefetchStocksPack(gameState);
  refreshDailyChallengeFlag()
    .then(() => refreshDailyChallengeCard())
    .catch(() => {});
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
  } else if (h !== "leaderboard") {
    applyHomeHashRoute(h);
  }
}
