import { config } from "./config.js";
import { openDb } from "../db/connection.js";
import { isTitleId } from "./titleDefs.js";

export function titleShopEnabled() {
  return !!config.titleShopEnabled;
}

/** Same, when the row already carries its `title` column. */
export function titlePropFromRaw(raw) {
  return titleShopEnabled() && isTitleId(raw) ? { shopTitle: raw } : {};
}

/**
 * Spread into any public avatar DTO next to medalProp: `{ ...titleProp(row.user_id) }`.
 * Emits `{shopTitle}` only while the flag is on AND the player wears a title that still exists, so with the flag off (or no
 * title) every payload is byte-for-byte what it was before.
 */
export function titleProp(userId) {
  if (!titleShopEnabled() || !Number.isInteger(Number(userId))) return {};
  try {
    const raw = openDb().prepare(`SELECT title FROM users WHERE id = ?`).get(Number(userId))?.title;
    return isTitleId(raw) ? { shopTitle: raw } : {};
  } catch {
    return {};
  }
}
