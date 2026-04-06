// ========== GAME FUNCTIONS ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { endGame } from './result.js';

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

export function startGame() {
    // Reset state
    gameState.currentDay = 1;
    gameState.position = 'empty';
    gameState.costBasis = 0;
    gameState.totalReturn = 1;
    gameState.tradeHistory = [];
    gameState.pendingAction = null;
    gameState.holdingDays = 0;
    gameState.tradeGains = [];
    gameState.historyLength = 0;
    gameState.bsScore = null;
    gameState.bestPoints = null;

    // Pick random stock and random start position
    const stockIndex = Math.floor(Math.random() * gameState.stocksData.length);
    gameState.currentStock = gameState.stocksData[stockIndex];

    // 取最多30天历史 + 31天游戏数据
    const gameDays = 31;
    const klineLen = gameState.currentStock.kline.length;
    const historyDays = Math.min(30, klineLen - gameDays);
    const minStart = historyDays;
    const maxStart = klineLen - gameDays;
    const gameStartIndex = minStart + Math.floor(Math.random() * Math.max(1, maxStart - minStart));
    gameState.historyLength = historyDays;
    gameState.gameKline = gameState.currentStock.kline.slice(gameStartIndex - historyDays, gameStartIndex + gameDays);

    // Switch screens
    const hdr = document.querySelector('.header');
    hdr.style.display = 'block';
    hdr.classList.add('compact');
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameScreen').classList.add('active');
    document.getElementById('resultScreen').classList.remove('active');

    // Initialize chart
    initChart();
    updateUI();
    renderWaveAnalysis();
}

export function initChart() {
    const chartDom = document.getElementById('kline-chart');
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
        document.getElementById('hoverVolume').textContent = (d.volume / 10000).toFixed(0) + ' 万';
    });

    chartRefs.klineChart.on('mouseout', function() {
        resetOHLCToToday();
    });

    updateChart();
    // Resize after flex layout settles
    setTimeout(() => chartRefs.klineChart.resize(), 50);
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
    document.getElementById('hoverVolume').textContent = (todayData.volume / 10000).toFixed(0) + ' 万';
}

export function updateChart() {
    const histLen = gameState.historyLength;
    const visibleData = gameState.gameKline.slice(0, histLen + gameState.currentDay);

    const dates = visibleData.map(d => d.date);
    const ohlc = visibleData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = visibleData.map(d => d.volume);
    const volumeColors = visibleData.map(d => d.close >= d.open ? '#e05252' : '#3db86a');

    const ma5 = calculateMA(visibleData, 5);
    const ma10 = calculateMA(visibleData, 10);
    const ma20 = calculateMA(visibleData, 20);
    const ma30 = calculateMA(visibleData, 30);

    // Buy/sell markers on game chart
    const markPoints = gameState.tradeHistory.map(trade => ({
        coord: [histLen + trade.day - 1, trade.price],
        value: trade.type === 'buy' ? '买' : '卖',
        itemStyle: {
            color: trade.type === 'buy' ? '#e05252' : '#3db86a'
        }
    })).filter(p => p.coord[0] < visibleData.length);

    const option = {
        backgroundColor: 'transparent',
        animation: true,
        animationDuration: 300,
        legend: {
            data: ['MA5', 'MA10', 'MA20', 'MA30'],
            top: 5,
            left: 10,
            textStyle: { color: '#8b949e', fontFamily: 'JetBrains Mono', fontSize: 11 },
            itemWidth: 18,
            itemHeight: 2,
            itemGap: 12
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(13,17,23,0.97)',
            borderColor: 'rgba(88,166,255,0.2)',
            textStyle: { color: '#e6edf3', fontFamily: 'JetBrains Mono', fontSize: 12 },
            formatter: function(params) {
                const cs = params.find(p => p.seriesName === 'K线');
                if (!cs) return '';
                const d = cs.data;
                const vol = params.find(p => p.seriesName === '成交量');
                // sync OHLC panel
                const histLen2 = gameState.historyLength;
                const idx = cs.dataIndex;
                const kd = gameState.gameKline.slice(0, histLen2 + gameState.currentDay)[idx];
                if (kd) {
                    document.getElementById('hoverLabel').textContent = '悬停数据';
                    document.getElementById('hoverDate').textContent = kd.date;
                    document.getElementById('hoverOpen').textContent = kd.open.toFixed(2);
                    document.getElementById('hoverHigh').textContent = kd.high.toFixed(2);
                    document.getElementById('hoverLow').textContent = kd.low.toFixed(2);
                    document.getElementById('hoverClose').textContent = kd.close.toFixed(2);
                    document.getElementById('hoverVolume').textContent = (kd.volume / 10000).toFixed(0) + ' 万';
                }
                const isUp = d[1] >= d[0];
                const clr = isUp ? '#e05252' : '#3db86a';
                let html = `<div style="padding:4px 2px">
                    <div style="margin-bottom:5px;color:#8b949e;font-size:11px">${cs.axisValue}</div>
                    <div style="color:${clr}">开 ${d[0].toFixed(2)}&nbsp;&nbsp;收 ${d[1].toFixed(2)}</div>
                    <div>低 ${d[2].toFixed(2)}&nbsp;&nbsp;高 ${d[3].toFixed(2)}</div>`;
                if (vol) html += `<div style="color:#8b949e">量 ${(vol.data / 10000).toFixed(0)}万</div>`;
                const maMap = { MA5: '#f5c542', MA10: '#42a5f5', MA20: '#ab47bc', MA30: '#26a69a' };
                params.forEach(p => {
                    if (maMap[p.seriesName] && p.data != null)
                        html += `<div style="color:${maMap[p.seriesName]}">${p.seriesName}: ${p.data.toFixed(2)}</div>`;
                });
                html += '</div>';
                return html;
            }
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: [
            { left: '8%', right: '2%', top: '8%', bottom: '34%' },
            { left: '8%', right: '2%', top: '73%', bottom: '6%' }
        ],
        xAxis: [
            {
                type: 'category', data: dates, gridIndex: 0,
                axisLine: { lineStyle: { color: 'rgba(88,166,255,0.15)' } },
                axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
            },
            {
                type: 'category', data: dates, gridIndex: 1,
                axisLine: { lineStyle: { color: 'rgba(88,166,255,0.15)' } },
                axisLabel: { color: '#8b949e', fontFamily: 'JetBrains Mono', fontSize: 10, rotate: 30 },
                splitLine: { show: false }
            }
        ],
        yAxis: [
            {
                type: 'value', scale: true, gridIndex: 0,
                axisLabel: { color: '#8b949e', fontFamily: 'JetBrains Mono', fontSize: 10 },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: 'rgba(88,166,255,0.06)' } }
            },
            { type: 'value', scale: true, gridIndex: 1, show: false }
        ],
        series: [
            {
                name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: ohlc,
                itemStyle: { color: '#e05252', color0: '#3db86a', borderColor: '#e05252', borderColor0: '#3db86a' },
                markPoint: {
                    data: markPoints, symbol: 'pin', symbolSize: 35,
                    label: { formatter: '{b}', color: '#fff', fontWeight: 'bold', fontSize: 11 }
                }
            },
            {
                name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma5,
                smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#f5c542' }
            },
            {
                name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma10,
                smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#42a5f5' }
            },
            {
                name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma20,
                smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#ab47bc' }
            },
            {
                name: 'MA30', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma30,
                smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#26a69a' }
            },
            {
                name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
                itemStyle: { color: params => volumeColors[params.dataIndex] }
            }
        ]
    };

    chartRefs.klineChart.setOption(option);
    applyChartTheme(chartRefs.klineChart);
}

export function handleAction(action) {
    if (action === 'buy' && gameState.position !== 'empty') return;
    if (action === 'sell' && gameState.position !== 'holding') return;

    gameState.pendingAction = action;
    nextDay();
}

export function nextDay() {
    const action = gameState.pendingAction;
    const histLen = gameState.historyLength;
    const nextDayIndex = histLen + gameState.currentDay;
    const nextDayData = gameState.gameKline[nextDayIndex];

    // Execute pending action at next day's open price
    if (action === 'buy' && gameState.position === 'empty') {
        gameState.costBasis = nextDayData.open;
        gameState.position = 'locked'; // T+1: Can't sell today
        addTradeHistory('buy', gameState.currentDay + 1, nextDayData.open);
    } else if (action === 'sell' && gameState.position === 'holding') {
        const sellPrice = nextDayData.open;
        const tradeReturn = sellPrice / gameState.costBasis;
        gameState.totalReturn *= tradeReturn;
        gameState.tradeGains.push((tradeReturn - 1) * 100);
        addTradeHistory('sell', gameState.currentDay + 1, sellPrice, tradeReturn);
        gameState.position = 'empty';
        gameState.costBasis = 0;
    }

    // Update position status
    if (gameState.position === 'locked') {
        gameState.position = 'holding';
    }

    // Track holding days
    if (gameState.position === 'holding' || gameState.position === 'locked') {
        gameState.holdingDays++;
    }

    gameState.pendingAction = null;
    gameState.currentDay++;

    if (gameState.currentDay > 30) {
        endGame();
    } else {
        updateUI();
        updateChart();
        renderWaveAnalysis();
    }
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

    // Chart subtitle
    const subtitle = document.getElementById('chartSubtitle');
    if (subtitle) subtitle.textContent = `${gameState.currentStock.name} (${gameState.currentStock.code}) · 隐藏中`;
    const subtitleInner = document.getElementById('chartSubtitleInner');
    if (subtitleInner) subtitleInner.textContent = `${gameState.currentStock.name} (${gameState.currentStock.code}) · 隐藏中`;

    // ── Total return & unrealized PnL ──
    let displayReturn;
    if ((gameState.position === 'holding' || gameState.position === 'locked') && gameState.costBasis > 0) {
        const unrealizedReturn = todayData.close / gameState.costBasis;
        displayReturn = (gameState.totalReturn * unrealizedReturn - 1) * 100;
    } else {
        displayReturn = (gameState.totalReturn - 1) * 100;
    }

    // Total asset card (assumes 100,000 starting capital concept)
    const totalAssetEl = document.getElementById('totalAsset');
    const retMult = gameState.position !== 'empty' && gameState.costBasis > 0
        ? gameState.totalReturn * (todayData.close / gameState.costBasis)
        : gameState.totalReturn;
    const assetValue = 100000 * retMult;
    if (totalAssetEl) {
        totalAssetEl.textContent = '¥' + assetValue.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        // Pulse animation on change
        const card = document.getElementById('totalAssetCard');
        if (card) {
            card.classList.remove('asset-surge');
            void card.offsetWidth;
            card.classList.add('asset-surge');
        }
    }

    // Holding PnL card
    const pnlCard = document.getElementById('holdingPnlCard');
    const pnlEl = document.getElementById('holdingPnl');
    if (pnlEl && pnlCard) {
        if (gameState.position !== 'empty' && gameState.costBasis > 0) {
            const unrealPct = (todayData.close / gameState.costBasis - 1) * 100;
            pnlEl.textContent = (unrealPct >= 0 ? '+' : '') + unrealPct.toFixed(2) + '%';
            if (unrealPct > 0) {
                pnlEl.className = 'metric-value positive';
                pnlCard.className = 'metric-card pnl-card positive';
            } else if (unrealPct < 0) {
                pnlEl.className = 'metric-value negative';
                pnlCard.className = 'metric-card pnl-card negative';
            } else {
                pnlEl.className = 'metric-value neutral';
                pnlCard.className = 'metric-card pnl-card neutral';
            }
        } else {
            pnlEl.textContent = '--';
            pnlEl.className = 'metric-value neutral';
            pnlCard.className = 'metric-card pnl-card neutral';
        }
    }

    // Available funds (simplified: 100% when empty, 0% when holding)
    const fundsEl = document.getElementById('availableFunds');
    if (fundsEl) {
        if (gameState.position === 'empty') {
            fundsEl.textContent = '¥' + (100000 * gameState.totalReturn).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else {
            fundsEl.textContent = '¥0.00 (全仓)';
        }
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

    // Buttons
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const holdBtn = document.getElementById('holdBtn');
    if (buyBtn) buyBtn.disabled = gameState.position !== 'empty';
    if (sellBtn) sellBtn.disabled = gameState.position !== 'holding';
    if (holdBtn) holdBtn.disabled = false;

    const hintEl = document.getElementById('actionHint');
    if (hintEl) {
        if (gameState.position === 'locked') {
            hintEl.textContent = 'T+1 锁定中，今日只能持仓观望';
            hintEl.className = 'action-hint warning';
        } else if (gameState.position === 'empty') {
            hintEl.textContent = '当前空仓，可以选择买入或继续观望';
            hintEl.className = 'action-hint';
        } else {
            hintEl.textContent = '当前持仓，可以选择卖出或继续持有';
            hintEl.className = 'action-hint';
        }
    }

    // Trade log
    updateTradeLog();
}

export function updateTradeLog() {
    const listEl = document.getElementById('historyList');
    const countEl = document.getElementById('tradeLogCount');
    if (!listEl) return;

    if (gameState.tradeHistory.length === 0) {
        listEl.innerHTML = '<div class="log-item empty">暂无交易记录</div>';
        if (countEl) countEl.textContent = '暂无记录';
        return;
    }

    if (countEl) countEl.textContent = `${gameState.tradeHistory.length} 笔`;

    listEl.innerHTML = [...gameState.tradeHistory].reverse().map(trade => {
        const retStr = trade.return
            ? ` · 收益 <strong>${((trade.return - 1) * 100 >= 0 ? '+' : '') + ((trade.return - 1) * 100).toFixed(2)}%</strong>`
            : '';
        return `
            <div class="log-item ${trade.type}">
                <span class="log-day">D${trade.day}</span>
                <span class="log-message">${trade.type === 'buy' ? '买入' : '卖出'} @ ${trade.price.toFixed(2)}${retStr}</span>
            </div>
        `;
    }).join('');
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
