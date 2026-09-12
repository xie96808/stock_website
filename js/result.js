// ========== RESULT SCREEN ==========
import { chartRefs } from './state.js';
import { getSession, selectSettleView } from './game-session.js';
import { applyChartTheme } from './utils.js';
import { buildKlineOption } from './kline-option.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';
import { calcGrade } from './analysis-pure.js';
import { finishCloudGame, updateSaveStatusUi } from './game-sync.js';
import { Route, prepareScreen, activateScreen } from './screen-router.js';
import {
    clearShareRankMeta,
    refreshShareRankMeta,
    updateShareRankHint,
    saveResultShareImage,
    copyResultShareText,
    openResultLeaderboard,
} from './result-share.js';
export { saveResultShareImage, copyResultShareText, openResultLeaderboard };


export function endGame() {
    // Settlement P&L / valuation already applied by finishSettle() via shared engine.
    // Do not invent a day-30 sell fill here.

    prepareScreen(Route.RESULT);
    activateScreen(Route.RESULT);

    const view = selectSettleView();

    document.getElementById('stockReveal').textContent =
        `${view.currentStock.name} (${view.currentStock.code})`;

    // Date range covers the 30 game days only (day-1 … day-30).
    const histLen = view.historyLength;
    const startBar = view.gameKline[histLen];
    const endBar = view.gameKline[histLen + 29];
    document.getElementById('dateRange').textContent =
        `${startBar.date} ~ ${endBar.date}`;

    const fillModeEl = document.getElementById('fillModeLabel');
    if (fillModeEl) {
        fillModeEl.textContent = view.fillMode === 'same_close'
            ? '成交：当日收盘'
            : '成交：次日开盘';
    }

    const assistEl = document.getElementById('assistClassLabel');
    if (assistEl) {
        const a = view.assistClass;
        if (a === 'undo') {
            assistEl.hidden = false;
            assistEl.textContent = '辅助：反悔局';
        } else if (a === 'clean') {
            assistEl.hidden = false;
            assistEl.textContent = '辅助：纯净局';
        } else if (a === 'legacy') {
            assistEl.hidden = false;
            assistEl.textContent = '辅助：旧协议局';
        } else {
            assistEl.hidden = true;
            assistEl.textContent = '';
        }
    }

    const finalReturnPercent = view.returnPct != null
        ? parseFloat(view.returnPct)
        : (view.totalReturn - 1) * 100;
    const finalReturnEl = document.getElementById('finalReturn');
    const pctStr = view.returnPct != null
        ? ((parseFloat(view.returnPct) >= 0 ? '+' : '') + view.returnPct)
        : ((finalReturnPercent >= 0 ? '+' : '') + finalReturnPercent.toFixed(2));
    finalReturnEl.textContent = pctStr + '%';
    finalReturnEl.className = 'final-return ' +
        (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');

    document.getElementById('finalTradeCount').textContent = view.tradeHistory.length;
    document.getElementById('holdingDays').textContent = view.holdingDays;

    const maxGain = view.tradeGains.length > 0 ?
        Math.max(...view.tradeGains) : 0;
    document.getElementById('maxGain').textContent =
        (maxGain >= 0 ? '+' : '') + maxGain.toFixed(2) + '%';

    document.getElementById('resultChartSubtitle').textContent =
        `${view.currentStock.name} (${view.currentStock.code})`;

    generateBSReport();
    generateBestPoints();
    drawResultChart();
    generateKlineAnalysis();

    // BS score written by generateBSReport — re-read live session.
    const settled = selectSettleView();
    const grade = calcGrade(finalReturnPercent, settled.bsScore);
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
    if (bsDisplayEl) bsDisplayEl.textContent = settled.bsScore != null ? settled.bsScore : '--';

    updateSaveStatusUi();
    clearShareRankMeta();
    updateShareRankHint();
    if (settled.cloudMode && settled.cloudGameId) {
        finishCloudGame().then(async (res) => {
            // Refresh return display from authoritative server result if present.
            const live = getSession();
            const finalReturnEl = document.getElementById('finalReturn');
            if (finalReturnEl && live.returnPct != null) {
                const finalReturnPercent = parseFloat(live.returnPct);
                const pctStr = (finalReturnPercent >= 0 ? '+' : '') + live.returnPct;
                finalReturnEl.textContent = pctStr + '%';
                finalReturnEl.className = 'final-return ' +
                    (finalReturnPercent > 0 ? 'positive' : finalReturnPercent < 0 ? 'negative' : 'zero');
            }
            updateSaveStatusUi();
            if (res) await refreshShareRankMeta();
            updateShareRankHint();
        }).catch(() => {
            updateSaveStatusUi();
            updateShareRankHint();
        });
    }
}

export function drawResultChart() {
    const chartDom = document.getElementById('result-kline-chart');
    if (chartRefs.resultChart) {
        chartRefs.resultChart.dispose();
    }
    chartRefs.resultChart = echarts.init(chartDom);

    const view = selectSettleView();
    const histLen = view.historyLength;
    const fullData = view.gameKline.slice(0, histLen + 30); // history + day-1…day-30

    const option = buildKlineOption({
        bars: fullData,
        historyLength: histLen,
        trades: view.tradeHistory,
        bestPoints: view.bestPoints || { buys: [], sells: [] },
        valuation: view.valuation || null,
        mode: 'result',
    });

    chartRefs.resultChart.setOption(option);
    applyChartTheme(chartRefs.resultChart);
    buildPointNavigator(chartRefs.resultChart, histLen, fullData);
}

export function buildPointNavigator(chart, histLen, fullData) {
    const nav = document.getElementById('pointNavigator');
    nav.innerHTML = '';

    const view = selectSettleView();
    const bp = view.bestPoints || { buys: [], sells: [] };
    const trades = view.tradeHistory || [];
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
    if (view.valuation) {
        const v = view.valuation;
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
    if (typeof window.showHome === 'function') {
        window.showHome();
    } else {
        prepareScreen(Route.HOME);
    }
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
