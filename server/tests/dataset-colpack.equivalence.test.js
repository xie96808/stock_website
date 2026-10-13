/**
 * P1: the binary colpack must load a pack identical to the JSON path —
 * same datasetVersion, same columnar arrays, same dates, same seeded picks.
 * Runs on the mini fixture always, and on the full repo dataset when present.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prepareTestEnv, FIXTURE_DATASET } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FULL_DATASET = path.resolve(__dirname, "../../data/stocks_data.json");
prepareTestEnv();
const { migrate } = await import("../src/db/migrate.js");
migrate();
const ds = await import("../src/lib/dataset.js");
const { buildColpackFromJson, decodeColpack, encodeColpack, COLPACK_SUFFIX } = await import("../src/lib/colpack.js");

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function load(jsonPath, colpack) {
  process.env.STOCKGAME_DATASET_PATH = jsonPath;
  process.env.STOCKGAME_DATASET_COLPACK = colpack ? "1" : "0";
  ds.resetDatasetCache();
  const { pack, version } = ds.ensureDatasetLoaded();
  const rng = mulberry32(20261013);
  const picks = [];
  for (let i = 0; i < 300; i++) picks.push(JSON.stringify(ds.pickRandomWindow({ rng })));
  return { pack, version, source: ds.getDatasetLoadSource(), picks, meta: ds.getDatasetMeta() };
}

function assertSamePack(a, b) {
  assert.equal(a.version, b.version, "datasetVersion");
  assert.equal(a.pack.length, b.pack.length, "stock count");
  for (let si = 0; si < a.pack.length; si++) {
    const x = a.pack[si], y = b.pack[si];
    for (const k of ["code", "name", "py", "jp", "n"]) assert.equal(y[k], x[k], `stock ${si} ${k}`);
    for (const k of ["dates", "open", "high", "low", "close", "volume"]) {
      assert.equal(y[k].constructor, x[k].constructor, `stock ${si} ${k} type`);
      assert.ok(Buffer.from(x[k].buffer, x[k].byteOffset, x[k].byteLength).equals(Buffer.from(y[k].buffer, y[k].byteOffset, y[k].byteLength)), `stock ${si} ${k} bytes`);
    }
  }
  assert.deepEqual(b.picks, a.picks, "seeded pickRandomWindow sequence");
  assert.equal(b.meta.stockCount, a.meta.stockCount);
}

function withCopy(src, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "colpack-"));
  const json = path.join(dir, "stocks_data.json");
  fs.copyFileSync(src, json);
  try { return fn(json); } finally { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.STOCKGAME_DATASET_COLPACK; ds.resetDatasetCache(); process.env.STOCKGAME_DATASET_PATH = FIXTURE_DATASET; }
}

test("colpack encode/decode round-trips the fixture", () => {
  const buf = buildColpackFromJson(FIXTURE_DATASET);
  const d = decodeColpack(buf);
  const again = encodeColpack(d, { sourceSha256: d.sourceSha256, sourceBytes: d.sourceBytes });
  assert.ok(again.equals(buf), "re-encode is byte-identical");
  assert.throws(() => decodeColpack(buf.subarray(0, buf.length - 8)), /size mismatch/);
  assert.throws(() => decodeColpack(Buffer.from("nope nope nope")), /not a colpack/);
});

test("fixture: colpack load === JSON load (version, arrays, dates, seeded picks)", () => {
  withCopy(FIXTURE_DATASET, (json) => {
    fs.writeFileSync(json + COLPACK_SUFFIX, buildColpackFromJson(json));
    const viaJson = load(json, false);
    const viaCol = load(json, true);
    assert.equal(viaJson.source, "json");
    assert.equal(viaCol.source, "colpack");
    assertSamePack(viaJson, viaCol);
    // getBar dates / values identical
    for (let si = 0; si < viaJson.pack.length; si++) {
      ds.resetDatasetCache(); process.env.STOCKGAME_DATASET_COLPACK = "1"; ds.ensureDatasetLoaded();
      const a = JSON.stringify(ds.sliceBars(ds.ensureDatasetLoaded().pack[si], 0, 1e9));
      ds.resetDatasetCache(); process.env.STOCKGAME_DATASET_COLPACK = "0"; ds.ensureDatasetLoaded();
      const b = JSON.stringify(ds.sliceBars(ds.ensureDatasetLoaded().pack[si], 0, 1e9));
      assert.equal(a, b, `bars JSON stock ${si}`);
    }
  });
});

test("stale colpack (JSON changed) is ignored → JSON path", () => {
  withCopy(FIXTURE_DATASET, (json) => {
    fs.writeFileSync(json + COLPACK_SUFFIX, buildColpackFromJson(json));
    fs.appendFileSync(json, " "); // whitespace: same data, different bytes/sha
    const r = load(json, true);
    assert.equal(r.source, "json");
  });
  withCopy(FIXTURE_DATASET, (json) => {
    fs.writeFileSync(json + COLPACK_SUFFIX, "garbage");
    assert.equal(load(json, true).source, "json");
  });
});

test("full dataset (if present): colpack === JSON", { skip: !fs.existsSync(FULL_DATASET) }, () => {
  withCopy(FULL_DATASET, (json) => {
    fs.writeFileSync(json + COLPACK_SUFFIX, buildColpackFromJson(json));
    const viaJson = load(json, false);
    const viaCol = load(json, true);
    assert.equal(viaCol.source, "colpack");
    assertSamePack(viaJson, viaCol);
    let total = 0; for (const s of viaJson.pack) total += s.n;
    assert.ok(total > 600000, `bars ${total}`);
  });
});
