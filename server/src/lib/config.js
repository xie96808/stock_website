import crypto from "node:crypto";

const isProd = process.env.NODE_ENV === "production";

function requireSecret(name, fallbackDev) {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (isProd) throw new Error(`${name} required in production`);
  return fallbackDev;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envDaysMs(name, fallbackDays) {
  const days = envInt(name, fallbackDays);
  return days * 24 * 60 * 60 * 1000;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  isProd,
  cookieName: process.env.SESSION_COOKIE_NAME || (isProd ? "__Host-stockgame_session" : "stockgame_session"),
  cookieSecure: process.env.COOKIE_SECURE === "1" || isProd,
  csrfSecret: requireSecret("CSRF_SECRET", "dev-csrf-secret-change-me-32b"),
  originAllowlist: (process.env.ORIGIN_ALLOWLIST || "http://127.0.0.1:8787,http://localhost:8787")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Sliding idle window (default 7d). Idle refresh cannot pass absolute max. */
  sessionIdleMs: envDaysMs("SESSION_IDLE_DAYS", 7),
  /**
   * Absolute max lifetime from session created_at (default 7d Phase 0).
   * Cookie maxAge aligns with this. Override with SESSION_ABSOLUTE_DAYS.
   */
  sessionAbsoluteMs: envDaysMs("SESSION_ABSOLUTE_DAYS", 7),
  staticRoot: process.env.STATIC_ROOT || "",
  skipStatic: process.env.SKIP_STATIC === "1" || process.env.SKIP_STATIC === "true",
  /** Stage 5: admin API off by default; set ADMIN_ENABLED=1 on VPS behind IP/VPN */
  adminEnabled: process.env.ADMIN_ENABLED === "1" || process.env.ADMIN_ENABLED === "true",
  /** Optional comma-separated client IPs allowed to hit /api/v1/admin/* (empty = no IP filter) */
  adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Secret path segment for static admin shell; default "admin" */
  adminUiPath: (process.env.ADMIN_UI_PATH || "admin").replace(/^\/+|\/+$/g, "") || "admin",
  /**
   * Stage 6 ops switches (env only; default ON).
   * Set to 0/false to disable. Closing new cloud games does not block finish of existing games.
   */
  registrationEnabled: process.env.REGISTRATION_ENABLED !== "0" && process.env.REGISTRATION_ENABLED !== "false",
  cloudGamesEnabled: process.env.CLOUD_GAMES_ENABLED !== "0" && process.env.CLOUD_GAMES_ENABLED !== "false",
  leaderboardEnabled: process.env.LEADERBOARD_ENABLED !== "0" && process.env.LEADERBOARD_ENABLED !== "false",
  /**
   * B0 event-v1 protocol (stepwise decisions). Default OFF.
   * When false, create/finish behave exactly as legacy batch.
   * Set EVENT_PROTOCOL_ENABLED=1 to issue event-v1 on create and enable decisions.
   */
  protocolEventV1Enabled:
    process.env.EVENT_PROTOCOL_ENABLED === "1" || process.env.EVENT_PROTOCOL_ENABLED === "true",
  /**
   * F11 daily quiz rewards. Default OFF.
   * When false, rewarded quiz API returns 404 and client hides the card.
   * Free academy training is unchanged either way.
   * Set QUIZ_REWARDS_ENABLED=1 to enable.
   */
  quizRewardsEnabled:
    process.env.QUIZ_REWARDS_ENABLED === "1" || process.env.QUIZ_REWARDS_ENABLED === "true",
  /**
   * F01 daily same-question challenge. Default OFF.
   * When false, daily-challenge API returns 404 and hub card stays hidden.
   * Classic create/resume/leaderboard unchanged.
   * Set DAILY_CHALLENGE_ENABLED=1 to enable.
   */
  dailyChallengeEnabled:
    process.env.DAILY_CHALLENGE_ENABLED === "1" || process.env.DAILY_CHALLENGE_ENABLED === "true",
  /**
   * F03 classic once-per-game rewind + assist boards. Default OFF.
   * When false: rewind API/UI off; classic leaderboard unchanged (no assist filter).
   * Rewind only applies to sessions already issued as event-v1 (EVENT_PROTOCOL_ENABLED).
   * Set GAME_REWIND_ENABLED=1 to enable. QA needs both flags for the full path.
   */
  gameRewindEnabled:
    process.env.GAME_REWIND_ENABLED === "1" || process.env.GAME_REWIND_ENABLED === "true",
  /**
   * F02 puzzle chapter-1. Default OFF.
   * When false, /puzzles* returns 404 and hub card stays hidden.
   * Set PUZZLE_CHAPTER_ENABLED=1 to enable.
   */
  puzzleChapterEnabled:
    process.env.PUZZLE_CHAPTER_ENABLED === "1" || process.env.PUZZLE_CHAPTER_ENABLED === "true",
  /**
   * Puzzle same-level weekly board (同题周榜). Default OFF.
   * When false, /puzzles/weekly* returns 404. Enable with PUZZLE_WEEKLY_ENABLED=1
   * after puzzle chapter is live (safe deploy: leave off until day-29 cutover).
   */
  puzzleWeeklyEnabled:
    process.env.PUZZLE_WEEKLY_ENABLED === "1" || process.env.PUZZLE_WEEKLY_ENABLED === "true",
  /**
   * Phase A 一把梭. Default OFF.
   * When false, POST /games with gameKind=oneshot returns FEATURE_DISABLED
   * and the L3 card stays hidden.
   * Set ONESHOT_MODE_ENABLED=1 to enable. Prod can turn this on after deploy.
   */
  oneshotModeEnabled:
    process.env.ONESHOT_MODE_ENABLED === "1" || process.env.ONESHOT_MODE_ENABLED === "true",
  /**
   * Phase B 爆仓生存. Default OFF.
   * When false, POST /games with gameKind=survival returns FEATURE_DISABLED
   * and the L3 card stays hidden.
   * Set SURVIVAL_MODE_ENABLED=1 to enable after Phase B deploy.
   */
  survivalModeEnabled:
    process.env.SURVIVAL_MODE_ENABLED === "1" || process.env.SURVIVAL_MODE_ENABLED === "true",
  /**
   * Phase C 幽灵对局. Default OFF.
   * When false, /daily-challenge/ghost* returns FEATURE_DISABLED and entry stays hidden.
   * Set GHOST_DUEL_ENABLED=1 to enable after Phase C deploy.
   */
  ghostDuelEnabled:
    process.env.GHOST_DUEL_ENABLED === "1" || process.env.GHOST_DUEL_ENABLED === "true",
  /**
   * Phase 0 in-memory rate limits (single-process). Env knobs documented in deploy docs.
   */
  rateLimit: {
    loginFailPerAccountIp: envInt("RATE_LOGIN_FAIL_PER_ACCOUNT_IP", 5),
    loginFailPerIp: envInt("RATE_LOGIN_FAIL_PER_IP", 30),
    loginFailWindowMs: envInt("RATE_LOGIN_FAIL_WINDOW_MS", 15 * 60 * 1000),
    registerPerIpHour: envInt("RATE_REGISTER_PER_IP_HOUR", 5),
    registerPerIpDay: envInt("RATE_REGISTER_PER_IP_DAY", 20),
    registerHourMs: envInt("RATE_REGISTER_HOUR_MS", 60 * 60 * 1000),
    registerDayMs: envInt("RATE_REGISTER_DAY_MS", 24 * 60 * 60 * 1000),
    createGamePerUserMinute: envInt("RATE_CREATE_GAME_PER_USER_MINUTE", 10),
    createGamePerUserDay: envInt("RATE_CREATE_GAME_PER_USER_DAY", 100),
    createGameMinuteMs: envInt("RATE_CREATE_GAME_MINUTE_MS", 60 * 1000),
    createGameDayMs: envInt("RATE_CREATE_GAME_DAY_MS", 24 * 60 * 60 * 1000),
    /** User feedback: per user / IP per hour (support channel, default on). */
    feedbackPerUserHour: envInt("RATE_FEEDBACK_PER_USER_HOUR", 5),
    feedbackPerIpHour: envInt("RATE_FEEDBACK_PER_IP_HOUR", 20),
    feedbackHourMs: envInt("RATE_FEEDBACK_HOUR_MS", 60 * 60 * 1000),
  },
};

export function newRequestId() {
  return crypto.randomUUID();
}
