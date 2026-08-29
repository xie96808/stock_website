// ========== RESULT SCREEN ==========
import { gameState, chartRefs } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { generateBSReport, generateBestPoints, generateKlineAnalysis } from './analysis.js';

function calcGrade(finalReturnPercent, bsScore) {
    // Grade: S/A/B/C/D based on return + bs score
    const score = finalReturnPercent * 0.6 + (bsScore || 50) * 0.1;
    if (score >= 15)  return { letter: 'S', title: '交易之神', verdict: '完美操作，教科书级别的走势把握。每一笔都入木三分。', cls: 'grade-S' };
    if (score >= 8)   return { letter: 'A', title: '技术流玩家', verdict: '买卖时机精准，收益远超大盘，是真正的趋势猎手。', cls: 'grade-A' };
    if (score >= 2)   return { letter: 'B', title: '稳健操盘手', verdict: '整体操作稳健，略有遗憾但瑕不掩瑜。继续磨炼！', cls: 'grade-B' };
    if (score >= -5)  return { letter: 'C', title: '青菜培育中', verdict: '不亏不赚，或许下次运气更好一些？', cls: 'grade-C' };
    return              { letter: 'D', title: '慈善青菜', verdict: '亏损严重……别担心，这只是模拟，现实里要三思啊。', cls: 'grade-D' };
}
