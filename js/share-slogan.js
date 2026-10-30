/**
 * 分享图上的一句随机“邀战”话：带上这局收益率，按赚 / 亏 / 持平分三组，每次保存随机抽一句。
 * 纯函数，`rand` 可注入（默认 Math.random），方便单测。
 */
const GAIN = [
  '我的收益率 {ret}，敢来战吗？',
  '这局我赚了 {ret}，你能超过我吗？',
  '收益率 {ret}，等你来挑战！',
  '{ret}，我先交卷，轮到你了。',
  '我拿下 {ret}，不服来战！',
];
const LOSS = [
  '我这局收益率 {ret}，你能比我强吗？',
  '收益率 {ret}，我认栽，你来战？',
  '我亏了 {ret}，你来替我报仇？',
  '{ret}……我先趟了雷，你来试试？',
];
const FLAT = [
  '收益率 {ret}，不赚不亏，你来打破平衡？',
  '这局 {ret}，原地踏步，你敢来战吗？',
];

export function sloganPool(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n === 0) return FLAT;
  return n > 0 ? GAIN : LOSS;
}

/** @param {string} ret 已格式化的收益率，如 "+7.01%"  @param {number} pct 收益率数值 */
export function pickShareSlogan(ret, pct, rand = Math.random) {
  const pool = sloganPool(pct);
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(Number(rand()) * pool.length) || 0));
  return pool[i].replace('{ret}', ret);
}

export const SHARE_SLOGAN_POOLS = { GAIN, LOSS, FLAT };
