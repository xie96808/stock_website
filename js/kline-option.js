// ========== Shared K-line ECharts option builder (game + result) ==========
import {
    calculateMA,
    calculateMACD,
    buildDayIndexLabels,
    MA_DAY_LABELS,
    MA_DAY_COLORS,
} from './utils.js';

/** 复盘 drag-to-zoom slider strip (px). Was 18px tall at bottom 2. */
export const ZOOM_SLIDER_HEIGHT = 30;
export const ZOOM_SLIDER_BOTTOM = 8;

const PVP_ME_COLOR = '#8a7350';
const PVP_OPP_COLOR = '#4d6278';

function pvpNiceStep(span) {
    const target = Math.max(span / 8, 1e-6);
    const pow = 10 ** Math.floor(Math.log10(target));
    const n = target / pow;
    const unit = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return unit * pow;
}

// PvP keeps numeric ticks, but reserves no room for a rotated axis title.
const PVP_GRID_LEFT = 36;
const PVP_GRID_RIGHT = 18;

function pvpAxisBound(value, ratio, toward) {
    const span = (value.max - value.min) || Math.abs(value.max) || 1;
    const raw = toward > 0 ? value.max + span * ratio : value.min - span * ratio;
    const step = pvpNiceStep(span);
    const snapped = toward > 0 ? Math.ceil(raw / step) * step : Math.floor(raw / step) * step;
    const digits = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
    const factor = 10 ** digits;
    return Math.round(snapped * factor) / factor;
}

/**
 * PvP: own red/green text pills, opponent small hollow directional triangles.
 * Valuation on d30 is day-30 MTM of leftover shares → label「期末估值」.
 */
function pvpMarkerPoints(bars, marks) {
    const points = [];
    // Keep text-pill lanes unchanged. Small opponent pins start close to their
    // own candle; the pixel pass handles only real overlap, not nearby bar indices.
    const BASE_GAP = 16;
    const STACK_GAP = 3;
    const NEAR_BARS = 4;
    const placedSide = { above: [], below: [] };
    const placed = [];
    for (const mark of Array.isArray(marks) ? marks : []) {
        const index = bars.findIndex((item) => item && item.label === mark.label);
        if (index < 0 || !mark.kind) continue;
        placed.push({ mark, index, bar: bars[index] });
    }
    placed.sort((a, b) => a.index - b.index);
    for (const { mark, index, bar } of placed) {
        const mine = mark.side === 'me';
        const valuation = mark.kind === 'valuation';
        const sell = mark.kind === 'sell';
        const buy = mark.kind === 'buy';
        let label;
        let color;
        let bg;
        if (valuation) {
            label = '期末估值';
            color = '#8a6a20';
            bg = 'rgba(245, 197, 66, 0.92)';
        } else if (buy) {
            label = mine ? '买' : '对手买';
            color = '#fffaf3';
            // Mine stays 正红; opponent uses indigo so the two buys do not look alike.
            bg = mine ? '#e05252' : '#2f6fed';
        } else {
            label = mine ? '卖' : '对手卖';
            color = '#f7fff4';
            // Mine stays 负绿; opponent uses violet.
            bg = mine ? '#3db86a' : '#7c4dff';
        }
        const above = valuation || sell;
        const opponent = !mine && !valuation;
        const size = valuation ? [52, 18] : mine ? [28, 18] : [12, 12];
        const height = size[1];
        const side = above ? placedSide.above : placedSide.below;
        let inner = opponent ? 4 : BASE_GAP;
        if (!opponent) {
            for (const other of side) {
                if (Math.abs(other.index - index) < NEAR_BARS) inner = Math.max(inner, other.outer + STACK_GAP);
            }
            side.push({ index, outer: inner + height });
        }
        const center = inner + height / 2;
        points.push({
            name: label,
            coord: [mark.label, above ? bar.high : bar.low],
            value: label,
            symbol: opponent ? 'triangle' : 'roundRect',
            symbolRotate: opponent && sell ? 180 : 0,
            pvpOpponent: opponent,
            symbolSize: size,
            // Vertical only. A sideways pixel shift lands on the next candle when bars are narrow.
            symbolOffset: [0, above ? -center : center],
            itemStyle: {
                color: opponent ? 'transparent' : bg,
                borderColor: opponent ? bg : valuation ? '#c9a227' : (buy ? (mine ? '#e05252' : '#1e4fc4') : (mine ? '#3db86a' : '#5b2fd6')),
                borderWidth: opponent ? 1.5 : 1,
            },
            label: {
                show: !opponent,
                formatter: '{c}',
                color,
                fontSize: 11,
                fontWeight: 'bold',
                backgroundColor: 'transparent',
                borderWidth: 0,
                padding: 0,
                distance: 0,
                position: 'inside',
            },
        });
    }
    return points;
}

/**
 * PVP-04, pixel pass. Own text pills keep their index lanes; opponent pins start at the wick.
 * Only actual pixel overlap moves a marker farther out. Text pills may flip at the canvas edge;
 * opponent buy/sell pins retain their above/below direction and exact candle x coordinate.
 * It always starts from the pristine offsets in `baseData`, so repeated runs never compound.
 */
const relaxState = new WeakMap();

export function relaxPvpMarkers(chart, baseData) {
    if (!chart || !Array.isArray(baseData) || !baseData.length) return;
    const state = relaxState.get(chart) || { sig: '' };
    state.base = baseData;
    relaxState.set(chart, state);
    const run = () => {
        const base = state.base;
        const height = chart.getHeight ? chart.getHeight() : 0;
        if (!base || !height) return;
        const placed = [];
        const next = [];
        // Give the tiny date pins first choice of their wick-adjacent position.
        for (const item of [...base].sort((a, b) => Number(!!b.pvpOpponent) - Number(!!a.pvpOpponent))) {
            const w = item.symbolSize[0];
            const h = item.symbolSize[1];
            let px;
            try {
                px = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, item.coord);
            } catch (e) {
                px = null;
            }
            if (!px || !Number.isFinite(px[0]) || !Number.isFinite(px[1])) { next.push(item); continue; }
            const baseOffset = item.symbolOffset[1];
            const tryPlace = (sign) => {
                let cy = px[1] + sign * Math.abs(baseOffset);
                for (let i = 0; i < 14; i += 1) {
                    const hit = placed.find((r) => Math.abs(px[0] - r.cx) < (w + r.w) / 2 - 1 && Math.abs(cy - r.cy) < (h + r.h) / 2 + 1);
                    if (!hit) break;
                    cy = sign < 0 ? hit.cy - (h + hit.h) / 2 - 2 : hit.cy + (h + hit.h) / 2 + 2;
                }
                return cy;
            };
            const sign = baseOffset < 0 ? -1 : 1;
            let cy = tryPlace(sign);
            if (!item.pvpOpponent && (cy - h / 2 < 2 || cy + h / 2 > height - 2)) {
                const alt = tryPlace(-sign);
                if (alt - h / 2 >= 2 && alt + h / 2 <= height - 2) cy = alt;
            }
            placed.push({ cx: px[0], cy, w, h });
            next.push({ ...item, symbolOffset: [0, Math.round(cy - px[1])] });
        }
        const sig = next.map((n) => n.symbolOffset[1]).join(',');
        if (sig === state.sig) return;
        state.sig = sig;
        chart.setOption({ series: [{ markPoint: { data: next } }] });
    };
    state.run = run;
    if (!state.bound) {
        state.bound = true;
        chart.on('finished', () => { if (state.run) state.run(); });
    }
    state.sig = '';
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
}

/** History categories stay `hN` for mark lookup. The axis does not print that prefix. */
function pvpAxisText(value) {
    const text = String(value ?? "");
    if (/^h\d+$/i.test(text)) return "";
    const day = /^d(\d+)$/i.exec(text);
    return day ? day[1] : "";
}

function pvpTipTitle(label) {
    const day = pvpAxisText(label);
    return day ? `第${day}天` : "";
}

function pvpSignalMarks(bars, historyLength, bestPoints) {
    if (!bestPoints) return [];
    const points = [];
    const push = (list, buy) => {
        for (const point of list || []) {
            const bar = bars[historyLength + point.day - 1];
            if (!bar || !bar.label) continue;
            points.push({
                name: buy ? "信号买" : "信号卖",
                coord: [bar.label, buy ? bar.low : bar.high],
                value: buy ? "↑买" : "↓卖",
                symbol: "roundRect",
                symbolSize: [34, 16],
                symbolOffset: [0, buy ? 18 : -18],
                itemStyle: {
                    color: buy ? "rgba(245, 197, 66, 0.92)" : "rgba(167, 139, 250, 0.92)",
                    borderColor: buy ? "#c9a227" : "#7c6bc4",
                    borderWidth: 1,
                },
                label: {
                    show: true,
                    formatter: "{c}",
                    color: "#2c2824",
                    fontSize: 10,
                    fontWeight: "bold",
                    position: "inside",
                    distance: 0,
                    padding: 0,
                    backgroundColor: "transparent",
                    borderWidth: 0,
                },
            });
        }
    };
    push(bestPoints.buys, true);
    push(bestPoints.sells, false);
    return points;
}

/**
 * Build ECharts option for the dual-panel K-line (candles + volume + MA).
 * Pure option object — no chart.init / setOption / DOM (except optional syncHover hook
 * invoked only from the tooltip formatter when provided by the live game adapter).
 *
 * @param {object} vm
 * @param {object[]} vm.bars - visible / full OHLC bars
 * @param {number} vm.historyLength - pre-game history bar count (for trade day coords)
 * @param {object[]} [vm.trades]
 * @param {{ buys: object[], sells: object[] }|null} [vm.bestPoints] - result review markers
 * @param {object|null} [vm.valuation] - day-30 MTM marker
 * @param {'game'|'result'} [vm.mode='game']
 * @param {Record<string, boolean>|null} [vm.maSelected] - game legend selected map
 * @param {(bar: object, idx: number) => void|null} [vm.syncHover] - game OHLC panel sync
 * @param {boolean} [vm.resetDataZoom=false] - force dataZoom window back to full range
 * @param {boolean} [vm.showDataZoomSlider] - desktop slider; default true for result, false for game
 * @param {boolean} [vm.resetDataZoom=true] - PvP: false keeps the player's zoom; true shows every bar
 */
// MA legend (5/10/20/30日线) metrics. One fixed set for every width, sized so the four entries stay on a
// single row inside the narrowest phone chart (~282px at 360 CSS px). Never width-dependent: a legend that
// reflows would change the chart's top inset and make the plot jump (see the K-line size-stability rules).
export const LEGEND_FONT_PX = 10;
export const LEGEND_ITEM_W = 14;
export const LEGEND_ITEM_GAP = 8;

export function buildKlineOption(vm) {
    const {
        bars,
        historyLength = 0,
        trades = [],
        bestPoints = null,
        valuation = null,
        mode = 'game',
        pvpMarks = null,
        maSelected = null,
        syncHover = null,
        resetDataZoom = false,
        showDataZoomSlider,
        showLegend,
        pvpBottom = null, // 'volume' | 'macd' — battle two-pane indicator toggle
    } = vm;

    const isResult = mode === 'result';
    const isPvp = mode === 'pvp';
    const paperChart = isResult || isPvp;
    const bottomMode = isPvp && (pvpBottom === 'macd' || pvpBottom === 'volume') ? pvpBottom : null;
    const pvpTwoPane = !!bottomMode;
    const legendOn = showLegend != null ? !!showLegend : true;
    const dayLabels = isPvp
        ? bars.map((bar, index) => (bar && bar.label) || String(index + 1))
        : buildDayIndexLabels(bars.length);
    const startDayLabel = String(historyLength + 1);
    const ohlc = bars.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = bars.map(d => d.volume);
    const volumeColors = bars.map(d => d.close >= d.open ? '#e05252' : '#3db86a');

    const ma5 = calculateMA(bars, 5);
    const ma10 = calculateMA(bars, 10);
    const ma20 = calculateMA(bars, 20);
    const ma30 = calculateMA(bars, 30);
    const macd = isPvp ? calculateMACD(bars) : null;

    const markPoints = isPvp
        ? [...pvpMarkerPoints(bars, pvpMarks), ...pvpSignalMarks(bars, historyLength, bestPoints)]
        : trades.map(trade => ({
            name: trade.type === 'buy' ? '买' : '卖',
            coord: [String(historyLength + trade.day), trade.price],
            value: trade.type === 'buy' ? '买' : '卖',
            itemStyle: {
                color: trade.type === 'buy' ? '#e05252' : '#3db86a'
            }
        })).filter(p => Number(p.coord[0]) <= bars.length);

    if (valuation) {
        markPoints.push({
            name: '期末估值',
            coord: [String(historyLength + valuation.day), valuation.price],
            value: '期末估值',
            symbol: 'diamond',
            symbolSize: 14,
            itemStyle: { color: '#f5c542' },
            label: { color: '#f5c542', fontSize: 10, fontWeight: 'bold' }
        });
    }

    const bestMarkPoints = [];
    if (bestPoints) {
        (bestPoints.buys || []).forEach((p, idx) => {
            const bar = bars[historyLength + p.day - 1];
            if (!bar) return;
            bestMarkPoints.push({
                name: 'B' + (idx + 1),
                coord: [String(historyLength + p.day), bar.low],
                value: 'B' + (idx + 1),
                symbolOffset: [0, 20],
                symbol: 'diamond',
                symbolSize: 14,
                itemStyle: { color: '#fbbf24' },
                label: { color: '#fbbf24', fontSize: 10, fontWeight: 'bold', position: 'bottom' }
            });
        });
        (bestPoints.sells || []).forEach((p, idx) => {
            const bar = bars[historyLength + p.day - 1];
            if (!bar) return;
            bestMarkPoints.push({
                name: 'S' + (idx + 1),
                coord: [String(historyLength + p.day), bar.high],
                value: 'S' + (idx + 1),
                symbol: 'diamond',
                symbolSize: 14,
                itemStyle: { color: '#a78bfa' },
                label: { color: '#a78bfa', fontSize: 10, fontWeight: 'bold', position: 'top' }
            });
        });
    }

    const axisLineColor = paperChart ? 'rgba(200, 164, 78, 0.2)' : 'rgba(88,166,255,0.15)';
    const axisLabelColor = paperChart ? '#6b6660' : '#8b949e';
    const splitLineColor = paperChart ? 'rgba(200, 164, 78, 0.06)' : 'rgba(88,166,255,0.06)';

    // Y labels are right-aligned to the grid's left edge: reserve their real width (px, same for the
    // price and volume grids so candles and bars stay aligned) instead of a % that clipped them.
    const maxPriceChars = bars.reduce((m, d) => {
        const hi = Math.max(Number(d.high) || 0, Number(d.open) || 0, Number(d.close) || 0);
        return Math.max(m, hi.toFixed(2).length);
    }, 4);
    const yAxisLeftPx = Math.round(12 + maxPriceChars * 6.3);
    const pvpTickChars = isPvp ? Math.max(...[-1, 1].map(toward => String(pvpAxisBound({
        min: Math.min(...bars.map(bar => bar.low)),
        max: Math.max(...bars.map(bar => bar.high)),
    }, toward < 0 ? 0.12 : 0.18, toward)).length)) : 0;
    const pvpGridLeft = Math.max(PVP_GRID_LEFT, Math.ceil(12 + pvpTickChars * 6.3));

    const xAxisBottomLabel = isPvp
        ? {
            color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10, hideOverlap: true,
            formatter: (value) => pvpAxisText(value),
        }
        : isResult
        ? {
            color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10, rotate: 0,
            formatter: (v) => (v === startDayLabel ? '{start|' + v + '}' : v),
            rich: {
                start: { color: '#f5c542', fontWeight: 'bold', fontSize: 11 }
            }
        }
        : {
            color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10, rotate: 0,
            formatter: (v) => v
        };

    const candleSeries = {
        name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: ohlc,
        ...(isPvp ? { barWidth: '76%' } : {}),
        itemStyle: { color: '#e05252', color0: '#3db86a', borderColor: '#e05252', borderColor0: '#3db86a' },
        markPoint: isPvp
            ? {
                data: markPoints,
                symbol: 'circle',
                symbolSize: 14,
                animation: false,
                tooltip: {
                    trigger: 'item',
                    formatter: (params) => `${pvpTipTitle(params.data?.coord?.[0])} · ${params.data?.name || ''}`,
                },
            }
            : isResult
            ? {
                data: [...markPoints, ...bestMarkPoints],
                symbol: 'pin', symbolSize: 40,
                label: { formatter: '{b}', color: '#fff', fontWeight: 'bold' }
            }
            : {
                data: markPoints, symbol: 'pin', symbolSize: 35,
                label: { formatter: '{c}', color: '#fff', fontWeight: 'bold', fontSize: 11 }
            },
    };

    if (isResult) {
        candleSeries.markLine = {
            silent: true,
            symbol: 'none',
            animation: false,
            data: [{
                xAxis: startDayLabel,
                label: {
                    show: true,
                    formatter: '开局第1天',
                    position: 'insideEndTop',
                    color: '#f5c542',
                    fontSize: 11,
                    fontWeight: 'bold',
                    fontFamily: 'system-ui, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif',
                    backgroundColor: 'rgba(22,22,29,0.88)',
                    padding: [3, 6],
                    borderRadius: 3
                },
                lineStyle: {
                    color: '#f5c542',
                    type: 'dashed',
                    width: 2,
                    opacity: 0.9
                }
            }]
        };
    }

    const maSeries = [
        {
            name: '5日线', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma5,
            smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#f5c542' }
        },
        {
            name: '10日线', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma10,
            smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#42a5f5' }
        },
        {
            name: '20日线', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma20,
            smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#ab47bc' }
        },
        {
            name: '30日线', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma30,
            smooth: true, symbol: 'none', lineStyle: { width: 1, color: '#26a69a' }
        },
    ];

    const volumeSeries = {
        name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes,
        itemStyle: isResult
            ? { color: function(params) { return volumeColors[params.dataIndex]; } }
            : { color: params => volumeColors[params.dataIndex] }
    };

    const macdAxis = pvpTwoPane ? 1 : 2;
    const macdSeries = isPvp && macd ? [
        {
            name: 'MACD', type: 'bar', xAxisIndex: macdAxis, yAxisIndex: macdAxis, data: macd.hist,
            itemStyle: {
                color: (params) => {
                    const v = Number(params.data);
                    if (!Number.isFinite(v) || v === 0) return '#8a7350';
                    return v > 0 ? '#e05252' : '#3db86a';
                },
            },
        },
        {
            name: 'DIF', type: 'line', xAxisIndex: macdAxis, yAxisIndex: macdAxis, data: macd.dif,
            smooth: true, symbol: 'none', lineStyle: { width: 1.2, color: '#42a5f5' },
        },
        {
            name: 'DEA', type: 'line', xAxisIndex: macdAxis, yAxisIndex: macdAxis, data: macd.dea,
            smooth: true, symbol: 'none', lineStyle: { width: 1.2, color: '#f5c542' },
        },
    ] : [];

    // Preserve prior series order: game = K + MAs + vol; result = K + vol + MAs; pvp adds MACD.
    // Battle with pvpBottom: two panes — candles + volume XOR MACD.
    let series;
    if (isResult) {
        series = [candleSeries, volumeSeries, ...maSeries];
    } else if (isPvp && pvpTwoPane) {
        series = bottomMode === 'macd'
            ? [candleSeries, ...maSeries, ...macdSeries]
            : [candleSeries, ...maSeries, volumeSeries];
    } else if (isPvp) {
        series = [candleSeries, ...maSeries, volumeSeries, ...macdSeries];
    } else {
        series = [candleSeries, ...maSeries, volumeSeries];
    }

    let legend;
    if (!legendOn || (isPvp && showLegend === false)) {
        legend = { show: false };
    } else if (isResult) {
        legend = {
            data: ['5日线', '10日线', '20日线', '30日线'],
            top: 0,
            left: 10,
            textStyle: { color: '#6b6660', fontFamily: 'system-ui, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif', fontSize: LEGEND_FONT_PX },
            itemWidth: LEGEND_ITEM_W,
            itemHeight: 2,
            itemGap: LEGEND_ITEM_GAP
        };
    } else if (isPvp) {
        legend = {
            data: [...MA_DAY_LABELS, 'DIF', 'DEA'],
            selected: {
                '5日线': true,
                '10日线': true,
                '20日线': true,
                '30日线': true,
                DIF: true,
                DEA: true,
                MACD: true,
            },
            selectedMode: true,
            top: 2,
            left: 8,
            textStyle: { color: '#6b6660', fontFamily: 'system-ui, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif', fontSize: 10 },
            itemWidth: 14,
            itemHeight: 2,
            itemGap: 8
        };
    } else {
        legend = {
            data: MA_DAY_LABELS.slice(),
            selected: maSelected || {
                '5日线': true,
                '10日线': true,
                '20日线': true,
                '30日线': true,
            },
            selectedMode: false,
            top: 5,
            left: 8,
            textStyle: { color: '#8b949e', fontFamily: 'system-ui, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif', fontSize: LEGEND_FONT_PX },
            itemWidth: LEGEND_ITEM_W,
            itemHeight: 2,
            itemGap: LEGEND_ITEM_GAP
        };
    }

    const wantSlider = showDataZoomSlider != null ? !!showDataZoomSlider : isResult;
    const dataZoomWindow = resetDataZoom ? { start: 0, end: 100 } : {};
    // Same window as the solo chart: history plus every revealed day, and the player can zoom back out.
    const pvpZoom = isPvp
        ? { minSpan: 2, maxSpan: 100, ...(vm.resetDataZoom === false ? {} : { start: 0, end: 100 }) }
        : null;
    // inside: pinch + horizontal slide on touch; wheel zoom on desktop.
    // Chart host: leave touch-action default so ECharts/ZR can handle pinch; hold/FF buttons keep touch-action:none separately.
    const zoomAxes = isPvp ? (pvpTwoPane ? [0, 1] : [0, 1, 2]) : [0, 1];
    const dataZoom = [
        {
            type: 'inside',
            xAxisIndex: zoomAxes,
            filterMode: 'none',
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: false,
            preventDefaultMouseMove: true,
            minSpan: isPvp ? 2 : 8,
            ...(pvpZoom || dataZoomWindow),
        },
    ];
    if (wantSlider) {
        // 复盘 slider: taller paper strip, realtime with no throttle (the stock 100ms throttle made the
        // main chart trail the finger). On the result screen js/zoom-slider-grip.js lays 44px touch
        // handles over it; these canvas handles are the fallback (and hidden once the grip attaches).
        dataZoom.push({
            type: 'slider',
            xAxisIndex: zoomAxes,
            filterMode: 'none',
            left: yAxisLeftPx,
            right: 14,
            height: ZOOM_SLIDER_HEIGHT,
            bottom: ZOOM_SLIDER_BOTTOM,
            realtime: true,
            throttle: 0,
            brushSelect: false,
            showDetail: false,
            showDataShadow: true,
            handleSize: '115%',
            handleIcon: 'path://M3,0 h6 a3,3 0 0 1 3,3 v18 a3,3 0 0 1 -3,3 h-6 a3,3 0 0 1 -3,-3 v-18 a3,3 0 0 1 3,-3 z',
            handleStyle: { color: '#f3ead8', borderColor: '#3a3530', borderWidth: 1.4 },
            moveHandleSize: 0,
            borderRadius: 7,
            backgroundColor: 'rgba(255,252,244,0.6)',
            borderColor: 'rgba(58,53,48,0.42)',
            fillerColor: 'rgba(196,92,58,0.13)',
            dataBackground: {
                lineStyle: { color: 'rgba(90,82,72,0.5)', width: 1.2, opacity: 1 },
                areaStyle: { color: 'rgba(90,82,72,0.07)', opacity: 1 },
            },
            selectedDataBackground: {
                lineStyle: { color: 'rgba(196,92,58,0.95)', width: 1.5, opacity: 1 },
                areaStyle: { color: 'rgba(196,92,58,0.16)', opacity: 1 },
            },
            ...dataZoomWindow,
        });
    }

    const option = {
        backgroundColor: 'transparent',
        // PvP: no series tween — otherwise a lock/resize looks like the candles jerk.
        animation: !isPvp,
        legend,
        dataZoom,
        tooltip: {
            trigger: 'axis',
            // PvP: click to open (mobile WebView has no hover). Dismiss via Esc / outside / second click / trade action.
            triggerOn: isPvp ? 'click' : 'mousemove|click',
            axisPointer: { type: isPvp ? 'line' : 'cross' },
            hideDelay: isPvp ? 0 : 100,
            alwaysShowContent: false,
            enterable: isPvp,
            backgroundColor: isResult ? 'rgba(22, 22, 29, 0.95)' : 'rgba(13,17,23,0.97)',
            borderColor: isResult ? 'rgba(200, 164, 78, 0.2)' : 'rgba(88,166,255,0.2)',
            textStyle: isResult
                ? { color: '#e8e4dd', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }
                : { color: '#e6edf3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12 },
            formatter: function(params) {
                const cs = params.find(p => p.seriesName === 'K线');
                if (!cs) return '';
                const idx = cs.dataIndex;
                const kd = bars[idx];
                if (isPvp && kd) {
                    const isUp = kd.close >= kd.open;
                    const clr = isUp ? '#e05252' : '#3db86a';
                    const title = pvpTipTitle(kd.label);
                    let html = `<div style="padding:4px 2px;min-width:9.5rem" data-pvp-tip="1">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
                          ${title ? `<div style="color:#8b949e;font-size:11px">${title}</div>` : "<div></div>"}
                          <button type="button" data-pvp-tip-close="1" style="appearance:none;border:1px solid #8b949e;border-radius:999px;background:#1b2230;color:#e6edf3;font-size:11px;line-height:1;padding:3px 8px;cursor:pointer">关闭</button>
                        </div>
                        <div style="color:${clr}">开 ${kd.open.toFixed(2)}&nbsp;&nbsp;收 ${kd.close.toFixed(2)}</div>
                        <div>低 ${kd.low.toFixed(2)}&nbsp;&nbsp;高 ${kd.high.toFixed(2)}</div>
                        <div style="color:#8b949e">量 ${Number(kd.volume).toFixed(2)}</div>`;
                    for (const mark of pvpMarks || []) {
                        if (mark.label !== kd.label || !['buy', 'sell'].includes(mark.kind)) continue;
                        const mine = mark.side === 'me';
                        const buy = mark.kind === 'buy';
                        const tone = mine ? (buy ? '#e05252' : '#3db86a') : (buy ? '#2f6fed' : '#7c4dff');
                        html += `<div style="color:${tone}">${mine ? '我' : '对手'} · ${buy ? '买入' : '卖出'}</div>`;
                    }
                    params.forEach((p) => {
                        if (MA_DAY_COLORS[p.seriesName] && p.data != null) {
                            html += `<div style="color:${MA_DAY_COLORS[p.seriesName]}">${p.seriesName}: ${Number(p.data).toFixed(2)}</div>`;
                        }
                        if ((p.seriesName === 'DIF' || p.seriesName === 'DEA' || p.seriesName === 'MACD') && p.data != null) {
                            const tone = p.seriesName === 'MACD' ? (Number(p.data) >= 0 ? '#e05252' : '#3db86a') : (p.seriesName === 'DIF' ? '#42a5f5' : '#f5c542');
                            html += `<div style="color:${tone}">${p.seriesName}: ${Number(p.data).toFixed(3)}</div>`;
                        }
                    });
                    html += '</div>';
                    return html;
                }

                if (!isResult && syncHover && kd) {
                    syncHover(kd, idx);
                }

                if (isResult) {
                    if (!kd) return '';
                    const isUp = kd.close >= kd.open;
                    const clr = isUp ? '#e05252' : '#3db86a';
                    let html = `<div style="padding:4px 2px">
                    <div style="margin-bottom:5px;color:#8b949e;font-size:11px">${kd.date}</div>
                    <div style="color:${clr}">开 ${kd.open.toFixed(2)}&nbsp;&nbsp;收 ${kd.close.toFixed(2)}</div>
                    <div>低 ${kd.low.toFixed(2)}&nbsp;&nbsp;高 ${kd.high.toFixed(2)}</div>
                    <div style="color:#8b949e">量 ${(kd.volume / 10000).toFixed(0)}万手</div>`;
                    params.forEach(p => {
                        if (MA_DAY_COLORS[p.seriesName] && p.data != null)
                            html += `<div style="color:${MA_DAY_COLORS[p.seriesName]}">${p.seriesName}: ${Number(p.data).toFixed(2)}</div>`;
                    });
                    html += '</div>';
                    return html;
                }

                // Game tooltip: prefer kd; fall back to ECharts candlestick tuple shapes.
                let open, close, low, high, volume;
                if (kd) {
                    open = kd.open;
                    close = kd.close;
                    low = kd.low;
                    high = kd.high;
                    volume = kd.volume;
                } else {
                    const d = cs.data;
                    if (Array.isArray(d) && d.length >= 5) {
                        open = d[1]; close = d[2]; low = d[3]; high = d[4];
                    } else if (Array.isArray(d) && d.length >= 4) {
                        open = d[0]; close = d[1]; low = d[2]; high = d[3];
                    } else {
                        return '';
                    }
                    const vol = params.find(p => p.seriesName === '成交量');
                    volume = vol ? vol.data : 0;
                }
                const isUp = close >= open;
                const clr = isUp ? '#e05252' : '#3db86a';
                const dateLabel = kd ? kd.date : '';
                let html = `<div style="padding:4px 2px">
                    <div style="margin-bottom:5px;color:#8b949e;font-size:11px">${dateLabel}</div>
                    <div style="color:${clr}">开 ${open.toFixed(2)}&nbsp;&nbsp;收 ${close.toFixed(2)}</div>
                    <div>低 ${low.toFixed(2)}&nbsp;&nbsp;高 ${high.toFixed(2)}</div>`;
                html += `<div style="color:#8b949e">量 ${(volume / 10000).toFixed(0)}万手</div>`;
                params.forEach(p => {
                    if (MA_DAY_COLORS[p.seriesName] && p.data != null)
                        html += `<div style="color:${MA_DAY_COLORS[p.seriesName]}">${p.seriesName}: ${p.data.toFixed(2)}</div>`;
                });
                html += '</div>';
                return html;
            }
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: isPvp && pvpTwoPane
            ? [
                { left: pvpGridLeft, right: PVP_GRID_RIGHT, top: 12, bottom: '28%' },
                { left: pvpGridLeft, right: PVP_GRID_RIGHT, top: '78%', bottom: 16 }
            ]
            : isPvp
            ? [
                { left: pvpGridLeft, right: PVP_GRID_RIGHT, top: 26, bottom: '38%' },
                { left: pvpGridLeft, right: PVP_GRID_RIGHT, top: '66%', bottom: '24%' },
                { left: pvpGridLeft, right: PVP_GRID_RIGHT, top: '80%', bottom: 16 }
            ]
            : isResult
            ? [
                { left: yAxisLeftPx, right: 14, top: '12%', bottom: wantSlider ? '38%' : '35%' },
                { left: yAxisLeftPx, right: 14, top: wantSlider ? '70%' : '72%', bottom: wantSlider ? '14%' : 30 }
            ]
            : [
                { left: yAxisLeftPx, right: 14, top: 26, bottom: '38%' },
                { left: yAxisLeftPx, right: 14, top: '66%', bottom: 30 }
            ],
        xAxis: isPvp && pvpTwoPane
            ? [
                {
                    type: 'category', data: dayLabels, gridIndex: 0,
                    axisLine: { lineStyle: { color: axisLineColor } },
                    axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
                },
                {
                    type: 'category', data: dayLabels, gridIndex: 1,
                    axisLine: { lineStyle: { color: axisLineColor } },
                    axisLabel: xAxisBottomLabel,
                    splitLine: { show: false }
                }
            ]
            : isPvp
            ? [
                {
                    type: 'category', data: dayLabels, gridIndex: 0,
                    axisLine: { lineStyle: { color: axisLineColor } },
                    axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
                },
                {
                    type: 'category', data: dayLabels, gridIndex: 1,
                    axisLine: { lineStyle: { color: axisLineColor } },
                    axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
                },
                {
                    type: 'category', data: dayLabels, gridIndex: 2,
                    axisLine: { lineStyle: { color: axisLineColor } },
                    axisLabel: xAxisBottomLabel,
                    splitLine: { show: false }
                }
            ]
            : [
            {
                type: 'category', data: dayLabels, gridIndex: 0,
                axisLine: { lineStyle: { color: axisLineColor } },
                axisLabel: { show: false }, axisTick: { show: false }, splitLine: { show: false }
            },
            {
                type: 'category', data: dayLabels, gridIndex: 1,
                axisLine: { lineStyle: { color: axisLineColor } },
                axisLabel: xAxisBottomLabel,
                splitLine: { show: false }
            }
        ],
        yAxis: isPvp && pvpTwoPane
            ? [
                {
                    type: 'value', scale: true, gridIndex: 0,
                    name: undefined,
                    axisLabel: { color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: splitLineColor } },
                    min: (value) => pvpAxisBound(value, 0.12, -1),
                    max: (value) => pvpAxisBound(value, 0.18, 1),
                },
                { type: 'value', scale: true, gridIndex: 1, show: false, splitLine: { show: false } },
            ]
            : isPvp
            ? [
                {
                    type: 'value', scale: true, gridIndex: 0,
                    name: undefined,
                    axisLabel: { color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10 },
                    axisLine: { show: false },
                    splitLine: { lineStyle: { color: splitLineColor } },
                    min: (value) => pvpAxisBound(value, 0.12, -1),
                    max: (value) => pvpAxisBound(value, 0.18, 1),
                },
                { type: 'value', scale: true, gridIndex: 1, show: false },
                {
                    type: 'value', scale: true, gridIndex: 2, show: false,
                    splitLine: { show: false },
                },
            ]
            : [
            {
                type: 'value', scale: true, gridIndex: 0,
                name: undefined,
                nameLocation: 'middle',
                nameGap: 36,
                nameTextStyle: undefined,
                axisLabel: { color: axisLabelColor, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 10 },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: splitLineColor } },
            },
            { type: 'value', scale: true, gridIndex: 1, show: false }
        ],
        series,
    };

    if (!isResult && !isPvp) {
        // Audit UI-04: every decision re-ran a 0.7–1.2s tween over the whole chart (looked like jitter).
        // The live game chart updates in place; only the first paint may animate (never on setOption updates).
        option.animation = false;
        option.animationDuration = 0;
        option.animationDurationUpdate = 0;
    }

    return option;
}
