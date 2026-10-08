/**
 * Equivalence / regression for columnar dataset pack (perf/api-memory).
 * - Always: mini fixture columnar accessors + deterministic pick with seeded RNG.
 * - When repo data/stocks_data.json is present: full-pack bar JSON identity vs raw
 *   file, datasetVersion, and golden pickRandomWindow results (pre-change baseline).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareTestEnv, startTestServer, FIXTURE_DATASET } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const FULL_DATASET = path.join(repoRoot, "data", "stocks_data.json");
const GOLDEN = path.join(__dirname, "fixtures", "dataset-columnar-golden.json");

prepareTestEnv();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("columnar pack: mini fixture accessors + seeded pick stability", async () => {
  const { stop } = await startTestServer();
  try {
    const {
      ensureDatasetLoaded,
      resetDatasetCache,
      pickRandomWindow,
      getBar,
      sliceBars,
      getKlineLength,
    } = await import("../src/lib/dataset.js");
    resetDatasetCache();
    const { pack, version } = ensureDatasetLoaded();
    assert.ok(pack.length >= 1);
    assert.equal(typeof version, "string");
    assert.equal(version.length, 64);

    const raw = JSON.parse(fs.readFileSync(FIXTURE_DATASET, "utf8"));
    assert.equal(pack.length, raw.length);
    for (let si = 0; si < raw.length; si++) {
      const stock = pack[si];
      const kline = raw[si].kline;
      assert.equal(getKlineLength(stock), kline.length);
      assert.equal(stock.code, raw[si].code);
      for (let i = 0; i < kline.length; i++) {
        const bar = getBar(stock, i);
        assert.equal(bar.date, kline[i].date);
        assert.equal(bar.open, kline[i].open);
        assert.equal(bar.high, kline[i].high);
        assert.equal(bar.low, kline[i].low);
        assert.equal(bar.close, kline[i].close);
        assert.equal(bar.volume, kline[i].volume);
      }
      const slice = sliceBars(stock, 2, 5);
      assert.equal(slice.length, 3);
      assert.equal(slice[0].date, kline[2].date);
    }

    // Same RNG sequence → identical picks (eligible precompute must not change RNG use)
    const a = pickRandomWindow({ rng: mulberry32(42) });
    const b = pickRandomWindow({ rng: mulberry32(42) });
    assert.equal(a.snapshotJson, b.snapshotJson);
    assert.equal(a.snapshotSha256, b.snapshotSha256);
    assert.equal(a.stockIndex, b.stockIndex);
    assert.equal(a.windowStartIndex, b.windowStartIndex);
  } finally {
    await stop();
  }
});

test("columnar pack: full dataset equivalence vs golden (when present)", async (t) => {
  if (!fs.existsSync(FULL_DATASET) || !fs.existsSync(GOLDEN)) {
    t.skip("full dataset or golden fixture not present");
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stockgame-col-eq-"));
  process.env.STOCKGAME_DATA_DIR = dataDir;
  process.env.STOCKGAME_DB_PATH = path.join(dataDir, "t.sqlite");
  process.env.STOCKGAME_DATASET_PATH = FULL_DATASET;

  const { closeDb } = await import("../src/db/connection.js");
  closeDb();
  const { migrate } = await import("../src/db/migrate.js");
  migrate();

  const {
    ensureDatasetLoaded,
    resetDatasetCache,
    pickRandomWindow,
    pickPuzzleWindow,
    sliceBars,
    getKlineLength,
  } = await import("../src/lib/dataset.js");
  const { buildGameWindowDto } = await import("../src/lib/gameWindowDto.js");

  resetDatasetCache();
  const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  const { pack, version } = ensureDatasetLoaded();

  const fileSha = crypto.createHash("sha256").update(fs.readFileSync(FULL_DATASET)).digest("hex");
  assert.equal(version, fileSha);
  assert.equal(version, golden.datasetVersion);

  const raw = JSON.parse(fs.readFileSync(FULL_DATASET, "utf8"));
  assert.equal(pack.length, raw.length);
  let barsChecked = 0;
  for (let si = 0; si < raw.length; si++) {
    const n = getKlineLength(pack[si]);
    assert.equal(n, raw[si].kline.length);
    const rebuilt = sliceBars(pack[si], 0, n);
    assert.equal(JSON.stringify(rebuilt), JSON.stringify(raw[si].kline));
    barsChecked += n;
  }
  assert.equal(barsChecked, 633266);

  let pickOk = 0;
  for (const row of golden.picks) {
    const [seed, stockIndex, windowStartIndex, historyLength, snapshotSha256] = row;
    const r = pickRandomWindow({ rng: mulberry32(seed) });
    assert.equal(r.stockIndex, stockIndex, `seed ${seed} stockIndex`);
    assert.equal(r.windowStartIndex, windowStartIndex, `seed ${seed} window`);
    assert.equal(r.historyLength, historyLength, `seed ${seed} historyLength`);
    assert.equal(r.snapshotSha256, snapshotSha256, `seed ${seed} snapshotSha`);
    pickOk++;
  }
  assert.equal(pickOk, golden.picks.length);

  const fixed = pickRandomWindow({ stockIndex: 0, windowStartIndex: 30, historyLength: 30 });
  assert.equal(fixed.snapshotSha256, golden.fixedSnapshotSha256);
  const dto = buildGameWindowDto(fixed.snapshot);
  assert.ok(dto && dto.bars.length === 30);

  const puzzle = pickPuzzleWindow({
    stockIndex: 0,
    windowStartIndex: 30,
    gameDays: 8,
    historyLength: 30,
  });
  assert.equal(puzzle.snapshotSha256, golden.puzzleSnapshotSha256);

  closeDb();
  resetDatasetCache();
  fs.rmSync(dataDir, { recursive: true, force: true });
  // Restore mini-fixture env for subsequent tests in this file.
  process.env.STOCKGAME_DATASET_PATH = FIXTURE_DATASET;
});

test("sqlite cache_size pragma is capped", async () => {
  const { stop } = await startTestServer();
  try {
    const { openDb } = await import("../src/db/connection.js");
    const db = openDb();
    assert.equal(db.pragma("cache_size", { simple: true }), -4000);
  } finally {
    await stop();
  }
});
