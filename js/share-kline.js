/**
 * 分享图里的 K 线：把用户这局玩的 30 根日 K 手绘到一个 <canvas> 上（红涨绿跌，A 股习惯），
 * 带买 / 卖标记。不依赖 ECharts（分享图要在离屏容器里同步出图，canvas 最稳）。
 * 纯函数 + 一个画图函数：`planShareKline` 只做数据整理，方便单测。
 */

/** 这局的 30 天窗口：history 之后的 gameDays 根。 */
export function shareWindowBars(bars, historyLength, gameDays = 30) {
  const list = Array.isArray(bars) ? bars : [];
  const start = Math.max(0, Number(historyLength) || 0);
  const n = Math.max(1, Number(gameDays) || 30);
  return list.slice(start, start + n).filter((b) => b && [b.open, b.close, b.high, b.low].every((v) => Number.isFinite(Number(v))));
}

/** 把成交记录 {type,day,price} 映射到窗口内的 bar 下标（day 从 1 起）；超出窗口的丢掉。 */
export function shareMarks(trades, barCount) {
  const out = [];
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!t || (t.type !== 'buy' && t.type !== 'sell')) continue;
    const index = Number(t.day) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= barCount) continue;
    out.push({ index, kind: t.type });
  }
  return out;
}

/** 价格范围（含少量上下留白），全平盘时也给出非零区间。 */
export function priceRange(bars, padRatio = 0.08) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, Number(b.low), Number(b.open), Number(b.close));
    hi = Math.max(hi, Number(b.high), Number(b.open), Number(b.close));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  return { lo: lo - span * padRatio, hi: hi + span * padRatio };
}

/**
 * @param {HTMLCanvasElement} canvas  已设置好 width/height（物理像素）
 * @param {Array} bars  30 根 {open,close,high,low}
 * @param {Array} trades  [{type:'buy'|'sell', day}]
 * @param {number} dpr  物理像素 / CSS 像素
 * @param {{up:string, down:string, grid:string, text:string, buy:string, sell:string, markInk:string, font:string}} theme
 */
export function drawShareKline(canvas, bars, trades, theme, dpr = 2) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !bars.length) return false;
  const W = canvas.width;
  const H = canvas.height;
  const px = (n) => n * dpr;
  ctx.clearRect(0, 0, W, H);

  const padL = px(8);
  const padR = px(46); // 右侧价格刻度
  const padT = px(16);
  const padB = px(22); // 买卖标记留位
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { lo, hi } = priceRange(bars);
  const y = (v) => padT + (1 - (Number(v) - lo) / (hi - lo)) * plotH;

  // 水平网格 + 价格刻度
  ctx.lineWidth = Math.max(1, dpr * 0.8);
  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.text;
  ctx.font = `${px(11)}px ${theme.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.setLineDash([px(3), px(4)]);
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(padL + plotW, yy);
    ctx.stroke();
    ctx.fillText(v >= 100 ? v.toFixed(1) : v.toFixed(2), padL + plotW + px(6), yy);
  }
  ctx.setLineDash([]);

  // 蜡烛
  const slot = plotW / bars.length;
  const bodyW = Math.max(px(3), Math.min(px(14), slot * 0.64));
  bars.forEach((b, i) => {
    const o = Number(b.open);
    const c = Number(b.close);
    const color = c >= o ? theme.up : theme.down;
    const cx = Math.round(padL + slot * (i + 0.5)) + 0.5;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(cx, y(b.high));
    ctx.lineTo(cx, y(b.low));
    ctx.stroke();
    const top = Math.min(y(o), y(c));
    const h = Math.max(px(1.5), Math.abs(y(o) - y(c)));
    ctx.fillRect(cx - bodyW / 2, top, bodyW, h);
  });

  // 买 / 卖标记：买在最低价下方，卖在最高价上方；同一天既买又卖时各占一侧
  const r = px(8);
  ctx.font = `700 ${px(10)}px ${theme.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of shareMarks(trades, bars.length)) {
    const b = bars[m.index];
    const cx = padL + slot * (m.index + 0.5);
    const buy = m.kind === 'buy';
    let cy = buy ? y(b.low) + r + px(3) : y(b.high) - r - px(3);
    cy = Math.max(r + px(1), Math.min(H - r - px(1), cy));
    ctx.fillStyle = buy ? theme.buy : theme.sell;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.markInk;
    ctx.fillText(buy ? '买' : '卖', cx, cy + px(0.5));
  }
  return true;
}
