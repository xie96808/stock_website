import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatShanghaiDateTime, parseUtcishDate } from "../js/time.js";

describe("parseUtcishDate", () => {
  it("parses ISO with Z as UTC", () => {
    const d = parseUtcishDate("2026-09-12T04:00:00.000Z");
    assert.ok(d);
    assert.equal(d.toISOString(), "2026-09-12T04:00:00.000Z");
  });

  it("parses sqlite naive datetime as UTC", () => {
    const d = parseUtcishDate("2026-09-12 04:00:00");
    assert.ok(d);
    assert.equal(d.toISOString(), "2026-09-12T04:00:00.000Z");
  });

  it("parses ISO without zone as UTC", () => {
    const d = parseUtcishDate("2026-09-12T04:00:00");
    assert.ok(d);
    assert.equal(d.toISOString(), "2026-09-12T04:00:00.000Z");
  });

  it("respects explicit offset", () => {
    const d = parseUtcishDate("2026-09-12T12:00:00+08:00");
    assert.ok(d);
    assert.equal(d.toISOString(), "2026-09-12T04:00:00.000Z");
  });

  it("returns null for empty", () => {
    assert.equal(parseUtcishDate(""), null);
    assert.equal(parseUtcishDate(null), null);
  });
});

describe("formatShanghaiDateTime", () => {
  it("formats UTC midnight into Shanghai calendar day", () => {
    // 2026-09-12 04:00 UTC = 12:00 Asia/Shanghai
    const s = formatShanghaiDateTime("2026-09-12T04:00:00.000Z");
    assert.match(s, /2026/);
    assert.match(s, /09/);
    assert.match(s, /12/);
    assert.match(s, /12:00:00/);
  });

  it("formats sqlite naive the same as Zulu", () => {
    const a = formatShanghaiDateTime("2026-09-12 04:00:00");
    const b = formatShanghaiDateTime("2026-09-12T04:00:00Z");
    assert.equal(a, b);
  });

  it("returns empty string for empty input", () => {
    assert.equal(formatShanghaiDateTime(""), "");
    assert.equal(formatShanghaiDateTime(null), "");
  });
});
