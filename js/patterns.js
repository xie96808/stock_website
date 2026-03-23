// ========== PATTERN KNOWLEDGE BASE ==========

export const QUIZ_PATTERNS = [
    // K线形态 (18)
    { name: '大阳线', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:6px"></div><div class="bd" style="height:50px"></div><div class="wl" style="height:6px"></div></div>',
      desc: '实体长、上下影线短的阳线。表示多方力量强劲，买盘从开盘一路推升至收盘。出现在低位或上升趋势中是强烈的做多信号。' },
    { name: '大阴线', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:6px"></div><div class="bd" style="height:50px"></div><div class="wl" style="height:6px"></div></div>',
      desc: '实体长、上下影线短的阴线。表示空方力量占据绝对优势，卖盘从开盘持续打压至收盘。出现在高位或下行趋势中是离场信号。' },
    { name: '锤子线', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck g" style="opacity:0.4"><div class="wu" style="height:4px"></div><div class="bd" style="height:18px"></div><div class="wl" style="height:6px"></div></div><div class="ck g" style="opacity:0.5"><div class="wu" style="height:3px"></div><div class="bd" style="height:14px"></div><div class="wl" style="height:8px"></div></div><div class="ck r"><div class="wu" style="height:3px"></div><div class="bd" style="height:12px"></div><div class="wl" style="height:40px"></div></div>',
      desc: '下影线很长（至少为实体2倍），上影线极短或没有。出现在下跌末端，说明空方将价格打下去后被多方强力拉回，是底部反转信号。' },
    { name: '射击之星', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck r" style="opacity:0.4"><div class="wu" style="height:6px"></div><div class="bd" style="height:18px"></div><div class="wl" style="height:3px"></div></div><div class="ck r" style="opacity:0.5"><div class="wu" style="height:8px"></div><div class="bd" style="height:14px"></div><div class="wl" style="height:3px"></div></div><div class="ck g"><div class="wu" style="height:40px"></div><div class="bd" style="height:12px"></div><div class="wl" style="height:3px"></div></div>',
      desc: '上影线很长，实体小且位于底部。出现在上涨末端，说明多方尝试拉升但遭到强烈抛压打回，是顶部反转的警告信号。' },
    { name: '十字星', signal: '中性', signalCls: 'neutral', category: 'kline',
      illust: '<div class="ck d"><div class="wu" style="height:25px"></div><div class="bd" style="height:2px"></div><div class="wl" style="height:25px"></div></div>',
      desc: '开盘价和收盘价几乎相同，上下影线等长。代表多空力量达到平衡。在趋势末端出现往往预示着反转，需结合前后K线确认方向。' },
    { name: '看涨吞没', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:6px"></div><div class="bd" style="height:22px"></div><div class="wl" style="height:6px"></div></div><div class="ck r"><div class="wu" style="height:4px"></div><div class="bd" style="height:40px"></div><div class="wl" style="height:4px"></div></div>',
      desc: '一根大阳线完全包住前一根阴线的实体。多方以压倒性力量反攻，是下跌趋势中最可靠的反转形态之一，阳线实体越大信号越强。' },
    { name: '看跌吞没', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:6px"></div><div class="bd" style="height:22px"></div><div class="wl" style="height:6px"></div></div><div class="ck g"><div class="wu" style="height:4px"></div><div class="bd" style="height:40px"></div><div class="wl" style="height:4px"></div></div>',
      desc: '一根大阴线完全包住前一根阳线的实体。空方全面压制多方，上涨趋势中出现预示着行情可能见顶，尤其伴随放量时更需警惕。' },
    { name: '早晨之星', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:4px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:4px"></div></div><div class="ck d" style="margin-top:16px"><div class="wu" style="height:10px"></div><div class="bd" style="height:3px"></div><div class="wl" style="height:10px"></div></div><div class="ck r"><div class="wu" style="height:4px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:4px"></div></div>',
      desc: '阴线 + 低位十字星 + 阳线的三日组合。中间的十字星表示空方力量衰竭，第三天阳线确认多方接管。是经典的底部反转形态。' },
    { name: '黄昏之星', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:4px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:4px"></div></div><div class="ck d" style="margin-bottom:16px"><div class="wu" style="height:10px"></div><div class="bd" style="height:3px"></div><div class="wl" style="height:10px"></div></div><div class="ck g"><div class="wu" style="height:4px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:4px"></div></div>',
      desc: '阳线 + 高位十字星 + 阴线的三日组合。中间的十字星显示多方动力枯竭，第三天阴线确认空方夺回主导权。是可靠的顶部反转信号。' },
    { name: '红三兵', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:3px"></div><div class="bd" style="height:22px"></div><div class="wl" style="height:4px"></div></div><div class="ck r" style="margin-bottom:6px"><div class="wu" style="height:3px"></div><div class="bd" style="height:26px"></div><div class="wl" style="height:3px"></div></div><div class="ck r" style="margin-bottom:14px"><div class="wu" style="height:2px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:3px"></div></div>',
      desc: '连续三根阳线，每根收盘价逐步抬高，实体饱满、上下影线短。出现在底部区域是强烈的趋势反转信号，多方力量持续增强，适合跟随做多。' },
    { name: '三只乌鸦', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck g" style="margin-bottom:14px"><div class="wu" style="height:3px"></div><div class="bd" style="height:22px"></div><div class="wl" style="height:4px"></div></div><div class="ck g" style="margin-bottom:6px"><div class="wu" style="height:3px"></div><div class="bd" style="height:26px"></div><div class="wl" style="height:3px"></div></div><div class="ck g"><div class="wu" style="height:2px"></div><div class="bd" style="height:30px"></div><div class="wl" style="height:3px"></div></div>',
      desc: '连续三根阴线，每根收盘价逐步走低。与红三兵相反，是顶部区域的强烈看跌信号，表示空方已完全掌控局面，应及时止盈或止损离场。' },
    { name: '乌云盖顶', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:4px"></div><div class="bd" style="height:36px"></div><div class="wl" style="height:4px"></div></div><div class="ck g" style="margin-bottom:8px"><div class="wu" style="height:3px"></div><div class="bd" style="height:28px"></div><div class="wl" style="height:10px"></div></div>',
      desc: '先出现一根大阳线，次日高开后大幅回落，阴线收盘深入阳线实体过半。乌云笼罩意味着上涨动力被空方扼杀，是可靠的见顶信号。' },
    { name: '刺透形态', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:4px"></div><div class="bd" style="height:36px"></div><div class="wl" style="height:4px"></div></div><div class="ck r" style="margin-top:8px"><div class="wu" style="height:10px"></div><div class="bd" style="height:28px"></div><div class="wl" style="height:3px"></div></div>',
      desc: '与乌云盖顶相反。先出现一根大阴线，次日低开后强力反弹，阳线收盘升入阴线实体过半。在下跌趋势中出现是底部反转的积极信号。' },
    { name: '看涨孕线', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:4px"></div><div class="bd" style="height:42px"></div><div class="wl" style="height:4px"></div></div><div class="ck r"><div class="wu" style="height:6px"></div><div class="bd" style="height:16px"></div><div class="wl" style="height:6px"></div></div>',
      desc: '大阴线后跟随一根小阳线，小阳线实体完全被前一根阴线包含。说明下跌动能减弱，多方开始试探反攻。需次日阳线确认后方可介入。' },
    { name: '看跌孕线', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:4px"></div><div class="bd" style="height:42px"></div><div class="wl" style="height:4px"></div></div><div class="ck g"><div class="wu" style="height:6px"></div><div class="bd" style="height:16px"></div><div class="wl" style="height:6px"></div></div>',
      desc: '大阳线后跟随一根小阴线，小阴线实体完全被前一根阳线包含。表明上涨动力开始衰减，应警惕趋势逆转，可考虑减仓或设置止损。' },
    { name: 'T字线', signal: '看涨', signalCls: 'bullish', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:0px"></div><div class="bd" style="height:3px"></div><div class="wl" style="height:42px"></div></div>',
      desc: '开盘价、收盘价与最高价相同，仅有下影线，形如"T"字。说明盘中大幅下探后被完全收回，多方力量极强。出现在底部是强烈反转信号。' },
    { name: '倒T字线', signal: '看跌', signalCls: 'bearish', category: 'kline',
      illust: '<div class="ck g"><div class="wu" style="height:42px"></div><div class="bd" style="height:3px"></div><div class="wl" style="height:0px"></div></div>',
      desc: '开盘价、收盘价与最低价相同，仅有上影线，形如倒"T"字。说明盘中冲高后被完全打回，空方力量极强。出现在顶部预示下跌风险。' },
    { name: '螺旋桨', signal: '中性', signalCls: 'neutral', category: 'kline',
      illust: '<div class="ck r"><div class="wu" style="height:22px"></div><div class="bd" style="height:10px"></div><div class="wl" style="height:22px"></div></div>',
      desc: '实体较小而上下影线都很长的K线，形似螺旋桨。表示多空双方激烈交锋，市场分歧极大。单独出现意义有限，若出现在趋势末端则暗示变盘在即。' },
    // 成交量形态 (8)
    { name: '放量上涨', signal: '看涨', signalCls: 'bullish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,60 60,50 100,38 140,28 180,15" stroke="#e05252" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar r" style="height:14px"></div><div class="vbar r" style="height:22px"></div><div class="vbar r" style="height:30px"></div><div class="vbar r" style="height:42px"></div><div class="vbar r" style="height:56px"></div>',
      desc: '价格上涨伴随成交量逐步放大，说明越来越多的资金入场追捧，量价齐升是最健康的上涨模式，趋势延续性强。' },
    { name: '缩量回调', signal: '看涨', signalCls: 'bullish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,25 60,30 100,38 140,44 180,48" stroke="#3db86a" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar g" style="height:48px"></div><div class="vbar g" style="height:36px"></div><div class="vbar g" style="height:24px"></div><div class="vbar g" style="height:16px"></div><div class="vbar g" style="height:10px"></div>',
      desc: '价格小幅回落但成交量逐渐萎缩。说明卖出意愿不强，持股者惜售。在上升趋势中的缩量回调是健康的技术性修正，常是低吸良机。' },
    { name: '放量下跌', signal: '看跌', signalCls: 'bearish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,15 60,28 100,42 140,54 180,65" stroke="#3db86a" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar g" style="height:14px"></div><div class="vbar g" style="height:24px"></div><div class="vbar g" style="height:35px"></div><div class="vbar g" style="height:48px"></div><div class="vbar g" style="height:60px"></div>',
      desc: '价格下跌同时成交量持续放大，说明恐慌性抛售加剧，大量资金夺路而逃。这是最危险的量价形态，应果断止损回避。' },
    { name: '地量见底', signal: '看涨', signalCls: 'bullish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,30 50,42 80,52 110,58 140,55 170,46 195,38" stroke="#9a9690" stroke-width="1.5" fill="none" opacity="0.4" stroke-dasharray="4,3"/></svg><div class="vbar m" style="height:18px"></div><div class="vbar m" style="height:12px"></div><div class="vbar m" style="height:7px"></div><div class="vbar m" style="height:4px"></div><div class="vbar m" style="height:5px"></div><div class="vbar r" style="height:10px"></div><div class="vbar r" style="height:18px"></div>',
      desc: '"地量之后有地价"。成交量萎缩到极低水平，说明抛压已近枯竭。随后若出现温和放量阳线，往往是底部确立的标志。' },
    { name: '天量见顶', signal: '看跌', signalCls: 'bearish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,40 60,30 100,18 130,15 160,22 190,35" stroke="#e05252" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar r" style="height:18px"></div><div class="vbar r" style="height:28px"></div><div class="vbar r" style="height:65px"></div><div class="vbar g" style="height:40px"></div><div class="vbar g" style="height:22px"></div>',
      desc: '"天量之后有天价"。成交量突然放出历史级巨量，往往是主力资金大规模出货的标志。若伴随长上影线或高位阴线，是强烈的见顶信号，应果断离场。' },
    { name: '温和放量', signal: '看涨', signalCls: 'bullish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,55 50,50 80,46 110,42 140,37 170,33 195,28" stroke="#e05252" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar r" style="height:12px"></div><div class="vbar r" style="height:16px"></div><div class="vbar r" style="height:20px"></div><div class="vbar r" style="height:25px"></div><div class="vbar r" style="height:30px"></div><div class="vbar r" style="height:36px"></div>',
      desc: '成交量像上台阶一样逐步温和放大，而非突然暴增。说明资金有序入场，筹码交换充分，是最健康的上涨形态。这种"量堆"出来的涨势持续性最强。' },
    { name: '量价背离（看跌）', signal: '看跌', signalCls: 'bearish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,45 60,35 100,26 140,20 180,15" stroke="#e05252" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar r" style="height:50px"></div><div class="vbar r" style="height:40px"></div><div class="vbar r" style="height:30px"></div><div class="vbar r" style="height:20px"></div><div class="vbar r" style="height:12px"></div>',
      desc: '价格持续创新高，但成交量反而逐渐萎缩。说明跟风买入的资金越来越少，上涨缺乏量能支撑。这是"顶背离"的经典信号，需警惕随时可能出现的回调。' },
    { name: '量价背离（看涨）', signal: '看涨', signalCls: 'bullish', category: 'volume',
      illust: '<svg viewBox="0 0 200 80"><polyline points="20,20 60,32 100,42 140,50 180,55" stroke="#3db86a" stroke-width="2" fill="none" opacity="0.5"/></svg><div class="vbar g" style="height:50px"></div><div class="vbar g" style="height:38px"></div><div class="vbar g" style="height:26px"></div><div class="vbar g" style="height:16px"></div><div class="vbar g" style="height:10px"></div>',
      desc: '价格持续创新低，但成交量反而逐步减少。说明抛售力量正在枯竭，卖无可卖。这是"底背离"信号，预示下跌接近尾声，后续可能出现反弹甚至反转。' },
    // 走势形态 (5)
    { name: '多头排列', signal: '看涨', signalCls: 'bullish', category: 'trend',
      illust: '<svg viewBox="0 0 200 80"><polyline points="10,62 60,48 110,35 160,24 190,18" stroke="#f5c542" stroke-width="2.5" fill="none"/><polyline points="10,66 60,54 110,42 160,32 190,27" stroke="#42a5f5" stroke-width="2" fill="none"/><polyline points="10,70 60,60 110,50 160,42 190,38" stroke="#ab47bc" stroke-width="2" fill="none"/><text x="194" y="18" fill="#f5c542" font-size="9" font-family="JetBrains Mono">5</text><text x="194" y="28" fill="#42a5f5" font-size="9" font-family="JetBrains Mono">10</text><text x="194" y="39" fill="#ab47bc" font-size="9" font-family="JetBrains Mono">20</text></svg>',
      desc: 'MA5 在最上方、MA10 居中、MA20 在最下方，三线同步上行。这是最强的趋势信号，表明各周期投资者一致看多，适合持股不动。' },
    { name: '空头排列', signal: '看跌', signalCls: 'bearish', category: 'trend',
      illust: '<svg viewBox="0 0 200 80"><polyline points="10,18 60,32 110,45 160,56 190,62" stroke="#f5c542" stroke-width="2.5" fill="none"/><polyline points="10,14 60,26 110,38 160,48 190,53" stroke="#42a5f5" stroke-width="2" fill="none"/><polyline points="10,10 60,20 110,30 160,38 190,42" stroke="#ab47bc" stroke-width="2" fill="none"/><text x="194" y="63" fill="#f5c542" font-size="9" font-family="JetBrains Mono">5</text><text x="194" y="54" fill="#42a5f5" font-size="9" font-family="JetBrains Mono">10</text><text x="194" y="43" fill="#ab47bc" font-size="9" font-family="JetBrains Mono">20</text></svg>',
      desc: 'MA5 在最下方、MA10 居中、MA20 在最上方，三线同步下行。各周期投资者一致看空，应空仓观望，切勿盲目抄底。' },
    { name: 'W底', signal: '看涨', signalCls: 'bullish', category: 'trend',
      illust: '<svg viewBox="0 0 200 80"><polyline points="15,20 40,35 65,58 85,42 105,25 125,42 150,58 170,35 195,15" stroke="var(--accent-cyan)" stroke-width="2.5" fill="none"/><line x1="15" y1="25" x2="195" y2="25" stroke="var(--accent-cyan)" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/><text x="100" y="75" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="JetBrains Mono">颈线</text></svg>',
      desc: '价格两次探底到相近价位后反弹，形成"W"形。当价格突破两次反弹的高点（颈线）时双底成立，上涨空间通常等于底部到颈线的距离。' },
    { name: 'M顶', signal: '看跌', signalCls: 'bearish', category: 'trend',
      illust: '<svg viewBox="0 0 200 80"><polyline points="15,60 40,45 65,22 85,38 105,55 125,38 150,22 170,45 195,65" stroke="var(--accent-cyan)" stroke-width="2.5" fill="none"/><line x1="15" y1="55" x2="195" y2="55" stroke="var(--accent-cyan)" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/><text x="100" y="75" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="JetBrains Mono">颈线</text></svg>',
      desc: '价格两次冲高到相近价位后回落，形成"M"形。当价格跌破两次回落的低点（颈线）时双顶成立，是明确的卖出信号。' },
    { name: '上升三角形', signal: '看涨', signalCls: 'bullish', category: 'trend',
      illust: '<svg viewBox="0 0 200 80"><line x1="15" y1="20" x2="165" y2="20" stroke="var(--accent-cyan)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/><polyline points="15,65 50,20 70,50 105,20 120,40 155,20" stroke="var(--accent-cyan)" stroke-width="2.5" fill="none"/><polyline points="155,20 175,12 195,5" stroke="#e05252" stroke-width="2.5" fill="none" stroke-dasharray="5,3"/><text x="180" y="72" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="JetBrains Mono">突破</text></svg>',
      desc: '顶部压力线水平、底部支撑线逐步抬高，形成收敛三角形。买方力量逐渐增强，一旦放量突破上方压力线，往往开启快速上涨。' },
];

// Build PATTERN_KB from QUIZ_PATTERNS for backward compatibility
export const PATTERN_KB = {};
QUIZ_PATTERNS.forEach(p => { PATTERN_KB[p.name] = p; });

export function kbTag(name) {
    if (!PATTERN_KB[name]) return name;
    return '<span class="kb-link" data-pattern="' + name + '" onmouseenter="showKBPopup(this)" onmouseleave="hideKBPopup()">' + name + '</span>';
}

export function showKBPopup(el) {
    const key = el.getAttribute('data-pattern');
    const p = PATTERN_KB[key];
    if (!p) return;
    const popup = document.getElementById('kbPopup');
    popup.querySelector('.kb-popup-name').textContent = key;
    const sig = popup.querySelector('.kb-popup-signal');
    sig.textContent = p.signal;
    sig.className = 'kb-popup-signal ' + p.signalCls;
    popup.querySelector('.kb-popup-illust').innerHTML = p.illust;
    popup.querySelector('.kb-popup-desc').textContent = p.desc;

    const rect = el.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 8;
    // Keep within viewport
    if (left + 310 > window.innerWidth) left = window.innerWidth - 320;
    if (left < 8) left = 8;
    if (top + 250 > window.innerHeight) top = rect.top - 250;
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.classList.add('visible');
}

export function hideKBPopup() {
    document.getElementById('kbPopup').classList.remove('visible');
}
