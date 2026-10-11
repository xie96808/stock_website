import { openAuthModal } from "../auth.js";
import { ensureEcharts } from "../echarts-loader.js";
import { buildKlineOption } from "../kline-option.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import { formatCoin, formatPpm, marksFromView, reasonLabel, resultHeadline } from "./copy.js";
import { actionKey, pvpFetch, whenAuthReady } from "./transport.js";

let chart = null;
let paintToken = 0;
let shown = null;

function text(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

function destroyChart() {
  paintToken += 1;
  if (chart) {
    chart.dispose();
    chart = null;
  }
  window.resizePvpChart = null;
}

/** Drop a result chart when the player leaves this screen. */
export function releasePvpResult() {
  destroyChart();
  shown = null;
}

function showIdentity(view) {
  const node = document.getElementById("pvpResultIdentity");
  if (!node) return;
  if (view.identity?.stockName) {
    node.hidden = false;
    node.textContent = `${view.identity.stockName} ${view.identity.stockCode}`;
  } else {
    node.hidden = true;
    node.textContent = "";
  }
}

function gameDay(label) {
  const match = /^d(\d+)$/.exec(String(label || ""));
  return match ? Number(match[1]) : 0;
}

function slicedView(view, day) {
  const market = view?.market;
  if (!market) return view;
  const bars = (market.bars || []).filter((bar) => gameDay(bar.label) >= 1 && gameDay(bar.label) <= day);
  const resolvedActions = (view.resolvedActions || []).filter((row) => row.round + 1 <= day);
  return {
    ...view,
    resolvedActions,
    market: { ...market, bars, revealedDay: day },
  };
}

function paintReplay(view) {
  const replay = view?.replay;
  const curve = document.getElementById("pvpResultCurve");
  const gaps = document.getElementById("pvpResultGaps");
  if (curve) curve.replaceChildren();
  if (gaps) gaps.replaceChildren();
  if (!replay || replay.status !== "ready" || !replay.me) {
    text("pvpResultReplay", "");
    text("pvpResultAnalysis", "复盘分析暂时不可用，胜负和奖励不受影响。");
    return;
  }
  text("pvpResultAnalysis", "");
  const hold = replay.buyHoldPpm == null ? "" : `买入持有 ${formatPpm(replay.buyHoldPpm)}`;
  text("pvpResultReplay", hold);
  const rows = [
    ["我", replay.me],
    [view.opponent?.nickname || "对手", replay.opponent],
  ];
  for (const [name, side] of rows) {
    if (!side) continue;
    const last = side.curve?.[side.curve.length - 1];
    const item = document.createElement("li");
    const valued = side.valued ? " · 已估值" : "";
    item.textContent = `${name} ${formatPpm(last?.returnPpm)} · 买 ${side.buyCount} · 卖 ${side.sellCount} · 曲线回撤 ${formatPpm(side.curveMddPpm)}${valued}`;
    curve?.appendChild(item);
  }
  for (const row of replay.divergences || []) {
    const item = document.createElement("li");
    item.textContent = row.text || "";
    gaps?.appendChild(item);
  }
}

function wireSlider(view) {
  const label = document.getElementById("pvpResultSliderLabel");
  const slider = document.getElementById("pvpResultDaySlider");
  const day = document.getElementById("pvpResultDay");
  const max = view?.market?.revealedDay || view?.market?.bars?.length || 0;
  if (!label || !slider || !max) {
    if (label) label.hidden = true;
    return;
  }
  label.hidden = false;
  slider.min = "1";
  slider.max = String(max);
  slider.value = String(max);
  if (day) day.textContent = String(max);
  slider.oninput = () => {
    const next = Number(slider.value) || 1;
    if (day) day.textContent = String(next);
    paintChart(view, next).catch(() => {});
  };
}

async function paintChart(view, day) {
  const node = document.getElementById("pvpResultChart");
  const error = document.getElementById("pvpResultChartError");
  const market = view?.market;
  if (!node || !market?.bars?.length) {
    if (node) node.hidden = true;
    return;
  }
  const mine = ++paintToken;
  const slice = slicedView(view, day);
  const bars = [...(market.history || []), ...(slice.market?.bars || [])];
  try {
    const echarts = await ensureEcharts();
    if (mine !== paintToken || shown?.matchId !== view.matchId) return;
    node.hidden = false;
    if (error) error.hidden = true;
    if (!chart) {
      chart = echarts.init(node);
      window.resizePvpChart = () => { if (chart) chart.resize(); };
    }
    chart.setOption(buildKlineOption({
      mode: "pvp",
      bars,
      historyLength: market.historyLength || 0,
      pvpMarks: marksFromView(slice),
      showDataZoomSlider: false,
    }), true);
    chart.resize();
  } catch {
    if (mine !== paintToken) return;
    if (error) error.hidden = false;
    node.hidden = true;
  }
}

function wireReport(view) {
  const form = document.getElementById("pvpReportForm");
  const note = document.getElementById("pvpReportNote");
  if (note) note.textContent = "";
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

export function showPvpResult(view) {
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
  text("pvpResultMe", `我的收益 ${formatPpm(view?.me?.returnPpm)} · 回撤 ${formatPpm(view?.me?.mddPpm)} · 韭币 ${formatCoin(view?.me?.coinDelta)}`);
  text("pvpResultOpp", `${view?.opponent?.nickname || "对手"} 收益 ${formatPpm(view?.opponent?.returnPpm)} · 回撤 ${formatPpm(view?.opponent?.mddPpm)}`);
  const delta = view?.me?.ratingDelta;
  text("pvpResultRating", delta == null ? "" : `评分 ${formatCoin(delta)}`);
  showIdentity(view);
  paintReplay(view);
  wireSlider(view);
  wireReport(view);
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
  const day = view?.market?.revealedDay || view?.market?.bars?.length || 1;
  paintChart(view, day).catch(() => {});
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
