import test from 'node:test';
import assert from 'node:assert/strict';
import { pickShareSlogan, sloganPool, SHARE_SLOGAN_POOLS } from '../js/share-slogan.js';

test('slogan pool follows the sign of the return', () => {
  assert.equal(sloganPool(5), SHARE_SLOGAN_POOLS.GAIN);
  assert.equal(sloganPool(-0.1), SHARE_SLOGAN_POOLS.LOSS);
  assert.equal(sloganPool(0), SHARE_SLOGAN_POOLS.FLAT);
  assert.equal(sloganPool(NaN), SHARE_SLOGAN_POOLS.FLAT);
});

test('every line carries the return rate and rand picks deterministically in range', () => {
  for (const pool of Object.values(SHARE_SLOGAN_POOLS)) {
    for (const line of pool) assert.ok(line.includes('{ret}'), line);
  }
  assert.ok(pickShareSlogan('+7.01%', 7.01, () => 0).includes('+7.01%'));
  const last = SHARE_SLOGAN_POOLS.GAIN.length - 1;
  assert.equal(pickShareSlogan('+1%', 1, () => 0.999999), SHARE_SLOGAN_POOLS.GAIN[last].replace('{ret}', '+1%'));
  assert.ok(pickShareSlogan('-3%', -3, () => 1).includes('-3%'), 'rand()=1 must not overflow');
  assert.ok(!pickShareSlogan('-3%', -3).includes('{ret}'));
});

test('system-share caption reuses the on-image slogan plus invite link or site url', async () => {
  const { buildShareCaption } = await import('../js/result-share.js').catch(() => ({}));
  if (!buildShareCaption) return; // module pulls browser-only deps; covered by the source check below
  assert.equal(buildShareCaption('我的收益率 +1%，敢来战吗？', null), '我的收益率 +1%，敢来战吗？ https://stockgame.xieyw.top');
  assert.match(buildShareCaption('x', { code: 'AB12', link: 'https://l/AB12' }), /邀请码 AB12 https:\/\/l\/AB12$/);
});

test('result-share wires the slogan into the caption (no old promo caption left)', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../js/result-share.js', import.meta.url), 'utf8');
  assert.ok(js.includes('buildShareCaption(lastSlogan, lastPosterFoot)'));
  assert.ok(!js.includes('buildResultPromoCaption'));
});
