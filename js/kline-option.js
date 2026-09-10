// ========== Shared K-line ECharts option builder (game + result) ==========
import {
    calculateMA,
    buildDayIndexLabels,
    MA_DAY_LABELS,
    MA_DAY_COLORS,
} from './utils.js';

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
 */
export function buildKlineOption(vm) {
    const {
        bars,
        historyLength = 0,
        trades = [],
        bestPoints = null,
        valuation = null,
        mode = 'game',
        maSelected = null,
        syncHover = null,
    } = vm;

    const isResult = mode === 'result';
    const dayLabels = buildDayIndexLabels(bars.length);
    const startDayLabel = String(historyLength + 1);
    const ohlc = bars.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = bars.map(d => d.volume);
    const volumeColors = bars.map(d => d.close >= d.open ? '#e05252' : '#3db86a');

    const ma5 = calculateMA(bars, 5);
    const ma10 = calculateMA(bars, 10);
    const ma20 = calculateMA(bars, 20);
    const ma30 = calculateMA(bars, 30);

    const markPoints = trades.map(trade => ({
        name: trade.type === 'buy' ? '买' : '卖',
        coord: [String(historyLength + trade.day), trade.price],
        value: trade.type === 'buy' ? '买' : '卖',
        itemStyle: {
            color: trade.type === 'buy' ? '#e05252' : '#3db86a'
        }
    })).filter(p => Number(p.coord[0]) <= bars.length);

    if (valuation) {
        markPoints.push({
            name: '估值',
            coord: [String(historyLength + valuation.day), valuation.price],
            value: '估值',
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

    const axisLineColor = isResult ? 'rgba(200, 164, 78, 0.2)' : 'rgba(88,166,255,0.15)';
    const axisLabelColor = isResult ? '#6b6660' : '#8b949e';
    const splitLineColor = isResult ? 'rgba(200, 164, 78, 0.06)' : 'rgba(88,166,255,0.06)';

    const xAxisBottomLabel = isResult
        ? {
            color: axisLabelColor, fontFamily: 'JetBrains Mono', fontSize: 10, rotate: 0,
            formatter: (v) => (v === startDayLabel ? '{start|' + v + '}' : v),
            rich: {
                start: { color: '#f5c542', fontWeight: 'bold', fontSize: 11 }
            }
        }
        : {
            color: axisLabelColor, fontFamily: 'JetBrains Mono', fontSize: 10, rotate: 0,
            formatter: (v) => v
        };

    const candleSeries = {
        name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: ohlc,
        itemStyle: { color: '#e05252', color0: '#3db86a', borderColor: '#e05252', borderColor0: '#3db86a' },
        markPoint: isResult
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
                    fontFamily: 'Noto Sans SC',
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

    // Preserve prior series order: game = K + MAs + vol; result = K + vol + MAs.
    const series = isResult
        ? [candleSeries, volumeSeries, ...maSeries]
        : [candleSeries, ...maSeries, volumeSeries];

    const legend = isResult
        ? {
            data: ['5日线', '10日线', '20日线', '30日线'],
            top: 0,
            left: 10,
            textStyle: { color: '#6b6660', fontFamily: 'Noto Sans SC', fontSize: 11 },
            itemWidth: 18,
            itemHeight: 2,
            itemGap: 12
        }
        : {
            data: MA_DAY_LABELS.slice(),
            selected: maSelected || {
                '5日线': true,
                '10日线': true,
                '20日线': true,
                '30日线': true,
            },
            selectedMode: false,
            top: 5,
            left: 10,
            textStyle: { color: '#8b949e', fontFamily: 'Noto Sans SC', fontSize: 11 },
            itemWidth: 18,
            itemHeight: 2,
            itemGap: 12
        };

    const option = {
        backgroundColor: 'transparent',
        legend,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: isResult ? 'rgba(22, 22, 29, 0.95)' : 'rgba(13,17,23,0.97)',
            borderColor: isResult ? 'rgba(200, 164, 78, 0.2)' : 'rgba(88,166,255,0.2)',
            textStyle: isResult
                ? { color: '#e8e4dd', fontFamily: 'JetBrains Mono' }
                : { color: '#e6edf3', fontFamily: 'JetBrains Mono', fontSize: 12 },
            formatter: function(params) {
                const cs = params.find(p => p.seriesName === 'K线');
                if (!cs) return '';
                const idx = cs.dataIndex;
                const kd = bars[idx];

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
        grid: isResult
            ? [
                { left: '10%', right: '2%', top: '12%', bottom: '35%' },
                { left: '10%', right: '2%', top: '72%', bottom: '8%' }
            ]
            : [
                { left: '8%', right: '2%', top: '8%', bottom: '34%' },
                { left: '8%', right: '2%', top: '73%', bottom: '6%' }
            ],
        xAxis: [
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
        yAxis: [
            {
                type: 'value', scale: true, gridIndex: 0,
                axisLabel: { color: axisLabelColor, fontFamily: 'JetBrains Mono', fontSize: 10 },
                axisLine: { show: false },
                splitLine: { lineStyle: { color: splitLineColor } }
            },
            { type: 'value', scale: true, gridIndex: 1, show: false }
        ],
        series,
    };

    if (!isResult) {
        option.animation = true;
        option.animationDuration = 300;
    }

    return option;
}
