/**
 * Event-protocol constants (B0). Shared so server and (later) client agree on names.
 * Feature flag EVENT_PROTOCOL_ENABLED / protocolEventV1Enabled defaults OFF —
 * see docs/event-protocol-b0-pr1.md.
 */

export const PROTOCOL_LEGACY_BATCH = 'legacy-batch';
export const PROTOCOL_EVENT_V1 = 'event-v1';
export const PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_LEGACY_BATCH, PROTOCOL_EVENT_V1]);

export const GAME_KIND_CLASSIC = 'classic';
export const GAME_KIND_DAILY = 'daily';
export const GAME_KIND_ARCHIVE_PRACTICE = 'archive_practice';
export const GAME_KIND_PUZZLE = 'puzzle';
export const GAME_KINDS = Object.freeze([
  GAME_KIND_CLASSIC,
  GAME_KIND_DAILY,
  GAME_KIND_ARCHIVE_PRACTICE,
  GAME_KIND_PUZZLE,
]);

export const ASSIST_LEGACY = 'legacy';
export const ASSIST_CLEAN = 'clean';
export const ASSIST_UNDO = 'undo';
/** Query-only board filter: classic clean ∪ undo (总榜). Not stored on rows. */
export const ASSIST_ALL = 'all';
export const ASSIST_CLASSES = Object.freeze([ASSIST_LEGACY, ASSIST_CLEAN, ASSIST_UNDO]);

export const DECISION_ACTIONS = Object.freeze(['buy', 'sell', 'hold']);

export const GAME_KIND_SET = new Set(GAME_KINDS);
export const PROTOCOL_SET = new Set(PROTOCOL_VERSIONS);
export const ASSIST_SET = new Set(ASSIST_CLASSES);
/** Leaderboard / me/stats query values when GAME_REWIND on. */
export const ASSIST_QUERY_SET = new Set([...ASSIST_CLASSES, ASSIST_ALL]);
export const DECISION_ACTION_SET = new Set(DECISION_ACTIONS);

/** Settle metrics schema version written on event-v1 results (B0-PR2). */
export const SCORE_VERSION_CURVE_V1 = 'sim30-mtm-curve-v1';
