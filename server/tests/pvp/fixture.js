import crypto from "node:crypto";

export const NOW = Date.parse("2026-10-11T04:00:00.000Z");
export const CREATED = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();

export function seedUser(db, { name, balance = 500, createdAt = CREATED, classics = 3 } = {}) {
  const info = db
    .prepare(
      `INSERT INTO users (
        username_normalized, password_hash, nickname, avatar_id, jiu_coin_balance, created_at
      ) VALUES (?, '!', ?, 1, ?, ?)`
    )
    .run(name, name, balance, createdAt);
  const id = Number(info.lastInsertRowid);
  if (classics > 0) seedClassics(db, id, classics);
  return id;
}

function seedClassics(db, userId, n) {
  db.prepare(
    `INSERT OR IGNORE INTO datasets (version, file_path, sha256, stock_count)
     VALUES ('pvp-test-ds', 'test', 'abc', 1)`
  ).run();
  for (let i = 0; i < n; i++) {
    const id = `classic-${userId}-${i}-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO game_sessions (
        id, user_id, create_key, create_payload_hash, rule_version, dataset_version,
        fill_mode, stock_code, stock_name, stock_index, window_start, history_length,
        game_days, snapshot_json, snapshot_sha256, status, started_at, expires_at,
        finished_at, game_kind
      ) VALUES (
        ?, ?, ?, 'h', 'sim30-mtm-v1', 'pvp-test-ds',
        'next_open', '000001', '测试', 0, 30, 30,
        30, '{}', 'abc', 'settled', '2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z',
        '2026-10-01T00:00:00.000Z', 'classic'
      )`
    ).run(id, userId, id);
    db.prepare(
      `INSERT INTO game_results (
        game_id, submission_hash, actions_json, trades_json, return_ppm,
        equity_multiple_decimal, trade_count, validity
      ) VALUES (?, 's', '[]', '[]', 0, '1', 0, 'valid')`
    ).run(id);
  }
}

export function balanceOf(db, userId) {
  return db.prepare(`SELECT jiu_coin_balance AS b FROM users WHERE id = ?`).get(userId).b;
}

export function pvpLedger(db, matchId) {
  return db
    .prepare(
      `SELECT user_id, delta, reason FROM jiu_coin_ledger
       WHERE ref_type = 'pvp_match' AND ref_id = ? ORDER BY id`
    )
    .all(String(matchId));
}
