import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialAuthState,
  transitionAuth,
  selectIsAuthenticated,
  selectAuthChromeMode,
  selectPlayer,
  selectIsGuest,
  AUTH_STATUS,
} from '../js/auth-state.js';
import {
  planStart,
  START_PLAN,
  guestGamesLeft,
  guestRegisterNote,
  guestLoginWarning,
  guestRegisteredToast,
  homeGuestState,
  GUEST_GO,
  GUEST_AUTH_REASON,
  GUEST_BANNER,
} from '../js/guest-play-pure.js';
import { primeGuestPlayFlag, guestPlayEnabledSync } from '../js/guest-play.js';

const guestFresh = { id: 7, isGuest: true, nickname: '游客1234', jiuCoinBalance: 100, guestGamesLeft: 1 };
const guestUsed = { ...guestFresh, jiuCoinBalance: 80, guestGamesLeft: 0 };
const member = { id: 9, isGuest: false, nickname: '老玩家', jiuCoinBalance: 300 };

/* ---------- auth state machine ---------- */

test('a guest session lands in `guest`, never in `user` (fail closed for every existing login check)', () => {
  const s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestFresh, csrfToken: 'csrf-g' });
  assert.equal(s.status, AUTH_STATUS.GUEST);
  assert.equal(s.user, null);
  assert.equal(s.guest, guestFresh);
  assert.equal(s.csrfToken, 'csrf-g', 'game writes still need the CSRF token');
  assert.equal(selectIsAuthenticated(s), false);
  assert.equal(selectIsGuest(s), true);
  assert.equal(selectPlayer(s), guestFresh);
  assert.equal(selectAuthChromeMode(s), 'guest', 'header keeps the 登录 / 注册 button');
});

test('a registered user is unchanged by the guest work', () => {
  const s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: member, csrfToken: 'c' });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.user, member);
  assert.equal(s.guest, null);
  assert.equal(selectIsAuthenticated(s), true);
  assert.equal(selectIsGuest(s), false);
  assert.equal(selectPlayer(s), member);
  assert.equal(selectAuthChromeMode(s), 'user');
});

test('anonymous has neither user nor guest', () => {
  const s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: null, csrfToken: null });
  assert.equal(s.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(s.guest, null);
  assert.equal(s.csrfToken, null);
  assert.equal(selectPlayer(s), null);
  assert.equal(selectIsGuest(s), false);
});

test('POST /auth/guest success (SESSION_ESTABLISHED with a guest) → guest status', () => {
  const s = transitionAuth(createInitialAuthState(), { type: 'SESSION_ESTABLISHED', user: guestFresh, csrfToken: 'x' });
  assert.equal(s.status, AUTH_STATUS.GUEST);
  assert.equal(s.user, null);
  assert.equal(s.guest.id, 7);
});

test('registering from a guest turns it into a normal user and drops the guest snapshot', () => {
  let s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestUsed, csrfToken: 'g' });
  s = transitionAuth(s, { type: 'SESSION_ESTABLISHED', user: { ...member, id: 7 }, csrfToken: 'n' });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.user.id, 7);
  assert.equal(s.guest, null);
  assert.equal(s.csrfToken, 'n');
  assert.equal(selectIsGuest(s), false);
});

test('logging in to an existing account from a guest also drops the guest snapshot', () => {
  let s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestUsed, csrfToken: 'g' });
  s = transitionAuth(s, { type: 'SESSION_ESTABLISHED', user: member, csrfToken: 'n' });
  assert.equal(s.guest, null);
  assert.equal(s.user, member);
});

test('USER_UPDATED with a guest keeps it a guest (user stays null); with a member it is authenticated', () => {
  let s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestFresh, csrfToken: 'g' });
  s = transitionAuth(s, { type: 'USER_UPDATED', user: guestUsed });
  assert.equal(s.status, AUTH_STATUS.GUEST);
  assert.equal(s.user, null);
  assert.equal(s.guest.guestGamesLeft, 0);
  s = transitionAuth(s, { type: 'USER_UPDATED', user: member });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.guest, null);
});

test('soft refresh keeps the guest visible (no flicker) and still counts as a guest', () => {
  let s = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestFresh, csrfToken: 'g' });
  s = transitionAuth(s, { type: 'REFRESH_START' });
  assert.equal(s.status, AUTH_STATUS.REFRESHING);
  assert.equal(selectIsGuest(s), true);
  assert.equal(selectAuthChromeMode(s), 'guest');
  assert.equal(selectPlayer(s), guestFresh);
});

test('a lost guest session (401) / logout / failed refresh clears the guest', () => {
  const base = transitionAuth(createInitialAuthState(), { type: 'REFRESH_SUCCESS', user: guestFresh, csrfToken: 'g' });
  const lost = transitionAuth(base, { type: 'REFRESH_FAILURE', status: 401, code: 'UNAUTHORIZED' });
  assert.equal(lost.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(lost.guest, null);
  const cleared = transitionAuth(base, { type: 'SESSION_CLEARED' });
  assert.equal(cleared.guest, null);
  assert.equal(cleared.csrfToken, null);
  const failed = transitionAuth(base, { type: 'REFRESH_FAILURE', status: 500, code: 'X', message: 'boom' });
  assert.equal(failed.status, AUTH_STATUS.ERROR);
  assert.equal(failed.guest, null);
});

/* ---------- start planning ---------- */

const on = true;

test('planStart: registered users always just play', () => {
  for (const kind of ['classic', 'oneshot', 'survival', 'stake']) {
    assert.equal(planStart({ kind, enabled: on, status: 'authenticated', guest: null }), START_PLAN.PLAY);
    assert.equal(planStart({ kind, enabled: false, status: 'authenticated', guest: null }), START_PLAN.PLAY);
  }
});

test('planStart: a brand-new visitor gets the guest game for classic only, and only when guest play is live', () => {
  for (const status of ['anonymous', 'error']) {
    assert.equal(planStart({ kind: 'classic', enabled: on, status, guest: null }), START_PLAN.GUEST_PLAY);
    assert.equal(planStart({ kind: 'stake', enabled: on, status, guest: null }), START_PLAN.LOGIN);
    assert.equal(planStart({ kind: 'oneshot', enabled: on, status, guest: null }), START_PLAN.LOGIN);
  }
});

test('planStart: guest play off or unknown (old server) falls back to the login modal', () => {
  assert.equal(planStart({ kind: 'classic', enabled: false, status: 'anonymous', guest: null }), START_PLAN.LOGIN);
  assert.equal(planStart({ kind: 'classic', enabled: null, status: 'anonymous', guest: null }), START_PLAN.LOGIN);
  assert.equal(planStart({ kind: 'classic', enabled: undefined, status: 'anonymous', guest: null }), START_PLAN.LOGIN);
});

test('planStart: a guest with the free game left plays classic, and is sent to register for anything else', () => {
  assert.equal(planStart({ kind: 'classic', enabled: on, status: 'guest', guest: guestFresh }), START_PLAN.GUEST_PLAY);
  assert.equal(planStart({ kind: 'stake', enabled: on, status: 'guest', guest: guestFresh }), START_PLAN.REGISTER_FEATURE);
  assert.equal(planStart({ kind: 'oneshot', enabled: on, status: 'guest', guest: guestFresh }), START_PLAN.REGISTER_FEATURE);
});

test('planStart: a guest whose game is used gets "register to continue" whatever they tap', () => {
  for (const kind of ['classic', 'stake', 'oneshot', 'survival']) {
    assert.equal(planStart({ kind, enabled: on, status: 'guest', guest: guestUsed }), START_PLAN.REGISTER_LIMIT, kind);
  }
});

test('planStart: a guest stays a guest even if the flag is later switched off (their session is real)', () => {
  assert.equal(planStart({ kind: 'classic', enabled: false, status: 'guest', guest: guestUsed }), START_PLAN.REGISTER_LIMIT);
  assert.equal(planStart({ kind: 'classic', enabled: false, status: 'guest', guest: guestFresh }), START_PLAN.GUEST_PLAY);
});

test('guestGamesLeft: server value wins; a missing/odd value is treated as 1 free game; never negative', () => {
  assert.equal(guestGamesLeft(guestFresh), 1);
  assert.equal(guestGamesLeft(guestUsed), 0);
  assert.equal(guestGamesLeft({}), 1);
  assert.equal(guestGamesLeft(null), 1);
  assert.equal(guestGamesLeft({ guestGamesLeft: -3 }), 0);
  assert.equal(guestGamesLeft({ guestGamesLeft: 'x' }), 1);
});

/* ---------- home button ---------- */

test('homeGuestState: play / used / unchanged', () => {
  assert.equal(homeGuestState({ enabled: on, status: 'anonymous', guest: null }), 'play');
  assert.equal(homeGuestState({ enabled: on, status: 'error', guest: null }), 'play');
  assert.equal(homeGuestState({ enabled: on, status: 'guest', guest: guestFresh }), 'play');
  assert.equal(homeGuestState({ enabled: on, status: 'guest', guest: guestUsed }), 'used');
  // unchanged button: members, flag off/unknown, auth not settled yet (no flash of the wrong promise)
  assert.equal(homeGuestState({ enabled: on, status: 'authenticated', guest: null }), null);
  assert.equal(homeGuestState({ enabled: false, status: 'anonymous', guest: null }), null);
  assert.equal(homeGuestState({ enabled: null, status: 'anonymous', guest: null }), null);
  assert.equal(homeGuestState({ enabled: on, status: 'unknown', guest: null }), null);
  assert.equal(homeGuestState({ enabled: on, status: 'refreshing', guest: null }), null);
});

test('home button copy is what the product spec says', () => {
  assert.equal(GUEST_GO.play.title, '马上开一局');
  assert.equal(GUEST_GO.play.sub, '游客可玩 · 免注册');
  assert.equal(GUEST_GO.used.title, '注册继续玩');
  assert.ok(GUEST_GO.used.sub.includes('500'));
});

/* ---------- copy ---------- */

test('register note explains why, and always promises that game + coins are kept and 500 are added', () => {
  for (const reason of [GUEST_AUTH_REASON.LIMIT, GUEST_AUTH_REASON.FEATURE, GUEST_AUTH_REASON.SAVE, null, undefined]) {
    const t = guestRegisterNote(reason);
    assert.ok(t.includes('战绩') && t.includes('韭币') && t.includes('500'), String(reason));
  }
  assert.match(guestRegisterNote(GUEST_AUTH_REASON.LIMIT), /1 局/);
  assert.match(guestRegisterNote(GUEST_AUTH_REASON.FEATURE), /需要注册/);
});

test('login warning shows only for a guest who already played (their game is not merged into an old account)', () => {
  assert.equal(guestLoginWarning(guestFresh), '');
  assert.equal(guestLoginWarning(null), '');
  const w = guestLoginWarning(guestUsed);
  assert.match(w, /不会合并/);
  assert.match(w, /注册/);
});

test('registered toast keeps the base message and adds that the record was saved', () => {
  assert.equal(guestRegisteredToast('注册成功'), '注册成功 · 战绩已保存');
  assert.equal(guestRegisteredToast(''), '注册成功 · 战绩已保存');
  assert.equal(guestRegisteredToast('注册成功，邀请奖励待发放'), '注册成功，邀请奖励待发放 · 战绩已保存');
});

test('banner copy', () => {
  assert.equal(GUEST_BANNER.title, '保存战绩，领 500 韭币');
  assert.ok(GUEST_BANNER.sub.includes('1 局'));
  assert.equal(GUEST_BANNER.action, '注册保存');
});

/* ---------- feature flag ---------- */

test('guest play flag: reads /config features.guestPlay; an old server without the field reads as OFF', () => {
  assert.equal(guestPlayEnabledSync(), null, 'unknown until primed');
  primeGuestPlayFlag({ coinStake: true }); // old server: no guestPlay key
  assert.equal(guestPlayEnabledSync(), false);
  primeGuestPlayFlag({ guestPlay: true });
  assert.equal(guestPlayEnabledSync(), true);
  primeGuestPlayFlag({ guestPlay: false });
  assert.equal(guestPlayEnabledSync(), false);
  primeGuestPlayFlag(null); // garbage leaves the value alone
  assert.equal(guestPlayEnabledSync(), false);
});
