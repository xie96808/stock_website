/** Homepage IA Scheme A: root (模拟盘/知识馆/和谐区) + 模拟盘二级 hub + placeholders */

const HASH_HOME = "";
const HASH_SIM = "sim";
const HASH_KNOWLEDGE = "knowledge";
const HASH_HARMONY = "harmony";

function startEl() {
  return document.getElementById("startScreen");
}

function homeLanes() {
  return document.getElementById("homeLanes");
}

function simHub() {
  return document.getElementById("simHub");
}

function comingSoon() {
  return document.getElementById("comingSoonScreen");
}

function setHash(route) {
  const next = route ? `#/${route}` : location.pathname + location.search;
  const cur = route ? `#/${route}` : "";
  const now = (location.hash || "").replace(/^#\/?/, "");
  if ((route || "") === now) return;
  try {
    if (route) history.replaceState(null, "", `#/${route}`);
    else history.replaceState(null, "", location.pathname + location.search);
  } catch {
    location.hash = cur;
  }
  void next;
}

function hideChromeHeader() {
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "none";
    hdr.classList.remove("compact");
  }
}

function hideDynamicScreens() {
  document.getElementById("gameScreen")?.classList.remove("active");
  document.getElementById("resultScreen")?.classList.remove("active");
  document.getElementById("academyScreen")?.classList.remove("active");
  document.getElementById("hindsightScreen")?.classList.remove("active");
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
  hideDynamicScreens();
  const cs = comingSoon();
  if (cs) {
    cs.classList.remove("active");
    cs.style.display = "none";
    cs.setAttribute("aria-hidden", "true");
  }
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

export function showComingSoon(kind) {
  const route = kind === "harmony" ? HASH_HARMONY : HASH_KNOWLEDGE;
  const title = kind === "harmony" ? "和谐区" : "知识馆";
  const blurb =
    kind === "harmony"
      ? "社区与交流空间筹备中，敬请期待。"
      : "K 线形态、知识卡片与训练题筹备中，敬请期待。";

  hideDynamicScreens();
  const start = startEl();
  if (start) start.style.display = "none";

  let screen = comingSoon();
  if (!screen) {
    screen = document.createElement("section");
    screen.id = "comingSoonScreen";
    screen.className = "coming-soon-screen";
    screen.innerHTML = `
      <div class="coming-soon-wrap">
        <button type="button" class="coming-soon-back" id="comingSoonBackBtn">← 返回首页</button>
        <div class="coming-soon-card">
          <small id="comingSoonKicker">专区</small>
          <h2 id="comingSoonTitle">即将开放</h2>
          <p id="comingSoonBlurb"></p>
          <span class="coming-soon-badge">即将开放</span>
        </div>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    screen.querySelector("#comingSoonBackBtn").onclick = () => showHome();
  }
  const kicker = screen.querySelector("#comingSoonKicker");
  const titleEl = screen.querySelector("#comingSoonTitle");
  const blurbEl = screen.querySelector("#comingSoonBlurb");
  if (kicker) kicker.textContent = title;
  if (titleEl) titleEl.textContent = title;
  if (blurbEl) blurbEl.textContent = blurb;
  screen.classList.add("active");
  screen.style.display = "block";
  screen.setAttribute("aria-hidden", "false");
  hideChromeHeader();
  setHash(route);
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
  if (h === HASH_KNOWLEDGE) {
    showComingSoon("knowledge");
    return;
  }
  if (h === HASH_HARMONY) {
    showComingSoon("harmony");
    return;
  }
  // Empty or unknown (except leaderboard): stay on / restore root home only when on start-related hashes
  if (!h || h === "home") {
    showHome();
  }
}

export function initHomeIaRouting() {
  // Initial: if no special hash, ensure root home lanes visible
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
