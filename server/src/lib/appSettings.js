/**
 * app_settings: admin-editable overrides for env feature switches and PvP params.
 * Absent row => env/config value (see OVERRIDABLE_KEYS in config.js).
 */
import { openDb } from "../db/connection.js";
import {
  OVERRIDABLE_KEYS,
  configBaseValue,
  hasSettingOverride,
  setSettingOverride,
  clearSettingOverrides,
  config,
} from "./config.js";
import { writeAuditLog } from "./audit.js";

const bool = (label, group, note = "") => ({ type: "bool", label, group, note });
const int = (label, group, min, max, note = "") => ({ type: "int", label, group, min, max, note });

export const SETTINGS_REGISTRY = {
  registrationEnabled: bool("开放注册", "site"),
  cloudGamesEnabled: bool("云端新开局", "site", "关闭后已开局仍可完成"),
  leaderboardEnabled: bool("排行榜", "site"),
  quizRewardsEnabled: bool("每日答题奖励", "feature"),
  dailyChallengeEnabled: bool("每日同题挑战", "feature"),
  gameRewindEnabled: bool("经典单次悔棋 + 辅助榜", "feature", "需同时开启事件协议（环境变量）"),
  puzzleChapterEnabled: bool("残局章节", "feature"),
  puzzleWeeklyEnabled: bool("残局同题周榜", "feature", "需先开启残局章节"),
  oneshotModeEnabled: bool("一把梭", "feature"),
  survivalModeEnabled: bool("爆仓生存", "feature"),
  ghostDuelEnabled: bool("幽灵对局", "feature"),
  pvpBattleEnabled: bool("实时对战", "pvp", "关闭后拒绝新对局；进行中对局不受影响"),
  pvpBotsEnabled: bool("对战陪练机器人", "pvp", "需开启实时对战"),
  pvpMaxActiveMatches: int("同时进行对局上限", "pvp", 1, 500),
  pvpEntryCost: int("入场韭币", "pvp", 1, 100000, "仅影响之后新开对局"),
  pvpWinReward: int("胜者奖励韭币", "pvp", 1, 100000, "仅影响之后新开对局"),
  pvpDailyRewardCap: int("每日奖励上限（记录于对局快照）", "pvp", 1, 1000),
  pvpPairLimit24h: int("同一对手 24h 局数（记录于对局快照）", "pvp", 1, 100),
  pvpDaySeconds: int("每根 K 线秒数", "pvp", 5, 600, "仅影响之后新开对局"),
  pvpMaxBotMatches: int("机器人同时对局上限", "pvp", 1, 50),
  pvpHumanRoomReserve: int("为真人预留房间数", "pvp", 0, 50),
  pvpBotTier: { type: "enum", label: "机器人难度", group: "pvp", options: ["easy", "normal"], note: "" },
};

for (const k of OVERRIDABLE_KEYS) {
  if (!SETTINGS_REGISTRY[k]) throw new Error(`registry missing ${k}`);
}

export function validateSettingValue(key, value) {
  const spec = SETTINGS_REGISTRY[key];
  if (!spec) return { ok: false, code: "UNKNOWN_SETTING", message: "未知设置项" };
  if (spec.type === "bool") {
    if (typeof value !== "boolean") return { ok: false, code: "BAD_VALUE", message: "需要 true/false" };
  } else if (spec.type === "int") {
    if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
      return { ok: false, code: "BAD_VALUE", message: `需要 ${spec.min}–${spec.max} 的整数` };
    }
  } else if (spec.type === "enum") {
    if (!spec.options.includes(value)) return { ok: false, code: "BAD_VALUE", message: `可选：${spec.options.join(" / ")}` };
  }
  return { ok: true };
}

/** Load all rows into the in-memory overrides. Invalid/unknown rows are ignored (env applies). */
export function loadAppSettings(db = openDb()) {
  clearSettingOverrides();
  let rows = [];
  try {
    rows = db.prepare("SELECT key, value_json FROM app_settings").all();
  } catch {
    return 0; // table not migrated yet
  }
  let n = 0;
  for (const r of rows) {
    let v;
    try {
      v = JSON.parse(r.value_json);
    } catch {
      continue;
    }
    if (!validateSettingValue(r.key, v).ok) {
      console.warn(`app_settings: ignoring invalid ${r.key}`);
      continue;
    }
    setSettingOverride(r.key, v);
    n++;
  }
  return n;
}

export function listAppSettings(db = openDb()) {
  const rows = new Map(
    db.prepare("SELECT key, updated_by, updated_at FROM app_settings").all().map((r) => [r.key, r])
  );
  return OVERRIDABLE_KEYS.map((key) => {
    const spec = SETTINGS_REGISTRY[key];
    const row = rows.get(key);
    return {
      key,
      ...spec,
      value: config[key],
      envValue: configBaseValue(key),
      overridden: hasSettingOverride(key),
      updatedBy: row?.updated_by ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}

/**
 * Set (value) or clear (value === null) an override. Returns {ok, setting} or {ok:false,...}.
 */
export function updateAppSetting(db, { key, value, actorId, reason, requestId }) {
  if (!SETTINGS_REGISTRY[key]) return { ok: false, status: 404, code: "UNKNOWN_SETTING", message: "未知设置项" };
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 2 || r.length > 200) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "原因需 2–200 字" };
  const clearing = value === null;
  if (!clearing) {
    const v = validateSettingValue(key, value);
    if (!v.ok) return { ok: false, status: 400, ...v };
  }
  const before = { value: config[key], overridden: hasSettingOverride(key) };
  db.transaction(() => {
    if (clearing) db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    else {
      db.prepare(
        `INSERT INTO app_settings (key, value_json, updated_by, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(key, JSON.stringify(value), actorId ?? null);
    }
    writeAuditLog({
      actorId,
      action: clearing ? "settings.reset" : "settings.update",
      targetType: "setting",
      targetId: key,
      reason: r,
      before,
      after: { value: clearing ? configBaseValue(key) : value, overridden: !clearing },
      requestId,
    });
  })();
  setSettingOverride(key, clearing ? undefined : value);
  return { ok: true, setting: listAppSettings(db).find((s) => s.key === key) };
}
