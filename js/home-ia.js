/** Homepage IA Scheme A: root (模拟盘/知识馆/悔棋局) + 模拟盘二级 hub (Concept C) */

import { prefetchStocksPack } from "./pack-store.js";
import { gameState } from "./state.js";
import {
  Route,
  prepareScreen,
  setRouteHash,
  parseRouteHash,
} from "./screen-router.js";

function homeShellEl() {
  return document.getElementById("homePage") || document.getElementById("homeLanes");
}

function setSimShellVisible(showHub) {
  const home = homeShellEl();
  const hub = document.getElementById("simHub");
  if (home) home.hidden = !!showHub;
  if (hub) hub.hidden = !showHub;
}

/** Root home: three primary entries only */
export function showHome() {
  prepareScreen(Route.HOME);
  setSimShellVisible(false);
  setRouteHash(Route.HOME);
}

/** 模拟盘二级 hub: leave + rail + start card + atmosphere */
export function showSimHub(opts = {}) {
  const { updateHash = true } = opts;
  prepareScreen(Route.SIM);
  setSimShellVisible(true);
  if (updateHash) setRouteHash(Route.SIM);
  // Intent to play: warm pack immediately (don't wait for Start / idle timer).
  prefetchStocksPack(gameState);
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
    setSimShellVisible(false);
  } else if (h !== "leaderboard") {
    applyHomeHashRoute(h);
  }
}
