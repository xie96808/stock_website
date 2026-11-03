/**
 * 开一局 收益率转轮：把「旧文本 → 新文本」拆成逐位的转动计划（纯函数，DOM 在 stake-reel.js）。
 *
 * - 右对齐逐位比较；数字没变的位不动。
 * - 数字位：从旧数字一路往上滚到新数字（至少滚 4 格，看得出在转）；没有旧数字（新增的位）从 0 开始。
 * - 符号 / 其它字符变化（+ ↔ −）：只翻一格。
 * - 每位的时长随位置递增，所以是「左边先停、右边后停」，像老虎机一样依次落定。
 */

const isDigit = (c) => typeof c === "string" && c >= "0" && c <= "9";

export const REEL_BASE_MS = 420;
export const REEL_STEP_MS = 110;
const MIN_LINES = 4;

/**
 * @param {string|null|undefined} prev
 * @param {string} next
 * @returns {Array<{ch: string, strip: string[]|null, durMs: number}>}  strip = 转动时依次掠过的字符（不含最终字符）
 */
export function reelPlan(prev, next) {
  const a = [...String(prev ?? "")];
  const b = [...String(next ?? "")];
  const off = b.length - a.length; // right-aligned
  return b.map((ch, i) => {
    const old = a[i - off];
    const durMs = REEL_BASE_MS + i * REEL_STEP_MS;
    if (old === ch) return { ch, strip: null, durMs };
    if (isDigit(ch)) {
      const from = isDigit(old) ? Number(old) : 0;
      let steps = (Number(ch) - from + 10) % 10;
      if (steps < MIN_LINES) steps += 10;
      const strip = Array.from({ length: steps }, (_, j) => String((from + j) % 10));
      return { ch, strip, durMs };
    }
    return { ch, strip: old == null ? null : [old], durMs };
  });
}

/** Total time until the last cell has settled. */
export function reelTotalMs(plan) {
  return plan.reduce((m, c) => (c.strip ? Math.max(m, c.durMs) : m), 0);
}
