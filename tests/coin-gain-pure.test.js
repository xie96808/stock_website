import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAIN_TITLE, GAIN_SOURCES, normalizeGain, countUpMs, flyCoinCount, easeOutCubic, createGainQueue,
  coinSoundVolume,
  REGISTER_GRANT_COINS, GUEST_GRANT_COINS,
  dailyGain, streakGain, achievementGain, achievementUnlocks, inviteGain, registerGain, guestGain,
  puzzleGains, stakeGain, pvpGain, quizGain,
} from '../js/coin-gain-pure.js';

test('the card says 获得韭币 and every earned source has its own caption', () => {
  assert.equal(GAIN_TITLE, '获得韭币');
  for (const s of ['daily', 'streak', 'achievement', 'invite', 'register', 'guest', 'puzzleFirst', 'puzzleThree', 'stake', 'pvp', 'quiz', 'wheel']) {
    assert.ok(GAIN_SOURCES[s] && GAIN_SOURCES[s].length >= 2, `missing caption for ${s}`);
  }
  // refunds / admin grants are NOT earned: they must never become a source
  for (const bad of ['refund', 'pvpRefund', 'stakeRefund', 'admin', 'adminGrant']) assert.equal(GAIN_SOURCES[bad], undefined);
});

test('normalizeGain: only a positive whole amount produces a card', () => {
  assert.equal(normalizeGain(null), null);
  assert.equal(normalizeGain(undefined), null);
  assert.equal(normalizeGain('x'), null);
  for (const amount of [0, -1, -50, NaN, 'abc', null, undefined, Infinity, 0.4]) {
    assert.equal(normalizeGain({ amount, source: 'daily' }), null, `amount ${String(amount)}`);
  }
  assert.deepEqual(normalizeGain({ amount: '50', source: 'daily' }), { amount: 50, source: 'daily', sub: '每日领取', balance: null, key: null });
  assert.equal(normalizeGain({ amount: 12.9, source: 'daily' }).amount, 12); // whole coins only
});

test('normalizeGain: caption falls back so a card is never empty; balance and key are validated', () => {
  assert.equal(normalizeGain({ amount: 5 }).sub, '韭币已到账');
  assert.equal(normalizeGain({ amount: 5, source: 'nope' }).sub, '韭币已到账');
  assert.equal(normalizeGain({ amount: 5, source: 'daily', sub: '  自定义说明 ' }).sub, '自定义说明');
  assert.equal(normalizeGain({ amount: 5, balance: '600' }).balance, 600);
  assert.equal(normalizeGain({ amount: 5, balance: -3 }).balance, null);
  assert.equal(normalizeGain({ amount: 5, balance: null }).balance, null);
  assert.equal(normalizeGain({ amount: 5, balance: '' }).balance, null);
  assert.equal(normalizeGain({ amount: 5, key: 'k' }).key, 'k');
  assert.equal(normalizeGain({ amount: 5, key: 7 }).key, null);
});

test('timings stay in sane bounds', () => {
  assert.ok(countUpMs(1) >= 420 && countUpMs(1) < 600);
  assert.equal(countUpMs(10 ** 9), 1100);
  assert.ok(countUpMs(500) > countUpMs(5));
  assert.equal(flyCoinCount(1), 4);
  assert.equal(flyCoinCount(10 ** 9), 9);
  assert.ok(flyCoinCount(500) >= flyCoinCount(20));
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1);
  assert.equal(easeOutCubic(-1), 0);
});

test('queue: strict arrival order, a repeated key is dropped, keys are remembered even after the card was shown', () => {
  const q = createGainQueue();
  assert.equal(q.push(null), false);
  assert.equal(q.push({ amount: 1, key: 'a' }), true);
  assert.equal(q.push({ amount: 2, key: 'b' }), true);
  assert.equal(q.push({ amount: 3 }), true);
  assert.equal(q.push({ amount: 4 }), true); // no key: never deduped
  assert.equal(q.push({ amount: 9, key: 'a' }), false);
  assert.equal(q.size(), 4);
  assert.deepEqual([q.shift().amount, q.shift().amount, q.shift().amount, q.shift().amount], [1, 2, 3, 4]);
  assert.equal(q.shift(), null);
  assert.equal(q.push({ amount: 1, key: 'a' }), false, 'already shown in this session');
  q.clear();
  assert.equal(q.size(), 0);
});

test('queue: remembered keys are bounded', () => {
  const q = createGainQueue({ maxKeys: 3 });
  for (const k of ['a', 'b', 'c', 'd']) q.push({ amount: 1, key: k });
  assert.equal(q.push({ amount: 1, key: 'a' }), true, 'oldest key was forgotten');
  assert.equal(q.push({ amount: 1, key: 'd' }), false);
});

test('builders: daily / streak / achievement / invite', () => {
  assert.deepEqual(dailyGain({ amount: 85, balance: 585 }), { amount: 85, source: 'daily', balance: 585 });
  assert.equal(dailyGain(null), null);
  assert.equal(streakGain(null), null);
  assert.equal(streakGain({ day: 3, coins: 30, spins: 0 }).sub, '连续登录第 3 天');
  assert.equal(streakGain({ day: 7, coins: 100, spins: 1 }).sub, '连续登录第 7 天 · 转盘 +1 次');
  assert.equal(achievementGain({ claimed: [] }), null);
  assert.equal(achievementGain(null), null);
  const one = achievementGain({ claimed: [{ name: '初出茅庐', coins: 20 }], coins: 20, state: { balance: 520 } });
  assert.deepEqual(one, { amount: 20, source: 'achievement', sub: '成就「初出茅庐」', balance: 520 });
  const many = achievementGain({ claimed: [{ name: 'a', coins: 20 }, { name: 'b', coins: 30 }], coins: 50 });
  assert.equal(many.amount, 50);
  assert.equal(many.sub, '领取 2 个成就');
  assert.equal(achievementGain({ claimed: [{ name: 'a', coins: 20 }, { name: 'b', coins: 30 }] }).amount, 50, 'sums when the total is missing');
  const nm = (k) => ({ frame_gold: '金色头像框' }[k] || k);
  assert.equal(achievementUnlocks({ claimed: [{ coins: 1 }] }, nm), '');
  assert.equal(achievementUnlocks({ claimed: [{ unlock: 'frame_gold' }, { unlock: 'x' }] }, nm), '解锁金色头像框、x');
  assert.equal(inviteGain(null), null);
  assert.equal(inviteGain({ inviteeCoins: 0 }), null);
  assert.equal(inviteGain({ inviteeCoins: 120 }).amount, 120);
  assert.equal(inviteGain({ inviteeCoins: 120 }).source, 'invite');
});

test('builders: register and guest grants match the server figures', () => {
  assert.equal(REGISTER_GRANT_COINS, 500);
  assert.equal(GUEST_GRANT_COINS, 100);
  const r = registerGain({ id: 7, jiuCoinBalance: 500 });
  assert.deepEqual([r.amount, r.source, r.balance, r.key], [500, 'register', 500, 'register:7']);
  const g = guestGain({ id: 9, jiuCoinBalance: 100 });
  assert.deepEqual([g.amount, g.source, g.balance, g.key], [100, 'guest', 100, 'guest:9']);
});

test('builders: puzzle pays once per reward, a replay shows nothing', () => {
  assert.deepEqual(puzzleGains(null), []);
  assert.deepEqual(puzzleGains({ reward: { alreadyClaimed: true }, threeStarReward: { alreadyClaimed: true } }), []);
  const both = puzzleGains({ levelKey: 'L1', reward: { grantedThisTime: true, amount: 20 }, threeStarReward: { grantedThisTime: true, amount: 15 } });
  assert.deepEqual(both.map((g) => [g.source, g.amount, g.key]), [['puzzleFirst', 20, 'puzzle-first:L1'], ['puzzleThree', 15, 'puzzle-three:L1']]);
  const onlyThree = puzzleGains({ levelKey: 'L1', reward: { alreadyClaimed: true }, threeStarReward: { grantedThisTime: true, amount: 15 } });
  assert.equal(onlyThree.length, 1);
  assert.equal(onlyThree[0].source, 'puzzleThree');
  assert.deepEqual(puzzleGains({ reward: { grantedThisTime: true, amount: 0 } }), []);
});

test('builders: 韭币局 — only a profit pops (the amount is the net profit), refunds and losses never do', () => {
  assert.equal(stakeGain(null, 'g'), null);
  assert.equal(stakeGain({ status: 'forfeited', net: -100 }, 'g'), null);
  assert.equal(stakeGain({ status: 'settled', net: -30 }, 'g'), null);
  assert.equal(stakeGain({ status: 'settled', net: 0 }, 'g'), null);
  assert.equal(stakeGain({ status: 'pending', net: 40 }, 'g'), null);
  const g = stakeGain({ status: 'settled', amount: 100, payout: 140, net: 40 }, 'g1');
  assert.deepEqual([g.amount, g.source, g.key], [40, 'stake', 'stake:g1']);
});

test('builders: PvP — only a fresh WIN pays a card (draws and cancelled matches are refunds)', () => {
  const v = (o) => ({ status: 'settled', matchId: 'm1', me: { outcome: 'win', coinDelta: 40 }, ...o });
  assert.deepEqual(pvpGain(v()), { amount: 40, source: 'pvp', key: 'pvp:m1' });
  assert.equal(pvpGain(null), null);
  assert.equal(pvpGain(v({ status: 'aborted' })), null);
  assert.equal(pvpGain(v({ me: { outcome: 'draw', coinDelta: 0 } })), null);
  assert.equal(pvpGain(v({ me: { outcome: 'loss', coinDelta: -50 } })), null);
  assert.equal(pvpGain(v({ me: { outcome: 'aborted', coinDelta: 0 } })), null);
  assert.equal(pvpGain(v({ me: { outcome: 'win', coinDelta: 0 } })), null);
});

test('builders: quiz — only the settle that just paid', () => {
  assert.equal(quizGain(null, 'a'), null);
  assert.equal(quizGain({ rewardAmount: 30, rewardUnchanged: true }, 'a'), null);
  assert.equal(quizGain({ rewardAmount: 0 }, 'a'), null);
  assert.deepEqual(quizGain({ rewardAmount: 30, rewardUnchanged: false, balance: 630 }, 'a1'), { amount: 30, source: 'quiz', balance: 630, key: 'quiz:a1' });
});

/* ------------------------------------------------------------------ sound */

test('coinSoundVolume: 0.7 … 1.0, louder for bigger gains, junk-safe', () => {
  assert.equal(coinSoundVolume(1), 0.7);
  assert.equal(coinSoundVolume(1000), 1);
  assert.equal(coinSoundVolume(10 ** 9), 1);
  assert.ok(coinSoundVolume(20) < coinSoundVolume(150) && coinSoundVolume(150) < coinSoundVolume(800));
  for (const v of ['junk', null, -5, 0, NaN]) assert.equal(coinSoundVolume(v), 0.7);
});
