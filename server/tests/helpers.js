import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DATASET = path.join(__dirname, "fixtures", "mini_stocks.json");

export function holds(n = 29) {
  return Array.from({ length: n }, () => "hold");
}

export function actionsObj(list) {
  return list.map((action, i) => ({ day: i + 1, action }));
}

/**
 * Prepare isolated env for one test file / suite. Must be called BEFORE importing app modules.
 */
export function prepareTestEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stockgame-stage3-"));
  const dbPath = path.join(dir, "test.sqlite");
  process.env.NODE_ENV = "development";
  process.env.CSRF_SECRET = "test-csrf-secret-32bytes-min!!";
  process.env.COOKIE_SECURE = "0";
  process.env.SESSION_COOKIE_NAME = "stockgame_session";
  process.env.ORIGIN_ALLOWLIST = "http://127.0.0.1";
  process.env.STOCKGAME_DB_PATH = dbPath;
  process.env.STOCKGAME_DATA_DIR = dir;
  process.env.STOCKGAME_DATASET_PATH = FIXTURE_DATASET;
  process.env.STOCKGAME_ALLOW_PICK_OVERRIDE = "1";
  return { dir, dbPath };
}

export function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length ? raw : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  const cookies = {};
  for (const line of list) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return cookies;
}

export function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function startTestServer() {
  const { closeDb } = await import("../src/db/connection.js");
  closeDb();
  const { resetDatasetCache } = await import("../src/lib/dataset.js");
  resetDatasetCache();
  const { createApp } = await import("../src/app.js");
  const app = createApp({ skipStatic: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const jar = {};

  async function api(pathname, { method = "GET", body, headers = {}, csrf } = {}) {
    const h = { Accept: "application/json", ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (csrf) h["X-CSRF-Token"] = csrf;
    const cookie = cookieHeader(jar);
    if (cookie) h.Cookie = cookie;
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = parseSetCookie(res);
    Object.assign(jar, set);
    let json = null;
    if (res.status !== 204) {
      json = await res.json().catch(() => null);
    }
    return { res, json, status: res.status };
  }

  async function register(username = `u${Date.now().toString(36)}`, password = "pass1234") {
    // Drop prior session so register is not treated as an authenticated write (CSRF).
    for (const k of Object.keys(jar)) delete jar[k];
    const { res, json, status } = await api("/api/v1/auth/register", {
      method: "POST",
      body: {
        username,
        password,
        nickname: "测友",
        termsVersion: "v1",
        leaderboardOptIn: false,
      },
    });
    if (status !== 201) throw new Error(`register failed ${status} ${JSON.stringify(json)}`);
    return { username, password, user: json.data.user, csrfToken: json.data.csrfToken };
  }

  async function stop() {
    await new Promise((r) => server.close(r));
    closeDb();
  }

  return { base, api, register, stop, jar, server };
}
