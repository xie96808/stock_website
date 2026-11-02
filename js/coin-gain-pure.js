/**
 * 韭币到账弹窗 — pure decisions + copy (no DOM, no audio, no network), so every branch is unit-testable.
 *
 * Rule of the product: whenever 韭币 is EARNED (not refunded, not an admin adjustment) the player gets the same
 * 「获得韭币」card, a coin chime and a short haptic tick. Each gain gets its own card (no merging); cards queue and
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
 * The coin chime as data: a short metallic "tick" + a rising two-note bell (G6 → C7, "叮—铃"); bigger gains add one
 * or two sparkle notes on top (E7, G7). Each note is a bell: a few inharmonic partials with their own decay.
 * Kept as a score so a test can assert its length / loudness and an offline render can be listened to without a browser.
 */
export const BELL_PARTIALS = Object.freeze([
  { ratio: 1, amp: 1, decay: 1 },
  { ratio: 2.76, amp: 0.34, decay: 0.55 },
  { ratio: 5.4, amp: 0.14, decay: 0.3 },
]);

export function chimeScore(amount) {
  const n = Math.max(0, Number(amount) || 0);
  const notes = [
    { at: 0.0, freq: 1568.0, ring: 0.2, gain: 0.5 }, // G6  叮
    { at: 0.085, freq: 2093.0, ring: 0.55, gain: 0.62 }, // C7  铃 (the long one)
  ];
  if (n >= 100) notes.push({ at: 0.19, freq: 2637.0, ring: 0.42, gain: 0.36 }); // E7 sparkle
  if (n >= 500) notes.push({ at: 0.29, freq: 3136.0, ring: 0.5, gain: 0.3 }); // G7 sparkle
  const tick = { at: 0.0, freq: 5200, ring: 0.03, gain: 0.22 }; // the coin "click"
  const end = Math.max(...notes.map((x) => x.at + x.ring)) + 0.1;
  return { notes, tick, partials: BELL_PARTIALS, master: 1.0, end };
}

/** Duration the score needs (s), used to size an offline render. */
export function chimeDuration(amount) {
  return chimeScore(amount).end;
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
