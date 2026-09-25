import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestEnv, startTestServer } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "mini_intraday.jsonl");

prepareTestEnv();
delete process.env.INTRADAY_MODE_ENABLED;
process.env.STOCKGAME_INTRADAY_PATH = FIXTURE;
const T0 = Date.parse("2026-09-25T12:00:00.000Z");
process.env.STOCKGAME_NOW_MS = String(T0);

const { openDb } = await import("../src/db/connection.js");
const { getJiuCoinBalance, JIU_COIN_GAME_CREATE_COST, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const { importIntradayTail } = await import("../src/lib/intradayPack.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

test("flag off: intraday routes 404, classic still debits 20, gameKind intraday rejected", async (t) => {
  await t.test("config and disabled routes", async () => {
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.data.features.intradayMode, false);

    const status = await api("/api/v1/intraday");
    assert.equal(status.status, 404);
    assert.equal(status.json.error.code, "INTRADAY_DISABLED");

    const auth = await register(`offget${Date.now().toString(36)}`);
    const post = await api("/api/v1/intraday/sessions", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": "off-intraday-create" },
      body: { mode: "practice", startMode: "flat" },
    });
    assert.equal(post.status, 404);
    assert.equal(post.json.error.code, "INTRADAY_DISABLED");
  });

  await t.test("classic create debits 20 and does not query intraday_sessions", async () => {
    const auth = await register(`offcl${Date.now().toString(36)}`);
    const before = getJiuCoinBalance(auth.user.id);
    assert.equal(before, JIU_COIN_REGISTER_GRANT);
    const db = openDb();
    const origPrepare = db.prepare.bind(db);
    const origTx = db.transaction.bind(db);
    let sawIntraday = false;
    let sawImmediate = false;
    db.prepare = (sql, ...args) => {
      if (String(sql).includes("intraday_sessions")) sawIntraday = true;
      if (String(sql).includes("BEGIN IMMEDIATE")) sawImmediate = true;
      return origPrepare(sql, ...args);
    };
    // better-sqlite3 defines tx.immediate as non-writable; wrap the function instead.
    db.transaction = (fn) => {
      const tx = origTx(fn);
      const wrapped = (...args) => tx(...args);
      wrapped.immediate = (...args) => {
        sawImmediate = true;
        return tx.immediate(...args);
      };
      wrapped.deferred = (...args) => tx.deferred(...args);
      wrapped.exclusive = (...args) => tx.exclusive(...args);
      return wrapped;
    };
    try {
      const create = await api("/api/v1/games", {
        method: "POST",
        csrf: auth.csrfToken,
        headers: { "Idempotency-Key": `off-cl-${Date.now()}` },
        body: {
          fillMode: "next_open",
          pick: { stockIndex: 0, windowStartIndex: 30, historyLength: 30 },
        },
      });
      assert.equal(create.status, 201, JSON.stringify(create.json));
      assert.equal(create.json.data.gameKind, "classic");
      assert.equal(getJiuCoinBalance(auth.user.id), before - JIU_COIN_GAME_CREATE_COST);
      assert.equal(JIU_COIN_GAME_CREATE_COST, 20);
      assert.equal(sawIntraday, false);
      assert.equal(sawImmediate, false);
      assert.equal(create.json.error, undefined);
      assert.ok(create.json.data.gameId);
    } finally {
      db.prepare = origPrepare;
      db.transaction = origTx;
    }
  });

  await t.test("POST /games rejects gameKind=intraday", async () => {
    const auth = await register(`offk${Date.now().toString(36)}`);
    const create = await api("/api/v1/games", {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `off-kind-${Date.now()}` },
      body: { fillMode: "next_open", gameKind: "intraday" },
    });
    assert.equal(create.status, 400);
    assert.equal(create.json.error.code, "INVALID_GAME_KIND");
  });

  await t.test("existing session advance and finish still 200", async () => {
    importIntradayTail();
    const auth = await register(`offses${Date.now().toString(36)}`);
    const db = openDb();
    const tape = db.prepare(`SELECT id FROM intraday_tapes WHERE eligible = 1 LIMIT 1`).get();
    assert.ok(tape, "fixture tape should import");
    const sessionId = `off-session-${auth.user.id}`;
    const started = new Date(T0).toISOString();
    const expires = new Date(T0 + 24100 + 90000).toISOString();
    db.prepare(
      `INSERT INTO intraday_sessions (
        id, user_id, create_key, create_payload_hash, score_version,
        mode, start_mode, tape_id, cursor, revision, canonical_actions_json,
        clock_origin_ms, bar_interval_ms, status, started_at, expires_at
      ) VALUES (?, ?, ?, ?, 'intraday-t0-mtm-v1', 'practice', 'flat', ?, -1, 0, '[]', ?, 100, 'active', ?, ?)`
    ).run(sessionId, auth.user.id, `off-key-${auth.user.id}`, "hash", tape.id, T0, started, expires);

    process.env.STOCKGAME_NOW_MS = String(T0);
    const advance = await api(`/api/v1/intraday/sessions/${sessionId}/advance`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `off-adv-${auth.user.id}` },
      body: { expectedRevision: 0, op: "prefetch" },
    });
    assert.equal(advance.status, 200, JSON.stringify(advance.json));
    assert.equal(advance.json.data.revision, 1);
    assert.ok(advance.json.data.bars.length <= 20);

    process.env.STOCKGAME_NOW_MS = String(T0 + 24500);
    const finish = await api(`/api/v1/intraday/sessions/${sessionId}/finish`, {
      method: "POST",
      csrf: auth.csrfToken,
      headers: { "Idempotency-Key": `off-fin-${auth.user.id}` },
      body: { expectedRevision: 1, finish: true },
    });
    assert.equal(finish.status, 200, JSON.stringify(finish.json));
    assert.equal(typeof finish.json.data.returnPpm, "number");
  });
});
