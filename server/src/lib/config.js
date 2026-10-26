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
   * A 50-coin rewind marks the game assist_class='undo'. A 后悔券 rewind (payWith:'ticket') keeps the game's
   * assist_class (normal board) unless rewindTicketBoard='undo'; it is recorded as game_sessions.rewind_via='ticket'.
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
   * 幸运转盘 (lucky wheel) replaces 每日领取. Default OFF.
   * OFF: legacy POST /me/jiu-coin/daily behaves exactly as before, wheel endpoints are FEATURE_DISABLED.
   * ON: POST /me/jiu-coin/daily returns 410 DAILY_REPLACED_BY_WHEEL (no double dip from stale tabs).
   * Set LUCKY_WHEEL_ENABLED=1, or flip it in the admin 功能开关.
   */
  luckyWheelEnabled:
    process.env.LUCKY_WHEEL_ENABLED === "1" || process.env.LUCKY_WHEEL_ENABLED === "true",
  /**
   * 连续登录奖励 (7-day cycle, claimed by hand). Default OFF like other new features.
   * OFF: GET /me/streak reports enabled:false, POST /me/streak/claim is FEATURE_DISABLED, client hides the card.
   * Set LOGIN_STREAK_ENABLED=1, or flip it in the admin 功能开关.
   */
  loginStreakEnabled:
    process.env.LOGIN_STREAK_ENABLED === "1" || process.env.LOGIN_STREAK_ENABLED === "true",
  /**
   * 邀请奖励 (invite code → both sides get 韭币 after the invitee's first settled game). Default OFF.
   * OFF: register ignores inviteCode, GET /me/invite reports enabled:false, client hides the entry.
   * Set INVITE_REWARDS_ENABLED=1, or flip it in the admin 功能开关.
   */
  inviteRewardsEnabled:
    process.env.INVITE_REWARDS_ENABLED === "1" || process.env.INVITE_REWARDS_ENABLED === "true",
  /**
   * 成就 (progress derived from live data, claimed by hand for 韭币 / unlocks). Default OFF.
   * OFF: GET /me/achievements reports enabled:false, claims are FEATURE_DISABLED, client hides the entry.
   * Set ACHIEVEMENTS_ENABLED=1, or flip it in the admin 功能开关.
   */
  achievementsEnabled:
    process.env.ACHIEVEMENTS_ENABLED === "1" || process.env.ACHIEVEMENTS_ENABLED === "true",
  /** Free wheel spins per Asia/Shanghai day (admin-editable 1–5). */
  luckyWheelDailyFree: Math.min(5, envInt("LUCKY_WHEEL_DAILY_FREE", 1)),
  /**
   * 后悔券 (Track R). Which board a NEW ticket rewind lands on: 'clean' (default, Bill Rev 4: the game stays a
   * normal game; recorded internally as game_sessions.rewind_via='ticket') or 'undo' (same as a 50-coin rewind).
   * Existing games move only through the admin reclassify action.
   */
  rewindTicketBoard: process.env.REWIND_TICKET_BOARD === "undo" ? "undo" : "clean",
  /** Max 后悔券 a user can win from the wheel per Asia/Shanghai day (excess paid as coins, substituted). */
  rewindTicketDailyCap: Math.min(20, Math.max(0, envInt("REWIND_TICKET_DAILY_CAP", 4))),
  /** Max 后悔券 a user may hold before wheel prizes are paid as coins instead. Admin grants ignore it. */
  rewindTicketHoldCap: Math.min(999, Math.max(1, envInt("REWIND_TICKET_HOLD_CAP", 30))),
  /**
   * Realtime PvP. Default ON. Set PVP_BATTLE_ENABLED=0 to hide the entry and
   * refuse new matches. Recovery of stored matches does not consult this flag.
   */
  pvpBattleEnabled: (() => {
    const raw = process.env.PVP_BATTLE_ENABLED;
    if (raw == null || raw === "") return true;
    return raw === "1" || raw === "true";
  })(),
  pvpMaxActiveMatches: envInt("PVP_MAX_ACTIVE_MATCHES", 20),
  pvpEntryCost: envInt("PVP_ENTRY_COST", 20),
  pvpWinReward: envInt("PVP_WIN_REWARD", 35),
  // Kept on the match snapshot. They no longer refuse another battle.
  pvpDailyRewardCap: envInt("PVP_DAILY_REWARD_CAP", 10),
  pvpPairLimit24h: envInt("PVP_PAIR_LIMIT_24H", 3),
  pvpDaySeconds: envInt("PVP_DAY_SECONDS", 30),
  pvpMaxWs: envInt("PVP_MAX_WS", 200),
  /**
   * PvP companion bots in the lobby. Default OFF.
   * Requires PVP_BATTLE_ENABLED. Set PVP_BOTS_ENABLED=1 to show seeded bots.
   */
  pvpBotsEnabled:
    process.env.PVP_BOTS_ENABLED === "1" || process.env.PVP_BOTS_ENABLED === "true",
  /** Concurrent bot matches soft cap (humans preferred near room limit). */
  pvpMaxBotMatches: envInt("PVP_MAX_BOT_MATCHES", 3),
  /** Refuse new bot matches when active rooms >= maxActive - reserve. */
  pvpHumanRoomReserve: envInt("PVP_HUMAN_ROOM_RESERVE", 2),
  /** Default bot policy tier. */
  pvpBotTier: (process.env.PVP_BOT_TIER || "normal").trim() || "normal",
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
    /** Lucky wheel spin attempts (POST): per user / IP per minute. DB constraints are the real guard. */
    wheelSpinPerUserMinute: envInt("RATE_WHEEL_SPIN_PER_USER_MINUTE", 6),
    wheelSpinPerIpMinute: envInt("RATE_WHEEL_SPIN_PER_IP_MINUTE", 30),
    wheelSpinMinuteMs: envInt("RATE_WHEEL_SPIN_MINUTE_MS", 60 * 1000),
    /** User feedback: per user / IP per hour (support channel, default on). */
    feedbackPerUserHour: envInt("RATE_FEEDBACK_PER_USER_HOUR", 5),
    feedbackPerIpHour: envInt("RATE_FEEDBACK_PER_IP_HOUR", 20),
    feedbackHourMs: envInt("RATE_FEEDBACK_HOUR_MS", 60 * 60 * 1000),
  },
};

export function newRequestId() {
  return crypto.randomUUID();
}

/**
 * Runtime overrides (admin 「功能开关」, table app_settings). Each overridable key
 * becomes an accessor: reads return the override when one is set, otherwise the
 * env/config base value. Assigning (tests, scripts) changes the base value as before.
 */
const settingOverrides = new Map();
export const OVERRIDABLE_KEYS = [
  "registrationEnabled",
  "cloudGamesEnabled",
  "leaderboardEnabled",
  "quizRewardsEnabled",
  "dailyChallengeEnabled",
  "gameRewindEnabled",
  "puzzleChapterEnabled",
  "puzzleWeeklyEnabled",
  "oneshotModeEnabled",
  "survivalModeEnabled",
  "ghostDuelEnabled",
  "luckyWheelEnabled",
  "loginStreakEnabled",
  "inviteRewardsEnabled",
  "achievementsEnabled",
  "luckyWheelDailyFree",
  "rewindTicketBoard",
  "rewindTicketDailyCap",
  "rewindTicketHoldCap",
  "pvpBattleEnabled",
  "pvpBotsEnabled",
  "pvpMaxActiveMatches",
  "pvpEntryCost",
  "pvpWinReward",
  "pvpDailyRewardCap",
  "pvpPairLimit24h",
  "pvpDaySeconds",
  "pvpMaxBotMatches",
  "pvpHumanRoomReserve",
  "pvpBotTier",
];
const baseValues = {};
for (const key of OVERRIDABLE_KEYS) {
  baseValues[key] = config[key];
  Object.defineProperty(config, key, {
    enumerable: true,
    configurable: false,
    get() {
      return settingOverrides.has(key) ? settingOverrides.get(key) : baseValues[key];
    },
    set(v) {
      baseValues[key] = v;
    },
  });
}

/** Env/config value, ignoring any admin override. */
export function configBaseValue(key) {
  return baseValues[key];
}

export function hasSettingOverride(key) {
  return settingOverrides.has(key);
}

/** Replace all overrides (boot load) or patch one key (value === undefined clears). */
export function setSettingOverride(key, value) {
  if (!OVERRIDABLE_KEYS.includes(key)) throw new Error(`not overridable: ${key}`);
  if (value === undefined) settingOverrides.delete(key);
  else settingOverrides.set(key, value);
}

export function clearSettingOverrides() {
  settingOverrides.clear();
}
