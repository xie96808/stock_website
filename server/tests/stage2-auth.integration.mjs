#!/usr/bin/env node
/**
 * Stage 2 P0/P1 integration verification against localhost API.
 *
 * HOW TO RUN (dev):
 *   1. STOCKGAME_DB_PATH=/tmp/sg.sqlite PORT=8787 node server/src/index.js
 *   2. node server/tests/stage2-auth.integration.mjs
 *
 * Expects API at BASE_URL (default http://127.0.0.1:8787).
 */
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
const results = [];

function record(id, level, name, pass, detail = "") {
  results.push({ id, level, name, pass, detail: String(detail).slice(0, 500) });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${level} ${id}: ${name}${detail ? " — " + String(detail).slice(0, 160) : ""}`);
}

function parseSetCookie(res) {
  // Node fetch: getSetCookie if available
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  return list;
}

function extractCookie(setCookies, name) {
  for (const c of setCookies) {
    const m = c.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
    const m2 = c.match(new RegExp(`^${name}=([^;]+)`));
    if (m2) return decodeURIComponent(m2[1]);
  }
  return null;
}

function cookieFlags(setCookies, name) {
  const line = setCookies.find((c) => c.startsWith(`${name}=`) || c.includes(`${name}=`)) || "";
  return {
    raw: line,
    httpOnly: /httponly/i.test(line),
    sameSite: (/samesite=([^;]+)/i.exec(line) || [])[1] || null,
    secure: /;\s*secure/i.test(line) || /(?:^|,\s*)secure/i.test(line),
    path: (/path=([^;]+)/i.exec(line) || [])[1] || null,
  };
}

async function req(path, { method = "GET", body, cookie, csrf, origin, headers: extra = {} } = {}) {
  const headers = { Accept: "application/json", ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (origin !== undefined) {
    if (origin !== null) headers.Origin = origin;
  } else if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    headers.Origin = "http://127.0.0.1:8787";
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = parseSetCookie(res);
  let json = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  }
  return { status: res.status, headers: res.headers, setCookies, json, text };
}

function sessionCookieHeader(token) {
  return `stockgame_session=${token}`;
}

const uniq = `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const password = "GoodPass9";
const weakPw = "123";
const weakListed = "1234";

let sessionToken = null;
let csrfToken = null;
let recoveryCode = null;
let user = null;

async function main() {
  // Health
  {
    const r = await req("/api/v1/health/live");
    record("health", "meta", "health live", r.status === 200 && r.json?.data?.status === "live", `status=${r.status}`);
  }

  // P0-2a: GET /me when not logged in -> 401
  {
    const r = await req("/api/v1/me");
    record("P0-2b", "P0", "GET /me unauthenticated -> 401", r.status === 401, `status=${r.status} code=${r.json?.error?.code}`);
  }

  // P1: short password rejected
  {
    const r = await req("/api/v1/auth/register", {
      method: "POST",
      body: { username: `${uniq}a`, password: weakPw, nickname: "测试用户", termsVersion: "v1" },
    });
    record("P1-weak-short", "P1", "password <4 rejected", r.status === 400 && r.json?.error?.code === "INVALID_PASSWORD", `status=${r.status} code=${r.json?.error?.code} msg=${r.json?.error?.message}`);
  }

  // P1: weak listed password rejected
  {
    const r = await req("/api/v1/auth/register", {
      method: "POST",
      body: { username: `${uniq}b`, password: weakListed, nickname: "测试用户", termsVersion: "v1" },
    });
    record("P1-weak-listed", "P1", "weak password list rejected", r.status === 400 && r.json?.error?.code === "INVALID_PASSWORD", `status=${r.status} msg=${r.json?.error?.message}`);
  }

  // P0-1: Register
  {
    const r = await req("/api/v1/auth/register", {
      method: "POST",
      body: {
        username: uniq,
        password,
        nickname: "验测同学",
        termsVersion: "v1",
        leaderboardOptIn: false,
      },
    });
    const ok = r.status === 201 && r.json?.data?.user?.username === uniq && r.json?.data?.csrfToken && r.json?.data?.recoveryCode;
    sessionToken = extractCookie(r.setCookies, "stockgame_session");
    csrfToken = r.json?.data?.csrfToken;
    recoveryCode = r.json?.data?.recoveryCode;
    user = r.json?.data?.user;
    const flags = cookieFlags(r.setCookies, "stockgame_session");
    record("P0-1-register", "P0", "Register username+password min4", ok && !!sessionToken, `status=${r.status} user=${user?.username} avatar=${user?.avatarId} cookie=${!!sessionToken}`);
    record("P0-2a", "P0", "Session cookie httpOnly", flags.httpOnly && !!sessionToken, `flags=${JSON.stringify(flags)}`);
    record("P1-optin-default", "P1", "leaderboard_opt_in default false", user?.leaderboardOptIn === false, `optIn=${user?.leaderboardOptIn}`);
    record("P0-6-recovery-issued", "P0", "Recovery code issued on register", typeof recoveryCode === "string" && recoveryCode.length >= 16, `len=${recoveryCode?.length}`);
  }

  // P1: duplicate username
  {
    const r = await req("/api/v1/auth/register", {
      method: "POST",
      body: { username: uniq, password, nickname: "另一个人", termsVersion: "v1" },
    });
    record("P1-dup-user", "P1", "Duplicate username rejected", r.status === 409 && r.json?.error?.code === "USERNAME_TAKEN", `status=${r.status} code=${r.json?.error?.code}`);
  }

  // P0-2: GET /me when logged in
  {
    const r = await req("/api/v1/me", { cookie: sessionCookieHeader(sessionToken) });
    const ok = r.status === 200 && r.json?.data?.user?.username === uniq && r.json?.data?.csrfToken;
    if (r.json?.data?.csrfToken) csrfToken = r.json.data.csrfToken;
    record("P0-2c", "P0", "GET /me when logged in", ok, `status=${r.status} user=${r.json?.data?.user?.username}`);
  }

  // P0-4: CSRF missing fails on mutating authenticated route
  {
    const r = await req("/api/v1/me", {
      method: "PATCH",
      cookie: sessionCookieHeader(sessionToken),
      body: { nickname: "无CSRF" },
      // no csrf
    });
    record("P0-4a", "P0", "CSRF missing on PATCH /me fails", r.status === 403 && r.json?.error?.code === "CSRF_FAILED", `status=${r.status} code=${r.json?.error?.code}`);
  }

  // P0-4: CSRF forged fails
  {
    const r = await req("/api/v1/me", {
      method: "PATCH",
      cookie: sessionCookieHeader(sessionToken),
      csrf: "forged-csrf-token-value-xxx",
      body: { nickname: "假CSRF" },
    });
    record("P0-4b", "P0", "CSRF forged on PATCH /me fails", r.status === 403 && r.json?.error?.code === "CSRF_FAILED", `status=${r.status} code=${r.json?.error?.code}`);
  }

  // Origin denied (also documented same-origin protection)
  {
    const r = await req("/api/v1/me", {
      method: "PATCH",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
      origin: "https://evil.example",
      body: { nickname: "坏来源" },
    });
    record("P0-4c", "P0", "Origin allowlist blocks evil origin", r.status === 403 && r.json?.error?.code === "ORIGIN_DENIED", `status=${r.status} code=${r.json?.error?.code}`);
  }

  // P0-3: PATCH /me nickname + avatar_id 1..12
  {
    const r = await req("/api/v1/me", {
      method: "PATCH",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
      body: { nickname: "改昵称了", avatarId: 7 },
    });
    const u = r.json?.data?.user;
    record("P0-3a", "P0", "PATCH /me nickname + avatar_id", r.status === 200 && u?.nickname === "改昵称了" && u?.avatarId === 7, `status=${r.status} nick=${u?.nickname} av=${u?.avatarId}`);
  }

  // Invalid avatar
  {
    const r = await req("/api/v1/me", {
      method: "PATCH",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
      body: { avatarId: 13 },
    });
    record("P0-3b", "P0", "avatar_id out of range rejected", r.status === 400 && r.json?.error?.code === "INVALID_AVATAR", `status=${r.status} code=${r.json?.error?.code}`);
  }

  // Client dice path: code inspection note recorded later; here verify all avatar ids 1-12 accept
  {
    let allOk = true;
    const fails = [];
    for (let i = 1; i <= 12; i++) {
      const r = await req("/api/v1/me", {
        method: "PATCH",
        cookie: sessionCookieHeader(sessionToken),
        csrf: csrfToken,
        body: { avatarId: i },
      });
      if (!(r.status === 200 && r.json?.data?.user?.avatarId === i)) {
        allOk = false;
        fails.push(i);
      }
    }
    record("P0-3c", "P0", "avatar_id 1..12 all accepted (dice client path OK)", allOk, fails.length ? `fail ids=${fails}` : "all 12 ok");
  }

  // P0-7: zodiac avatars serve 200
  {
    let allOk = true;
    const fails = [];
    for (let i = 1; i <= 12; i++) {
      const n = String(i).padStart(2, "0");
      const r = await fetch(`${BASE}/images/avatars/${n}.svg`);
      if (r.status !== 200) { allOk = false; fails.push(`${n}:${r.status}`); }
      const ct = r.headers.get("content-type") || "";
      if (!(ct.includes("svg") || ct.includes("xml") || ct.includes("text"))) {
        // still pass if 200 body looks like svg
        const t = await r.text();
        if (!t.includes("<svg")) { allOk = false; fails.push(`${n}:badbody`); }
      } else {
        await r.arrayBuffer();
      }
    }
    record("P0-7", "P0", "Zodiac avatars 01-12.svg serve 200", allOk, fails.length ? fails.join(",") : "12/12 200");
  }

  // Login / logout cycle
  {
    // logout
    const lo = await req("/api/v1/auth/logout", {
      method: "POST",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
    });
    // 204 expected
    const meAfter = await req("/api/v1/me", { cookie: sessionCookieHeader(sessionToken) });
    record("P0-1-logout", "P0", "Logout invalidates session", (lo.status === 204 || lo.status === 200) && meAfter.status === 401, `logout=${lo.status} me=${meAfter.status}`);

    // login again
    const li = await req("/api/v1/auth/login", {
      method: "POST",
      body: { username: uniq, password },
    });
    sessionToken = extractCookie(li.setCookies, "stockgame_session");
    csrfToken = li.json?.data?.csrfToken;
    record("P0-1-login", "P0", "Login works", li.status === 200 && !!sessionToken && !!csrfToken, `status=${li.status}`);
  }

  // P0-5: password change invalidates old sessions
  {
    // create second session via login (keep first)
    const s1 = sessionToken;
    const c1 = csrfToken;
    const li2 = await req("/api/v1/auth/login", {
      method: "POST",
      body: { username: uniq, password },
    });
    const s2 = extractCookie(li2.setCookies, "stockgame_session");
    const c2 = li2.json?.data?.csrfToken;
    const newPassword = "BetterPass9";
    const ch = await req("/api/v1/me/password", {
      method: "POST",
      cookie: sessionCookieHeader(s2),
      csrf: c2,
      body: { currentPassword: password, newPassword },
    });
    const meOld = await req("/api/v1/me", { cookie: sessionCookieHeader(s1) });
    const meNew = await req("/api/v1/me", { cookie: sessionCookieHeader(s2) });
    // login with new password
    const liNew = await req("/api/v1/auth/login", {
      method: "POST",
      body: { username: uniq, password: newPassword },
    });
    sessionToken = extractCookie(liNew.setCookies, "stockgame_session");
    csrfToken = liNew.json?.data?.csrfToken;
    const passOk = (ch.status === 204 || ch.status === 200)
      && meOld.status === 401
      && meNew.status === 401
      && liNew.status === 200
      && !!sessionToken;
    record("P0-5", "P0", "Password change invalidates old sessions", passOk, `ch=${ch.status} oldMe=${meOld.status} curMe=${meNew.status} relogin=${liNew.status}`);
  }

  // P0-6: recovery code flow
  {
    // need recovery code from register; after password change recovery still valid
    const bad = await req("/api/v1/auth/recover", {
      method: "POST",
      body: { username: uniq, recoveryCode: "wrong-code-totally", newPassword: "Recovered1" },
    });
    record("P0-6a", "P0", "Bad recovery code rejected", bad.status === 401 && bad.json?.error?.code === "INVALID_RECOVERY", `status=${bad.status}`);

    const good = await req("/api/v1/auth/recover", {
      method: "POST",
      body: { username: uniq, recoveryCode, newPassword: "Recovered1" },
    });
    const newRec = good.json?.data?.recoveryCode;
    const oldSess = await req("/api/v1/me", { cookie: sessionCookieHeader(sessionToken) });
    const li = await req("/api/v1/auth/login", {
      method: "POST",
      body: { username: uniq, password: "Recovered1" },
    });
    sessionToken = extractCookie(li.setCookies, "stockgame_session");
    csrfToken = li.json?.data?.csrfToken;
    recoveryCode = newRec;
    record("P0-6b", "P0", "Recovery code resets password + sessions", good.status === 200 && !!newRec && oldSess.status === 401 && li.status === 200, `recover=${good.status} oldMe=${oldSess.status} login=${li.status}`);
  }

  // P1: DELETE account
  {
    const badConf = await req("/api/v1/me", {
      method: "DELETE",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
      body: { currentPassword: "Recovered1", confirmation: "NOPE" },
    });
    record("P1-delete-confirm", "P1", "DELETE requires confirmation=DELETE", badConf.status === 400, `status=${badConf.status} code=${badConf.json?.error?.code}`);

    const del = await req("/api/v1/me", {
      method: "DELETE",
      cookie: sessionCookieHeader(sessionToken),
      csrf: csrfToken,
      body: { currentPassword: "Recovered1", confirmation: "DELETE" },
    });
    const me = await req("/api/v1/me", { cookie: sessionCookieHeader(sessionToken) });
    const loginGone = await req("/api/v1/auth/login", {
      method: "POST",
      body: { username: uniq, password: "Recovered1" },
    });
    record("P1-delete", "P1", "DELETE account soft-deletes + revokes", (del.status === 204 || del.status === 200) && me.status === 401 && loginGone.status === 401, `del=${del.status} me=${me.status} login=${loginGone.status}`);
  }

  // Client dice path code presence (static check via fetch of js/auth.js)
  {
    const r = await fetch(`${BASE}/js/auth.js`);
    const t = await r.text();
    const hasDice = t.includes("avatarDice") && t.includes("onDice") && t.includes("Math.random() * 12");
    record("P0-3d", "P0", "Client dice/random avatar path present", r.status === 200 && hasDice, `status=${r.status} hasDice=${hasDice}`);
  }

  // Summary
  const p0 = results.filter((x) => x.level === "P0");
  const p1 = results.filter((x) => x.level === "P1");
  const p0Fail = p0.filter((x) => !x.pass);
  const p1Fail = p1.filter((x) => !x.pass);
  console.log("\n=== SUMMARY ===");
  console.log(`P0: ${p0.filter((x) => x.pass).length}/${p0.length} pass`);
  console.log(`P1: ${p1.filter((x) => x.pass).length}/${p1.length} pass`);
  if (p0Fail.length) console.log("P0 failures:", p0Fail.map((x) => x.id).join(", "));
  if (p1Fail.length) console.log("P1 failures:", p1Fail.map((x) => x.id).join(", "));

  const out = { base: BASE, results, p0Pass: p0Fail.length === 0, p1Pass: p1Fail.length === 0 };
  const outPath = process.env.STAGE2_RESULTS_PATH || new URL("./stage2_verify_results.json", import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("wrote", outPath);
  process.exit(p0Fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
