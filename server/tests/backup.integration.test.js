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
} = await import("../src/lib/backup.js");
const { openDb, closeDb, getDbPath } = await import("../src/db/connection.js");


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

test("teardown closes db", () => {
  closeDb();
  assert.ok(getDbPath());
});
