import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PVP_RATING_INITIAL,
  PVP_RATING_K,
  PVP_RATING_VERSION,
  applyPair,
  levelForRating,
  titleForRating,
} from '../../shared/pvpRating.js';

test('P01 title boundaries and the fixed K', () => {
  assert.equal(PVP_RATING_K, 32);
  assert.equal(PVP_RATING_INITIAL, 1000);
  const cases = [
    [700, 1, '韭菜一段', 100],
    [799, 1, '韭菜一段', 1],
    [800, 2, '韭菜二段', 100],
    [999, 3, '韭菜三段', 1],
    [1000, 4, '散户一段', 100],
    [1099, 4, '散户一段', 1],
    [1100, 5, '散户二段', 100],
    [1132, 5, '散户二段', 68],
    [2099, 14, '庄家二段', 1],
    [2100, 15, '庄家三段', null],
    [2480, 15, '庄家三段', null],
  ];
  for (const [rating, level, name, pointsToNext] of cases) {
    assert.equal(levelForRating(rating), level, String(rating));
    const title = titleForRating(rating, 10);
    assert.equal(title.name, name);
    assert.equal(title.pointsToNext, pointsToNext);
    assert.equal(title.inPlacement, false);
  }
  assert.equal(titleForRating(1000, 9).inPlacement, true);
  assert.equal(titleForRating(1000, 0).name, '散户一段');
  assert.equal(levelForRating(699), 1);
});

test('P01 equal ratings draw is zero, and the floor records the real delta', () => {
  const draw = applyPair({ ratingA: 1000, ratingB: 1000, scoreA: 0.5 });
  assert.equal(draw.k, 32);
  assert.equal(draw.ratingVersion, PVP_RATING_VERSION);
  assert.equal(draw.a.actualDelta, 0);
  assert.equal(draw.b.actualDelta, 0);

  const win = applyPair({ ratingA: 1000, ratingB: 1000, scoreA: 1 });
  assert.equal(win.deltaA, 16);
  assert.equal(win.deltaB, -16);
  assert.equal(win.a.after, 1016);
  assert.equal(win.b.after, 984);

  const floored = applyPair({ ratingA: 700, ratingB: 700, scoreA: 0 });
  assert.equal(floored.deltaA, -16);
  assert.equal(floored.a.after, 700);
  assert.equal(floored.a.actualDelta, 0);
  assert.equal(floored.b.after, 716);
  assert.equal(floored.b.actualDelta, 16);
  assert.notEqual(floored.a.actualDelta + floored.b.actualDelta, 0);

  const placementWin = applyPair({ ratingA: 1000, ratingB: 1000, scoreA: 1 });
  assert.equal(placementWin.k, PVP_RATING_K);
});
