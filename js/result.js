// ========== RESULT SCREEN ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';

export function endGame() {
    // Calculate final return if still holding
    if (gameState.position === 'holding' || gameState.position === 'locked') {
        const histLen = gameState.historyLength;
        const finalPrice = gameState.gameKline[histLen + 30].open; // Day 31 open price
        const tradeReturn = finalPrice / gameState.costBasis;
        gameState.totalReturn *= tradeReturn;
        gameState.tradeGains.push((tradeReturn - 1) * 100);
        gameState.tradeHistory.push({ type: 'sell', day: 31, price: finalPrice, return: tradeReturn });
    }

    // Switch to result screen
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('resultScreen').classList.add('active');

    // Display results
    document.getElementById('stockReveal').textContent =
        `${gameState.currentStock.name} (${gameState.currentStock.code})`;

    document.getElementById('dateRange').textContent =
        `${gameState.gameKline[gameState.historyLength].date} ~ ${gameState.gameKline[gameState.historyLength + 29].date}`;

    const finalReturnPercent = (gameState.totalReturn - 1) * 100;
    const finalReturnEl = document.getElementById('finalReturn');
    finalReturnEl.textContent = (finalReturnPercent >= 0 ? '+' : '') + finalReturnPercent.toFixed(2) + '%';
    finalReturnEl.className = 'final-return ' +
        (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');

    document.getElementById('finalTradeCount').textContent = gameState.tradeHistory.length;
    document.getElementById('holdingDays').textContent = gameState.holdingDays;

    const maxGain = gameState.tradeGains.length > 0 ?
        Math.max(...gameState.tradeGains) : 0;
    document.getElementById('maxGain').textContent =
        (maxGain >= 0 ? '+' : '') + maxGain.toFixed(2) + '%';

    document.getElementById('resultChartSubtitle').textContent =
        `${gameState.currentStock.name} (${gameState.currentStock.code})`;

    // Draw full chart and reports
    generateBSReport();
    generateBestPoints();
    drawResultChart();
    generateKlineAnalysis();
}

export function drawResultChart() {
    const chartDom = document.getElementById('result-kline-chart');
    if (chartRefs.resultChart) {
        chartRefs.resultChart.dispose();
    }
    chartRefs.resultChart = echarts.init(chartDom);

    const histLen = gameState.historyLength;
    const fullData = gameState.gameKline.slice(0, histLen + 30);
    const dates = fullData.map(d => d.date);
    const ohlc = fullData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = fullData.map(d => d.volume);
    const volumeColors = fullData.map(d => d.close >= d.open ? '#e05252' : '#3db86a');

    const ma5 = calculateMA(fullData, 5);
    const ma10 = calculateMA(fullData, 10);
    const ma20 = calculateMA(fullData, 20);
    const ma30 = calculateMA(fullData, 30);

    // Mark buy/sell points (offset by histLen)
    const markPoints = gameState.tradeHistory.map(trade => ({
        coord: [histLen + trade.day - 1, trade.price],
        value: trade.type === 'buy' ? '买' : '卖',
        itemStyle: {
            color: trade.type === 'buy' ? '#e05252' : '#3db86a'
        }
    })).filter(p => p.coord[0] < histLen + 30);

    // Mark best buy/sell points (from analysis)
    const bp = gameState.bestPoints || { buys: [], sells: [] };
    const bestMarkPoints = [];
    bp.buys.forEach((p, idx) => {
        bestMarkPoints.push({
            coord: [histLen + p.day - 1, fullData[histLen + p.day - 1].low],
            value: 'B' + (idx + 1),
            symbolOffset: [0, 20],
            symbol: 'diamond',
            symbolSize: 14,
            itemStyle: { color: '#fbbf24' },
            label: { color: '#fbbf24', fontSize: 10, fontWeight: 'bold', position: 'bottom' }
        });
    });
    bp.sells.forEach((p, idx) => {
        bestMarkPoints.push({
            coord: [histLen + p.day - 1, fullData[histLen + p.day - 1].high],
            value: 'S' + (idx + 1),
            symbol: 'diamond',
            symbolSize: 14,
            itemStyle: { color: '#a78bfa' },
            label: { color: '#a78bfa', fontSize: 10, fontWeight: 'bold', position: 'top' }
        });
    });

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(22, 22, 29, 0.95)',
            borderColor: 'rgba(200, 164, 78, 0.2)',
            textStyle: {
                color: '#e8e4dd',
                fontFamily: 'JetBrains Mono'
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
                }
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
                    data: [...markPoints, ...bestMarkPoints],
                    symbol: 'pin',
                    symbolSize: 40,
                    label: {
                        formatter: '{b}',
                        color: '#fff',
                        fontWeight: 'bold'
                    }
                }
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
            }
        ]
    };

    chartRefs.resultChart.setOption(option);
    applyChartTheme(chartRefs.resultChart);

    // Build interactive point navigator
    buildPointNavigator(chartRefs.resultChart, histLen, fullData);
}

export function buildPointNavigator(chart, histLen, fullData) {
    const nav = document.getElementById('pointNavigator');
    nav.innerHTML = '';

    const bp = gameState.bestPoints || { buys: [], sells: [] };
    const trades = gameState.tradeHistory || [];

    const allPoints = [];

    bp.buys.forEach((p, idx) => {
        allPoints.push({
            day: p.day,
            label: '荐买' + (idx + 1),
            type: 'best-buy',
            date: p.date,
            price: p.price,
            reasons: p.reasons
        });
    });

    bp.sells.forEach((p, idx) => {
        allPoints.push({
            day: p.day,
            label: '荐卖' + (idx + 1),
            type: 'best-sell',
            date: p.date,
            price: p.price,
            reasons: p.reasons
        });
    });

    trades.forEach((t, idx) => {
        if (t.day > 30) return;
        const dayData = fullData[histLen + t.day - 1];
        allPoints.push({
            day: t.day,
            label: t.type === 'buy' ? '买入' + (idx + 1) : '卖出' + (idx + 1),
            type: t.type === 'buy' ? 'user-buy' : 'user-sell',
            date: dayData ? dayData.date : '',
            price: t.price,
            reasons: null,
            tradeReturn: t.return
        });
    });

    allPoints.sort((a, b) => a.day - b.day);

    if (allPoints.length === 0) return;

    const strip = document.createElement('div');
    strip.className = 'point-nav-strip';

    const detail = document.createElement('div');
    detail.className = 'point-nav-detail';

    let activeIdx = -1;

    allPoints.forEach((pt, i) => {
        const badge = document.createElement('span');
        badge.className = 'point-nav-badge ' + pt.type;
        badge.textContent = pt.label;
        badge.setAttribute('data-idx', i);

        badge.addEventListener('click', () => {
            if (activeIdx === i) {
                detail.classList.remove('open');
                badge.classList.remove('active');
                activeIdx = -1;
                chart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
                return;
            }

            const prev = strip.querySelector('.point-nav-badge.active');
            if (prev) prev.classList.remove('active');

            badge.classList.add('active');
            activeIdx = i;

            let html = '<div class="detail-header">';
            html += `<span class="point-badge ${pt.type.includes('buy') ? 'buy' : 'sell'}">${pt.label}</span>`;
            html += `<span class="detail-day">第 ${pt.day} 天（${pt.date}）</span>`;
            html += `<span class="detail-price">价格 ${pt.price.toFixed(2)}</span>`;
            html += '</div>';

            if (pt.reasons) {
                html += '<div class="detail-reasons">';
                html += pt.reasons.map(r =>
                    `<span class="point-reason-tag">${r.tag}</span>${r.text}`
                ).join('<br>');
                html += '</div>';
            } else {
                html += '<div class="detail-user-info">';
                if (pt.type === 'user-buy') {
                    html += `你在第 ${pt.day} 天以 ${pt.price.toFixed(2)} 买入`;
                } else {
                    const retPct = pt.tradeReturn ? ((pt.tradeReturn - 1) * 100).toFixed(2) : null;
                    html += `你在第 ${pt.day} 天以 ${pt.price.toFixed(2)} 卖出`;
                    if (retPct !== null) {
                        const cls = parseFloat(retPct) >= 0 ? 'gain-color' : 'loss-color';
                        html += `，本次收益 <span style="color:var(--${cls});font-weight:700">${parseFloat(retPct) >= 0 ? '+' : ''}${retPct}%</span>`;
                    }
                }
                html += '</div>';
            }

            detail.innerHTML = html;
            detail.classList.add('open');

            const dataIndex = histLen + pt.day - 1;
            chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: dataIndex });
        });

        strip.appendChild(badge);
    });

    nav.appendChild(strip);
    nav.appendChild(detail);
}

export function resetGame() {
    const hdr = document.querySelector('.header');
    hdr.classList.remove('compact');
    hdr.style.display = 'none';
    document.getElementById('resultScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
}
