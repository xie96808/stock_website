import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundHalfUp } from '../shared/engine.js';
import {
  AVG_FEN_TOLERANCE,
  EM241_TIMES,
  INTRADAY_BAR_COUNT,
  INTRADAY_CLOCK,
  alignEm241,
  checkCumulativeAverage,
  decodeTapeBar,
  fenFromYuan,
  isBeijingSymbol,
  isExcludedName,
  isLimitLockedOpen,
  limitBandFen,
  limitPctForSymbol,
  selectUniverse,
  tapeSha256,
  toCloseBars,
  validateTape,
} from '../shared/intradayTape.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../server/tests/fixtures/mini_intraday.jsonl',
);

function legalTape(overrides = {}) {
  const symbol = overrides.symbol ?? '600036';
  const close0 = overrides.closeFen ?? 3852;
  const zeroAt = new Set(overrides.zeroAt ?? []);
  let cumLot = 0;
  let cumAmount = 0;
  const bars = [];
  for (let i = 0; i < INTRADAY_BAR_COUNT; i += 1) {
    const closeFen = overrides.closes?.[i] ?? (close0 + ((i % 5) - 2));
    let volumeLot = overrides.volumes?.[i] ?? (100 + (i % 3) * 10);
    let amountFen = volumeLot * closeFen * 100;
    if (zeroAt.has(i)) {
      volumeLot = 0;
      amountFen = 0;
    }
    cumLot += volumeLot;
    cumAmount += amountFen;
    let avgFen = cumLot > 0 ? roundHalfUp(cumAmount / (cumLot * 100)) : closeFen;
    if (volumeLot === 0 && i > 0) avgFen = bars[i - 1][3];
    if (overrides.avgDelta && overrides.avgDelta.index === i) avgFen += overrides.avgDelta.delta;
    bars.push([closeFen, volumeLot, amountFen, avgFen]);
  }
  return {
    v: 1,
    symbol,
    name: overrides.name ?? '招商银行',
    sessionDate: overrides.sessionDate ?? '2026-09-24',
    prevCloseFen: overrides.prevCloseFen ?? 3850,
    limitPct: overrides.limitPct ?? limitPctForSymbol(symbol),
    barCount: INTRADAY_BAR_COUNT,
    clock: overrides.clock ?? INTRADAY_CLOCK,
    bars,
  };
}

describe('em241-v1 timetable', () => {
  it('is 241 stamps with the auction print and no pre-open bars', () => {
    assert.equal(EM241_TIMES.length, 241);
    assert.equal(EM241_TIMES[0], '09:30');
    assert.equal(EM241_TIMES[1], '09:31');
    assert.equal(EM241_TIMES[120], '11:30');
    assert.equal(EM241_TIMES[121], '13:01');
    assert.equal(EM241_TIMES[240], '15:00');
    assert.equal(EM241_TIMES.includes('09:15'), false);
    assert.equal(EM241_TIMES.includes('09:25'), false);
    assert.equal(EM241_TIMES.includes('11:31'), false);
    assert.equal(EM241_TIMES.includes('13:00'), false);
    assert.equal(new Set(EM241_TIMES).size, 241);
  });

  it('drops a session that misses a stamp and does not synthesize it', () => {
    const rows = EM241_TIMES.map((hm) => ({ time: `2026-09-24 ${hm}:00`, hm }));
    const missing = rows.filter((row) => row.hm !== '10:15');
    const aligned = alignEm241(missing);
    assert.equal(aligned.ok, false);
    assert.equal(aligned.reason, 'timestamp_mismatch');
    assert.equal(aligned.bars, undefined);

    const extra = rows.concat([{ time: '2026-09-24 09:15:00', hm: '09:15' }]);
    assert.equal(alignEm241(extra).reason, 'timestamp_mismatch');

    const ok = alignEm241(rows);
    assert.equal(ok.ok, true);
    assert.equal(ok.bars.length, 241);
    assert.equal(ok.bars[0].hm, '09:30');
    assert.equal(ok.bars[240].hm, '15:00');
    assert.equal(ok.bars.some((row) => row.synthesized), false);
  });
});

describe('fen and decode', () => {
  it('uses shared roundHalfUp for yuan to fen', () => {
    assert.equal(fenFromYuan(10.385), roundHalfUp(10.385 * 100));
    assert.equal(fenFromYuan(10.384), roundHalfUp(10.384 * 100));
    assert.equal(fenFromYuan(38.5), 3850);
    assert.equal(fenFromYuan(1488), 148800);
  });

  it('keeps a closeFen above 32767', () => {
    const tuple = [148800, 100, 1488000000, 148800];
    const asObject = { closeFen: 148800, volumeLot: 100, amountFen: 1488000000, avgFen: 148800 };
    assert.deepEqual(decodeTapeBar(tuple), decodeTapeBar(asObject));
    const closes = toCloseBars([tuple]);
    assert.deepEqual(closes, [{ closeFen: 148800 }]);
    assert.ok(closes[0].closeFen > 32767);
    assert.equal(closes[0].closeFen, 148800);
  });
});

describe('eligibility filters', () => {
  it('drops ST names and Beijing codes', () => {
    assert.equal(isExcludedName('ST岩石'), true);
    assert.equal(isExcludedName('*ST岩石'), true);
    assert.equal(isExcludedName('S*ST岩石'), true);
    assert.equal(isExcludedName('退市整理'), true);
    assert.equal(isExcludedName('招商银行'), false);
    assert.equal(isBeijingSymbol('430090'), true);
    assert.equal(isBeijingSymbol('830799'), true);
    assert.equal(isBeijingSymbol('bj830799'), true);
    assert.equal(isBeijingSymbol('688981'), false);
    assert.equal(isBeijingSymbol('300750'), false);
    assert.equal(limitPctForSymbol('688111'), 20);
    assert.equal(limitPctForSymbol('689009'), 20);
    assert.equal(limitPctForSymbol('300750'), 20);
    assert.equal(limitPctForSymbol('301001'), 20);
    assert.equal(limitPctForSymbol('600036'), 10);
  });

  it('takes the first 200 names with kline and does not backfill filters', () => {
    const stocks = [];
    for (let i = 0; i < 205; i += 1) {
      const code = String(600000 + i).padStart(6, '0');
      stocks.push({ code, name: `名称${i}`, kline: [{ date: '2026-09-24' }] });
    }
    stocks[1] = { code: '600001', name: 'ST示例', kline: [{ date: '2026-09-24' }] };
    stocks[2] = { code: '830001', name: '北交示例', kline: [{ date: '2026-09-24' }] };
    stocks.splice(3, 0, { code: '600999', name: '空K', kline: [] });
    const picked = selectUniverse(stocks);
    assert.equal(picked.length, 198);
    assert.equal(picked.some((stock) => stock.name === 'ST示例'), false);
    assert.equal(picked.some((stock) => stock.code === '830001'), false);
    assert.equal(picked.some((stock) => stock.code === '600999'), false);
    assert.equal(picked[0].code, '600000');
    assert.equal(picked.some((stock) => stock.code === '600202'), false);
  });

  it('rejects an open that is locked at the limit', () => {
    const tape = legalTape();
    const band = limitBandFen(tape.prevCloseFen, tape.limitPct);
    assert.equal(isLimitLockedOpen(tape.prevCloseFen, tape.limitPct, band.limitUpFen), true);
    assert.equal(isLimitLockedOpen(tape.prevCloseFen, tape.limitPct, band.limitDownFen), true);
    tape.bars[0][0] = band.limitUpFen;
    assert.equal(validateTape(tape).reason, 'limit_locked_open');
    tape.bars[0][0] = band.limitUpFen - 1;
    assert.equal(validateTape(tape).ok, true);
    tape.bars[0][0] = band.limitDownFen;
    assert.equal(validateTape(tape).reason, 'limit_locked_open');
  });
});

describe('cumulative average', () => {
  it('keeps a 1 fen miss and discards a wider one', () => {
    assert.equal(AVG_FEN_TOLERANCE, 1);
    const within = validateTape(legalTape({ avgDelta: { index: 10, delta: 1 } }));
    assert.equal(within.ok, true);
    const off = validateTape(legalTape({ avgDelta: { index: 10, delta: 2 } }));
    assert.equal(off.ok, false);
    assert.equal(off.reason, 'avg_mismatch');
    assert.equal(off.index, 10);
    const below = validateTape(legalTape({ avgDelta: { index: 4, delta: -2 } }));
    assert.equal(below.reason, 'avg_mismatch');
  });

  it('does not divide a zero-volume bar and carries the previous avg', () => {
    const leading = validateTape(legalTape({ zeroAt: [0, 1] }));
    assert.equal(leading.ok, true);
    const five = validateTape(legalTape({ zeroAt: [10, 11, 12, 13, 14] }));
    assert.equal(five.ok, true);
    const six = validateTape(legalTape({ zeroAt: [10, 11, 12, 13, 14, 15] }));
    assert.equal(six.reason, 'too_many_zero_volume');
    const brokenCarry = legalTape({ zeroAt: [10] });
    brokenCarry.bars[10][3] = brokenCarry.bars[9][3] + 1;
    assert.equal(validateTape(brokenCarry).reason, 'avg_mismatch');
    const dirtyAmount = legalTape({ zeroAt: [10] });
    dirtyAmount.bars[10][2] = 100;
    assert.equal(validateTape(dirtyAmount).reason, 'zero_volume_amount');
    const halted = legalTape({ zeroAt: EM241_TIMES.map((_, i) => i) });
    assert.equal(validateTape(halted).reason, 'suspended');
  });

  it('rejects a non-integer lot and a non-positive price', () => {
    const fractional = legalTape();
    fractional.bars[3][1] = 10.5;
    assert.equal(validateTape(fractional).reason, 'non_integer_volume');
    const flat = legalTape();
    flat.bars[3][0] = 0;
    assert.equal(validateTape(flat).reason, 'non_positive_price');
  });
});

describe('canonical json and sha256', () => {
  it('changes the hash when one fen changes and preserves a high close', () => {
    const high = legalTape({
      symbol: '600519',
      name: '贵州茅台',
      prevCloseFen: 148000,
      closeFen: 148800,
    });
    const result = validateTape(high);
    assert.equal(result.ok, true);
    assert.ok(result.closes.some((bar) => bar.closeFen > 32767));
    assert.equal(result.closes[0].closeFen, 148798);
    assert.equal(result.sha256, tapeSha256(result.canonicalJson));
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    const shifted = legalTape({
      symbol: '600519',
      name: '贵州茅台',
      prevCloseFen: 148000,
      closeFen: 148800,
    });
    shifted.bars[0][0] += 1;
    const again = validateTape(shifted);
    assert.equal(again.ok, true);
    assert.notEqual(again.sha256, result.sha256);
    assert.equal(result.canonical.clock, 'em241-v1');
    assert.equal(result.canonical.bars.length, 241);
  });
});

describe('mini fixture', () => {
  it('accepts two handwritten sessions of 241 integer-fen bars', () => {
    const text = readFileSync(fixturePath, 'utf8');
    const lines = text.split('\n').filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
    const symbols = [];
    let sawHighClose = false;
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const result = validateTape(parsed);
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.canonicalJson, line);
      assert.equal(result.bars.length, 241);
      assert.equal(result.sha256, tapeSha256(line));
      symbols.push(parsed.symbol);
      if (result.closes.some((bar) => bar.closeFen > 32767)) sawHighClose = true;
      const avg = checkCumulativeAverage(result.bars);
      assert.equal(avg.ok, true);
    }
    assert.deepEqual(symbols, ['600036', '600519']);
    assert.equal(sawHighClose, true);
    assert.equal(text.includes('Int16'), false);
  });
});
