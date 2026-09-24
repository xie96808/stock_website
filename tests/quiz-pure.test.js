import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trendScore,
  analyzeTechnical,
  normalizeContinuation,
  isQuizAnswerCorrect,
  gradeQuizScore,
  createEmptyQuizSession,
  applyQuizAnswer,
  advanceQuizSession,
  buildQuizResultDetails,
  pickPracticalWindow,
  maskPatternNamesInText,
  safeDescSnippet,
} from '../js/quiz-pure.js';

function bar(i, { o, h, l, c, v } = {}) {
  const close = c ?? 10 + i * 0.5;
  return {
    date: '2024-01-' + String(i + 1).padStart(2, '0'),
    open: o ?? close - 0.2,
    high: h ?? close + 0.5,
    low: l ?? close - 0.5,
    close,
    volume: v ?? 1000,
  };
}

test('trendScore pct + clarity', () => {
  const up = [bar(0, { o: 10, c: 11 }), bar(1, { o: 11, c: 12 }), bar(2, { o: 12, c: 13 })];
  const ts = trendScore(up);
  assert.ok(ts.pct > 0);
  assert.ok(ts.clarity > 0.5);
  assert.deepEqual(trendScore([]), { pct: 0, clarity: 0 });
});

test('normalizeContinuation anchors first open to lastClose', () => {
  const data = [bar(0, { o: 20, c: 21, h: 22, l: 19 }), bar(1, { o: 21, c: 22, h: 23, l: 20 })];
  const out = normalizeContinuation(data, 10);
  assert.equal(out[0].open, 10);
  assert.ok(out[0].close < 20);
});

test('analyzeTechnical returns joined prose with continuation note', () => {
  const shown = Array.from({ length: 12 }, (_, i) => bar(i, { c: 10 + i * 0.1, v: 1000 + i * 10 }));
  const cont = Array.from({ length: 5 }, (_, i) => bar(20 + i, { c: 12 + i * 0.3, o: 12 + i * 0.2 }));
  const text = analyzeTechnical(shown, cont);
  assert.match(text, /近5日走势/);
  assert.match(text, /实际后续走势/);
  assert.match(text, /天收阳/);
});

test('isQuizAnswerCorrect for practical + theory', () => {
  assert.equal(isQuizAnswerCorrect({ type: 'practical', correctIndex: 2 }, 2), true);
  assert.equal(isQuizAnswerCorrect({ type: 'practical', correctIndex: 2 }, 1), false);
  assert.equal(
    isQuizAnswerCorrect({ type: 'theory_text', correct: '看涨', _options: ['看跌', '看涨', '中性', 'x'] }, 1),
    true
  );
  assert.equal(
    isQuizAnswerCorrect({ type: 'theory_text', correct: '看涨', _options: ['看跌', '看涨'] }, 0),
    false
  );
});

test('gradeQuizScore bands match training copy', () => {
  assert.equal(gradeQuizScore(8).scoreCls, 'high');
  assert.equal(gradeQuizScore(5).scoreCls, 'medium');
  assert.equal(gradeQuizScore(4).scoreCls, 'low');
  assert.match(gradeQuizScore(9).comment, /扎实/);
});

test('session apply + advance + details (no DOM)', () => {
  const session = createEmptyQuizSession();
  session.questions = [
    { type: 'theory_text', question: 'Q1', correct: 'A', _options: ['B', 'A', 'C', 'D'], explanation: 'e1' },
    { type: 'practical', question: 'Q2', correctIndex: 0, explanation: 'e2' },
  ];
  const a0 = applyQuizAnswer(session, 1);
  assert.equal(a0.ok, true);
  assert.equal(a0.isCorrect, true);
  assert.equal(a0.score, 1);
  Object.assign(session, { answered: a0.answered, answers: a0.answers, score: a0.score });
  assert.equal(applyQuizAnswer(session, 0).reason, 'already_answered');

  const next = advanceQuizSession(session, { lastIndex: 1 });
  assert.equal(next.done, false);
  session.currentIndex = next.currentIndex;
  session.answered = next.answered;

  const a1 = applyQuizAnswer(session, 1);
  assert.equal(a1.isCorrect, false);
  Object.assign(session, { answered: a1.answered, answers: a1.answers, score: a1.score });

  const done = advanceQuizSession(session, { lastIndex: 1 });
  assert.equal(done.done, true);

  const details = buildQuizResultDetails(session);
  assert.equal(details.length, 2);
  assert.equal(details[0].isCorrect, true);
  assert.equal(details[1].isCorrect, false);
  assert.equal(details[1].userText, 'B');
  assert.equal(details[1].correctText, 'A');
});

test('pickPracticalWindow uses injected stocks + rng (no gameState)', () => {
  // Strong upward continuation so clarity/pct gates pass.
  const kline = [];
  for (let i = 0; i < 50; i++) {
    const c = 10 + i * 0.4;
    kline.push({
      date: '2024-' + String(Math.floor(i / 28) + 1).padStart(2, '0') + '-' + String((i % 28) + 1).padStart(2, '0'),
      open: c - 0.1,
      high: c + 0.2,
      low: c - 0.3,
      close: c,
      volume: 1000,
    });
  }
  const stocks = [{ code: 'T', name: 'Test', kline }];
  let calls = 0;
  const rng = () => {
    calls++;
    return 0; // always first stock / startIdx 0
  };
  const picked = pickPracticalWindow(stocks, { rng, maxAttempts: 5 });
  assert.ok(picked);
  assert.equal(picked.stock.code, 'T');
  assert.equal(picked.shownData.length, 25);
  assert.equal(picked.correctCont.length, 12);
  assert.ok(calls >= 1);

  assert.equal(pickPracticalWindow([], { rng }), null);
});


test('maskPatternNamesInText masks longest names first', () => {
  const patterns = [{ name: '螺旋桨' }, { name: '缩量回调' }, { name: '十字星' }];
  assert.equal(
    maskPatternNamesInText('形似螺旋桨。单独出现', patterns),
    '形似「该形态」。单独出现'
  );
  assert.equal(
    maskPatternNamesInText('上升趋势中的缩量回调是健康的', patterns),
    '上升趋势中的「该形态」是健康的'
  );
});

test('safeDescSnippet rejects or masks name-leaking descriptions', () => {
  const all = [
    { name: '螺旋桨', desc: '实体较小而上下影线都很长的K线，形似螺旋桨。表示多空双方激烈交锋。' },
    { name: '大阳线', desc: '实体长、上下影线短的阳线。表示多方力量强劲。' },
  ];
  const propeller = safeDescSnippet(all[0], all);
  assert.ok(propeller);
  assert.equal(propeller.includes('螺旋桨'), false);
  assert.match(propeller, /该形态|实体较小/);

  const yang = safeDescSnippet(all[1], all);
  assert.ok(yang);
  assert.equal(yang.includes('大阳线'), false);
});
