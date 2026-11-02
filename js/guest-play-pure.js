/**
 * 游客先玩 — pure decisions + copy (no DOM, no network), so every branch is unit-testable.
 *
 * A guest is a temporary server account that may play ONE classic game, then must register
 * (registering upgrades the same account: the game and the leftover 韭币 are kept).
 */

/** What to do when the visitor taps something that starts a game. */
export const START_PLAN = Object.freeze({
  PLAY: 'play', // registered user: the normal start flow
  GUEST_PLAY: 'guest-play', // guest (or a visitor who becomes one): play the one free classic game
  LOGIN: 'login', // not signed in and guest play is off/unknown: today's login modal
  REGISTER_LIMIT: 'register-limit', // the guest already used the free game
  REGISTER_FEATURE: 'register-feature', // a guest asked for a mode that is registered-only
});

/**
 * @param {{kind?: string, enabled: boolean|null, status: string, guest: object|null}} input
 *   kind: 'classic' | 'oneshot' | 'survival' | 'stake'
 *   enabled: /config features.guestPlay (null = unknown -> treated as off)
 *   status: AuthStatus from auth-state.js
 *   guest: the guest account snapshot (has guestGamesLeft) or null
 */
export function planStart({ kind = 'classic', enabled, status, guest }) {
  if (status === 'authenticated') return START_PLAN.PLAY;
  const isGuest = status === 'guest' && !!guest;
  if (isGuest) {
    // The used-up message wins over "this mode is registered-only": whatever they tap, the next step is the same.
    if (guestGamesLeft(guest) <= 0) return START_PLAN.REGISTER_LIMIT;
    return kind === 'classic' ? START_PLAN.GUEST_PLAY : START_PLAN.REGISTER_FEATURE;
  }
  // Not signed in at all (anonymous / unknown / error): guest play only for the classic game, only when live.
  if (enabled !== true || kind !== 'classic') return START_PLAN.LOGIN;
  return START_PLAN.GUEST_PLAY;
}

/** How many free games the guest still has (server field; an old/odd payload means "assume 1"). */
export function guestGamesLeft(guest) {
  const raw = guest ? guest.guestGamesLeft : null;
  if (raw === null || raw === undefined || raw === '') return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : 1;
}

/** Reasons the auth modal can be opened for a guest. */
export const GUEST_AUTH_REASON = Object.freeze({
  LIMIT: 'guest-limit',
  FEATURE: 'guest-feature',
  SAVE: 'guest-save',
});

const REGISTER_PERK = '注册后，你的战绩和剩余韭币都会保留，另领 500 韭币。';

/** One-line note shown above the register form when a guest is asked to sign up. */
export function guestRegisterNote(reason) {
  if (reason === GUEST_AUTH_REASON.LIMIT) return '游客体验的 1 局已经打完。' + REGISTER_PERK;
  if (reason === GUEST_AUTH_REASON.FEATURE) return '这个玩法需要注册后使用。' + REGISTER_PERK;
  return REGISTER_PERK;
}

/** Warning shown on the LOGIN tab while the guest has already played (their game is not merged into an old account). */
export function guestLoginWarning(guest) {
  if (!guest || guestGamesLeft(guest) > 0) return '';
  return '提醒：游客这局战绩不会合并到已有账号。想保留这局，请用「注册」创建新账号。';
}

/** Toast after a guest registered. */
export function guestRegisteredToast(baseMessage) {
  return (baseMessage || '注册成功') + ' · 战绩已保存';
}

/** Home 开一局 button copy for visitors who are not registered users. */
export const GUEST_GO = Object.freeze({
  play: { title: '马上开一局', sub: '游客可玩 · 免注册' },
  used: { title: '注册继续玩', sub: '战绩保留 · 另领 500 韭币' },
});

/**
 * How the home primary button should present itself:
 *   'play' — a visitor who can start the free game right now (new visitor, or a guest with the game unused)
 *   'used' — a guest whose free game is gone: the button says "register to keep playing"
 *   null   — registered users, guest play off/unknown, or auth not settled yet: the button is unchanged
 */
export function homeGuestState({ enabled, status, guest }) {
  if (enabled !== true) return null;
  if (status === 'authenticated') return null;
  if (status === 'guest') return guestGamesLeft(guest) > 0 ? 'play' : 'used';
  // anonymous / error: a brand-new visitor. unknown / refreshing: wait for auth to settle.
  return status === 'anonymous' || status === 'error' ? 'play' : null;
}

/** Result-page banner copy. */
export const GUEST_BANNER = Object.freeze({
  title: '保存战绩，领 500 韭币',
  sub: '游客体验只有 1 局。注册后战绩和剩余韭币都会保留。',
  action: '注册保存',
});
