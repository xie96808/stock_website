/** Pure helpers: explain whether a finished game is on a leaderboard (no DOM, no fetch). */

export const RECENT_STATUS_TEXT = {
  counted: '已计入榜单',
  no_trade: '无买入 · 不计榜',
  other_assist_board: '在另一分类榜（反悔榜）',
  not_opted_in: '未列入排行榜',
  other_version: '旧规则/行情 · 不计当前榜',
  hidden: '已被隐藏',
  invalid: '无效局',
};

export function boardLabel(fillMode, assistClass, gameKind) {
  const fill = fillMode === 'same_close' ? '当日收盘' : '次日开盘';
  if (gameKind === 'oneshot') return `一把梭·${fill}`;
  if (gameKind === 'survival') return `活过三十日·${fill}`;
  const a = assistClass === 'undo' ? '·反悔' : '';
  return `${fill}${a}`;
}

/**
 * One-line verdict for the result screen.
 * @param {{status:string,isBest:boolean}|null} game  this game's myRecent entry (null = not found)
 * @param {{rank:number|null,total:number,fillMode:string,assistClass?:string,gameKind?:string}} board
 */
export function resultVerdict(game, board) {
  if (!game) return null;
  const label = boardLabel(board.fillMode, game.assistClass || board.assistClass, board.gameKind);
  if (game.status === 'counted') {
    const total = Number(board.total || 0);
    const rank = board.rank;
    const beat = rank != null && total >= 2
      ? Math.max(0, Math.min(99, Math.round(((total - rank) / total) * 100)))
      : null;
    if (game.isBest) {
      return {
        kind: 'best',
        beat,
        text: rank != null
          ? `本局已入${label}榜 · #${rank}` + (beat != null ? ` · 超越约 ${beat}% 玩家` : '')
          : `本局已入${label}榜`,
      };
    }
    return {
      kind: 'recorded',
      beat,
      text: `本局已记录 · 未超过你的最佳成绩${rank != null ? `（${label}榜当前 #${rank}）` : ''}`,
    };
  }
  if (game.status === 'no_trade') {
    return { kind: 'no_trade', beat: null, text: '本局全程观望（0 笔买入），不计入排行榜；至少买入一次才会上榜' };
  }
  if (game.status === 'other_assist_board') {
    return { kind: 'other', beat: null, text: '本局使用了反悔，已计入「反悔」分类榜（排行榜页切换「反悔/总榜」查看）' };
  }
  if (game.status === 'not_opted_in') {
    return { kind: 'optout', beat: null, text: '你已选择不参与排行榜，本局未上榜（资料设置里可重新开启）' };
  }
  return { kind: 'other', beat: null, text: RECENT_STATUS_TEXT[game.status] || '本局未计入榜单' };
}
