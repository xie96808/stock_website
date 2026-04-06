// ========== TECHNICAL ANALYSIS ==========
import { gameState } from './state.js';
import { calculateMA } from './utils.js';
import { kbTag } from './patterns.js';

function calcMA(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) { result.push(null); continue; }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        result.push(sum / period);
    }
    return result;
}

function calcSlope(arr, start, end) {
    const seg = arr.slice(start, end).filter(v => v !== null);
    if (seg.length < 2) return 0;
    const n = seg.length;
    const mean = seg.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - (n - 1) / 2) * (seg[i] - mean);
        den += (i - (n - 1) / 2) ** 2;
    }
    return den === 0 ? 0 : (num / den) / mean;
}

export function generateKlineAnalysis() {
    const histLen = gameState.historyLength;
    const kline = gameState.gameKline;
    const gameDays = 30;
    const gameData = kline.slice(histLen, histLen + gameDays);

    const closes = gameData.map(d => d.close);
    const highs = gameData.map(d => d.high);
    const lows = gameData.map(d => d.low);
    const volumes = gameData.map(d => d.volume);

    const allData = kline.slice(0, histLen + gameDays);
    const ma5 = calcMA(allData, 5);
    const ma10 = calcMA(allData, 10);
    const ma20 = calcMA(allData, 20);

    const gma5 = ma5.slice(histLen);
    const gma10 = ma10.slice(histLen);
    const gma20 = ma20.slice(histLen);

    // === Trend analysis ===
    const firstClose = closes[0];
    const lastClose = closes[gameDays - 1];
    const periodReturn = (lastClose - firstClose) / firstClose * 100;

    const slope = calcSlope(gameData, 0, gameDays);
    let trend, trendCls;
    if (slope > 0.002) { trend = '上行趋势'; trendCls = 'up'; }
    else if (slope < -0.002) { trend = '下行趋势'; trendCls = 'down'; }
    else { trend = '横盘震荡'; trendCls = 'neutral'; }

    // === Volatility ===
    const avgRange = gameData.reduce((s, d) => s + (d.high - d.low) / d.close, 0) / gameDays;
    let volatility, volCls;
    if (avgRange > 0.04) { volatility = '高波动'; volCls = 'up'; }
    else if (avgRange > 0.02) { volatility = '中等波动'; volCls = 'info'; }
    else { volatility = '低波动'; volCls = 'neutral'; }

    // === MA alignment ===
    const endMa5 = gma5[gameDays - 1];
    const endMa10 = gma10[gameDays - 1];
    const endMa20 = gma20[gameDays - 1];
    let maAlignment, maCls;
    if (endMa5 && endMa10 && endMa20) {
        if (endMa5 > endMa10 && endMa10 > endMa20) { maAlignment = '多头排列'; maCls = 'up'; }
        else if (endMa5 < endMa10 && endMa10 < endMa20) { maAlignment = '空头排列'; maCls = 'down'; }
        else { maAlignment = '均线缠绕'; maCls = 'neutral'; }
    } else { maAlignment = '数据不足'; maCls = 'neutral'; }

    // === Volume trend ===
    const vol1 = volumes.slice(0, Math.floor(gameDays / 2));
    const vol2 = volumes.slice(Math.floor(gameDays / 2));
    const avgVol1 = vol1.reduce((a, b) => a + b, 0) / vol1.length;
    const avgVol2 = vol2.reduce((a, b) => a + b, 0) / vol2.length;
    let volTrend;
    if (avgVol2 > avgVol1 * 1.3) volTrend = '后半段放量';
    else if (avgVol2 < avgVol1 * 0.7) volTrend = '后半段缩量';
    else volTrend = '成交量平稳';

    // === T+0 suitability ===
    const dailySwings = gameData.map(d => (d.high - d.low) / d.close * 100);
    const avgSwing = dailySwings.reduce((a, b) => a + b, 0) / gameDays;
    let tSuitability;
    if (avgSwing > 4 && trend === '横盘震荡') tSuitability = '适合做T';
    else if (avgSwing > 3) tSuitability = '可尝试做T';
    else tSuitability = '不太适合做T';

    // === Support / Resistance ===
    const minPrice = Math.min(...lows);
    const maxPrice = Math.max(...highs);

    // === Generate text ===
    const tags = [
        { text: trend, cls: trendCls },
        { text: volatility, cls: volCls },
        { text: maAlignment, cls: maCls },
        { text: `${periodReturn >= 0 ? '+' : ''}${periodReturn.toFixed(1)}%`, cls: periodReturn > 0 ? 'up' : periodReturn < 0 ? 'down' : 'neutral' }
    ];

    let analysis = '';

    // Trend paragraph
    if (trendCls === 'up') {
        analysis += `<p>该波段整体呈<strong>上行趋势</strong>，区间涨幅 ${periodReturn.toFixed(2)}%。`;
        if (maCls === 'up') analysis += `均线呈多头排列（MA5 > MA10 > MA20），趋势信号明确，适合顺势持股。`;
        else analysis += `但均线${maAlignment}，上行动力存在分歧，追高需谨慎。`;
        analysis += `</p>`;
    } else if (trendCls === 'down') {
        analysis += `<p>该波段整体呈<strong>下行趋势</strong>，区间跌幅 ${periodReturn.toFixed(2)}%。`;
        if (maCls === 'down') analysis += `均线呈空头排列（MA5 < MA10 < MA20），下行压力较大，宜观望或轻仓试探反弹。`;
        else analysis += `均线${maAlignment}，可能存在阶段性反弹机会，但需注意控制仓位。`;
        analysis += `</p>`;
    } else {
        analysis += `<p>该波段呈<strong>横盘震荡</strong>格局，区间涨跌幅仅 ${periodReturn.toFixed(2)}%。`;
        analysis += `价格在 ${minPrice.toFixed(2)} ~ ${maxPrice.toFixed(2)} 区间内波动，没有明确的趋势方向。`;
        analysis += `</p>`;
    }

    // Volume & T
    analysis += `<p>成交量方面，${volTrend}。`;
    if (volTrend === '后半段放量' && trendCls === 'up') analysis += `放量上涨是健康的量价配合，说明资金认可当前趋势。`;
    else if (volTrend === '后半段放量' && trendCls === 'down') analysis += `放量下跌说明抛压较重，需警惕进一步调整。`;
    else if (volTrend === '后半段缩量' && trendCls === 'up') analysis += `缩量上涨需关注上方压力，量价背离可能预示回调。`;
    else if (volTrend === '后半段缩量' && trendCls === 'down') analysis += `缩量下跌说明抛压衰减，可能接近底部区域。`;
    analysis += `</p>`;

    analysis += `<p>日均振幅 ${avgSwing.toFixed(2)}%，${tSuitability}。`;
    if (tSuitability === '适合做T') analysis += `震荡区间明确，可在支撑位附近低吸、压力位附近高抛来降低持仓成本。`;
    else if (tSuitability === '可尝试做T') analysis += `波动空间尚可，但需注意判断日内高低点，避免做反方向。`;
    else analysis += `振幅较小，日内差价空间有限，频繁操作反而容易增加摩擦成本。`;
    analysis += `</p>`;

    // Entry/exit suggestion
    if (trendCls === 'up' && maCls === 'up') {
        analysis += `<p><strong>操作建议：</strong>趋势向上且均线多头排列，适合在回踩均线支撑时买入持有，不宜频繁做空。</p>`;
    } else if (trendCls === 'down' && maCls === 'down') {
        analysis += `<p><strong>操作建议：</strong>趋势向下且均线空头排列，以观望为主。如需操作，建议在超跌反弹至均线压力位时轻仓短线。</p>`;
    } else {
        analysis += `<p><strong>操作建议：</strong>趋势不明朗，适合区间操作策略 —— 在区间下沿（${minPrice.toFixed(2)} 附近）分批低吸，在区间上沿（${maxPrice.toFixed(2)} 附近）逢高减仓。</p>`;
    }

    document.getElementById('klineAnalysis').innerHTML = `
        <div class="analysis-title">波段分析</div>
        <div class="trend-tags">${tags.map(t => `<span class="trend-tag ${t.cls}">${t.text}</span>`).join('')}</div>
        <div class="analysis-text">${analysis}</div>
    `;
}

export function generateBestPoints() {
    const histLen = gameState.historyLength;
    const kline = gameState.gameKline;
    const gameDays = 30;

    const allData = kline.slice(0, histLen + gameDays);
    const ma5 = calcMA(allData, 5);
    const ma10 = calcMA(allData, 10);
    const ma20 = calcMA(allData, 20);

    const gameData = kline.slice(histLen, histLen + gameDays);
    const closes = gameData.map(d => d.close);
    const volumes = gameData.map(d => d.volume);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / gameDays;

    const buyScores = [];
    const sellScores = [];

    for (let i = 0; i < gameDays; i++) {
        const gi = histLen + i;
        const d = gameData[i];
        let buyScore = 0;
        let sellScore = 0;
        const buyReasons = [];
        const sellReasons = [];

        const m5 = ma5[gi], m10 = ma10[gi], m20 = ma20[gi];
        const pm5 = i > 0 ? ma5[gi - 1] : null;
        const pm10 = i > 0 ? ma10[gi - 1] : null;
        const pm20 = i > 0 ? ma20[gi - 1] : null;

        // 1. Price near support (near recent lows)
        const localMin = Math.min(...gameData.slice(Math.max(0, i - 10), i + 1).map(x => x.low));
        const localMax = Math.max(...gameData.slice(Math.max(0, i - 10), i + 1).map(x => x.high));

        if (d.low <= localMin * 1.005) {
            buyScore += 3;
            buyReasons.push({ tag: '支撑', text: `触及近期低点支撑位 ${localMin.toFixed(2)}` });
        }
        if (d.high >= localMax * 0.995) {
            sellScore += 3;
            sellReasons.push({ tag: '压力', text: `触及近期高点压力位 ${localMax.toFixed(2)}` });
        }

        // 2. MA golden cross / death cross
        if (m5 && m10 && pm5 && pm10) {
            if (pm5 <= pm10 && m5 > m10) {
                buyScore += 4;
                buyReasons.push({ tag: '金叉', text: 'MA5 上穿 MA10 形成金叉，短期趋势转多' });
            }
            if (pm5 >= pm10 && m5 < m10) {
                sellScore += 4;
                sellReasons.push({ tag: '死叉', text: 'MA5 下穿 MA10 形成死叉，短期趋势转空' });
            }
        }

        if (m5 && m20 && pm5 && pm20) {
            if (pm5 <= pm20 && m5 > m20) {
                buyScore += 3;
                buyReasons.push({ tag: '金叉', text: 'MA5 上穿 MA20，中期趋势向好' });
            }
            if (pm5 >= pm20 && m5 < m20) {
                sellScore += 3;
                sellReasons.push({ tag: '死叉', text: 'MA5 下穿 MA20，中期趋势走弱' });
            }
        }

        // 3. Price bouncing off MA support / hitting MA resistance
        if (m20 && d.low <= m20 * 1.01 && d.close > m20 && d.close > d.open) {
            buyScore += 3;
            buyReasons.push({ tag: '均线支撑', text: `回踩 MA20（${m20.toFixed(2)}）后收阳，获得均线支撑` });
        }
        if (m10 && d.low <= m10 * 1.01 && d.close > m10 && d.close > d.open) {
            buyScore += 2;
            buyReasons.push({ tag: '均线支撑', text: `回踩 MA10（${m10.toFixed(2)}）后企稳` });
        }
        if (m20 && d.high >= m20 * 0.99 && d.close < m20 && d.close < d.open) {
            sellScore += 3;
            sellReasons.push({ tag: '均线压力', text: `上冲 MA20（${m20.toFixed(2)}）后受阻回落` });
        }

        // 4. Volume breakout
        if (volumes[i] > avgVol * 1.8 && d.close > d.open) {
            buyScore += 2;
            buyReasons.push({ tag: '放量', text: `成交量达均量 ${(volumes[i] / avgVol).toFixed(1)} 倍，放量阳线突破` });
        }
        if (volumes[i] > avgVol * 1.8 && d.close < d.open) {
            sellScore += 2;
            sellReasons.push({ tag: '放量', text: `放量阴线（${(volumes[i] / avgVol).toFixed(1)} 倍均量），抛压涌出` });
        }

        // 5. Candlestick patterns
        const bodyRatio = Math.abs(d.close - d.open) / (d.high - d.low || 0.01);
        const lowerShadow = Math.min(d.open, d.close) - d.low;
        const upperShadow = d.high - Math.max(d.open, d.close);
        const bodySize = Math.abs(d.close - d.open);

        if (d.close > d.open && bodySize / d.close > 0.03 && bodyRatio > 0.7) {
            buyScore += 2;
            buyReasons.push({ tag: '形态', text: '出现' + kbTag('大阳线') + '，多方力量强劲，买盘推升明显' });
        }
        if (d.close < d.open && bodySize / d.close > 0.03 && bodyRatio > 0.7) {
            sellScore += 2;
            sellReasons.push({ tag: '形态', text: '出现' + kbTag('大阴线') + '，空方力量占优，卖盘压制明显' });
        }

        if (lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5 && i > 2) {
            const prevDown = closes[i - 1] < closes[Math.max(0, i - 3)];
            if (prevDown) {
                buyScore += 3;
                buyReasons.push({ tag: '形态', text: '下跌后出现' + kbTag('锤子线') + '，下影线较长，空方力量衰竭' });
            }
        }
        if (upperShadow > bodySize * 2 && lowerShadow < bodySize * 0.5 && i > 2) {
            const prevUp = closes[i - 1] > closes[Math.max(0, i - 3)];
            if (prevUp) {
                sellScore += 3;
                sellReasons.push({ tag: '形态', text: '上涨后出现' + kbTag('射击之星') + '，上影线较长，多方力量受阻' });
            }
        }

        if (bodyRatio < 0.1 && (d.high - d.low) > 0 && i > 2) {
            const prevUp = closes[i - 1] > closes[Math.max(0, i - 3)];
            const prevDown = closes[i - 1] < closes[Math.max(0, i - 3)];
            if (prevUp) {
                sellScore += 2;
                sellReasons.push({ tag: '形态', text: '上涨后出现' + kbTag('十字星') + '，多空力量达到平衡，需警惕趋势反转' });
            }
            if (prevDown) {
                buyScore += 2;
                buyReasons.push({ tag: '形态', text: '下跌后出现' + kbTag('十字星') + '，多空力量达到平衡，可能预示底部反转' });
            }
        }

        if (i > 0) {
            const prev = gameData[i - 1];
            if (prev.close < prev.open && d.close > d.open && d.close > prev.open && d.open < prev.close) {
                buyScore += 3;
                buyReasons.push({ tag: '形态', text: kbTag('看涨吞没') + '形态（阳包阴），多方强力反攻' });
            }
            if (prev.close > prev.open && d.close < d.open && d.close < prev.open && d.open > prev.close) {
                sellScore += 3;
                sellReasons.push({ tag: '形态', text: kbTag('看跌吞没') + '形态（阴包阳），空方占据主导' });
            }
        }

        if (i >= 3) {
            const consDown = closes[i - 3] > closes[i - 2] && closes[i - 2] > closes[i - 1] && closes[i - 1] > d.close;
            if (consDown) {
                buyScore += 2;
                buyReasons.push({ tag: '超跌', text: '连续4日下跌，短线超跌，存在技术性反弹需求' });
            }
            const consUp = closes[i - 3] < closes[i - 2] && closes[i - 2] < closes[i - 1] && closes[i - 1] < d.close;
            if (consUp) {
                sellScore += 2;
                sellReasons.push({ tag: '超涨', text: '连续4日上涨，短线涨幅过大，注意获利回吐压力' });
            }
        }

        if (m5 && m10 && m20 && m5 > m10 && m10 > m20 && d.close > d.open) {
            buyScore += 1;
            if (!buyReasons.find(r => r.tag === '趋势')) {
                buyReasons.push({ tag: '趋势', text: '均线多头排列，趋势向上，顺势做多' });
            }
        }
        if (m5 && m10 && m20 && m5 < m10 && m10 < m20 && d.close < d.open) {
            sellScore += 1;
            if (!sellReasons.find(r => r.tag === '趋势')) {
                sellReasons.push({ tag: '趋势', text: '均线空头排列，趋势向下，宜离场观望' });
            }
        }

        if (buyReasons.length > 0) buyScores.push({ day: i + 1, score: buyScore, reasons: buyReasons, price: d.close, date: d.date });
        if (sellReasons.length > 0) sellScores.push({ day: i + 1, score: sellScore, reasons: sellReasons, price: d.close, date: d.date });
    }

    buyScores.sort((a, b) => b.score - a.score);
    sellScores.sort((a, b) => b.score - a.score);

    const topBuys = buyScores.slice(0, 3);
    const topSells = sellScores.slice(0, 3);

    gameState.bestPoints = { buys: topBuys, sells: topSells };
}

export function generateBSReport() {
    const histLen = gameState.historyLength;
    const kline = gameState.gameKline;
    const trades = gameState.tradeHistory;
    const gameDays = 30;

    let bestBuyDay = 0, bestSellDay = 0, bestProfit = 0;
    for (let i = 0; i < gameDays - 1; i++) {
        for (let j = i + 2; j < gameDays; j++) {
            const buyPrice = kline[histLen + i + 1].open;
            const sellPrice = kline[histLen + j + 1] ? kline[histLen + j + 1].open : kline[histLen + j].close;
            const profit = (sellPrice - buyPrice) / buyPrice;
            if (profit > bestProfit) {
                bestProfit = profit;
                bestBuyDay = i + 1;
                bestSellDay = j + 1;
            }
        }
    }

    const periodOpen = kline[histLen].open;
    const periodClose = kline[histLen + gameDays - 1].close;
    const periodReturn = (periodClose - periodOpen) / periodOpen * 100;

    const userReturn = (gameState.totalReturn - 1) * 100;
    const buyTrades = trades.filter(t => t.type === 'buy');
    const sellTrades = trades.filter(t => t.type === 'sell');

    let score = 70;
    const details = [];

    if (bestProfit > 0.001) {
        const returnRatio = userReturn / (bestProfit * 100);
        const returnScore = Math.max(-15, Math.min(15, returnRatio * 15));
        score += returnScore;
        details.push({
            label: '收益率表现',
            value: `${userReturn >= 0 ? '+' : ''}${userReturn.toFixed(2)}%`,
            cls: userReturn > 0 ? 'positive' : userReturn < 0 ? 'negative' : 'neutral',
            note: `最优单次收益 ${(bestProfit * 100).toFixed(2)}%`
        });
    } else {
        if (Math.abs(userReturn) < 2) {
            score += 8;
        } else if (userReturn < -2) {
            score -= 5;
        }
        details.push({
            label: '收益率表现',
            value: `${userReturn >= 0 ? '+' : ''}${userReturn.toFixed(2)}%`,
            cls: userReturn > 0 ? 'positive' : userReturn < 0 ? 'negative' : 'neutral',
            note: '区间机会有限'
        });
    }

    const alpha = userReturn - periodReturn;
    if (alpha > 3) score += 8;
    else if (alpha > 0) score += 4;
    else if (alpha > -3) score -= 2;
    else score -= 8;
    details.push({
        label: '相对区间涨跌',
        value: `${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`,
        cls: alpha > 0 ? 'positive' : alpha < 0 ? 'negative' : 'neutral',
        note: `区间涨跌 ${periodReturn >= 0 ? '+' : ''}${periodReturn.toFixed(2)}%`
    });

    if (buyTrades.length > 0) {
        const prices = [];
        for (let i = 0; i < gameDays; i++) prices.push(kline[histLen + i].close);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const range = maxPrice - minPrice || 1;
        const avgBuyPos = buyTrades.reduce((s, t) => s + (t.price - minPrice) / range, 0) / buyTrades.length;
        if (avgBuyPos < 0.3) score += 5;
        else if (avgBuyPos < 0.5) score += 2;
        else if (avgBuyPos > 0.7) score -= 5;
        else score -= 2;
        details.push({
            label: '买点位置',
            value: avgBuyPos < 0.3 ? '低位' : avgBuyPos < 0.5 ? '中低位' : avgBuyPos < 0.7 ? '中高位' : '高位',
            cls: avgBuyPos < 0.5 ? 'positive' : 'negative',
            note: `区间位置 ${(avgBuyPos * 100).toFixed(0)}%`
        });
    }

    if (sellTrades.length > 0) {
        const prices = [];
        for (let i = 0; i < gameDays; i++) prices.push(kline[histLen + i].close);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const range = maxPrice - minPrice || 1;
        const avgSellPos = sellTrades.reduce((s, t) => s + (t.price - minPrice) / range, 0) / sellTrades.length;
        if (avgSellPos > 0.7) score += 5;
        else if (avgSellPos > 0.5) score += 2;
        else if (avgSellPos < 0.3) score -= 5;
        else score -= 2;
        details.push({
            label: '卖点位置',
            value: avgSellPos > 0.7 ? '高位' : avgSellPos > 0.5 ? '中高位' : avgSellPos > 0.3 ? '中低位' : '低位',
            cls: avgSellPos > 0.5 ? 'positive' : 'negative',
            note: `区间位置 ${(avgSellPos * 100).toFixed(0)}%`
        });
    }

    const tradeCount = buyTrades.length;
    if (tradeCount === 0) {
        score -= 3;
        details.push({ label: '交易频率', value: '未交易', cls: 'negative', note: '空仓观望' });
    } else if (tradeCount <= 3) {
        score += 3;
        details.push({ label: '交易频率', value: '适度', cls: 'positive', note: `${tradeCount} 次买入` });
    } else {
        score -= 3;
        details.push({ label: '交易频率', value: '频繁', cls: 'negative', note: `${tradeCount} 次买入` });
    }

    if (gameState.tradeGains.length > 0) {
        const maxLoss = Math.min(...gameState.tradeGains);
        if (maxLoss >= -2) score += 4;
        else if (maxLoss >= -5) score += 1;
        else if (maxLoss < -10) score -= 4;
        else score -= 2;
    }

    score = Math.max(59, Math.min(100, Math.round(score)));
    gameState.bsScore = score;

    let grade, gradeCls;
    if (score >= 90) { grade = '优秀'; gradeCls = 'excellent'; }
    else if (score >= 80) { grade = '良好'; gradeCls = 'good'; }
    else if (score >= 70) { grade = '中等'; gradeCls = 'average'; }
    else { grade = '待提升'; gradeCls = 'poor'; }

    let comment = '';
    if (tradeCount === 0) {
        comment = '全程空仓观望，错过了市场机会。适当参与才能积累经验。';
    } else if (score >= 90) {
        comment = '操作精准，买卖时机把握出色，展现了优秀的盘感和纪律性！';
    } else if (score >= 80) {
        comment = '整体操作不错，对趋势有较好的判断。可以在买卖点的精确度上进一步优化。';
    } else if (score >= 70) {
        comment = '操作中规中矩，有一定的判断力。建议关注均线支撑/压力位来优化进出场时机。';
    } else {
        if (userReturn < -5) {
            comment = '亏损较大，需注意止损纪律。追高买入或恐慌卖出是常见的误区，建议冷静分析趋势后再操作。';
        } else {
            comment = '操作时机有待改善。建议结合均线和成交量信号来辅助判断买卖点。';
        }
    }

    const el = document.getElementById('bsReport');
    el.innerHTML = `
        <div class="bs-score-header">
            <span class="bs-score-title">BS 点评分</span>
            <span class="bs-score-badge ${gradeCls}">${score}分 · ${grade}</span>
        </div>
        <div class="bs-report-items">
            ${details.map(d => `
                <div class="bs-report-item">
                    <span class="bs-item-label">${d.label}</span>
                    <span>
                        <span class="bs-item-value ${d.cls}">${d.value}</span>
                        <span style="color:var(--text-muted); font-size:0.75rem; margin-left:8px;">${d.note}</span>
                    </span>
                </div>
            `).join('')}
        </div>
        <div class="bs-comment">${comment}</div>
    `;
}
