// ========== RESULT SCREEN ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';
import { finishCloudGame, updateSaveStatusUi } from './game-sync.js';

function calcGrade(finalReturnPercent, bsScore) {
    // Emphasize realized return; BS is a light tie-breaker only.
    const score = finalReturnPercent * 0.85 + ((bsScore || 50) - 70) * 0.08;
    let letter, title, cls;
    if (score >= 18 && finalReturnPercent >= 12) {
        letter = 'S'; title = '交易之神'; cls = 'grade-S';
    } else if (score >= 10 && finalReturnPercent >= 5) {
        letter = 'A'; title = '技术流玩家'; cls = 'grade-A';
    } else if (score >= 2 || finalReturnPercent >= 1) {
        letter = 'B'; title = '稳健操盘手'; cls = 'grade-B';
    } else if (finalReturnPercent >= -5) {
        letter = 'C'; title = '韭菜培育中'; cls = 'grade-C';
    } else {
        letter = 'D'; title = '慈善韭菜'; cls = 'grade-D';
    }
    let verdict;
    if (letter === 'S') {
        verdict = '完美操作，教科书级别的走势把握。每一笔都入木三分。';
    } else if (letter === 'A') {
        verdict = finalReturnPercent >= 10
            ? '买卖时机较准，本局收益明显跑赢可交易区间，继续保持纪律。'
            : '操作质量不错，本局取得了扎实正收益。';
    } else if (letter === 'B') {
        verdict = finalReturnPercent >= 0
            ? '整体操作稳健，略有遗憾但瑕不掩瑜。继续磨练！'
            : '有一定判断，但收益仍偏弱，进出场可以再打磨。';
    } else if (letter === 'C') {
        verdict = Math.abs(finalReturnPercent) < 1
            ? '几乎打平，这局更像观望课。下次试着更果断地执行计划。'
            : '小幅回撤，别灰心——复盘买卖点比纠结单局更重要。';
    } else {
        verdict = '亏损偏大……别担心，这只是模拟，现实里要三思啊。';
    }
    return { letter, title, verdict, cls };
}

export function endGame() {
    // Settlement P&L / valuation already applied by finishSettle() via shared engine.
    // Do not invent a day-30 sell fill here.

    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('resultScreen').classList.add('active');

    document.getElementById('stockReveal').textContent =
        `${gameState.currentStock.name} (${gameState.currentStock.code})`;

    // Date range covers the 30 game days only (day-1 … day-30).
    const histLen = gameState.historyLength;
    const startBar = gameState.gameKline[histLen];
    const endBar = gameState.gameKline[histLen + 29];
    document.getElementById('dateRange').textContent =
        `${startBar.date} ~ ${endBar.date}`;

    const fillModeEl = document.getElementById('fillModeLabel');
    if (fillModeEl) {
        fillModeEl.textContent = gameState.fillMode === 'same_close'
            ? '成交：当日收盘'
            : '成交：次日开盘';
    }

    const finalReturnPercent = gameState.returnPct != null
        ? parseFloat(gameState.returnPct)
        : (gameState.totalReturn - 1) * 100;
    const finalReturnEl = document.getElementById('finalReturn');
    const pctStr = gameState.returnPct != null
        ? ((parseFloat(gameState.returnPct) >= 0 ? '+' : '') + gameState.returnPct)
        : ((finalReturnPercent >= 0 ? '+' : '') + finalReturnPercent.toFixed(2));
    finalReturnEl.textContent = pctStr + '%';
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

    generateBSReport();
    generateBestPoints();
    drawResultChart();
    generateKlineAnalysis();

    const grade = calcGrade(finalReturnPercent, gameState.bsScore);
    const medalEl = document.getElementById('gradeMedal');
    if (medalEl) {
        medalEl.className = 'grade-medal ' + grade.cls;
        document.getElementById('gradeLetter').textContent = grade.letter;
    }
    const titleEl = document.getElementById('gradeTitle');
    if (titleEl) titleEl.textContent = `${grade.letter}级 · ${grade.title}`;
    const verdictEl = document.getElementById('gradeVerdict');
    if (verdictEl) verdictEl.textContent = grade.verdict;

    const bsDisplayEl = document.getElementById('bsScoreDisplay');
    if (bsDisplayEl) bsDisplayEl.textContent = gameState.bsScore != null ? gameState.bsScore : '--';

    updateSaveStatusUi();
    if (gameState.cloudMode && gameState.cloudGameId) {
        finishCloudGame().then(() => {
            // Refresh return display from authoritative server result if present.
            const finalReturnEl = document.getElementById('finalReturn');
            if (finalReturnEl && gameState.returnPct != null) {
                const finalReturnPercent = parseFloat(gameState.returnPct);
                const pctStr = (finalReturnPercent >= 0 ? '+' : '') + gameState.returnPct;
                finalReturnEl.textContent = pctStr + '%';
                finalReturnEl.className = 'final-return ' +
                    (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');
            }
            updateSaveStatusUi();
        }).catch(() => updateSaveStatusUi());
    }
}

export function drawResultChart() {
    const chartDom = document.getElementById('result-kline-chart');
    if (chartRefs.resultChart) {
        chartRefs.resultChart.dispose();
    }
    chartRefs.resultChart = echarts.init(chartDom);

    const histLen = gameState.historyLength;
    const fullData = gameState.gameKline.slice(0, histLen + 30); // history + day-1…day-30
    const dates = fullData.map(d => d.date);
    const ohlc = fullData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = fullData.map(d => d.volume);
    const volumeColors = fullData.map(d => d.close >= d.open ? '#e05252' : '#3db86a');

    const ma5 = calculateMA(fullData, 5);
    const ma10 = calculateMA(fullData, 10);
    const ma20 = calculateMA(fullData, 20);
    const ma30 = calculateMA(fullData, 30);

    const markPoints = gameState.tradeHistory.map(trade => ({
        name: trade.type === 'buy' ? '买' : '卖',
        coord: [histLen + trade.day - 1, trade.price],
        value: trade.type === 'buy' ? '买' : '卖',
        itemStyle: {
            color: trade.type === 'buy' ? '#e05252' : '#3db86a'
        }
    })).filter(p => p.coord[0] < histLen + 30);

    if (gameState.valuation) {
        const v = gameState.valuation;
        markPoints.push({
            name: '估值',
            coord: [histLen + v.day - 1, v.price],
            value: '估值',
            symbol: 'diamond',
            symbolSize: 14,
            itemStyle: { color: '#f5c542' },
            label: { color: '#f5c542', fontSize: 10, fontWeight: 'bold' }
        });
    }

    const bp = gameState.bestPoints || { buys: [], sells: [] };
    const bestMarkPoints = [];
    bp.buys.forEach((p, idx) => {
        bestMarkPoints.push({
            name: 'B' + (idx + 1),
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
            name: 'S' + (idx + 1),
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
            textStyle: { color: '#e8e4dd', fontFamily: 'JetBrains Mono' }
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: [
            { left: '10%', right: '2%', top: '5%', bottom: '35%' },
            { left: '10%', right: '2%', top: '72%', bottom: '8%' }
        ],
        xAxis: [
            {
                type: 'category', data: dates, gridIndex: 0,
                axisLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.2)' } },
                axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
            },
            {
                type: 'category', data: dates, gridIndex: 1,
                axisLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.2)' } },
                axisLabel: { color: '#6b6660', fontFamily: 'JetBrains Mono', fontSize: 10, rotate: 45 }
            }
        ],
        yAxis: [
            {
                type: 'value', scale: true, gridIndex: 0,
                axisLabel: { color: '#6b6660', fontFamily: 'JetBrains Mono', fontSize: 10 },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: 'rgba(200, 164, 78, 0.06)' } }
            },
            { type: 'value', scale: true, gridIndex: 1, show: false }
        ],
        series: [
            {
                name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: ohlc,
                itemStyle: { color: '#e05252', color0: '#3db86a', borderColor: '#e05252', borderColor0: '#3db86a' },
                markPoint: {
                    data: [...markPoints, ...bestMarkPoints],
                    symbol: 'pin', symbolSize: 40,
                    label: { formatter: '{b}', color: '#fff', fontWeight: 'bold' }
                }
            },
            {
                name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
                itemStyle: { color: function(params) { return volumeColors[params.dataIndex]; } }
            },
            { name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma5, smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#f5c542' } },
            { name: 'MA10', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma10, smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#42a5f5' } },
            { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma20, smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#ab47bc' } },
            { name: 'MA30', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma30, smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#26a69a' } }
        ]
    };

    chartRefs.resultChart.setOption(option);
    applyChartTheme(chartRefs.resultChart);
    buildPointNavigator(chartRefs.resultChart, histLen, fullData);
}

export function buildPointNavigator(chart, histLen, fullData) {
    const nav = document.getElementById('pointNavigator');
    nav.innerHTML = '';

    const bp = gameState.bestPoints || { buys: [], sells: [] };
    const trades = gameState.tradeHistory || [];
    const allPoints = [];

    bp.buys.forEach((p, idx) => {
        allPoints.push({ day: p.day, label: '信号买' + (idx + 1), type: 'best-buy', date: p.date, price: p.price, reasons: p.reasons });
    });
    bp.sells.forEach((p, idx) => {
        allPoints.push({ day: p.day, label: '信号卖' + (idx + 1), type: 'best-sell', date: p.date, price: p.price, reasons: p.reasons });
    });
    trades.forEach((t, idx) => {
        const dayData = fullData[histLen + t.day - 1];
        if (!dayData) return;
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
    if (gameState.valuation) {
        const v = gameState.valuation;
        const dayData = fullData[histLen + v.day - 1];
        allPoints.push({
            day: v.day,
            label: '期末估值',
            type: 'user-valuation',
            date: dayData ? dayData.date : '',
            price: v.price,
            reasons: null,
            tradeReturn: v.multiple
        });
    }
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
            html += `<span class="point-badge ${pt.type.includes('buy') ? 'buy' : (pt.type.includes('valuation') ? 'valuation' : 'sell')}">${pt.label}</span>`;
            html += `<span class="detail-day">第 ${pt.day} 天（${pt.date}）</span>`;
            html += `<span class="detail-price">价格 ${pt.price.toFixed(2)}</span>`;
            html += '</div>';
            if (pt.reasons) {
                html += '<div class="detail-reasons">';
                html += pt.reasons.map(r => `<span class="point-reason-tag">${r.tag}</span>${r.text}`).join('<br>');
                html += '</div>';
            } else {
                html += '<div class="detail-user-info">';
                if (pt.type === 'user-valuation') {
                html += `<div class="point-detail">未平仓按第 30 日收盘做<em>期末估值</em>（不计卖出成交）`;
                if (pt.tradeReturn) {
                    const retPct = ((pt.tradeReturn - 1) * 100).toFixed(2);
                    const cls = parseFloat(retPct) >= 0 ? 'positive' : 'negative';
                    html += `，浮动 <span style="color:var(--${cls});font-weight:700">${parseFloat(retPct) >= 0 ? '+' : ''}${retPct}%</span>`;
                }
                html += `</div>`;
            } else if (pt.type === 'user-buy') {

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
            chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: histLen + pt.day - 1 });
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
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
    const tagsEl = document.getElementById('waveAnalysisTags');
    if (tagsEl) tagsEl.innerHTML = '';
    const textEl = document.getElementById('waveAnalysisText');
    if (textEl) textEl.textContent = '暂无分析数据，随着行情展开将自动生成。';
}

export function playAgain() {
    if (typeof window.startGame === "function") {
        window.startGame();
        return;
    }
    resetGame();
}
