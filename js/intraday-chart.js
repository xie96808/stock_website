/**
 * Intraday minute chart option. Pure data — callers own the chart instance.
 * Red is up vs 昨收, green is down. Lunch is omitted so the axis has no hole.
 */

const GAIN = '#e05252';
const LOSS = '#3db86a';
const INK = '#5a5248';
const AXIS = 'rgba(200, 164, 78, 0.35)';
const SPLIT = 'rgba(80, 60, 40, 0.08)';
const SANS = 'system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const TICK_AT = new Map([
  [0, '09:30'],
  [60, '10:30'],
  [120, '11:30/13:00'],
  [180, '14:00'],
  [240, '15:00'],
]);

function pushClock(out, hour, minute, count) {
  let h = hour;
  let m = minute;
  for (let i = 0; i < count; i += 1) {
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 60) {
      m = 0;
      h += 1;
    }
  }
}

/** 09:30, 09:31–11:30, 13:01–15:00. No 09:15–09:25 and no midday slot. */
export function buildEm241Labels() {
  const out = ['09:30'];
  pushClock(out, 9, 31, 120);
  pushClock(out, 13, 1, 120);
  return out;
}

export function fenToYuan(fen) {
  if (!Number.isFinite(fen)) return null;
  return fen / 100;
}

function volumeColor(closeFen, prevCloseFen) {
  if (!Number.isFinite(closeFen) || !Number.isFinite(prevCloseFen)) return INK;
  if (closeFen > prevCloseFen) return GAIN;
  if (closeFen < prevCloseFen) return LOSS;
  return INK;
}

/**
 * @param {object} vm
 * @param {number} vm.prevCloseFen
 * @param {number} [vm.barCount]
 * @param {string[]} [vm.labels]
 * @param {Array<{i:number, closeFen:number, avgFen:number, volumeLot:number}>} [vm.bars]
 * @param {number} [vm.revealedThrough] last index allowed on the chart
 * @param {Array<{barIndex:number, side:'buy'|'sell'}>} [vm.trades]
 */
export function buildIntradayOption(vm) {
  const barCount = Number.isInteger(vm?.barCount) ? vm.barCount : 241;
  const labels = Array.isArray(vm?.labels) && vm.labels.length === barCount
    ? vm.labels
    : buildEm241Labels();
  const prevCloseFen = vm?.prevCloseFen;
  const prevYuan = fenToYuan(prevCloseFen);
  const revealedThrough = Number.isInteger(vm?.revealedThrough) ? vm.revealedThrough : -1;
  const closes = new Array(barCount).fill(null);
  const avgs = new Array(barCount).fill(null);
  const volumes = new Array(barCount).fill(null);

  for (const bar of vm?.bars || []) {
    if (!bar || !Number.isInteger(bar.i) || bar.i < 0 || bar.i >= barCount) continue;
    if (bar.i > revealedThrough) continue;
    closes[bar.i] = fenToYuan(bar.closeFen);
    avgs[bar.i] = fenToYuan(bar.avgFen);
    volumes[bar.i] = {
      value: bar.volumeLot,
      itemStyle: { color: volumeColor(bar.closeFen, prevCloseFen) },
    };
  }

  const markPoints = [];
  for (const trade of vm?.trades || []) {
    if (!trade || !Number.isInteger(trade.barIndex)) continue;
    if (trade.barIndex < 0 || trade.barIndex > revealedThrough) continue;
    const y = closes[trade.barIndex];
    if (y == null) continue;
    const buy = trade.side === 'buy';
    markPoints.push({
      name: buy ? '买' : '卖',
      coord: [labels[trade.barIndex], y],
      value: buy ? '买' : '卖',
      itemStyle: { color: buy ? GAIN : LOSS },
    });
  }

  const axisLabel = {
    color: INK,
    fontFamily: MONO,
    fontSize: 10,
    interval: (index) => TICK_AT.has(index),
    formatter: (_value, index) => TICK_AT.get(index) || '',
  };

  return {
    backgroundColor: 'transparent',
    animation: false,
    animationDuration: 0,
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(243, 234, 216, 0.96)',
      borderColor: AXIS,
      textStyle: { color: '#2c2824', fontFamily: SANS, fontSize: 12 },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    visualMap: {
      show: false,
      type: 'piecewise',
      seriesIndex: 0,
      dimension: 0,
      pieces: [
        { gt: prevYuan, color: GAIN },
        { lt: prevYuan, color: LOSS },
        { gte: prevYuan, lte: prevYuan, color: INK },
      ],
    },
    grid: [
      { left: 52, right: 16, top: 28, height: '58%' },
      { left: 52, right: 16, top: '76%', height: '14%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: labels,
        boundaryGap: false,
        gridIndex: 0,
        axisLine: { lineStyle: { color: AXIS } },
        axisLabel: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'category',
        data: labels,
        boundaryGap: false,
        gridIndex: 1,
        axisLine: { lineStyle: { color: AXIS } },
        axisLabel,
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        gridIndex: 0,
        axisLabel: { color: INK, fontFamily: MONO, fontSize: 10 },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: SPLIT } },
      },
      { type: 'value', scale: true, gridIndex: 1, show: false },
    ],
    series: [
      {
        name: '分时',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: closes,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.6 },
        markPoint: {
          data: markPoints,
          symbol: 'pin',
          symbolSize: 36,
          label: { formatter: '{c}', color: '#fff', fontWeight: 'bold', fontSize: 11, fontFamily: SANS },
        },
        markLine: prevYuan == null ? undefined : {
          silent: true,
          symbol: 'none',
          animation: false,
          data: [{
            yAxis: prevYuan,
            label: {
              formatter: '昨收',
              color: INK,
              fontFamily: SANS,
              fontSize: 10,
            },
            lineStyle: { color: '#8a6e4e', type: 'dashed', width: 1 },
          }],
        },
      },
      {
        name: '均价',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: avgs,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: '#8a6e4e' },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
      },
    ],
  };
}
