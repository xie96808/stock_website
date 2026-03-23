// ========== QUIZ ENGINE ==========
import { gameState, quizState } from './state.js';
import { shuffleArray, applyChartTheme } from './utils.js';
import { QUIZ_PATTERNS } from './patterns.js';

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

// Technical analysis for practical questions
function analyzeTechnical(shownData, correctCont) {
    const all = shownData.concat(correctCont);
    const n = shownData.length;

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

    const closes = all.map(d => d.close);
    const ma5 = sma(all, 5);
    const ma10 = sma(all, 10);
    const ma20 = sma(all, 20);

    const parts = [];

    const last5 = shownData.slice(-5);
    const priceChange5 = ((last5[last5.length-1].close - last5[0].close) / last5[0].close * 100).toFixed(2);
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

    const recentVol = last5.map(d => d.volume);
    const prevVol = shownData.slice(-10, -5).map(d => d.volume);
    if (prevVol.length >= 3) {
        const avgRecent = recentVol.reduce((a,b) => a+b, 0) / recentVol.length;
        const avgPrev = prevVol.reduce((a,b) => a+b, 0) / prevVol.length;
        const volRatio = avgRecent / avgPrev;
        if (volRatio > 1.5) parts.push('近期成交量明显放大（较前期增加' + ((volRatio-1)*100).toFixed(0) + '%），资金活跃');
        else if (volRatio < 0.6) parts.push('近期成交量大幅萎缩（较前期减少' + ((1-volRatio)*100).toFixed(0) + '%），观望情绪浓');
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

    const contChange = ((correctCont[correctCont.length-1].close - correctCont[0].open) / correctCont[0].open * 100).toFixed(2);
    const contWord = contChange > 2 ? '上涨' : contChange < -2 ? '下跌' : '震荡';
    parts.push('实际后续走势：' + contWord + '（' + (contChange > 0 ? '+' : '') + contChange + '%）');

    const contUpDays = correctCont.filter(d => d.close >= d.open).length;
    const contDownDays = correctCont.length - contUpDays;
    parts.push('后续' + correctCont.length + '个交易日中，' + contUpDays + '天收阳、' + contDownDays + '天收阴');

    return parts.join('；') + '。';
}

function trendScore(data) {
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

function genPracticalQuestion() {
    const stocks = gameState.stocksData;
    if (!stocks || stocks.length === 0) return null;
    const SHOW_DAYS = 25, CONT_DAYS = 12;
    const minLen = SHOW_DAYS + CONT_DAYS + 5;
    const MIN_TREND_PCT = 4;
    const MIN_CLARITY = 0.5;

    let stock, startIdx, shownData, correctCont;
    let found = false;
    for (let attempt = 0; attempt < 80; attempt++) {
        stock = stocks[Math.floor(Math.random() * stocks.length)];
        if (stock.kline.length < minLen) continue;
        startIdx = Math.floor(Math.random() * (stock.kline.length - SHOW_DAYS - CONT_DAYS));
        const sd = stock.kline.slice(startIdx, startIdx + SHOW_DAYS);
        const cc = stock.kline.slice(startIdx + SHOW_DAYS, startIdx + SHOW_DAYS + CONT_DAYS);
        const ts = trendScore(cc);
        if (Math.abs(ts.pct) >= MIN_TREND_PCT && ts.clarity >= MIN_CLARITY) {
            shownData = sd;
            correctCont = cc;
            found = true;
            break;
        }
    }
    if (!found) return null;

    const lastClose = shownData[shownData.length - 1].close;

    function normalize(data) {
        const ratio = lastClose / data[0].open;
        return data.map(d => ({
            date: d.date,
            open: +(d.open * ratio).toFixed(2), close: +(d.close * ratio).toFixed(2),
            high: +(d.high * ratio).toFixed(2), low: +(d.low * ratio).toFixed(2),
            volume: d.volume
        }));
    }

    const correctDir = trendScore(correctCont).pct > 0 ? 'up' : 'down';
    const wrongConts = [];
    const used = new Set([stock.code + '-' + startIdx]);
    let wa = 0;
    while (wrongConts.length < 3 && wa < 200) {
        wa++;
        const ws = stocks[Math.floor(Math.random() * stocks.length)];
        if (ws.kline.length < CONT_DAYS + 5) continue;
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
        { data: normalize(correctCont), isCorrect: true },
        ...wrongConts.map(d => ({ data: normalize(d), isCorrect: false }))
    ]);
    const correctIndex = options.findIndex(o => o.isCorrect);

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
    quizState.questions = [];
    quizState.currentIndex = 0;
    quizState.score = 0;
    quizState.answers = [];
    quizState.answered = false;
    quizState.charts = [];

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
        const pq = genPracticalQuestion();
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
    const dates = data.map(d => d.date);

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
            { name: 'MA5', type: 'line', data: ma5, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#f5c542' } },
            { name: 'MA10', type: 'line', data: ma10, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#42a5f5' } },
            { name: 'MA20', type: 'line', data: ma20, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#ab47bc' } }
        );
        legendData.push('MA5', 'MA10', 'MA20');
    }

    chart.setOption({
        backgroundColor: 'transparent', animation: false,
        legend: !isMini ? { data: legendData, top: 0, right: 0, textStyle: { color: '#6b6660', fontSize: 10 }, itemWidth: 14, itemHeight: 2 } : undefined,
        grid: { left: isMini ? '2%' : '10%', right: '2%', top: isMini ? '8%' : '28px', bottom: isMini ? '2%' : '18%', containLabel: !isMini },
        tooltip: isMini ? undefined : { trigger: 'axis', axisPointer: { type: 'cross' } },
        xAxis: {
            type: 'category', data: dates,
            axisLabel: { show: !isMini, fontSize: 9, color: '#6b6660', rotate: 45 },
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
            const mainDom = document.getElementById('quizMainChart');
            if (mainDom) {
                const mc = echarts.init(mainDom);
                quizState.charts.push(mc);
                renderMiniKline(mc, q.shownData, false);
                applyChartTheme(mc);
            }
            q.options.forEach((opt, i) => {
                const dom = document.getElementById('quizOptChart' + i);
                if (dom) {
                    const c = echarts.init(dom);
                    quizState.charts.push(c);
                    renderMiniKline(c, opt.data, true);
                    applyChartTheme(c);
                }
            });
        }, 50);
    }
}

export function selectAnswer(optionIndex) {
    if (quizState.answered) return;
    quizState.answered = true;
    quizState.answers[quizState.currentIndex] = optionIndex;

    const q = quizState.questions[quizState.currentIndex];
    let isCorrect = false;

    if (q.type === 'practical') {
        isCorrect = optionIndex === q.correctIndex;
    } else {
        isCorrect = q._options[optionIndex] === q.correct;
    }
    if (isCorrect) quizState.score++;

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
    if (quizState.currentIndex >= 9) { showQuizResults(); return; }
    quizState.currentIndex++;
    renderQuestion();
}

export function showQuizResults() {
    document.getElementById('trainingZone').style.display = 'none';
    document.getElementById('trainingResults').style.display = 'block';
    disposeQuizCharts();

    const score = quizState.score;
    let scoreCls, comment;
    if (score >= 8) { scoreCls = 'high'; comment = '你的炒股知识非常扎实，可以去实战中检验了！'; }
    else if (score >= 5) { scoreCls = 'medium'; comment = '基础还不错，但还需要加强学习。建议去知识区复习薄弱环节。'; }
    else { scoreCls = 'low'; comment = '还需要多多学习哦！建议先去知识区系统学习各种形态。'; }

    document.getElementById('quizResultCard').innerHTML =
        '<h2 style="font-family:\'Bodoni Moda\',serif;font-size:1.2rem;color:var(--accent-cyan);letter-spacing:0.1em;margin:0 0 8px">训练结果</h2>' +
        '<div class="quiz-score ' + scoreCls + '">' + score + ' / 10</div>' +
        '<p style="color:var(--text-secondary);font-size:0.92rem;margin:12px 0 0">' + comment + '</p>';

    const labels = ['A', 'B', 'C', 'D'];
    let detailsHtml = '';
    quizState.questions.forEach((q, i) => {
        const userAns = quizState.answers[i];
        let isCorrect, userText, correctText;
        if (q.type === 'practical') {
            isCorrect = userAns === q.correctIndex;
            userText = userAns !== undefined ? labels[userAns] : '未作答';
            correctText = labels[q.correctIndex];
        } else {
            isCorrect = q._options && q._options[userAns] === q.correct;
            userText = userAns !== undefined && q._options ? q._options[userAns] : '未作答';
            correctText = q.correct;
        }
        const typeName = q.type === 'practical' ? '实操题' : '理论题';
        const icon = isCorrect ? '&#10003;' : '&#10007;';
        const color = isCorrect ? '#3db86a' : '#e05252';

        detailsHtml += '<div class="quiz-result-item ' + (isCorrect ? 'correct-item' : 'wrong') + '">' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
            '<span style="font-family:\'JetBrains Mono\';font-weight:700;color:' + color + ';font-size:1.1rem">' + icon + '</span>' +
            '<span style="font-size:0.82rem;color:var(--text-muted)">' + typeName + ' · 第 ' + (i+1) + ' 题</span></div>' +
            '<div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:8px">' + q.question + '</div>';
        if (!isCorrect) {
            detailsHtml += '<div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:4px">' +
                '你的答案：<span style="color:#e05252">' + userText + '</span> | ' +
                '正确答案：<span style="color:#3db86a">' + correctText + '</span></div>' +
                '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;margin-top:6px">' + q.explanation + '</div>';
        }
        detailsHtml += '</div>';
    });
    document.getElementById('quizResultDetails').innerHTML = detailsHtml;
}
