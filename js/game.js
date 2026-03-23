// ========== GAME FUNCTIONS ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { endGame } from './result.js';

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
    document.querySelector('.header').classList.add('compact');
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameScreen').classList.add('active');
    document.getElementById('resultScreen').classList.remove('active');

    // Initialize chart
    initChart();
    updateUI();
}

export function initChart() {
    const chartDom = document.getElementById('kline-chart');
    if (chartRefs.klineChart) {
        chartRefs.klineChart.dispose();
    }
    chartRefs.klineChart = echarts.init(chartDom);
    updateChart();
    // Resize after flex layout settles
    setTimeout(() => chartRefs.klineChart.resize(), 50);
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
        animationDuration: 500,
        legend: {
            data: ['MA5', 'MA10', 'MA20', 'MA30'],
            top: 5,
            left: 10,
            textStyle: { color: '#6b6660', fontFamily: 'JetBrains Mono', fontSize: 11 },
            itemWidth: 18,
            itemHeight: 2,
            itemGap: 12
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            },
            backgroundColor: 'rgba(22, 22, 29, 0.95)',
            borderColor: 'rgba(200, 164, 78, 0.2)',
            textStyle: {
                color: '#e8e4dd',
                fontFamily: 'JetBrains Mono'
            },
            formatter: function(params) {
                const candlestick = params.find(p => p.seriesName === 'K线');
                const volume = params.find(p => p.seriesName === '成交量');
                if (!candlestick) return '';
                const ohlc = candlestick.data;
                let html = `
                    <div style="padding: 5px;">
                        <div style="margin-bottom: 5px; color: #6b6660;">${candlestick.axisValue}</div>
                        <div>开: ${ohlc[0].toFixed(2)}</div>
                        <div>收: ${ohlc[1].toFixed(2)}</div>
                        <div>低: ${ohlc[2].toFixed(2)}</div>
                        <div>高: ${ohlc[3].toFixed(2)}</div>`;
                if (volume) {
                    html += `<div>量: ${(volume.data / 10000).toFixed(0)}万</div>`;
                }
                const maNames = ['MA5', 'MA10', 'MA20', 'MA30'];
                const maColors = ['#f5c542', '#42a5f5', '#ab47bc', '#26a69a'];
                params.forEach(p => {
                    const idx = maNames.indexOf(p.seriesName);
                    if (idx >= 0 && p.data != null) {
                        html += `<div style="color:${maColors[idx]}">${p.seriesName}: ${p.data.toFixed(2)}</div>`;
                    }
                });
                html += `</div>`;
                return html;
            }
        },
        axisPointer: {
            link: [{ xAxisIndex: 'all' }]
        },
        grid: [
            {
                left: '10%',
                right: '2%',
                top: '5%',
                bottom: '35%'
            },
            {
                left: '10%',
                right: '2%',
                top: '72%',
                bottom: '8%'
            }
        ],
        xAxis: [
            {
                type: 'category',
                data: dates,
                gridIndex: 0,
                axisLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.2)' } },
                axisLabel: { show: false },
                axisTick: { show: false },
                splitLine: { show: false }
            },
            {
                type: 'category',
                data: dates,
                gridIndex: 1,
                axisLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.2)' } },
                axisLabel: {
                    color: '#6b6660',
                    fontFamily: 'JetBrains Mono',
                    fontSize: 10,
                    rotate: 45
                },
                splitLine: { show: false }
            }
        ],
        yAxis: [
            {
                type: 'value',
                scale: true,
                gridIndex: 0,
                axisLabel: {
                    color: '#6b6660',
                    fontFamily: 'JetBrains Mono',
                    fontSize: 10
                },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.06)' } }
            },
            {
                type: 'value',
                scale: true,
                gridIndex: 1,
                show: false
            }
        ],
        series: [
            {
                name: 'K线',
                type: 'candlestick',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: ohlc,
                itemStyle: {
                    color: '#e05252',
                    color0: '#3db86a',
                    borderColor: '#e05252',
                    borderColor0: '#3db86a'
                },
                markPoint: {
                    data: markPoints,
                    symbol: 'pin',
                    symbolSize: 35,
                    label: {
                        formatter: '{b}',
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: 11
                    }
                }
            },
            {
                name: 'MA5',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: ma5,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1, color: '#f5c542' }
            },
            {
                name: 'MA10',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: ma10,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1, color: '#42a5f5' }
            },
            {
                name: 'MA20',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: ma20,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1, color: '#ab47bc' }
            },
            {
                name: 'MA30',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: ma30,
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 1, color: '#26a69a' }
            },
            {
                name: '成交量',
                type: 'bar',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: volumes,
                itemStyle: {
                    color: function(params) {
                        return volumeColors[params.dataIndex];
                    }
                }
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

    // Move to next day
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
    }
}

export function addTradeHistory(type, day, price, returnVal = null) {
    const record = {
        type,
        day,
        price,
        return: returnVal
    };
    gameState.tradeHistory.push(record);
}

export function updateUI() {
    const todayData = gameState.gameKline[gameState.historyLength + gameState.currentDay - 1];

    // Update day indicator and price (merged into first status item)
    document.getElementById('currentDay').textContent = gameState.currentDay;
    document.getElementById('currentPrice').textContent = todayData.close.toFixed(2);

    // Update position status
    const positionEl = document.getElementById('positionStatus');
    if (gameState.position === 'empty') {
        positionEl.textContent = '空仓';
        positionEl.className = 'status-value neutral';
    } else if (gameState.position === 'locked') {
        positionEl.textContent = '持仓 (锁定)';
        positionEl.className = 'status-value locked';
    } else {
        positionEl.textContent = '持仓中';
        positionEl.className = 'status-value gain';
    }

    // Update total return (include unrealized P&L when holding)
    const returnEl = document.getElementById('totalReturn');
    let displayReturn;
    if ((gameState.position === 'holding' || gameState.position === 'locked') && gameState.costBasis > 0) {
        const unrealizedReturn = todayData.close / gameState.costBasis;
        displayReturn = (gameState.totalReturn * unrealizedReturn - 1) * 100;
    } else {
        displayReturn = (gameState.totalReturn - 1) * 100;
    }
    returnEl.textContent = (displayReturn >= 0 ? '+' : '') + displayReturn.toFixed(2) + '%';
    returnEl.className = 'status-value ' + (displayReturn > 0 ? 'gain' : displayReturn < 0 ? 'loss' : 'neutral');

    // Update cost basis
    const costEl = document.getElementById('costBasis');
    costEl.textContent = gameState.costBasis > 0 ? gameState.costBasis.toFixed(2) : '--';

    // Update trade count
    document.getElementById('tradeCount').textContent = gameState.tradeHistory.length;

    // Update buttons
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const holdBtn = document.getElementById('holdBtn');
    const hintEl = document.getElementById('actionHint');

    buyBtn.disabled = gameState.position !== 'empty';
    sellBtn.disabled = gameState.position !== 'holding';
    holdBtn.disabled = false;

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

    // Update trade history
    updateTradeHistory();
}

export function updateTradeHistory() {
    const listEl = document.getElementById('historyList');
    if (gameState.tradeHistory.length === 0) {
        listEl.innerHTML = '<div class="history-item" style="color: var(--text-muted);">暂无交易记录</div>';
        return;
    }

    listEl.innerHTML = gameState.tradeHistory.map(trade => {
        const returnStr = trade.return ?
            ` (${((trade.return - 1) * 100).toFixed(2)}%)` : '';
        return `
            <div class="history-item">
                <span class="history-action ${trade.type}">${trade.type === 'buy' ? '买入' : '卖出'}</span>
                <span>第${trade.day}天 @ ${trade.price.toFixed(2)}${returnStr}</span>
            </div>
        `;
    }).join('');
}
