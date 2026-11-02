/**
 * 韭币到账弹窗 — pure decisions + copy (no DOM, no audio, no network), so every branch is unit-testable.
 *
 * Rule of the product: whenever 韭币 is EARNED (not refunded, not an admin adjustment) the player gets the same
 * 「获得韭币」card, a coin-shower sound and a short haptic tick. Each gain gets its own card (no merging); cards queue and
 * show one after the other, on top of everything else.
 */

export const GAIN_TITLE = '获得韭币';

/**
 * Where a gain came from → the one-line caption under the amount. Sources not listed here (or an explicit `sub`)
 * fall back to a generic caption, so a new reward can never render an empty card.
 * Refunds (stake / PvP cancelled) and admin grants are deliberately NOT sources: they are not "earned".
 */
export const GAIN_SOURCES = Object.freeze({
  daily: '每日领取',
  streak: '连续登录奖励',
  achievement: '成就奖励',
  invite: '好友邀请奖励',
  register: '注册礼包',
  guest: '游客体验礼包',
  puzzleFirst: '残局首通二星',
  puzzleThree: '残局三星奖励',
  stake: '韭币局盈利',
  pvp: '对战奖励',
  quiz: '知识学习奖励',
  wheel: '幸运转盘',
});

const FALLBACK_SUB = '韭币已到账';

/**
 * @param {{amount:any, source?:string, sub?:string, balance?:any, key?:string}} input
 * @returns {{amount:number, source:string, sub:string, balance:number|null, key:string|null}|null}
 *   null when nothing was earned (zero / negative / not a number): the caller shows nothing.
 */
export function normalizeGain(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = Number(input.amount);
  if (!Number.isFinite(raw)) return null;
  const amount = Math.floor(raw);
  if (amount <= 0) return null;
  const source = typeof input.source === 'string' ? input.source : '';
  const subIn = typeof input.sub === 'string' ? input.sub.trim() : '';
  const sub = subIn || GAIN_SOURCES[source] || FALLBACK_SUB;
  const balRaw = input.balance == null || input.balance === '' ? NaN : Number(input.balance);
  const balance = Number.isFinite(balRaw) && balRaw >= 0 ? Math.floor(balRaw) : null;
  const key = typeof input.key === 'string' && input.key ? input.key : null;
  return { amount, source, sub, balance, key };
}

/** How long the 0 → N count-up takes (ms): small gains are quick, big ones linger a little, never over 1.1 s. */
export function countUpMs(amount) {
  const n = Math.max(0, Number(amount) || 0);
  return Math.min(1100, 420 + Math.round(Math.sqrt(n) * 28));
}

/** Small coins that fly to the balance when the card is dismissed: more for bigger gains, 4 … 9. */
export function flyCoinCount(amount) {
  const n = Math.max(1, Number(amount) || 1);
  return Math.max(4, Math.min(9, 3 + Math.round(Math.log10(n) * 2.2)));
}

export function easeOutCubic(u) {
  const x = Math.min(1, Math.max(0, u));
  return 1 - Math.pow(1 - x, 3);
}

/**
 * Cards are shown strictly one at a time, in arrival order. A gain carrying a `key` that was already queued/shown
 * in this page session is dropped (a re-render or a retried request must never pay out visually twice).
 */
export function createGainQueue({ maxKeys = 300 } = {}) {
  const items = [];
  const seen = new Set();
  const order = [];
  return {
    /** @returns {boolean} true when accepted */
    push(gain) {
      if (!gain) return false;
      if (gain.key) {
        if (seen.has(gain.key)) return false;
        seen.add(gain.key);
        order.push(gain.key);
        if (order.length > maxKeys) seen.delete(order.shift());
      }
      items.push(gain);
      return true;
    },
    shift() {
      return items.shift() || null;
    },
    size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ sound design (pure score; coin-sfx.js plays it) */

/**
 * 金钱哗啦啦: a pile of coins pouring onto a pile of coins.
 * The score is data — a swell of metallic rustle ("哗") plus dozens of tiny coin clinks ("啦啦") that start dense and
 * thin out as the pile settles. Bigger gains pour longer and denser. Each clink is a small inharmonic bell (coin
 * partials) with its own pitch / loudness / ring. Generated from a seeded PRNG, so a test (or an offline render you can
 * listen to) is repeatable; live play passes a random seed so no two showers sound identical.
 */
export const COIN_PARTIALS = Object.freeze([
  { ratio: 1, amp: 1, decay: 1 },
  { ratio: 2.32, amp: 0.5, decay: 0.6 },
  { ratio: 4.25, amp: 0.22, decay: 0.35 },
]);

/** Small deterministic PRNG (mulberry32): seed → () => [0, 1). */
export function seededRandom(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How long the pour lasts (s) and how many clinks it holds, by amount: 20 → ~0.8 s / 14, 150 → ~1.0 s / 21, 800 → ~1.2 s / 27. */
export function showerShape(amount) {
  const n = Math.max(1, Number(amount) || 1);
  const L = Math.log10(n);
  const duration = Math.min(1.5, Math.max(0.7, 0.55 + 0.23 * L));
  const clinks = Math.min(34, Math.max(10, Math.round(7 + 7 * L)));
  return { duration, clinks };
}

export function showerScore(amount, seed = Number(amount) || 1) {
  const { duration, clinks } = showerShape(amount);
  const rnd = seededRandom(seed);
  const list = [];
  for (let i = 0; i < clinks; i++) {
    const u = (i + rnd() * 0.9) / clinks; // 0…1 through the pour
    const at = duration * Math.pow(u, 1.55); // dense at first, thinning out
    const fade = 1 - 0.62 * u; // the pile settles → quieter
    list.push({
      at,
      freq: 1900 + rnd() * 1900, // 1.9 – 3.8 kHz, the "ting" of a coin
      ring: 0.05 + rnd() * 0.1,
      gain: (0.2 + rnd() * 0.3) * fade,
      tick: 0.05 + rnd() * 0.12, // the little "clack" under each clink
    });
  }
  // the first coin lands a touch harder and brighter: it makes the start feel like a hit, not a hiss
  list[0] = { ...list[0], at: 0, freq: 2900, ring: 0.16, gain: 0.55, tick: 0.2 };
  list.sort((x, y) => x.at - y.at);
  const rustle = { at: 0, attack: 0.05, hold: duration * 0.45, release: duration * 0.7, freq: 4600, q: 0.55, gain: 0.1 };
  const rustleEnd = rustle.at + rustle.attack + rustle.hold + rustle.release; // the swell's tail is part of the sound too
  const end = Math.max(duration + 0.16, rustleEnd, ...list.map((c) => c.at + c.ring)) + 0.05;
  return { clinks: list, rustle, partials: COIN_PARTIALS, master: 1.0, duration, end };
}

/** Time the whole sound needs (s), used to size an offline render. */
export function showerDuration(amount) {
  return showerScore(amount).end;
}

/* ------------------------------------------------------------------ per-source builders (response → showCoinGain input)
 * Every builder returns the input for showCoinGain(), or null / [] when nothing was EARNED, so the call sites stay one-liners
 * and the rules ("refunds and admin grants never pop") live in one tested place.
 */

/** Same figures the server grants (server/src/lib/jiuCoin.js). The register / guest copy already promises these numbers. */
export const REGISTER_GRANT_COINS = 500;
export const GUEST_GRANT_COINS = 100;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** POST /me/jiu-coin/daily → data { amount, balance } */
export function dailyGain(data) {
  if (!data) return null;
  return { amount: data.amount, source: 'daily', balance: data.balance };
}

/** POST /me/streak/claim → data.claimed { day, coins, spins } */
export function streakGain(claimed) {
  if (!claimed) return null;
  const spins = num(claimed.spins) > 0 ? ` · 转盘 +${num(claimed.spins)} 次` : '';
  return { amount: claimed.coins, source: 'streak', sub: `连续登录第 ${claimed.day} 天${spins}` };
}

/** POST /me/achievements/:key/claim | claim-all → data { claimed:[{name,coins,unlock}], coins, state.balance } */
export function achievementGain(data) {
  const list = Array.isArray(data?.claimed) ? data.claimed : [];
  if (!list.length) return null;
  const balance = data?.state?.balance;
  if (list.length === 1) {
    const c = list[0];
    return { amount: c.coins, source: 'achievement', sub: `成就「${c.name}」`, balance };
  }
  const total = num(data.coins) > 0 ? num(data.coins) : list.reduce((s, c) => s + (num(c.coins) || 0), 0);
  return { amount: total, source: 'achievement', sub: `领取 ${list.length} 个成就`, balance };
}

/** What the achievement toast still says once the coins moved into the card: the unlocked rewards, if any. */
export function achievementUnlocks(data, unlockName) {
  const list = Array.isArray(data?.claimed) ? data.claimed : [];
  const names = list.filter((c) => c && c.unlock).map((c) => unlockName(c.unlock));
  return names.length ? `解锁${names.join('、')}` : '';
}

/** finish response → data.inviteReward { inviteeCoins } (the invited player's first-game bonus) */
export function inviteGain(reward, gameKey) {
  if (!reward || !(num(reward.inviteeCoins) > 0)) return null;
  return { amount: reward.inviteeCoins, source: 'invite', key: gameKey ? `invite:${gameKey}` : 'invite' };
}

/** A new account (or a guest that registered: the same account, plus the grant). */
export function registerGain(user) {
  return { amount: REGISTER_GRANT_COINS, source: 'register', balance: user?.jiuCoinBalance, key: user?.id != null ? `register:${user.id}` : 'register' };
}

/** A brand-new guest account just created by POST /auth/guest. */
export function guestGain(user) {
  return { amount: GUEST_GRANT_COINS, source: 'guest', balance: user?.jiuCoinBalance, key: user?.id != null ? `guest:${user.id}` : 'guest' };
}

/** puzzle finish response → one entry per reward actually granted by THIS finish (a replay grants nothing). */
export function puzzleGains(pr) {
  if (!pr) return [];
  const out = [];
  const lvl = pr.levelKey || pr.levelId || 'level';
  if (pr.reward?.grantedThisTime && num(pr.reward.amount) > 0) {
    out.push({ amount: pr.reward.amount, source: 'puzzleFirst', key: `puzzle-first:${lvl}` });
  }
  if (pr.threeStarReward?.grantedThisTime && num(pr.threeStarReward.amount) > 0) {
    out.push({ amount: pr.threeStarReward.amount, source: 'puzzleThree', key: `puzzle-three:${lvl}` });
  }
  return out;
}

/** 韭币局: only a profit is "earned"; the stake coming back, or a loss, never pops. Amount = profit after the fee (net). */
export function stakeGain(stake, gameKey) {
  if (!stake || stake.status !== 'settled') return null;
  const net = num(stake.net);
  if (!(net > 0)) return null;
  return { amount: net, source: 'stake', sub: '韭币局盈利 · 本金已退回', key: `stake:${gameKey || stake.id || 'game'}` };
}

/** Fresh PvP result: only a win pays. Draws / cancelled matches are refunds, never a card. */
export function pvpGain(view) {
  if (!view || view.status !== 'settled') return null;
  const me = view.me || {};
  if (me.outcome !== 'win') return null;
  const delta = num(me.coinDelta);
  if (!(delta > 0)) return null;
  return { amount: delta, source: 'pvp', key: `pvp:${view.matchId}` };
}

/** 知识学习: the settle payload of the answer that completed the set (rewardUnchanged ⇒ it was already paid earlier). */
export function quizGain(settled, attemptId) {
  if (!settled || settled.rewardUnchanged) return null;
  if (!(num(settled.rewardAmount) > 0)) return null;
  return { amount: settled.rewardAmount, source: 'quiz', balance: settled.balance, key: `quiz:${attemptId || 'attempt'}` };
}
