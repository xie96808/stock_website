/**
 * 幸运转盘 (lucky wheel). Server-authoritative: the result is drawn with crypto RNG, paid and persisted
 * in ONE immediate transaction, then the client only animates to the returned sector.
 *
 * Design: /workspace/lucky-wheel/DESIGN.md (Rev 2). Batch 0: coin prizes live; 'spin again' live;
 * item prizes (后悔券, Track R) plug in through registerItemGranter() with no further wheel migration.
 */
import crypto from "node:crypto";
import { openDb } from "../db/connection.js";
import { config } from "./config.js";
import { challengeNow } from "./dailyChallenge.js";
import { shanghaiYmd, getJiuCoinBalance } from "./jiuCoin.js";
import { grantRewardClaim } from "./rewardClaims.js";
import { writeAuditLog } from "./audit.js";
import { ITEM_TYPES } from "./userItems.js";

export const WHEEL_SECTORS = 8;
export const WEIGHT_TOTAL = 10000;
export const EV_MIN = 60;
export const EV_MAX = 250;
export const EV_WARN = 150;
export const LEGACY_DAILY_EV = 125;
export const COIN_MIN = 1;
export const COIN_MAX = 5000;
export const ITEM_QTY_MAX = 9;
export const SPIN_WEIGHT_MAX = 3000;
export const MAX_SPINS_PER_DAY = 5;
export const SPIN_CAP_SUBSTITUTE_COINS = 60;
export const DEFAULT_TICKET_COIN_VALUE = 50;
export const TICKET_REALISTIC_RATE = 0.7;
export const WHEEL_REASON = "lucky_wheel";
export const ADMIN_GRANT_MAX = 50;

export { ITEM_TYPES };

/** Table A — coin-only launch table. Keep identical to the seed row in migration 026 (test-enforced). */
export const TABLE_A = Object.freeze([
  { pos: 0, kind: "jiu_coin", amount: 90, weight: 1800 },
  { pos: 1, kind: "jiu_coin", amount: 300, weight: 700 },
  { pos: 2, kind: "jiu_coin", amount: 50, weight: 1400 },
  { pos: 3, kind: "jiu_coin", amount: 150, weight: 1400 },
  { pos: 4, kind: "jiu_coin", amount: 70, weight: 2000 },
  { pos: 5, kind: "jiu_coin", amount: 888, weight: 100, jackpot: true },
  { pos: 6, kind: "jiu_coin", amount: 110, weight: 1600 },
  { pos: 7, kind: "jiu_coin", amount: 200, weight: 1000 },
]);

/** Table B (coins + 后悔券 ×2/×3 + 再转一次). Not seeded; admin saves it once Track R is deployed. Used by tests/docs. */
export const TABLE_B = Object.freeze([
  { pos: 0, kind: "jiu_coin", amount: 90, weight: 2000 },
  { pos: 1, kind: "item", item: "rewind_ticket", qty: 2, weight: 1300 },
  { pos: 2, kind: "jiu_coin", amount: 60, weight: 1800 },
  { pos: 3, kind: "jiu_coin", amount: 250, weight: 1000 },
  { pos: 4, kind: "spin", qty: 1, weight: 1300 },
  { pos: 5, kind: "jiu_coin", amount: 150, weight: 2000 },
  { pos: 6, kind: "item", item: "rewind_ticket", qty: 3, weight: 500 },
  { pos: 7, kind: "jiu_coin", amount: 888, weight: 100, jackpot: true },
]);

/**
 * Table C (Bill, 2026-10-19): 58 · 后悔券×2 · 后悔券×3 · 再转一次 · 150 · 200 · 300 · 888 (1%).
 * Order alternates coin / non-coin around the rim; the jackpot keeps the gold position 5.
 *   pos: 0=58  1=券×2  2=150  3=再转一次  4=200  5=888★  6=券×3  7=300
 * NOT seeded: activate with an admin config save (「载入表 C」) or scripts/activate-wheel-table.mjs after Bill approves.
 * Option C1 (recommended) and C2 (fewer tickets) differ only in weights.
 */
function tableC(w) {
  return Object.freeze([
    { pos: 0, kind: "jiu_coin", amount: 58, weight: w[0] },
    { pos: 1, kind: "item", item: "rewind_ticket", qty: 2, weight: w[1] },
    { pos: 2, kind: "jiu_coin", amount: 150, weight: w[2] },
    { pos: 3, kind: "spin", qty: 1, weight: w[3] },
    { pos: 4, kind: "jiu_coin", amount: 200, weight: w[4] },
    { pos: 5, kind: "jiu_coin", amount: 888, weight: w[5], jackpot: true },
    { pos: 6, kind: "item", item: "rewind_ticket", qty: 3, weight: w[6] },
    { pos: 7, kind: "jiu_coin", amount: 300, weight: w[7] },
  ]);
}
export const TABLE_C1 = tableC([3600, 1500, 1600, 1000, 1000, 100, 500, 700]);
export const TABLE_C2 = tableC([3800, 1000, 2000, 800, 1300, 100, 300, 700]);
export const TABLE_C = TABLE_C1;
export const WHEEL_TABLES = Object.freeze({ A: TABLE_A, B: TABLE_B, C1: TABLE_C1, C2: TABLE_C2 });

/* ------------------------------------------------------------------ item plug-in (Track R) */

let itemGranter = null;
/**
 * Track R registers `(db, { userId, item, qty, spinId }) => { ledgerId, qtyAfter } | { overflow: true }`.
 * It runs inside the spin transaction. Absent => item sectors cannot be saved and are paid in coins.
 */
export function registerItemGranter(fn) {
  itemGranter = typeof fn === "function" ? fn : null;
}
export function itemsAvailable() {
  return typeof itemGranter === "function";
}

/** Coins paid when a 再转一次 lands at the daily draw cap: the table's smallest coin prize (Table C: 58). */
export function spinCapCoins(sectors) {
  const coins = (sectors || []).filter((s) => s.kind === "jiu_coin").map((s) => s.amount);
  return coins.length ? Math.min(...coins) : SPIN_CAP_SUBSTITUTE_COINS;
}

/** 后悔券 already won from the wheel on this Asia/Shanghai day (for rewindTicketDailyCap). */
export function ticketsWonOn(db, userId, ymd) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(prize_qty), 0) AS q FROM lucky_wheel_spins
       WHERE user_id = ? AND spin_date = ? AND prize_kind = 'item' AND prize_item = 'rewind_ticket'`
    )
    .get(userId, ymd).q;
}

/* ------------------------------------------------------------------ config math / validation */

export function coinTier(amount) {
  if (amount < 75) return 1;
  if (amount < 120) return 2;
  if (amount < 200) return 3;
  if (amount < 600) return 4;
  return 5;
}

export function prizeId(s) {
  if (s.kind === "jiu_coin") return `coin-${s.amount}`;
  if (s.kind === "item") return `${s.item}-x${s.qty}`;
  return "spin-again";
}

function sectorCoinValue(s, ticketCoinValue) {
  if (s.kind === "jiu_coin") return s.amount;
  if (s.kind === "item") return s.qty * ticketCoinValue;
  return 0;
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Expected value per Asia/Shanghai day (a 'spin again' sector is valued recursively:
 * EV = sum(non-spin p*v) / (1 - pSpin)). Tickets are valued at face (ticketCoinValue);
 * evRealistic values tickets at 70% (not every ticket is redeemed).
 */
export function computeEv(sectors, ticketCoinValue = DEFAULT_TICKET_COIN_VALUE) {
  let pSpin = 0;
  let s1 = 0;
  let s2 = 0;
  let s1r = 0;
  let pItem = 0;
  let pJackpot = 0;
  let pCoinOnly = 0;
  for (const s of sectors) {
    const p = s.weight / WEIGHT_TOTAL;
    if (s.jackpot) pJackpot += p;
    if (s.kind === "spin") {
      pSpin += p;
      continue;
    }
    const v = sectorCoinValue(s, ticketCoinValue);
    s1 += p * v;
    s2 += p * v * v;
    if (s.kind === "item") {
      s1r += p * v * TICKET_REALISTIC_RATE;
      pItem += p;
    } else {
      s1r += p * v;
      pCoinOnly += p * v;
    }
  }
  const denom = 1 - pSpin;
  const ev = s1 / denom;
  const sd = Math.sqrt(Math.max(0, s2 / denom - ev * ev));
  return {
    ev: r2(ev),
    evRealistic: r2(s1r / denom),
    evCoinsOnly: r2(pCoinOnly / denom),
    sd: r2(sd),
    perDraw: r2(s1),
    pSpin: r2(pSpin * 100) / 100,
    pItem: r2(pItem * 100) / 100,
    pJackpot: r2(pJackpot * 100) / 100,
    spinsPerDay: r2(1 / denom),
    vsLegacy: r2(ev - LEGACY_DAILY_EV),
  };
}

function bad(code, message) {
  return { ok: false, status: 400, code, message };
}

/**
 * Validate + normalise an admin prize table. Returns { ok, sectors, ticketCoinValue, ev, warnings } | { ok:false,... }.
 * Item sectors are refused unless Track R is deployed (itemsAvailable) and the 反悔 feature is on.
 */
export function validateWheelConfig(input, { rewindEnabled = config.gameRewindEnabled } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const list = body.sectors;
  if (!Array.isArray(list) || list.length !== WHEEL_SECTORS) {
    return bad("BAD_SECTORS", `必须正好 ${WHEEL_SECTORS} 个扇区`);
  }
  let ticketCoinValue = DEFAULT_TICKET_COIN_VALUE;
  if (body.ticketCoinValue !== undefined && body.ticketCoinValue !== null) {
    ticketCoinValue = body.ticketCoinValue;
    if (!Number.isInteger(ticketCoinValue) || ticketCoinValue < 1 || ticketCoinValue > 500) {
      return bad("BAD_TICKET_VALUE", "券的韭币折算值须为 1–500 的整数");
    }
  }
  const seen = new Set();
  const out = [];
  let weightSum = 0;
  let spinWeight = 0;
  let coinSectors = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return bad("BAD_SECTORS", "扇区格式无效");
    const { pos, kind, weight } = raw;
    if (!Number.isInteger(pos) || pos < 0 || pos >= WHEEL_SECTORS || seen.has(pos)) {
      return bad("BAD_POS", "扇区位置 pos 须为 0–7 且不重复");
    }
    seen.add(pos);
    if (!Number.isInteger(weight) || weight < 1 || weight > WEIGHT_TOTAL) {
      return bad("BAD_WEIGHT", "权重须为 1–10000 的整数");
    }
    weightSum += weight;
    const s = { pos, kind, weight };
    if (kind === "jiu_coin") {
      if (!Number.isInteger(raw.amount) || raw.amount < COIN_MIN || raw.amount > COIN_MAX) {
        return bad("BAD_AMOUNT", `韭币数量须为 ${COIN_MIN}–${COIN_MAX} 的整数`);
      }
      s.amount = raw.amount;
      coinSectors += 1;
    } else if (kind === "item") {
      if (!Object.hasOwn(ITEM_TYPES, raw.item)) return bad("BAD_ITEM", "未知道具类型");
      if (!Number.isInteger(raw.qty) || raw.qty < 1 || raw.qty > ITEM_QTY_MAX) {
        return bad("BAD_QTY", `道具数量须为 1–${ITEM_QTY_MAX} 的整数`);
      }
      if (!itemsAvailable()) {
        return { ok: false, status: 400, code: "ITEMS_UNAVAILABLE", message: "道具系统尚未部署，不能设置道具扇区" };
      }
      if (raw.item === "rewind_ticket" && !rewindEnabled) {
        return { ok: false, status: 400, code: "REWIND_DISABLED", message: "「反悔」功能未开启，不能发放后悔券" };
      }
      s.item = raw.item;
      s.qty = raw.qty;
    } else if (kind === "spin") {
      if (raw.qty !== undefined && raw.qty !== 1) return bad("BAD_QTY", "再转一次数量固定为 1");
      s.qty = 1;
      spinWeight += weight;
    } else {
      return bad("BAD_KIND", "扇区类型须为 jiu_coin / item / spin");
    }
    if (raw.jackpot !== undefined && typeof raw.jackpot !== "boolean") return bad("BAD_JACKPOT", "jackpot 须为布尔值");
    if (raw.jackpot) s.jackpot = true;
    out.push(s);
  }
  if (weightSum !== WEIGHT_TOTAL) {
    return bad("WEIGHT_SUM", `权重之和须为 ${WEIGHT_TOTAL}（当前 ${weightSum}）`);
  }
  if (coinSectors < 1) return bad("NO_COIN_SECTOR", "至少需要一个韭币扇区");
  if (spinWeight > SPIN_WEIGHT_MAX) {
    return bad("SPIN_TOO_LIKELY", `「再转一次」总权重不得超过 ${SPIN_WEIGHT_MAX}（${SPIN_WEIGHT_MAX / 100}%）`);
  }
  out.sort((a, b) => a.pos - b.pos);
  const ev = computeEv(out, ticketCoinValue);
  if (ev.ev < EV_MIN || ev.ev > EV_MAX) {
    return {
      ok: false,
      status: 400,
      code: "EV_OUT_OF_BOUNDS",
      message: `期望值 ${ev.ev} 超出允许范围 ${EV_MIN}–${EV_MAX}`,
      ev,
    };
  }
  const warnings = [];
  if (ev.ev > EV_WARN) warnings.push({ code: "EV_HIGH", message: `期望值 ${ev.ev} 高于 ${EV_WARN}（原每日领取约 ${LEGACY_DAILY_EV}），请确认` });
  if (ev.ev < LEGACY_DAILY_EV * 0.8) warnings.push({ code: "EV_LOW", message: `期望值 ${ev.ev} 明显低于原每日领取（${LEGACY_DAILY_EV}）` });
  if (!out.some((s) => s.jackpot)) warnings.push({ code: "NO_JACKPOT", message: "没有标记大奖扇区（不会触发大奖特效）" });
  return { ok: true, sectors: out, ticketCoinValue, ev, warnings };
}

/* ------------------------------------------------------------------ config persistence */

function parseConfigRow(row) {
  if (!row) return null;
  const sectors = JSON.parse(row.sectors_json);
  return {
    version: row.version,
    sectors,
    ticketCoinValue: row.ticket_coin_value,
    evX100: row.ev_x100,
    note: row.note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ? isoUtc(row.created_at) : null,
  };
}

function isoUtc(sqliteTs) {
  const s = String(sqliteTs);
  return /Z$|[+-]\d\d:\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
}

export function getActiveConfig(db = openDb()) {
  let row = db.prepare(`SELECT * FROM lucky_wheel_configs ORDER BY version DESC LIMIT 1`).get();
  if (!row) {
    // Defensive: migration seeds Table A; if someone emptied the table fall back to code Table A.
    const ev = computeEv([...TABLE_A]);
    const info = db
      .prepare(`INSERT INTO lucky_wheel_configs (sectors_json, ticket_coin_value, ev_x100, note) VALUES (?, 50, ?, 'fallback: Table A')`)
      .run(JSON.stringify(TABLE_A), Math.round(ev.ev * 100));
    row = db.prepare(`SELECT * FROM lucky_wheel_configs WHERE version = ?`).get(info.lastInsertRowid);
  }
  return parseConfigRow(row);
}

export function getConfigVersion(version, db = openDb()) {
  return parseConfigRow(db.prepare(`SELECT * FROM lucky_wheel_configs WHERE version = ?`).get(version));
}

/** Public sector view (what the client draws). */
export function sectorView(s, ticketCoinValue = DEFAULT_TICKET_COIN_VALUE) {
  const v = {
    pos: s.pos,
    kind: s.kind,
    prizeId: prizeId(s),
    isJackpot: !!s.jackpot,
    coinValue: sectorCoinValue(s, ticketCoinValue),
  };
  if (s.kind === "jiu_coin") {
    v.amount = s.amount;
    v.tier = coinTier(s.amount);
    v.art = `coin-t${v.tier}`;
  } else if (s.kind === "item") {
    v.item = s.item;
    v.qty = s.qty;
    v.label = ITEM_TYPES[s.item]?.label || s.item;
    v.art = `ticket-x${s.qty}`;
  } else {
    v.qty = 1;
    v.label = "再转一次";
    v.art = "spin-again";
  }
  return v;
}

export function adminGetConfig({ db = openDb() } = {}) {
  const active = getActiveConfig(db);
  const versions = db
    .prepare(`SELECT version, ev_x100, note, created_by, created_at FROM lucky_wheel_configs ORDER BY version DESC LIMIT 20`)
    .all()
    .map((r) => ({ version: r.version, ev: r.ev_x100 / 100, note: r.note, createdBy: r.created_by, createdAt: isoUtc(r.created_at) }));
  return {
    active: {
      ...active,
      ev: computeEv(active.sectors, active.ticketCoinValue),
      sectorViews: active.sectors.map((s) => sectorView(s, active.ticketCoinValue)),
    },
    versions,
    settings: { enabled: !!config.luckyWheelEnabled, dailyFree: config.luckyWheelDailyFree },
    constraints: {
      sectors: WHEEL_SECTORS,
      weightTotal: WEIGHT_TOTAL,
      evMin: EV_MIN,
      evMax: EV_MAX,
      evWarn: EV_WARN,
      legacyDailyEv: LEGACY_DAILY_EV,
      coinMin: COIN_MIN,
      coinMax: COIN_MAX,
      itemQtyMax: ITEM_QTY_MAX,
      spinWeightMax: SPIN_WEIGHT_MAX,
      maxSpinsPerDay: MAX_SPINS_PER_DAY,
      itemsAvailable: itemsAvailable(),
      rewindEnabled: !!config.gameRewindEnabled,
      itemTypes: Object.entries(ITEM_TYPES).map(([type, v]) => ({ type, label: v.label })),
    },
    tableA: TABLE_A,
    presets: { C1: TABLE_C1, C2: TABLE_C2 },
  };
}

export function adminPreviewConfig(input) {
  const v = validateWheelConfig(input);
  if (!v.ok) return v;
  return { ok: true, ev: v.ev, warnings: v.warnings, sectors: v.sectors, ticketCoinValue: v.ticketCoinValue };
}

function cleanReason(reason) {
  const r = typeof reason === "string" ? reason.trim() : "";
  return r.length >= 2 && r.length <= 200 ? r : null;
}

export function adminSaveConfig({ actorId, input, restoreVersion, reason, requestId = null }) {
  const why = cleanReason(reason);
  if (!why) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "原因需 2–200 字" };
  const db = openDb();
  let candidate = input;
  let note = why;
  if (restoreVersion != null) {
    if (!Number.isInteger(restoreVersion)) return bad("BAD_VERSION", "restoreVersion 须为整数");
    const old = getConfigVersion(restoreVersion, db);
    if (!old) return { ok: false, status: 404, code: "NOT_FOUND", message: "版本不存在" };
    candidate = { sectors: old.sectors, ticketCoinValue: old.ticketCoinValue };
    note = `restore v${restoreVersion}: ${why}`;
  }
  const v = validateWheelConfig(candidate);
  if (!v.ok) return v;
  const before = getActiveConfig(db);
  const out = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO lucky_wheel_configs (sectors_json, ticket_coin_value, ev_x100, note, created_by) VALUES (?, ?, ?, ?, ?)`)
      .run(JSON.stringify(v.sectors), v.ticketCoinValue, Math.round(v.ev.ev * 100), note.slice(0, 300), actorId ?? null);
    const version = Number(info.lastInsertRowid);
    writeAuditLog({
      actorId,
      action: "lucky_wheel.config",
      targetType: "lucky_wheel",
      targetId: String(version),
      reason: why,
      before: { version: before.version, ev: before.evX100 / 100 },
      after: { version, ev: v.ev.ev },
      requestId,
    });
    return version;
  })();
  return { ok: true, version: out, ev: v.ev, warnings: v.warnings };
}

/* ------------------------------------------------------------------ day / free spin state */

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function nextResetAt(todayYmd) {
  return `${addDaysYmd(todayYmd, 1)}T00:00:00+08:00`;
}

function legacyClaimedOn(db, userId, ymd) {
  return !!db
    .prepare(`SELECT 1 AS x FROM jiu_coin_daily_claims WHERE user_id = ? AND claim_date = ?`)
    .get(userId, ymd);
}

function liveCredits(db, userId, ymd) {
  return db
    .prepare(
      `SELECT id, spins, used FROM lucky_wheel_credit_grants
       WHERE user_id = ? AND used < spins AND (expires_date IS NULL OR expires_date >= ?)
       ORDER BY (expires_date IS NULL), expires_date, id`
    )
    .all(userId, ymd);
}

/** Free spins right now. A same-day legacy 每日领取 consumes one daily slot (no double dip on the cutover day). */
export function freeSpinState(db, userId, ymd) {
  const total = config.luckyWheelDailyFree;
  const used = db
    .prepare(`SELECT COUNT(*) AS c FROM lucky_wheel_spins WHERE user_id = ? AND spin_date = ? AND source = 'daily'`)
    .get(userId, ymd).c;
  const legacy = legacyClaimedOn(db, userId, ymd);
  const remaining = Math.max(0, total - used - (legacy ? 1 : 0));
  const credits = liveCredits(db, userId, ymd).reduce((a, g) => a + (g.spins - g.used), 0);
  const spinsToday = db
    .prepare(`SELECT COUNT(*) AS c FROM lucky_wheel_spins WHERE user_id = ? AND spin_date = ?`)
    .get(userId, ymd).c;
  return {
    daily: { used, total, remaining },
    credits,
    total: remaining + credits,
    legacyClaimedToday: legacy,
    spinsToday,
  };
}

/* ------------------------------------------------------------------ spin */

class WheelError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const IDEM_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function defaultRng(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

/** Deterministic landing offset inside the sector, derived from the spin id: [-13.0, +13.0] degrees. */
export function landJitterDeg(spinId) {
  const h = crypto.createHash("sha256").update(String(spinId)).digest();
  return ((h.readUInt32BE(0) % 261) - 130) / 10;
}

export function pickSector(sectors, roll) {
  let acc = 0;
  for (const s of [...sectors].sort((a, b) => a.pos - b.pos)) {
    acc += s.weight;
    if (roll < acc) return s;
  }
  throw new Error(`roll ${roll} outside weight total`);
}

function prizeFromRow(row) {
  const p = {
    id:
      row.prize_kind === "jiu_coin"
        ? `coin-${row.prize_qty}`
        : row.prize_kind === "item"
          ? `${row.prize_item}-x${row.prize_qty}`
          : "spin-again",
    kind: row.prize_kind,
    qty: row.prize_qty,
    coinValue: row.coin_value,
    substituted: !!row.substituted,
    isJackpot: !!row.is_jackpot,
  };
  if (row.substituted) {
    p.drawnKind = row.drawn_kind;
    if (row.substitute_reason) p.substituteReason = row.substitute_reason;
  }
  if (row.prize_kind === "jiu_coin") p.amount = row.prize_qty;
  if (row.prize_kind === "item") {
    p.item = row.prize_item;
    p.label = ITEM_TYPES[row.prize_item]?.label || row.prize_item;
  }
  if (row.prize_kind === "spin") p.label = "再转一次";
  return p;
}

export function spinResponse(db, row, { replayed = false } = {}) {
  const ymd = shanghaiYmd(challengeNow());
  return {
    spinId: row.spin_id,
    sector: row.sector,
    landJitterDeg: landJitterDeg(row.spin_id),
    prize: prizeFromRow(row),
    isJackpot: !!row.is_jackpot,
    balance: getJiuCoinBalance(row.user_id, db),
    balanceAfter: row.balance_after,
    freeSpins: freeSpinState(db, row.user_id, ymd),
    configVersion: row.config_version,
    spinDate: row.spin_date,
    replayed,
    nextResetAt: nextResetAt(ymd),
    createdAt: isoUtc(row.created_at),
  };
}

function findSpinByIdem(db, userId, idemKey) {
  return db.prepare(`SELECT * FROM lucky_wheel_spins WHERE user_id = ? AND idem_key = ?`).get(userId, idemKey);
}

/**
 * POST /me/lucky-wheel/spin core. Returns { status, data } | { error }.
 * `rng(maxExclusive)` and `now` are injectable for tests.
 */
export function spinWheel(userId, { idemKey, rng = defaultRng, now = challengeNow() } = {}) {
  if (typeof idemKey !== "string" || !IDEM_RE.test(idemKey)) {
    return { error: { status: 400, code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key 必填（8-128 位字母数字或 ._:-）" } };
  }
  const db = openDb();
  const prior = findSpinByIdem(db, userId, idemKey);
  if (prior) return { status: 200, data: spinResponse(db, prior, { replayed: true }) };
  if (!config.luckyWheelEnabled) {
    return { error: { status: 403, code: "FEATURE_DISABLED", message: "幸运转盘暂未开放" } };
  }

  const ymdNow = shanghaiYmd(now);
  let spinRowId;
  try {
    const run = db.transaction(() => {
      const user = db.prepare(`SELECT id, status, is_bot FROM users WHERE id = ?`).get(userId);
      if (!user || user.status !== "active") throw new WheelError(403, "ACCOUNT_UNAVAILABLE", "账号不可用");
      if (Number(user.is_bot) === 1) throw new WheelError(403, "BOT_NOT_ALLOWED", "机器人账号不能转盘");
      const again = findSpinByIdem(db, userId, idemKey);
      if (again) return { replayRow: again };

      const ymd = ymdNow;
      const state = freeSpinState(db, userId, ymd);
      let source;
      let slot = null;
      let creditGrantId = null;
      if (state.daily.remaining > 0) {
        source = "daily";
        slot = state.daily.used + 1;
      } else {
        const grants = liveCredits(db, userId, ymd);
        if (!grants.length) {
          throw new WheelError(409, "NO_SPINS_LEFT", "今日免费次数已用完", { nextResetAt: nextResetAt(ymd), date: ymd });
        }
        const upd = db
          .prepare(`UPDATE lucky_wheel_credit_grants SET used = used + 1 WHERE id = ? AND used < spins`)
          .run(grants[0].id);
        if (upd.changes !== 1) {
          throw new WheelError(409, "NO_SPINS_LEFT", "今日免费次数已用完", { nextResetAt: nextResetAt(ymd), date: ymd });
        }
        source = "credit";
        creditGrantId = grants[0].id;
      }

      const cfg = getActiveConfig(db);
      const roll = rng(WEIGHT_TOTAL);
      if (!Number.isInteger(roll) || roll < 0 || roll >= WEIGHT_TOTAL) throw new Error("rng out of range");
      const sector = pickSector(cfg.sectors, roll);
      const spinId = crypto.randomUUID();

      // Resolve what is actually paid (substitute coins when an item/spin prize cannot be granted).
      let prizeKind = sector.kind;
      let prizeItem = null;
      let prizeQty = sector.kind === "jiu_coin" ? sector.amount : sector.qty;
      let substituted = 0;
      let itemLedgerId = null;
      let bonusGrantId = null;
      const subCoins = (coins) => {
        prizeKind = "jiu_coin";
        prizeItem = null;
        prizeQty = coins;
        substituted = 1;
      };
      let subReason = null;
      if (sector.kind === "item") {
        const rewindOk = sector.item !== "rewind_ticket" || config.gameRewindEnabled;
        let granted = null;
        if (!itemsAvailable()) subReason = "items_unavailable";
        else if (!rewindOk) subReason = "rewind_disabled";
        else if (sector.item === "rewind_ticket" && ticketsWonOn(db, userId, ymd) + sector.qty > config.rewindTicketDailyCap) {
          subReason = "ticket_daily_cap";
        } else {
          granted = itemGranter(db, { userId, item: sector.item, qty: sector.qty, spinId });
          if (granted?.overflow) subReason = granted.reason || "ticket_hold_cap";
        }
        if (granted && !granted.overflow && granted.ledgerId != null) {
          prizeItem = sector.item;
          itemLedgerId = granted.ledgerId;
        } else {
          subCoins(sector.qty * cfg.ticketCoinValue);
          subReason = subReason || "items_unavailable";
        }
      } else if (sector.kind === "spin") {
        if (state.spinsToday + 1 >= MAX_SPINS_PER_DAY) {
          subCoins(spinCapCoins(cfg.sectors));
          subReason = "spin_cap";
        } else {
          const g = db
            .prepare(
              `INSERT INTO lucky_wheel_credit_grants (user_id, spins, source_key, reason, expires_date)
               VALUES (?, 1, ?, 'wheel_spin_again', ?)`
            )
            .run(userId, `wheel:${spinId}`, ymd);
          bonusGrantId = Number(g.lastInsertRowid);
        }
      }

      let ledgerId = null;
      let balanceAfter = getJiuCoinBalance(userId, db);
      if (prizeKind === "jiu_coin") {
        const paid = grantRewardClaim(db, {
          userId,
          rewardKey: `wheel:${spinId}`,
          amount: prizeQty,
          reason: WHEEL_REASON,
          refType: "wheel_spin",
          refId: spinId,
          meta: { sector: sector.pos, configVersion: cfg.version, roll, source, substituted: !!substituted },
        });
        ledgerId = paid.ledgerId;
        balanceAfter = paid.balance;
      }
      const coinValue =
        prizeKind === "jiu_coin" ? prizeQty : prizeKind === "item" ? prizeQty * cfg.ticketCoinValue : 0;
      const isJackpot = sector.jackpot && !substituted ? 1 : 0;
      const info = db
        .prepare(
          `INSERT INTO lucky_wheel_spins (
            spin_id, user_id, idem_key, spin_date, source, slot, credit_grant_id, config_version, sector, roll,
            drawn_kind, prize_kind, prize_item, prize_qty, coin_value, substituted, is_jackpot,
            ledger_id, item_ledger_id, bonus_grant_id, balance_after, substitute_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          spinId, userId, idemKey, ymd, source, slot, creditGrantId, cfg.version, sector.pos, roll,
          sector.kind, prizeKind, prizeItem, prizeQty, coinValue, substituted, isJackpot,
          ledgerId, itemLedgerId, bonusGrantId, balanceAfter, substituted ? subReason : null
        );
      return { rowId: Number(info.lastInsertRowid) };
    });
    const out = run.immediate();
    if (out.replayRow) return { status: 200, data: spinResponse(db, out.replayRow, { replayed: true }) };
    spinRowId = out.rowId;
  } catch (e) {
    if (e instanceof WheelError) {
      return { error: { status: e.status, code: e.code, message: e.message, details: e.details } };
    }
    if (String(e?.message || "").includes("UNIQUE")) {
      const again = findSpinByIdem(db, userId, idemKey);
      if (again) return { status: 200, data: spinResponse(db, again, { replayed: true }) };
      return { error: { status: 409, code: "NO_SPINS_LEFT", message: "今日免费次数已用完", details: { nextResetAt: nextResetAt(ymdNow) } } };
    }
    throw e;
  }
  const row = db.prepare(`SELECT * FROM lucky_wheel_spins WHERE id = ?`).get(spinRowId);
  return { status: 200, data: spinResponse(db, row) };
}

/* ------------------------------------------------------------------ user-facing reads */

export function getWheelState(userId, { now = challengeNow() } = {}) {
  const db = openDb();
  if (!config.luckyWheelEnabled) return { enabled: false };
  const ymd = shanghaiYmd(now);
  const cfg = getActiveConfig(db);
  const last = db
    .prepare(`SELECT * FROM lucky_wheel_spins WHERE user_id = ? AND spin_date = ? ORDER BY id DESC LIMIT 1`)
    .get(userId, ymd);
  return {
    enabled: true,
    date: ymd,
    nextResetAt: nextResetAt(ymd),
    balance: getJiuCoinBalance(userId, db),
    freeSpins: freeSpinState(db, userId, ymd),
    configVersion: cfg.version,
    sectors: cfg.sectors.map((s) => sectorView(s, cfg.ticketCoinValue)),
    odds: cfg.sectors.map((s) => ({ pos: s.pos, pct: s.weight / 100 })),
    lastSpin: last
      ? { spinId: last.spin_id, sector: last.sector, prize: prizeFromRow(last), isJackpot: !!last.is_jackpot, at: isoUtc(last.created_at) }
      : null,
    legacyClaimedToday: legacyClaimedOn(db, userId, ymd),
  };
}

/** Compact block embedded in GET /me/jiu-coin so the top bar needs one request. */
export function wheelSummary(userId, { now = challengeNow() } = {}) {
  if (!config.luckyWheelEnabled) return { enabled: false };
  const db = openDb();
  const ymd = shanghaiYmd(now);
  return { enabled: true, freeSpins: freeSpinState(db, userId, ymd), nextResetAt: nextResetAt(ymd) };
}

export function wheelHistory(userId, limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const db = openDb();
  const rows = db.prepare(`SELECT * FROM lucky_wheel_spins WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, lim);
  return {
    items: rows.map((r) => ({
      spinId: r.spin_id,
      date: r.spin_date,
      sector: r.sector,
      prize: prizeFromRow(r),
      isJackpot: !!r.is_jackpot,
      at: isoUtc(r.created_at),
    })),
  };
}

/* ------------------------------------------------------------------ admin reads / writes */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function adminListSpins({ userId, date, from, to, minValue, source, kind, limit = 30, cursor } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const where = [];
  const args = [];
  if (userId != null && userId !== "") {
    const n = Number(userId);
    if (!Number.isInteger(n)) return bad("BAD_USER", "userId 无效");
    where.push("s.user_id = ?");
    args.push(n);
  }
  for (const [name, val, op] of [["date", date, "="], ["from", from, ">="], ["to", to, "<="]]) {
    if (val) {
      if (!YMD_RE.test(val)) return bad("BAD_DATE", `${name} 须为 YYYY-MM-DD`);
      where.push(`s.spin_date ${op} ?`);
      args.push(val);
    }
  }
  if (minValue != null && minValue !== "") {
    const n = Number(minValue);
    if (!Number.isFinite(n)) return bad("BAD_MIN", "minValue 无效");
    where.push("s.coin_value >= ?");
    args.push(n);
  }
  if (source) {
    if (source !== "daily" && source !== "credit") return bad("BAD_SOURCE", "source 须为 daily / credit");
    where.push("s.source = ?");
    args.push(source);
  }
  if (kind) {
    if (!["jiu_coin", "item", "spin"].includes(kind)) return bad("BAD_KIND", "kind 无效");
    where.push("s.prize_kind = ?");
    args.push(kind);
  }
  if (cursor != null && cursor !== "") {
    const c = Number(cursor);
    if (Number.isFinite(c)) {
      where.push("s.id < ?");
      args.push(c);
    }
  }
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT s.*, u.username_normalized AS username, u.nickname AS nickname
       FROM lucky_wheel_spins s JOIN users u ON u.id = s.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(...args, lim + 1);
  const more = rows.length > lim;
  const page = more ? rows.slice(0, lim) : rows;
  return {
    ok: true,
    items: page.map((r) => ({
      id: r.id,
      spinId: r.spin_id,
      userId: r.user_id,
      username: r.username,
      nickname: r.nickname,
      date: r.spin_date,
      at: isoUtc(r.created_at),
      source: r.source,
      slot: r.slot,
      configVersion: r.config_version,
      sector: r.sector,
      roll: r.roll,
      drawnKind: r.drawn_kind,
      prize: prizeFromRow(r),
      balanceAfter: r.balance_after,
    })),
    nextCursor: more ? page[page.length - 1].id : null,
  };
}

export function adminStats({ days = 7, now = challengeNow() } = {}) {
  const n = Math.min(Math.max(Number(days) || 7, 1), 60);
  const db = openDb();
  const today = shanghaiYmd(now);
  const start = addDaysYmd(today, -(n - 1));
  const rows = db
    .prepare(
      `SELECT spin_date AS d, COUNT(*) AS spins, COUNT(DISTINCT user_id) AS users,
              SUM(CASE WHEN prize_kind='jiu_coin' THEN prize_qty ELSE 0 END) AS coins,
              SUM(coin_value) AS coinValue,
              SUM(is_jackpot) AS jackpots,
              SUM(CASE WHEN prize_kind='item' THEN prize_qty ELSE 0 END) AS items,
              SUM(CASE WHEN drawn_kind='spin' THEN 1 ELSE 0 END) AS spinAgain,
              SUM(substituted) AS substituted,
              SUM(CASE WHEN source='credit' THEN 1 ELSE 0 END) AS creditSpins
       FROM lucky_wheel_spins WHERE spin_date >= ? AND spin_date <= ? GROUP BY spin_date`
    )
    .all(start, today);
  const byDate = new Map(rows.map((r) => [r.d, r]));
  const series = [];
  for (let i = 0; i < n; i++) {
    const d = addDaysYmd(start, i);
    const r = byDate.get(d);
    series.push({
      date: d,
      spins: r?.spins || 0,
      users: r?.users || 0,
      coins: r?.coins || 0,
      coinValue: r?.coinValue || 0,
      jackpots: r?.jackpots || 0,
      items: r?.items || 0,
      spinAgain: r?.spinAgain || 0,
      substituted: r?.substituted || 0,
    });
  }
  const tot = db
    .prepare(
      `SELECT COUNT(*) AS spins, COUNT(DISTINCT user_id) AS users,
              COALESCE(SUM(CASE WHEN prize_kind='jiu_coin' THEN prize_qty ELSE 0 END),0) AS coins,
              COALESCE(SUM(coin_value),0) AS coinValue, COALESCE(SUM(is_jackpot),0) AS jackpots,
              COALESCE(SUM(CASE WHEN prize_kind='item' THEN prize_qty ELSE 0 END),0) AS items,
              COALESCE(SUM(CASE WHEN drawn_kind='spin' THEN 1 ELSE 0 END),0) AS spinAgain,
              COALESCE(SUM(substituted),0) AS substituted
       FROM lucky_wheel_spins WHERE spin_date >= ? AND spin_date <= ?`
    )
    .get(start, today);
  const userDays = db
    .prepare(`SELECT COUNT(*) AS c FROM (SELECT DISTINCT user_id, spin_date FROM lucky_wheel_spins WHERE spin_date >= ? AND spin_date <= ?)`)
    .get(start, today).c;
  // Configured per-draw EV for exactly the draws in the window (weights each draw by its config version).
  const verRows = db
    .prepare(`SELECT config_version AS v, COUNT(*) AS c FROM lucky_wheel_spins WHERE spin_date >= ? AND spin_date <= ? GROUP BY config_version`)
    .all(start, today);
  let cfgPerDrawSum = 0;
  for (const vr of verRows) {
    const cfg = getConfigVersion(vr.v, db);
    cfgPerDrawSum += computeEv(cfg.sectors, cfg.ticketCoinValue).perDraw * vr.c;
  }
  const configuredPerDraw = tot.spins ? r2(cfgPerDrawSum / tot.spins) : null;
  const realizedPerDraw = tot.spins ? r2(tot.coinValue / tot.spins) : null;
  const driftPct = configuredPerDraw && realizedPerDraw != null ? r2(((realizedPerDraw - configuredPerDraw) / configuredPerDraw) * 100) : null;
  const active = getActiveConfig(db);
  const todayRow = series[series.length - 1];
  return {
    days: n,
    from: start,
    to: today,
    today: todayRow,
    totals: {
      ...tot,
      userDays,
      realizedPerDraw,
      realizedPerUserDay: userDays ? r2(tot.coinValue / userDays) : null,
      configuredPerDraw,
      driftPct,
      driftWarning: tot.spins >= 500 && driftPct != null && Math.abs(driftPct) > 15,
    },
    configuredEv: computeEv(active.sectors, active.ticketCoinValue),
    activeVersion: active.version,
    series,
  };
}

export function adminGrantSpins({ actorId, userId, spins, reason, expiresDate = null, opKey = null, requestId = null }) {
  const why = cleanReason(reason);
  if (!why) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "原因需 2–200 字" };
  if (!Number.isInteger(userId)) return bad("BAD_USER", "用户 ID 无效");
  if (!Number.isInteger(spins) || spins < 1 || spins > ADMIN_GRANT_MAX) {
    return bad("BAD_SPINS", `次数须为 1–${ADMIN_GRANT_MAX} 的整数`);
  }
  if (expiresDate != null && (typeof expiresDate !== "string" || !YMD_RE.test(expiresDate))) {
    return bad("BAD_DATE", "expiresDate 须为 YYYY-MM-DD 或留空");
  }
  const db = openDb();
  const u = db.prepare(`SELECT id, status, is_bot FROM users WHERE id = ?`).get(userId);
  if (!u || u.status === "deleted") return { ok: false, status: 404, code: "NOT_FOUND", message: "用户不存在" };
  if (Number(u.is_bot) === 1) return bad("BOT_NOT_ALLOWED", "机器人账号不能发放转盘次数");
  const key = opKey ? `admin:${String(opKey).slice(0, 100)}` : null;
  if (key) {
    const prior = db.prepare(`SELECT id, spins FROM lucky_wheel_credit_grants WHERE source_key = ?`).get(key);
    if (prior) return { ok: true, grantId: prior.id, spins: prior.spins, unchanged: true };
  }
  const grantId = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO lucky_wheel_credit_grants (user_id, spins, source_key, reason, granted_by, expires_date) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, spins, key, `admin: ${why}`, actorId ?? null, expiresDate);
    writeAuditLog({
      actorId,
      action: "lucky_wheel.grant",
      targetType: "user",
      targetId: String(userId),
      reason: why,
      after: { spins, expiresDate },
      requestId,
    });
    return Number(info.lastInsertRowid);
  })();
  return { ok: true, grantId, spins, unchanged: false };
}

export function adminUserWheel(userId, { now = challengeNow() } = {}) {
  const db = openDb();
  const u = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId);
  if (!u) return null;
  const ymd = shanghaiYmd(now);
  const grants = db
    .prepare(`SELECT id, spins, used, reason, granted_by, expires_date, created_at FROM lucky_wheel_credit_grants WHERE user_id = ? ORDER BY id DESC LIMIT 20`)
    .all(userId)
    .map((g) => ({ id: g.id, spins: g.spins, used: g.used, reason: g.reason, grantedBy: g.granted_by, expiresDate: g.expires_date, createdAt: isoUtc(g.created_at) }));
  return { enabled: !!config.luckyWheelEnabled, date: ymd, freeSpins: freeSpinState(db, userId, ymd), grants, recent: wheelHistory(userId, 10).items };
}
