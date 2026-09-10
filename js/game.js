// ========== GAME FUNCTIONS ==========
import { gameState, chartRefs } from './state.js';
import { resetSession, applyEngineResult, patchSession } from './game-session.js';
import { applyChartTheme } from './utils.js';
import { buildKlineOption } from './kline-option.js';
import { endGame } from './result.js';
import { replayGame, settleGame } from '../shared/engine.js';
import { persistCurrentCloudDraft, clearCloudGameDraft } from './game-sync.js';
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

export async function startGame(options = {}) {
    // Reset session fields through the game-session seam (preserves stocksData).
    resetSession({
        practiceOnly: !!options.practiceOnly,
        fillMode: readFillModeFromUi(),
    });

    const cloud = options.cloud || null;
    const gameDays = 30;

    if (cloud && Number.isInteger(cloud.stockIndex) && gameState.stocksData[cloud.stockIndex]) {
        const currentStock = gameState.stocksData[cloud.stockIndex];
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
            ruleVersion: cloud.ruleVersion || gameState.ruleVersion,
            fillMode: cloud.fillMode || gameState.fillMode,
            currentStock,
            historyLength: historyDays,
            gameKline: currentStock.kline.slice(
                gameStartIndex - historyDays,
                gameStartIndex + gameDays
            ),
        });
    } else {
        // Local practice: pick random stock and window (30 game days).
        const stockIndex = Math.floor(Math.random() * gameState.stocksData.length);
        const currentStock = gameState.stocksData[stockIndex];
        const klineLen = currentStock.kline.length;
        const historyDays = Math.min(30, klineLen - gameDays);
        const minStart = historyDays;
        const maxStart = klineLen - gameDays; // inclusive
        const span = Math.max(1, maxStart - minStart + 1);
        const gameStartIndex = minStart + Math.floor(Math.random() * span);
        patchSession({
            currentStock,
            historyLength: historyDays,
            gameKline: currentStock.kline.slice(
                gameStartIndex - historyDays,
                gameStartIndex + gameDays
            ),
            practiceOnly: true,
        });
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
    } else if (gameState.cloudMode) {
        persistCurrentCloudDraft();
    }
}

/**
 * Replay saved mid-game actions onto the current cloud seed (day / holdings / MTM).
 * Invalid drafts are ignored so the player still enters day 1 of the same seed.
 */
export function applyCloudResume(actions) {
    if (!Array.isArray(actions) || !actions.length) return false;
    const bars = getGameBars();
    if (bars.length < 30) return false;
    const clipped = actions.slice(0, 29);
    const r = replayGame({
        fillMode: gameState.fillMode,
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
    patchSession({ currentDay: Math.min(clipped.length + 1, 30) });
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
        const histLen = gameState.historyLength;
        const visibleData = gameState.gameKline.slice(0, histLen + gameState.currentDay);
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
    const histLen = gameState.historyLength;
    const todayData = gameState.gameKline[histLen + gameState.currentDay - 1];
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
    const histLen = gameState.historyLength;
    const visibleData = gameState.gameKline.slice(0, histLen + gameState.currentDay);

    const maSelected = {
        '5日线': maChecked('indicatorMA5'),
        '10日线': maChecked('indicatorMA10'),
        '20日线': maChecked('indicatorMA20'),
        '30日线': maChecked('indicatorMA30'),
    };

    const option = buildKlineOption({
        bars: visibleData,
        historyLength: histLen,
        trades: gameState.tradeHistory,
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
    const histLen = gameState.historyLength;
    return gameState.gameKline.slice(histLen, histLen + 30);
}

function syncFromEngine(r, { finished = false, bars = null } = {}) {
    applyEngineResult(r, { finished, bars });
}

export function handleAction(action) {
    if (gameState.currentDay >= 30) return;
    if (action !== 'buy' && action !== 'sell' && action !== 'hold') return;

    const bars = getGameBars();
    if (bars.length < 30) return;

    const nextActions = gameState.actions.concat(action);
    const r = replayGame({
        fillMode: gameState.fillMode,
        bars,
        actions: nextActions,
        finish: false
    });
    if (!r.ok) return;

    patchSession({ actions: nextActions, pendingAction: null });
    syncFromEngine(r, { finished: false, bars });
    patchSession({ currentDay: nextActions.length + 1 });
    persistCurrentCloudDraft();

    updateUI();
    updateChart();
    renderWaveAnalysis();
}

/** Day-30 only: settle with valuation (not a fake sell). */
export function finishSettle() {
    if (gameState.currentDay < 30 || gameState.actions.length !== 29) return;
    const bars = getGameBars();
    const r = settleGame({
        fillMode: gameState.fillMode,
        bars,
        actions: gameState.actions
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
    const action = gameState.pendingAction || 'hold';
    handleAction(action);
}

export function addTradeHistory(type, day, price, returnVal = null) {
    gameState.tradeHistory.push({ type, day, price, return: returnVal });
}

export function updateUI() {
    const histLen = gameState.historyLength;
    const todayData = gameState.gameKline[histLen + gameState.currentDay - 1];

    // Progress bar
    const pct = ((gameState.currentDay - 1) / 30 * 100).toFixed(1);
    const fillEl = document.getElementById('dayProgressFill');
    if (fillEl) fillEl.style.width = pct + '%';

    // Day counter & mood
    document.getElementById('currentDay').textContent = gameState.currentDay;
    const moodEl = document.getElementById('progressMood');
    if (moodEl) {
        const moodIdx = Math.min(Math.floor((gameState.currentDay - 1) / 3), MOODS.length - 1);
        moodEl.textContent = MOODS[moodIdx];
    }

    // Chart subtitle — mask identity until endGame
    const subtitle = document.getElementById('chartSubtitle');
    if (subtitle) subtitle.textContent = '股票代码: ******';
    const subtitleInner = document.getElementById('chartSubtitleInner');
    if (subtitleInner) subtitleInner.textContent = '身份隐藏中';

    // ── Return ratio (judging standard). Engine still uses starting cash internally. ──
    const displayReturn = (gameState.totalReturn - 1) * 100;

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
        fundsEl.textContent = gameState.position === 'empty' ? '可买入' : '已全仓';
    }

    // Position status chip
    const posEl = document.getElementById('positionStatus');
    if (posEl) {
        if (gameState.position === 'empty') {
            posEl.textContent = '空仓';
            posEl.className = 'board-chip neutral';
        } else if (gameState.position === 'locked') {
            posEl.textContent = 'T+1 锁定';
            posEl.className = 'board-chip locked';
        } else {
            posEl.textContent = '持仓中';
            posEl.className = 'board-chip positive';
        }
    }

    // Meta grid values
    document.getElementById('currentPrice').textContent = todayData.close.toFixed(2);

    const prevIdx = histLen + gameState.currentDay - 2;
    const prevData = prevIdx >= 0 ? gameState.gameKline[prevIdx] : null;
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
    if (costEl) costEl.textContent = gameState.costBasis > 0 ? gameState.costBasis.toFixed(2) : '--';

    document.getElementById('tradeCount').textContent = gameState.tradeHistory.length;

    // OHLC panel — show today by default
    resetOHLCToToday();

    // Day 30: only「结束并结算」— no buy/sell pretending to liquidate.
    const settleDay = gameState.currentDay >= 30;
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const holdBtn = document.getElementById('holdBtn');
    const finishBtn = document.getElementById('finishBtn');

    if (settleDay) {
        if (buyBtn) { buyBtn.disabled = true; buyBtn.hidden = true; }
        if (sellBtn) { sellBtn.disabled = true; sellBtn.hidden = true; }
        if (holdBtn) { holdBtn.disabled = true; holdBtn.hidden = true; }
        if (finishBtn) {
            finishBtn.hidden = false;
            finishBtn.disabled = false;
        }
    } else {
        if (buyBtn) {
            buyBtn.hidden = false;
            buyBtn.disabled = gameState.position !== 'empty';
        }
        if (sellBtn) {
            sellBtn.hidden = false;
            // locked: may queue sell for next open (T+1)
            sellBtn.disabled = gameState.position === 'empty';
        }
        if (holdBtn) {
            holdBtn.hidden = false;
            holdBtn.disabled = false;
        }
        if (finishBtn) {
            finishBtn.hidden = true;
            finishBtn.disabled = true;
        }
    }

    const hintEl = document.getElementById('actionHint');
    if (hintEl) {
        const sameClose = gameState.fillMode === 'same_close';
        if (settleDay) {
            if (gameState.position === 'empty') {
                hintEl.textContent = '第 30 日 · 空仓可直接结束并结算';
                hintEl.className = 'action-hint';
            } else {
                hintEl.textContent = '第 30 日 · 未平仓将按今日收盘做期末估值（不计卖出成交）';
                hintEl.className = 'action-hint warning';
            }
        } else if (gameState.position === 'locked') {
            hintEl.textContent = sameClose
                ? 'T+1 锁定中，今日可卖出（按今日收盘价成交）'
                : 'T+1 锁定中，今日可挂卖单（按次日开盘成交）';
            hintEl.className = 'action-hint warning';
        } else if (gameState.position === 'empty') {
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
    const listEl = document.getElementById('historyList');
    const countEl = document.getElementById('tradeLogCount');
    if (!listEl) return;

    const rows = gameState.tradeHistory.map((trade) => {
        const retStr = trade.return
            ? ` · 收益 <strong>${((trade.return - 1) * 100 >= 0 ? '+' : '') + ((trade.return - 1) * 100).toFixed(2)}%</strong>`
            : '';
        return {
            day: trade.day,
            cls: trade.type,
            message: `${trade.type === 'buy' ? '买入' : '卖出'} @ ${trade.price.toFixed(2)}${retStr}`
        };
    });
    if (gameState.valuation) {
        const v = gameState.valuation;
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

    if (countEl) countEl.textContent = `${gameState.tradeHistory.length} 笔成交`;

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
    if (gameState.currentDay < 5) return; // not enough data

    const histLen = gameState.historyLength;
    const endIdx = histLen + gameState.currentDay - 1;
    const lookback = Math.min(gameState.currentDay, 20);
    const data = gameState.gameKline.slice(endIdx - lookback + 1, endIdx + 1);

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
