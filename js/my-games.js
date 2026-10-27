/** Stage 3: my games list + basic stats */
import { getAuthState, openAuthModal } from "./auth.js";
import { fetchMyGames, fetchMyStats } from "./game-sync.js";
import {
  Route,
  prepareScreen,
  activateScreen,
  deactivateScreen,
  setHeaderChrome,
} from "./screen-router.js";
import { formatShanghaiDateTime } from "./time.js";
import { captureOrigin, mountBackBars } from "./nav-back.js";

/** 列表每条标出玩法：统计卡只算经典局，列表却包含所有玩法，不标会以为是经典局。 */
const GAME_KIND_LABELS = {
  classic: "经典练习",
  oneshot: "一把梭",
  survival: "生存模式",
  daily: "今日挑战",
  puzzle: "残局",
};
export function gameKindLabel(kind) {
  return GAME_KIND_LABELS[kind] || GAME_KIND_LABELS.classic;
}


/** 战绩列表里的复盘按钮文案：买过 → 重看；没买 → 带价格；不支持的玩法不显示。 */
export function reviewButtonCopy(review) {
  if (!review || !review.supported) return null;
  if (review.owned && review.owned.route) {
    return { label: review.owned.hold ? "重看复盘 · 含死拿" : "重看复盘", owned: true };
  }
  return { label: "复盘 · 30 韭币", owned: false };
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
  captureOrigin("my-games");
  prepareScreen(Route.MY_GAMES);
  let screen = document.getElementById("myGamesScreen");
  if (!screen) {
    screen = document.createElement("section");
    screen.id = "myGamesScreen";
    screen.className = "my-games-screen active";
    screen.innerHTML = `
      <div class="my-games-wrap">
        <div class="sg-backbar" data-sg-back="my-games"></div>
        <div class="my-games-head">
          <h2>我的战绩</h2>
        </div>
        <div class="my-games-stats" id="myGamesStats">加载统计…</div>
        <p class="my-games-stats-note" id="myGamesStatsNote"></p>
        <div class="my-games-filters">
          <label class="my-games-filter-label">成交方式
            <select id="myGamesFillMode" class="my-games-select sketch-select">
              <option value="">全部</option>
              <option value="next_open">次日开盘</option>
              <option value="same_close">当日收盘</option>
            </select>
          </label>
          <button type="button" class="my-games-refresh ctl ctl-secondary" id="myGamesRefreshBtn" data-ctl-kind="secondary" data-state="default"><span class="ctl-label">刷新</span></button>
        </div>
        <div class="my-games-list" id="myGamesList">加载中…</div>
      </div>`;
    document.querySelector(".container")?.appendChild(screen);
    mountBackBars(screen);
    screen.querySelector("#myGamesRefreshBtn").onclick = () => loadMyGamesPanel();
    screen.querySelector("#myGamesFillMode").onchange = () => loadMyGamesPanel();
    screen.querySelector("#myGamesList").addEventListener("click", async (ev) => {
      const btn = ev.target.closest?.("[data-review-game]");
      if (!btn) return;
      const gameId = btn.getAttribute("data-review-game");
      if (!gameId) return;
      try {
        const m = await import("./route-replay.js");
        await m.openReviewReplay(gameId);
      } catch { /* the replay shows its own toast */ }
    });
    // 复盘窗口关闭后（可能刚买了）刷新列表上的状态。
    document.addEventListener("rr:closed", () => {
      if (document.getElementById("myGamesScreen")?.classList.contains("active")) loadMyGamesPanel();
    });
  }
  activateScreen(Route.MY_GAMES);
  await loadMyGamesPanel();
}

export function hideMyGames() {
  deactivateScreen(Route.MY_GAMES);
  if (typeof window.restoreSimShell === "function") {
    window.restoreSimShell();
    return;
  }
  setHeaderChrome("hidden");
  const start = document.getElementById("startScreen");
  if (start) start.style.display = "flex";
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
    const noteEl = document.getElementById("myGamesStatsNote");
    if (noteEl) {
      // Same rule as the leaderboards: only classic games with >=1 trade count (audit LB-04).
      const scope = fill === "next_open" ? "次日开盘" : fill === "same_close" ? "当日收盘" : "两种成交方式合计";
      const skipped = Number(stats.excludedZeroTrade || 0);
      noteEl.textContent =
        `统计范围：经典局 · ${scope} · 仅计至少交易 1 笔的局（与排行榜同口径）` +
        (skipped ? `；另有 ${skipped} 局未交易，不计入。` : "。");
    }
    if (statsEl) {
      if (!stats.count) {
        statsEl.innerHTML = `<div class="stat-card">暂无有效战绩</div>`;
      } else {
        statsEl.innerHTML = `
          <div class="stat-card"><span>有效局数</span><strong>${stats.count}</strong></div>
          <div class="stat-card"><span>最佳收益率</span><strong>${fmtPct(stats.bestReturnPpm)}</strong></div>
          <div class="stat-card"><span>平均收益率</span><strong>${fmtPct(stats.avgReturnPpm)}</strong></div>
          <div class="stat-card"><span>胜率</span><strong>${stats.winRate == null ? "—" : stats.winRate + "%"}</strong></div>`;
      }
    }
    if (listEl) {
      const items = games.items || [];
      if (!items.length) {
        listEl.innerHTML = `<p class="my-games-empty">还没有已保存的对局。</p>`;
      } else {
        listEl.innerHTML = items
          .map((g) => {
            const rv = reviewButtonCopy(g.review);
            const rvBtn = rv
              ? `<button type="button" class="my-game-review ${rv.owned ? "is-owned" : ""}" data-review-game="${escapeHtml(g.gameId || "")}">${escapeHtml(rv.label)}</button>`
              : "";
            return `<article class="my-game-item">
              <div class="my-game-main">
                <strong>${escapeHtml(g.stockName || "")} <span class="code">${escapeHtml(g.stockCode || "")}</span></strong>
                <span class="ret ${g.returnPpm > 0 ? "pos" : g.returnPpm < 0 ? "neg" : ""}" title="收益率">${fmtPct(g.returnPpm)}</span>
              </div>
              <div class="my-game-meta">
                <span class="my-game-kind">${escapeHtml(gameKindLabel(g.gameKind))}</span> · ${g.fillMode === "same_close" ? "当日收盘" : "次日开盘"} · 成交 ${g.tradeCount} · ${escapeHtml(formatShanghaiDateTime(g.finishedAt || g.savedAt) || "—")}
              </div>
              ${rvBtn}
            </article>`;
          })
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
