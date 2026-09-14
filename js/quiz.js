// ========== QUIZ ENGINE ==========
import { gameState, quizState } from './state.js';
import { shuffleArray } from './utils.js';
import { applyChartTheme, onThemeChange, getTheme } from './theme.js';
import { QUIZ_PATTERNS } from './patterns.js';
import {
    trendScore,
    analyzeTechnical,
    normalizeContinuation,
    gradeQuizScore,
    createEmptyQuizSession,
    applyQuizAnswer,
    advanceQuizSession,
    buildQuizResultDetails,
    pickPracticalWindow,
} from './quiz-pure.js';
import {
    ensureEcharts,
    markChartLoading,
    clearChartLoading,
    markChartFailed,
} from './echarts-loader.js';

onThemeChange((theme) => {
    quizState.charts.forEach((c) => applyChartTheme(c, theme));
});


export function disposeQuizCharts() {
    quizState.charts.forEach(c => { if (c && !c.isDisposed()) c.dispose(); });
    quizState.charts = [];
}

// Theory question generators
function genSignalQuestion(pattern, allPatterns) {
    const q = '"' + pattern.name + '" 是什么信号？';
    const correct = pattern.signal;
    const allSignals = ['看涨', '看跌', '中性'];
    const wrong = allSignals.filter(s => s !== correct);
    const extras = ['反转信号', '突破信号', '持续信号'];
    wrong.push(extras[Math.floor(Math.random() * extras.length)]);
    return { type: 'theory_text', question: q, correct, wrongChoices: shuffleArray(wrong).slice(0, 3), explanation: '"' + pattern.name + '"是' + pattern.signal + '信号。' + pattern.desc };
}

function genWhichPatternQuestion(pattern, allPatterns) {
    if (pattern.signal === '中性') return null;
    const signalText = pattern.signal;
    const q = '以下哪个形态是' + signalText + '信号？';
    const wrongPatterns = allPatterns.filter(p => p.signal !== signalText && p.name !== pattern.name);
    if (wrongPatterns.length < 3) return null;
    return { type: 'theory_text', question: q, correct: pattern.name, wrongChoices: shuffleArray(wrongPatterns).slice(0, 3).map(p => p.name), explanation: '"' + pattern.name + '"是' + signalText + '信号。' + pattern.desc };
}

function genDescQuestion(pattern, allPatterns) {
    const firstSentence = pattern.desc.split('。')[0];
    const snippet = firstSentence.length > 40 ? firstSentence.substring(0, 40) + '...' : firstSentence;
    const q = '以下描述对应什么形态？"' + snippet + '"';
    const wrongPatterns = allPatterns.filter(p => p.name !== pattern.name);
    return { type: 'theory_text', question: q, correct: pattern.name, wrongChoices: shuffleArray(wrongPatterns).slice(0, 3).map(p => p.name), explanation: '这描述的是"' + pattern.name + '"。' + pattern.desc };
}

function genVisualQuestion(pattern, allPatterns) {
    const sameCategory = allPatterns.filter(p => p.category === pattern.category && p.name !== pattern.name);
    const others = sameCategory.length >= 3 ? sameCategory : allPatterns.filter(p => p.name !== pattern.name);
    return { type: 'theory_visual', illustHtml: pattern.illust, question: '这是什么形态？', correct: pattern.name, wrongChoices: shuffleArray(others).slice(0, 3).map(p => p.name), explanation: '这是"' + pattern.name + '"（' + pattern.signal + '）。' + pattern.desc };
}

function genPracticalQuestion(stocks = gameState.stocksData) {
    const picked = pickPracticalWindow(stocks);
    if (!picked) return null;
    const { stock, startIdx, shownData, correctCont } = picked;
    const lastClose = shownData[shownData.length - 1].close;

    const wrongConts = [];
    const used = new Set([stock.code + '-' + startIdx]);
    let wa = 0;
    const CONT_DAYS = correctCont.length;
    while (wrongConts.length < 3 && wa < 200) {
        wa++;
        const ws = stocks[Math.floor(Math.random() * stocks.length)];
        if (!ws?.kline || ws.kline.length < CONT_DAYS + 5) continue;
        const wi = Math.floor(Math.random() * (ws.kline.length - CONT_DAYS));
        const key = ws.code + '-' + wi;
        if (used.has(key)) continue;
        const wd = ws.kline.slice(wi, wi + CONT_DAYS);
        if (wd.length !== CONT_DAYS) continue;
        const wts = trendScore(wd);
        if (Math.abs(wts.pct) < 3) continue;
        used.add(key);
        wrongConts.push(wd);
    }
    if (wrongConts.length < 3) return null;

    const options = shuffleArray([
        { data: normalizeContinuation(correctCont, lastClose), isCorrect: true },
        ...wrongConts.map((d) => ({ data: normalizeContinuation(d, lastClose), isCorrect: false }))
    ]);
    const correctIndex = options.findIndex((o) => o.isCorrect);

    const labels = ['A', 'B', 'C', 'D'];
    const techAnalysis = analyzeTechnical(shownData, correctCont);
    return {
        type: 'practical',
        question: '观察下方K线走势，接下来的走势大概是什么样？',
        shownData, options, correctIndex,
        explanation: '正确答案是选项 ' + labels[correctIndex] + '。这是 ' + stock.name + '（' + stock.code + '）在 ' + shownData[0].date + ' ~ ' + shownData[shownData.length - 1].date + ' 之后的真实走势。<br><br><strong>技术面分析：</strong>' + techAnalysis
    };
}

export function startQuiz() {
    disposeQuizCharts();
    const fresh = createEmptyQuizSession();
    quizState.questions = fresh.questions;
    quizState.currentIndex = fresh.currentIndex;
    quizState.score = fresh.score;
    quizState.answers = fresh.answers;
    quizState.answered = fresh.answered;
    quizState.charts = [];

    const stocks = gameState.stocksData || [];
    const allP = QUIZ_PATTERNS;
    const shuffledP = shuffleArray([...allP]);
    const theoryCount = 5 + Math.floor(Math.random() * 2);
    const practicalCount = 10 - theoryCount;

    for (let i = 0; i < theoryCount && i < shuffledP.length; i++) {
        const p = shuffledP[i];
        if (Math.random() < 0.8) {
            quizState.questions.push(genVisualQuestion(p, allP));
        } else {
            const q = genWhichPatternQuestion(p, allP);
            quizState.questions.push(q || genVisualQuestion(p, allP));
        }
    }

    for (let i = 0; i < practicalCount; i++) {
        const pq = genPracticalQuestion(stocks);
        if (pq) quizState.questions.push(pq);
    }

    let pi = theoryCount;
    while (quizState.questions.length < 10 && pi < shuffledP.length) {
        quizState.questions.push(genVisualQuestion(shuffledP[pi], allP));
        pi++;
    }
    quizState.questions = shuffleArray(quizState.questions).slice(0, 10);
    renderQuestion();
}

function renderMiniKline(chart, data, isMini) {
    const ohlc = data.map(d => [d.open, d.close, d.low, d.high]);
    const dayLabels = data.map((_, i) => String(i + 1));

    function calcMaLine(period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
            result.push(+(sum / period).toFixed(2));
        }
        return result;
    }

    const series = [{
        type: 'candlestick', data: ohlc,
        itemStyle: { color: '#e05252', color0: '#3db86a', borderColor: '#e05252', borderColor0: '#3db86a' }
    }];

    const legendData = [];
    if (!isMini) {
        const ma5 = calcMaLine(5);
        const ma10 = calcMaLine(10);
        const ma20 = calcMaLine(20);
        series.push(
            { name: '5日线', type: 'line', data: ma5, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#f5c542' } },
            { name: '10日线', type: 'line', data: ma10, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#42a5f5' } },
            { name: '20日线', type: 'line', data: ma20, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#ab47bc' } }
        );
        legendData.push('5日线', '10日线', '20日线');
    }

    chart.setOption({
        backgroundColor: 'transparent', animation: false,
        legend: !isMini ? { data: legendData, top: 0, right: 0, textStyle: { color: '#6b6660', fontSize: 10 }, itemWidth: 14, itemHeight: 2 } : undefined,
        grid: { left: isMini ? '2%' : '10%', right: '2%', top: isMini ? '8%' : '28px', bottom: isMini ? '2%' : '18%', containLabel: !isMini },
        tooltip: isMini ? undefined : {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: (params) => {
                const p = params.find(x => x.seriesType === 'candlestick') || params[0];
                if (!p) return '';
                const kd = data[p.dataIndex];
                return kd ? kd.date : '';
            }
        },
        xAxis: {
            type: 'category', data: dayLabels,
            axisLabel: { show: !isMini, fontSize: 9, color: '#6b6660', rotate: 0 },
            axisLine: { lineStyle: { color: 'rgba(200,164,78,0.15)' } },
            axisTick: { show: false }, splitLine: { show: false }
        },
        yAxis: {
            type: 'value', scale: true,
            axisLabel: { show: !isMini, fontSize: 9, color: '#6b6660' },
            axisLine: { show: false },
            splitLine: { show: !isMini, lineStyle: { color: 'rgba(200,164,78,0.05)' } }
        },
        series: series
    });
}

export function renderQuestion() {
    const q = quizState.questions[quizState.currentIndex];
    const idx = quizState.currentIndex;
    const container = document.getElementById('quizQuestionContainer');
    const labels = ['A', 'B', 'C', 'D'];

    if (q.type !== 'practical') {
        const all = [q.correct, ...q.wrongChoices.slice(0, 3)];
        q._options = shuffleArray(all);
    }

    let html = '';
    if (q.type === 'theory_text') {
        html = '<span class="quiz-question-type theory">理论题</span>' +
            '<div class="quiz-question-text">第 ' + (idx+1) + ' 题：' + q.question + '</div>' +
            '<div class="quiz-options">' + q._options.map((opt, i) =>
                '<div class="quiz-option" data-index="' + i + '" onclick="selectAnswer(' + i + ')">' +
                '<div class="quiz-option-label">' + labels[i] + '</div>' +
                '<div class="quiz-option-text">' + opt + '</div></div>'
            ).join('') + '</div>';
    } else if (q.type === 'theory_visual') {
        html = '<span class="quiz-question-type theory">理论题 · 看图识形</span>' +
            '<div class="quiz-question-text">第 ' + (idx+1) + ' 题：' + q.question + '</div>' +
            '<div class="quiz-pattern-display">' + q.illustHtml + '</div>' +
            '<div class="quiz-options">' + q._options.map((opt, i) =>
                '<div class="quiz-option" data-index="' + i + '" onclick="selectAnswer(' + i + ')">' +
                '<div class="quiz-option-label">' + labels[i] + '</div>' +
                '<div class="quiz-option-text">' + opt + '</div></div>'
            ).join('') + '</div>';
    } else if (q.type === 'practical') {
        html = '<span class="quiz-question-type practical">实操题</span>' +
            '<div class="quiz-question-text">第 ' + (idx+1) + ' 题：' + q.question + '</div>' +
            '<div class="quiz-kline-display" id="quizMainChart"></div>' +
            '<div class="quiz-options">' + q.options.map((opt, i) =>
                '<div class="quiz-option" data-index="' + i + '" onclick="selectAnswer(' + i + ')">' +
                '<div class="quiz-option-label">' + labels[i] + '</div>' +
                '<div class="quiz-option-chart" id="quizOptChart' + i + '"></div></div>'
            ).join('') + '</div>';
    }
    container.innerHTML = html;

    document.getElementById('quizProgressBar').style.width = ((idx + 1) / 10 * 100) + '%';
    document.getElementById('quizProgressText').textContent = (idx + 1) + ' / 10';
    document.getElementById('quizNextBtn').disabled = true;
    document.getElementById('quizNextBtn').textContent = idx === 9 ? '查看成绩' : '下一题';
    quizState.answered = false;

    if (q.type === 'practical') {
        setTimeout(() => {
            void (async function () {
                const hosts = [];
                const mainDom = document.getElementById('quizMainChart');
                if (mainDom) hosts.push(mainDom);
                q.options.forEach((_, i) => {
                    const dom = document.getElementById('quizOptChart' + i);
                    if (dom) hosts.push(dom);
                });
                hosts.forEach((dom) => markChartLoading(dom));
                let echartsApi;
                try {
                    echartsApi = await ensureEcharts();
                } catch (err) {
                    console.error('ECharts unavailable for quiz charts', err);
                    hosts.forEach((dom) => markChartFailed(dom, '图表加载失败'));
                    return;
                }
                hosts.forEach((dom) => clearChartLoading(dom));
                if (mainDom) {
                    const mc = echartsApi.init(mainDom);
                    quizState.charts.push(mc);
                    renderMiniKline(mc, q.shownData, false);
                    applyChartTheme(mc, getTheme());
                }
                q.options.forEach((opt, i) => {
                    const dom = document.getElementById('quizOptChart' + i);
                    if (dom) {
                        const c = echartsApi.init(dom);
                        quizState.charts.push(c);
                        renderMiniKline(c, opt.data, true);
                        applyChartTheme(c, getTheme());
                    }
                });
            })();
        }, 50);
    }
}

export function selectAnswer(optionIndex) {
    const patch = applyQuizAnswer(quizState, optionIndex);
    if (!patch.ok) return;
    quizState.answered = patch.answered;
    quizState.answers = patch.answers;
    quizState.score = patch.score;
    const isCorrect = patch.isCorrect;
    const q = quizState.questions[quizState.currentIndex];

    document.querySelectorAll('.quiz-option').forEach((el, i) => {
        el.style.pointerEvents = 'none';
        if (q.type === 'practical') {
            if (i === q.correctIndex) el.classList.add('correct');
            if (i === optionIndex && !isCorrect) el.classList.add('wrong');
        } else {
            if (q._options[i] === q.correct) el.classList.add('correct');
            if (i === optionIndex && !isCorrect) el.classList.add('wrong');
        }
    });

    if (!isCorrect) {
        document.getElementById('quizQuestionContainer').insertAdjacentHTML('beforeend',
            '<div class="quiz-explanation"><strong>回答错误。</strong><br>' + q.explanation + '</div>');
    }

    document.getElementById('quizNextBtn').disabled = false;
}

export function quizNext() {
    const next = advanceQuizSession(quizState, { lastIndex: 9 });
    if (next.done) { showQuizResults(); return; }
    quizState.currentIndex = next.currentIndex;
    quizState.answered = next.answered;
    renderQuestion();
}

export function showQuizResults() {
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'block';
    disposeQuizCharts();

    const score = quizState.score;
    const { scoreCls, comment } = gradeQuizScore(score, 10);

    document.getElementById('quizResultCard').innerHTML =
        '<h2 style="font-family:\'Bodoni Moda\',serif;font-size:1.2rem;color:var(--accent-cyan);letter-spacing:0.1em;margin:0 0 8px">训练结果</h2>' +
        '<div class="quiz-score ' + scoreCls + '">' + score + ' / 10</div>' +
        '<p style="color:var(--text-secondary);font-size:0.92rem;margin:12px 0 0">' + comment + '</p>';

    const details = buildQuizResultDetails(quizState);
    let detailsHtml = '';
    details.forEach((row) => {
        const icon = row.isCorrect ? '&#10003;' : '&#10007;';
        const color = row.isCorrect ? '#3db86a' : '#e05252';

        detailsHtml += '<div class="quiz-result-item ' + (row.isCorrect ? 'correct-item' : 'wrong') + '">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
            '<span style="font-family:\'JetBrains Mono\';font-weight:700;color:' + color + ';font-size:1.1rem">' + icon + '</span>' +
            '<span style="font-size:0.82rem;color:var(--text-muted)">' + row.typeName + ' · 第 ' + (row.index + 1) + ' 题</span></div>' +
            '<div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:8px">' + row.question + '</div>';
        if (!row.isCorrect) {
            detailsHtml += '<div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:4px">' +
                '你的答案：<span style="color:#e05252">' + row.userText + '</span> | ' +
                '正确答案：<span style="color:#3db86a">' + row.correctText + '</span></div>' +
                '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;margin-top:6px">' + row.explanation + '</div>';
        }
        detailsHtml += '</div>';
    });
    document.getElementById('quizResultDetails').innerHTML = detailsHtml;
}
