/**
 * Columnar dataset pack ("colpack") — prebuilt binary twin of stocks_data.json.
 *
 * Why: JSON.parse of the 56 MB pack (two-byte string + object graph) peaks the
 * API at ~390 MB RSS on every boot. The colpack holds exactly the columnar arrays
 * the API builds from the JSON, so boot is one ~28 MB read + zero-copy views.
 *
 * Layout (little-endian):
 *   0   8  magic "SGCPACK1"
 *   8   4  uint32 header byte length H
 *   12  H  UTF-8 JSON header { v:1, sourceSha256, sourceBytes, totalBars, dateTable, stocks:[{code,name,py,jp,n}] }
 *   pad to 8
 *   Int32  dates[totalBars]   (indices into dateTable)
 *   pad to 8
 *   Float64 open[totalBars], high[], low[], close[], volume[]
 * Stocks are consecutive slices in pack order.
 *
 * No DB / server deps: used by deploy/emit-colpack.mjs too.
 */
import fs from "node:fs";
import crypto from "node:crypto";

const MAGIC = "SGCPACK1";
export const COLPACK_SUFFIX = ".colpack";

/**
 * Convert parsed JSON pack (array of {code,name,py,jp,kline:[{date,open,...}]})
 * into columnar stocks. Float64 for all numerics so JSON serialization of
 * emitted numbers stays identical to the object-pack era. Dates interned.
 * Nulls parsed[si] as it goes to cap peak memory.
 */
export function toColumnarPack(parsed) {
  const dateIndex = new Map();
  const dateTable = [];
  function internDate(d) {
    const key = String(d || "");
    let idx = dateIndex.get(key);
    if (idx !== undefined) return idx;
    idx = dateTable.length;
    dateTable.push(key);
    dateIndex.set(key, idx);
    return idx;
  }
  const pack = new Array(parsed.length);
  for (let si = 0; si < parsed.length; si++) {
    const s = parsed[si];
    const kline = Array.isArray(s?.kline) ? s.kline : [];
    const n = kline.length;
    const dates = new Int32Array(n);
    const open = new Float64Array(n);
    const high = new Float64Array(n);
    const low = new Float64Array(n);
    const close = new Float64Array(n);
    const volume = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = kline[i] || {};
      dates[i] = internDate(b.date);
      open[i] = Number(b.open);
      high[i] = Number(b.high);
      low[i] = Number(b.low);
      close[i] = Number(b.close);
      volume[i] = b.volume != null ? Number(b.volume) : 0;
    }
    pack[si] = { code: s.code, name: s.name, py: s.py, jp: s.jp, n, dates, open, high, low, close, volume };
    parsed[si] = null;
  }
  return { pack, dateTable };
}

/** sha256 of a file, streamed in 1 MB chunks (sync, low memory). */
export function sha256FileSync(filePath) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

const align8 = (n) => (n + 7) & ~7;

/** Serialize a columnar pack to a colpack Buffer. */
export function encodeColpack({ pack, dateTable }, { sourceSha256, sourceBytes }) {
  const totalBars = pack.reduce((a, s) => a + s.n, 0);
  const header = Buffer.from(JSON.stringify({
    v: 1, sourceSha256, sourceBytes, totalBars, dateTable,
    stocks: pack.map((s) => ({ code: s.code, name: s.name, py: s.py, jp: s.jp, n: s.n })),
  }), "utf8");
  const datesOff = align8(12 + header.length);
  const f64Off = align8(datesOff + totalBars * 4);
  const out = Buffer.alloc(f64Off + totalBars * 8 * 5);
  out.write(MAGIC, 0, "latin1");
  out.writeUInt32LE(header.length, 8);
  header.copy(out, 12);
  const dates = new Int32Array(out.buffer, out.byteOffset + datesOff, totalBars);
  const cols = ["open", "high", "low", "close", "volume"].map((k, ci) => [k, new Float64Array(out.buffer, out.byteOffset + f64Off + ci * totalBars * 8, totalBars)]);
  let o = 0;
  for (const s of pack) {
    dates.set(s.dates, o);
    for (const [k, arr] of cols) arr.set(s[k], o);
    o += s.n;
  }
  return out;
}

/**
 * Decode a colpack file into { pack, dateTable, sourceSha256, sourceBytes }.
 * Typed arrays are views over one ArrayBuffer (no per-stock copies).
 */
export function decodeColpack(buf) {
  if (buf.length < 12 || buf.toString("latin1", 0, 8) !== MAGIC) throw new Error("not a colpack");
  const hl = buf.readUInt32LE(8);
  const header = JSON.parse(buf.toString("utf8", 12, 12 + hl));
  if (header.v !== 1) throw new Error(`colpack version ${header.v} unsupported`);
  const total = header.totalBars;
  const datesOff = align8(12 + hl);
  const f64Off = align8(datesOff + total * 4);
  if (buf.length !== f64Off + total * 40) throw new Error("colpack size mismatch");
  // Own an 8-aligned ArrayBuffer (Buffer from readFileSync may be offset in a pool).
  const ab = buf.byteOffset % 8 === 0 ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const base = ab === buf.buffer ? buf.byteOffset : 0;
  const dates = new Int32Array(ab, base + datesOff, total);
  const col = (ci) => new Float64Array(ab, base + f64Off + ci * total * 8, total);
  const [open, high, low, close, volume] = [0, 1, 2, 3, 4].map(col);
  const pack = new Array(header.stocks.length);
  let o = 0;
  for (let si = 0; si < header.stocks.length; si++) {
    const m = header.stocks[si];
    const n = m.n;
    pack[si] = {
      code: m.code, name: m.name, py: m.py, jp: m.jp, n,
      dates: dates.subarray(o, o + n), open: open.subarray(o, o + n), high: high.subarray(o, o + n),
      low: low.subarray(o, o + n), close: close.subarray(o, o + n), volume: volume.subarray(o, o + n),
    };
    o += n;
  }
  if (o !== total) throw new Error("colpack bar count mismatch");
  return { pack, dateTable: header.dateTable, sourceSha256: header.sourceSha256, sourceBytes: header.sourceBytes };
}

/** Build colpack bytes from a stocks_data.json path (does the JSON parse once, offline). */
export function buildColpackFromJson(jsonPath) {
  let buf = fs.readFileSync(jsonPath);
  const sourceSha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const sourceBytes = buf.length;
  const parsed = JSON.parse(buf.toString("utf8"));
  buf = null;
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("dataset pack empty or invalid");
  return encodeColpack(toColumnarPack(parsed), { sourceSha256, sourceBytes });
}
