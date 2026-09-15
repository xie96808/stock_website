import { Router } from "express";
import { requireUser } from "../middleware/request.js";
import { ok, fail } from "../lib/http.js";
import { createFeedback } from "../lib/feedback.js";
import { readMultipartFeedback } from "../lib/feedbackImages.js";
import {
  clientIp,
  consumeRateLimit,
  rateLimitFail,
} from "../lib/rateLimit.js";
import { config } from "../lib/config.js";

const router = Router();

function checkFeedbackLimits(userId, ip) {
  const cfg = config.rateLimit;
  const uid = String(userId);
  const perUser = consumeRateLimit(
    `feedback:u:${uid}`,
    cfg.feedbackPerUserHour,
    cfg.feedbackHourMs
  );
  if (!perUser.ok) {
    return {
      limited: true,
      retryAfterSec: perUser.retryAfterSec,
      message: "反馈提交过于频繁，请稍后再试",
    };
  }
  const perIp = consumeRateLimit(
    `feedback:ip:${ip}`,
    cfg.feedbackPerIpHour,
    cfg.feedbackHourMs
  );
  if (!perIp.ok) {
    return {
      limited: true,
      retryAfterSec: perIp.retryAfterSec,
      message: "来自此网络的反馈过于频繁，请稍后再试",
    };
  }
  return { limited: false };
}

router.post("/feedback", requireUser, async (req, res) => {
  const ip = clientIp(req);
  const limit = checkFeedbackLimits(req.user.id, ip);
  if (limit.limited) {
    return rateLimitFail(res, limit.retryAfterSec, limit.message);
  }

  const ctype = String(req.headers["content-type"] || "");
  let bodyText;
  let imageBuffers = [];

  if (/multipart\/form-data/i.test(ctype)) {
    const parsed = await readMultipartFeedback(req);
    if (parsed.error) {
      return fail(res, parsed.error.status, parsed.error.code, parsed.error.message);
    }
    bodyText = parsed.body;
    imageBuffers = (parsed.images || []).map((img) => img.buffer);
  } else {
    bodyText = req.body?.body;
  }

  const result = createFeedback({
    userId: req.user.id,
    body: bodyText,
    imageBuffers,
    requestId: res.locals.requestId,
  });
  if (result.error) {
    return fail(res, result.error.status, result.error.code, result.error.message);
  }
  return ok(res, result.data, result.status);
});

export default router;
