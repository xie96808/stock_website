// ========== QUIZ PURE (no DOM / no gameState / no theme / no chartRefs) ==========
// Behavior-preserving extraction of scoring, answer checks, technical copy, and
// session transitions used by the academy training quiz view (`js/quiz.js`).
// Stocks / patterns are passed in — pure helpers never read the game blackboard.

/**
 * Continuity clarity of a kline segment (pct move + same-direction day ratio).
 * @returns {{ pct: number, clarity: number }}
 */
export function trendScore(data) {
    if (!data || data.length < 2) return { pct: 0, clarity: 0 };
    const pct = (data[data.length - 1].close - data[0].open) / data[0].open * 100;
    const dir = pct >= 0 ? 1 : -1;
    let sameDirDays = 0;
    for (let i = 0; i < data.length; i++) {
        if ((data[i].close - data[i].open) * dir >= 0) sameDirDays++;
    }
    const clarity = sameDirDays / data.length;
    return { pct, clarity };
}

function sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
        result.push(+(sum / period).toFixed(2));
    }
    return result;
}

/** Explanation prose for a practical question (shown window + correct continuation). */
export function analyzeTechnical(shownData, correctCont) {
    const all = shownData.concat(correctCont);
    const n = shownData.length;

    const ma5 = sma(all, 5);
    const ma10 = sma(all, 10);
    const ma20 = sma(all, 20);

    const parts = [];

    const last5 = shownData.slice(-5);
    const priceChange5 = ((last5[last5.length - 1].close - last5[0].close) / last5[0].close * 100).toFixed(2);
    const trendWord = priceChange5 > 1 ? '上涨' : priceChange5 < -1 ? '下跌' : '横盘整理';
    parts.push('近5日走势' + trendWord + '（' + (priceChange5 > 0 ? '+' : '') + priceChange5 + '%）');

    const boundaryMa5 = ma5[n - 1];
    const boundaryMa10 = ma10[n - 1];
    const boundaryMa20 = ma20[n - 1];
    const lastClose = shownData[n - 1].close;
    if (boundaryMa5 && boundaryMa10) {
        if (boundaryMa5 > boundaryMa10) {
            parts.push('均线呈多头排列（MA5 > MA10），短期趋势偏多');
        } else {
            parts.push('均线呈空头排列（MA5 < MA10），短期趋势偏空');
        }
        if (boundaryMa20) {
            if (lastClose > boundaryMa20) parts.push('股价在MA20上方运行，中期趋势向好');
            else parts.push('股价跌破MA20，中期支撑较弱');
        }
    }

    const recentVol = last5.map((d) => d.volume);
    const prevVol = shownData.slice(-10, -5).map((d) => d.volume);
    if (prevVol.length >= 3) {
        const avgRecent = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
        const avgPrev = prevVol.reduce((a, b) => a + b, 0) / prevVol.length;
        const volRatio = avgRecent / avgPrev;
        if (volRatio > 1.5) parts.push('近期成交量明显放大（较前期增加' + ((volRatio - 1) * 100).toFixed(0) + '%），资金活跃');
        else if (volRatio < 0.6) parts.push('近期成交量大幅萎缩（较前期减少' + ((1 - volRatio) * 100).toFixed(0) + '%），观望情绪浓');
        else if (volRatio > 1.1) parts.push('成交量温和放大');
        else if (volRatio < 0.85) parts.push('成交量略有萎缩');
    }

    const lastBar = shownData[n - 1];
    const prevBar = shownData[n - 2];
    const bodyLen = Math.abs(lastBar.close - lastBar.open);
    const upperWick = lastBar.high - Math.max(lastBar.open, lastBar.close);
    const lowerWick = Math.min(lastBar.open, lastBar.close) - lastBar.low;

    if (upperWick > bodyLen * 2 && bodyLen > 0) parts.push('最后一根K线上影线较长，存在上方抛压');
    if (lowerWick > bodyLen * 2 && bodyLen > 0) parts.push('最后一根K线下影线较长，下方有支撑');
    if (bodyLen < (lastBar.high - lastBar.low) * 0.1) parts.push('最后一根K线呈十字星形态，多空分歧明显');

    if (prevBar) {
        const prevBody = Math.abs(prevBar.close - prevBar.open);
        if (lastBar.close > lastBar.open && prevBar.close < prevBar.open && bodyLen > prevBody * 1.3) {
            parts.push('最后两日出现看涨吞没形态');
        } else if (lastBar.close < lastBar.open && prevBar.close > prevBar.open && bodyLen > prevBody * 1.3) {
            parts.push('最后两日出现看跌吞没形态');
        }
    }

    const contChange = ((correctCont[correctCont.length - 1].close - correctCont[0].open) / correctCont[0].open * 100).toFixed(2);
    const contWord = contChange > 2 ? '上涨' : contChange < -2 ? '下跌' : '震荡';
    parts.push('实际后续走势：' + contWord + '（' + (contChange > 0 ? '+' : '') + contChange + '%）');

    const contUpDays = correctCont.filter((d) => d.close >= d.open).length;
    const contDownDays = correctCont.length - contUpDays;
    parts.push('后续' + correctCont.length + '个交易日中，' + contUpDays + '天收阳、' + contDownDays + '天收阴');

    return parts.join('；') + '。';
}

/** Scale a continuation segment so its first open matches `lastClose`. */
export function normalizeContinuation(data, lastClose) {
    const ratio = lastClose / data[0].open;
    return data.map((d) => ({
        date: d.date,
        open: +(d.open * ratio).toFixed(2),
        close: +(d.close * ratio).toFixed(2),
        high: +(d.high * ratio).toFixed(2),
        low: +(d.low * ratio).toFixed(2),
        volume: d.volume,
    }));
}

/**
 * Whether the selected option is correct for a built question.
 * Theory questions expect `_options` (shuffled choices) on the question object.
 */
export function isQuizAnswerCorrect(q, optionIndex) {
    if (!q) return false;
    if (q.type === 'practical') return optionIndex === q.correctIndex;
    if (!q._options) return false;
    return q._options[optionIndex] === q.correct;
}

/** Grade band + comment for training results card. */
export function gradeQuizScore(score, total = 10) {
    if (score >= Math.ceil(total * 0.8)) {
        return { scoreCls: 'high', comment: '你的炒股知识非常扎实，可以去实战中检验了！' };
    }
    if (score >= Math.ceil(total * 0.5)) {
        return { scoreCls: 'medium', comment: '基础还不错，但还需要加强学习。建议去知识区复习薄弱环节。' };
    }
    return { scoreCls: 'low', comment: '还需要多多学习哦！建议先去知识区系统学习各种形态。' };
}

/** Fresh quiz session blackboard fields (charts stay view-owned; see createEmptyQuizSession). */
export function createEmptyQuizSession() {
    return {
        questions: [],
        currentIndex: 0,
        score: 0,
        answers: [],
        answered: false,
    };
}

/**
 * Apply an answer onto a session snapshot (immutable-ish: returns patch fields).
 * Does not touch charts — view owns dispose/create.
 * @returns {{ ok: false, reason: 'already_answered' } | { ok: true, answered: true, answers: any[], score: number, isCorrect: boolean }}
 */
export function applyQuizAnswer(session, optionIndex) {
    if (session.answered) return { ok: false, reason: 'already_answered' };
    const q = session.questions[session.currentIndex];
    const isCorrect = isQuizAnswerCorrect(q, optionIndex);
    const answers = session.answers.slice();
    answers[session.currentIndex] = optionIndex;
    return {
        ok: true,
        answered: true,
        answers,
        score: session.score + (isCorrect ? 1 : 0),
        isCorrect,
    };
}

/**
 * Advance to next question or signal results.
 * @returns {{ done: true } | { done: false, currentIndex: number, answered: false }}
 */
export function advanceQuizSession(session, { lastIndex = 9 } = {}) {
    if (session.currentIndex >= lastIndex) return { done: true };
    return {
        done: false,
        currentIndex: session.currentIndex + 1,
        answered: false,
    };
}

/**
 * Detail rows for results list (no HTML).
 * @returns {{ index: number, typeName: string, question: string, isCorrect: boolean, userText: string, correctText: string, explanation: string }[]}
 */
export function buildQuizResultDetails(session, { labels = ['A', 'B', 'C', 'D'] } = {}) {
    return (session.questions || []).map((q, i) => {
        const userAns = session.answers[i];
        let isCorrect;
        let userText;
        let correctText;
        if (q.type === 'practical') {
            isCorrect = userAns === q.correctIndex;
            userText = userAns !== undefined ? labels[userAns] : '未作答';
            correctText = labels[q.correctIndex];
        } else {
            isCorrect = !!(q._options && q._options[userAns] === q.correct);
            userText = userAns !== undefined && q._options ? q._options[userAns] : '未作答';
            correctText = q.correct;
        }
        return {
            index: i,
            typeName: q.type === 'practical' ? '实操题' : '理论题',
            question: q.question,
            isCorrect: !!isCorrect,
            userText,
            correctText,
            explanation: q.explanation || '',
        };
    });
}

export const PRACTICAL_SHOW_DAYS = 25;
export const PRACTICAL_CONT_DAYS = 12;
export const PRACTICAL_MIN_TREND_PCT = 4;
export const PRACTICAL_MIN_CLARITY = 0.5;

/**
 * Try to pick a practical window from an injected stocks list (no gameState).
 * `rng` is `Math.random`-compatible for tests.
 * @returns {null | { stock, startIdx, shownData, correctCont }}
 */
export function pickPracticalWindow(stocks, {
    showDays = PRACTICAL_SHOW_DAYS,
    contDays = PRACTICAL_CONT_DAYS,
    minTrendPct = PRACTICAL_MIN_TREND_PCT,
    minClarity = PRACTICAL_MIN_CLARITY,
    maxAttempts = 80,
    rng = Math.random,
} = {}) {
    if (!stocks || stocks.length === 0) return null;
    const minLen = showDays + contDays + 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const stock = stocks[Math.floor(rng() * stocks.length)];
        if (!stock?.kline || stock.kline.length < minLen) continue;
        const startIdx = Math.floor(rng() * (stock.kline.length - showDays - contDays));
        const shownData = stock.kline.slice(startIdx, startIdx + showDays);
        const correctCont = stock.kline.slice(startIdx + showDays, startIdx + showDays + contDays);
        const ts = trendScore(correctCont);
        if (Math.abs(ts.pct) >= minTrendPct && ts.clarity >= minClarity) {
            return { stock, startIdx, shownData, correctCont };
        }
    }
    return null;
}
