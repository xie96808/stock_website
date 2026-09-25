/**
 * Flat-open intraday playback (practice, or the 21:00 ranked phase).
 * Loaded only by dynamic import. The rAF clock follows server time once;
 * it does not wait on HTTP and does not stretch the 100ms bar.
 * Ranked play uses the public phase only — never a private origin.
 */
import { getAuthState, openAuthModal, refreshMe, showToast } from './auth.js';
import { ensureEcharts, markChartFailed, clearChartLoading } from './echarts-loader.js';
import { revealIntradayScreen } from './screen-router.js';
import { buildIntradayOption, buildEm241Labels } from './intraday-chart.js';
import { playbackClock, actDeadlineMs } from '../shared/intradayEngine.js';

export const INTRADAY_BOOT_STAGES = Object.freeze([
  '加载模块',
  '创建会话',
  '缓冲分时',
  '图表就绪',
]);

/** Locked with the server. Underrun must not change it. */
export const INTRADAY_CLIENT_BAR_MS = 100;
export const INTRADAY_PREFETCH_LOW_WATER = 8;
const BAR_COUNT_DEFAULT = 241;
const CLOCK_PREFIX = 'intraday-clock:';

const LABELS = buildEm241Labels();

let state = freshState();
let chain = Promise.resolve();
let createKey = null;
let uiBound = false;
let resumeLock = false;
let paintedKey = '';
let finishNotBefore = 0;

function freshState() {
  return {
    starting: false,
    live: false,
    settled: false,
    finishing: false,
    sessionId: null,
    revision: 0,
    cursor: -1,
    mode: 'practice',
    startMode: 'flat',
    position: 'empty',
    markReturnPpm: 0,
    prevCloseFen: null,
    limitUpFen: null,
    limitDownFen: null,
    barCount: BAR_COUNT_DEFAULT,
    bars: new Map(),
    acted: new Set(),
    trades: [],
    originMs: null,
    originKnown: false,
    clockOffsetMs: 0,
    clockSampled: false,
    pauseKnown: false,
    pausedAtMs: null,
    chart: null,
    raf: 0,
    bootDone: false,
    prefetching: false,
    settleBlocked: false,
    settleReturnPpm: null,
  };
}

export function playbackArgs({ originMs, nowMs, barCount, pausedAtMs }) {
  return {
    originMs,
    nowMs,
    intervalMs: INTRADAY_CLIENT_BAR_MS,
    barCount: barCount || BAR_COUNT_DEFAULT,
    pausedAtMs,
  };
}

export function drawnThroughIndex(cursor, released) {
  if (!Number.isInteger(cursor) || !Number.isInteger(released)) return -1;
  if (cursor < 0 || released < 0) return -1;
  return Math.min(cursor, released);
}

/**
 * Prefetch when the clock has released bars we have not stored.
 * Caught up (cursor >= released) does not poll. The page size stays the server's.
 */
export function shouldPrefetch({
  cursor,
  released,
  inFlight,
  originKnown = true,
  lowWater = INTRADAY_PREFETCH_LOW_WATER,
}) {
  if (inFlight || !originKnown) return false;
  if (!Number.isInteger(cursor) || !Number.isInteger(released) || released < 0) return false;
  // A healthy lead over the local clock does not need another round trip.
  if (cursor - released >= lowWater) return false;
  return cursor < released;
}

/** Park at the end of `cursor` so a resumed clock cannot outlive server slack. */
export function anchorOriginMs({ nowMs, cursor, barMs = INTRADAY_CLIENT_BAR_MS }) {
  if (!Number.isInteger(cursor) || cursor < 0 || !Number.isFinite(nowMs)) return null;
  return nowMs - (cursor * barMs + (barMs - 1));
}

/** A rejected advance must leave the pause flag untouched. */
export function commitPause(clock, { ok, pause, serverNowMs }) {
  const prev = {
    originMs: clock.originMs,
    pausedAtMs: clock.pausedAtMs ?? null,
  };
  if (!ok) return prev;
  if (pause === true && Number.isFinite(serverNowMs)) {
    return { originMs: prev.originMs, pausedAtMs: serverNowMs };
  }
  if (pause === false && prev.pausedAtMs != null && Number.isFinite(serverNowMs)) {
    return {
      originMs: prev.originMs + (serverNowMs - prev.pausedAtMs),
      pausedAtMs: null,
    };
  }
  return prev;
}

/** Do not paint a score unless finish actually returned one. */
export function settlementView(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.code === 'SUBMISSION_CONFLICT') return null;
  if (typeof payload.returnPpm !== 'number' || !Number.isFinite(payload.returnPpm)) return null;
  return payload;
}

export function formatReturnPpm(ppm) {
  if (!Number.isFinite(ppm)) return '—';
  const pct = ppm / 10000;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Server hands at most this many new bars per prefetch. A short page has caught `released`. */
export const INTRADAY_PREFETCH_PAGE = 20;

/**
 * The button targets the bar on screen (min of cursor and the clock), not a
 * prefetched index that is not drawn yet. It stays open until that bar's own
 * deadline. `prefetchOnly` is informational and must not veto the click.
 * Limit bands are the session DTO's fen, not a client-side board rule.
 */
export function tradeControls({
  cursor,
  released,
  originMs,
  nowMs,
  position,
  actedBar,
  limitUpFen,
  limitDownFen,
  closeFen,
  settled,
}) {
  const prefetchOnly = Number.isInteger(cursor) && Number.isInteger(released) && cursor < released;
  const off = { buyEnabled: false, sellEnabled: false, prefetchOnly, barIndex: null };
  if (settled) return { ...off, prefetchOnly: false };
  const drawn = drawnThroughIndex(cursor, released);
  if (drawn < 0 || drawn > cursor || !Number.isFinite(originMs) || !Number.isFinite(nowMs)) {
    return off;
  }
  const openAt = originMs + drawn * INTRADAY_CLIENT_BAR_MS;
  const open = nowMs >= openAt && nowMs < actDeadlineMs(originMs, drawn) && actedBar !== drawn;
  const blockedUp = closeFen != null && limitUpFen != null && closeFen >= limitUpFen;
  const blockedDown = closeFen != null && limitDownFen != null && closeFen <= limitDownFen;
  return {
    buyEnabled: open && position === 'empty' && !blockedUp,
    sellEnabled: open && position === 'long' && !blockedDown,
    prefetchOnly,
    barIndex: open ? drawn : null,
  };
}

/** Send when the drawn bar is enabled. `prefetchOnly` is not a veto. */
export function clickShouldSend(controls, side) {
  if (!controls || !Number.isInteger(controls.barIndex)) return false;
  if (side === 'sell') return controls.sellEnabled === true;
  return controls.buyEnabled === true;
}

/** A queued click stays valid until its own deadline, even if the clock index moved. */
export function queuedActAllowed({ originMs, nowMs, cursor, barIndex, acted }) {
  if (acted) return false;
  if (!Number.isInteger(barIndex) || !Number.isInteger(cursor) || barIndex > cursor || barIndex < 0) return false;
  if (!Number.isFinite(originMs) || !Number.isFinite(nowMs)) return false;
  if (nowMs < originMs + barIndex * INTRADAY_CLIENT_BAR_MS) return false;
  return nowMs < actDeadlineMs(originMs, barIndex);
}

/**
 * A missing pause field is not "playing". A known pause does not run the clock,
 * and must not prefetch or finish in a loop. Playing is the only path that does both.
 */
export function playbackGate({ pauseKnown, pausedAtMs }) {
  const playing = pauseKnown === true && pausedAtMs == null;
  return {
    advanceClock: playing,
    prefetchLoop: playing,
    finish: playing,
  };
}

/**
 * Unknown origin must prefetch until a short page, then anchor.
 * Anchoring the stale cursor first makes `released === cursor` and `shouldPrefetch` false.
 * A known pause anchors on `pausedAtMs` and does not use the wall clock.
 */
export function resumeCatchUpAction({ originKnown, pauseKnown, pausedAtMs, gained }) {
  if (!pauseKnown || originKnown) return { prefetch: false, anchor: false, basis: null };
  if (gained == null || gained >= INTRADAY_PREFETCH_PAGE) {
    return { prefetch: true, anchor: false, basis: null };
  }
  return {
    prefetch: false,
    anchor: true,
    basis: pausedAtMs != null ? 'pausedAtMs' : 'wall',
  };
}

/** Latch only a rejected action log or a terminal inactive session. Transport and 5xx retry. */
export function classifyFinishFailure(err) {
  if (err && (err.code === 'SUBMISSION_CONFLICT' || err.code === 'GAME_NOT_ACTIVE')) return 'latch';
  return 'retry';
}

export const RANKED_FLAT_JOIN_LEAD_MS = 60_000;
export const RANKED_FLAT_TAPE_MS = 241 * 100;

/** Shown before a flat ranked session is created. No rank-coin payout. */
export const RANKED_FLAT_CONFIRM_TEXT =
  '消耗 30 韭币，开盘空仓正式局每天一次。模拟 T+0 · 当日可回转 · 不是券商规则。'
  + '每天 21:00（Asia/Shanghai）一段公共相位，画面 24.1 秒。'
  + '可提前 60 秒入场并预加载空图表。迟到未交付的分钟不能补。'
  + '24.1 秒画面结束后，今天不能再开空仓正式局。没有名次奖励。';

/**
 * Flat ranked entry window is [phaseStartsAt - 60s, phaseStartsAt + 24.1s).
 * A miss does not become a private clock. `long` is not a choice here.
 */
export function rankedFlatGate(status, nowMs) {
  if (!status || status.ready !== true || !status.phaseStartsAt || !status.phaseStartsAt.flat) {
    return { ok: false, message: (status && status.message) || '分时题库准备中' };
  }
  const phaseMs = Date.parse(status.phaseStartsAt.flat);
  if (!Number.isFinite(phaseMs)) return { ok: false, message: '分时题库准备中' };
  const now = Number.isFinite(nowMs) ? nowMs : status.serverNowMs;
  if (!Number.isFinite(now)) return { ok: false, message: '无法对齐公共相位' };
  if (status.remainingChance && status.remainingChance.flat === 0) {
    return { ok: false, message: '今日空仓机会已用完' };
  }
  const openMs = phaseMs - RANKED_FLAT_JOIN_LEAD_MS;
  const closedMs = phaseMs + RANKED_FLAT_TAPE_MS;
  if (now < openMs) return { ok: false, message: '空仓相位尚未开放' };
  if (now >= closedMs) return { ok: false, message: '今日空仓正式局已结束' };
  return { ok: true, phaseMs, openMs, closedMs };
}

function newKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function apiSend(path, { method = 'GET', body, key } = {}) {
  const auth = getAuthState();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.csrfToken) headers['X-CSRF-Token'] = auth.csrfToken;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || '请求失败');
    err.code = json?.error?.code;
    err.status = res.status;
    err.details = json?.error?.details;
    throw err;
  }
  return json.data;
}

function isLoginFailure(err) {
  return !!(err && (err.status === 401 || err.code === 'UNAUTHORIZED'));
}

function handleBackgroundError(err) {
  if (!err) return;
  if (isLoginFailure(err)) {
    openAuthModal('login');
    return;
  }
  if (err.code === 'SUBMISSION_CONFLICT') {
    showToast('动作与服务端记录不一致，未公布成绩', 'error');
    return;
  }
  if (err.code === 'TAPE_NOT_FINISHED' || err.code === 'CURSOR_BEHIND') return;
  showToast(err.message || '分时请求失败', 'error');
}

async function ensureLoggedIn() {
  let auth = getAuthState();
  if (!auth.ready || auth.status === 'refreshing' || auth.status === 'unknown') {
    try { auth = await refreshMe(); } catch { /* refreshMe settles locally */ }
  }
  if (!auth?.user || auth.status !== 'authenticated') {
    openAuthModal('login');
    return false;
  }
  return true;
}

function setBootStage(label) {
  const boot = document.getElementById('intradayBoot');
  if (boot) boot.hidden = false;
  const text = document.getElementById('intradayBootText');
  if (text) text.textContent = label;
  const idx = INTRADAY_BOOT_STAGES.indexOf(label);
  const pct = idx < 0 ? 0 : Math.round(((idx + 1) / INTRADAY_BOOT_STAGES.length) * 100);
  const fill = document.getElementById('intradayBootFill');
  if (fill) fill.style.width = `${pct}%`;
  const bar = document.getElementById('intradayBootBar');
  if (bar) bar.setAttribute('aria-valuenow', String(pct));
}

function showUnderrun() {
  const boot = document.getElementById('intradayBoot');
  if (boot) boot.hidden = false;
  const text = document.getElementById('intradayBootText');
  if (text) text.textContent = '缓冲分时';
}

function hideBoot() {
  const boot = document.getElementById('intradayBoot');
  if (boot) boot.hidden = true;
}

function tone(ppm) {
  if (!Number.isFinite(ppm) || ppm === 0) return 'is-flat';
  return ppm > 0 ? 'is-up' : 'is-down';
}

function readClock() {
  const wall = Date.now() + state.clockOffsetMs;
  const gate = playbackGate({ pauseKnown: state.pauseKnown, pausedAtMs: state.pausedAtMs });
  let pausedAtMs = state.pausedAtMs;
  let nowMs = wall;
  // Pause unknown: hold the delivered bar. Do not let wall time walk the index.
  if (!gate.advanceClock && pausedAtMs == null && state.originKnown && state.cursor >= 0) {
    pausedAtMs = state.originMs + state.cursor * INTRADAY_CLIENT_BAR_MS;
    nowMs = pausedAtMs;
  }
  return playbackClock(playbackArgs({
    originMs: state.originKnown ? state.originMs : nowMs,
    nowMs,
    barCount: state.barCount,
    pausedAtMs,
  }));
}

function alignedNow() {
  if (state.pausedAtMs != null) return state.pausedAtMs;
  return Date.now() + state.clockOffsetMs;
}

function controlsFor(clock) {
  if (!state.originKnown || !state.pauseKnown) {
    return {
      buyEnabled: false,
      sellEnabled: false,
      prefetchOnly: !state.pauseKnown || state.cursor < clock.released,
      barIndex: null,
    };
  }
  const drawn = drawnThroughIndex(state.cursor, clock.released);
  const bar = drawn >= 0 ? state.bars.get(drawn) : null;
  return tradeControls({
    cursor: state.cursor,
    released: clock.released,
    originMs: state.originMs,
    nowMs: alignedNow(),
    position: state.position,
    actedBar: drawn >= 0 && state.acted.has(drawn) ? drawn : null,
    limitUpFen: state.limitUpFen,
    limitDownFen: state.limitDownFen,
    closeFen: bar ? bar.closeFen : null,
    settled: state.settled,
  });
}

function sampleClockOnce(serverNowMs) {
  if (state.clockSampled || !Number.isFinite(serverNowMs)) return;
  state.clockOffsetMs = serverNowMs - Date.now();
  state.clockSampled = true;
}

function applyProgress(data) {
  if (!data || typeof data !== 'object') return;
  if (data.sessionId) state.sessionId = data.sessionId;
  if (Number.isInteger(data.revision)) state.revision = data.revision;
  if (Number.isInteger(data.cursor)) state.cursor = data.cursor;
  if (data.position === 'empty' || data.position === 'long') state.position = data.position;
  if (Number.isInteger(data.markReturnPpm)) state.markReturnPpm = data.markReturnPpm;
  if (Number.isInteger(data.prevCloseFen)) state.prevCloseFen = data.prevCloseFen;
  if (Number.isInteger(data.limitUpFen)) state.limitUpFen = data.limitUpFen;
  if (Number.isInteger(data.limitDownFen)) state.limitDownFen = data.limitDownFen;
  if (Number.isInteger(data.barCount)) state.barCount = data.barCount;
  if (data.mode === 'practice' || data.mode === 'ranked') state.mode = data.mode;
  if (data.startMode === 'flat' || data.startMode === 'long') state.startMode = data.startMode;
  if (Array.isArray(data.bars)) {
    for (const bar of data.bars) {
      if (bar && Number.isInteger(bar.i)) state.bars.set(bar.i, bar);
    }
  }
  if (data.fillBar && Number.isInteger(data.fillBar.i)) state.bars.set(data.fillBar.i, data.fillBar);
  if (typeof data.tapeClosed === 'boolean') state.tapeClosed = data.tapeClosed;
  if (typeof data.settleReady === 'boolean') state.settleReady = data.settleReady;
  if (data && Object.prototype.hasOwnProperty.call(data, 'pausedAtMs')) {
    state.pauseKnown = true;
    state.pausedAtMs = Number.isFinite(data.pausedAtMs) ? data.pausedAtMs : null;
  }
  if (data.phaseStartsAt) {
    const origin = Date.parse(data.phaseStartsAt);
    if (Number.isFinite(origin)) {
      state.originMs = origin;
      state.originKnown = true;
    }
  }
}

function clockKey(sessionId) {
  return CLOCK_PREFIX + sessionId;
}

function saveClock() {
  if (!state.sessionId || !state.originKnown || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(clockKey(state.sessionId), JSON.stringify({
      originMs: state.originMs,
      clockOffsetMs: state.clockOffsetMs,
      pausedAtMs: state.pausedAtMs,
      clockSampled: state.clockSampled,
    }));
  } catch { /* private mode */ }
}

function loadClock(sessionId) {
  if (!sessionId || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(clockKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.originMs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function adoptCreate(data) {
  applyProgress(data);
  sampleClockOnce(data.serverNowMs);
  if (state.mode === 'ranked') {
    // Public phase only. Missing phaseStartsAt must not become a private origin.
    state.pausedAtMs = null;
    state.pauseKnown = true;
    if (!data.phaseStartsAt) state.originKnown = false;
  } else if (!data.phaseStartsAt && Number.isFinite(data.serverNowMs)) {
    state.originMs = data.serverNowMs;
    state.originKnown = true;
    state.pausedAtMs = null;
    state.pauseKnown = true;
  }
  saveClock();
}

function restoreStoredClock(sessionId) {
  const saved = loadClock(sessionId);
  if (!saved) return;
  state.originMs = saved.originMs;
  state.originKnown = true;
  if (Object.prototype.hasOwnProperty.call(saved, 'pausedAtMs')) {
    state.pausedAtMs = saved.pausedAtMs == null ? null : saved.pausedAtMs;
    state.pauseKnown = true;
  }
  if (Number.isFinite(saved.clockOffsetMs)) {
    state.clockOffsetMs = saved.clockOffsetMs;
    state.clockSampled = true;
  }
}

async function sendAdvance(body, { pauseIntent = null } = {}) {
  const before = { originMs: state.originMs, pausedAtMs: state.pausedAtMs };
  const data = await apiSend(`/intraday/sessions/${encodeURIComponent(state.sessionId)}/advance`, {
    method: 'POST',
    body,
    key: newKey(),
  });
  // Shift the origin from the pre-response pause. The DTO's pausedAtMs then wins.
  const next = commitPause(before, { ok: true, pause: pauseIntent, serverNowMs: data.serverNowMs });
  applyProgress(data);
  if (!data.phaseStartsAt) state.originMs = next.originMs;
  if (!Object.prototype.hasOwnProperty.call(data, 'pausedAtMs')) state.pausedAtMs = next.pausedAtMs;
  if (pauseIntent != null) saveClock();
  return data;
}

async function prefetchOnce() {
  try {
    await sendAdvance({ expectedRevision: state.revision, op: 'prefetch' });
    return false;
  } catch (err) {
    if (err.code === 'REVISION_CONFLICT' && Number.isInteger(err.details?.actual)) {
      state.revision = err.details.actual;
      return true;
    }
    throw err;
  }
}

async function catchUpPrefetch() {
  // Ranked without a public phase must not anchor a private origin.
  if (state.mode === 'ranked' && !state.originKnown) return;
  // Unknown pause: do not poll a session that might be frozen.
  if (!state.pauseKnown) return;
  if (!state.originKnown) {
    // Reach the server's released index before anchoring. Anchoring the stale
    // cursor first makes shouldPrefetch false and the gap is never filled.
    let gained = null;
    for (let n = 0; n < 16; n += 1) {
      const step = resumeCatchUpAction({
        originKnown: state.originKnown,
        pauseKnown: state.pauseKnown,
        pausedAtMs: state.pausedAtMs,
        gained,
      });
      if (step.prefetch) {
        const before = state.cursor;
        const retry = await prefetchOnce();
        if (retry) continue;
        gained = state.cursor - before;
        continue;
      }
      if (step.anchor) {
        const basis = step.basis === 'pausedAtMs'
          ? state.pausedAtMs
          : Date.now() + state.clockOffsetMs;
        const anchored = anchorOriginMs({ nowMs: basis, cursor: state.cursor });
        if (anchored != null) {
          state.originMs = anchored;
          state.originKnown = true;
          saveClock();
        }
      }
      break;
    }
    return;
  }
  const gate = playbackGate({ pauseKnown: state.pauseKnown, pausedAtMs: state.pausedAtMs });
  // A known origin can fill a frozen gap. A running clock prefetches as it falls behind.
  if (!gate.prefetchLoop && state.pausedAtMs == null) return;
  for (let n = 0; n < 16; n += 1) {
    const clock = readClock();
    if (!shouldPrefetch({
      cursor: state.cursor,
      released: clock.released,
      inFlight: false,
      originKnown: state.originKnown,
    })) break;
    const retry = await prefetchOnce();
    if (retry) continue;
  }
}

function enqueuePrefetch() {
  if (state.prefetching || state.settled || !state.sessionId) return;
  state.prefetching = true;
  enqueue(async () => {
    try {
      const clock = readClock();
      if (!shouldPrefetch({
        cursor: state.cursor,
        released: clock.released,
        inFlight: false,
        originKnown: state.originKnown,
      })) return;
      await sendAdvance({ expectedRevision: state.revision, op: 'prefetch' });
    } catch (err) {
      if (err.code === 'REVISION_CONFLICT' && Number.isInteger(err.details?.actual)) {
        state.revision = err.details.actual;
        return;
      }
      handleBackgroundError(err);
    } finally {
      state.prefetching = false;
    }
  });
}

function paintChart(clock) {
  if (!state.chart) return;
  const revealedThrough = drawnThroughIndex(state.cursor, clock.released);
  const key = `${revealedThrough}:${state.trades.length}:${state.cursor}`;
  if (key === paintedKey) return;
  paintedKey = key;
  const bars = [];
  for (let i = 0; i <= revealedThrough; i += 1) {
    const bar = state.bars.get(i);
    if (bar) bars.push(bar);
  }
  state.chart.setOption(buildIntradayOption({
    barCount: state.barCount,
    prevCloseFen: state.prevCloseFen,
    bars,
    revealedThrough,
    trades: state.trades,
    labels: LABELS,
  }), true);
}

async function mountChart() {
  const el = document.getElementById('intradayChart');
  if (!el) return;
  const echarts = await ensureEcharts();
  if (state.chart) {
    state.chart.dispose();
    state.chart = null;
  }
  state.chart = echarts.init(el);
  clearChartLoading(el);
  paintChart(readClock());
  window.addEventListener('resize', onResize);
}

function onResize() {
  if (state.chart) state.chart.resize();
}

function syncHud(clock) {
  const controls = controlsFor(clock);
  const buy = document.getElementById('intradayBuyBtn');
  const sell = document.getElementById('intradaySellBtn');
  const pauseBtn = document.getElementById('intradayPauseBtn');
  if (buy) buy.disabled = !controls.buyEnabled;
  if (sell) sell.disabled = !controls.sellEnabled;
  if (pauseBtn) {
    const showPause = state.mode === 'practice' && !state.settled;
    pauseBtn.hidden = !showPause;
    pauseBtn.textContent = state.pausedAtMs != null ? '继续' : '暂停';
  }
  const modeEl = document.getElementById('intradayModeChip');
  if (modeEl) {
    const modeLabel = state.mode === 'ranked' ? '正式' : '练习';
    const openLabel = state.startMode === 'long' ? '开盘已持有' : '开盘空仓';
    modeEl.textContent = `${modeLabel} · ${openLabel}`;
  }
  const posEl = document.getElementById('intradayPositionChip');
  if (posEl) posEl.textContent = state.position === 'long' ? '持仓' : '空仓';
  const markEl = document.getElementById('intradayMark');
  if (markEl) {
    markEl.textContent = `盯市 ${formatReturnPpm(state.markReturnPpm)}`;
    markEl.classList.remove('is-up', 'is-down', 'is-flat');
    markEl.classList.add(tone(state.markReturnPpm));
  }
  const shown = drawnThroughIndex(state.cursor, clock.released);
  const bar = shown >= 0 ? state.bars.get(shown) : null;
  const priceEl = document.getElementById('intradayPrice');
  const vsEl = document.getElementById('intradayVsPrev');
  if (bar && priceEl) {
    const yuan = (bar.closeFen / 100).toFixed(2);
    const hm = LABELS[bar.i] || '';
    priceEl.textContent = hm ? `${hm} ${yuan}` : yuan;
  } else if (priceEl) {
    priceEl.textContent = '—';
  }
  if (bar && vsEl && Number.isInteger(state.prevCloseFen) && state.prevCloseFen > 0) {
    const ppm = Math.round((bar.closeFen - state.prevCloseFen) / state.prevCloseFen * 1e6);
    vsEl.textContent = `相对昨收 ${formatReturnPpm(ppm)}`;
    vsEl.classList.remove('is-up', 'is-down', 'is-flat');
    vsEl.classList.add(tone(ppm));
  }
  if (state.cursor < clock.released) showUnderrun();
  else if (state.bootDone && !state.settled) hideBoot();
}

function paintSettlement(view) {
  state.settleReturnPpm = view.returnPpm;
  const panel = document.getElementById('intradaySettle');
  if (panel) panel.hidden = false;
  const ret = document.getElementById('intradaySettleReturn');
  if (ret) {
    ret.textContent = `结算（含收盘卖出费用） ${formatReturnPpm(view.returnPpm)}`;
    ret.classList.remove('is-up', 'is-down', 'is-flat');
    ret.classList.add(tone(view.returnPpm));
  }
  const mark = document.getElementById('intradaySettleMark');
  if (mark) mark.textContent = `盯市 ${formatReturnPpm(state.markReturnPpm)}`;
  const meta = document.getElementById('intradaySettleMeta');
  if (meta) {
    const trades = Number.isInteger(view.tradeCount) ? view.tradeCount : 0;
    const drag = Number.isFinite(view.feeDragPpm) ? ` · 费用拖累 ${formatReturnPpm(view.feeDragPpm)}` : '';
    const liq = view.liquidation ? ' · 收盘卖出' : '';
    meta.textContent = `成交 ${trades} 笔${drag}${liq}`;
  }
  const idEl = document.getElementById('intradaySettleIdentity');
  if (idEl) {
    if (view.symbol || view.name || view.sessionDate) {
      idEl.hidden = false;
      const name = view.name ? `${view.name} ` : '';
      const sym = view.symbol || '';
      const date = view.sessionDate ? ` · ${view.sessionDate}` : '';
      idEl.textContent = `${name}${sym}${date}`.trim();
    } else {
      idEl.hidden = true;
    }
  }
  const buy = document.getElementById('intradayBuyBtn');
  const sell = document.getElementById('intradaySellBtn');
  const pauseBtn = document.getElementById('intradayPauseBtn');
  if (buy) buy.disabled = true;
  if (sell) sell.disabled = true;
  if (pauseBtn) pauseBtn.hidden = true;
  hideBoot();
}

function enqueueFinish() {
  if (state.finishing || state.settled || state.settleBlocked || !state.sessionId) return;
  if (Date.now() < finishNotBefore) return;
  state.finishing = true;
  enqueue(async () => {
    try {
      if (!readClock().settleReady || state.settled) {
        state.finishing = false;
        return;
      }
      const data = await apiSend(`/intraday/sessions/${encodeURIComponent(state.sessionId)}/finish`, {
        method: 'POST',
        body: { expectedRevision: state.revision, finish: true },
        key: newKey(),
      });
      const view = settlementView(data);
      if (!view) {
        state.finishing = false;
        finishNotBefore = Date.now() + 200;
        return;
      }
      if (Number.isInteger(data.revision)) state.revision = data.revision;
      state.settled = true;
      state.live = false;
      paintSettlement(view);
      stopRaf();
    } catch (err) {
      state.finishing = false;
      if (classifyFinishFailure(err) === 'latch') {
        state.settleBlocked = true;
        handleBackgroundError(err);
        return;
      }
      finishNotBefore = Date.now() + (isLoginFailure(err) ? 1000 : 200);
      if (isLoginFailure(err)) handleBackgroundError(err);
    }
  });
}

function stopRaf() {
  if (state.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.raf);
  state.raf = 0;
}

function tick() {
  state.raf = requestAnimationFrame(tick);
  if (!state.live || state.settled) return;
  const gate = playbackGate({ pauseKnown: state.pauseKnown, pausedAtMs: state.pausedAtMs });
  const clock = readClock();
  syncHud(clock);
  if (state.chart) paintChart(clock);
  if (!gate.prefetchLoop && state.pausedAtMs == null) return;
  if (shouldPrefetch({
    cursor: state.cursor,
    released: clock.released,
    inFlight: state.prefetching,
    originKnown: state.originKnown,
  })) enqueuePrefetch();
  if (gate.finish && clock.settleReady) enqueueFinish();
}

function startRaf() {
  stopRaf();
  if (typeof requestAnimationFrame !== 'function') return;
  state.raf = requestAnimationFrame(tick);
}

function stopPlayback() {
  stopRaf();
  paintedKey = '';
  state.live = false;
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  if (state.chart) {
    state.chart.dispose();
    state.chart = null;
  }
}

async function leaveScreen() {
  stopPlayback();
  state = freshState();
  createKey = null;
  const screen = document.getElementById('intradayScreen');
  if (screen) {
    screen.classList.remove('active');
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
  }
  const { showHome } = await import('./home-ia.js');
  showHome();
}

async function onBack() {
  if (state.sessionId && state.live && !state.settled) {
    const ok = window.confirm('要放弃当前分时对局吗？放弃不退韭币。');
    if (!ok) return;
    try {
      await apiSend(`/intraday/sessions/${encodeURIComponent(state.sessionId)}/abandon`, { method: 'POST' });
    } catch (err) {
      if (isLoginFailure(err)) {
        openAuthModal('login');
        return;
      }
      if (err.code !== 'GAME_NOT_ACTIVE') {
        showToast(err.message || '放弃失败', 'error');
        return;
      }
    }
  }
  await leaveScreen();
}

function onAct(side) {
  if (state.settled) return;
  const clock = readClock();
  const controls = controlsFor(clock);
  if (!clickShouldSend(controls, side)) return;
  const barIndex = controls.barIndex;
  enqueue(async () => {
    if (!queuedActAllowed({
      originMs: state.originMs,
      nowMs: alignedNow(),
      cursor: state.cursor,
      barIndex,
      acted: state.acted.has(barIndex),
    })) return;
    try {
      await sendAdvance({
        expectedRevision: state.revision,
        op: 'act',
        actions: [{ barIndex, side }],
      });
      state.acted.add(barIndex);
      state.trades.push({ barIndex, side });
    } catch (err) {
      if (err.code === 'BAR_ALREADY_ACTED') state.acted.add(barIndex);
      if (err.code === 'REVISION_CONFLICT' && Number.isInteger(err.details?.actual)) {
        state.revision = err.details.actual;
      }
      handleBackgroundError(err);
    }
  });
}

function onPause() {
  if (state.mode !== 'practice' || state.settled || !state.sessionId) return;
  const pause = state.pausedAtMs == null;
  enqueue(async () => {
    try {
      await sendAdvance(
        { expectedRevision: state.revision, op: 'prefetch', pause },
        { pauseIntent: pause },
      );
    } catch (err) {
      if (err.code === 'REVISION_CONFLICT' && Number.isInteger(err.details?.actual)) {
        state.revision = err.details.actual;
      }
      handleBackgroundError(err);
    }
  });
}

function bindUi() {
  if (uiBound || typeof document === 'undefined') return;
  uiBound = true;
  document.getElementById('intradayBackBtn')?.addEventListener('click', () => {
    onBack().catch((err) => showToast(err.message || '返回失败', 'error'));
  });
  document.getElementById('intradayBuyBtn')?.addEventListener('click', () => onAct('buy'));
  document.getElementById('intradaySellBtn')?.addEventListener('click', () => onAct('sell'));
  document.getElementById('intradayPauseBtn')?.addEventListener('click', () => onPause());
}

async function bootChart() {
  setBootStage('缓冲分时');
  await nextPaint();
  await catchUpPrefetch();
  await mountChart();
  setBootStage('图表就绪');
  state.bootDone = true;
  await nextPaint();
  const clock = readClock();
  if (state.cursor < clock.released) showUnderrun();
  else hideBoot();
  syncHud(clock);
  state.live = true;
  startRaf();
}

let rankedConfirmResolver = null;

function ensureRankedConfirmModal() {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('intradayRankedConfirmModal');
  if (existing) return existing;
  const wrap = document.createElement('div');
  wrap.id = 'intradayRankedConfirmModal';
  wrap.className = 'jiu-coin-modal';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="jiu-coin-dialog" role="dialog" aria-modal="true" aria-labelledby="intradayRankedConfirmTitle">
      <button type="button" class="jiu-coin-close-x" id="intradayRankedConfirmCloseX" aria-label="关闭">×</button>
      <h2 id="intradayRankedConfirmTitle">开始空仓正式局</h2>
      <p class="jiu-coin-modal-body" id="intradayRankedConfirmBody"></p>
      <div class="jiu-coin-modal-actions">
        <button type="button" class="jiu-coin-secondary" id="intradayRankedConfirmCancel">取消</button>
        <button type="button" class="jiu-coin-primary" id="intradayRankedConfirmOk">消耗 30 韭币开始</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => resolveRankedConfirm(false);
  document.getElementById('intradayRankedConfirmCancel')?.addEventListener('click', close);
  document.getElementById('intradayRankedConfirmCloseX')?.addEventListener('click', close);
  document.getElementById('intradayRankedConfirmOk')?.addEventListener('click', () => resolveRankedConfirm(true));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  return wrap;
}

function resolveRankedConfirm(ok) {
  const modal = typeof document !== 'undefined'
    ? document.getElementById('intradayRankedConfirmModal')
    : null;
  if (modal) modal.hidden = true;
  if (!rankedConfirmResolver) return;
  const resolve = rankedConfirmResolver;
  rankedConfirmResolver = null;
  resolve(ok);
}

function askRankedFlatConfirm() {
  const modal = ensureRankedConfirmModal();
  const body = typeof document !== 'undefined'
    ? document.getElementById('intradayRankedConfirmBody')
    : null;
  if (body) body.textContent = RANKED_FLAT_CONFIRM_TEXT;
  return new Promise((resolve) => {
    rankedConfirmResolver = resolve;
    if (!modal) {
      resolve(false);
      return;
    }
    modal.hidden = false;
    document.getElementById('intradayRankedConfirmOk')?.focus();
  });
}

async function backToPlayModes() {
  stopPlayback();
  state = freshState();
  createKey = null;
  const screen = document.getElementById('intradayScreen');
  if (screen) {
    screen.classList.remove('active');
    screen.hidden = true;
    screen.setAttribute('aria-hidden', 'true');
  }
  const { showPlayModes } = await import('./home-ia.js');
  showPlayModes();
}

async function openFlatSession(mode) {
  if (mode !== 'practice' && mode !== 'ranked') return;
  if (state.starting) return;
  if (state.live && !state.settled) return;
  state.starting = true;
  try {
    stopPlayback();
    state = freshState();
    state.starting = true;
    createKey = null;
    revealIntradayScreen();
    setBootStage(INTRADAY_BOOT_STAGES[0]);
    bindUi();
    const settle = document.getElementById('intradaySettle');
    if (settle) settle.hidden = true;
    await nextPaint();
    if (!(await ensureLoggedIn())) return;
    setBootStage('创建会话');
    await nextPaint();
    if (!createKey) createKey = newKey();
    let data;
    try {
      data = await apiSend('/intraday/sessions', {
        method: 'POST',
        body: { mode, startMode: 'flat' },
        key: createKey,
      });
    } catch (err) {
      if (isLoginFailure(err)) {
        openAuthModal('login');
        return;
      }
      if (err.code === 'ACTIVE_GAME_EXISTS' && err.details?.kind === 'intraday' && err.details.sessionId && !err.details.game) {
        await resumeIntradaySession(err.details.sessionId);
        return;
      }
      if (err.code === 'PHASE_NOT_OPEN' || err.code === 'PHASE_CLOSED' || err.code === 'INTRADAY_CHANCE_USED') {
        showToast(err.message || '现在不能开空仓正式局', 'error');
        await backToPlayModes();
        return;
      }
      showToast(err.message || '开局失败', 'error');
      if (mode === 'ranked') await backToPlayModes();
      return;
    }
    adoptCreate(data);
    if (mode === 'ranked' && !state.originKnown) {
      showToast('正式局没有公共相位，未开始', 'error');
      await backToPlayModes();
      return;
    }
    refreshMe().catch(() => {});
    try {
      await bootChart();
    } catch (err) {
      const el = document.getElementById('intradayChart');
      if (el) markChartFailed(el, '图表加载失败，请检查网络后刷新');
      if (isLoginFailure(err)) openAuthModal('login');
      else showToast(err.message || '图表未就绪', 'error');
    }
  } finally {
    state.starting = false;
  }
}

export async function startIntradayPractice() {
  return openFlatSession('practice');
}

/** Flat ranked only. Confirms the public 21:00 phase, then preloads an empty chart inside the join window. */
export async function startIntradayRankedFlat() {
  if (state.starting || (state.live && !state.settled)) return;
  if (!(await ensureLoggedIn())) return;
  let status;
  try {
    status = await apiSend('/intraday');
  } catch (err) {
    if (isLoginFailure(err)) {
      openAuthModal('login');
      return;
    }
    showToast(err.message || '无法读取分时相位', 'error');
    return;
  }
  if (status?.activeSession?.sessionId) {
    await resumeIntradaySession(status.activeSession.sessionId);
    return;
  }
  const gate = rankedFlatGate(status, status.serverNowMs);
  if (!gate.ok) {
    showToast(gate.message, 'error');
    return;
  }
  const accepted = await askRankedFlatConfirm();
  if (!accepted) return;
  await openFlatSession('ranked');
}

export async function resumeIntradaySession(sessionId) {
  if (!sessionId || resumeLock) return;
  resumeLock = true;
  try {
    stopPlayback();
    state = freshState();
    state.starting = true;
    revealIntradayScreen();
    setBootStage(INTRADAY_BOOT_STAGES[0]);
    bindUi();
    const settle = document.getElementById('intradaySettle');
    if (settle) settle.hidden = true;
    await nextPaint();
    if (!(await ensureLoggedIn())) return;
    setBootStage('创建会话');
    await nextPaint();
    restoreStoredClock(sessionId);
    let status;
    try {
      status = await apiSend('/intraday');
    } catch (err) {
      if (isLoginFailure(err)) {
        openAuthModal('login');
        return;
      }
      showToast(err.message || '无法继续分时对局', 'error');
      return;
    }
    const session = status?.activeSession;
    if (!session || session.sessionId !== sessionId) {
      showToast('没有可继续的分时对局', 'error');
      return;
    }
    const hadOrigin = state.originKnown;
    applyProgress(session);
    sampleClockOnce(session.serverNowMs);
    if (!hadOrigin && !session.phaseStartsAt) state.originKnown = false;
    if (session.phaseStartsAt) {
      state.originMs = Date.parse(session.phaseStartsAt);
      state.originKnown = Number.isFinite(state.originMs);
    }
    if (session.mode === 'ranked') {
      state.pausedAtMs = null;
      state.pauseKnown = true;
      if (!session.phaseStartsAt) state.originKnown = false;
    }
    try {
      await bootChart();
    } catch (err) {
      const el = document.getElementById('intradayChart');
      if (el) markChartFailed(el, '图表加载失败，请检查网络后刷新');
      showToast(err.message || '图表未就绪', 'error');
    }
  } finally {
    resumeLock = false;
    state.starting = false;
  }
}

export async function abandonIntradaySession(sessionId) {
  if (!sessionId) return null;
  if (!(await ensureLoggedIn())) return null;
  try {
    const data = await apiSend(`/intraday/sessions/${encodeURIComponent(sessionId)}/abandon`, { method: 'POST' });
    if (state.sessionId === sessionId) {
      state.live = false;
      state.settled = true;
      stopRaf();
    }
    return data;
  } catch (err) {
    if (isLoginFailure(err)) {
      openAuthModal('login');
      return null;
    }
    if (err.code === 'GAME_NOT_ACTIVE') return null;
    showToast(err.message || '放弃失败', 'error');
    return null;
  }
}
