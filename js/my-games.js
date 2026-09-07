/** Stage 3: my games list + basic stats */
import { getAuthState, openAuthModal } from "./auth.js";
import { fetchMyGames, fetchMyStats } from "./game-sync.js";

function hideOtherScreens() {
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "block";
    hdr.classList.add("compact");
  }
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "none";
  document.getElementById("gameScreen")?.classList.remove("active");
  document.getElementById("resultScreen")?.classList.remove("active");
  document.getElementById("academyScreen")?.classList.remove("active");
  document.getElementById("hindsightScreen")?.classList.remove("active");
}

function fmtPct(ppm) {
  if (ppm == null) return "—";
  const v = ppm / 10000;
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

export async function showMyGames() {
  const auth = getAuthState();
  if (!auth.user) {
    openAuthModal("login");
    return;
  }
  hideOtherScreens();
  let screen = document.getElementById("myGamesScreen");
  if (!screen) {
    screen = document.createElement("section");
    screen.id = "myGamesScreen";
    screen.className = "my-games-screen active";
    screen.innerHTML = `
      <div class="my-games-wrap">
        <div class="my-games-head">
          <button type="button" class="my-games-back" id="myGamesBackBtn">← 返回</button>
          <h2>我的战绩</h2>
          <p class="my-games-sub">仅统计当前规则 / 行情版本下已保存的有效完整局</p>
        </div>
        <div class="my-games-stats" id="myGamesStats">加载统计…</div>
        <div class="my-games-filters">
          <label>成交方式
            <select id="myGamesFillMode">
              <option value="">全部</option>
              <option value="next_open">次日开盘</option>
              <option value="same_close">当日收盘</option>
            </select>
          </label>
          <button type="button" class="my-games-refresh" id="myGamesRefreshBtn">刷新</button>
        </div>
        <div class="my-games-list" id="myGamesList">加载中…</div>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    screen.querySelector("#myGamesBackBtn").onclick = hideMyGames;
    screen.querySelector("#myGamesRefreshBtn").onclick = () => loadMyGamesPanel();
    screen.querySelector("#myGamesFillMode").onchange = () => loadMyGamesPanel();
  }
  screen.classList.add("active");
  screen.style.display = "block";
  await loadMyGamesPanel();
}

export function hideMyGames() {
  const screen = document.getElementById("myGamesScreen");
  if (screen) {
    screen.classList.remove("active");
    screen.style.display = "none";
  }
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "flex";
  const hdr = document.querySelector(".header");
  if (hdr) {
    hdr.style.display = "none";
    hdr.classList.remove("compact");
  }
}

async function loadMyGamesPanel() {
  const statsEl = document.getElementById("myGamesStats");
  const listEl = document.getElementById("myGamesList");
  const fill = document.getElementById("myGamesFillMode")?.value || "";
  const params = {};
  if (fill) params.fillMode = fill;
  try {
    const [stats, games] = await Promise.all([
      fetchMyStats(params),
      fetchMyGames({ ...params, limit: 20 }),
    ]);
    if (statsEl) {
      if (!stats.count) {
        statsEl.innerHTML = `<div class="stat-card">暂无有效战绩</div>`;
      } else {
        statsEl.innerHTML = `
          <div class="stat-card"><span>有效局数</span><strong>${stats.count}</strong></div>
          <div class="stat-card"><span>最佳</span><strong>${fmtPct(stats.bestReturnPpm)}</strong></div>
          <div class="stat-card"><span>平均</span><strong>${fmtPct(stats.avgReturnPpm)}</strong></div>
          <div class="stat-card"><span>胜率</span><strong>${stats.winRate == null ? "—" : stats.winRate + "%"}</strong></div>`;
      }
    }
    if (listEl) {
      const items = games.items || [];
      if (!items.length) {
        listEl.innerHTML = `<p class="my-games-empty">还没有已保存的对局。</p>`;
      } else {
        listEl.innerHTML = items
          .map(
            (g) => `<article class="my-game-item">
              <div class="my-game-main">
                <strong>${escapeHtml(g.stockName || "")} <span class="code">${escapeHtml(g.stockCode || "")}</span></strong>
                <span class="ret ${g.returnPpm > 0 ? "pos" : g.returnPpm < 0 ? "neg" : ""}">${fmtPct(g.returnPpm)}</span>
              </div>
              <div class="my-game-meta">
                ${g.fillMode === "same_close" ? "当日收盘" : "次日开盘"} · 成交 ${g.tradeCount} · ${escapeHtml((g.finishedAt || g.savedAt || "").slice(0, 19).replace("T", " "))} UTC
              </div>
            </article>`
          )
          .join("");
      }
    }
  } catch (e) {
    if (statsEl) statsEl.textContent = e.message || "加载失败";
    if (listEl) listEl.textContent = "";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
