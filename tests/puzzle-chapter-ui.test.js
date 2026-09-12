import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterProgressSummary } from '../js/puzzle-chapter.js';

test('chapterProgressSummary: empty / preparing', () => {
  assert.deepEqual(chapterProgressSummary(null), {
    cleared: 0,
    total: 6,
    starsEarned: 0,
    starsMax: 18,
    percent: 0,
  });
  assert.deepEqual(chapterProgressSummary({ levels: [] }), {
    cleared: 0,
    total: 6,
    starsEarned: 0,
    starsMax: 18,
    percent: 0,
  });
});

test('chapterProgressSummary: cleared = bestStars>=2; percent from cleared/total', () => {
  const data = {
    levels: [
      { progress: { bestStars: 3 } },
      { progress: { bestStars: 2 } },
      { progress: { bestStars: 1 } },
      { progress: { bestStars: 0 } },
      { progress: null },
      {},
    ],
  };
  const s = chapterProgressSummary(data);
  assert.equal(s.total, 6);
  assert.equal(s.cleared, 2);
  assert.equal(s.starsEarned, 6);
  assert.equal(s.starsMax, 18);
  assert.equal(s.percent, 33);
});
