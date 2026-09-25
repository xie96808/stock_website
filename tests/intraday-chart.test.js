import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEm241Labels, buildIntradayOption } from '../js/intraday-chart.js';

const GAIN = '#e05252';
const LOSS = '#3db86a';

test('buildIntradayOption is a pure option and does not boot ECharts', () => {
  const src = readFileSync(new URL('../js/intraday-chart.js', import.meta.url), 'utf8');
  assert.equal(src.includes('echarts.init'), false);
  assert.equal(src.includes('ensureEcharts'), false);
  const labels = buildEm241Labels();
  assert.equal(labels.length, 241);
  assert.equal(labels[0], '09:30');
  assert.equal(labels[60], '10:30');
  assert.equal(labels[120], '11:30');
  assert.equal(labels[121], '13:01');
  assert.equal(labels[180], '14:00');
  assert.equal(labels[240], '15:00');
  assert.equal(labels.includes('12:00'), false);
  assert.equal(labels.includes('09:15'), false);

  const opt = buildIntradayOption({
    prevCloseFen: 1000,
    barCount: 241,
    labels,
    revealedThrough: 1,
    bars: [
      { i: 0, closeFen: 1100, avgFen: 1050, volumeLot: 10 },
      { i: 1, closeFen: 900, avgFen: 980, volumeLot: 4 },
      { i: 2, closeFen: 1500, avgFen: 1400, volumeLot: 9 },
    ],
    trades: [
      { barIndex: 0, side: 'buy' },
      { barIndex: 1, side: 'sell' },
    ],
  });

  assert.equal(opt.animation, false);
  assert.deepEqual(opt.series.map((s) => s.name), ['分时', '均价', '成交量']);
  assert.equal(opt.xAxis[0].data.length, 241);
  assert.equal(opt.xAxis[1].data[121], '13:01');
  assert.equal(opt.xAxis[1].axisLabel.interval(0), true);
  assert.equal(opt.xAxis[1].axisLabel.interval(1), false);
  assert.equal(opt.xAxis[1].axisLabel.interval(120), true);
  assert.equal(opt.xAxis[1].axisLabel.formatter('11:30', 120), '11:30/13:00');
  assert.equal(opt.xAxis[1].axisLabel.formatter('09:31', 1), '');
  assert.equal(opt.series[0].data[0], 11);
  assert.equal(opt.series[0].data[1], 9);
  assert.equal(opt.series[0].data[2], null);
  assert.equal(opt.series[1].data[0], 10.5);
  assert.equal(opt.series[2].data[0].itemStyle.color, GAIN);
  assert.equal(opt.series[2].data[1].itemStyle.color, LOSS);
  assert.equal(opt.series[2].data[2], null);
  const points = opt.series[0].markPoint.data;
  assert.equal(points.length, 2);
  assert.equal(points[0].itemStyle.color, GAIN);
  assert.equal(points[0].value, '买');
  assert.equal(points[1].itemStyle.color, LOSS);
  assert.equal(points[1].value, '卖');
  assert.equal(opt.visualMap.pieces[0].color, GAIN);
  assert.equal(opt.visualMap.pieces[1].color, LOSS);
  assert.equal(opt.series[0].markLine.data[0].yAxis, 10);
  assert.equal(JSON.stringify(opt).includes('600519'), false);
});
