// ========== TECHNICAL ANALYSIS (DOM adapters over analysis-pure) ==========
import { patchSession, selectAnalysisInput } from './game-session.js';
import {
    computeBestPoints,
    computeBSReport,
    computeKlineAnalysisModel,
} from './analysis-pure.js';

export function generateKlineAnalysis() {
    const input = selectAnalysisInput();
    const model = computeKlineAnalysisModel({
        kline: input.kline,
        historyLength: input.historyLength,
    });

    document.getElementById('klineAnalysis').innerHTML = `
        <div class="analysis-title">波段分析</div>
        <div class="trend-tags">${model.tags.map(t => `<span class="trend-tag ${t.cls}">${t.text}</span>`).join('')}</div>
        <div class="analysis-text">${model.analysisHtml}</div>
    `;

    const bp = input.bestPoints || { buys: [], sells: [] };
    const analysisEl = document.getElementById('klineAnalysis');
    if (analysisEl) {
        const renderPt = (p, kind) => {
            const tags = (p.reasons || []).map(r => `<span class="point-reason-tag">${r.tag}</span>`).join('');
            const why = (p.reasons || []).map(r => r.text).join('；');
            return `<div class="best-point-card">
                <div class="point-header">
                    <span class="point-badge ${kind}">${kind === 'buy' ? '信号买' : '信号卖'}</span>
                    <span class="point-day">第 ${p.day} 天（${p.date}）</span>
                    <span class="point-price">${p.price.toFixed(2)}</span>
                </div>
                <div class="point-reason">${tags} ${why}</div>
            </div>`;
        };
        let extra = '<div class="analysis-title">当时信号</div>';
        extra += '<div class="analysis-text"><p>只用当日及以前的均线、量价、形态，不偷看后续行情。分数达到阈值后按强度选取，同类信号至少间隔 3 个交易日，最多各 3 个。</p></div>';
        if (bp.buys.length === 0 && bp.sells.length === 0) {
            extra += '<div class="analysis-text"><p>本局没有足够强的当时信号。</p></div>';
        } else {
            extra += bp.buys.map(p => renderPt(p, 'buy')).join('');
            extra += bp.sells.map(p => renderPt(p, 'sell')).join('');
        }
        analysisEl.insertAdjacentHTML('beforeend', extra);
    }
}

export function generateBestPoints() {
    const input = selectAnalysisInput();
    patchSession({ bestPoints: computeBestPoints({
        kline: input.kline,
        historyLength: input.historyLength,
    }) });
}

export function generateBSReport() {
    const input = selectAnalysisInput();
    const report = computeBSReport({
        kline: input.kline,
        historyLength: input.historyLength,
        trades: input.trades,
        fillMode: input.fillMode,
        totalReturn: input.totalReturn,
        tradeGains: input.tradeGains,
    });

    patchSession({ bsScore: report.score });

    const el = document.getElementById('bsReport');
    el.innerHTML = `
        <div class="bs-score-header">
            <span class="bs-score-title">BS 点评分</span>
            <span class="bs-score-badge ${report.gradeCls}">${report.score}分 · ${report.grade}</span>
        </div>
        <div class="bs-report-items">
            ${report.details.map(d => `
                <div class="bs-report-item">
                    <span class="bs-item-label">${d.label}</span>
                    <span>
                        <span class="bs-item-value ${d.cls}">${d.value}</span>
                        <span style="color:var(--text-muted); font-size:0.75rem; margin-left:8px;">${d.note}</span>
                    </span>
                </div>
            `).join('')}
        </div>
        <div class="bs-comment">${report.comment}</div>
    `;
}
