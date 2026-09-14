import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_STATUS,
  createInitialAuthState,
  transitionAuth,
  isUnauthorized,
  selectIsAuthenticated,
  selectIsSettled,
  selectAuthChromeMode,
} from '../js/auth-state.js';

const user = { id: 'u1', nickname: '测的韭菜' };

test('createInitialAuthState starts unknown and not ready', () => {
  const s = createInitialAuthState();
  assert.equal(s.status, AUTH_STATUS.UNKNOWN);
  assert.equal(s.user, null);
  assert.equal(s.ready, false);
  assert.equal(selectAuthChromeMode(s), 'pending');
  assert.equal(selectIsAuthenticated(s), false);
  assert.equal(selectIsSettled(s), false);
});

test('bootstrap: unknown → refreshing → authenticated', () => {
  let s = createInitialAuthState();
  s = transitionAuth(s, { type: 'REFRESH_START' });
  assert.equal(s.status, AUTH_STATUS.REFRESHING);
  assert.equal(selectAuthChromeMode(s), 'pending');

  s = transitionAuth(s, { type: 'REFRESH_SUCCESS', user, csrfToken: 'tok' });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.user, user);
  assert.equal(s.csrfToken, 'tok');
  assert.equal(s.ready, true);
  assert.equal(selectIsAuthenticated(s), true);
  assert.equal(selectAuthChromeMode(s), 'user');
  assert.equal(selectIsSettled(s), true);
});

test('bootstrap: unknown → refreshing → anonymous on 401', () => {
  let s = createInitialAuthState();
  s = transitionAuth(s, { type: 'REFRESH_START' });
  s = transitionAuth(s, {
    type: 'REFRESH_FAILURE',
    status: 401,
    code: 'UNAUTHORIZED',
    message: '未登录或会话已过期',
  });
  assert.equal(s.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(s.user, null);
  assert.equal(s.csrfToken, null);
  assert.equal(s.ready, true);
  assert.equal(s.error, null);
  assert.equal(selectAuthChromeMode(s), 'guest');
});

test('bootstrap: refresh network error → error status', () => {
  let s = createInitialAuthState();
  s = transitionAuth(s, { type: 'REFRESH_START' });
  s = transitionAuth(s, {
    type: 'REFRESH_FAILURE',
    status: 503,
    message: 'boom',
  });
  assert.equal(s.status, AUTH_STATUS.ERROR);
  assert.equal(s.ready, true);
  assert.equal(s.user, null);
  assert.match(s.error, /boom/);
  assert.equal(selectAuthChromeMode(s), 'guest');
});

test('soft refresh keeps user visible while refreshing', () => {
  let s = transitionAuth(createInitialAuthState(), {
    type: 'SESSION_ESTABLISHED',
    user,
    csrfToken: 'a',
  });
  s = transitionAuth(s, { type: 'REFRESH_START' });
  assert.equal(s.status, AUTH_STATUS.REFRESHING);
  assert.equal(s.user, user);
  assert.equal(selectAuthChromeMode(s), 'user');
  assert.equal(selectIsSettled(s), false);
});

test('SESSION_CLEARED → anonymous (logout / api 401)', () => {
  let s = transitionAuth(createInitialAuthState(), {
    type: 'SESSION_ESTABLISHED',
    user,
    csrfToken: 'a',
  });
  s = transitionAuth(s, { type: 'SESSION_CLEARED' });
  assert.equal(s.status, AUTH_STATUS.ANONYMOUS);
  assert.equal(s.user, null);
  assert.equal(s.csrfToken, null);
  assert.equal(selectIsAuthenticated(s), false);
  assert.equal(selectAuthChromeMode(s), 'guest');
});

test('SESSION_ESTABLISHED from anonymous (login/register)', () => {
  let s = transitionAuth(createInitialAuthState(), {
    type: 'REFRESH_FAILURE',
    status: 401,
    code: 'UNAUTHORIZED',
  });
  s = transitionAuth(s, {
    type: 'SESSION_ESTABLISHED',
    user,
    csrfToken: 'b',
  });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.csrfToken, 'b');
});

test('USER_UPDATED patches profile without leaving authenticated', () => {
  let s = transitionAuth(createInitialAuthState(), {
    type: 'SESSION_ESTABLISHED',
    user,
    csrfToken: 'a',
  });
  const next = { ...user, nickname: '新的韭菜' };
  s = transitionAuth(s, { type: 'USER_UPDATED', user: next });
  assert.equal(s.status, AUTH_STATUS.AUTHENTICATED);
  assert.equal(s.user.nickname, '新的韭菜');
});

test('isUnauthorized distinguishes session expiry from bad password', () => {
  assert.equal(isUnauthorized({ status: 401, code: 'UNAUTHORIZED' }), true);
  assert.equal(isUnauthorized({ status: 401, code: 'INVALID_CREDENTIALS' }), false);
  assert.equal(isUnauthorized({ status: 401, code: 'BAD_PASSWORD' }), false);
  assert.equal(isUnauthorized({ status: 403, code: 'FORBIDDEN' }), false);
  assert.equal(isUnauthorized({ status: 401 }), true);
});

test('unknown event is a no-op', () => {
  const s0 = createInitialAuthState();
  const s1 = transitionAuth(s0, { type: 'NOPE' });
  assert.equal(s1, s0);
  assert.equal(s1.status, AUTH_STATUS.UNKNOWN);
});
