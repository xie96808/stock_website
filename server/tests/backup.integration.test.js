import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareTestEnv } from "./helpers.js";

const env = prepareTestEnv();

const { migrate } = await import("../src/db/migrate.js");
migrate();
const {
  createOnlineBackup,
  checkBackupIntegrity,
  readBackupStatus,
  getBackupAgeSeconds,
  pruneBackups,
  restoreBackupFile,
} = await import("../src/lib/backup.js");
const { openDb, closeDb, getDbPath } = await import("../src/db/connection.js");
const {
  listActiveTombstonesFromLedger,
  getTombstoneLedgerPath,
  replayUserTombstones,
} = await import("../src/lib/tombstones.js");
const { softDeleteUser } = await import("../src/lib/users.js");


test("online backup is consistent and updates status", async () => {
  const db = openDb();
  db.prepare(
    `INSERT INTO users (username_normalized, password_hash, nickname, avatar_id, leaderboard_opt_in)
     VALUES (?, ?, ?, 1, 0)`
  ).run("bkuser1", "x", "备友");

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stockgame-bk-"));
  const out = path.join(outDir, "snap.sqlite");
  const meta = await createOnlineBackup({ outputPath: out, updateStatus: true });
  assert.equal(meta.integrity, "ok");
  assert.ok(fs.existsSync(out));
  assert.ok(meta.sha256 && meta.sha256.length === 64);

  const check = checkBackupIntegrity(out);
  assert.equal(check.ok, true);
  assert.ok(check.stats.userCount >= 1);

  const status = readBackupStatus();
  assert.ok(status?.lastSuccessAt);
  assert.equal(typeof getBackupAgeSeconds(), "number");
});


test("prune keeps recent timestamped backups", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stockgame-prune-"));
  const mk = (name) => {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, "sqlite-fake");
    return fp;
  };
  // far past — should be pruned by maxAge
  mk("stockgame-20200101-000000.sqlite");
  mk("stockgame-20260901-120000.sqlite");
  const result = pruneBackups(dir, { now: new Date("2026-09-08T00:00:00Z") });
  assert.ok(result.removed.some((x) => x.includes("20200101")));
  assert.ok(result.kept.some((x) => x.includes("20260901")));
});

test("restore-check rejects missing file", () => {
  assert.throws(() => checkBackupIntegrity(path.join(os.tmpdir(), "no-such-backup.sqlite")));
});

/**
 * R2 acceptance: external tombstone ledger survives main-DB restore.
 * Flow: create user → online backup → soft-delete (ledger write) → restore
 * backup to temp target → auto-replay from external ledger → user stays deleted.
 * Uses only temp dirs from prepareTestEnv / mkdtemp — never prod paths.
 */
test("external ledger survives restore: backup → delete → restore → replay keeps deleted", async () => {
  const stamp = Date.now().toString(36);
  const username = `r2tomb${stamp}`;
  const db = openDb();
  const info = db
    .prepare(
      `INSERT INTO users (username_normalized, password_hash, nickname, avatar_id, leaderboard_opt_in, status)
       VALUES (?, ?, ?, 1, 0, 'active')`
    )
    .run(username, "hash-alive", `R2${stamp}`);
  const userId = Number(info.lastInsertRowid);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stockgame-r2-bk-"));
  const backupPath = path.join(outDir, "pre-delete.sqlite");
  await createOnlineBackup({ outputPath: backupPath, updateStatus: false });

  softDeleteUser(userId, { wipeCredentials: true, source: "self", reason: "r2-test" });
  const live = openDb().prepare("SELECT status, password_hash FROM users WHERE id = ?").get(userId);
  assert.equal(live.status, "deleted");

  const ledgerBefore = listActiveTombstonesFromLedger().filter((t) => t.user_id === userId);
  assert.equal(ledgerBefore.length, 1);
  assert.ok(fs.existsSync(getTombstoneLedgerPath()));
  const ledgerBytes = fs.readFileSync(getTombstoneLedgerPath(), "utf8");
  assert.match(ledgerBytes, new RegExp(`"user_id":${userId}`));

  // Restore into a separate temp DB so we prove ledger is outside the sqlite file.
  const restoreTarget = path.join(outDir, "restored.sqlite");
  const result = await restoreBackupFile({
    backupPath,
    targetPath: restoreTarget,
    autoReplay: true,
  });
  assert.ok(result.replay);
  assert.equal(result.replay.source, "external-ledger");
  assert.ok(result.replay.applied >= 1, JSON.stringify(result.replay));

  // Point connection at restored DB and assert user cannot be active.
  closeDb();
  process.env.STOCKGAME_DB_PATH = restoreTarget;
  const restored = openDb().prepare("SELECT status, password_hash FROM users WHERE id = ?").get(userId);
  assert.ok(restored, "user row exists in restored backup");
  assert.equal(restored.status, "deleted");
  assert.equal(restored.password_hash, "!");

  // Ledger file under original data dir was not replaced by restore.
  assert.ok(fs.existsSync(getTombstoneLedgerPath()));
  assert.equal(
    listActiveTombstonesFromLedger().filter((t) => t.user_id === userId).length,
    1
  );

  // Restore without auto-replay would resurrect; prove manual replay still works.
  closeDb();
  const restoreTarget2 = path.join(outDir, "restored-manual.sqlite");
  await restoreBackupFile({
    backupPath,
    targetPath: restoreTarget2,
    autoReplay: false,
  });
  process.env.STOCKGAME_DB_PATH = restoreTarget2;
  const resurrected = openDb().prepare("SELECT status FROM users WHERE id = ?").get(userId);
  assert.equal(resurrected.status, "active");
  const manual = replayUserTombstones();
  assert.ok(manual.applied >= 1);
  const after = openDb().prepare("SELECT status FROM users WHERE id = ?").get(userId);
  assert.equal(after.status, "deleted");

  // Restore connection env for remaining tests in this file.
  closeDb();
  process.env.STOCKGAME_DB_PATH = env.dbPath;
});

test("teardown closes db", () => {
  closeDb();
  assert.ok(getDbPath());
});
