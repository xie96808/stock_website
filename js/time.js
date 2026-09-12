/**
 * Player-facing datetime formatting in Asia/Shanghai.
 * Server/DB still store UTC (ISO or sqlite datetime('now') naive UTC).
 */

const SHANGHAI = "Asia/Shanghai";

const FMT_OPTS = {
  timeZone: SHANGHAI,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

/** True if string already carries an explicit timezone (Z or ±offset). */
function hasExplicitZone(s) {
  return /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
}

/**
 * Parse ISO (`…Z` / with offset) or sqlite `YYYY-MM-DD HH:MM:SS`.
 * Naive values (no zone) are treated as UTC — same intent as announcements'
 * previous `… + "Z"` path for server datetime('now').
 * @param {string|Date|null|undefined} input
 * @returns {Date|null}
 */
export function parseUtcishDate(input) {
  if (input == null || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const s = String(input).trim();
  if (!s) return null;

  let iso = s;
  if (!hasExplicitZone(s)) {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
      iso = s.replace(" ", "T");
      if (!iso.endsWith("Z")) iso += "Z";
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      iso = s + "T00:00:00Z";
    }
  }

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a UTC-ish timestamp for display in Asia/Shanghai (zh-CN).
 * Returns "" for empty/invalid input.
 * @param {string|Date|null|undefined} input
 * @returns {string}
 */
export function formatShanghaiDateTime(input) {
  if (input == null || input === "") return "";
  const d = parseUtcishDate(input);
  if (!d) return String(input);
  try {
    return d.toLocaleString("zh-CN", FMT_OPTS);
  } catch {
    return String(input);
  }
}
