/** Homepage IA Scheme A: root (模拟盘/知识馆/悔棋局) + 模拟盘二级 hub */

const HASH_SIM = "sim";
const HASH_KNOWLEDGE = "knowledge";
const HASH_HARMONY = "harmony";
const HASH_ACADEMY = "academy";
const HASH_HINDSIGHT = "hindsight";

function startEl() {
  return document.getElementById("startScreen");
}

function homeLanes() {
  return document.getElementById("homeLanes");
}

function simHub() {
  return document.getElementById("simHub");
}

function setHash(route) {
  const cur = route ? `#/${route}` : "";
  const now = (location.hash || "").replace(/^#\/?/, "");
  if ((route || "") === now) return;
  try {
    if (route) history.replaceState(null, "", `#/${route}`);
    else history.replaceState(null, "", location.pathname + location.search);
  } catch {
    location.hash = cur;
  }
}

function hideChromeHeader() {
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "none";
    hdr.classList.remove("compact");
  }
}

function hidePeerScreens({ keepAcademy = false, keepHindsight = false } = {}) {
  document.getElementById("gameScreen")?.classList.remove("active");
  document.getElementById("resultScreen")?.classList.remove("active");
  if (!keepAcademy) {
    document.getElementById("academyScreen")?.classList.remove("active");
  }
  if (!keepHindsight) {
    document.getElementById("hindsightScreen")?.classList.remove("active");
  }
  const my = document.getElementById("myGamesScreen");
  if (my) {
    my.classList.remove("active");
    my.style.display = "none";
  }
  const lb = document.getElementById("leaderboardScreen");
  if (lb) {
    lb.classList.remove("active");
    lb.style.display = "none";
  }
}

function showStartShell() {
  hidePeerScreens();
  const start = startEl();
  if (start) start.style.display = "flex";
  hideChromeHeader();
}

/** Root home: three primary entries only */
export function showHome() {
  showStartShell();
  const home = homeLanes();
  const hub = simHub();
  if (home) home.hidden = false;
  if (hub) hub.hidden = true;
  setHash("");
}

/** 模拟盘二级 hub: 开始游戏 / 我的战绩 / 练习榜 */
export function showSimHub(opts = {}) {
  const { updateHash = true } = opts;
  showStartShell();
  const home = homeLanes();
  const hub = simHub();
  if (home) home.hidden = true;
  if (hub) hub.hidden = false;
  if (updateHash) setHash(HASH_SIM);
}

/**
 * Restore start UI after leaving game / LB / my-games.
 * Prefers 模拟盘 hub because those flows live under it.
 */
export function restoreSimShell() {
  showSimHub({ updateHash: true });
}

function openAcademyRoute() {
  hidePeerScreens({ keepAcademy: true });
  const start = startEl();
  if (start) start.style.display = "none";
  hideChromeHeader();
  if (typeof window.showAcademy === "function") window.showAcademy();
}

function openHindsightRoute() {
  hidePeerScreens({ keepHindsight: true });
  const start = startEl();
  if (start) start.style.display = "none";
  hideChromeHeader();
  if (typeof window.showHindsight === "function") window.showHindsight();
}

function parseHash() {
  return (location.hash || "").replace(/^#\/?/, "");
}

export function applyHomeHashRoute() {
  const h = parseHash();
  if (h === "leaderboard") return; // leaderboard.js owns this
  if (h === HASH_SIM) {
    showSimHub({ updateHash: false });
    return;
  }
  // Repoint former placeholders (and aliases) to real modules
  if (h === HASH_KNOWLEDGE || h === HASH_ACADEMY) {
    openAcademyRoute();
    return;
  }
  if (h === HASH_HARMONY || h === HASH_HINDSIGHT) {
    openHindsightRoute();
    return;
  }
  if (!h || h === "home") {
    showHome();
  }
}

export function initHomeIaRouting() {
  const h = parseHash();
  if (!h) {
    const home = homeLanes();
    const hub = simHub();
    if (home) home.hidden = false;
    if (hub) hub.hidden = true;
  } else if (h !== "leaderboard") {
    applyHomeHashRoute();
  }
  window.addEventListener("hashchange", () => {
    const next = parseHash();
    if (next === "leaderboard") return;
    applyHomeHashRoute();
  });
}
