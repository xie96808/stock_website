import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAvatarError, DEFAULT_AVATAR_SRC } from '../js/avatar-fallback.js';

function fakeImg(src, attrs = {}) {
  const a = { src, ...attrs };
  return {
    tagName: 'IMG',
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    hasAttribute: (k) => k in a,
    get attrs() { return a; },
  };
}

test('custom avatar 404 → default preset', () => {
  const img = fakeImg('/api/v1/avatars/https%3A%2F%2Fx%2Fp.png');
  assert.equal(handleAvatarError(img), true);
  assert.equal(img.attrs.src, DEFAULT_AVATAR_SRC);
  assert.equal(handleAvatarError(img), false, 'default failing does not loop');
});

test('custom avatar 404 → data-fallback-src preset, then default', () => {
  const img = fakeImg('/api/v1/avatars/a.jpg', { 'data-fallback-src': 'images/avatars/07.png' });
  assert.equal(handleAvatarError(img), true);
  assert.equal(img.attrs.src, 'images/avatars/07.png');
  assert.equal(handleAvatarError(img), true);
  assert.equal(img.attrs.src, DEFAULT_AVATAR_SRC);
  assert.equal(handleAvatarError(img), false);
});

test('non-avatar images are ignored', () => {
  const img = fakeImg('images/homepage.png');
  assert.equal(handleAvatarError(img), false);
  assert.equal(img.attrs.src, 'images/homepage.png');
  assert.equal(handleAvatarError({ tagName: 'DIV' }), false);
});
