// ========== HINDSIGHT CALCULATOR — 当初买了该多好 ==========
import { gameState } from './state.js';
import { ensureStocksLoaded } from './pack-store.js';
import {
    filterStocksByQuery,
    resolveHindsightWindow,
    computeHindsightAnalysis,
    commodityAffordances,
} from './hindsight-pure.js';
import { Route, prepareScreen, activateScreen, setRouteHash } from './screen-router.js';
import {
    ensureEcharts,
    markChartLoading,
    clearChartLoading,
    markChartFailed,
} from './echarts-loader.js';
import { getTheme, onThemeChange, THEME_DARK } from './theme.js';

let hindsightChart = null;
let selectedStock  = null;
let filteredKline  = [];

/** Hindsight line-chart palette derived from explicit theme (not DOM scrape). */
function hindsightPalette(theme = getTheme()) {
    const isDark = theme === THEME_DARK;
    return {
        axisClr:  isDark ? 'rgba(180,160,120,0.18)' : 'rgba(0,0,0,0.1)',
        lblClr:   isDark ? '#7a7068' : '#AAAAAA',
        lineClr:  isDark ? 'rgba(200,160,80,0.75)' : 'rgba(60,60,80,0.55)',
        fillClr:  isDark ? 'rgba(200,160,80,0.06)' : 'rgba(60,60,80,0.04)',
        ttBg:     isDark ? 'rgba(20,18,14,0.96)' : 'rgba(255,255,255,0.97)',
        ttTxt:    isDark ? '#D4CFC8' : '#1a1a1a',
        ttBorder: isDark ? 'rgba(160,120,40,0.3)' : '#DCDCDC',
        labelBg:  isDark ? 'rgba(20,18,14,0.88)' : 'rgba(255,255,255,0.94)',
    };
}

function applyHindsightChartTheme(theme = getTheme()) {
    if (!hindsightChart || hindsightChart.isDisposed()) return;
    const p = hindsightPalette(theme);
    hindsightChart.setOption({
        tooltip: {
            axisPointer: { lineStyle: { color: p.axisClr } },
            backgroundColor: p.ttBg,
            borderColor: p.ttBorder,
            textStyle: { color: p.ttTxt },
        },
        xAxis: {
            axisLine: { lineStyle: { color: p.axisClr } },
            axisLabel: { color: p.lblClr },
        },
        yAxis: {
            splitLine: { lineStyle: { color: p.axisClr } },
            axisLabel: { color: p.lblClr },
        },
        series: [
            {
                lineStyle: { color: p.lineClr },
                areaStyle: { color: p.fillClr },
                markPoint: {
                    data: [
                        { label: { backgroundColor: p.labelBg } },
                        { label: { backgroundColor: p.labelBg } },
                    ],
                },
            },
            {
                label: { backgroundColor: p.labelBg },
            },
        ],
    });
}

onThemeChange((theme) => {
    applyHindsightChartTheme(theme);
});

/** Hub teaser mock dates (was previously smuggled into theme.js). */
function patchHindsightTeaserDates() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.oracle-input-mock span').forEach((el) => {
        if (el.textContent && el.textContent.includes('2020-01-01')) {
            el.textContent = '2024-01-01 → 2024-06-01';
        }
    });
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchHindsightTeaserDates);
    } else {
        patchHindsightTeaserDates();
    }
}

export function showHindsight(opts = {}) {
    const { updateHash = false } = opts;
    prepareScreen(Route.HINDSIGHT);
    activateScreen(Route.HINDSIGHT);
    if (updateHash) setRouteHash(Route.HINDSIGHT);
    _resetToFormState();
    if (!gameState.stocksData || gameState.stocksData.length === 0) {
        _setHint('hindsightStockHint', '行情数据加载中…', 'info');
        ensureStocksLoaded(gameState)
            .then(function () { _setHint('hindsightStockHint', '', ''); })
            .catch(function (err) {
                console.error(err);
                _setHint('hindsightStockHint', '数据加载失败，请刷新', 'error');
            });
    } else {
        ensureStocksLoaded(gameState).catch(function (err) { console.error(err); });
    }
}

export function hideHindsight() {
    document.getElementById('hindsightScreen').classList.remove('active');
    if (hindsightChart && !hindsightChart.isDisposed()) {
        hindsightChart.dispose();
        hindsightChart = null;
    }
    if (typeof window.showHome === 'function') window.showHome();
    else document.getElementById('startScreen').style.display = 'flex';
}

export function hindsightReset() {
    if (hindsightChart && !hindsightChart.isDisposed()) {
        hindsightChart.dispose();
        hindsightChart = null;
    }
    _resetToFormState();
}

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

function _fillSuggestions(raw) {
    const stocks = gameState.stocksData || [];
    const matches = filterStocksByQuery(stocks, raw, { limit: 12 });
    const list = document.getElementById('hindsightSuggestions');
    if (!list) return;
    list.innerHTML = '';
    if (matches.length === 0) {
        _closeSuggestions();
        _setHint('hindsightStockHint', '未找到匹配股票', 'error');
        return;
    }
    _setHint('hindsightStockHint', '', '');
    matches.forEach(s => {
        const item = document.createElement('div');
        item.className = 'hindsight-suggestion-item';
        item.innerHTML =
            `<span class="hindsight-suggestion-name">${s.name}</span>` +
            `<span class="hindsight-suggestion-code">${s.code}</span>`;
        item.addEventListener('mousedown', ev => { ev.preventDefault(); _selectStock(s); });
        list.appendChild(item);
    });
    list.classList.add('open');
}

export function onHindsightInput(e) {
    const raw = e.target.value.trim();
    selectedStock = null;
    if (raw.length < 1) {
        _closeSuggestions();
        _setHint('hindsightStockHint', '', '');
        return;
    }
    if (!gameState.stocksData || gameState.stocksData.length === 0) {
        _setHint('hindsightStockHint', '行情数据加载中…', 'info');
        const typed = raw;
        ensureStocksLoaded(gameState)
            .then(function () {
                const now = document.getElementById('hindsightStockInput');
                if (now && now.value.trim() === typed) _fillSuggestions(typed);
            })
            .catch(function (err) {
                console.error(err);
                _setHint('hindsightStockHint', '数据加载失败，请刷新', 'error');
                _closeSuggestions();
            });
        return;
    }
    _fillSuggestions(raw);
}

export function onHindsightBlur() {
    setTimeout(_closeSuggestions, 150);
}

function _closeSuggestions() {
    const list = document.getElementById('hindsightSuggestions');
    if (list) list.classList.remove('open');
}

function _selectStock(stock, { dates = 'fill' } = {}) {
    selectedStock = stock;
    document.getElementById('hindsightStockInput').value = `${stock.name} · ${stock.code}`;
    _closeSuggestions();
    const kline = stock.kline;
    if (kline && kline.length >= 2) {
        const fromEl = document.getElementById('hindsightDateFrom');
        const toEl = document.getElementById('hindsightDateTo');
        // 'fill' = list pick (overwrite); 'ifEmpty' = submit resolve (preserve user dates).
        if (dates === 'fill' || (dates === 'ifEmpty' && !fromEl.value)) {
            fromEl.value = kline[0].date;
        }
        if (dates === 'fill' || (dates === 'ifEmpty' && !toEl.value)) {
            toEl.value = kline[kline.length - 1].date;
        }
        _setHint('hindsightStockHint',
            `共 ${kline.length} 个交易日  (${kline[0].date} ~ ${kline[kline.length - 1].date})`,
            'info'
        );
    }
}


export function submitHindsight() {
    const btn = document.getElementById('hindsightSubmitBtn');
    const fromVal = document.getElementById('hindsightDateFrom').value;
    const toVal   = document.getElementById('hindsightDateTo').value;
    const resolved = resolveHindsightWindow({
        stocks: gameState.stocksData || [],
        selectedStock,
        stockInputRaw: document.getElementById('hindsightStockInput').value,
        fromVal,
        toVal,
        qtyRaw: document.getElementById('hindsightQtyInput')?.value,
    });
    if (!resolved.ok) {
        if (resolved.field === 'stock') {
            _setHint('hindsightStockHint', resolved.err, 'error');
            document.getElementById('hindsightStockInput').focus();
        } else if (resolved.field === 'qty') {
            _setHint('hindsightDateHint', resolved.err, 'error');
            document.getElementById('hindsightQtyInput')?.focus();
        } else {
            _setHint('hindsightDateHint', resolved.err, 'error');
        }
        return;
    }
    // Preserve user-picked dates when resolving from typed input.
    if (!selectedStock || selectedStock !== resolved.stock) {
        _selectStock(resolved.stock, { dates: 'ifEmpty' });
    }
    filteredKline = resolved.kline;
    const qtyHands = resolved.qtyHands;
    _setHint('hindsightDateHint',  '', '');
    _setHint('hindsightStockHint', '', '');
    btn.classList.add('loading');
    btn.disabled = true;
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

let _lastResultCache = null;

function _renderResults(qtyHands = 10) {
    const stock  = selectedStock;
    const kline  = filteredKline;
    const analysis = computeHindsightAnalysis({ kline, qtyHands, stock });
    const {
        buyIdx, sellIdx, peakIdx, buy, bestSell, bestReturn, rangeHigh,
        buyDay, sellDay, buyShares, earnedAmt, periodReturn, earnedLabel,
    } = analysis;
    _lastResultCache = {
        stockName:  analysis.stockName,
        dateRange:  analysis.dateRange,
        buyDate:    buyDay.date,
        buyPrice:   buy.toFixed(2),
        peakDate:   sellDay.date,
        peakPrice:  bestSell.toFixed(2),
        exitDate:   sellDay.date,
        exitPrice:  bestSell.toFixed(2),
        buyShares,
        earnedAmt,
        bestReturn,
        periodReturn,
    };
    document.getElementById('hindsightResultStockName').textContent = analysis.stockName;
    document.getElementById('hindsightResultDateRange').textContent =
        `${kline[0].date}  →  ${kline[kline.length - 1].date}`;
    document.getElementById('hindsightBuyPrice').textContent  = `¥ ${buy.toFixed(2)}`;
    document.getElementById('hindsightPeakPrice').textContent = `¥ ${rangeHigh.toFixed(2)}`;
    document.getElementById('hindsightSellPrice').textContent = `¥ ${bestSell.toFixed(2)}`;
    document.getElementById('hindsightBuyDate').textContent   = buyDay.date;
    document.getElementById('hindsightSellDate').textContent  = sellDay.date;
    document.getElementById('hindsightExitDate').textContent  = sellDay.date;
    document.getElementById('hindsightBuyQty').textContent    = `${buyShares.toLocaleString()} 股`;
    const periodEl = document.getElementById('hindsightComparePeriod');
    periodEl.textContent = (periodReturn >= 0 ? '+' : '') + periodReturn.toFixed(2) + '%';
    periodEl.className   = 'ar-data-value ' + (periodReturn >= 0 ? 'up' : 'down');
    const earnedEl    = document.getElementById('hindsightEarnedAmt');
    const earnedLabelEl = document.getElementById('hindsightEarnedLabel');
    if (earnedEl) {
        const isPos = earnedAmt >= 0;
        earnedEl.textContent = '¥ --';
        earnedEl.className   = 'ar-return-earned ' + (isPos ? 'earned-pos' : 'earned-neg');
        if (earnedLabelEl) earnedLabelEl.textContent = earnedLabel;
    }
    const counterEl = document.getElementById('hindsightReturnCounter');
    if (counterEl) {
        counterEl.className = 'hindsight-return-counter' + (bestReturn < 0 ? ' counter-neg' : '');
    }
    document.getElementById('hindsightChartMeta').textContent =
        `${kline.length} 个交易日`;
    document.getElementById('hindsightFormPanel').style.display = 'none';
    document.getElementById('hindsightResultsPanel').classList.add('active');
    void _drawChart(kline, buyIdx, sellIdx, peakIdx);
    setTimeout(() => _animateCounter(bestReturn * 100), 350);
    setTimeout(() => _animateEarned(earnedAmt), 350);
    _renderCommodities(earnedAmt);
    _renderQuote();
}

function _animateCounter(targetPercent) {
    const el = document.getElementById('hindsightReturnCounter');
    el.classList.add('counting');
    const duration = 2400;
    const startTs  = performance.now();
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

async function _drawChart(kline, buyIdx, sellIdx, peakIdx) {
    const chartDom = document.getElementById('hindsightChart');
    if (!chartDom) return;
    markChartLoading(chartDom);
    let echartsApi;
    try {
        echartsApi = await ensureEcharts();
    } catch (err) {
        console.error('ECharts unavailable for hindsight chart', err);
        markChartFailed(chartDom, '悔棋局图表加载失败，请检查网络后刷新');
        return;
    }
    clearChartLoading(chartDom);
    if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.dispose();
    hindsightChart = echartsApi.init(chartDom);
    const {
        axisClr, lblClr, lineClr, fillClr, ttBg, ttTxt, ttBorder, labelBg,
    } = hindsightPalette(getTheme());
    const dates  = kline.map(d => d.date);
    const closes = kline.map(d => d.close);
    const buySellMarks = [
        {
            name:       '买入',
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
        {
            name:       '卖出',
            coord:      [sellIdx, kline[sellIdx].high],
            value:      '卖出',
            symbol:     'circle',
            symbolSize: 11,
            itemStyle:  { color: '#5A7FA0', borderColor: '#fff', borderWidth: 2 },
            label: {
                show: true, formatter: `卖出\n¥${kline[sellIdx].high.toFixed(2)}`,
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
    requestAnimationFrame(function () {
        if (!hindsightChart || hindsightChart.isDisposed()) return;
        hindsightChart.setOption(option);
        setTimeout(function () {
            if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.resize();
        }, 60);
    });
}

function _setHint(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'hindsight-field-hint' + (type ? ' ' + type : '');
}

export function resizeHindsightChart() {
    if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.resize();
}

function _renderCommodities(earnedAmt) {
    const el = document.getElementById('hindsightCommodityList');
    if (!el) return;
    const rows = commodityAffordances(earnedAmt).map((it) =>
        `<div class="archive-commodity-row">` +
            `<span class="archive-commodity-icon">${it.icon}</span>` +
            `<span class="archive-commodity-text">${it.verb} <strong>${it.n.toLocaleString()}</strong> ${it.name}</span>` +
            `</div>`
    );
    el.innerHTML = rows.length
        ? rows.join('')
        : `<div class="archive-commodity-row"><span class="archive-commodity-text" style="color:#AAAAAA;font-style:italic">收益较小，暂无等价实物 🌱</span></div>`;
}

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

function _loadHtml2canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve(true);
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.async = true;
        s.onload = () => resolve(typeof html2canvas === 'function');
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
}

const HINDSIGHT_SITE_URL = 'https://stockgame.xieyw.top';

function _hindsightShareFooter() {
    return `你要不要也来回溯一下？\n${HINDSIGHT_SITE_URL}\n「股海沉浮·治愈档案馆」`;
}

export async function hindsightShare() {
    if (!_lastResultCache) return;
    await _loadHtml2canvas();
    const c = _lastResultCache;
    const card = document.querySelector('#hindsightResultsPanel > .ar-card');
    const safeName = String(c.stockName).replace(/[\\\/:*?"<>|]/g, '_');
    const filename = `回溯档案_${safeName}.png`;
    const downloadBlob = (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
    if (card && typeof html2canvas === 'function') {
        try {
            const bg = getComputedStyle(card).backgroundColor || '#16161d';
            const canvas = await html2canvas(card, {
                backgroundColor: bg,
                scale: 2,
                useCORS: true,
                logging: false,
            });
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (blob) {
                const file = new File([blob], filename, { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({
                            files: [file],
                            title: `${c.stockName} 回溯`,
                            text: `${c.stockName} 理论${c.earnedAmt >= 0 ? '最多赚' : '最少亏'} · 来玩：${HINDSIGHT_SITE_URL}`,
                            url: HINDSIGHT_SITE_URL,
                        });
                        return;
                    } catch (err) {
                        if (err && err.name === 'AbortError') return;
                    }
                }
                downloadBlob(blob);
                return;
            }
        } catch (err) {
            console.error('生成分享图失败', err);
        }
    }
    const absAmt = Math.abs(c.earnedAmt).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const verb = c.earnedAmt >= 0 ? '最多赚' : '最少亏';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 以 ¥${c.buyPrice} 买入了 ${c.stockName}（${c.buyShares.toLocaleString()} 股），` +
        `若在 ${c.peakDate} 以最高价 ¥${c.peakPrice} 卖出，理论${verb} ¥${absAmt}。\n\n` +
        `${_hindsightShareFooter()}\n—— 治愈每一个错过大牛股的遗憾灵魂`;
    _copyText(text, null);
    alert('已复制分享文案（当前环境无法生成图片）');
}

export function hindsightCopy() {
    if (!_lastResultCache) return;
    const c = _lastResultCache;
    const absAmt = Math.abs(c.earnedAmt).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const verb = c.earnedAmt >= 0 ? '最多赚' : '最少亏';
    const retSign = c.bestReturn >= 0 ? '+' : '';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 以 ¥${c.buyPrice} 买入了 ${c.stockName}（${c.buyShares.toLocaleString()} 股），\n` +
        `若在 ${c.peakDate} 以最高价 ¥${c.peakPrice} 卖出，理论${verb} ¥${absAmt}。\n\n` +
        `区间最大涨幅 ${retSign}${(c.bestReturn * 100).toFixed(2)}%，区间持有 ${(c.periodReturn >= 0 ? '+' : '') + c.periodReturn.toFixed(2)}%。\n` +
        `${_hindsightShareFooter()}`;
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
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}
