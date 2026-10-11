import { displayAvatarUrl, getAuthState, openAuthModal } from "../auth.js";
import { ensureEcharts } from "../echarts-loader.js";
import { amountWithCoinHtml } from "../jiu-coin.js";
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

function showIdentity(view) {
  const node = document.getElementById("pvpResultIdentity");
  if (!node) return;
  if (view.identity?.stockName) {
    node.hidden = false;
    const code = view.identity.stockCode ? ` (${view.identity.stockCode})` : "";
    node.textContent = `${view.identity.stockName}${code}`;
  } else {
    node.hidden = true;
    node.textContent = "";
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
    text("pvpResultAnalysis", "复盘分析暂时不可用，胜负和奖励不受影响。");
    return;
  }
  text("pvpResultAnalysis", "");
  const hold = replay.buyHoldPpm;
  if (holdBox) holdBox.hidden = hold == null;
  text("pvpResultReplay", hold == null ? "" : formatPpm(hold));
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

async function paintChart(view) {
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
    }
    chart.setOption(buildKlineOption({
      mode: "pvp",
      bars,
      historyLength: market.historyLength || 0,
      pvpMarks: marksFromView(view),
      showDataZoomSlider: false,
      chartWidth: node.clientWidth,
      zoomAnchor: "start",
    }), true);
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

function showWin(view) {
  const dialog = document.getElementById("pvpWinDialog");
  if (!dialog) return;
  if (view?.me?.outcome !== "win") {
    dialog.hidden = true;
    return;
  }
  ensureSparks();
  const coin = document.getElementById("pvpWinCoin");
  const delta = Number(view?.me?.coinDelta);
  if (coin) {
    if (Number.isFinite(delta) && delta > 0) {
      coin.innerHTML = `获得 ${amountWithCoinHtml(delta, { size: 28 })}`;
    } else {
      coin.textContent = "";
    }
  }
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
  const title = view?.me?.ratingTitle ? `现在是${view.me.ratingTitle}。` : "";
  text(
    "pvpResultRatingNote",
    `这是段位分的变化，不是这局操作打几分。${title}赢了加分，输了减分。胜负只看收益，收益一样再比回撤。`,
  );
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
  paintReturn("pvpResultMe", view?.me?.returnPpm);
  text("pvpResultMeMeta", `回撤 ${formatPpm(view?.me?.mddPpm)} · 韭币 ${formatCoin(view?.me?.coinDelta)}`);
  text("pvpResultOppLabel", `${view?.opponent?.nickname || "对手"}收益`);
  paintReturn("pvpResultOpp", view?.opponent?.returnPpm);
  text("pvpResultOppMeta", `回撤 ${formatPpm(view?.opponent?.mddPpm)}`);
  paintSeats(view);
  paintRating(view);
  showIdentity(view);
  paintReplay(view);
  wireWin();
  showWin(view);
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
  paintChart(view).catch(() => {});
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
