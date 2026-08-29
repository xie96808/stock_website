// ========== RESULT SCREEN ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';

function calcGrade(finalReturnPercent, bsScore) {
    // Grade: S/A/B/C/D based on return + bs score
    const score = finalReturnPercent * 0.6 + (bsScore || 50) * 0.1;
    if (score >= 15)  return { letter: 'S', title: '交易之神', verdict: '完美操作，教科书级别的走势把握。每一笔都入木三分。', cls: 'grade-S' };
    if (score >= 8)   return { letter: 'A', title: '技术流玩家', verdict: '买卖时机精准，收益远超大盘，是真正的趋势猎手。', cls: 'grade-A' };
    if (score >= 2)   return { letter: 'B', title: '稳健操盘手', verdict: '整体操作稳健，略有遗憾但瑕不掩瑝。继续磨炼！', cls: 'grade-B' };
    if (score >= -5)  return { letter: 'C', title: '青菜培育中', verdict: '不亏不赚，或许下次运气更好一些？', cls: 'grade-C' };
    return              { letter: 'D', title: '慈善青菜', verdict: '亏损严重……别担心，这只是模拟，现实里要三思啊。', cls: 'grade-D' };
}

export function endGame() {
    // Liquidate a real holding at the next session open.
    // Do NOT liquidate a same-bar T+1 lock (last-day buy at this open) — that would be a fake round-trip.
    if (gameState.position === 'holding') {
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

    // Draw full chart and reports (BS score needed for grade)
    generateBSReport();
    generateBestPoints();
    drawResultChart();
    generateKlineAnalysis();

    // Grade medal — populate after bsScore is set
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

    // BS score display
    const bsDisplayEl = document.getElementById('bsScoreDisplay');
    if (bsDisplayEl) bsDisplayEl.textContent = gameState.bsScore != null ? gameState.bsScore : '--';
}
