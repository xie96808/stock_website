-- F03 QA: migrate pre-F03 / legacy-batch classic games into 纯净 when never rewound.
-- After this, 总榜 = clean ∪ undo (no separate legacy population to advertise).
-- Do NOT touch rows with undo_count=1 (assist_class=undo).
PRAGMA foreign_keys = ON;

UPDATE game_sessions
SET assist_class = 'clean'
WHERE game_kind = 'classic'
  AND COALESCE(undo_count, 0) = 0
  AND (assist_class IS NULL OR assist_class = 'legacy');

UPDATE game_results
SET assist_class = 'clean'
WHERE (assist_class IS NULL OR assist_class = 'legacy')
  AND game_id IN (
    SELECT id FROM game_sessions
    WHERE game_kind = 'classic'
      AND COALESCE(undo_count, 0) = 0
  );
