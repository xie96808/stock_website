#!/usr/bin/env python3
"""Fetch unadjusted 1-minute tapes into data/intraday/intraday.jsonl.

Default (no --fetch) normalizes server/tests/fixtures/mini_intraday.jsonl
offline and checks the same rules the writer uses. East Money is imported
only inside a real --fetch. Ops should run --fetch after 16:30 Asia/Shanghai;
a session is kept only when its 15:00 bar is present. Existing rows are not
rewritten.
"""

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
BAR_COUNT = 241
CLOCK = "em241-v1"
TAPE_VERSION = 1
UNIVERSE_LIMIT = 200
MAX_ZERO_VOLUME_BARS = 5
AVG_FEN_TOLERANCE = 1
FIXTURE = os.path.join(ROOT, "server", "tests", "fixtures", "mini_intraday.jsonl")
DATASET = os.path.join(ROOT, "data", "stocks_data.json")
OUTPUT = os.path.join(ROOT, "data", "intraday", "intraday.jsonl")


def round_half_up(value):
    """Same half-away-from-zero rule as shared/engine.js roundHalfUp."""
    number = float(value)
    if not math.isfinite(number):
        return None
    if number >= 0:
        return int(math.floor(number + 0.5))
    return -int(math.floor(-number + 0.5))


def fen_from_yuan(yuan):
    fen = round_half_up(float(yuan) * 100)
    return fen


def push_clock(out, hour, minute, count):
    h = hour
    m = minute
    for _ in range(count):
        out.append(f"{h:02d}:{m:02d}")
        m += 1
        if m == 60:
            m = 0
            h += 1


def build_em241_times():
    out = ["09:30"]
    push_clock(out, 9, 31, 120)
    push_clock(out, 13, 1, 120)
    return out


EM241_TIMES = build_em241_times()
EM241_SET = set(EM241_TIMES)


def normalize_symbol(symbol):
    text = str(symbol or "").strip().lower()
    for prefix in ("sh", "sz", "bj"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    return text


def is_beijing_symbol(symbol):
    code = normalize_symbol(symbol)
    return code.startswith("4") or code.startswith("8")


def is_excluded_name(name):
    text = str(name or "").strip()
    return text.startswith("S*ST") or text.startswith("*ST") or text.startswith("ST") or ("退" in text)


def limit_pct_for_symbol(symbol):
    code = normalize_symbol(symbol)
    if code.startswith(("688", "689", "30")):
        return 20
    return 10


def limit_band_fen(prev_close_fen, limit_pct):
    return (
        round_half_up(prev_close_fen * (100 + limit_pct) / 100),
        round_half_up(prev_close_fen * (100 - limit_pct) / 100),
    )


def is_limit_locked_open(prev_close_fen, limit_pct, open_close_fen):
    up, down = limit_band_fen(prev_close_fen, limit_pct)
    return open_close_fen >= up or open_close_fen <= down


def select_universe(stocks, limit=UNIVERSE_LIMIT):
    head = []
    for stock in stocks:
        kline = stock.get("kline") if isinstance(stock, dict) else None
        if not isinstance(kline, list) or len(kline) == 0:
            continue
        head.append(stock)
        if len(head) >= limit:
            break
    picked = []
    for stock in head:
        code = stock.get("code", stock.get("symbol"))
        if is_excluded_name(stock.get("name")) or is_beijing_symbol(code):
            continue
        picked.append(stock)
    return picked


def clock_hm(value):
    text = str(value or "").strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[1]
    elif " " in text:
        text = text.split(" ", 1)[1]
    hm = text[:5]
    if len(hm) == 5 and hm[2] == ":" and hm[:2].isdigit() and hm[3:5].isdigit():
        return hm
    return None


def session_date_of(value):
    text = str(value or "").strip()
    if "T" in text:
        day = text.split("T", 1)[0]
    elif " " in text:
        day = text.split(" ", 1)[0]
    else:
        day = text[:10]
    if len(day) == 10 and day[4] == "-" and day[7] == "-":
        return day
    return None


def align_em241(rows):
    """Exact timetable. Missing or extra minutes fail; bars are not filled in."""
    by_time = {}
    for row in rows:
        raw = row.get("time", row.get("timestamp")) if isinstance(row, dict) else row
        hm = clock_hm(raw)
        if hm is None or hm not in EM241_SET or hm in by_time:
            return None
        by_time[hm] = row
    if len(by_time) != BAR_COUNT:
        return None
    return [by_time[hm] for hm in EM241_TIMES]


def as_int(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or not number.is_integer():
        return None
    return int(number)


def fail(reason, index=None):
    out = {"ok": False, "reason": reason}
    if index is not None:
        out["index"] = index
    return out


def check_cumulative_average(bars):
    cum_lot = 0
    cum_amount = 0
    zero_count = 0
    for i, bar in enumerate(bars):
        if bar["volumeLot"] == 0:
            zero_count += 1
            if bar["amountFen"] != 0:
                return fail("zero_volume_amount", i)
            if i > 0 and bar["avgFen"] != bars[i - 1]["avgFen"]:
                return fail("avg_mismatch", i)
            continue
        cum_lot += bar["volumeLot"]
        cum_amount += bar["amountFen"]
        if not cum_lot > 0:
            return fail("avg_mismatch", i)
        vwap = round_half_up(cum_amount / (cum_lot * 100))
        if abs(vwap - bar["avgFen"]) > AVG_FEN_TOLERANCE:
            return fail("avg_mismatch", i)
    if zero_count == len(bars) and bars:
        return fail("suspended")
    if zero_count > MAX_ZERO_VOLUME_BARS:
        return fail("too_many_zero_volume")
    return {"ok": True, "reason": None, "zeroCount": zero_count}


def decode_bar(bar):
    if isinstance(bar, (list, tuple)):
        if len(bar) != 4:
            return None
        return {
            "closeFen": bar[0],
            "volumeLot": bar[1],
            "amountFen": bar[2],
            "avgFen": bar[3],
        }
    if isinstance(bar, dict):
        return {
            "closeFen": bar.get("closeFen"),
            "volumeLot": bar.get("volumeLot"),
            "amountFen": bar.get("amountFen"),
            "avgFen": bar.get("avgFen"),
        }
    return None


def canonical_obj(symbol, name, session_date, prev_close_fen, limit_pct, bars):
    tuples = [
        [bar["closeFen"], bar["volumeLot"], bar["amountFen"], bar["avgFen"]]
        for bar in bars
    ]
    return {
        "v": TAPE_VERSION,
        "symbol": symbol,
        "name": name,
        "sessionDate": session_date,
        "prevCloseFen": prev_close_fen,
        "limitPct": limit_pct,
        "barCount": BAR_COUNT,
        "clock": CLOCK,
        "bars": tuples,
    }


def canonical_json(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def tape_sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_tape(row):
    if not isinstance(row, dict):
        return fail("bad_shape")
    if row.get("v") != TAPE_VERSION:
        return fail("bad_version")
    symbol = normalize_symbol(row.get("symbol"))
    if len(symbol) != 6 or not symbol.isdigit():
        return fail("bad_symbol")
    if is_beijing_symbol(symbol):
        return fail("beijing")
    name = row.get("name")
    if not isinstance(name, str) or not name:
        return fail("bad_shape")
    if is_excluded_name(name):
        return fail("excluded_name")
    session_date = row.get("sessionDate")
    if not isinstance(session_date, str) or session_date_of(session_date) != session_date:
        return fail("bad_session_date")
    if row.get("clock") != CLOCK:
        return fail("clock")
    if row.get("barCount") != BAR_COUNT:
        return fail("bar_count")
    raw_bars = row.get("bars")
    if not isinstance(raw_bars, list) or len(raw_bars) != BAR_COUNT:
        return fail("bar_count")
    limit_pct = limit_pct_for_symbol(symbol)
    if row.get("limitPct") != limit_pct:
        return fail("bad_limit_pct")
    prev_close = as_int(row.get("prevCloseFen"))
    if prev_close is None or prev_close <= 0:
        return fail("non_positive_price")

    decoded = []
    for i, raw in enumerate(raw_bars):
        bar = decode_bar(raw)
        if bar is None:
            return fail("bad_shape", i)
        close_fen = as_int(bar["closeFen"])
        avg_fen = as_int(bar["avgFen"])
        amount_fen = as_int(bar["amountFen"])
        volume = as_int(bar["volumeLot"])
        if close_fen is None or avg_fen is None or amount_fen is None:
            return fail("non_integer_fen", i)
        if volume is None or volume < 0:
            return fail("non_integer_volume", i)
        if close_fen <= 0 or avg_fen <= 0 or amount_fen < 0:
            return fail("non_positive_price", i)
        decoded.append({
            "closeFen": close_fen,
            "volumeLot": volume,
            "amountFen": amount_fen,
            "avgFen": avg_fen,
        })

    avg = check_cumulative_average(decoded)
    if not avg["ok"]:
        return avg
    if is_limit_locked_open(prev_close, limit_pct, decoded[0]["closeFen"]):
        return fail("limit_locked_open", 0)

    canonical = canonical_obj(symbol, name, session_date, prev_close, limit_pct, decoded)
    text = canonical_json(canonical)
    return {
        "ok": True,
        "reason": None,
        "canonical": canonical,
        "canonicalJson": text,
        "sha256": tape_sha256(text),
        "bars": decoded,
    }


def bars_from_minutes(minutes):
    """minutes: aligned rows with close/avg/amount in yuan and volume in lots."""
    ordered = align_em241(minutes)
    if ordered is None:
        return fail("timestamp_mismatch")
    decoded = []
    for i, row in enumerate(ordered):
        volume = as_int(row.get("volume"))
        if volume is None or volume < 0:
            return fail("non_integer_volume", i)
        close_fen = fen_from_yuan(row.get("close"))
        avg_fen = fen_from_yuan(row.get("avg"))
        amount_fen = fen_from_yuan(row.get("amount"))
        if close_fen is None or avg_fen is None or amount_fen is None:
            return fail("non_integer_fen", i)
        decoded.append({
            "closeFen": close_fen,
            "volumeLot": volume,
            "amountFen": amount_fen,
            "avgFen": avg_fen,
        })
    return {"ok": True, "bars": decoded}


def normalize_session(symbol, name, session_date, prev_close_yuan, minutes):
    built = bars_from_minutes(minutes)
    if not built["ok"]:
        return built
    prev = fen_from_yuan(prev_close_yuan)
    if prev is None or prev <= 0:
        return fail("non_positive_price")
    row = canonical_obj(
        normalize_symbol(symbol),
        name,
        session_date,
        prev,
        limit_pct_for_symbol(symbol),
        built["bars"],
    )
    return validate_tape(row)


def iter_jsonl(path):
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            text = line.rstrip("\r\n")
            if text:
                yield text


def synthetic_minutes(close_yuan=38.52, zero_at=(), bad_volume_at=None):
    rows = []
    for i, hm in enumerate(EM241_TIMES):
        volume = 0 if i in zero_at else 100 + (i % 3) * 10
        amount = 0 if volume == 0 else close_yuan * volume * 100
        avg = rows[-1]["avg"] if volume == 0 and i > 0 else close_yuan
        if bad_volume_at == i:
            volume = 10.5
        rows.append({
            "time": f"2026-09-24 {hm}:00",
            "close": close_yuan,
            "volume": volume,
            "amount": amount,
            "avg": avg,
        })
    return rows


def reopen_with_avg_delta(result, index, delta_fen):
    bars = [dict(bar) for bar in result["bars"]]
    bars[index]["avgFen"] += delta_fen
    row = canonical_obj(
        result["canonical"]["symbol"],
        result["canonical"]["name"],
        result["canonical"]["sessionDate"],
        result["canonical"]["prevCloseFen"],
        result["canonical"]["limitPct"],
        bars,
    )
    return validate_tape(row)


def self_test_rules():
    assert len(EM241_TIMES) == 241
    assert EM241_TIMES[0] == "09:30" and EM241_TIMES[-1] == "15:00"
    assert "09:15" not in EM241_SET and "13:00" not in EM241_SET
    if limit_pct_for_symbol("302132") != 20:
        raise SystemExit("ChiNext 302 must be a 20% band")
    # 112.00 on a 100.00 prev close is +12%: outside 10%, inside 20%.
    chinext = normalize_session("302132", "中航成飞", "2026-09-24", 100.00, synthetic_minutes(112.00))
    if not chinext["ok"] or chinext["canonical"]["limitPct"] != 20 or chinext["bars"][0]["closeFen"] != 11200:
        raise SystemExit(f"302132 open between 10% and 20% must validate: {chinext.get('reason')}")
    if not is_limit_locked_open(10000, 10, 11200):
        raise SystemExit("12% open should be locked on a 10% band")

    base = normalize_session("600036", "招商银行", "2026-09-24", 38.50, synthetic_minutes())
    if not base["ok"]:
        raise SystemExit(f"synthetic tape rejected: {base['reason']}")
    if base["bars"][0]["closeFen"] != 3852:
        raise SystemExit("fen conversion drifted")

    high = normalize_session("600519", "贵州茅台", "2026-09-24", 1480.00, synthetic_minutes(1488.00))
    if not high["ok"] or high["bars"][0]["closeFen"] <= 32767:
        raise SystemExit("high closeFen was not preserved")

    # |vwap - avg| == 1 stays; a wider gap is the discard.
    off_one = reopen_with_avg_delta(base, 10, 1)
    if not off_one["ok"]:
        raise SystemExit("1 fen average gap should stay inside the tolerance")
    off_two = reopen_with_avg_delta(base, 10, 2)
    if off_two.get("reason") != "avg_mismatch":
        raise SystemExit("average more than 1 fen off was not discarded")

    missing = synthetic_minutes()
    missing = [row for row in missing if "10:15" not in row["time"]]
    missed = normalize_session("600036", "招商银行", "2026-09-24", 38.50, missing)
    if missed.get("reason") != "timestamp_mismatch" or missed.get("bars"):
        raise SystemExit("missing stamp was synthesized or accepted")

    fractional = normalize_session(
        "600036", "招商银行", "2026-09-24", 38.50, synthetic_minutes(bad_volume_at=3)
    )
    if fractional.get("reason") != "non_integer_volume":
        raise SystemExit("fractional lot was kept")

    locked = synthetic_minutes(close_yuan=42.35)
    locked_row = normalize_session("600036", "招商银行", "2026-09-24", 38.50, locked)
    if locked_row.get("reason") != "limit_locked_open":
        raise SystemExit("limit-locked open was kept")

    zeros = normalize_session(
        "600036", "招商银行", "2026-09-24", 38.50, synthetic_minutes(zero_at=set(range(6)))
    )
    if zeros.get("reason") != "too_many_zero_volume":
        raise SystemExit("too many zero-volume bars were kept")
    leading = normalize_session(
        "600036", "招商银行", "2026-09-24", 38.50, synthetic_minutes(zero_at={0, 1})
    )
    if not leading["ok"]:
        raise SystemExit(f"leading zero volume should not divide: {leading['reason']}")


def self_test_fixture(path):
    if not os.path.isfile(path):
        raise SystemExit(f"fixture missing: {path}")
    lines = list(iter_jsonl(path))
    if len(lines) != 2:
        raise SystemExit(f"fixture must be 2 jsonl rows, got {len(lines)}")
    saw_high = False
    payload = []
    for line in lines:
        row = json.loads(line)
        result = validate_tape(row)
        if not result["ok"]:
            raise SystemExit(f"fixture rejected: {result['reason']}")
        if result["canonicalJson"] != line:
            raise SystemExit("fixture line is not canonical")
        if result["sha256"] != tape_sha256(line):
            raise SystemExit("sha256 drifted")
        if any(bar["closeFen"] > 32767 for bar in result["bars"]):
            saw_high = True
        payload.append(line)
    if not saw_high:
        raise SystemExit("fixture has no closeFen above 32767")
    script = (
        "import { validateTape } from './shared/intradayTape.js';"
        "const chunks = [];"
        "for await (const chunk of process.stdin) chunks.push(chunk);"
        "const text = Buffer.concat(chunks).toString('utf8');"
        "for (const line of text.split(/\\n/)) {"
        "  if (!line) continue;"
        "  const result = validateTape(JSON.parse(line));"
        "  if (!result.ok || result.canonicalJson !== line) {"
        "    console.error(result.reason || 'canonical');"
        "    process.exit(1);"
        "  }"
        "}"
        "process.stdout.write('ok');"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=("\n".join(payload) + "\n").encode("utf-8"),
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise SystemExit(f"node rejected fixture: {err or proc.returncode}")
    self_test_rules()
    print(f"self-test ok ({len(lines)} sessions, no network)")
    return 0


def to_sina_symbol(code):
    if code.startswith(("6", "9")):
        return f"sh{code}"
    if code.startswith(("0", "2", "3")):
        return f"sz{code}"
    if code.startswith(("4", "8")):
        return f"bj{code}"
    return f"sz{code}"


def call_with_retry(fn, attempts=3):
    last = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except Exception as exc:  # network / parser failures retry
            last = exc
            time.sleep(0.8 * attempt)
    raise last


def load_universe(path):
    with open(path, encoding="utf-8") as handle:
        stocks = json.load(handle)
    picked = []
    for stock in select_universe(stocks):
        code = normalize_symbol(stock.get("code", stock.get("symbol")))
        name = stock.get("name") or code
        if len(code) != 6:
            continue
        picked.append({"code": code, "name": name})
    return picked


def load_minutes(symbol):
    # Imported only for a real fetch so the fixture self-test stays offline.
    import akshare as ak

    frame = ak.stock_zh_a_hist_min_em(symbol=symbol, period="1", adjust="")
    if frame is None or len(frame) == 0:
        return []
    columns = set(frame.columns)
    avg_col = "均价" if "均价" in columns else "最新价" if "最新价" in columns else None
    if avg_col is None or "收盘" not in columns or "成交量" not in columns or "成交额" not in columns:
        raise RuntimeError(f"unexpected minute columns: {sorted(columns)}")
    rows = []
    for _, item in frame.iterrows():
        rows.append({
            "time": item["时间"],
            "close": float(item["收盘"]),
            "volume": item["成交量"],
            "amount": float(item["成交额"]),
            "avg": float(item[avg_col]),
        })
    return rows


def load_unadjusted_closes(symbol):
    import akshare as ak

    frame = ak.stock_zh_a_daily(symbol=to_sina_symbol(symbol), adjust="")
    if frame is None or len(frame) == 0:
        raise RuntimeError("no unadjusted daily bars")
    date_col = "date" if "date" in frame.columns else "日期"
    close_col = "close" if "close" in frame.columns else "收盘"
    closes = []
    for _, item in frame.iterrows():
        day = session_date_of(item[date_col])
        if day is None:
            continue
        closes.append((day, float(item[close_col])))
    closes.sort()
    return closes


def prev_close_yuan(closes, session_date):
    prev = None
    for day, close in closes:
        if day < session_date:
            prev = close
        else:
            break
    return prev


def existing_keys(path):
    keys = set()
    if not os.path.exists(path):
        return keys
    for line in iter_jsonl(path):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        keys.add((row.get("symbol"), row.get("sessionDate")))
    return keys


def bump(counts, reason):
    counts[reason] = counts.get(reason, 0) + 1


def fetch_symbol(stock, seen, out_handle):
    code = stock["code"]
    name = stock["name"]
    counts = {}
    kept = 0
    minutes = call_with_retry(lambda: load_minutes(code))
    closes = call_with_retry(lambda: load_unadjusted_closes(code))
    by_date = {}
    order = []
    for row in minutes:
        day = session_date_of(row["time"])
        if day is None:
            bump(counts, "timestamp_mismatch")
            continue
        if day not in by_date:
            by_date[day] = []
            order.append(day)
        by_date[day].append(row)
    for day in order:
        key = (code, day)
        if key in seen:
            bump(counts, "already_stored")
            continue
        prev = prev_close_yuan(closes, day)
        if prev is None or prev <= 0:
            bump(counts, "prev_close_unavailable")
            continue
        result = normalize_session(code, name, day, prev, by_date[day])
        if not result["ok"]:
            bump(counts, result["reason"])
            continue
        out_handle.write(result["canonicalJson"] + "\n")
        out_handle.flush()
        seen.add(key)
        kept += 1
    discarded = sum(value for key, value in counts.items() if key != "already_stored")
    detail = " ".join(f"{key}={value}" for key, value in sorted(counts.items()))
    print(f"  {code} {name}: keep={kept} discard={discarded} {detail}".rstrip())
    return kept


def fetch_main(dataset, output):
    if not os.path.isfile(dataset):
        raise SystemExit(f"dataset missing: {dataset}")
    universe = load_universe(dataset)
    if not universe:
        raise SystemExit("universe is empty")
    os.makedirs(os.path.dirname(output), exist_ok=True)
    seen = existing_keys(output)
    failures = 0
    kept = 0
    print(f"universe {len(universe)} -> {output}")
    with open(output, "a", encoding="utf-8", newline="\n") as handle:
        for index, stock in enumerate(universe, start=1):
            print(f"[{index}/{len(universe)}]")
            try:
                kept += fetch_symbol(stock, seen, handle)
            except Exception as exc:
                failures += 1
                print(f"  {stock['code']} {stock['name']}: 接口失败 {exc}")
            time.sleep(0.3)
    print(f"appended {kept} sessions, interface_failures={failures}")
    return 1 if failures else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="minute tape fetch or offline fixture self-test")
    parser.add_argument("--fetch", action="store_true", help="pull unadjusted minute bars (needs network)")
    parser.add_argument("--fixture", default=FIXTURE)
    parser.add_argument("--dataset", default=DATASET)
    parser.add_argument("--output", default=OUTPUT)
    args = parser.parse_args(argv)
    if not args.fetch:
        return self_test_fixture(args.fixture)
    return fetch_main(args.dataset, args.output)


if __name__ == "__main__":
    sys.exit(main())
