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
import { setCtlState, shakeError, openCtlOverlay, closeCtlOverlay, syncTradeCtl } from "../controls.js";

import { actionKey, clearActionKeys, holdPvpSocket, pvpFetch, startPoll } from "./transport.js";
import { rankTitleWithIcon } from "./profile-battle.js";

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
let bottomMode = "volume"; // volume | macd for this match
let chartClickBound = false;

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

function paintClockFace(id, seconds, kicker, urgent, fraction) {
  const box = document.getElementById(id);
  const num = document.getElementById(`${id}Num`);
  const kickerNode = document.getElementById(`${id}Kicker`);
  if (kickerNode) kickerNode.textContent = kicker;
  if (num) num.textContent = seconds == null ? "—" : String(seconds);
  if (box) {
    box.classList.toggle("is-urgent", urgent === true);
    // ctl-timer-ring: conic mask on the fill layer (remaining share, 0–100%).
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
    box.style.setProperty("--ctl-timer-p", `${(f * 100).toFixed(2)}%`);
  }
}

const READY_WINDOW_MS = 15_000;
let readyRingKey = "";
let readyRingTotal = READY_WINDOW_MS;

function readyFraction(left) {
  if (left == null) return 1;
  const key = `${matchId}:${view?.readyDeadlineAt}`;
  if (key !== readyRingKey) {
    readyRingKey = key;
    readyRingTotal = Math.max(READY_WINDOW_MS, left);
  }
  return readyRingTotal > 0 ? left / readyRingTotal : 1;
}

function roundFraction(left) {
  const opens = Number(view?.opensAt);
  const due = Number(view?.deadlineAt);
  const total = due - opens;
  if (left == null || !Number.isFinite(total) || total <= 0) return 1;
  return left / total;
}

/** Seat panel state: active = locked this hand (or ready), leading = ahead on return. */
function paintSeatStates() {
  const me = document.getElementById("pvpSeatMe");
  const opp = document.getElementById("pvpSeatOpp");
  if (!me || !opp) return;
  let meState = "default";
  let oppState = "default";
  if (view?.status === "waiting_ready") {
    if (view.me?.ready) meState = "active";
    if (view.opponent?.ready) oppState = "active";
  } else if (view?.status === "playing") {
    const a = view.me?.mtmPpm;
    const b = view.opponent?.mtmPpm;
    const both = a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b));
    if (both && Number(a) > Number(b)) meState = "leading";
    if (both && Number(b) > Number(a)) oppState = "leading";
    if (view.me?.lockedToday) meState = "active";
    if (view.opponent?.lockedToday) oppState = "active";
  }
  me.dataset.seatState = meState;
  opp.dataset.seatState = oppState;
}


function outcomeGlyph(outcome) {
  if (outcome === "win") return '<span class="pvp-recent-mark is-win" title="胜" aria-label="胜">✓</span>';
  if (outcome === "loss") return '<span class="pvp-recent-mark is-loss" title="负" aria-label="负">✕</span>';
  if (outcome === "draw") return '<span class="pvp-recent-mark is-draw" title="平" aria-label="平">–</span>';
  return "";
}

function ensureOppCardDom() {
  if (document.getElementById("pvpOppCardModal")) return;
  const root = document.createElement("div");
  root.id = "pvpOppCardModal";
  root.className = "pvp-opp-card-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="pvp-opp-card-dialog" role="dialog" aria-modal="true" aria-labelledby="pvpOppCardName">
      <button type="button" class="pvp-opp-card-close" id="pvpOppCardClose" aria-label="关闭">×</button>
      <img id="pvpOppCardAvatar" class="pvp-opp-card-avatar" alt="" width="64" height="64">
      <h3 id="pvpOppCardName">对手</h3>
      <p id="pvpOppCardTitle" class="pvp-opp-card-title"></p>
      <p id="pvpOppCardRecord" class="pvp-opp-card-record"></p>
      <p id="pvpOppCardRecent" class="pvp-opp-card-recent"></p>
      <p id="pvpOppCardSignature" class="pvp-opp-card-signature"></p>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    if (e.target === root) closeOppCard();
  });
  document.getElementById("pvpOppCardClose").onclick = closeOppCard;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const m = document.getElementById("pvpOppCardModal");
    if (m && !m.hidden) {
      e.stopPropagation();
      closeOppCard();
    }
  }, true);
}

function closeOppCard() {
  const m = document.getElementById("pvpOppCardModal");
  if (m) closeCtlOverlay(m);
}

function openOppCard(face) {
  if (!face) return;
  ensureOppCardDom();
  const modal = document.getElementById("pvpOppCardModal");
  const avatar = document.getElementById("pvpOppCardAvatar");
  const name = document.getElementById("pvpOppCardName");
  const title = document.getElementById("pvpOppCardTitle");
  const record = document.getElementById("pvpOppCardRecord");
  const recent = document.getElementById("pvpOppCardRecent");
  const signature = document.getElementById("pvpOppCardSignature");
  if (avatar) {
    avatar.src = displayAvatarUrl(face);
    avatar.alt = "";
  }
  if (name) name.textContent = face.nickname || "对手";
  if (title) {
    title.replaceChildren();
    title.append(rankTitleWithIcon(face.title || face.titleName || "散户一段"));
  }
  if (record) {
    const w = Number(face.wins) || 0;
    const l = Number(face.losses) || 0;
    const d = Number(face.draws) || 0;
    record.textContent = (w + l + d) ? `战绩 ${w}胜 ${l}负 ${d}平` : "尚无战绩";
  }
  if (recent) {
    const marks = (face.recent || []).map(outcomeGlyph).join("");
    recent.innerHTML = marks ? `近况 ${marks}` : "暂无近况";
  }
  if (signature) {
    const sig = String(face.signature || "").trim();
    signature.textContent = sig ? sig : "这个人很懒，还没有个性签名";
    signature.classList.toggle("is-empty", !sig);
  }
  openCtlOverlay(modal, { focusSelector: "#pvpOppCardClose" });
}

function wireOppAvatarClick() {
  const img = document.getElementById("pvpSeatOppAvatar");
  const face = img?.closest(".pvp-seat-face") || img;
  if (!face || face.dataset.oppCardWired === "1") return;
  face.dataset.oppCardWired = "1";
  face.classList.add("pvp-seat-face--tappable");
  face.setAttribute("role", "button");
  face.setAttribute("tabindex", "0");
  face.setAttribute("aria-label", "查看对手资料");
  const open = () => openOppCard(view?.opponent);
  face.addEventListener("click", open);
  face.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });
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
  wireOppAvatarClick();
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
  chartClickBound = false;
  tipDismissBound = false;
  tipIndex = -1;
  if (chartObserver) {
    chartObserver.disconnect();
    chartObserver = null;
  }
  if (chart) {
    try { chart.__pvpTipCleanup?.(); } catch { /* ignore */ }
    chart.dispose();
    chart = null;
  }
  if (window.resizePvpChart) window.resizePvpChart = null;
}

export function leavePvpRoom({ deferChart = false } = {}) {
  closeOppCard();
  matchId = null;
  view = null;
  postedLock = false;
  pendingNetwork = false;
  readyInFlight = false;
  clearActionKeys();
  stopLoops();
  closeLeave();
  closeMsgPicker();
  showTauntBubble("me", "");
  showTauntBubble("opp", "");
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
  if (node && !node.hidden) closeCtlOverlay(node);
}

function openLeave() {
  const node = dialog();
  if (!node) return;
  const forfeit = document.getElementById("pvpLeaveForfeit");
  if (forfeit) forfeit.hidden = view?.status !== "playing";
  openCtlOverlay(node, { focusSelector: "#pvpLeaveStay" });
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
    paintClockFace("pvpReadyClock", seconds, "准备剩余", seconds != null && seconds <= 5, readyFraction(left));
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
    waiting ? 1 : roundFraction(left),
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
  // Left: flat → 买入 (red); holding → 卖出 (green). Right: 保持 (hold).
  const primary = document.getElementById("pvpTradePrimary");
  const hold = document.getElementById("pvpHold");
  const holding = !!view?.me?.holding;
  const wantSell = holding && !!view?.me?.canSell;
  const wantBuy = !holding && !!view?.me?.canBuy;
  const primaryImg = document.getElementById("pvpTradePrimaryImg");
  const primaryLabel = document.getElementById("pvpTradePrimaryLabel");
  if (primary) {
    primary.hidden = !playing;
    if (wantSell) {
      primary.dataset.action = "sell";
      primary.setAttribute("aria-label", "卖出");
      primary.classList.remove("is-buy");
      primary.classList.add("is-sell");

      if (primaryLabel) primaryLabel.textContent = "卖出";
      primary.disabled = closed || !view?.me?.canSell;
    } else {
      primary.dataset.action = "buy";
      primary.setAttribute("aria-label", "买入");
      primary.classList.remove("is-sell");
      primary.classList.add("is-buy");

      if (primaryLabel) primaryLabel.textContent = "买入";
      primary.disabled = closed || !wantBuy;
    }
  }
  if (hold) {
    hold.hidden = !playing;
    hold.disabled = closed || !view?.me?.canHold;
    hold.setAttribute("aria-label", "保持");
  }
  const msgOpen = document.getElementById("pvpMsgOpen");
  if (msgOpen) msgOpen.disabled = !playing;
  // ctl skins: locked = this round submitted (solid), disabled = not allowed now.
  const roundLocked = postedLock || pendingNetwork || isSubmitting() || !!view?.me?.lockedToday;
  if (primary && playing) syncTradeCtl(primary, { kind: wantSell ? "sell" : "buy", disabled: primary.disabled, locked: roundLocked && primary.disabled });
  if (primaryImg && primary) primaryImg.src = `assets/controls/ctl-${wantSell ? "sell" : "buy"}-${primary.dataset.state === "locked" ? "locked" : primary.disabled ? "disabled" : "default"}.png?v=20261013s`;
  if (hold && playing) syncTradeCtl(hold, { kind: "hold", disabled: hold.disabled, locked: roundLocked && hold.disabled });
  if (msgOpen) syncTradeCtl(msgOpen, { kind: "msg", disabled: msgOpen.disabled });
  if (view?.status !== "playing") return;
  const submitting = isSubmitting();
  const locked = postedLock || pendingNetwork || submitting || !!view?.me?.lockedToday;
  const oppLocked = !!view?.opponent?.lockedToday;
  paintReadyMark("pvpReadyMarkMe", locked, locked, "已行动");
  paintReadyMark("pvpReadyMarkOpp", oppLocked, oppLocked, "已行动");
}

function bindChartResize(node) {
  let lastW = 0;
  let lastH = 0;
  const resizeIfNeeded = () => {
    if (!chart || !node) return;
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (w < 8 || h < 8) return;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    chart.resize();
  };
  window.resizePvpChart = resizeIfNeeded;
  if (chartObserver) chartObserver.disconnect();
  if (typeof ResizeObserver === "function") {
    chartObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(resizeIfNeeded);
    });
    chartObserver.observe(node);
  } else {
    chartObserver = null;
  }
  window.setTimeout(resizeIfNeeded, 50);
}

function bindBottomToggle(chartInstance) {
  if (chartClickBound || !chartInstance) return;
  chartClickBound = true;
  chartInstance.getZr().on("click", (event) => {
    if (!chart || view?.status !== "playing") return;
    let inBottom = false;
    try {
      const pt = chart.convertFromPixel({ gridIndex: 1 }, [event.offsetX, event.offsetY]);
      inBottom = Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]);
    } catch {
      inBottom = false;
    }
    if (!inBottom) return;
    bottomMode = bottomMode === "volume" ? "macd" : "volume";
    chartKey = ""; // force repaint with new bottom pane
    paintChart().catch(() => {});
  });
}


function hidePvpTip() {
  if (!chart) return;
  try { chart.dispatchAction({ type: "hideTip" }); } catch { /* ignore */ }
  try { chart.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" }); } catch { /* ignore */ }
}

let tipIndex = -1;
let tipDismissBound = false;

function bindTipDismiss(chartInstance) {
  if (tipDismissBound || !chartInstance) return;
  tipDismissBound = true;
  chartInstance.on("showTip", (params) => {
    tipIndex = Number.isInteger(params?.dataIndex) ? params.dataIndex : -1;
  });
  chartInstance.on("hideTip", () => { tipIndex = -1; });
  // Second tap on the same candle closes the tip (click triggerOn alone toggles poorly on some WebViews).
  chartInstance.getZr().on("click", (event) => {
    if (!chart || view?.status !== "playing") return;
    // Clicks on the bottom pane still toggle volume/MACD (bindBottomToggle). Tip dismiss only.
    if (tipIndex < 0) return;
    try {
      const pt = chart.convertFromPixel({ seriesIndex: 0 }, [event.offsetX, event.offsetY]);
      if (!Array.isArray(pt) || !Number.isFinite(pt[0])) {
        hidePvpTip();
        return;
      }
    } catch {
      hidePvpTip();
    }
  });
  const onKey = (e) => {
    if (e.key === "Escape") hidePvpTip();
  };
  const onDoc = (e) => {
    const node = document.getElementById("pvpChart");
    if (!node || tipIndex < 0) return;
    if (node.contains(e.target)) return;
    // Trade / message controls should clear the tip without trapping the tap.
    hidePvpTip();
  };
  const onCloseBtn = (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest("[data-pvp-tip-close]")) return;
    e.preventDefault();
    e.stopPropagation();
    hidePvpTip();
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onDoc, true);
  document.addEventListener("click", onCloseBtn, true);
  chartInstance.__pvpTipCleanup = () => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("click", onCloseBtn, true);
  };
}

async function paintChart() {
  const node = document.getElementById("pvpChart");
  const market = view?.market;
  if (!node || !market) return;
  // Key on revealed day + resolved actions + bottom indicator mode.
  const key = `${view.matchId}:${market.revealedDay}:${view.resolvedRounds}:${(view.resolvedActions || []).length}:${bottomMode}`;
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
      bindBottomToggle(chart);
      bindTipDismiss(chart);
    }
    chart.setOption(buildKlineOption({
      mode: "pvp",
      bars,
      historyLength: market.historyLength || 0,
      pvpMarks: marksFromView(view),
      showDataZoomSlider: false,
      resetDataZoom,
      showLegend: false,
      pvpBottom: bottomMode,
    }), { replaceMerge: ["series", "legend", "grid", "xAxis", "yAxis"] });
    chartZoomKey = `${view.matchId}:${bars.length}`;
    chartKey = key;
  } catch {
    node.textContent = "图表暂时打不开，决策按钮仍然可用。";
  }
}

function paintTopClocks(status) {
  const readyClock = document.getElementById("pvpReadyClock");
  const playClock = document.getElementById("pvpClock");
  if (readyClock) readyClock.hidden = status !== "waiting_ready";
  if (playClock) playClock.hidden = status !== "playing";
}

function render() {
  const ready = document.getElementById("pvpReadyPanel");
  const play = document.getElementById("pvpPlayPanel");
  paintSeats();
  paintSeatStates();
  if (view?.status === "waiting_ready") {
    if (ready) ready.hidden = false;
    if (play) play.hidden = true;
    paintTopClocks("waiting_ready");
    setText("pvpRoomHeadline", "准备");
    setHtml("pvpReadyCopy", readyCopyFrom(view.economy));
    paintReadyMark("pvpReadyMarkMe", !!view.me?.ready, true);
    paintReadyMark("pvpReadyMarkOpp", !!view.opponent?.ready, true);
    const readyBtn = document.getElementById("pvpReadyBtn");
    const cancelBtn = document.getElementById("pvpCancelReadyBtn");
    const readyLeft = remainingMs(view.readyDeadlineAt, view.serverNow, fetchedAt);
    if (readyBtn) readyBtn.disabled = !!view.me?.ready || readyInFlight || (readyLeft != null && readyLeft <= 0);
    if (cancelBtn) cancelBtn.disabled = readyInFlight;
    if (readyBtn) {
      if (readyInFlight) setCtlState(readyBtn, "loading", { syncImg: false });
      else if (view.me?.ready) setCtlState(readyBtn, "success", { syncImg: false });
      else setCtlState(readyBtn, readyBtn.disabled ? "disabled" : "default", { syncImg: false, forceDisabled: false });
    }
    if (cancelBtn) cancelBtn.hidden = !view.me?.ready;
  } else if (view?.status === "playing") {
    if (ready) ready.hidden = true;
    if (play) play.hidden = false;
    const staleReady = document.getElementById("pvpReadyBtn");
    if (staleReady && !readyInFlight && staleReady.dataset.state === "loading") setCtlState(staleReady, "default", { syncImg: false, forceDisabled: false });
    paintTopClocks("playing");
    setText("pvpRoomHeadline", roundCaption(view));
    paintReturn("pvpMeNav", view.me?.mtmPpm);
    paintReturn("pvpOppNav", view.opponent?.mtmPpm);
    paintChart().catch(() => {});
  } else {
    paintTopClocks("");
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
  hidePvpTip();
  // Avoid the browser scrolling a newly-focused trade control into view (chart jerk).
  try { document.activeElement?.blur?.(); } catch { /* ignore */ }
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
      shakeError(document.getElementById(action === "hold" ? "pvpHold" : "pvpTradePrimary"));
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
    shakeError(document.getElementById("pvpReadyBtn"));
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
  if (!matchId || !msg || msg.matchId !== matchId) return;
  if (msg.t === "match.taunt") {
    onTauntEvent(msg);
    return;
  }
  if (msg.t !== "match.changed") return;
  if (!noteRevision(matchId, msg.revision)) return;
  refresh().catch(() => {});
}


const TAUNT_MS = 3200;
let tauntHideTimers = { me: 0, opp: 0 };

function closeMsgPicker() {
  const picker = document.getElementById("pvpMsgPicker");
  const open = document.getElementById("pvpMsgOpen");
  if (picker) picker.hidden = true;
  if (open) open.setAttribute("aria-expanded", "false");
}

function showTauntBubble(side, text) {
  const id = side === "me" ? "pvpTauntBubbleMe" : "pvpTauntBubbleOpp";
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = text || "";
  node.hidden = !text;
  window.clearTimeout(tauntHideTimers[side]);
  if (text) {
    tauntHideTimers[side] = window.setTimeout(() => {
      node.hidden = true;
      node.textContent = "";
    }, TAUNT_MS);
  }
}

function onTauntEvent(msg) {
  if (!matchId || !msg || msg.t !== "match.taunt" || msg.matchId !== matchId) return;
  const event = msg.event;
  if (!event?.text) return;
  const auth = getAuthState().user;
  const mine = auth && Number(event.fromUserId) === Number(auth.id);
  showTauntBubble(mine ? "me" : "opp", event.text);
}

async function postTaunt(text) {
  if (!matchId || !text || view?.status !== "playing") return;
  closeMsgPicker();
  showTauntBubble("me", text);
  try {
    await pvpFetch(`/pvp/matches/${encodeURIComponent(matchId)}/taunts`, {
      method: "POST",
      body: { text },
    });
  } catch (err) {
    setText("pvpActionError", err.message || "消息没能发送");
  }
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
  const guardTradePointer = (el) => {
    el?.addEventListener("pointerdown", () => { hidePvpTip(); }, { passive: true });
  };
  guardTradePointer(document.getElementById("pvpHold"));
  guardTradePointer(document.getElementById("pvpTradePrimary"));
  document.getElementById("pvpHold")?.addEventListener("click", () => { postAction("hold").catch(() => {}); });
  document.getElementById("pvpBuy")?.addEventListener("click", () => { postAction("buy").catch(() => {}); });
  document.getElementById("pvpSell")?.addEventListener("click", () => { postAction("sell").catch(() => {}); });
  document.getElementById("pvpTradePrimary")?.addEventListener("click", () => {
    const action = document.getElementById("pvpTradePrimary")?.dataset?.action;
    if (action === "buy" || action === "sell") postAction(action).catch(() => {});
  });
  document.getElementById("pvpMsgOpen")?.addEventListener("click", () => {
    const picker = document.getElementById("pvpMsgPicker");
    const open = document.getElementById("pvpMsgOpen");
    if (!picker) return;
    const next = picker.hidden;
    picker.hidden = !next;
    open?.setAttribute("aria-expanded", next ? "true" : "false");
  });
  document.getElementById("pvpMsgPicker")?.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".pvp-msg-line");
    if (!btn) return;
    postTaunt(btn.textContent || "").catch(() => {});
  });
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
    bottomMode = "volume";
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
