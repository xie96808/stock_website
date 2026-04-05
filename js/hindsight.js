// ========== HINDSIGHT CALCULATOR — 当初买了该多好 ==========
import { gameState } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';

// ── Module-level refs ──
let hindsightChart = null;
let selectedStock  = null;  // full stock object from STOCKS_DATA
let filteredKline  = [];    // kline slice for the chosen date range

// ═══════════════════════════════════════════════
// Public: entry / exit
// ═══════════════════════════════════════════════

export function showHindsight() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('hindsightScreen').classList.add('active');
    _resetToFormState();
}

export function hideHindsight() {
    document.getElementById('hindsightScreen').classList.remove('active');
    document.getElementById('startScreen').style.display = 'flex';
    if (hindsightChart && !hindsightChart.isDisposed()) {
        hindsightChart.dispose();
        hindsightChart = null;
    }
}

// 「再来一只」—— 留在 hindsight 界面，直接跳回选股表单
export function hindsightReset() {
    if (hindsightChart && !hindsightChart.isDisposed()) {
        hindsightChart.dispose();
        hindsightChart = null;
    }
    _resetToFormState();
}

// ═══════════════════════════════════════════════
// Internal: reset to INPUT FORM state
// ═══════════════════════════════════════════════

function _resetToFormState() {
    selectedStock = null;
    filteredKline = [];

    document.getElementById('hindsightFormPanel').style.display = 'block';
    document.getElementById('hindsightResultsPanel').classList.remove('active');

    document.getElementById('hindsightStockInput').value = '';
    document.getElementById('hindsightDateFrom').value   = '';
    document.getElementById('hindsightDateTo').value     = '';
    const qtyInput = document.getElementById('hindsightQtyInput');
    if (qtyInput) qtyInput.value = '10';
    _setHint('hindsightStockHint', '', '');
    _setHint('hindsightDateHint',  '', '');

    _closeSuggestions();

    const btn = document.getElementById('hindsightSubmitBtn');
    btn.classList.remove('loading');
    btn.disabled = false;
}

// ═══════════════════════════════════════════════
// Autocomplete
// ═══════════════════════════════════════════════

export function onHindsightInput(e) {
    const raw = e.target.value.trim();
    if (raw.length < 1) { _closeSuggestions(); selectedStock = null; return; }

    const q = raw.toLowerCase();
    const matches = gameState.stocksData
        .filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
        .slice(0, 8);

    if (matches.length === 0) { _closeSuggestions(); selectedStock = null; return; }

    const list = document.getElementById('hindsightSuggestions');
    list.innerHTML = '';

    matches.forEach(s => {
        const item = document.createElement('div');
        item.className = 'hindsight-suggestion-item';
        item.innerHTML =
            `<span class="hindsight-suggestion-name">${s.name}</span>` +
            `<span class="hindsight-suggestion-code">${s.code}</span>`;
        // mousedown fires before blur — prevents race condition
        item.addEventListener('mousedown', ev => { ev.preventDefault(); _selectStock(s); });
        list.appendChild(item);
    });

    list.classList.add('open');
}

export function onHindsightBlur() {
    setTimeout(_closeSuggestions, 150);
}

function _closeSuggestions() {
    const list = document.getElementById('hindsightSuggestions');
    if (list) list.classList.remove('open');
}

function _selectStock(stock) {
    selectedStock = stock;
    document.getElementById('hindsightStockInput').value = `${stock.name} · ${stock.code}`;
    _closeSuggestions();

    // Auto-fill date range with the stock's full available span
    const kline = stock.kline;
    if (kline && kline.length >= 2) {
        document.getElementById('hindsightDateFrom').value = kline[0].date;
        document.getElementById('hindsightDateTo').value   = kline[kline.length - 1].date;
        _setHint('hindsightStockHint',
            `共 ${kline.length} 个交易日  (${kline[0].date} ~ ${kline[kline.length - 1].date})`,
            'info'
        );
    }
}

// ═══════════════════════════════════════════════
// Validation & submission
// ═══════════════════════════════════════════════

export function submitHindsight() {
    const btn = document.getElementById('hindsightSubmitBtn');

    // 1. Ensure a stock is selected ─────────────
    if (!selectedStock) {
        const raw = document.getElementById('hindsightStockInput').value.trim().toLowerCase();
        const match = gameState.stocksData.find(s =>
            s.name.toLowerCase() === raw ||
            s.code.toLowerCase() === raw ||
            `${s.name} · ${s.code}`.toLowerCase() === raw
        );
        if (match) {
            _selectStock(match);
        } else {
            _setHint('hindsightStockHint', '请从列表中选择一只股票', 'error');
            document.getElementById('hindsightStockInput').focus();
            return;
        }
    }

    // 2. Validate date range ────────────────────
    const fromVal = document.getElementById('hindsightDateFrom').value;
    const toVal   = document.getElementById('hindsightDateTo').value;

    if (!fromVal || !toVal) {
        _setHint('hindsightDateHint', '请选择起止日期', 'error');
        return;
    }
    if (fromVal >= toVal) {
        _setHint('hindsightDateHint', '结束日期必须晚于开始日期', 'error');
        return;
    }

    // 3. Validate qty ────────────────────────────
    const qtyRaw = parseInt(document.getElementById('hindsightQtyInput')?.value ?? '10', 10);
    const qtyHands = (isNaN(qtyRaw) || qtyRaw < 1) ? 10 : qtyRaw;

    // 4. Filter kline to date range ─────────────
    const kline = selectedStock.kline;
    filteredKline = kline.filter(d => d.date >= fromVal && d.date <= toVal);

    if (filteredKline.length < 5) {
        _setHint('hindsightDateHint',
            `该区间内交易数据不足（仅 ${filteredKline.length} 条），请扩大范围`,
            'error'
        );
        return;
    }

    // 5. Clear errors, enter loading state ──────
    _setHint('hindsightDateHint',  '', '');
    _setHint('hindsightStockHint', '', '');

    btn.classList.add('loading');
    btn.disabled = true;

    // Let browser paint the spinner before heavy compute
    requestAnimationFrame(() => {
        setTimeout(() => {
            try {
                _renderResults(qtyHands);
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        }, 80);
    });
}

// ═══════════════════════════════════════════════
// Core computation — O(n) best buy/sell
// ═══════════════════════════════════════════════

function _findBestBuySell(kline) {
    // Find pair (i, j) with i < j maximising close[j] / close[i] - 1
    let bestReturn = 0;
    let bestBuyIdx  = 0;
    let bestSellIdx = 1;
    let minIdx = 0;  // index of lowest close seen so far

    for (let j = 1; j < kline.length; j++) {
        const ret = kline[j].close / kline[minIdx].close - 1;
        if (ret > bestReturn) {
            bestReturn  = ret;
            bestBuyIdx  = minIdx;
            bestSellIdx = j;
        }
        if (kline[j].close < kline[minIdx].close) {
            minIdx = j;
        }
    }

    return { bestReturn, bestBuyIdx, bestSellIdx };
}

// ═══════════════════════════════════════════════
// Render results
// ═══════════════════════════════════════════════

// Module-level cache for copy/share
let _lastResultCache = null;

function _renderResults(qtyHands = 10) {
    const stock  = selectedStock;
    const kline  = filteredKline;
    const { bestReturn, bestBuyIdx, bestSellIdx } = _findBestBuySell(kline);

    const buyDay  = kline[bestBuyIdx];
    const sellDay = kline[bestSellIdx];

    // Find global high (absolute high price) in range ──────
    let peakIdx = 0;
    for (let i = 1; i < kline.length; i++) {
        if (kline[i].high > kline[peakIdx].high) peakIdx = i;
    }
    const peakDay = kline[peakIdx];

    // Buy quantity from user input (hands → shares) ────────
    const buyShares = qtyHands * 100;

    // 实际卖出（区间最后一天收盘）
    const exitDay   = kline[kline.length - 1];
    // 多赚部分 = (巅峰最高价 - 实际卖出价) × 股数
    const earnedAmt = (peakDay.high - exitDay.close) * buyShares;

    // Period return (first→last close) ────────────────────
    const periodReturn = (kline[kline.length - 1].close / kline[0].close - 1) * 100;

    // Cache for copy/share ─────────────────────────────────
    _lastResultCache = {
        stockName:  `${stock.name}（${stock.code}）`,
        dateRange:  `${kline[0].date} → ${kline[kline.length - 1].date}`,
        buyDate:    buyDay.date,
        buyPrice:   buyDay.close.toFixed(2),
        peakDate:   peakDay.date,
        peakPrice:  peakDay.high.toFixed(2),
        exitDate:   exitDay.date,
        exitPrice:  exitDay.close.toFixed(2),
        buyShares,
        earnedAmt,
        bestReturn,
        periodReturn,
    };

    // Stock name + date range ──────────────────────────────
    document.getElementById('hindsightResultStockName').textContent =
        `${stock.name}（${stock.code}）`;
    document.getElementById('hindsightResultDateRange').textContent =
        `${kline[0].date}  →  ${kline[kline.length - 1].date}`;

    // data panel ──────────────────────────────────────────
    document.getElementById('hindsightBuyPrice').textContent  = `¥ ${buyDay.close.toFixed(2)}`;
    document.getElementById('hindsightPeakPrice').textContent = `¥ ${peakDay.high.toFixed(2)}`;
    document.getElementById('hindsightSellPrice').textContent = `¥ ${exitDay.close.toFixed(2)}`;
    document.getElementById('hindsightBuyDate').textContent   = buyDay.date;
    document.getElementById('hindsightSellDate').textContent  = peakDay.date;
    document.getElementById('hindsightExitDate').textContent  = exitDay.date;
    document.getElementById('hindsightBuyQty').textContent    = `${buyShares.toLocaleString()} 股`;

    const periodEl = document.getElementById('hindsightComparePeriod');
    periodEl.textContent = (periodReturn >= 0 ? '+' : '') + periodReturn.toFixed(2) + '%';
    periodEl.className   = 'ar-data-value ' + (periodReturn >= 0 ? 'up' : 'down');

    // Earned label + amount (value filled by animation) ────
    const earnedEl    = document.getElementById('hindsightEarnedAmt');
    const earnedLabel = document.getElementById('hindsightEarnedLabel');
    if (earnedEl) {
        const isPos = earnedAmt >= 0;
        earnedEl.textContent = '¥ --';
        earnedEl.className   = 'ar-return-earned ' + (isPos ? 'earned-pos' : 'earned-neg');
        if (earnedLabel) earnedLabel.textContent = isPos ? '理论最多赚' : '理论最多亏';
    }

    // counter color for negative bestReturn ────────────────
    const counterEl = document.getElementById('hindsightReturnCounter');
    if (counterEl) {
        counterEl.className = 'hindsight-return-counter' + (bestReturn < 0 ? ' counter-neg' : '');
    }

    // Chart meta ───────────────────────────────────────────
    document.getElementById('hindsightChartMeta').textContent =
        `${kline.length} 个交易日`;

    // Flip panels ──────────────────────────────────────────
    document.getElementById('hindsightFormPanel').style.display = 'none';
    document.getElementById('hindsightResultsPanel').classList.add('active');

    // Draw chart: user buy point = kline[0] (first day of range),
    //             sell point = kline[last] (last day of range),
    //             peak = absolute high index
    // The "buy" annotation is always the first bar of filtered range,
    // "sell" the last bar, "peak" the highest high.
    const userBuyIdx  = 0;
    const userSellIdx = kline.length - 1;
    _drawChart(kline, userBuyIdx, userSellIdx, peakIdx);

    // Animate counter ──────────────────────────────────────
    setTimeout(() => _animateCounter(bestReturn * 100), 350);
    setTimeout(() => _animateEarned(earnedAmt), 350);

    // Commodities (use earnedAmt as actual gain) + quote ───
    _renderCommodities(earnedAmt);
    _renderQuote();
}

// ═══════════════════════════════════════════════
// Counter animation — heartbreak in real time
// ═══════════════════════════════════════════════

function _animateCounter(targetPercent) {
    const el = document.getElementById('hindsightReturnCounter');
    el.classList.add('counting');

    const duration = 2400;  // ms
    const startTs  = performance.now();

    // Ease-out cubic: fast jump, dramatic crawl at the end
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function tick(now) {
        const progress = Math.min((now - startTs) / duration, 1);
        const current  = targetPercent * easeOutCubic(progress);
        const sign     = current >= 0 ? '+' : '';
        el.textContent = sign + current.toFixed(2) + '%';

        if (progress < 1) {
            requestAnimationFrame(tick);
        } else {
            const finalSign = targetPercent >= 0 ? '+' : '';
            el.textContent = finalSign + targetPercent.toFixed(2) + '%';
            el.classList.remove('counting');
        }
    }

    requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════
// Earned amount animation — mirrors _animateCounter
// ═══════════════════════════════════════════════

function _animateEarned(targetAmt) {
    const el = document.getElementById('hindsightEarnedAmt');
    if (!el) return;

    const duration = 2400;
    const startTs  = performance.now();
    const isPos    = targetAmt >= 0;

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function tick(now) {
        const progress = Math.min((now - startTs) / duration, 1);
        const current  = targetAmt * easeOutCubic(progress);
        const sign     = current >= 0 ? '+' : '-';
        const absAmt   = Math.abs(current).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
        el.textContent = `¥ ${sign}${absAmt}`;

        if (progress < 1) {
            requestAnimationFrame(tick);
        } else {
            const finalSign = isPos ? '+' : '-';
            const finalAmt  = Math.abs(targetAmt).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
            el.textContent  = `¥ ${finalSign}${finalAmt}`;
        }
    }

    requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════
// ECharts mini-chart — price line only, 3 annotated points
// ═══════════════════════════════════════════════

function _drawChart(kline, buyIdx, sellIdx, peakIdx) {
    const chartDom = document.getElementById('hindsightChart');
    if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.dispose();
    hindsightChart = echarts.init(chartDom);

    const isDark   = document.documentElement.getAttribute('data-theme') === 'dark';
    const axisClr  = isDark ? 'rgba(180,160,120,0.18)' : 'rgba(0,0,0,0.1)';
    const lblClr   = isDark ? '#7a7068' : '#AAAAAA';
    const lineClr  = isDark ? 'rgba(200,160,80,0.75)' : 'rgba(60,60,80,0.55)';
    const fillClr  = isDark ? 'rgba(200,160,80,0.06)' : 'rgba(60,60,80,0.04)';
    const ttBg     = isDark ? 'rgba(20,18,14,0.96)' : 'rgba(255,255,255,0.97)';
    const ttTxt    = isDark ? '#D4CFC8' : '#1a1a1a';
    const ttBorder = isDark ? 'rgba(160,120,40,0.3)' : '#DCDCDC';

    const dates  = kline.map(d => d.date);
    const closes = kline.map(d => d.close);

    const labelBg = isDark ? 'rgba(20,18,14,0.88)' : 'rgba(255,255,255,0.94)';

    // buy / sell use markPoint on line series (coords in close-price space)
    const buySellMarks = [
        // ── 买入点：红色，标在收盘价，气泡在下方
        {
            coord:      [buyIdx, kline[buyIdx].close],
            value:      '买入',
            symbol:     'circle',
            symbolSize: 11,
            itemStyle:  { color: '#C43030', borderColor: '#fff', borderWidth: 2 },
            label: {
                show: true, formatter: `买入\n¥${kline[buyIdx].close.toFixed(2)}`,
                position: 'insideBottom',
                distance: 16,
                fontFamily: 'Noto Sans SC', fontSize: 10, fontWeight: 600,
                color: '#C43030',
                backgroundColor: labelBg,
                borderColor: '#C43030', borderWidth: 0.5, borderRadius: 2,
                padding: [3, 6],
            }
        },
        // ── 卖出点：蓝灰色，标在收盘价，气泡在上方
        {
            coord:      [sellIdx, kline[sellIdx].close],
            value:      '卖出',
            symbol:     'circle',
            symbolSize: 11,
            itemStyle:  { color: '#5A7FA0', borderColor: '#fff', borderWidth: 2 },
            label: {
                show: true, formatter: `卖出\n¥${kline[sellIdx].close.toFixed(2)}`,
                position: peakIdx === sellIdx ? 'insideBottom' : 'insideTop',
                distance: peakIdx === sellIdx ? 18 : 16,
                fontFamily: 'Noto Sans SC', fontSize: 10, fontWeight: 600,
                color: '#3A5F80',
                backgroundColor: labelBg,
                borderColor: '#5A7FA0', borderWidth: 0.5, borderRadius: 2,
                padding: [3, 6],
            }
        },
    ];

    // ── 巅峰点：独立 scatter series，坐标 [date, high]，精确落在最高价
    const peakHigh = kline[peakIdx].high;
    const peakDate = dates[peakIdx];

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'line', lineStyle: { color: axisClr } },
            backgroundColor: ttBg,
            borderColor: ttBorder,
            borderWidth: 0.5,
            textStyle: { color: ttTxt, fontFamily: 'JetBrains Mono', fontSize: 11 },
            formatter: params => {
                const p = params.find(x => x.seriesIndex === 0) || params[0];
                if (!p) return '';
                return `<span style="font-size:10px;color:${lblClr}">${p.axisValue}</span><br/>` +
                       `<b style="color:${ttTxt}">¥ ${Number(p.value).toFixed(2)}</b>`;
            }
        },
        grid: { left: '10%', right: '4%', top: '18%', bottom: '14%' },
        xAxis: {
            type: 'category', data: dates,
            axisLine:  { lineStyle: { color: axisClr } },
            axisTick:  { show: false },
            splitLine: { show: false },
            axisLabel: {
                color: lblClr, fontFamily: 'JetBrains Mono', fontSize: 9, rotate: 30,
                interval: Math.max(0, Math.floor(kline.length / 4) - 1)
            }
        },
        yAxis: {
            type: 'value', scale: true,
            axisLine:  { show: false },
            axisTick:  { show: false },
            splitLine: { lineStyle: { color: axisClr, type: 'dashed' } },
            axisLabel: { color: lblClr, fontFamily: 'JetBrains Mono', fontSize: 9 }
        },
        series: [
            // 价格折线
            {
                type: 'line',
                data: closes,
                smooth: false,
                symbol: 'none',
                lineStyle: { width: 1.5, color: lineClr },
                areaStyle: { color: fillClr },
                markPoint: {
                    data: buySellMarks,
                    label: { formatter: '{b}' }
                }
            },
            // 巅峰点 scatter（独立 y 轴，能精确落在 high 价）
            {
                type: 'scatter',
                data: [[peakDate, peakHigh]],
                symbol: 'diamond',
                symbolSize: 14,
                itemStyle: { color: '#D4A017', borderColor: '#fff', borderWidth: 2 },
                label: {
                    show: true,
                    formatter: `巅峰\n¥${peakHigh.toFixed(2)}`,
                    position: 'top',
                    distance: 6,
                    fontFamily: 'Noto Sans SC', fontSize: 10, fontWeight: 700,
                    color: '#A07010',
                    backgroundColor: labelBg,
                    borderColor: '#D4A017', borderWidth: 0.8, borderRadius: 2,
                    padding: [3, 6],
                },
                tooltip: { show: false },
            }
        ]
    };

    hindsightChart.setOption(option);
    setTimeout(() => { if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.resize(); }, 60);
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function _setHint(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'hindsight-field-hint' + (type ? ' ' + type : '');
}

export function resizeHindsightChart() {
    if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.resize();
}

// ═══════════════════════════════════════════════
// 物换星移 — commodity equivalents
// ═══════════════════════════════════════════════

function _renderCommodities(earnedAmt) {
    const gained = Math.max(0, earnedAmt);
    const items = [
        { icon: '🧋', name: '杯奶茶',                    price: 20     },
        { icon: '☕', name: '杯瑞幸咖啡',                price: 10     },
        { icon: '📱', name: '部 iPhone 17 Pro',          price: 9000   },
        { icon: '✈️', name: '张机票（经济舱）',          price: 2000   },
        { icon: '🏖️', name: '次出境游',                  price: 12000  },
        { icon: '🏠', name: '个月小城市首付',            price: 150000 },
        { icon: '📚', name: '本《聪明的投资者》',        price: 68     },
    ];
    const el = document.getElementById('hindsightCommodityList');
    if (!el) return;
    const rows = items.map(it => {
        const n = Math.floor(gained / it.price);
        if (n < 1) return '';
        const verb = it.name.includes('首付') ? '多出' : '多买';
        return `<div class="archive-commodity-row">` +
            `<span class="archive-commodity-icon">${it.icon}</span>` +
            `<span class="archive-commodity-text">${verb} <strong>${n.toLocaleString()}</strong> ${it.name}</span>` +
            `</div>`;
    }).filter(Boolean);
    el.innerHTML = rows.length
        ? rows.join('')
        : `<div class="archive-commodity-row"><span class="archive-commodity-text" style="color:#AAAAAA;font-style:italic">收益较小，暂无等价实物 🌱</span></div>`;
}

// ═══════════════════════════════════════════════
// 名人名言
// ═══════════════════════════════════════════════

const _QUOTES = [
    { text: '在别人贪婪时恐惧，在别人恐惧时贪婪。', author: '— 沃伦·巴菲特' },
    { text: '市场是一种把钱从不耐烦的人转移到有耐心的人手中的装置。', author: '— 沃伦·巴菲特' },
    { text: '我们根本不需要更聪明，我们需要的是更少犯大错。', author: '— 查理·芒格' },
    { text: '如果你不愿意持有一只股票十年，那就不要持有它十分钟。', author: '— 沃伦·巴菲特' },
    { text: '市场就是这样——大多数人总是在最高点买入，在最低点卖出。', author: '— 乔治·索罗斯' },
    { text: '投资的秘密是，当所有聪明人都认为某件事不可能发生时，它往往就会发生。', author: '— 彼得·林奇' },
    { text: '在股票市场中，最危险的话是：这次不一样。', author: '— 约翰·坦普顿' },
    { text: '懂得何时不投资，与懂得何时投资同样重要。', author: '— 彼得·林奇' },
    { text: '知道自己不知道什么，比自以为什么都知道更有价值。', author: '— 查理·芒格' },
    { text: '复利是世界第八大奇迹，懂得的人赚钱，不懂的人付钱。', author: '— 阿尔伯特·爱因斯坦' },
];

function _renderQuote() {
    const q   = _QUOTES[Math.floor(Math.random() * _QUOTES.length)];
    const txt = document.getElementById('hindsightQuoteText');
    const aut = document.getElementById('hindsightQuoteAuthor');
    if (txt) txt.textContent = q.text;
    if (aut) aut.textContent = q.author;
}

// ═══════════════════════════════════════════════
// 分享 & 复制
// ═══════════════════════════════════════════════

export function hindsightShare() {
    if (!_lastResultCache) return;
    const c = _lastResultCache;
    const earned    = Math.max(0, c.earnedAmt);
    const earnedFmt = earned.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const teaCups   = Math.floor(earned / 20);
    const teaStr    = teaCups > 0 ? `，买下 ${teaCups.toLocaleString()} 杯奶茶` : '';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 买入了 ${c.stockName}，` +
        `若在巅峰日 ${c.peakDate} 卖出，我本可以比实际多赚 ¥${earnedFmt}${teaStr}。\n\n` +
        `你要不要也来回溯一下？\n` +
        `「股海沉浮·治愈档案馆」—— 治愈每一个错过大牛股的遗憾灵魂`;

    if (navigator.share) {
        navigator.share({ title: `${c.stockName} 回溯`, text }).catch(() => {});
    } else {
        _copyText(text, null);
        alert('已复制分享文案到剪贴板（当前环境不支持原生分享）');
    }
}

export function hindsightCopy() {
    if (!_lastResultCache) return;
    const c = _lastResultCache;
    const earned    = Math.max(0, c.earnedAmt);
    const earnedFmt = earned.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const teaCups   = Math.floor(earned / 20);
    const teaStr    = teaCups > 0 ? `，可多买 ${teaCups.toLocaleString()} 杯奶茶` : '';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 买入了 ${c.stockName}（${c.buyShares.toLocaleString()} 股），\n` +
        `实际在 ${c.exitDate} 以 ¥${c.exitPrice} 卖出；\n` +
        `若在巅峰日 ${c.peakDate}（¥${c.peakPrice}）卖出，本可多赚 ¥${earnedFmt}${teaStr}。\n\n` +
        `区间最大涨幅 +${(c.bestReturn * 100).toFixed(2)}%，区间持有 ${(c.periodReturn >= 0 ? '+' : '') + c.periodReturn.toFixed(2)}%。\n` +
        `你要不要也来回溯一下？`;
    _copyText(text, 'hindsightCopyBtn');
}

function _copyText(text, btnId) {
    navigator.clipboard.writeText(text).then(() => {
        if (!btnId) return;
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '✓ 已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    }).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}
