import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHands,
  validateDateRange,
  filterKlineWindow,
  findBestSellAfterBuy,
  computeHindsightAnalysis,
  stockMatches,
  findStockMatch,
  filterStocksByQuery,
  commodityAffordances,
  resolveHindsightWindow,
  earnedAmountLabel,
  handsToShares,
} from '../js/hindsight-pure.js';

function bar(date, { o, h, l, c } = {}) {
  const close = c ?? 10;
  return {
    date,
    open: o ?? close,
    high: h ?? close,
    low: l ?? close,
    close,
    volume: 1000,
  };
}

test('parseHands accepts positive integers only', () => {
  assert.deepEqual(parseHands('10'), { ok: true, value: 10 });
  assert.equal(parseHands('').ok, false);
  assert.equal(parseHands('0').ok, false);
  assert.equal(parseHands('1.5').ok, false);
  assert.equal(parseHands('1e2').ok, false);
  assert.equal(parseHands('-3').ok, false);
});

test('validateDateRange requires ordered dates', () => {
  assert.deepEqual(validateDateRange('2024-01-01', '2024-06-01'), { ok: true });
  assert.equal(validateDateRange('', '2024-06-01').ok, false);
  assert.equal(validateDateRange('2024-06-01', '2024-01-01').ok, false);
  assert.equal(validateDateRange('2024-01-01', '2024-01-01').ok, false);
});

test('filterKlineWindow enforces minBars and inclusive bounds', () => {
  const kline = [
    bar('2024-01-01', { c: 10 }),
    bar('2024-01-02', { c: 11 }),
    bar('2024-01-03', { c: 12 }),
    bar('2024-01-04', { c: 13 }),
    bar('2024-01-05', { c: 14 }),
    bar('2024-01-06', { c: 15 }),
  ];
  const ok = filterKlineWindow(kline, '2024-01-02', '2024-01-05', { minBars: 4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.kline.length, 4);
  assert.equal(ok.kline[0].date, '2024-01-02');

  const full = filterKlineWindow(kline, '2024-01-01', '2024-01-05');
  assert.equal(full.ok, true);
  assert.equal(full.kline.length, 5);

  const short = filterKlineWindow(kline, '2024-01-05', '2024-01-06', { minBars: 5 });
  assert.equal(short.ok, false);
  assert.equal(short.count, 2);
  assert.match(short.err, /不足/);
});

test('findBestSellAfterBuy uses post-buy high and whole-window range high', () => {
  const kline = [
    bar('d0', { c: 10, h: 99 }), // buy close 10; buy-day high must not be sell
    bar('d1', { c: 11, h: 12 }),
    bar('d2', { c: 12, h: 20 }), // best sell
    bar('d3', { c: 9, h: 15 }),
  ];
  const r = findBestSellAfterBuy(kline);
  assert.equal(r.buyIdx, 0);
  assert.equal(r.sellIdx, 2);
  assert.equal(r.bestSell, 20);
  assert.equal(r.rangeHigh, 99);
  assert.equal(r.rangeHighIdx, 0);
  assert.ok(Math.abs(r.bestReturn - 1) < 1e-9); // (20-10)/10
});

test('computeHindsightAnalysis shares / earned / period / labels', () => {
  const kline = [
    bar('2024-01-01', { c: 10, h: 10 }),
    bar('2024-01-02', { c: 11, h: 15 }),
    bar('2024-01-03', { c: 12, h: 12 }),
    bar('2024-01-04', { c: 8, h: 9 }),
    bar('2024-01-05', { c: 20, h: 20 }),
  ];
  const a = computeHindsightAnalysis({
    kline,
    qtyHands: 2,
    stock: { name: '测试', code: '600000' },
  });
  assert.equal(a.buyShares, handsToShares(2));
  assert.equal(a.buyShares, 200);
  assert.equal(a.bestSell, 20);
  assert.equal(a.earnedAmt, (20 - 10) * 200);
  assert.equal(a.earnedLabel, earnedAmountLabel(a.earnedAmt));
  assert.equal(a.stockName, '测试（600000）');
  assert.ok(a.periodReturn > 0);
});

test('stockMatches name / code / pinyin / pack py', () => {
  const s = { name: '贵州茅台', code: 'sh600519', py: 'guizhoumaotai', jp: 'gzmt' };
  assert.equal(stockMatches(s, '茅台'), true);
  assert.equal(stockMatches(s, '600519'), true);
  assert.equal(stockMatches(s, 'gzmt'), true);
  assert.equal(stockMatches(s, 'guizhou'), true);
  assert.equal(stockMatches(s, 'nomatch'), false);
});

test('findStockMatch + filterStocksByQuery', () => {
  const stocks = [
    { name: '贵州茅台', code: '600519', kline: [] },
    { name: '五粮液', code: '000858', kline: [] },
  ];
  assert.equal(findStockMatch(stocks, '600519').name, '贵州茅台');
  assert.equal(findStockMatch(stocks, '贵州茅台 · 600519').code, '600519');
  assert.equal(filterStocksByQuery(stocks, '粮', { limit: 1 }).length, 1);
});

test('commodityAffordances floors counts; 首付 uses 多出', () => {
  const rows = commodityAffordances(20000);
  assert.ok(rows.some((r) => r.name.includes('奶茶') && r.n >= 1 && r.verb === '多买'));
  assert.ok(rows.some((r) => r.name.includes('首付') ? false : true));
  const big = commodityAffordances(300000);
  const down = big.find((r) => r.name.includes('首付'));
  assert.ok(down);
  assert.equal(down.verb, '多出');
  assert.deepEqual(commodityAffordances(-100), []);
  assert.deepEqual(commodityAffordances(5), []);
});

test('resolveHindsightWindow validates without reading gameState', () => {
  const kline = [
    bar('2024-01-01', { c: 10 }),
    bar('2024-01-02', { c: 11 }),
    bar('2024-01-03', { c: 12 }),
    bar('2024-01-04', { c: 13 }),
    bar('2024-01-05', { c: 14 }),
  ];
  const stock = { name: '测试', code: '1', kline };
  const ok = resolveHindsightWindow({
    stocks: [stock],
    selectedStock: null,
    stockInputRaw: '测试',
    fromVal: '2024-01-01',
    toVal: '2024-01-05',
    qtyRaw: '3',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.qtyHands, 3);
  assert.equal(ok.kline.length, 5);

  const bad = resolveHindsightWindow({
    stocks: [stock],
    selectedStock: null,
    stockInputRaw: 'nope',
    fromVal: '2024-01-01',
    toVal: '2024-01-05',
    qtyRaw: '3',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'stock');
});
