import { displayAvatarUrl, getAuthState, openAuthModal } from "../auth.js";
import { ensureEcharts } from "../echarts-loader.js";
import { buildKlineOption } from "../kline-option.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { buildPvpKlineAnalysis } from "./analysis-view.js";
import { coinIconHtml } from "../jiu-coin.js";
import { colorReturnHtml, escapeHtml, formatCoin, formatPpm, formatWindow, marksFromView, reasonLabel, resultHeadline } from "./copy.js";
import { appendRankProgress } from "./profile-battle.js";
import { actionKey, pvpFetch, whenAuthReady } from "./transport.js";

let chart = null;
let chartObserver = null;
let paintToken = 0;
let shown = null;
let fireworksTimer = 0;

function text(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

function html(id, value) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = value || "";
}

function destroyChart() {
  paintToken += 1;
  if (chartObserver) {
    chartObserver.disconnect();
    chartObserver = null;
  }
  if (chart) {
    chart.dispose();
    chart = null;
  }
  window.resizePvpChart = null;
  window.clearTimeout(fireworksTimer);
  fireworksTimer = 0;
}

/** Drop a result chart when the player leaves this screen. */
export function releasePvpResult() {
  destroyChart();
  shown = null;
  const dialog = document.getElementById("pvpWinDialog");
  if (dialog) dialog.hidden = true;
}

function paintSeat(prefix, face, fallback) {
  const img = document.getElementById(`${prefix}Avatar`);
  const name = document.getElementById(`${prefix}Name`);
  const who = face?.nickname || fallback;
  if (name) name.textContent = who;
  if (img) {
    img.src = displayAvatarUrl(face || { avatarId: 1 });
    img.alt = "";
  }
}

function paintSeats(view) {
  const auth = getAuthState().user;
  paintSeat("pvpResultMe", {
    nickname: view?.me?.nickname || auth?.nickname,
    avatarId: view?.me?.avatarId || auth?.avatarId || 1,
    avatarUrl: view?.me?.avatarUrl || auth?.avatarUrl || null,
  }, "我");
  paintSeat("pvpResultOpp", view?.opponent, "对手");
  const meCard = document.getElementById("pvpResultMeCard");
  const oppCard = document.getElementById("pvpResultOppCard");
  if (meCard) meCard.dataset.outcome = view?.me?.outcome || "";
  if (oppCard) oppCard.dataset.outcome = view?.opponent?.outcome || "";
}

function paintIdentity(prefix, view) {
  const name = document.getElementById(`${prefix}Identity`);
  const period = document.getElementById(`${prefix}Period`);
  const identity = view?.identity;
  if (name) {
    if (identity?.stockName) {
      name.hidden = false;
      const code = identity.stockCode ? ` (${identity.stockCode})` : "";
      name.textContent = `${identity.stockName}${code}`;
    } else {
      name.hidden = true;
      name.textContent = "";
    }
  }
  if (period) {
    const windowText = formatWindow(identity);
    period.hidden = !windowText;
    period.textContent = windowText;
  }
}

function paintReturn(id, ppm) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = formatPpm(ppm);
  node.classList.remove("pvp-up", "pvp-down", "pvp-flat");
  const value = Number(ppm);
  if (!Number.isFinite(value)) return;
  node.classList.add(value > 0 ? "pvp-up" : value < 0 ? "pvp-down" : "pvp-flat");
}

function paintReplay(view) {
  const replay = view?.replay;
  const curve = document.getElementById("pvpResultCurve");
  const gaps = document.getElementById("pvpResultGaps");
  const holdBox = document.getElementById("pvpResultHoldBox");
  if (curve) curve.replaceChildren();
  if (gaps) gaps.replaceChildren();
  if (!replay || replay.status !== "ready" || !replay.me) {
    if (holdBox) holdBox.hidden = true;
    text("pvpResultReplay", "");
    return;
  }
  const hold = replay.buyHoldPpm;
  if (holdBox) holdBox.hidden = hold == null;
  paintReturn("pvpResultReplay", hold);
  const rows = [
    ["我", replay.me],
    [view.opponent?.nickname || "对手", replay.opponent],
  ];
  for (const [name, side] of rows) {
    if (!side) continue;
    const last = side.curve?.[side.curve.length - 1];
    const item = document.createElement("li");
    const valued = side.valued ? " · 已估值" : "";
    item.innerHTML = `${escapeHtml(name)} ${colorReturnHtml(formatPpm(last?.returnPpm))} · 买 ${side.buyCount} · 卖 ${side.sellCount} · 曲线回撤 ${escapeHtml(formatPpm(side.curveMddPpm))}${escapeHtml(valued)}`;
    curve?.appendChild(item);
  }
  for (const row of replay.divergences || []) {
    const item = document.createElement("li");
    item.textContent = row.text || "";
    gaps?.appendChild(item);
  }
}

function paintAnalysis(view) {
  const node = document.getElementById("pvpResultAnalysis");
  if (!node) return null;
  try {
    const built = buildPvpKlineAnalysis(view);
    if (!built) {
      node.innerHTML = "<p>复盘分析暂时不可用，胜负和奖励不受影响。</p>";
      return null;
    }
    node.innerHTML = built.html;
    return built.bestPoints;
  } catch {
    node.innerHTML = "<p>复盘分析暂时不可用，胜负和奖励不受影响。</p>";
    return null;
  }
}

async function paintChart(view, bestPoints) {
  const node = document.getElementById("pvpResultChart");
  const error = document.getElementById("pvpResultChartError");
  const market = view?.market;
  if (!node || !market?.bars?.length) {
    if (node) node.hidden = true;
    return;
  }
  const mine = ++paintToken;
  const bars = [...(market.history || []), ...(market.bars || [])];
  try {
    const echarts = await ensureEcharts();
    if (mine !== paintToken || shown?.matchId !== view.matchId) return;
    node.hidden = false;
    if (error) error.hidden = true;
    if (!chart) {
      chart = echarts.init(node);
      window.resizePvpChart = () => { if (chart) chart.resize(); };
      if (typeof ResizeObserver === "function") {
        chartObserver = new ResizeObserver(() => {
          window.requestAnimationFrame(() => { if (chart) chart.resize(); });
        });
        chartObserver.observe(node);
      }
      window.setTimeout(() => { if (chart) chart.resize(); }, 50);
    }
    chart.setOption(buildKlineOption({
      mode: "pvp",
      bars,
      historyLength: market.historyLength || 0,
      pvpMarks: marksFromView(view),
      bestPoints: bestPoints || null,
      showDataZoomSlider: false,
      resetDataZoom: true,
    }), { replaceMerge: ["series"] });
    chart.resize();
  } catch {
    if (mine !== paintToken) return;
    if (error) error.hidden = false;
    node.hidden = true;
  }
}

function ensureSparks() {
  const host = document.getElementById("pvpFireworks");
  if (!host || host.childElementCount) return;
  const colors = ["#e05252", "#c45c3a", "#f5c542", "#8a7350", "#3db86a"];
  for (let i = 0; i < 18; i += 1) {
    const spark = document.createElement("i");
    const angle = (i / 18) * Math.PI * 2;
    spark.style.left = `${20 + (i * 11) % 60}%`;
    spark.style.top = `${18 + (i * 7) % 22}%`;
    spark.style.background = colors[i % colors.length];
    spark.style.color = colors[i % colors.length];
    spark.style.setProperty("--dx", `${Math.round(Math.cos(angle) * 128)}px`);
    spark.style.setProperty("--dy", `${Math.round(Math.sin(angle) * 86)}px`);
    spark.style.animationDelay = `${(i % 7) * 0.08}s`;
    host.append(spark);
  }
}

function coinPhrase(delta) {
  const icon = coinIconHtml({ size: 14 });
  if (delta == null || !Number.isFinite(Number(delta))) {
    return `<span class="jiu-coin-amt" aria-label="韭币未知">—${icon}</span>`;
  }
  const value = Number(delta);
  if (value > 0) {
    return `<span class="jiu-coin-amt" aria-label="获得 ${value} 韭币">获得 <span class="jiu-price-num">${value}</span>${icon}</span>`;
  }
  if (value < 0) {
    const lost = Math.abs(value);
    return `<span class="jiu-coin-amt" aria-label="失去 ${lost} 韭币">失去 <span class="jiu-price-num">${lost}</span>${icon}</span>`;
  }
  return `<span class="jiu-coin-amt" aria-label="韭币 0"><span class="jiu-price-num">0</span>${icon}</span>`;
}

function paintSettleReturn(id, ppm) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = formatPpm(ppm);
  node.classList.remove("pvp-up", "pvp-down", "pvp-flat");
  const value = Number(ppm);
  if (!Number.isFinite(value)) return;
  node.classList.add(value > 0 ? "pvp-up" : value < 0 ? "pvp-down" : "pvp-flat");
}

function paintSettleSide(which, face, fallback) {
  const img = document.getElementById(`pvpWin${which}Avatar`);
  const name = document.getElementById(`pvpWin${which}Name`);
  if (name) name.textContent = face?.nickname || fallback;
  if (img) {
    img.src = displayAvatarUrl(face || { avatarId: 1 });
    img.alt = "";
  }
  paintSettleReturn(`pvpWin${which}Return`, face?.returnPpm);
  html(`pvpWin${which}Coin`, coinPhrase(face?.coinDelta));
}

function showSettle(view, celebrate) {
  const dialog = document.getElementById("pvpWinDialog");
  if (!dialog) return;
  if (!celebrate) {
    dialog.hidden = true;
    return;
  }
  const outcome = view?.me?.outcome || "";
  const fireworks = document.getElementById("pvpFireworks");
  window.clearTimeout(fireworksTimer);
  if (fireworks) {
    fireworks.hidden = outcome !== "win";
    fireworks.classList.remove("is-done");
  }
  if (outcome === "win") {
    ensureSparks();
    // Stop compositor work after a few bursts (CSS animation-iteration-count is finite).
    fireworksTimer = window.setTimeout(() => {
      fireworks?.classList.add("is-done");
    }, 4000);
  }
  text("pvpWinTitle", resultHeadline(view));
  paintIdentity("pvpWin", view);
  const auth = getAuthState().user;
  paintSettleSide("Me", {
    nickname: view?.me?.nickname || auth?.nickname,
    avatarId: view?.me?.avatarId || auth?.avatarId || 1,
    avatarUrl: view?.me?.avatarUrl || auth?.avatarUrl || null,
    returnPpm: view?.me?.returnPpm,
    coinDelta: view?.me?.coinDelta,
    mddPpm: view?.me?.mddPpm,
  }, "我");
  paintSettleSide("Opp", view?.opponent, "对手");
  dialog.hidden = false;
  document.getElementById("pvpWinOk")?.focus();
}

function wireWin() {
  const dialog = document.getElementById("pvpWinDialog");
  const button = document.getElementById("pvpWinOk");
  if (!button || button.dataset.wired === "1") return;
  button.dataset.wired = "1";
  button.addEventListener("click", () => {
    if (dialog) dialog.hidden = true;
  });
}

function paintRating(view) {
  const box = document.getElementById("pvpResultRatingBox");
  const delta = view?.me?.ratingDelta;
  if (!box) return;
  if (delta == null || !Number.isFinite(Number(delta))) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  text("pvpResultRating", formatCoin(delta));
  const progress = document.getElementById("pvpResultRankProgress");
  if (progress) {
    progress.replaceChildren();
    appendRankProgress(progress, view?.me?.ratingAfter);
  }
}

function wireReport(view) {
  const form = document.getElementById("pvpReportForm");
  const note = document.getElementById("pvpReportNote");
  const toggle = document.getElementById("pvpReportToggle");
  const panel = document.getElementById("pvpReportPanel");
  if (note) note.textContent = "";
  if (panel) panel.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
  if (toggle && toggle.dataset.wired !== "1") {
    toggle.dataset.wired = "1";
    toggle.addEventListener("click", () => {
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!view?.matchId) return;
    const reason = document.getElementById("pvpReportReason")?.value || "other";
    const detail = document.getElementById("pvpReportDetail")?.value || "";
    const submit = document.getElementById("pvpReportSubmit");
    if (submit) submit.disabled = true;
    try {
      await pvpFetch(`/pvp/matches/${encodeURIComponent(view.matchId)}/report`, {
        method: "POST",
        body: { reason, detail },
        idempotencyKey: actionKey(view.matchId, "report"),
      });
      if (note) note.textContent = "已提交。";
    } catch (err) {
      if (submit) submit.disabled = false;
      if (note) note.textContent = err.message || "举报没有提交";
    }
  };
}

function wireGifts(view) {
  const box = document.getElementById("pvpGifts");
  const note = document.getElementById("pvpGiftNote");
  if (note) note.textContent = "";
  const buttons = [...document.querySelectorAll("#pvpGifts .pvp-gift-send")];
  const canSend = !!view?.opponent?.userId && !!view?.matchId;
  if (box) box.hidden = !canSend;
  for (const button of buttons) {
    button.disabled = !canSend;
    button.onclick = async () => {
      if (!canSend || button.disabled) return;
      button.classList.remove("is-sent");
      void button.offsetWidth;
      button.classList.add("is-sent");
      for (const item of buttons) item.disabled = true;
      try {
        await pvpFetch(`/pvp/matches/${encodeURIComponent(view.matchId)}/reactions`, {
          method: "POST",
          body: { kind: button.dataset.kind },
        });
        if (note) note.textContent = "已送出。";
      } catch (err) {
        if (note) note.textContent = err.message || "没能送出";
      } finally {
        window.setTimeout(() => {
          for (const item of buttons) item.disabled = false;
        }, 1300);
      }
    };
  }
}

function wireBlock(view) {
  const button = document.getElementById("pvpResultBlock");
  const note = document.getElementById("pvpReportNote");
  if (!button) return;
  const userId = view?.opponent?.userId;
  button.hidden = !userId;
  button.disabled = false;
  button.onclick = async () => {
    if (!userId) return;
    button.disabled = true;
    try {
      await pvpFetch("/pvp/blocks", {
        method: "POST",
        body: { userId },
        idempotencyKey: actionKey(userId, "block"),
      });
      if (note) note.textContent = "已屏蔽，之后不能再约战。这局的结果不变。";
    } catch (err) {
      button.disabled = false;
      if (note) note.textContent = err.message || "没能屏蔽";
    }
  };
}

export function showPvpResult(view, { celebrate = false } = {}) {
  destroyChart();
  shown = view || null;
  prepareScreen(Route.PVP_RESULT);
  activateScreen(Route.PVP_RESULT);
  setRouteHash(Route.PVP_RESULT);
  if (view?.matchId) {
    try { history.replaceState(null, "", `#/pvp/${view.matchId}`); } catch { /* ignore */ }
  }
  text("pvpResultHeadline", resultHeadline(view));
  text("pvpResultReason", view?.terminal?.reason ? reasonLabel(view.terminal.reason) : "");
  paintReturn("pvpResultMe", view?.me?.returnPpm);
  html("pvpResultMeMeta", `回撤 ${escapeHtml(formatPpm(view?.me?.mddPpm))} · ${coinPhrase(view?.me?.coinDelta)}`);
  text("pvpResultOppLabel", `${view?.opponent?.nickname || "对手"}收益`);
  paintReturn("pvpResultOpp", view?.opponent?.returnPpm);
  text("pvpResultOppMeta", `回撤 ${formatPpm(view?.opponent?.mddPpm)}`);
  paintSeats(view);
  try { paintRating(view); } catch { /* rating chrome must not block chart/analysis */ }
  paintIdentity("pvpResult", view);
  paintReplay(view);
  let bestPoints = null;
  try { bestPoints = paintAnalysis(view); } catch {
    const node = document.getElementById("pvpResultAnalysis");
    if (node) node.innerHTML = "<p>复盘分析暂时不可用，胜负和奖励不受影响。</p>";
  }
  wireWin();
  showSettle(view, celebrate);
  wireReport(view);
  wireGifts(view);
  wireBlock(view);
  const again = document.getElementById("pvpResultAgain");
  if (again) {
    again.hidden = !view?.opponent?.userId;
    again.dataset.userId = view?.opponent?.userId ? String(view.opponent.userId) : "";
    again.onclick = () => {
      import("./lobby.js")
        .then((mod) => mod.challengeFromResult(again.dataset.userId))
        .catch(() => {});
    };
  }
  paintChart(view, bestPoints).catch(() => {});
}

export async function openPvpMatch(matchId) {
  const auth = await whenAuthReady();
  if (!auth.user) {
    openAuthModal("login");
    return;
  }
  const { data } = await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}`);
  if (data.status === "settled" || data.status === "aborted") {
    showPvpResult(data);
    return;
  }
  const room = await import("./room.js");
  room.showPvpRoom(matchId, data);
}
