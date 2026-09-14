// ========== HINDSIGHT PURE (no DOM / no gameState / no theme) ==========
// Behavior-preserving extraction of search, validation, window filter, and
// optimal buy→sell scoring used by the hindsight view (`js/hindsight.js`).

/** Pack-baked + fallback pinyin map used for stock name search. */
export const CHAR_PY = {"万":"wan","三":"san","上":"shang","世":"shi","业":"ye","东":"dong","中":"zhong","丰":"feng","九":"jiu","云":"yun","井":"jing","产":"chan","京":"jing","人":"ren","亿":"yi","今":"jin","仑":"lun","仔":"zai","代":"dai","件":"jian","份":"fen","众":"zhong","传":"chuan","伦":"lun","保":"bao","信":"xin","储":"chu","兆":"zhao","先":"xian","光":"guang","克":"ke","兖":"yan","全":"quan","公":"gong","六":"liu","兰":"lan","农":"nong","分":"fen","创":"chuang","利":"li","券":"quan","力":"li","办":"ban","动":"dong","勤":"qin","化":"hua","北":"bei","医":"yi","升":"sheng","华":"hua","南":"nan","卫":"wei","压":"ya","原":"yuan","厦":"sha","友":"you","变":"bian","口":"kou","古":"gu","号":"hao","司":"si","合":"he","同":"tong","君":"jun","启":"qi","味":"wei","和":"he","品":"pin","商":"shang","啤":"pi","器":"qi","四":"si","团":"tuan","国":"guo","圆":"yuan","圣":"sheng","场":"chang","城":"cheng","基":"ji","士":"shi","大":"da","天":"tian","奥":"ao","威":"wei","媒":"mei","子":"zi","孚":"fu","学":"xue","宁":"ning","宇":"yu","安":"an","宏":"hong","宝":"bao","客":"ke","密":"mi","富":"fu","寒":"han","导":"dao","小":"xiao","尔":"er","山":"shan","岛":"dao","峡":"xia","川":"chuan","州":"zhou","工":"gong","巨":"ju","广":"guang","康":"kang","建":"jian","影":"ying","微":"wei","德":"de","思":"si","恒":"heng","息":"xi","成":"cheng","技":"ji","投":"tou","拓":"tuo","招":"zhao","指":"zhi","捷":"jie","控":"kong","料":"liao","新":"xin","方":"fang","旭":"xu","时":"shi","昆":"kun","明":"ming","易":"yi","星":"xing","春":"chun","普":"pu","晶":"jing","智":"zhi","曙":"shu","有":"you","本":"ben","术":"shu","机":"ji","材":"cai","杭":"hang","杰":"jie","果":"guo","核":"he","格":"ge","桥":"qiao","正":"zheng","武":"wu","氏":"shi","民":"min","气":"qi","水":"shui","汇":"hui","江":"jiang","汽":"qi","汾":"fen","沈":"shen","沪":"hu","河":"he","油":"you","波":"bo","泰":"tai","泽":"ze","洋":"yang","浙":"zhe","浪":"lang","海":"hai","润":"run","液":"ye","深":"shen","渝":"yu","温":"wen","港":"gang","湖":"hu","源":"yuan","潮":"chao","澜":"lan","煤":"mei","爱":"ai","片":"pian","牧":"mu","物":"wu","特":"te","环":"huan","瑞":"rui","生":"sheng","申":"shen","电":"dian","疗":"liao","癀":"huang","百":"bai","益":"yi","盐":"yan","盛":"sheng","眼":"yan","石":"shi","矿":"kuang","硅":"gui","秋":"qiu","科":"ke","移":"yi","空":"kong","立":"li","精":"jing","紫":"zi","纪":"ji","纬":"wei","线":"xian","络":"luo","维":"wei","缘":"yuan","网":"wang","美":"mei","联":"lian","股":"gu","胎":"tai","胜":"sheng","能":"neng","航":"hang","舶":"bo","船":"chuan","色":"se","芒":"mang","芯":"xin","花":"hua","苏":"su","英":"ying","荆":"jing","荣":"rong","药":"yao","蓝":"lan","藏":"cang","虹":"hong","蛇":"she","行":"xing","西":"xi","证":"zheng","贡":"gong","财":"cai","货":"huo","资":"zi","赐":"ci","赛":"sai","赣":"gan","起":"qi","超":"chao","路":"lu","车":"che","轩":"xuan","轮":"lun","软":"ruan","载":"zai","达":"da","迈":"mai","远":"yuan","递":"di","通":"tong","速":"su","造":"zao","邦":"bang","邮":"you","都":"dou","酒":"jiu","金":"jin","针":"zhen","钢":"gang","钨":"wu","钴":"gu","铀":"you","铁":"tie","铜":"tong","铝":"lv","银":"yin","锂":"li","锋":"feng","锐":"rui","长":"zhang","门":"men","际":"ji","陵":"ling","隆":"long","集":"ji","零":"ling","青":"qing","韦":"wei","音":"yin","顺":"shun","领":"ling","风":"feng","飞":"fei","饮":"yin","首":"shou","高":"gao","鱼":"yu","鲁":"lu","鹏":"peng","黄":"huang","鼎":"ding","齐":"qi","龙":"long"};

export function pinyinOf(name, charPy = CHAR_PY) {
    let full = '';
    let initials = '';
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const py = charPy[ch];
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
    return { full, initials };
}

export function normCode(s) {
    return String(s || '').toLowerCase().replace(/^(sh|sz)/, '').replace(/^0+/, '');
}

/** Match stock by name / code / pack py·jp / fallback CHAR_PY. */
export function stockMatches(stock, qRaw, charPy = CHAR_PY) {
    const q = String(qRaw || '').toLowerCase().replace(/\s+/g, '');
    if (!q) return false;
    const name = String(stock.name || '').toLowerCase();
    const code = String(stock.code || '').toLowerCase();
    if (name.includes(q) || code.includes(q)) return true;
    const qCode = normCode(q);
    const codeBare = normCode(code);
    if (qCode && (codeBare.includes(qCode) || code.includes(qCode))) return true;
    const packPy = String(stock.py || '').toLowerCase();
    const packJp = String(stock.jp || '').toLowerCase();
    if ((packPy && packPy.includes(q)) || (packJp && packJp.includes(q))) return true;
    const py = pinyinOf(stock.name, charPy);
    return py.full.includes(q) || py.initials.includes(q);
}

/** Resolve typed input to a stock (exact name/code/display, else stockMatches). */
export function findStockMatch(stocks, raw, charPy = CHAR_PY) {
    const list = stocks || [];
    const q = String(raw || '').trim().toLowerCase();
    if (!q) return null;
    const exact = list.find((s) =>
        String(s.name || '').toLowerCase() === q ||
        String(s.code || '').toLowerCase() === q ||
        `${s.name} · ${s.code}`.toLowerCase() === q
    );
    if (exact) return exact;
    return list.find((s) => stockMatches(s, q, charPy)) || null;
}

export function filterStocksByQuery(stocks, raw, { limit = 12, charPy = CHAR_PY } = {}) {
    return (stocks || []).filter((s) => stockMatches(s, raw, charPy)).slice(0, limit);
}

/** Strict positive integer hands — rejects 0, 1e2, decimals, blanks. */
export function parseHands(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return { ok: false, err: '请输入买入数量（正整数手数）' };
    if (!/^\d+$/.test(s)) {
        return { ok: false, err: '买入数量须为正整数手数（不支持科学计数法或小数）' };
    }
    const n = parseInt(s, 10);
    if (n < 1) return { ok: false, err: '买入数量至少为 1 手' };
    return { ok: true, value: n };
}

/**
 * @returns {{ ok: true } | { ok: false, err: string }}
 */
export function validateDateRange(fromVal, toVal) {
    if (!fromVal || !toVal) return { ok: false, err: '请选择起止日期' };
    if (fromVal >= toVal) return { ok: false, err: '结束日期必须晚于开始日期' };
    return { ok: true };
}

/**
 * Filter kline to [from, to] inclusive (string date compare).
 * @returns {{ ok: true, kline: object[] } | { ok: false, err: string, count: number }}
 */
export function filterKlineWindow(kline, fromVal, toVal, { minBars = 5 } = {}) {
    const filtered = (kline || []).filter((d) => d.date >= fromVal && d.date <= toVal);
    if (filtered.length < minBars) {
        return {
            ok: false,
            count: filtered.length,
            err: `该区间内交易数据不足（仅 ${filtered.length} 条），请扩大范围`,
        };
    }
    return { ok: true, kline: filtered };
}

/**
 * Best executable sell after buy-day (index 0): highest high on days after buy.
 * Range high is across the whole window (for "区间最高价").
 */
export function findBestSellAfterBuy(kline) {
    const buyIdx = 0;
    let sellIdx = 1;
    for (let i = 2; i < kline.length; i++) {
        if (kline[i].high > kline[sellIdx].high) sellIdx = i;
    }
    let rangeHighIdx = 0;
    for (let i = 1; i < kline.length; i++) {
        if (kline[i].high > kline[rangeHighIdx].high) rangeHighIdx = i;
    }
    const buy = kline[buyIdx].close;
    const bestSell = kline[sellIdx].high;
    const rangeHigh = kline[rangeHighIdx].high;
    const bestReturn = buy ? (bestSell - buy) / buy : 0;
    return {
        buyIdx,
        sellIdx,
        peakIdx: sellIdx,
        rangeHighIdx,
        buy,
        bestSell,
        rangeHigh,
        bestReturn,
    };
}

/** Shares from hands (A-share lot size 100). */
export function handsToShares(qtyHands) {
    return qtyHands * 100;
}

export function periodReturnPct(kline) {
    if (!kline || kline.length < 2) return 0;
    return (kline[kline.length - 1].close / kline[0].close - 1) * 100;
}

export function earnedAmount(buy, bestSell, buyShares) {
    return (bestSell - buy) * buyShares;
}

/** Label for earned amount: green path = 最多赚; red = 最少亏. */
export function earnedAmountLabel(earnedAmt) {
    return earnedAmt >= 0 ? '理论最多赚' : '理论最少亏';
}

/**
 * Full analysis payload for the results panel (no DOM).
 * @param {{ kline: object[], qtyHands: number, stock: { name: string, code: string } }} input
 */
export function computeHindsightAnalysis({ kline, qtyHands, stock }) {
    const scores = findBestSellAfterBuy(kline);
    const buyDay = kline[scores.buyIdx];
    const sellDay = kline[scores.sellIdx];
    const buyShares = handsToShares(qtyHands);
    const earnedAmt = earnedAmount(scores.buy, scores.bestSell, buyShares);
    const periodReturn = periodReturnPct(kline);
    return {
        ...scores,
        buyDay,
        sellDay,
        buyShares,
        earnedAmt,
        periodReturn,
        earnedLabel: earnedAmountLabel(earnedAmt),
        stockName: `${stock.name}（${stock.code}）`,
        dateRange: `${kline[0].date} → ${kline[kline.length - 1].date}`,
        barCount: kline.length,
    };
}

export const DEFAULT_COMMODITIES = [
    { icon: '🧋', name: '杯奶茶', price: 20 },
    { icon: '☕', name: '杯瑞幸咖啡', price: 10 },
    { icon: '📱', name: '部 iPhone 17 Pro', price: 9000 },
    { icon: '✈️', name: '张机票（经济舱）', price: 2000 },
    { icon: '🏖️', name: '次出境游', price: 12000 },
    { icon: '🏠', name: '个月小城市首付', price: 150000 },
    { icon: '📚', name: '本《聪明的投资者》', price: 68 },
];

/**
 * Affordances for positive earnedAmt only (matches view: Math.max(0, earned)).
 * @returns {{ icon: string, name: string, n: number, verb: string }[]}
 */
export function commodityAffordances(earnedAmt, items = DEFAULT_COMMODITIES) {
    const gained = Math.max(0, earnedAmt);
    const rows = [];
    for (const it of items) {
        const n = Math.floor(gained / it.price + 1e-9);
        if (n < 1) continue;
        const verb = it.name.includes('首付') ? '多出' : '多买';
        rows.push({ icon: it.icon, name: it.name, n, verb });
    }
    return rows;
}

/**
 * Validate form inputs + build filtered window. Stocks list passed in (not gameState).
 * @returns {{ ok: true, stock, qtyHands, kline } | { ok: false, field: 'stock'|'date'|'qty', err: string }}
 */
export function resolveHindsightWindow({
    stocks,
    selectedStock,
    stockInputRaw,
    fromVal,
    toVal,
    qtyRaw,
    minBars = 5,
}) {
    let stock = selectedStock;
    if (!stock) {
        stock = findStockMatch(stocks, stockInputRaw);
        if (!stock) {
            return { ok: false, field: 'stock', err: '请从列表中选择一只股票' };
        }
    }
    const dates = validateDateRange(fromVal, toVal);
    if (!dates.ok) return { ok: false, field: 'date', err: dates.err };
    const qtyParsed = parseHands(qtyRaw);
    if (!qtyParsed.ok) return { ok: false, field: 'qty', err: qtyParsed.err };
    const win = filterKlineWindow(stock.kline, fromVal, toVal, { minBars });
    if (!win.ok) return { ok: false, field: 'date', err: win.err };
    return { ok: true, stock, qtyHands: qtyParsed.value, kline: win.kline };
}
