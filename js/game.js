// ========== GAME FUNCTIONS ==========
import { chartRefs } from './state.js';
import {
    getSession,
    getStocksCatalog,
    resetSession,
    applyEngineResult,
    patchSession,
    selectVisibleKline,
    selectGameWindow,
    selectTodayBar,
} from './game-session.js';
import { applyChartTheme } from './utils.js';
import { buildKlineOption } from './kline-option.js';
import { endGame } from './result.js';
import { replayGame, settleGame } from '../shared/engine.js';
import {
    replayPuzzle,
    settlePuzzle,
    puzzleActionErrorZh,
} from '../shared/puzzleEngine.js';
import {
    persistCurrentCloudDraft,
    appendCloudDecision,
    rewindCloudGame,
    fetchServerConfigFeatures,
} from './game-sync.js';
import { amountWithCoinHtml, refreshJiuCoinStatus } from './jiu-coin.js';
import { getAuthState, showToast, refreshMe } from './auth.js';
import { Route, prepareScreen, activateScreen, setHeaderChrome } from './screen-router.js';

const MOODS = [
    '市场在等待你的判断…',
    '行情正在酝酿之中…',
    '机会稍纵即逝，请谨慎决策',
    '趋势已初现端倪',
    '多空博弈进入关键时刻',
    '资金在悄悄流动…',
    '谁能预测下一根K线？',
    '坚守还是离场，考验人心',
    '市场永远有最后一次机会',
    '最后冲刺阶段，决策至关重要'
];

export function readFillModeFromUi() {
    const checked = document.querySelector('input[name="fillMode"]:checked');
    const v = checked && checked.value;
    return v === 'same_close' ? 'same_close' : 'next_open';
}


/** On phone, collapse 波段分析 / 交易日志 so K-line + sticky actions share the viewport. */
function syncMobileIntelDefaults() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    document.querySelectorAll('#gameScreen details.intel-card').forEach((el) => {
        el.open = false;
    });
}


function sessionGameDays(session = getSession()) {
    return session.gameDays || 30;
}

function isPuzzleSession(session = getSession()) {
    return session.gameKind === 'puzzle';
}

/** Feed #gameScreen from puzzle snapshot bars (short window + optional history). */
function seedPuzzleSession(cloud) {
    const bars = Array.isArray(cloud.bars) ? cloud.bars : [];
    const history = Array.isArray(cloud.history) ? cloud.history : [];
    const gameDays = Number.isInteger(cloud.gameDays) ? cloud.gameDays : bars.length;
    const historyDays = Number.isInteger(cloud.historyLength)
        ? cloud.historyLength
        : history.length;
    if (!bars.length || bars.length !== gameDays) {
        throw new Error('残局行情快照无效');
    }
    const init = cloud.initialState || {
        cash: 100000,
        qty: 0,
        cost: 0,
        buyFillDay: null,
        firstSellableDay: 1,
    };
    const takeoverMark = bars[0].open;
    const takeoverNav = Number(init.cash) + Number(init.qty || 0) * takeoverMark;
    const day1Close = bars[0].close;
    const equity0 = Number(init.cash) + Number(init.qty || 0) * day1Close;
    const qty = Number(init.qty) || 0;
    const firstSellable = Number(init.firstSellableDay) || 1;
    let position = 'empty';
    if (qty > 0) {
        position = firstSellable > 1 ? 'locked' : 'holding';
    }
    const currentStock = {
        code: cloud.stockCode || 'PUZZLE',
        name: cloud.stockName || '残局挑战',
        kline: history.concat(bars),
    };
    patchSession({
        cloudMode: true,
        cloudGameId: cloud.gameId,
        datasetVersion: cloud.datasetVersion || null,
        ruleVersion: cloud.ruleVersion || 'puzzle-mtm-v1',
        fillMode: cloud.fillMode || 'next_open',
        protocolVersion: cloud.protocolVersion || 'legacy-batch',
        gameKind: 'puzzle',
        gameDays,
        initialState: init,
        firstSellableDay: firstSellable,
        maxOrders: cloud.maxOrders ?? null,
        puzzleLevelKey: cloud.levelKey || cloud.puzzleLevelKey || null,
        puzzleResult: null,
        takeoverNav,
        revision: cloud.revision ?? 0,
        undoCount: 0,
        assistClass: cloud.assistClass || 'legacy',
        currentStock,
        historyLength: historyDays,
        gameKline: history.concat(bars),
        position,
        costBasis: qty > 0 ? Number(init.cost) || 0 : 0,
        lastBuyFillDay: init.buyFillDay != null ? init.buyFillDay : null,
        totalReturn: takeoverNav > 0 ? equity0 / takeoverNav : 1,
        practiceOnly: false,
    });
}

function puzzlePositionFromState(qty, decisionDay, buyFillDay, firstSellableDay) {
    if (!(qty > 0)) return 'empty';
    const fillDayIfSell = decisionDay + 1; // next_open
    if (decisionDay < firstSellableDay) return 'locked';
    if (buyFillDay != null && fillDayIfSell <= buyFillDay) return 'locked';
    return 'holding';
}

function syncFromPuzzleEngine(r, { finished = false, bars = null } = {}) {
    const session = getSession();
    const gameDays = sessionGameDays(session);
    const init = session.initialState || {};
    const firstSellable = Number(session.firstSellableDay || init.firstSellableDay || 1);
    const trades = (r.trades || []).map((t) => ({
        type: t.type,
        day: t.day,
        price: t.price,
        return: t.return != null ? t.return : null,
    }));
    const tradeGains = trades
        .filter((t) => t.type === 'sell' && t.return != null)
        .map((t) => (t.return - 1) * 100);
    let holdingDays = 0;
    for (const t of trades) {
        if (t.type === 'buy') holdingDays = 0;
        // approximate; engine owns truth on settle
    }
    if (finished) {
        patchSession({
            tradeHistory: trades,
            valuation: r.valuation,
            tradeGains,
            holdingDays: r.holdingDays != null ? r.holdingDays : holdingDays,
            ruleVersion: r.ruleVersion,
            totalReturn: r.takeoverNav > 0 ? r.finalEquity / r.takeoverNav : 1,
            position: 'empty',
            costBasis: 0,
            lastBuyFillDay: null,
            returnPpm: r.returnPpm,
            returnPct: r.returnPct,
            takeoverNav: r.takeoverNav,
        });
        return;
    }
    const actionCount = session.actions.length;
    const asOfDay = Math.min(Math.max(actionCount + 1, 1), gameDays);
    const mark = bars && bars[asOfDay - 1] ? bars[asOfDay - 1].close : null;
    const equity =
        mark != null ? r.cash + r.qty * mark : r.finalEquity;
    const decisionDay = Math.min(actionCount + 1, gameDays);
    patchSession({
        tradeHistory: trades,
        valuation: null,
        tradeGains,
        holdingDays,
        ruleVersion: r.ruleVersion,
        position: puzzlePositionFromState(r.qty, decisionDay, r.buyFillDay, firstSellable),
        costBasis: r.qty > 0 ? r.cost || 0 : 0,
        lastBuyFillDay: r.buyFillDay,
        totalReturn: r.takeoverNav > 0 ? equity / r.takeoverNav : 1,
        returnPpm: null,
        returnPct: null,
        takeoverNav: r.takeoverNav,
    });
}

export async function startGame(options = {}) {
    // Reset session fields through the game-session seam (preserves stocksData).
    resetSession({
        practiceOnly: !!options.practiceOnly,
        fillMode: readFillModeFromUi(),
    });

    const cloud = options.cloud || null;
    const catalog = getStocksCatalog();
    const isPuzzle =
        !!cloud &&
        (cloud.gameKind === 'puzzle' ||
            (Array.isArray(cloud.bars) && cloud.bars.length >= 6));

    if (isPuzzle) {
        seedPuzzleSession(cloud);
    } else {
        const gameDays = 30;
        if (cloud && Number.isInteger(cloud.stockIndex) && catalog[cloud.stockIndex]) {
            const currentStock = catalog[cloud.stockIndex];
            const historyDays = Number.isInteger(cloud.historyLength)
                ? cloud.historyLength
                : Math.min(30, currentStock.kline.length - gameDays);
            const gameStartIndex = Number.isInteger(cloud.windowStartIndex)
                ? cloud.windowStartIndex
                : historyDays;
            patchSession({
                cloudMode: true,
                cloudGameId: cloud.gameId,
                datasetVersion: cloud.datasetVersion || null,
                ruleVersion: cloud.ruleVersion || getSession().ruleVersion,
                fillMode: cloud.fillMode || getSession().fillMode,
                protocolVersion: cloud.protocolVersion || null,
                gameKind: cloud.gameKind || null,
                gameDays: 30,
                revision: cloud.revision ?? 0,
                undoCount: cloud.undoCount ?? 0,
                assistClass: cloud.assistClass || null,
                currentStock,
                historyLength: historyDays,
                gameKline: currentStock.kline.slice(
                    gameStartIndex - historyDays,
                    gameStartIndex + gameDays
                ),
            });
        } else {
            // Local practice: pick random stock and window (30 game days).
            const stockIndex = Math.floor(Math.random() * catalog.length);
            const currentStock = catalog[stockIndex];
            const klineLen = currentStock.kline.length;
            const historyDays = Math.min(30, klineLen - gameDays);
            const minStart = historyDays;
            const maxStart = klineLen - gameDays; // inclusive
            const span = Math.max(1, maxStart - minStart + 1);
            const gameStartIndex = minStart + Math.floor(Math.random() * span);
            patchSession({
                currentStock,
                historyLength: historyDays,
                gameDays: 30,
                gameKline: currentStock.kline.slice(
                    gameStartIndex - historyDays,
                    gameStartIndex + gameDays
                ),
                practiceOnly: true,
            });
        }
    }

    // Switch screens first so the fill-mode modal can close over a painted shell.
    prepareScreen(Route.GAME);
    activateScreen(Route.GAME);
    syncMobileIntelDefaults();

    // Clear leftover 波段分析 from a previous run
    const tagsEl = document.getElementById('waveAnalysisTags');
    if (tagsEl) tagsEl.innerHTML = '';
    const textEl = document.getElementById('waveAnalysisText');
    if (textEl) textEl.textContent = '暂无分析数据，随着行情展开将自动生成。';

    const resumeActions = Array.isArray(options.resumeActions) ? options.resumeActions : null;

    // Paint shell chrome (day / PnL / buttons) before ECharts init.
    if (!(resumeActions && resumeActions.length)) {
        updateUI();
        resetOHLCToToday();
        renderWaveAnalysis();
    }

    await new Promise(function (resolve) {
        requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
        });
    });

    if (!initChart()) {
        document.getElementById('gameScreen').classList.remove('active');
        setHeaderChrome('hidden');
        if (typeof window.restoreSimShell === 'function') {
            window.restoreSimShell();
        } else {
            document.getElementById('startScreen').style.display = 'flex';
        }
        return;
    }

    if (resumeActions && resumeActions.length) {
        applyCloudResume(resumeActions);
    } else if (getSession().cloudMode) {
        persistCurrentCloudDraft();
    }
}

/**
 * Replay saved mid-game actions onto the current cloud seed (day / holdings / MTM).
 * Invalid drafts are ignored so the player still enters day 1 of the same seed.
 */
export function applyCloudResume(actions) {
    if (!Array.isArray(actions) || !actions.length) return false;
    const session = getSession();
    const bars = getGameBars();
    const gameDays = sessionGameDays(session);
    const decisionDays = gameDays - 1;
    if (bars.length < gameDays) return false;
    const clipped = actions.slice(0, decisionDays);
    if (isPuzzleSession(session)) {
        const r = replayPuzzle({
            fillMode: session.fillMode,
            bars,
            actions: clipped,
            finish: false,
            initialState: session.initialState,
            maxOrders: session.maxOrders,
        });
        if (!r.ok) {
            console.warn('puzzle resume draft invalid, starting day 1', r);
            updateUI();
            resetOHLCToToday();
            renderWaveAnalysis();
            return false;
        }
        patchSession({ actions: clipped.slice() });
        syncFromPuzzleEngine(r, { finished: false, bars });
        patchSession({ currentDay: Math.min(clipped.length + 1, gameDays) });
    } else {
        const r = replayGame({
            fillMode: session.fillMode,
            bars,
            actions: clipped,
            finish: false
        });
        if (!r.ok) {
            console.warn('cloud resume draft invalid, starting day 1', r);
            updateUI();
            resetOHLCToToday();
            renderWaveAnalysis();
            return false;
        }
        patchSession({ actions: clipped.slice() });
        syncFromEngine(r, { finished: false, bars });
        patchSession({ currentDay: Math.min(clipped.length + 1, gameDays) });
    }
    updateUI();
    updateChart();
    resetOHLCToToday();
    renderWaveAnalysis();
    persistCurrentCloudDraft();
    return true;
}

export function initChart() {
    const chartDom = document.getElementById('kline-chart');
    if (!window.echarts || !chartDom) {
        console.error('ECharts unavailable; cannot init K-line chart');
        return false;
    }
    if (chartRefs.klineChart) {
        chartRefs.klineChart.dispose();
    }
    chartRefs.klineChart = echarts.init(chartDom);

    // Sync crosshair to OHLC panel
    chartRefs.klineChart.on('mousemove', function(params) {
        if (params.dataIndex == null) return;
        const session = getSession();
        const histLen = session.historyLength;
        const visibleData = selectVisibleKline(session);
        const d = visibleData[params.dataIndex];
        if (!d) return;
        document.getElementById('hoverLabel').textContent = '悬停数据';
        document.getElementById('hoverDate').textContent = d.date;
        document.getElementById('hoverOpen').textContent = d.open.toFixed(2);
        document.getElementById('hoverHigh').textContent = d.high.toFixed(2);
        document.getElementById('hoverLow').textContent = d.low.toFixed(2);
        document.getElementById('hoverClose').textContent = d.close.toFixed(2);
        document.getElementById('hoverVolume').textContent = (d.volume / 10000).toFixed(0) + ' 万手';
    });

    chartRefs.klineChart.on('mouseout', function() {
        resetOHLCToToday();
    });

    bindMAToggles();
    updateChart();
    // Resize after flex layout settles
    setTimeout(() => chartRefs.klineChart.resize(), 50);
    return true;
}

let maTogglesBound = false;
function bindMAToggles() {
    if (maTogglesBound) return;
    maTogglesBound = true;
    ['indicatorMA5', 'indicatorMA10', 'indicatorMA20', 'indicatorMA30'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => updateChart());
    });
}

function maChecked(id) {
    const el = document.getElementById(id);
    return el ? el.checked : true;
}

function resetOHLCToToday() {
    const todayData = selectTodayBar();
    if (!todayData) return;
    document.getElementById('hoverLabel').textContent = '今日收盘';
    document.getElementById('hoverDate').textContent = todayData.date;
    document.getElementById('hoverOpen').textContent = todayData.open.toFixed(2);
    document.getElementById('hoverHigh').textContent = todayData.high.toFixed(2);
    document.getElementById('hoverLow').textContent = todayData.low.toFixed(2);
    document.getElementById('hoverClose').textContent = todayData.close.toFixed(2);
    document.getElementById('hoverVolume').textContent = (todayData.volume / 10000).toFixed(0) + ' 万手';
}

export function updateChart() {
    if (!chartRefs.klineChart) return;
    const session = getSession();
    const histLen = session.historyLength;
    const visibleData = selectVisibleKline(session);

    const maSelected = {
        '5日线': maChecked('indicatorMA5'),
        '10日线': maChecked('indicatorMA10'),
        '20日线': maChecked('indicatorMA20'),
        '30日线': maChecked('indicatorMA30'),
    };

    const option = buildKlineOption({
        bars: visibleData,
        historyLength: histLen,
        trades: session.tradeHistory,
        mode: 'game',
        maSelected,
        syncHover: (kd) => {
            document.getElementById('hoverLabel').textContent = '悬停数据';
            document.getElementById('hoverDate').textContent = kd.date;
            document.getElementById('hoverOpen').textContent = kd.open.toFixed(2);
            document.getElementById('hoverHigh').textContent = kd.high.toFixed(2);
            document.getElementById('hoverLow').textContent = kd.low.toFixed(2);
            document.getElementById('hoverClose').textContent = kd.close.toFixed(2);
            document.getElementById('hoverVolume').textContent = (kd.volume / 10000).toFixed(0) + ' 万手';
        },
    });

    chartRefs.klineChart.setOption(option);
    applyChartTheme(chartRefs.klineChart);
}

export function getGameBars() {
    return selectGameWindow();
}

function syncFromEngine(r, { finished = false, bars = null } = {}) {
    applyEngineResult(r, { finished, bars });
}

function applyLocalAction(action) {
    const session = getSession();
    const bars = getGameBars();
    const gameDays = sessionGameDays(session);
    if (bars.length < gameDays) return false;
    const nextActions = session.actions.concat(action);
    if (isPuzzleSession(session)) {
        const r = replayPuzzle({
            fillMode: session.fillMode,
            bars,
            actions: nextActions,
            finish: false,
            initialState: session.initialState,
            maxOrders: session.maxOrders,
        });
        if (!r.ok) {
            showToast(puzzleActionErrorZh(r.message), 'error');
            return false;
        }
        patchSession({ actions: nextActions, pendingAction: null });
        syncFromPuzzleEngine(r, { finished: false, bars });
        patchSession({ currentDay: Math.min(nextActions.length + 1, gameDays) });
    } else {
        const r = replayGame({
            fillMode: session.fillMode,
            bars,
            actions: nextActions,
            finish: false
        });
        if (!r.ok) {
            showToast(puzzleActionErrorZh(r.message) || r.message || '操作不合法', 'error');
            return false;
        }
        patchSession({ actions: nextActions, pendingAction: null });
        syncFromEngine(r, { finished: false, bars });
        patchSession({ currentDay: nextActions.length + 1 });
    }
    persistCurrentCloudDraft();
    updateUI();
    updateChart();
    renderWaveAnalysis();
    return true;
}

function applyServerStateActions(state) {
    const bars = getGameBars();
    const actions = Array.isArray(state.actions) ? state.actions.slice() : [];
    const r = replayGame({
        fillMode: getSession().fillMode,
        bars,
        actions,
        finish: false
    });
    if (!r.ok) return false;
    patchSession({
        actions,
        pendingAction: null,
        revision: state.revision ?? getSession().revision,
        undoCount: state.undoCount ?? getSession().undoCount,
        assistClass: state.assistClass ?? getSession().assistClass,
        protocolVersion: state.protocolVersion || getSession().protocolVersion,
        currentDay: Math.min(actions.length + 1, sessionGameDays()),
    });
    syncFromEngine(r, { finished: false, bars });
    persistCurrentCloudDraft();
    updateUI();
    updateChart();
    renderWaveAnalysis();
    return true;
}

export async function handleAction(action) {
    const session = getSession();
    if (session.rewindBusy) return;
    const gameDays = sessionGameDays(session);
    if (session.currentDay >= gameDays) return;
    if (action !== 'buy' && action !== 'sell' && action !== 'hold') return;

    const bars = getGameBars();
    if (bars.length < gameDays) return;

    // Client-side illegal-action guards (puzzle often starts long).
    if (action === 'buy' && session.position !== 'empty') {
        showToast('已有持仓，不能再买入', 'error');
        return;
    }
    if (action === 'sell') {
        if (session.position === 'empty') {
            showToast('空仓无法卖出', 'error');
            return;
        }
        if (isPuzzleSession(session) && session.currentDay < (session.firstSellableDay || 1)) {
            showToast('尚未到可卖日（T+1）', 'error');
            return;
        }
        if (session.position === 'locked') {
            showToast('受 T+1 限制，今日不可卖出', 'error');
            return;
        }
    }

    if (session.cloudMode && session.protocolVersion === 'event-v1' && !isPuzzleSession(session)) {
        try {
            setActionControlsLocked(true);
            const state = await appendCloudDecision(action, session.revision ?? 0);
            applyServerStateActions(state);
        } catch (e) {
            showToast(e.message || '决策同步失败', 'error');
        } finally {
            setActionControlsLocked(false);
            updateUI();
        }
        return;
    }

    applyLocalAction(action);
}

function setActionControlsLocked(locked) {
    ['buyBtn', 'sellBtn', 'holdBtn', 'finishBtn', 'rewindBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !!locked || (id === 'rewindBtn' && !el.dataset.eligible);
    });
}

let rewindFeatures = null;
async function ensureRewindFeatures() {
    if (rewindFeatures) return rewindFeatures;
    rewindFeatures = await fetchServerConfigFeatures();
    return rewindFeatures;
}

export async function openRewindConfirm() {
    const session = getSession();
    if (!session.cloudMode || session.protocolVersion !== 'event-v1' || session.gameKind === 'daily' || session.gameKind === 'puzzle') return;
    if (session.undoCount >= 1 || session.rewindBusy) return;
    if (!session.actions || session.actions.length < 1) return;
    const feats = await ensureRewindFeatures();
    if (!feats.gameRewind) return;

    const auth = getAuthState();
    const bal = Number(auth.user?.jiuCoinBalance ?? 0);
    const cost = 50;
    const after = bal - cost;
    const targetDay = session.actions.length; // back to day n submit cursor → display day n

    ensureRewindModal();
    const body = document.getElementById('rewindConfirmBody');
    if (body) {
        body.innerHTML =
            `<p>消耗 ${amountWithCoinHtml(cost, { size: 14 })}，回到上一决策日。本局将记为反悔结果，每局限一次。</p>` +
            `<p class="rewind-balance">当前余额 ${amountWithCoinHtml(bal, { size: 14 })} → 扣费后 ${amountWithCoinHtml(Math.max(after, 0), { size: 14 })}</p>` +
            `<p class="rewind-target">目标决策日：第 ${targetDay} 日</p>` +
            (after < 0 ? `<p class="rewind-warn">韭币不足，无法反悔</p>` : '');
    }
    const confirmBtn = document.getElementById('rewindConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = after < 0;
    const modal = document.getElementById('rewindConfirmModal');
    if (modal) {
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
    }
}

function closeRewindConfirm() {
    const modal = document.getElementById('rewindConfirmModal');
    if (modal) {
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }
}

function ensureRewindModal() {
    if (document.getElementById('rewindConfirmModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'rewindConfirmModal';
    wrap.className = 'rewind-modal';
    wrap.hidden = true;
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = `
      <div class="rewind-backdrop" data-rewind-dismiss="1"></div>
      <div class="rewind-dialog" role="dialog" aria-modal="true" aria-labelledby="rewindConfirmTitle">
        <h2 id="rewindConfirmTitle">确认反悔</h2>
        <div id="rewindConfirmBody" class="rewind-body"></div>
        <div class="rewind-actions">
          <button type="button" class="rewind-btn-secondary" id="rewindCancelBtn">取消</button>
          <button type="button" class="rewind-btn-primary" id="rewindConfirmBtn">确认反悔</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
        if (e.target?.dataset?.rewindDismiss) closeRewindConfirm();
    });
    document.getElementById('rewindCancelBtn').onclick = closeRewindConfirm;
    document.getElementById('rewindConfirmBtn').onclick = () => confirmRewind();
}

let rewindIdempotencyKey = null;
export async function confirmRewind() {
    const session = getSession();
    if (session.rewindBusy) return;
    const confirmBtn = document.getElementById('rewindConfirmBtn');
    if (!rewindIdempotencyKey) {
        rewindIdempotencyKey =
            (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
            `rw-${Date.now()}`;
    }
    patchSession({ rewindBusy: true });
    setActionControlsLocked(true);
    if (confirmBtn) confirmBtn.disabled = true;
    try {
        const { data } = await rewindCloudGame(session.revision ?? 0, {
            idempotencyKey: rewindIdempotencyKey,
        });
        applyServerStateActions(data);
        patchSession({
            undoCount: data.undoCount ?? 1,
            assistClass: data.assistClass || 'undo',
            revision: data.revision,
        });
        if (data.balanceAfter != null) {
            const auth = getAuthState();
            if (auth.user) auth.user.jiuCoinBalance = data.balanceAfter;
        }
        await refreshJiuCoinStatus().catch(() => {});
        await refreshMe().catch(() => {});
        showToast('已回到上一决策日（本局记为反悔）', 'success');
        closeRewindConfirm();
        rewindIdempotencyKey = null;
    } catch (e) {
        showToast(e.message || '反悔失败', 'error');
        if (e.code === 'INSUFFICIENT_FUNDS' || e.status === 402) {
            rewindIdempotencyKey = null;
        }
        // keep key on timeout/5xx for retry same result
        if (e.status && e.status < 500 && e.status !== 429) {
            rewindIdempotencyKey = null;
        }
    } finally {
        patchSession({ rewindBusy: false });
        setActionControlsLocked(false);
        updateUI();
    }
}

/** Last day only: settle with valuation (not a fake sell). */
export function finishSettle() {
    const session = getSession();
    const gameDays = sessionGameDays(session);
    const decisionDays = gameDays - 1;
    if (session.currentDay < gameDays || session.actions.length !== decisionDays) return;
    const bars = getGameBars();
    if (isPuzzleSession(session)) {
        const r = settlePuzzle({
            fillMode: session.fillMode,
            bars,
            actions: session.actions,
            initialState: session.initialState,
            maxOrders: session.maxOrders,
        });
        if (!r.ok) {
            showToast(puzzleActionErrorZh(r.message), 'error');
            console.error('puzzle settle failed', r);
            return;
        }
        syncFromPuzzleEngine(r, { finished: true, bars });
        endGame();
        return;
    }
    const r = settleGame({
        fillMode: session.fillMode,
        bars,
        actions: session.actions
    });
    if (!r.ok) {
        console.error('settle failed', r);
        return;
    }
    syncFromEngine(r, { finished: true, bars });
    endGame();
}

// Kept for compatibility; engine now owns fill/replay.
export function nextDay() {
    const action = getSession().pendingAction || 'hold';
    handleAction(action);
}

export function addTradeHistory(type, day, price, returnVal = null) {
    getSession().tradeHistory.push({ type, day, price, return: returnVal });
}

export function updateUI() {
    const session = getSession();
    const histLen = session.historyLength;
    const todayData = selectTodayBar(session);

    const gameDays = sessionGameDays(session);
    // Progress bar
    const pct = ((session.currentDay - 1) / gameDays * 100).toFixed(1);
    const fillEl = document.getElementById('dayProgressFill');
    if (fillEl) fillEl.style.width = pct + '%';

    // Day counter & mood
    document.getElementById('currentDay').textContent = session.currentDay;
    const totalDaysEl = document.getElementById('gameDaysTotal');
    if (totalDaysEl) totalDaysEl.textContent = String(gameDays);
    const moodEl = document.getElementById('progressMood');
    if (moodEl) {
        const moodIdx = Math.min(Math.floor((session.currentDay - 1) / 3), MOODS.length - 1);
        moodEl.textContent = MOODS[moodIdx];
    }

    // Chart subtitle — mask identity until endGame
    const subtitle = document.getElementById('chartSubtitle');
    if (subtitle) subtitle.textContent = '股票代码: ******';
    const subtitleInner = document.getElementById('chartSubtitleInner');
    if (subtitleInner) subtitleInner.textContent = '身份隐藏中';

    // ── Return ratio (judging standard). Engine still uses starting cash internally. ──
    const displayReturn = (session.totalReturn - 1) * 100;

    // Primary card: 收益率 (no absolute 初始/总资金 display)
    const pnlCard = document.getElementById('holdingPnlCard');
    const pnlEl = document.getElementById('holdingPnl');
    if (pnlEl && pnlCard) {
        pnlEl.textContent = (displayReturn >= 0 ? '+' : '') + displayReturn.toFixed(2) + '%';
        if (displayReturn > 0) {
            pnlEl.className = 'metric-value positive';
            pnlCard.className = 'metric-card primary pnl-card positive';
        } else if (displayReturn < 0) {
            pnlEl.className = 'metric-value negative';
            pnlCard.className = 'metric-card primary pnl-card negative';
        } else {
            pnlEl.className = 'metric-value neutral';
            pnlCard.className = 'metric-card primary pnl-card neutral';
        }
        pnlCard.classList.remove('asset-surge');
        void pnlCard.offsetWidth;
        pnlCard.classList.add('asset-surge');
    }

    // Position affordance without absolute cash amounts
    const fundsEl = document.getElementById('availableFunds');
    if (fundsEl) {
        fundsEl.textContent = session.position === 'empty' ? '可买入' : '已全仓';
    }

    // Position status chip
    const posEl = document.getElementById('positionStatus');
    if (posEl) {
        if (session.position === 'empty') {
            posEl.textContent = '空仓';
            posEl.className = 'board-chip neutral';
        } else if (session.position === 'locked') {
            posEl.textContent = 'T+1 锁定';
            posEl.className = 'board-chip locked';
        } else {
            posEl.textContent = '持仓中';
            posEl.className = 'board-chip positive';
        }
    }

    // Meta grid values
    document.getElementById('currentPrice').textContent = todayData.close.toFixed(2);

    const prevIdx = histLen + session.currentDay - 2;
    const prevData = prevIdx >= 0 ? session.gameKline[prevIdx] : null;
    let dailyPct = null;
    if (prevData && prevData.close > 0) {
        dailyPct = (todayData.close / prevData.close - 1) * 100;
    } else if (todayData.open > 0) {
        dailyPct = (todayData.close / todayData.open - 1) * 100;
    }
    const dailyEl = document.getElementById('dailyReturn');
    if (dailyEl) {
        if (dailyPct == null) {
            dailyEl.textContent = '--';
            dailyEl.className = 'meta-value neutral';
        } else {
            dailyEl.textContent = (dailyPct >= 0 ? '+' : '') + dailyPct.toFixed(2) + '%';
            dailyEl.className = 'meta-value ' + (dailyPct > 0 ? 'positive' : dailyPct < 0 ? 'negative' : 'neutral');
        }
    }

    const returnEl = document.getElementById('totalReturn');
    if (returnEl) {
        returnEl.textContent = (displayReturn >= 0 ? '+' : '') + displayReturn.toFixed(2) + '%';
        returnEl.className = 'meta-value ' + (displayReturn > 0 ? 'positive' : displayReturn < 0 ? 'negative' : 'neutral');
    }

    const costEl = document.getElementById('costBasis');
    if (costEl) costEl.textContent = session.costBasis > 0 ? session.costBasis.toFixed(2) : '--';

    document.getElementById('tradeCount').textContent = session.tradeHistory.length;

    // OHLC panel — show today by default
    resetOHLCToToday();

    // Day 30: only「结束并结算」— no buy/sell pretending to liquidate.
    const settleDay = session.currentDay >= gameDays;
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const holdBtn = document.getElementById('holdBtn');
    const finishBtn = document.getElementById('finishBtn');

    const rewindBtn = document.getElementById('rewindBtn');
    const busy = !!session.rewindBusy;

    if (settleDay) {
        if (buyBtn) { buyBtn.disabled = true; buyBtn.hidden = true; }
        if (sellBtn) { sellBtn.disabled = true; sellBtn.hidden = true; }
        if (holdBtn) { holdBtn.disabled = true; holdBtn.hidden = true; }
        if (finishBtn) {
            finishBtn.hidden = false;
            finishBtn.disabled = busy;
        }
    } else {
        if (buyBtn) {
            buyBtn.hidden = false;
            buyBtn.disabled = busy || session.position !== 'empty';
        }
        if (sellBtn) {
            sellBtn.hidden = false;
            // Classic next_open may queue sell while locked; puzzle forbids sell until firstSellableDay / T+1.
            const sellBlocked = isPuzzleSession(session)
                ? session.position === 'empty' || session.position === 'locked'
                : session.position === 'empty';
            sellBtn.disabled = busy || sellBlocked;
        }
        if (holdBtn) {
            holdBtn.hidden = false;
            holdBtn.disabled = busy;
        }
        if (finishBtn) {
            finishBtn.hidden = true;
            finishBtn.disabled = true;
        }
    }

    // F03 rewind: only event-v1 classic cloud, flag on, once, ≥1 decision (incl. day-30 pending settle).
    // Daily challenge (game_kind=daily) never shows rewind UI.
    void (async () => {
        const feats = await ensureRewindFeatures();
        const eligible =
            !!feats.gameRewind &&
            session.cloudMode &&
            session.gameKind !== 'daily' &&
            session.gameKind !== 'puzzle' &&
            session.protocolVersion === 'event-v1' &&
            (session.undoCount ?? 0) < 1 &&
            Array.isArray(session.actions) &&
            session.actions.length >= 1 &&
            session.actions.length <= (sessionGameDays(session) - 1);
        if (rewindBtn) {
            rewindBtn.hidden = !eligible;
            rewindBtn.dataset.eligible = eligible ? '1' : '';
            rewindBtn.disabled = !eligible || busy;
            const label = rewindBtn.querySelector('.rewind-btn-label');
            if (label && !label.dataset.hydrated) {
                label.innerHTML = `反悔 ${amountWithCoinHtml(50, { size: 12 })}`;
                label.dataset.hydrated = '1';
            }
        }
    })();

    const hintEl = document.getElementById('actionHint');
    if (hintEl) {
        const sameClose = session.fillMode === 'same_close';
        if (settleDay) {
            if (session.position === 'empty') {
                hintEl.textContent = `第 ${gameDays} 日 · 空仓可直接结束并结算`;
                hintEl.className = 'action-hint';
            } else {
                hintEl.textContent = `第 ${gameDays} 日 · 未平仓将按今日收盘做期末估值（不计卖出成交）`;
                hintEl.className = 'action-hint warning';
            }
        } else if (session.position === 'locked') {
            hintEl.textContent = sameClose
                ? 'T+1 锁定中，今日可卖出（按今日收盘价成交）'
                : 'T+1 锁定中，今日可挂卖单（按次日开盘成交）';
            hintEl.className = 'action-hint warning';
        } else if (session.position === 'empty') {
            hintEl.textContent = sameClose
                ? '当前空仓 · 买入将按今日收盘价成交'
                : '当前空仓，可以选择买入或继续观望';
            hintEl.className = 'action-hint';
        } else {
            hintEl.textContent = sameClose
                ? '当前持仓 · 卖出将按今日收盘价成交'
                : '当前持仓，可以选择卖出或继续持有';
            hintEl.className = 'action-hint';
        }
    }

    updateTradeLog();
}


export function updateTradeLog() {
    const session = getSession();
    const listEl = document.getElementById('historyList');
    const countEl = document.getElementById('tradeLogCount');
    if (!listEl) return;

    const rows = session.tradeHistory.map((trade) => {
        const retStr = trade.return
            ? ` · 收益 <strong>${((trade.return - 1) * 100 >= 0 ? '+' : '') + ((trade.return - 1) * 100).toFixed(2)}%</strong>`
            : '';
        return {
            day: trade.day,
            cls: trade.type,
            message: `${trade.type === 'buy' ? '买入' : '卖出'} @ ${trade.price.toFixed(2)}${retStr}`
        };
    });
    if (session.valuation) {
        const v = session.valuation;
        const mult = v.multiple != null ? v.multiple : (v.price / v.buyPrice);
        const pct = (mult - 1) * 100;
        rows.push({
            day: v.day,
            cls: 'valuation',
            message: `期末估值 @ ${v.price.toFixed(2)} · 浮动 <strong>${(pct >= 0 ? '+' : '') + pct.toFixed(2)}%</strong>`
        });
    }

    if (rows.length === 0) {
        listEl.innerHTML = '<div class="log-item empty">暂无交易记录</div>';
        if (countEl) countEl.textContent = '暂无记录';
        return;
    }

    if (countEl) countEl.textContent = `${session.tradeHistory.length} 笔成交`;

    listEl.innerHTML = [...rows].reverse().map((row) => `
            <div class="log-item ${row.cls}">
                <span class="log-day">D${row.day}</span>
                <span class="log-message">${row.message}</span>
            </div>
        `).join('');
}

// Keep old name for backwards compat
export function updateTradeHistory() { updateTradeLog(); }

export function renderWaveAnalysis() {
    const session = getSession();
    if (session.currentDay < 5) return; // not enough data

    const histLen = session.historyLength;
    const endIdx = histLen + session.currentDay - 1;
    const lookback = Math.min(session.currentDay, 20);
    const data = session.gameKline.slice(endIdx - lookback + 1, endIdx + 1);

    const closes = data.map(d => d.close);
    const volumes = data.map(d => d.volume);

    // Simple trend
    const first = closes[0], last = closes[closes.length - 1];
    const pct = (last - first) / first * 100;
    const trend = pct > 1 ? '上行' : pct < -1 ? '下行' : '震荡';
    const trendCls = pct > 1 ? 'positive' : pct < -1 ? 'negative' : 'neutral';

    // Volume trend
    const midVol = volumes.slice(0, Math.floor(lookback / 2));
    const latVol = volumes.slice(Math.floor(lookback / 2));
    const avgMid = midVol.reduce((a, b) => a + b, 0) / midVol.length;
    const avgLat = latVol.reduce((a, b) => a + b, 0) / latVol.length;
    const volLabel = avgLat > avgMid * 1.2 ? '放量' : avgLat < avgMid * 0.8 ? '缩量' : '量稳';
    const volCls = avgLat > avgMid * 1.2 ? 'warning' : 'neutral';

    const tagsEl = document.getElementById('waveAnalysisTags');
    if (tagsEl) {
        tagsEl.innerHTML = `
            <span class="wave-tag ${trendCls}">${trend}</span>
            <span class="wave-tag ${volCls}">${volLabel}</span>
            <span class="wave-tag accent">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>
        `;
    }

    const textEl = document.getElementById('waveAnalysisText');
    if (textEl) {
        let text = `近 ${lookback} 日走势呈<strong>${trend}</strong>，区间涨跌 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%。`;
        if (volLabel === '放量') text += ` 成交量明显放大，市场参与度提升，需关注量价配合方向。`;
        else if (volLabel === '缩量') text += ` 成交量萎缩，观望情绪较浓，行情可能处于蓄势阶段。`;
        else text += ` 成交量较为平稳，市场情绪中性。`;
        textEl.innerHTML = text;
    }
}

export function toggleIndicatorPanel() {
    const panel = document.getElementById('indicatorPanel');
    if (panel) panel.classList.toggle('open');
}
