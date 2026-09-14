import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_PREFIX,
  buildApiHeaders,
  mapApiError,
  parseApiResponse,
  apiRequest,
  apiMultipartRequest,
  fetchMe,
  postLogin,
  postRegister,
  postLogout,
  patchMe,
  postAvatar,
} from '../js/auth-http.js';

function jsonResponse(status, body, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: h });
}

test('buildApiHeaders sets Accept, optional JSON Content-Type and CSRF', () => {
  assert.deepEqual(buildApiHeaders({}), { Accept: 'application/json' });
  assert.deepEqual(buildApiHeaders({ jsonBody: true }), {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(buildApiHeaders({ csrf: 'tok', jsonBody: true }), {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-CSRF-Token': 'tok',
  });
  // Multipart: CSRF only, never Content-Type (boundary is browser-set).
  assert.deepEqual(buildApiHeaders({ csrf: 'tok', jsonBody: false }), {
    Accept: 'application/json',
    'X-CSRF-Token': 'tok',
  });
});

test('mapApiError normalizes message, code, status, payload', () => {
  const err = mapApiError(401, {
    error: { code: 'UNAUTHORIZED', message: '未登录或会话已过期' },
  });
  assert.equal(err.message, '未登录或会话已过期');
  assert.equal(err.code, 'UNAUTHORIZED');
  assert.equal(err.status, 401);
  assert.equal(err.payload.error.code, 'UNAUTHORIZED');
});

test('mapApiError falls back to HTTP status when body empty', () => {
  const err = mapApiError(503, {});
  assert.equal(err.message, 'HTTP 503');
  assert.equal(err.status, 503);
  assert.equal(err.code, undefined);
});

test('parseApiResponse maps 204 and success envelopes', async () => {
  const empty = await parseApiResponse(new Response(null, { status: 204 }));
  assert.deepEqual(empty, { ok: true, status: 204, data: null, requestId: undefined });

  const ok = await parseApiResponse(
    jsonResponse(200, { data: { user: { id: 'u1' } }, requestId: 'r1' })
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { user: { id: 'u1' } });
  assert.equal(ok.requestId, 'r1');
});

test('parseApiResponse throws mapApiError on non-OK', async () => {
  await assert.rejects(
    () =>
      parseApiResponse(
        jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: '密码错误' } })
      ),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.equal(err.message, '密码错误');
      return true;
    }
  );
});

test('apiRequest builds /api/v1 URL, credentials, JSON body, CSRF', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { data: { ok: true }, requestId: 'x' });
  };
  const result = await apiRequest('/auth/login', {
    method: 'POST',
    body: { username: 'aaaa', password: '1111' },
    csrf: 'csrf-1',
    fetchImpl,
  });
  assert.equal(result.data.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_PREFIX}/auth/login`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(calls[0].init.body, JSON.stringify({ username: 'aaaa', password: '1111' }));
});

test('apiRequest GET omits Content-Type and body', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { data: { user: null } });
  };
  await apiRequest('/me', { fetchImpl });
  assert.equal(calls[0].url, `${API_PREFIX}/me`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
});

test('named auth helpers hit expected paths', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body });
    return jsonResponse(200, { data: { user: { id: 'u' }, csrfToken: 't' } });
  };

  await fetchMe({ fetchImpl });
  await postLogin({ username: 'a', password: 'b' }, { fetchImpl });
  await postRegister({ username: 'a', password: 'b', termsVersion: 'v1' }, { fetchImpl });
  await postLogout({ csrf: 't', fetchImpl });
  await patchMe({ nickname: 'n' }, { csrf: 't', fetchImpl });

  assert.deepEqual(
    seen.map((s) => [s.method, s.url]),
    [
      ['GET', `${API_PREFIX}/me`],
      ['POST', `${API_PREFIX}/auth/login`],
      ['POST', `${API_PREFIX}/auth/register`],
      ['POST', `${API_PREFIX}/auth/logout`],
      ['PATCH', `${API_PREFIX}/me`],
    ]
  );
  assert.equal(JSON.parse(seen[1].body).username, 'a');
  assert.equal(JSON.parse(seen[4].body).nickname, 'n');
});

test('apiMultipartRequest / postAvatar leave Content-Type unset', async () => {
  const calls = [];
  const fd = new FormData();
  fd.append('avatar', new Blob(['x']), 'a.jpg');
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { data: { user: { id: 'u' } } });
  };
  const result = await postAvatar(fd, { csrf: 'tok', fetchImpl });
  assert.equal(result.data.user.id, 'u');
  assert.equal(calls[0].url, `${API_PREFIX}/me/avatar`);
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 'tok');
  assert.equal(calls[0].init.headers['Content-Type'], undefined);
  assert.equal(calls[0].init.body, fd);
});

test('apiMultipartRequest throws normalized errors', async () => {
  const fetchImpl = async () =>
    jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'gone' } });
  await assert.rejects(
    () => apiMultipartRequest('/me/avatar', new FormData(), { fetchImpl }),
    (err) => err.code === 'UNAUTHORIZED' && err.status === 401
  );
});
