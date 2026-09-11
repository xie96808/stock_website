/**
 * F11 — daily rewarded quiz (PRD §4.4).
 * Server-scored; first answers locked; settle + grantRewardClaim in one TX.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { shanghaiYmd } from "./jiuCoin.js";
import { grantRewardClaim, ECONOMY_VERSION } from "./rewardClaims.js";
import { getJiuCoinBalance } from "./jiuCoin.js";
import { config } from "./config.js";

export const QUIZ_RULE_VERSION = "quiz-v1";
export const QUIZ_SET_VERSION = "quiz-set-v1";
export const QUIZ_QUESTIONS_PER_DAY = 5;
export const QUIZ_REWARD_COMPLETE = 10;
export const QUIZ_REWARD_BONUS = 10;
export const QUIZ_BONUS_MIN_CORRECT = 4;
export const QUIZ_LEDGER_REASON = "quiz_daily_reward";

export function quizRewardKey(setDate) {
  return `quiz:${setDate}`;
}

export function assertQuizRewardsEnabled() {
  if (!config.quizRewardsEnabled) {
    const err = new Error("每日知识挑战暂未开放");
    err.code = "QUIZ_REWARDS_DISABLED";
    err.status = 404;
    throw err;
  }
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function listActiveQuestionIds(db) {
  return db
    .prepare(`SELECT id FROM quiz_questions WHERE active = 1 ORDER BY id ASC`)
    .all()
    .map((r) => r.id);
}

/** Deterministic pick of N question ids for a Shanghai date (same for all users). */
export function pickQuestionIdsForDate(setDate, allIds, n = QUIZ_QUESTIONS_PER_DAY) {
  if (!allIds || allIds.length < n) return [];
  const ids = [...allIds];
  // Fisher–Yates with date-seeded hash stream — stable across processes.
  let seed = crypto.createHash("sha256").update(`quiz-daily:${setDate}:${QUIZ_SET_VERSION}`).digest();
  for (let i = ids.length - 1; i > 0; i--) {
    seed = crypto.createHash("sha256").update(seed).digest();
    const rnd = seed.readUInt32BE(0) / 0x100000000;
    const j = Math.floor(rnd * (i + 1));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  return ids.slice(0, n); // order = deterministic shuffle (same for all users)
}

export function ensureDailySet(setDate = shanghaiYmd(), db = openDb()) {
  const existing = db.prepare(`SELECT * FROM quiz_daily_sets WHERE set_date = ?`).get(setDate);
  if (existing) return rowToSet(existing);

  const allIds = listActiveQuestionIds(db);
  const picked = pickQuestionIdsForDate(setDate, allIds);
  if (picked.length < QUIZ_QUESTIONS_PER_DAY) {
    return null; // empty state: bank not ready
  }

  try {
    db.prepare(
      `INSERT INTO quiz_daily_sets (
        set_date, version, question_ids_json, reward_complete, reward_bonus, bonus_min_correct
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      setDate,
      QUIZ_SET_VERSION,
      JSON.stringify(picked),
      QUIZ_REWARD_COMPLETE,
      QUIZ_REWARD_BONUS,
      QUIZ_BONUS_MIN_CORRECT
    );
  } catch (e) {
    if (!String(e?.message || "").includes("UNIQUE")) throw e;
  }
  const row = db.prepare(`SELECT * FROM quiz_daily_sets WHERE set_date = ?`).get(setDate);
  return rowToSet(row);
}

function rowToSet(row) {
  if (!row) return null;
  return {
    setDate: row.set_date,
    version: row.version,
    questionIds: parseJson(row.question_ids_json, []),
    rewardComplete: Number(row.reward_complete),
    rewardBonus: Number(row.reward_bonus),
    bonusMinCorrect: Number(row.bonus_min_correct),
  };
}

function loadQuestions(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, version, category, stem, options_json, correct_option_id, explanation
       FROM quiz_questions WHERE id IN (${placeholders})`
    )
    .all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function publicQuestion(row, { includeAnswer = false } = {}) {
  const options = parseJson(row.options_json, []);
  const q = {
    id: row.id,
    version: row.version,
    category: row.category,
    stem: row.stem,
    options: options.map((o) => ({ id: o.id, text: o.text })),
  };
  if (includeAnswer) {
    q.correctOptionId = row.correct_option_id;
    q.explanation = row.explanation;
  }
  return q;
}

function getAttemptForUserDate(userId, setDate, db) {
  if (!userId) return null;
  return db
    .prepare(`SELECT * FROM quiz_attempts WHERE user_id = ? AND set_date = ?`)
    .get(userId, setDate);
}

function listAnswers(attemptId, db) {
  return db
    .prepare(
      `SELECT question_id, option_id, is_correct, created_at
       FROM quiz_answers WHERE attempt_id = ? ORDER BY id ASC`
    )
    .all(attemptId);
}

function computeRewardAmount(firstCorrect, set) {
  let amount = set.rewardComplete;
  if (firstCorrect >= set.bonusMinCorrect) amount += set.rewardBonus;
  return amount;
}

/**
 * GET /quiz/daily payload. Never leaks unpublished correct answers.
 */
export function getDailyQuiz(userId = null, db = openDb()) {
  assertQuizRewardsEnabled();
  const setDate = shanghaiYmd();
  const set = ensureDailySet(setDate, db);
  if (!set) {
    return {
      enabled: true,
      ready: false,
      setDate,
      message: "今日题组准备中",
      questionsPerDay: QUIZ_QUESTIONS_PER_DAY,
      maxReward: QUIZ_REWARD_COMPLETE + QUIZ_REWARD_BONUS,
    };
  }

  const attemptRow = getAttemptForUserDate(userId, setDate, db);
  const settled = attemptRow?.status === "settled";
  const qRows = loadQuestions(db, set.questionIds);
  const answers = attemptRow ? listAnswers(attemptRow.id, db) : [];
  const answeredMap = new Map(answers.map((a) => [a.question_id, a]));

  const questions = qRows.map((row) => {
    const pub = publicQuestion(row, { includeAnswer: settled });
    const ans = answeredMap.get(row.id);
    if (ans) {
      pub.yourOptionId = ans.option_id;
      if (settled) pub.yourCorrect = !!ans.is_correct;
    }
    return pub;
  });

  const answeredCount = answers.length;
  let status = "not_started";
  if (attemptRow?.status === "settled") status = "settled";
  else if (attemptRow) status = "in_progress";

  const payload = {
    enabled: true,
    ready: true,
    setDate: set.setDate,
    setVersion: set.version,
    questionsPerDay: set.questionIds.length,
    rewardComplete: set.rewardComplete,
    rewardBonus: set.rewardBonus,
    bonusMinCorrect: set.bonusMinCorrect,
    maxReward: set.rewardComplete + set.rewardBonus,
    status,
    answeredCount,
    attemptId: attemptRow?.id ?? null,
    questions,
  };

  if (settled) {
    payload.firstCorrectCount = attemptRow.first_correct_count;
    payload.rewardAmount = attemptRow.reward_amount;
    payload.settledAt = attemptRow.settled_at;
  }
  return payload;
}

export function createOrResumeAttempt(userId, db = openDb()) {
  assertQuizRewardsEnabled();
  const setDate = shanghaiYmd();
  const set = ensureDailySet(setDate, db);
  if (!set) {
    const err = new Error("今日题组准备中");
    err.code = "QUIZ_SET_NOT_READY";
    err.status = 503;
    throw err;
  }

  const existing = getAttemptForUserDate(userId, setDate, db);
  if (existing) {
    return {
      attemptId: existing.id,
      setDate,
      setVersion: existing.set_version,
      status: existing.status,
      resumed: true,
      firstCorrectCount: existing.first_correct_count,
      rewardAmount: existing.reward_amount,
    };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO quiz_attempts (id, user_id, set_date, set_version, status)
     VALUES (?, ?, ?, ?, 'in_progress')`
  ).run(id, userId, setDate, set.version);

  return {
    attemptId: id,
    setDate,
    setVersion: set.version,
    status: "in_progress",
    resumed: false,
  };
}

function getAttemptOwned(userId, attemptId, db) {
  const row = db.prepare(`SELECT * FROM quiz_attempts WHERE id = ?`).get(attemptId);
  if (!row || row.user_id !== userId) {
    const err = new Error("尝试不存在");
    err.code = "ATTEMPT_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  return row;
}

/**
 * Lock first answer; on last question settle + grant in one TX.
 * Retries after settle do not re-pay / do not change first score.
 */
export function submitAnswer(userId, attemptId, { questionId, optionId }, db = openDb()) {
  assertQuizRewardsEnabled();
  if (typeof questionId !== "string" || !questionId.trim()) {
    const err = new Error("questionId 无效");
    err.code = "INVALID_QUESTION";
    err.status = 422;
    throw err;
  }
  if (typeof optionId !== "string" || !optionId.trim()) {
    const err = new Error("optionId 无效");
    err.code = "INVALID_OPTION";
    err.status = 422;
    throw err;
  }
  questionId = questionId.trim();
  optionId = optionId.trim();

  const run = db.transaction(() => {
    const attempt = getAttemptOwned(userId, attemptId, db);
    const set = ensureDailySet(attempt.set_date, db);
    if (!set || !set.questionIds.includes(questionId)) {
      const err = new Error("题目不属于今日题组");
      err.code = "QUESTION_NOT_IN_SET";
      err.status = 422;
      throw err;
    }

    const qRow = db.prepare(`SELECT * FROM quiz_questions WHERE id = ? AND active = 1`).get(questionId);
    if (!qRow) {
      const err = new Error("题目不存在");
      err.code = "QUESTION_NOT_FOUND";
      err.status = 404;
      throw err;
    }
    const options = parseJson(qRow.options_json, []);
    if (!options.some((o) => o.id === optionId)) {
      const err = new Error("选项无效");
      err.code = "INVALID_OPTION";
      err.status = 422;
      throw err;
    }

    const existingAns = db
      .prepare(`SELECT question_id, option_id, is_correct FROM quiz_answers WHERE attempt_id = ? AND question_id = ?`)
      .get(attemptId, questionId);

    if (existingAns) {
      // First answer locked — ignore overwrite; return current progress.
      const answers = listAnswers(attemptId, db);
      const settled = attempt.status === "settled";
      return {
        locked: true,
        unchanged: true,
        questionId,
        optionId: existingAns.option_id,
        answeredCount: answers.length,
        total: set.questionIds.length,
        status: attempt.status,
        settled: settled
          ? {
              firstCorrectCount: attempt.first_correct_count,
              rewardAmount: attempt.reward_amount,
              balance: getJiuCoinBalance(userId, db),
            }
          : null,
      };
    }

    if (attempt.status === "settled") {
      const err = new Error("今日题组已结算，首次答案不可更改");
      err.code = "ATTEMPT_SETTLED";
      err.status = 409;
      throw err;
    }

    const isCorrect = optionId === qRow.correct_option_id ? 1 : 0;
    db.prepare(
      `INSERT INTO quiz_answers (attempt_id, question_id, option_id, is_correct)
       VALUES (?, ?, ?, ?)`
    ).run(attemptId, questionId, optionId, isCorrect);
    db.prepare(
      `UPDATE quiz_attempts SET updated_at = datetime('now') WHERE id = ?`
    ).run(attemptId);

    const answers = listAnswers(attemptId, db);
    const answeredCount = answers.length;
    const total = set.questionIds.length;

    if (answeredCount < total) {
      return {
        locked: true,
        unchanged: false,
        questionId,
        optionId,
        answeredCount,
        total,
        status: "in_progress",
        settled: null,
      };
    }

    // Settle + grant in this same TX.
    const firstCorrect = answers.reduce((n, a) => n + (a.is_correct ? 1 : 0), 0);
    const rewardAmount = computeRewardAmount(firstCorrect, set);
    const rewardKey = quizRewardKey(attempt.set_date);

    const grant = grantRewardClaim(db, {
      userId,
      rewardKey,
      amount: rewardAmount,
      reason: QUIZ_LEDGER_REASON,
      economyVersion: ECONOMY_VERSION,
      ruleVersion: QUIZ_RULE_VERSION,
      refType: "quiz_attempt",
      refId: attemptId,
      meta: {
        setDate: attempt.set_date,
        setVersion: attempt.set_version,
        firstCorrectCount: firstCorrect,
        rewardComplete: set.rewardComplete,
        rewardBonus: firstCorrect >= set.bonusMinCorrect ? set.rewardBonus : 0,
      },
    });

    db.prepare(
      `UPDATE quiz_attempts
       SET status = 'settled',
           first_correct_count = ?,
           reward_amount = ?,
           settled_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(firstCorrect, rewardAmount, attemptId);

    return {
      locked: true,
      unchanged: false,
      questionId,
      optionId,
      answeredCount,
      total,
      status: "settled",
      settled: {
        firstCorrectCount: firstCorrect,
        rewardAmount,
        rewardUnchanged: grant.unchanged,
        completeReward: set.rewardComplete,
        bonusReward: firstCorrect >= set.bonusMinCorrect ? set.rewardBonus : 0,
        balance: grant.balance,
      },
    };
  });

  return run();
}

export function getAttemptReview(userId, attemptId, db = openDb()) {
  assertQuizRewardsEnabled();
  const attempt = getAttemptOwned(userId, attemptId, db);
  if (attempt.status !== "settled") {
    const err = new Error("题组尚未结算，解析暂不可用");
    err.code = "ATTEMPT_NOT_SETTLED";
    err.status = 409;
    throw err;
  }
  const set = ensureDailySet(attempt.set_date, db);
  const qRows = loadQuestions(db, set.questionIds);
  const answers = listAnswers(attemptId, db);
  const answeredMap = new Map(answers.map((a) => [a.question_id, a]));
  return {
    attemptId: attempt.id,
    setDate: attempt.set_date,
    status: attempt.status,
    firstCorrectCount: attempt.first_correct_count,
    rewardAmount: attempt.reward_amount,
    settledAt: attempt.settled_at,
    questions: qRows.map((row) => {
      const pub = publicQuestion(row, { includeAnswer: true });
      const ans = answeredMap.get(row.id);
      if (ans) {
        pub.yourOptionId = ans.option_id;
        pub.yourCorrect = !!ans.is_correct;
      }
      return pub;
    }),
  };
}
