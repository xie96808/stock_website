import test from "node:test";
import assert from "node:assert/strict";
import { prepareTestEnv, startTestServer } from "./helpers.js";

prepareTestEnv();
process.env.QUIZ_REWARDS_ENABLED = "1";

const { openDb } = await import("../src/db/connection.js");
const { config } = await import("../src/lib/config.js");
const { getJiuCoinBalance, JIU_COIN_REGISTER_GRANT } = await import("../src/lib/jiuCoin.js");
const { hasRewardClaim } = await import("../src/lib/rewardClaims.js");
const { shanghaiYmd } = await import("../src/lib/jiuCoin.js");
const { quizRewardKey, ensureDailySet } = await import("../src/lib/quizRewards.js");

const ctx = await startTestServer();
const { api, register, stop } = ctx;

test.after(async () => {
  await stop();
});

async function startAttempt(auth) {
  const r = await api("/api/v1/quiz/daily/attempts", {
    method: "POST",
    csrf: auth.csrfToken,
    body: {},
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  return r.json.data;
}

async function daily(auth) {
  const r = await api("/api/v1/quiz/daily");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
}

function correctOptionId(questionId) {
  const row = openDb().prepare(`SELECT correct_option_id FROM quiz_questions WHERE id = ?`).get(questionId);
  return row.correct_option_id;
}

function wrongOptionId(questionId) {
  const row = openDb().prepare(`SELECT options_json, correct_option_id FROM quiz_questions WHERE id = ?`).get(questionId);
  const opts = JSON.parse(row.options_json);
  const w = opts.find((o) => o.id !== row.correct_option_id);
  return w.id;
}

async function answerAll(auth, attemptId, questions, { correctCount }) {
  let settled = null;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const optionId = i < correctCount ? correctOptionId(q.id) : wrongOptionId(q.id);
    const r = await api(`/api/v1/quiz/attempts/${attemptId}/answers`, {
      method: "POST",
      csrf: auth.csrfToken,
      body: { questionId: q.id, optionId },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (r.json.data.status === "settled") settled = r.json.data.settled;
  }
  return settled;
}

test("config exposes quizRewards when enabled", async () => {
  assert.equal(config.quizRewardsEnabled, true);
  const cfg = await api("/api/v1/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.data.features.quizRewards, true);
});

test("migration seeds question bank and can materialize daily set", () => {
  const n = openDb().prepare(`SELECT COUNT(*) AS c FROM quiz_questions WHERE active = 1`).get().c;
  assert.ok(n >= 30, `expected >=30 questions, got ${n}`);
  const set = ensureDailySet(shanghaiYmd());
  assert.ok(set);
  assert.equal(set.questionIds.length, 5);
});

test("unauthenticated cannot create attempt", async () => {
  for (const k of Object.keys(ctx.jar)) delete ctx.jar[k];
  const r = await api("/api/v1/quiz/daily/attempts", { method: "POST", body: {} });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, "UNAUTHORIZED");
});

test("complete 5 with 3 first-correct → +10", async () => {
  const auth = await register(`q10${Date.now().toString(36)}`);
  const attempt = await startAttempt(auth);
  const d = await daily(auth);
  assert.equal(d.ready, true);
  assert.equal(d.questions.length, 5);
  // Ensure no answers leaked before settle
  for (const q of d.questions) {
    assert.equal(q.correctOptionId, undefined);
    assert.equal(q.explanation, undefined);
  }
  const settled = await answerAll(auth, attempt.attemptId, d.questions, { correctCount: 3 });
  assert.ok(settled);
  assert.equal(settled.firstCorrectCount, 3);
  assert.equal(settled.rewardAmount, 10);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + 10);
  const key = quizRewardKey(d.setDate);
  assert.equal(hasRewardClaim(auth.user.id, key), true);

  const after = await daily(auth);
  assert.equal(after.status, "settled");
  assert.ok(after.questions[0].correctOptionId);
  assert.ok(after.questions[0].explanation);
});

test("≥4 first-correct → +20", async () => {
  const auth = await register(`q20${Date.now().toString(36)}`);
  const attempt = await startAttempt(auth);
  const d = await daily(auth);
  const settled = await answerAll(auth, attempt.attemptId, d.questions, { correctCount: 4 });
  assert.equal(settled.firstCorrectCount, 4);
  assert.equal(settled.rewardAmount, 20);
  assert.equal(getJiuCoinBalance(auth.user.id), JIU_COIN_REGISTER_GRANT + 20);
});

test("idempotent settle / duplicate answer lock", async () => {
  const auth = await register(`qid${Date.now().toString(36)}`);
  const attempt = await startAttempt(auth);
  const d = await daily(auth);
  const q0 = d.questions[0];
  const correct = correctOptionId(q0.id);
  const wrong = wrongOptionId(q0.id);

  const first = await api(`/api/v1/quiz/attempts/${attempt.attemptId}/answers`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { questionId: q0.id, optionId: correct },
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.unchanged, false);

  const dup = await api(`/api/v1/quiz/attempts/${attempt.attemptId}/answers`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { questionId: q0.id, optionId: wrong },
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.data.unchanged, true);
  assert.equal(dup.json.data.optionId, correct);

  // Finish remaining with all correct
  for (let i = 1; i < d.questions.length; i++) {
    const q = d.questions[i];
    const r = await api(`/api/v1/quiz/attempts/${attempt.attemptId}/answers`, {
      method: "POST",
      csrf: auth.csrfToken,
      body: { questionId: q.id, optionId: correctOptionId(q.id) },
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }

  const bal = getJiuCoinBalance(auth.user.id);
  assert.equal(bal, JIU_COIN_REGISTER_GRANT + 20);

  // Replay last answer — no second grant
  const last = d.questions[d.questions.length - 1];
  const replay = await api(`/api/v1/quiz/attempts/${attempt.attemptId}/answers`, {
    method: "POST",
    csrf: auth.csrfToken,
    body: { questionId: last.id, optionId: correctOptionId(last.id) },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.unchanged, true);
  assert.equal(getJiuCoinBalance(auth.user.id), bal);
  assert.equal(hasRewardClaim(auth.user.id, quizRewardKey(d.setDate)), true);

  // Resume attempt returns same id
  const again = await startAttempt(auth);
  assert.equal(again.attemptId, attempt.attemptId);
  assert.equal(again.resumed, true);
  assert.equal(again.status, "settled");
});

test("flag off → disabled (404)", async () => {
  const prev = config.quizRewardsEnabled;
  config.quizRewardsEnabled = false;
  try {
    const cfg = await api("/api/v1/config");
    assert.equal(cfg.json.data.features.quizRewards, false);
    const d = await api("/api/v1/quiz/daily");
    assert.equal(d.status, 404);
    assert.equal(d.json.error.code, "QUIZ_REWARDS_DISABLED");
    const auth = await register(`qoff${Date.now().toString(36)}`);
    const a = await api("/api/v1/quiz/daily/attempts", {
      method: "POST",
      csrf: auth.csrfToken,
      body: {},
    });
    assert.equal(a.status, 404);
    assert.equal(a.json.error.code, "QUIZ_REWARDS_DISABLED");
  } finally {
    config.quizRewardsEnabled = prev;
  }
});
