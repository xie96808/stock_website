/** 韭币榜 copy + formatting (no DOM). */
export const BOARD_TABS = Object.freeze([
  { id: 'balance', label: '当前余额榜' },
  { id: 'week', label: '本周净赚榜' },
]);

export function boardNote(board) {
  return board === 'week'
    ? '本周一 0 点（北京时间）起，对局与每日收入的净赚；充值、成就、系统发放和购买不计入。'
    : '全服韭币余额前 20。前三名头像会戴上金银铜牌。只统计真人且开启「参与排行榜」的玩家。';
}

export function formatBoardValue(board, value) {
  const n = Number(value) || 0;
  return board === 'week' ? `+${n}` : String(n);
}

/** One line under the list about the viewer's own standing. null = guest (nothing to say). */
export function meLine(board, me) {
  if (!me) return null;
  if (Number.isInteger(me.rank)) {
    return board === 'week'
      ? `你本周净赚 ${me.value}，排第 ${me.rank} 名`
      : `你有 ${me.value} 韭币，排第 ${me.rank} 名`;
  }
  switch (me.reason) {
    case 'not_opted_in':
      return '你没有开启「参与排行榜」，不会出现在榜上（资料设置里可开启）';
    case 'no_net_gain':
      return '本周还没有净赚，玩一局韭币局或领取每日奖励就能上榜';
    default:
      return board === 'balance' && me.value != null ? `你有 ${me.value} 韭币，暂未进入前 20` : '暂未上榜';
  }
}

export function medalOfRank(rank) {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : null;
}
