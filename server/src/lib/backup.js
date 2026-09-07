/**
 * SQLite online consistent backup via better-sqlite3 Online Backup API.
 * Do NOT use naive cp on a live WAL database.
 *
 * CLI (from server/):
 *   node src/lib/backup.js backup [--output PATH | --dir DIR] [--prune] [--no-status]
 *   node src/lib/backup.js restore-check --backup PATH
 *   STOCKGAME_ALLOW_RESTORE=1 node src/lib/backup.js restore --backup PATH [--target PATH]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getDataDir, getDbPath, openDb, closeDb } from "../db/connection.js";

export const BACKUP_STATUS_FILENAME = "backup-status.json";

export function getBackupStatusPath() {
  return process.env.STOCKGAME_BACKUP_STATUS_PATH
    || path.join(getDataDir(), BACKUP_STATUS_FILENAME);
}

export function getDefaultBackupDir() {
  return process.env.STOCKGAME_BACKUP_DIR || path.join(getDataDir(), "backups");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Run integrity_check + foreign_key_check on a sqlite file (read-only). */
export function checkBackupIntegrity(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在: ${backupPath}`);
  }
  const db = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrityRows = db.pragma("integrity_check");
    const integrity = integrityRows?.[0]?.integrity_check ?? String(integrityRows);
    const fkRows = db.pragma("foreign_key_check");
    const foreignKeyViolations = Array.isArray(fkRows) ? fkRows.length : 0;
    let userCount = null;
    let settledCount = null;
    let schemaMigrations = null;
    try {
      userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get()?.c ?? null;
    } catch { /* older/empty */ }
    try {
      settledCount = db.prepare(
        "SELECT COUNT(*) AS c FROM game_sessions WHERE status = 'settled'"
      ).get()?.c ?? null;
    } catch { /* ignore */ }
    try {
      schemaMigrations = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get()?.c ?? null;
    } catch { /* ignore */ }
    const ok = integrity === "ok" && foreignKeyViolations === 0;
    return {
      ok,
      integrity,
      foreignKeyViolations,
      stats: {
        sizeBytes: fs.statSync(backupPath).size,
        userCount,
        settledCount,
        schemaMigrations,
      },
    };
  } finally {
    db.close();
  }
}

export function readBackupStatus() {
  const p = getBackupStatusPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeBackupStatus(status) {
  const p = getBackupStatusPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, p);
}

/** Online consistent backup of the live DB into outputPath. */
export async function createOnlineBackup({ outputPath, updateStatus = true } = {}) {
  if (!outputPath) throw new Error("outputPath required");
  const abs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (fs.existsSync(abs)) throw new Error(`输出已存在，拒绝覆盖: ${abs}`);

  const db = openDb();
  const sourcePath = getDbPath();
  const startedAt = new Date().toISOString();
  await db.backup(abs);
  const finishedAt = new Date().toISOString();

  const check = checkBackupIntegrity(abs);
  if (!check.ok) {
    try { fs.unlinkSync(abs); } catch { /* ignore */ }
    throw new Error(
      `备份完整性失败 integrity=${check.integrity} fk=${check.foreignKeyViolations}`
    );
  }

  const sha256 = sha256File(abs);
  const meta = {
    sourcePath,
    backupPath: abs,
    startedAt,
    finishedAt,
    sizeBytes: check.stats.sizeBytes,
    sha256,
    integrity: check.integrity,
    foreignKeyViolations: check.foreignKeyViolations,
    stats: check.stats,
    method: "better-sqlite3.backup / Online Backup API",
  };
  const metaPath = `${abs}.meta.json`;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  if (updateStatus) {
    writeBackupStatus({
      lastSuccessAt: finishedAt,
      backupPath: abs,
      metaPath,
      sizeBytes: meta.sizeBytes,
      sha256,
      integrityOk: true,
      stats: check.stats,
    });
  }

  return meta;
}

export function getBackupAgeSeconds(now = Date.now()) {
  const status = readBackupStatus();
  if (!status?.lastSuccessAt) return null;
  const t = Date.parse(status.lastSuccessAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

export const RETENTION_POLICY = {
  hourlyKeep: 48,
  dailyKeep: 30,
  maxAgeDays: 30,
  noteZh:
    "默认每小时一致性快照：保留最近 48 个小时点、最近 30 个日点；总保留不超过 30 天。至少一份加密副本放异机；同机副本不能覆盖主机损坏风险。",
};

/** Optional prune for timestamped backups named stockgame-YYYYMMDD-HHMMSS.sqlite */
export function pruneBackups(backupDir, {
  hourlyKeep = RETENTION_POLICY.hourlyKeep,
  dailyKeep = RETENTION_POLICY.dailyKeep,
  maxAgeDays = RETENTION_POLICY.maxAgeDays,
  now = new Date(),
} = {}) {
  if (!backupDir || !fs.existsSync(backupDir)) return { removed: [], kept: [] };
  const re = /^stockgame-(\d{8})-(\d{6})\.sqlite$/;
  const entries = fs.readdirSync(backupDir)
    .map((name) => {
      const m = name.match(re);
      if (!m) return null;
      const iso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`;
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return null;
      return { name, path: path.join(backupDir, name), t, day: m[1] };
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t);

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const keep = new Set();
  const byDay = new Map();
  let hourly = 0;
  for (const e of entries) {
    if (now.getTime() - e.t > maxAgeMs) continue;
    if (hourly < hourlyKeep) {
      keep.add(e.path);
      hourly += 1;
    }
    if (!byDay.has(e.day) && byDay.size < dailyKeep) {
      byDay.set(e.day, e.path);
      keep.add(e.path);
    }
  }

  const removed = [];
  const kept = [];
  for (const e of entries) {
    if (keep.has(e.path)) {
      kept.push(e.path);
      continue;
    }
    try {
      fs.unlinkSync(e.path);
      const meta = `${e.path}.meta.json`;
      if (fs.existsSync(meta)) fs.unlinkSync(meta);
      removed.push(e.path);
    } catch {
      /* ignore */
    }
  }
  return { removed, kept };
}

function stampName(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `stockgame-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.sqlite`;
}

function parseCliArgs(argv) {
  const out = { _: [], prune: false, updateStatus: true, output: null, dir: null, backup: null, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output") out.output = argv[++i];
    else if (a === "--dir") out.dir = argv[++i];
    else if (a === "--backup") out.backup = argv[++i];
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--prune") out.prune = true;
    else if (a === "--no-status") out.updateStatus = false;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("-")) throw new Error(`未知参数: ${a}`);
    else out._.push(a);
  }
  return out;
}

async function cliMain(argv) {
  const args = parseCliArgs(argv);
  const cmd = args._[0] || "backup";
  if (args.help) {
    console.log("backup | restore-check | restore");
    return 0;
  }

  if (cmd === "restore-check") {
    if (!args.backup) {
      console.error("需要 --backup <path>");
      return 2;
    }
    const result = checkBackupIntegrity(path.resolve(args.backup));
    if (!result.ok) {
      console.error("RESTORE_CHECK_FAIL", JSON.stringify(result));
      return 1;
    }
    console.log("RESTORE_CHECK_OK", JSON.stringify(result));
    return 0;
  }

  if (cmd === "restore") {
    if (process.env.STOCKGAME_ALLOW_RESTORE !== "1") {
      console.error("拒绝恢复：请设置 STOCKGAME_ALLOW_RESTORE=1，并先停止 stockgame-api");
      return 3;
    }
    if (!args.backup) {
      console.error("需要 --backup <path>");
      return 2;
    }
    const backupPath = path.resolve(args.backup);
    const targetPath = path.resolve(args.target || getDbPath());
    const check = checkBackupIntegrity(backupPath);
    if (!check.ok) {
      console.error("RESTORE_ABORT", JSON.stringify(check));
      return 1;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const salvageDir = path.join(getDataDir(), "restore-salvage");
    fs.mkdirSync(salvageDir, { recursive: true });
    if (fs.existsSync(targetPath)) {
      const salvage = path.join(salvageDir, `pre-restore-${stamp}.sqlite`);
      fs.copyFileSync(targetPath, salvage);
      console.log("SALVAGED_OLD_DB", salvage);
      for (const suffix of ["-wal", "-shm"]) {
        const side = `${targetPath}${suffix}`;
        if (fs.existsSync(side)) {
          fs.copyFileSync(side, `${salvage}${suffix}`);
          fs.unlinkSync(side);
        }
      }
    }
    fs.copyFileSync(backupPath, targetPath);
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${targetPath}${suffix}`;
      if (fs.existsSync(side)) fs.unlinkSync(side);
    }
    console.log("RESTORE_OK", JSON.stringify({
      backupPath,
      targetPath,
      stats: check.stats,
      note: "恢复后须全量撤销旧 session，并按运维文档重放注销 tombstone 后再开放写入",
    }));
    return 0;
  }

  if (cmd !== "backup") {
    console.error("未知命令:", cmd);
    return 2;
  }

  // Ensure schema exists before backup of empty/new env
  const { migrate } = await import("../db/migrate.js");
  migrate();

  let outputPath = args.output ? path.resolve(args.output) : null;
  const dir = args.dir ? path.resolve(args.dir) : getDefaultBackupDir();
  if (!outputPath) {
    fs.mkdirSync(dir, { recursive: true });
    outputPath = path.join(dir, stampName());
  }
  const meta = await createOnlineBackup({ outputPath, updateStatus: args.updateStatus });
  console.log("BACKUP_OK", JSON.stringify({
    backupPath: meta.backupPath,
    sizeBytes: meta.sizeBytes,
    sha256: meta.sha256,
    finishedAt: meta.finishedAt,
    stats: meta.stats,
  }));
  if (args.prune) {
    const result = pruneBackups(path.dirname(outputPath));
    console.log("PRUNE_OK", JSON.stringify({
      removed: result.removed.length,
      kept: result.kept.length,
      policy: RETENTION_POLICY,
    }));
  }
  return 0;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  cliMain(process.argv.slice(2))
    .then((code) => {
      try { closeDb(); } catch { /* ignore */ }
      process.exit(code ?? 0);
    })
    .catch((e) => {
      console.error("BACKUP_FAIL", e.message || e);
      try { closeDb(); } catch { /* ignore */ }
      process.exit(1);
    });
}
