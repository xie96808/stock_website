import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import {
  getDailyQuiz,
  createOrResumeAttempt,
  submitAnswer,
  getAttemptReview,
} from "../lib/quizRewards.js";
import { config } from "../lib/config.js";

const router = Router();

function mapErr(res, e) {
  const status = e.status || (e.code === "QUIZ_REWARDS_DISABLED" ? 404 : 500);
  const code = e.code || "INTERNAL";
  const message = e.message || "服务器错误";
  if (status >= 500 && code === "INTERNAL") console.error(e);
  return fail(res, status, code, message, e.details);
}

function requireQuizFlag(req, res, next) {
  if (!config.quizRewardsEnabled) {
    return fail(res, 404, "QUIZ_REWARDS_DISABLED", "每日知识挑战暂未开放");
  }
  return next();
}

router.use("/quiz", requireQuizFlag);

/** Public (auth optional): today's stems/options + progress; no unpublished answers. */
router.get("/quiz/daily", (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    return ok(res, getDailyQuiz(userId));
  } catch (e) {
    return mapErr(res, e);
  }
});

/** Auth: create or resume today's attempt. */
router.post("/quiz/daily/attempts", requireUser, (req, res) => {
  try {
    const data = createOrResumeAttempt(req.user.id);
    return ok(res, data, data.resumed ? 200 : 201);
  } catch (e) {
    return mapErr(res, e);
  }
});

/** Auth: lock first answer; last question settles + grants. */
router.post("/quiz/attempts/:id/answers", requireUser, (req, res) => {
  try {
    const data = submitAnswer(req.user.id, req.params.id, {
      questionId: req.body?.questionId,
      optionId: req.body?.optionId,
    });
    return ok(res, data);
  } catch (e) {
    return mapErr(res, e);
  }
});

/** Auth: review after settle. */
router.get("/quiz/attempts/:id", requireUser, (req, res) => {
  try {
    return ok(res, getAttemptReview(req.user.id, req.params.id));
  } catch (e) {
    return mapErr(res, e);
  }
});

export default router;
