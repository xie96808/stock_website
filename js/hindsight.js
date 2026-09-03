// ========== HINDSIGHT CALCULATOR — 当初买了该多好 ==========
import { gameState } from './state.js';
import { calculateMA, applyChartTheme } from './utils.js';
import { ensureStocksLoaded } from './load-stocks.js';

let hindsightChart = null;
let selectedStock  = null;
let filteredKline  = [];

export function showHindsight() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('hindsightScreen').classList.add('active');
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
    document.getElementById('startScreen').style.display = 'flex';
    if (hindsightChart && !hindsightChart.isDisposed()) {
        hindsightChart.dispose();
        hindsightChart = null;
    }
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

const CHAR_PY = {"万":"wan","三":"san","上":"shang","世":"shi","业":"ye","东":"dong","中":"zhong","丰":"feng","九":"jiu","云":"yun","井":"jing","产":"chan","京":"jing","人":"ren","亿":"yi","今":"jin","仑":"lun","仔":"zai","代":"dai","件":"jian","份":"fen","众":"zhong","传":"chuan","伦":"lun","保":"bao","信":"xin","储":"chu","兆":"zhao","先":"xian","光":"guang","克":"ke","兖":"yan","全":"quan","公":"gong","六":"liu","兰":"lan","农":"nong","分":"fen","创":"chuang","利":"li","券":"quan","力":"li","办":"ban","动":"dong","勤":"qin","化":"hua","北":"bei","医":"yi","升":"sheng","华":"hua","南":"nan","卫":"wei","压":"ya","原":"yuan","厦":"sha","友":"you","变":"bian","口":"kou","古":"gu","号":"hao","司":"si","合":"he","同":"tong","君":"jun","启":"qi","味":"wei","和":"he","品":"pin","商":"shang","啤":"pi","器":"qi","四":"si","团":"tuan","国":"guo","圆":"yuan","圣":"sheng","场":"chang","城":"cheng","基":"ji","士":"shi","大":"da","天":"tian","奥":"ao","威":"wei","媒":"mei","子":"zi","孚":"fu","学":"xue","宁":"ning","宇":"yu","安":"an","宏":"hong","宝":"bao","客":"ke","密":"mi","富":"fu","寒":"han","导":"dao","小":"xiao","尔":"er","山":"shan","岛":"dao","峡":"xia","川":"chuan","州":"zhou","工":"gong","巨":"ju","广":"guang","康":"kang","建":"jian","影":"ying","微":"wei","德":"de","思":"si","恒":"heng","息":"xi","成":"cheng","技":"ji","投":"tou","拓":"tuo","招":"zhao","指":"zhi","捷":"jie","控":"kong","料":"liao","新":"xin","方":"fang","旭":"xu","时":"shi","昆":"kun","明":"ming","易":"yi","星":"xing","春":"chun","普":"pu","晶":"jing","智":"zhi","曙":"shu","有":"you","本":"ben","术":"shu","机":"ji","材":"cai","杭":"hang","杰":"jie","果":"guo","核":"he","格":"ge","桥":"qiao","正":"zheng","武":"wu","氏":"shi","民":"min","气":"qi","水":"shui","汇":"hui","江":"jiang","汽":"qi","汾":"fen","沈":"shen","沪":"hu","河":"he","油":"you","波":"bo","泰":"tai","泽":"ze","洋":"yang","浙":"zhe","浪":"lang","海":"hai","润":"run","液":"ye","深":"shen","渝":"yu","温":"wen","港":"gang","湖":"hu","源":"yuan","潮":"chao","澜":"lan","煤":"mei","爱":"ai","片":"pian","牧":"mu","物":"wu","特":"te","环":"huan","瑞":"rui","生":"sheng","申":"shen","电":"dian","疗":"liao","癀":"huang","百":"bai","益":"yi","盐":"yan","盛":"sheng","眼":"yan","石":"shi","矿":"kuang","硅":"gui","秋":"qiu","科":"ke","移":"yi","空":"kong","立":"li","精":"jing","紫":"zi","纪":"ji","纬":"wei","线":"xian","络":"luo","维":"wei","缘":"yuan","网":"wang","美":"mei","联":"lian","股":"gu","胎":"tai","胜":"sheng","能":"neng","航":"hang","舶":"bo","船":"chuan","色":"se","芒":"mang","芯":"xin","花":"hua","苏":"su","英":"ying","荆":"jing","荣":"rong","药":"yao","蓝":"lan","藏":"cang","虹":"hong","蛇":"she","行":"xing","西":"xi","证":"zheng","贡":"gong","财":"cai","货":"huo","资":"zi","赐":"ci","赛":"sai","赣":"gan","起":"qi","超":"chao","路":"lu","车":"che","轩":"xuan","轮":"lun","软":"ruan","载":"zai","达":"da","迈":"mai","远":"yuan","递":"di","通":"tong","速":"su","造":"zao","邦":"bang","邮":"you","都":"dou","酒":"jiu","金":"jin","针":"zhen","钢":"gang","钨":"wu","钴":"gu","铀":"you","铁":"tie","铜":"tong","铝":"lv","银":"yin","锂":"li","锋":"feng","锐":"rui","长":"zhang","门":"men","际":"ji","陵":"ling","隆":"long","集":"ji","零":"ling","青":"qing","韦":"wei","音":"yin","顺":"shun","领":"ling","风":"feng","飞":"fei","饮":"yin","首":"shou","高":"gao","鱼":"yu","鲁":"lu","鹏":"peng","黄":"huang","鼎":"ding","齐":"qi","龙":"long"};

function _pinyinOf(name) {
    let full = '';
    let initials = '';
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const py = CHAR_PY[ch];
        if (py) {
            full += py;
            initials += py.charAt(0);
        } else {
            const low = ch.toLowerCase();
            if (/[a-z0-9]/.test(low)) {
                full += low;
                initials += low;
            }
        }
    }
    return { full: full, initials: initials };
}

function _normCode(s) {
    return String(s || '').toLowerCase().replace(/^(sh|sz)/, '').replace(/^0+/, '');
}

function _stockMatches(stock, qRaw) {
    const q = String(qRaw || '').toLowerCase().replace(/\s+/g, '');
    if (!q) return false;
    const name = String(stock.name || '').toLowerCase();
    const code = String(stock.code || '').toLowerCase();
    if (name.includes(q) || code.includes(q)) return true;
    const qCode = _normCode(q);
    const codeBare = _normCode(code);
    if (qCode && (codeBare.includes(qCode) || code.includes(qCode))) return true;
    const py = _pinyinOf(stock.name);
    return py.full.includes(q) || py.initials.includes(q);
}

function _fillSuggestions(raw) {
    const stocks = gameState.stocksData || [];
    const matches = stocks.filter(s => _stockMatches(s, raw)).slice(0, 8);
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

function _selectStock(stock) {
    selectedStock = stock;
    document.getElementById('hindsightStockInput').value = `${stock.name} · ${stock.code}`;
    _closeSuggestions();
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

export function submitHindsight() {
    const btn = document.getElementById('hindsightSubmitBtn');
    if (!selectedStock) {
        const raw = document.getElementById('hindsightStockInput').value.trim().toLowerCase();
        const match = gameState.stocksData.find(s =>
            s.name.toLowerCase() === raw ||
            s.code.toLowerCase() === raw ||
            `${s.name} · ${s.code}`.toLowerCase() === raw ||
            _stockMatches(s, raw)
        );
        if (match) {
            _selectStock(match);
        } else {
            _setHint('hindsightStockHint', '请从列表中选择一只股票', 'error');
            document.getElementById('hindsightStockInput').focus();
            return;
        }
    }
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
    const qtyRaw = parseInt(document.getElementById('hindsightQtyInput')?.value ?? '10', 10);
    const qtyHands = (isNaN(qtyRaw) || qtyRaw < 1) ? 10 : qtyRaw;
    const kline = selectedStock.kline;
    filteredKline = kline.filter(d => d.date >= fromVal && d.date <= toVal);
    if (filteredKline.length < 5) {
        _setHint('hindsightDateHint',
            `该区间内交易数据不足（仅 ${filteredKline.length} 条），请扩大范围`,
            'error'
        );
        return;
    }
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

function _findBestSellAfterBuy(kline) {
    const buyIdx = 0;
    let peakIdx = 1;
    for (let i = 2; i < kline.length; i++) {
        if (kline[i].high > kline[peakIdx].high) peakIdx = i;
    }
    const buy = kline[buyIdx].close;
    const bestSell = kline[peakIdx].high;
    const bestReturn = buy ? (bestSell - buy) / buy : 0;
    return { buyIdx, sellIdx: peakIdx, peakIdx, buy, bestSell, bestReturn };
}

let _lastResultCache = null;

function _renderResults(qtyHands = 10) {
    const stock  = selectedStock;
    const kline  = filteredKline;
    const { buyIdx, sellIdx, peakIdx, buy, bestSell, bestReturn } = _findBestSellAfterBuy(kline);
    const buyDay  = kline[buyIdx];
    const sellDay = kline[sellIdx];
    const buyShares = qtyHands * 100;
    const earnedAmt = (bestSell - buy) * buyShares;
    const periodReturn = (kline[kline.length - 1].close / kline[0].close - 1) * 100;
    _lastResultCache = {
        stockName:  `${stock.name}（${stock.code}）`,
        dateRange:  `${kline[0].date} → ${kline[kline.length - 1].date}`,
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
    document.getElementById('hindsightResultStockName').textContent =
        `${stock.name}（${stock.code}）`;
    document.getElementById('hindsightResultDateRange').textContent =
        `${kline[0].date}  →  ${kline[kline.length - 1].date}`;
    document.getElementById('hindsightBuyPrice').textContent  = `¥ ${buy.toFixed(2)}`;
    document.getElementById('hindsightPeakPrice').textContent = `¥ ${bestSell.toFixed(2)}`;
    document.getElementById('hindsightSellPrice').textContent = `¥ ${bestSell.toFixed(2)}`;
    document.getElementById('hindsightBuyDate').textContent   = buyDay.date;
    document.getElementById('hindsightSellDate').textContent  = sellDay.date;
    document.getElementById('hindsightExitDate').textContent  = sellDay.date;
    document.getElementById('hindsightBuyQty').textContent    = `${buyShares.toLocaleString()} 股`;
    const periodEl = document.getElementById('hindsightComparePeriod');
    periodEl.textContent = (periodReturn >= 0 ? '+' : '') + periodReturn.toFixed(2) + '%';
    periodEl.className   = 'ar-data-value ' + (periodReturn >= 0 ? 'up' : 'down');
    const earnedEl    = document.getElementById('hindsightEarnedAmt');
    const earnedLabel = document.getElementById('hindsightEarnedLabel');
    if (earnedEl) {
        const isPos = earnedAmt >= 0;
        earnedEl.textContent = '¥ --';
        earnedEl.className   = 'ar-return-earned ' + (isPos ? 'earned-pos' : 'earned-neg');
        if (earnedLabel) earnedLabel.textContent = isPos ? '理论最多赚' : '理论最多亏';
    }
    const counterEl = document.getElementById('hindsightReturnCounter');
    if (counterEl) {
        counterEl.className = 'hindsight-return-counter' + (bestReturn < 0 ? ' counter-neg' : '');
    }
    document.getElementById('hindsightChartMeta').textContent =
        `${kline.length} 个交易日`;
    document.getElementById('hindsightFormPanel').style.display = 'none';
    document.getElementById('hindsightResultsPanel').classList.add('active');
    _drawChart(kline, buyIdx, sellIdx, peakIdx);
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
    hindsightChart.setOption(option);
    setTimeout(() => { if (hindsightChart && !hindsightChart.isDisposed()) hindsightChart.resize(); }, 60);
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
                            text: `${c.stockName} 理论${c.earnedAmt >= 0 ? '最多赚' : '最多亏'}`,
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
    const verb = c.earnedAmt >= 0 ? '最多赚' : '最多亏';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 以 ¥${c.buyPrice} 买入了 ${c.stockName}（${c.buyShares.toLocaleString()} 股），` +
        `若在 ${c.peakDate} 以最高价 ¥${c.peakPrice} 卖出，理论${verb} ¥${absAmt}。\n\n` +
        `你要不要也来回溯一下？\n` +
        `「股海沉浮·治愈档案馆」—— 治愈每一个错过大牛股的遗憾灵魂`;
    _copyText(text, null);
    alert('已复制分享文案（当前环境无法生成图片）');
}

export function hindsightCopy() {
    if (!_lastResultCache) return;
    const c = _lastResultCache;
    const absAmt = Math.abs(c.earnedAmt).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const verb = c.earnedAmt >= 0 ? '最多赚' : '最多亏';
    const retSign = c.bestReturn >= 0 ? '+' : '';
    const text =
        `在平行宇宙里，我在 ${c.buyDate} 以 ¥${c.buyPrice} 买入了 ${c.stockName}（${c.buyShares.toLocaleString()} 股），\n` +
        `若在 ${c.peakDate} 以最高价 ¥${c.peakPrice} 卖出，理论${verb} ¥${absAmt}。\n\n` +
        `区间最大涨幅 ${retSign}${(c.bestReturn * 100).toFixed(2)}%，区间持有 ${(c.periodReturn >= 0 ? '+' : '') + c.periodReturn.toFixed(2)}%。\n` +
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
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}
