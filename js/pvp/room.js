import { displayAvatarUrl, getAuthState } from "../auth.js";
import { ensureEcharts } from "../echarts-loader.js";
import { coinIconHtml } from "../jiu-coin.js";
import { buildKlineOption } from "../kline-option.js";
import { Route, prepareScreen, activateScreen, setRouteHash } from "../screen-router.js";
import {
  formatPpm,
  marksFromView,
  remainingMs,
  roundCaption,
} from "./copy.js";
import { isSubmitting, noteRevision, setSubmitting } from "./store.js";
import { actionKey, clearActionKeys, holdPvpSocket, pvpFetch, startPoll } from "./transport.js";

function stake(amount) {
  return `<span class="jiu-coin-amt"><span class="jiu-price-num">${amount}</span>${coinIconHtml({ size: 14 })}</span>`;
}

function readyCopyFrom(economy) {
  const entry = Number(economy?.entryCost);
  const win = Number(economy?.winReward);
  const entryCost = Number.isFinite(entry) && entry > 0 ? entry : 20;
  const winReward = Number.isFinite(win) && win > 0 ? win : 35;
  const net = winReward - entryCost;
  return `双方各付 ${stake(entryCost)}。胜者到账 ${stake(winReward)}（净赚 ${stake(net)}），负者净减 ${stake(entryCost)}，平局退回 ${stake(entryCost)}。一局最长约 15 分钟。切到后台后，计时仍按服务器继续。`;
}

let matchId = null;
let view = null;
let fetchedAt = 0;
let chart = null;
let chartKey = "";
let chartZoomKey = "";
let chartObserver = null;
let stopPoll = null;
let stopHeartbeat = null;
let releaseSocket = null;
let clockTimer = 0;
let wired = false;
let postedLock = false;
let pendingNetwork = false;
let readyInFlight = false;
let nudgeKey = "";
let lastClockAnnounce = "";

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null ? "" : String(value);
}

function setHtml(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html || "";
}

function toneWord(ppm) {
  if (ppm == null || !Number.isFinite(Number(ppm))) return "";
  if (Number(ppm) > 0) return "上涨";
  if (Number(ppm) < 0) return "下跌";
  return "持平";
}

function secondsLeft(ms) {
  if (ms == null) return null;
  return Math.max(0, Math.ceil(ms / 1000));
}

function paintClockFace(id, seconds, kicker, urgent) {
  const box = document.getElementById(id);
  const num = document.getElementById(`${id}Num`);
  const kickerNode = document.getElementById(`${id}Kicker`);
  if (kickerNode) kickerNode.textContent = kicker;
  if (num) num.textContent = seconds == null ? "—" : String(seconds);
  if (box) box.classList.toggle("is-urgent", urgent === true);
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

function paintSeats() {
  const auth = getAuthState().user;
  paintSeat("pvpSeatMe", {
    nickname: view?.me?.nickname || auth?.nickname,
    avatarId: view?.me?.avatarId || auth?.avatarId || 1,
    avatarUrl: view?.me?.avatarUrl || auth?.avatarUrl || null,
  }, "我");
  paintSeat("pvpSeatOpp", view?.opponent, "对手");
}

function paintReadyMark(id, ready, show, label) {
  const node = document.getElementById(id);
  if (!node) return;
  node.hidden = !show;
  node.dataset.ready = ready ? "1" : "0";
  node.setAttribute("aria-label", label || (ready ? "已准备" : "还未准备"));
}

function paintReturn(id, ppm) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = formatPpm(ppm);
  node.classList.remove("pvp-up", "pvp-down", "pvp-flat");
  const value = Number(ppm);
  if (!Number.isFinite(value)) return;
  node.classList.add(value > 0 ? "pvp-up" : value < 0 ? "pvp-down" : "pvp-flat");
  const word = toneWord(ppm);
  node.setAttribute("aria-label", word ? `${formatPpm(ppm)} ${word}` : formatPpm(ppm));
}

function stopLoops() {
  if (stopPoll) stopPoll();
  stopPoll = null;
  if (stopHeartbeat) stopHeartbeat();
  stopHeartbeat = null;
  if (releaseSocket) releaseSocket();
  releaseSocket = null;
  window.clearInterval(clockTimer);
  clockTimer = 0;
}

function destroyChart() {
  chartKey = "";
  chartZoomKey = "";
  if (chartObserver) {
    chartObserver.disconnect();
    chartObserver = null;
  }
  if (chart) {
    chart.dispose();
    chart = null;
  }
  if (window.resizePvpChart) window.resizePvpChart = null;
}

export function leavePvpRoom({ deferChart = false } = {}) {
  matchId = null;
  view = null;
  postedLock = false;
  pendingNetwork = false;
  readyInFlight = false;
  clearActionKeys();
  stopLoops();
  closeLeave();
  if (deferChart) window.setTimeout(() => destroyChart(), 0);
  else destroyChart();
}

function dialog() {
  return document.getElementById("pvpLeaveDialog");
}

function leaveButtons() {
  return ["pvpLeaveStay", "pvpLeaveLobby", "pvpLeaveForfeit"]
    .map((id) => document.getElementById(id))
    .filter((node) => node && !node.hidden);
}

function closeLeave() {
  const node = dialog();
  if (node) node.hidden = true;
  document.getElementById("pvpRoomLeave")?.focus();
}

function openLeave() {
  const node = dialog();
  if (!node) return;
  const forfeit = document.getElementById("pvpLeaveForfeit");
  if (forfeit) forfeit.hidden = view?.status !== "playing";
  node.hidden = false;
  leaveButtons()[0]?.focus();
}

function onLeaveKey(event) {
  const node = dialog();
  if (!node || node.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLeave();
    return;
  }
  if (event.key !== "Tab") return;
  const buttons = leaveButtons();
  if (!buttons.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function showResult(next) {
  const id = matchId;
  leavePvpRoom();
  const result = await import("./result.js");
  if (next) result.showPvpResult(next, { celebrate: true });
  else if (id) await result.openPvpMatch(id);
}

function announceClock(id, seconds) {
  const box = document.getElementById(id);
  if (!box) return;
  if (seconds === 10 || seconds === 5 || seconds === 0) {
    const key = `${id}:${seconds}`;
    if (lastClockAnnounce !== key) {
      lastClockAnnounce = key;
      box.setAttribute("aria-live", "polite");
      box.setAttribute("aria-label", `剩余 ${seconds} 秒`);
    }
  } else {
    box.removeAttribute("aria-live");
  }
}

function paintClock() {
  if (!view || !matchId) return;
  if (view.status === "waiting_ready") {
    const left = remainingMs(view.readyDeadlineAt, view.serverNow, fetchedAt);
    const seconds = secondsLeft(left);
    paintClockFace("pvpReadyClock", seconds, "准备剩余", seconds != null && seconds <= 5);
    announceClock("pvpReadyClock", seconds);
    const readyBtn = document.getElementById("pvpReadyBtn");
    if (readyBtn && left != null && left <= 0) readyBtn.disabled = true;
    if (left != null && left <= 0) {
      // Keep re-fetching so ready_timeout settlement clears the room.
      if (nudgeKey !== "ready-due") {
        nudgeKey = "ready-due";
        refresh().catch(() => {});
      } else if ((Date.now() - fetchedAt) > 2000) {
        refresh().catch(() => {});
      }
    } else {
      nudgeKey = "ready-live";
    }
    return;
  }
  if (view.status !== "playing") return;
  const opensIn = remainingMs(view.opensAt, view.serverNow, fetchedAt);
  const left = remainingMs(view.deadlineAt, view.serverNow, fetchedAt);
  const waiting = opensIn != null && opensIn > 0;
  const seconds = secondsLeft(waiting ? opensIn : left);
  paintClockFace(
    "pvpClock",
    seconds,
    waiting ? "下一手可操作" : "本手剩余",
    !waiting && seconds != null && seconds <= 5,
  );
  announceClock("pvpClock", seconds);
  if (opensIn != null && opensIn > 0) {
    nudgeKey = `wait:${view.revision}`;
  } else if (left != null && left <= 0) {
    if (nudgeKey !== `due:${view.revision}`) {
      nudgeKey = `due:${view.revision}`;
      refresh().catch(() => {});
    }
  } else if (nudgeKey === `wait:${view.revision}`) {
    nudgeKey = `open:${view.revision}`;
    refresh().catch(() => {});
  } else {
    nudgeKey = `open:${view.revision}`;
  }
  paintActions();
}

function paintActions() {
  const playing = view?.status === "playing";
  const opensIn = playing ? remainingMs(view.opensAt, view.serverNow, fetchedAt) : null;
  const left = playing ? remainingMs(view.deadlineAt, view.serverNow, fetchedAt) : null;
  const closed = !playing
    || (opensIn != null && opensIn > 0)
    || (left != null && left <= 0)
    || postedLock
    || pendingNetwork
    || isSubmitting()
    || view.me?.lockedToday;
  const buy = document.getElementById("pvpBuy");
  const sell = document.getElementById("pvpSell");
  const hold = document.getElementById("pvpHold");
  if (buy) buy.disabled = closed || !view?.me?.canBuy;
  if (sell) sell.disabled = closed || !view?.me?.canSell;
  if (hold) {
    hold.disabled = closed || !view?.me?.canHold;
    hold.textContent = view?.me?.holding ? "持有" : "观望";
  }
  if (view?.status !== "playing") return;
  const submitting = isSubmitting();
  const locked = postedLock || pendingNetwork || submitting || !!view?.me?.lockedToday;
  const oppLocked = !!view?.opponent?.lockedToday;
  paintReadyMark("pvpReadyMarkMe", locked, locked, "已行动");
  paintReadyMark("pvpReadyMarkOpp", oppLocked, oppLocked, "已行动");
}

function bindChartResize(node) {
  window.resizePvpChart = () => { if (chart) chart.resize(); };
  if (chartObserver) chartObserver.disconnect();
  if (typeof ResizeObserver === "function") {
    chartObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => { if (chart) chart.resize(); });
    });
    chartObserver.observe(node);
  } else {
    chartObserver = null;
  }
  window.setTimeout(() => { if (chart) chart.resize(); }, 50);
}

async function paintChart() {
  const node = document.getElementById("pvpChart");
  const market = view?.market;
  if (!node || !market) return;
  // Key on revealed day + resolved actions — not revision (opponent lock bumps revision).
  const key = `${view.matchId}:${market.revealedDay}:${view.resolvedRounds}:${(view.resolvedActions || []).length}`;
  if (key === chartKey && chart) return;
  const bars = [...(market.history || []), ...(market.bars || [])];
  if (!bars.length) return;
  const firstPaint = !chart || chartZoomKey === "" || !String(chartZoomKey).startsWith(`${view.matchId}:`);
  const resetDataZoom = firstPaint;
  try {
    const echarts = await ensureEcharts();
    if (!chart) {
      chart = echarts.init(node);
      bindChartResize(node);
    }
    chart.setOption(buildKlineOption({
      mode: "pvp",
      bars,
      historyLength: market.historyLength || 0,
      pvpMarks: marksFromView(view),
      showDataZoomSlider: false,
      resetDataZoom,
    }), { replaceMerge: ["series"] });
    chartZoomKey = `${view.matchId}:${bars.length}`;
    chartKey = key;
  } catch {
    node.textContent = "图表暂时打不开，决策按钮仍然可用。";
  }
}

function render() {
  const ready = document.getElementById("pvpReadyPanel");
  const play = document.getElementById("pvpPlayPanel");
  paintSeats();
  if (view?.status === "waiting_ready") {
    if (ready) ready.hidden = false;
    if (play) play.hidden = true;
    setText("pvpRoomHeadline", "准备");
    setHtml("pvpReadyCopy", readyCopyFrom(view.economy));
    paintReadyMark("pvpReadyMarkMe", !!view.me?.ready, true);
    paintReadyMark("pvpReadyMarkOpp", !!view.opponent?.ready, true);
    const readyBtn = document.getElementById("pvpReadyBtn");
    const cancelBtn = document.getElementById("pvpCancelReadyBtn");
    const readyLeft = remainingMs(view.readyDeadlineAt, view.serverNow, fetchedAt);
    if (readyBtn) readyBtn.disabled = !!view.me?.ready || readyInFlight || (readyLeft != null && readyLeft <= 0);
    if (cancelBtn) cancelBtn.disabled = readyInFlight;
  } else if (view?.status === "playing") {
    if (ready) ready.hidden = true;
    if (play) play.hidden = false;
    setText("pvpRoomHeadline", roundCaption(view));
    paintReturn("pvpMeNav", view.me?.mtmPpm);
    paintReturn("pvpOppNav", view.opponent?.mtmPpm);
    paintChart().catch(() => {});
  }
  paintClock();
  paintActions();
}

async function refresh() {
  if (!matchId) return;
  const id = matchId;
  const { data } = await pvpFetch(`/pvp/matches/${encodeURIComponent(id)}`);
  if (matchId !== id) return;
  if (!noteRevision(id, data.revision)) return;
  fetchedAt = Date.now();
  const prevResolved = view?.resolvedRounds;
  if (data.me?.lockedToday || data.resolvedRounds !== prevResolved) postedLock = false;
  if (data.me?.lockedToday) pendingNetwork = false;
  if (data.resolvedRounds !== prevResolved) pendingNetwork = false;
  view = data;
  if (data.status === "settled" || data.status === "aborted") {
    await showResult(data);
    return;
  }
  render();
}

async function postAction(action) {
  if (!view || view.status !== "playing" || isSubmitting() || pendingNetwork) return;
  setSubmitting(true);
  postedLock = false;
  setText("pvpActionError", "");
  paintActions();
  let confirmed = false;
  let networkDoubt = false;
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}/actions`, {
      method: "POST",
      body: { round: view.round, action },
      idempotencyKey: actionKey(matchId, view.round),
    });
    confirmed = true;
  } catch (err) {
    if (err.code === "ALREADY_LOCKED" || err.code === "IDEMPOTENCY_CONFLICT") {
      confirmed = true;
      setText("pvpActionError", "本手已提交");
    } else if (!err.status) {
      networkDoubt = true;
      setText("pvpActionError", "网络中断，正在核对是否已经提交");
    } else {
      setText("pvpActionError", err.message || "这步没能提交");
    }
  } finally {
    setSubmitting(false);
  }
  if (confirmed) postedLock = true;
  if (networkDoubt) pendingNetwork = true;
  paintActions();
  try {
    await refresh();
    if (view?.me?.lockedToday) {
      pendingNetwork = false;
      if (view.me.lockedAction) setText("pvpActionError", `本手已提交：${view.me.lockedAction}`);
    }
  } catch (err) {
    setText("pvpActionError", err.message || "正在核对局面");
  }
}

async function postForfeit() {
  if (!matchId) return;
  const id = matchId;
  closeLeave();
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(id)}/forfeit`, {
      method: "POST",
      body: {},
      idempotencyKey: actionKey(id, "forfeit"),
    });
    const { data } = await pvpFetch(`/pvp/matches/${encodeURIComponent(id)}`);
    await showResult(data);
  } catch (err) {
    setText("pvpActionError", err.message || "认输没能提交");
  }
}

async function postReady() {
  if (!matchId || readyInFlight) return;
  readyInFlight = true;
  render();
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}/ready`, { method: "POST", body: {} });
    await refresh();
  } catch (err) {
    setText("pvpActionError", err.message || "准备没能提交");
  } finally {
    readyInFlight = false;
    if (matchId) render();
  }
}

async function postCancelReady() {
  if (!matchId || readyInFlight) return;
  readyInFlight = true;
  render();
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}/cancel-ready`, { method: "POST", body: {} });
    await refresh();
  } catch (err) {
    setText("pvpActionError", err.message || "取消准备没能提交");
  } finally {
    readyInFlight = false;
    if (matchId) render();
  }
}

function onSocket(msg) {
  if (!matchId || !msg || msg.t !== "match.changed" || msg.matchId !== matchId) return;
  if (!noteRevision(matchId, msg.revision)) return;
  refresh().catch(() => {});
}

function wireRoom() {
  if (wired) return;
  wired = true;
  document.getElementById("pvpRoomLeave")?.addEventListener("click", openLeave);
  document.getElementById("pvpLeaveStay")?.addEventListener("click", closeLeave);
  document.getElementById("pvpLeaveLobby")?.addEventListener("click", () => {
    closeLeave();
    document.getElementById("pvpLobbyScreen")?.classList.add("pvp-instant");
    prepareScreen(Route.PVP_LOBBY);
    activateScreen(Route.PVP_LOBBY);
    setRouteHash(Route.PVP_LOBBY);
    leavePvpRoom({ deferChart: true });
    import("./lobby.js").then((mod) => mod.showPvpLobby({ instant: true })).catch(() => {});
  });
  document.getElementById("pvpLeaveForfeit")?.addEventListener("click", () => { postForfeit().catch(() => {}); });
  document.getElementById("pvpLeaveDialog")?.addEventListener("keydown", onLeaveKey);
  document.getElementById("pvpReadyBtn")?.addEventListener("click", () => { postReady().catch(() => {}); });
  document.getElementById("pvpCancelReadyBtn")?.addEventListener("click", () => { postCancelReady().catch(() => {}); });
  document.getElementById("pvpBuy")?.addEventListener("click", () => { postAction("buy").catch(() => {}); });
  document.getElementById("pvpSell")?.addEventListener("click", () => { postAction("sell").catch(() => {}); });
  document.getElementById("pvpHold")?.addEventListener("click", () => { postAction("hold").catch(() => {}); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && matchId) refresh().catch(() => {});
  });
}

export async function showPvpRoom(id, seed) {
  prepareScreen(Route.PVP_ROOM);
  activateScreen(Route.PVP_ROOM);
  try { history.replaceState(null, "", `#/pvp/${id}`); } catch { /* ignore */ }
  wireRoom();
  if (matchId !== id) {
    destroyChart();
    postedLock = false;
    nudgeKey = "";
  }
  matchId = id;
  setText("pvpActionError", "");
  if (seed && noteRevision(id, seed.revision)) {
    view = seed;
    fetchedAt = Date.now();
    render();
  }
  const beat = () => pvpFetch("/pvp/heartbeat", { method: "POST", body: {} });
  stopLoops();
  matchId = id;
  beat().catch(() => {});
  stopHeartbeat = startPoll(beat, 15_000);
  releaseSocket = holdPvpSocket(onSocket);
  clockTimer = window.setInterval(paintClock, 250);
  try {
    await refresh();
  } catch (err) {
    setText("pvpActionError", err.message || "对局暂时打不开");
  }
  if (matchId !== id) return;
  if (stopPoll) stopPoll();
  stopPoll = startPoll(() => refresh(), 2000);
}
