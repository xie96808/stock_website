-- 韭币局 games now count on the 龙虎榜 (the classic board). A stake game plays the classic rules with no rewind, so it
-- is a 纯净 game: backfill the assist class that older stake rows never got (they were stored as 'legacy', which the
-- board's default 纯净 filter skips). Historical stake games therefore join the board retroactively.
UPDATE game_sessions
SET assist_class = 'clean'
WHERE game_kind = 'stake'
  AND COALESCE(undo_count, 0) = 0
  AND (assist_class IS NULL OR assist_class = 'legacy');

UPDATE game_results
SET assist_class = 'clean'
WHERE (assist_class IS NULL OR assist_class = 'legacy')
  AND game_id IN (SELECT id FROM game_sessions WHERE game_kind = 'stake');
