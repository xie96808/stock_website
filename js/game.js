// ========== GAME FUNCTIONS ==========
import { chartRefs } from './state.js';
import {
    getSession,
    getStocksCatalog,
    patchSession,
    selectVisibleKline,
    selectGameWindow,
    selectTodayBar,
} from './game-session.js';
import { applyChartTheme, onThemeChange, getTheme } from './theme.js';
import { buildKlineOption } from './kline-option.js';
import { endGame } from './result.js';
import {
    persistCurrentCloudDraft,
    appendCloudDecision,
    rewindCloudGame,
    fetchGameState,
    fetchServerConfigFeatures,
} from './game-sync.js';
import {
    sessionGameDays,
    isPuzzleSession,
    canSellOnCurrentDay,
    validatePlayAction,
    applyLocalDecision,
    applyServerDecisionState,
    resumeLocalActions,
    settleLocalSession,
    prepareSessionSeed,
    evaluateRewindEligibility,
    buildRewindPreview,
    applyRewindServerResult,
    syncEventV1Decision,
    oneshotAmmoFromActions,
} from './game-play-usecase.js';
import { amountWithCoinHtml, refreshJiuCoinStatus } from './jiu-coin.js';
import { getAuthState, showToast, refreshMe } from './auth.js';
import { Route, prepareScreen, activateScreen, setHeaderChrome } from './screen-router.js';
import { formatPuzzlePlayTip, formatPlayHudChrome } from './puzzle-goals-copy.js';
import {
    syncGhostHud,
    ghostIdentityFromModifiers,
    ghostAvatarSrc,
    ghostRevealedActions,
} from './ghost-duel.js';
import { survivalFloatHud } from '../shared/survival.js';
import {
    ensureEcharts,
    markChartLoading,
    clearChartLoading,
    markChartFailed,
} from './echarts-loader.js';

// Theme owner notifies; game view rethemes its kline chart only.
onThemeChange((theme) => {
    applyChartTheme(chartRefs.klineChart, theme);
});


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


export async function startGame(options = {}) {
    // Use-case owns reset + seed (puzzle / window DTO / pack / local); view owns chrome.
    prepareSessionSeed({
        cloud: options.cloud || null,
        catalog: getStocksCatalog(),
        practiceOnly: !!options.practiceOnly,
        fillMode: readFillModeFromUi(),
    });

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

    if (!(await initChart())) {
        document.getElementById('gameScreen').classList.remove('active');
        setHeaderChrome('hidden');
        if (typeof window.restoreSimShell === 'function') {
            window.restoreSimShell();
        } else {
            document.getElementById('startScreen').style.display = 'flex';
        }
        return;
    }

    const seeded = getSession();
    if (
        seeded.cloudMode &&
        seeded.protocolVersion === 'event-v1' &&
        seeded.cloudGameId &&
        !isPuzzleSession(seeded)
    ) {
        // Authoritative resume: never trust draft alone for revision/day (avoids stuck mismatch).
        const ok = await resyncCloudGameFromServer();
        if (!ok && resumeActions && resumeActions.length) {
            applyCloudResume(resumeActions);
        } else if (!ok) {
            persistCurrentCloudDraft();
        }
    } else if (resumeActions && resumeActions.length) {
        applyCloudResume(resumeActions);
    } else if (seeded.cloudMode) {
        persistCurrentCloudDraft();
    }
}

/**
 * Replay saved mid-game actions onto the current cloud seed (day / holdings / MTM).
 * Invalid drafts are ignored so the player still enters day 1 of the same seed.
 */
export function applyCloudResume(actions) {
    const bars = getGameBars();
    const result = resumeLocalActions(actions, { bars });
    if (!result.ok) {
        if (result.engine) {
            console.warn(
                isPuzzleSession() ? 'puzzle resume draft invalid, starting day 1' : 'cloud resume draft invalid, starting day 1',
                result.engine
            );
        }
        if (!result.empty && !result.silent) {
            updateUI();
            resetOHLCToToday();
            renderWaveAnalysis();
        }
        return false;
    }
    updateUI();
    updateChart();
    resetOHLCToToday();
    renderWaveAnalysis();
    persistCurrentCloudDraft();
    return true;
}

/** Pull GET /games/:id/state and apply; one recovery path for revision mismatch / failed local apply. */
export async function resyncCloudGameFromServer() {
    const session = getSession();
    const gameId = session.cloudGameId;
    if (!gameId) return false;
    try {
        const state = await fetchGameState(gameId);
        const bars = getGameBars();
        const result = applyServerDecisionState(state, { bars });
        if (!result.ok) return false;
        persistCurrentCloudDraft();
        updateUI();
        updateChart();
        resetOHLCToToday();
        renderWaveAnalysis();
        return true;
    } catch (err) {
        console.warn('cloud state resync failed', err);
        return false;
    }
}

export async function initChart() {
    const chartDom = document.getElementById('kline-chart');
    if (!chartDom) {
        console.error('K-line chart DOM missing');
        return false;
    }

    // Shell already painted; show fallback while CDN/async ECharts resolves.
    markChartLoading(chartDom);
    let echartsApi;
    try {
        echartsApi = await ensureEcharts();
    } catch (err) {
        console.error('ECharts unavailable; cannot init K-line chart', err);
        markChartFailed(chartDom, 'K 线图加载失败，请检查网络后刷新');
        return false;
    }
    clearChartLoading(chartDom);

    if (chartRefs.klineChart) {
        chartRefs.klineChart.dispose();
    }
    chartRefs.klineChart = echartsApi.init(chartDom);

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
    // Defer first heavy setOption one frame so enter-game chrome stays responsive.
    requestAnimationFrame(function () {
        if (!chartRefs.klineChart) return;
        updateChart();
        setTimeout(function () {
            if (chartRefs.klineChart) chartRefs.klineChart.resize();
        }, 50);
    });
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
    applyChartTheme(chartRefs.klineChart, getTheme());
}

export function getGameBars() {
    return selectGameWindow();
}


function playerReturnPpmForHud(session) {
    if (Number.isFinite(session.totalReturn)) {
        return Math.round((session.totalReturn - 1) * 1e6);
    }
    return null;
}

/** After a committed player decision: flash same-day ghost action (player first → ghost). */
function flashGhostDayReveal() {
    const session = getSession();
    if (session.gameKind !== 'ghost') return;
    syncGhostHud(session, {
        playerReturnPpm: playerReturnPpmForHud(session),
        flashReveal: true,
    });
}

function applyLocalAction(action) {
    const bars = getGameBars();
    const result = applyLocalDecision(action, { bars });
    if (!result.ok) {
        if (result.errorZh) showToast(result.errorZh, 'error');
        return false;
    }
    persistCurrentCloudDraft();
    updateUI();
    updateChart();
    renderWaveAnalysis();
    flashGhostDayReveal();
    return true;
}

const FF_ARM_MS = 380;
const FF_STEP_MS = 200;
let ffActive = false;
let ffLoopRunning = false;
let ffPointerId = null;
let ffArmTimer = null;
let ffSuppressClick = false;

function prefersTapFastForward() {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    return coarse || narrow;
}

function fastForwardHintText(tap, active) {
    if (active) {
        return tap ? '快进中 · 再点「快进」停下' : '快进中 · 松开「观望」即停';
    }
    if (tap) {
        return '长按「观望」可快进。手机点「快进」，再点一次停下';
    }
    return '长按「观望」连续快进，松开即停';
}

function syncFastForwardChrome() {
    const session = getSession();
    const settle = session.currentDay >= sessionGameDays(session);
    const tap = prefersTapFastForward();
    const hint = document.getElementById('fastForwardHint');
    const btn = document.getElementById('fastForwardBtn');
    const holdBtn = document.getElementById('holdBtn');
    const screen = document.getElementById('gameScreen');
    if (screen) screen.classList.toggle('game-screen--ff-tap', tap && !settle);
    if (btn) {
        btn.hidden = !tap || settle;
        btn.disabled = settle || (!ffActive && !!(session.rewindBusy || session.decisionBusy));
        btn.classList.toggle('is-fast-forwarding', ffActive);
        btn.setAttribute('aria-pressed', ffActive ? 'true' : 'false');
        btn.textContent = ffActive ? '停止' : '快进';
    }
    if (holdBtn) holdBtn.classList.toggle('is-fast-forwarding', ffActive && !holdBtn.hidden);
    if (hint) {
        hint.hidden = settle;
        hint.textContent = fastForwardHintText(tap, ffActive);
    }
    if (ffActive && holdBtn) holdBtn.disabled = false;
}

function stopFastForward() {
    ffActive = false;
    syncFastForwardChrome();
}

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFastForwardLoop() {
    if (ffLoopRunning) return;
    ffLoopRunning = true;
    try {
        while (ffActive) {
            const session = getSession();
            const screen = document.getElementById('gameScreen');
            if (!screen || !screen.classList.contains('active')) break;
            if (session.currentDay >= sessionGameDays(session)) break;
            if (session.rewindBusy) break;
            if (session.decisionBusy) {
                await sleepMs(40);
                continue;
            }
            const holdBtn = document.getElementById('holdBtn');
            if (!holdBtn || holdBtn.hidden) break;
            const before = session.actions.length;
            await handleAction('hold');
            if (!ffActive) break;
            if (getSession().actions.length <= before) {
                ffActive = false;
                break;
            }
            await sleepMs(FF_STEP_MS);
        }
    } finally {
        ffLoopRunning = false;
        const session = getSession();
        const screen = document.getElementById('gameScreen');
        if (session.currentDay >= sessionGameDays(session) || !screen || !screen.classList.contains('active')) {
            ffActive = false;
        }
        syncFastForwardChrome();
    }
}

function startFastForward(fromHoldPress) {
    if (ffActive) return;
    const session = getSession();
    if (session.currentDay >= sessionGameDays(session)) return;
    const holdBtn = document.getElementById('holdBtn');
    if (!holdBtn || holdBtn.hidden || (holdBtn.disabled && !fromHoldPress)) return;
    ffActive = true;
    if (fromHoldPress) ffSuppressClick = true;
    syncFastForwardChrome();
    void runFastForwardLoop();
}

function clearFastForwardArm() {
    if (ffArmTimer != null) {
        clearTimeout(ffArmTimer);
        ffArmTimer = null;
    }
}

function bindFastForwardControls() {
    const holdBtn = document.getElementById('holdBtn');
    const ffBtn = document.getElementById('fastForwardBtn');
    if (!holdBtn || holdBtn.dataset.ffBound === '1') return;
    holdBtn.dataset.ffBound = '1';

    holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    holdBtn.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (holdBtn.disabled || holdBtn.hidden || ffActive) return;
        ffPointerId = e.pointerId;
        try { holdBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        clearFastForwardArm();
        ffArmTimer = setTimeout(() => startFastForward(true), FF_ARM_MS);
    });
    const endHoldPointer = (e, cancelled) => {
        if (ffPointerId == null || e.pointerId !== ffPointerId) return;
        if (cancelled && ffActive && getSession().decisionBusy) return;
        clearFastForwardArm();
        if (ffActive) stopFastForward();
        ffPointerId = null;
    };
    holdBtn.addEventListener('pointerup', (e) => endHoldPointer(e, false));
    holdBtn.addEventListener('pointercancel', (e) => endHoldPointer(e, true));
    document.addEventListener('pointerup', (e) => endHoldPointer(e, false));
    holdBtn.addEventListener('click', (e) => {
        if (ffSuppressClick) {
            ffSuppressClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (ffActive) return;
        void handleAction('hold');
    });

    if (ffBtn) {
        ffBtn.addEventListener('contextmenu', (e) => e.preventDefault());
        ffBtn.addEventListener('click', () => {
            if (ffActive) stopFastForward();
            else startFastForward();
        });
    }
    ['buyBtn', 'sellBtn', 'finishBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('pointerdown', () => {
            if (ffActive) stopFastForward();
        });
    });

    const refresh = () => syncFastForwardChrome();
    window.matchMedia('(pointer: coarse)').addEventListener('change', refresh);
    window.matchMedia('(max-width: 900px)').addEventListener('change', refresh);
    syncFastForwardChrome();
}

export async function handleAction(action) {
    const session = getSession();
    const guard = validatePlayAction(session, action);
    if (!guard.ok) {
        // Silent for busy / end-of-window / bad enum (historical handleAction early-return).
        if (
            guard.errorZh === '忙碌中' ||
            guard.errorZh === '已到结算日' ||
            guard.errorZh === '非法操作' ||
            guard.errorZh === '无对局'
        ) {
            return;
        }
        showToast(guard.errorZh, 'error');
        return;
    }

    const bars = getGameBars();
    if (bars.length < sessionGameDays(session)) return;

    if (session.cloudMode && session.protocolVersion === 'event-v1' && !isPuzzleSession(session)) {
        patchSession({ decisionBusy: true });
        setActionControlsLocked(true);
        try {
            const result = await syncEventV1Decision(action, {
                expectedRevision: session.revision ?? 0,
                bars,
                appendDecision: appendCloudDecision,
                fetchState: fetchGameState,
            });
            if (result.ok) {
                if (result.survivalSettled || result.state?.busted || result.state?.status === 'settled') {
                    stopFastForward();
                    clearCloudGameDraftSafe();
                    updateUI();
                    updateChart();
                    flashGhostDayReveal();
                    if (result.state?.busted) {
                        showToast('触及爆仓线，本局结束', 'error');
                    }
                    endGame();
                    return;
                }
                persistCurrentCloudDraft();
                updateUI();
                updateChart();
                renderWaveAnalysis();
                flashGhostDayReveal();
                if (result.recovered) {
                    showToast('状态已重新同步', 'success');
                }
                return;
            }
            if (result.recovered) {
                // Conflict: resynced day + chart once — do not spam the raw mismatch toast.
                persistCurrentCloudDraft();
                updateUI();
                updateChart();
                renderWaveAnalysis();
                showToast('状态已重新同步，请再试', 'success');
                return;
            }
            showToast(result.error?.message || '决策同步失败', 'error');
        } catch (e) {
            showToast(e.message || '决策同步失败', 'error');
        } finally {
            patchSession({ decisionBusy: false });
            setActionControlsLocked(false);
            updateUI();
        }
        return;
    }

    applyLocalAction(action);
}

function setActionControlsLocked(locked) {
    ['buyBtn', 'sellBtn', 'holdBtn', 'finishBtn', 'rewindBtn', 'fastForwardBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (ffActive && (id === 'holdBtn' || id === 'fastForwardBtn')) {
            el.disabled = false;
            return;
        }
        el.disabled = !!locked || (id === 'rewindBtn' && !el.dataset.eligible);
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
    const feats = await ensureRewindFeatures();
    if (!evaluateRewindEligibility(session, feats).eligible) return;

    const auth = getAuthState();
    const preview = buildRewindPreview(session, {
        balance: Number(auth.user?.jiuCoinBalance ?? 0),
        cost: 50,
    });
    const { cost, balance: bal, after, targetDay, canAfford } = preview;

    ensureRewindModal();
    const body = document.getElementById('rewindConfirmBody');
    if (body) {
        body.innerHTML =
            `<p>消耗 ${amountWithCoinHtml(cost, { size: 14 })}，回到上一决策日。本局将记为反悔结果，每局限一次。</p>` +
            `<p class="rewind-balance">当前余额 ${amountWithCoinHtml(bal, { size: 14 })} → 扣费后 ${amountWithCoinHtml(Math.max(after, 0), { size: 14 })}</p>` +
            `<p class="rewind-target">目标决策日：第 ${targetDay} 日</p>` +
            (!canAfford ? `<p class="rewind-warn">韭币不足，无法反悔</p>` : '');
    }
    const confirmBtn = document.getElementById('rewindConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = !canAfford;
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
        const applied = applyRewindServerResult(data, { bars: getGameBars() });
        if (!applied.ok) {
            showToast('反悔状态同步失败', 'error');
            return;
        }
        persistCurrentCloudDraft();
        updateUI();
        updateChart();
        renderWaveAnalysis();
        if (applied.balanceAfter != null) {
            const auth = getAuthState();
            if (auth.user) auth.user.jiuCoinBalance = applied.balanceAfter;
        }
        await refreshJiuCoinStatus().catch(() => {});
        await refreshMe().catch(() => {});
        showToast('已回到上一决策日（本局记为反悔）', 'success');
        closeRewindConfirm();
        rewindIdempotencyKey = null;
    } catch (e) {
        if (e.code === 'REVISION_CONFLICT') {
            const ok = await resyncCloudGameFromServer();
            showToast(ok ? '状态已重新同步，请再试' : (e.message || '反悔失败'), ok ? 'success' : 'error');
            rewindIdempotencyKey = null;
        } else {
            showToast(e.message || '反悔失败', 'error');
            if (e.code === 'INSUFFICIENT_FUNDS' || e.status === 402) {
                rewindIdempotencyKey = null;
            }
            // keep key on timeout/5xx for retry same result
            if (e.status && e.status < 500 && e.status !== 429) {
                rewindIdempotencyKey = null;
            }
        }
    } finally {
        patchSession({ rewindBusy: false });
        setActionControlsLocked(false);
        updateUI();
    }
}

/** Last day only: settle with valuation (not a fake sell). */
export function finishSettle() {
    stopFastForward();
    const bars = getGameBars();
    const result = settleLocalSession({ bars });
    if (!result.ok) {
        if (result.silent) return;
        if (result.errorZh) showToast(result.errorZh, 'error');
        if (result.engine) {
            console.error(
                isPuzzleSession() ? 'puzzle settle failed' : 'settle failed',
                result.engine
            );
        }
        return;
    }
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

    // Day counter, mode chrome & mood (残局 vs 模拟盘)
    const oneshotAmmo = session.gameKind === 'oneshot'
        ? oneshotAmmoFromActions(session.actions, session.modifiers)
        : null;
    const survivalFloat = session.gameKind === 'survival'
        ? survivalFloatHud(
            session.returnPpm != null
              ? session.returnPpm
              : Math.round((session.totalReturn - 1) * 1e6),
            session.modifiers
          )
        : null;
    const ghostName =
        session.gameKind === 'ghost' && session.modifiers?.ghost?.nickname
          ? session.modifiers.ghost.nickname
          : null;
    const hud = formatPlayHudChrome({
        gameKind: session.gameKind,
        title: session.puzzleTitle,
        theme: session.puzzleTheme,
        currentDay: session.currentDay,
        gameDays,
        ammo: oneshotAmmo,
        survivalFloat,
        ghostName,
    });
    const gameScreenEl = document.getElementById('gameScreen');
    if (gameScreenEl) {
        gameScreenEl.classList.toggle('game-screen--puzzle', hud.isPuzzle);
        gameScreenEl.classList.toggle('game-screen--oneshot', !!hud.isOneshot);
        gameScreenEl.classList.toggle('game-screen--survival', !!hud.isSurvival);
        gameScreenEl.classList.toggle(
          'game-screen--classic',
          !hud.isPuzzle && !hud.isOneshot && !hud.isSurvival && !hud.isGhost
        );
    }
    const progressShell = document.getElementById('gameProgressShell');
    if (progressShell) {
        progressShell.classList.toggle('game-progress-shell--puzzle', hud.isPuzzle);
        progressShell.classList.toggle('game-progress-shell--oneshot', !!hud.isOneshot);
        progressShell.classList.toggle('game-progress-shell--survival', !!hud.isSurvival);
    }
    const navMeter = document.getElementById('survivalNavMeter');
    if (navMeter) {
        if (survivalFloat) {
            navMeter.hidden = false;
            navMeter.classList.toggle('is-warn', !!survivalFloat.warn && survivalFloat.navPpm > survivalFloat.bustNavPpm);
            navMeter.classList.toggle('is-bust', survivalFloat.navPpm <= survivalFloat.bustNavPpm);
            const lab = document.getElementById('survivalNavLabel');
            if (lab) lab.textContent = survivalFloat.label;
            const fill = document.getElementById('survivalNavFill');
            if (fill) fill.style.width = `${Math.round(survivalFloat.progress01 * 100)}%`;
        } else {
            navMeter.hidden = true;
        }
    }
    const badgeEl = document.getElementById('gameModeBadge');
    if (badgeEl) {
        badgeEl.textContent = hud.badge;
        badgeEl.dataset.kind = hud.kind || (hud.isPuzzle ? 'puzzle' : 'classic');
    }
    const modeSubEl = document.getElementById('gameModeSubtitle');
    if (modeSubEl) {
        if (hud.subtitle) {
            modeSubEl.hidden = false;
            modeSubEl.textContent = hud.subtitle;
        } else {
            modeSubEl.hidden = true;
            modeSubEl.textContent = '';
        }
    }
    const dayLeadEl = document.getElementById('gameDayLabelLead');
    if (dayLeadEl) dayLeadEl.textContent = hud.dayLead;
    document.getElementById('currentDay').textContent = session.currentDay;
    const totalDaysEl = document.getElementById('gameDaysTotal');
    if (totalDaysEl) totalDaysEl.textContent = String(gameDays);
    const dayUnitEl = document.getElementById('gameDayLabelUnit');
    if (dayUnitEl) dayUnitEl.textContent = hud.dayUnit;
    const remainEl = document.getElementById('gameProgressRemain');
    if (remainEl) {
        if (hud.isPuzzle && hud.remainLabel) {
            remainEl.hidden = false;
            remainEl.textContent = hud.remainLabel;
        } else {
            remainEl.hidden = true;
            remainEl.textContent = '';
        }
    }
    const moodEl = document.getElementById('progressMood');
    if (moodEl) {
        if (hud.mood) {
            moodEl.textContent = hud.mood;
        } else {
            const moodIdx = Math.min(Math.floor((session.currentDay - 1) / 3), MOODS.length - 1);
            moodEl.textContent = MOODS[moodIdx];
        }
    }
    const boardKicker = document.getElementById('boardKicker');
    if (boardKicker) boardKicker.textContent = hud.boardKicker;
    const stageKicker = document.getElementById('stageKicker');
    if (stageKicker) stageKicker.textContent = hud.stageKicker;
    const stageTitle = document.getElementById('stageTitle');
    if (stageTitle) stageTitle.textContent = hud.stageTitle;

    // Ghost duel: persistent name + avatar chip; last same-day reveal from decision depth
    syncGhostHud(session, {
        playerReturnPpm: playerReturnPpmForHud(session),
    });
    if (gameScreenEl) {
        gameScreenEl.classList.toggle('game-screen--ghost', !!hud.isGhost);
    }
    if (progressShell) {
        progressShell.classList.toggle('game-progress-shell--ghost', !!hud.isGhost);
    }

    const tipEl = document.getElementById('puzzlePlayTip');
    if (tipEl) {
        if (hud.isPuzzle) {
            const tip = formatPuzzlePlayTip({
                goals: session.puzzleGoals,
                openStateHint: session.puzzleOpenStateHint,
                maxOrders: session.maxOrders,
            });
            if (tip) {
                tipEl.hidden = false;
                tipEl.textContent = tip;
            } else {
                tipEl.hidden = true;
                tipEl.textContent = '';
            }
        } else {
            tipEl.hidden = true;
            tipEl.textContent = '';
        }
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
    const priceEl = document.getElementById('currentPrice');
    if (priceEl) {
        priceEl.textContent = todayData ? todayData.close.toFixed(2) : '--';
    }

    const prevIdx = histLen + session.currentDay - 2;
    const prevData = prevIdx >= 0 ? session.gameKline[prevIdx] : null;
    let dailyPct = null;
    if (todayData && prevData && prevData.close > 0) {
        dailyPct = (todayData.close / prevData.close - 1) * 100;
    } else if (todayData && todayData.open > 0) {
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
    const busy = !!(session.rewindBusy || session.decisionBusy);

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
            const oneshotBuyBlocked = session.gameKind === 'oneshot' && oneshotAmmo && oneshotAmmo.buysLeft <= 0;
            buyBtn.disabled = busy || session.position !== 'empty' || oneshotBuyBlocked;
        }
        if (sellBtn) {
            sellBtn.hidden = false;
            // Mirror engine / puzzle T+1 via canSellOnCurrentDay (classic may show locked after buy).
            const sellBlocked = !canSellOnCurrentDay(session);
            const oneshotSellBlocked = session.gameKind === 'oneshot' && oneshotAmmo && oneshotAmmo.sellsLeft <= 0;
            sellBtn.disabled = busy || sellBlocked || oneshotSellBlocked;
        }
        if (holdBtn) {
            holdBtn.hidden = false;
            holdBtn.disabled = busy && !ffActive;
        }
        if (finishBtn) {
            finishBtn.hidden = true;
            finishBtn.disabled = true;
        }
    }

    // F03 rewind: eligibility from use-case; button chrome stays in view.
    void (async () => {
        const feats = await ensureRewindFeatures();
        const eligible = evaluateRewindEligibility(session, feats).eligible;
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
        const puzzle = isPuzzleSession(session);
        if (settleDay) {
            if (session.position === 'empty') {
                hintEl.textContent = puzzle
                    ? `残局末日 · 空仓可直接结束并结算`
                    : `第 ${gameDays} 日 · 空仓可直接结束并结算`;
                hintEl.className = 'action-hint';
            } else {
                hintEl.textContent = puzzle
                    ? `残局末日 · 未平仓将按今日收盘估值（不计卖出成交）`
                    : `第 ${gameDays} 日 · 未平仓将按今日收盘做期末估值（不计卖出成交）`;
                hintEl.className = 'action-hint warning';
            }
        } else if (session.position === 'locked') {
            const sellOk = canSellOnCurrentDay(session);
            if (puzzle || !sellOk) {
                const n = session.firstSellableDay || 1;
                hintEl.textContent = puzzle
                    ? `T+1 锁定 · 今日不可卖，第 ${n} 天起可卖`
                    : 'T+1 锁定中，今日不可卖出';
            } else if (sameClose) {
                hintEl.textContent = 'T+1 锁定中，今日可卖出（按今日收盘价成交）';
            } else {
                hintEl.textContent = 'T+1 锁定中，今日可挂卖单（按次日开盘成交）';
            }
            hintEl.className = 'action-hint warning';
        } else if (session.position === 'empty') {
            hintEl.textContent = sameClose
                ? '当前空仓 · 买入将按今日收盘价成交'
                : (puzzle
                    ? '残局空仓 · 买入或观望（对照星级目标）'
                    : '当前空仓，可以选择买入或继续观望');
            hintEl.className = 'action-hint';
        } else {
            hintEl.textContent = sameClose
                ? '当前持仓 · 卖出将按今日收盘价成交'
                : (puzzle
                    ? '残局持仓 · 卖出或继续持有（对照星级目标）'
                    : '当前持仓，可以选择卖出或继续持有');
            hintEl.className = 'action-hint';
        }
    }

    syncFastForwardChrome();
    updateTradeLog();
}


function escapeLogHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

    // Ghost duel: revealed same-day actions (after player lock-in; hold → 观望)
    let ghostRevealCount = 0;
    if (session.gameKind === 'ghost') {
        const identity = ghostIdentityFromModifiers(session.modifiers);
        const payload = session.modifiers?.ghost || null;
        const decisionCount = Array.isArray(session.actions) ? session.actions.length : 0;
        const revealed = ghostRevealedActions(payload, decisionCount);
        ghostRevealCount = revealed.length;
        if (identity && revealed.length) {
            const src = ghostAvatarSrc(identity);
            const preset = `images/avatars/${String(identity.avatarId || 1).padStart(2, '0')}.png`;
            const name = escapeLogHtml(identity.nickname || '幽灵选手');
            for (const g of revealed) {
                rows.push({
                    day: g.day,
                    cls: `ghost ghost--${g.action}`,
                    message:
                        `<span class="log-ghost-who">` +
                        `<img class="log-ghost-avatar" src="${escapeLogHtml(src)}" alt="" width="18" height="18" ` +
                        `loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${escapeLogHtml(preset)}'">` +
                        `<span class="log-ghost-tag">幽灵</span>` +
                        `<strong>${name}</strong>` +
                        `</span>` +
                        `${escapeLogHtml(g.labelZh)}`,
                });
            }
        }
    }

    if (rows.length === 0) {
        listEl.innerHTML = '<div class="log-item empty">暂无交易记录</div>';
        if (countEl) countEl.textContent = '暂无记录';
        return;
    }

    if (countEl) {
        const tradeN = session.tradeHistory.length;
        if (ghostRevealCount > 0 && tradeN > 0) {
            countEl.textContent = `${tradeN} 笔 · 幽灵 ${ghostRevealCount} 步`;
        } else if (ghostRevealCount > 0) {
            countEl.textContent = `幽灵 ${ghostRevealCount} 步`;
        } else {
            countEl.textContent = `${tradeN} 笔成交`;
        }
    }

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

bindFastForwardControls();
