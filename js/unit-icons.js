/**
 * 韭币 / 后悔券 as icons wherever the word is a unit or label next to a number (「50<coin>」「<ticket>×2」).
 * DOM-free (unit-tested). The word stays in the markup as visually-hidden text (`.u-sr`), so screen readers and
 * innerText still read 「50 韭币」「后悔券 ×2」. Prose that merely mentions 韭币 / 后悔券 (no number) is left as text.
 */
import { coinIconHtml, ticketIconHtml } from "./icon-art.js";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const SR_COIN = '<span class="u-sr">韭币</span>';
const SR_TICKET = '<span class="u-sr">后悔券</span>';

/** 「<sign><n><coin>」 — same wrapper as amountWithCoinHtml (inline-flex, tabular number). */
export function coinAmountHtml(amount, { size = 14, sign = "" } = {}) {
  const n = amount == null ? "" : String(amount);
  return `<span class="jiu-coin-amt u-amt"><span class="jiu-price-num">${escapeHtml(sign)}${escapeHtml(n)}</span>${coinIconHtml({ size })}${SR_COIN}</span>`;
}

/** Bare 韭币 icon used as a label (no number), e.g. 「改用 <coin>」 — keeps the word for assistive tech. */
export function coinLabelHtml({ size = 14 } = {}) {
  return `<span class="jiu-coin-amt u-amt">${coinIconHtml({ size })}${SR_COIN}</span>`;
}

/** 「<ticket>×N」 (or 「<ticket>−1」 with `delta`). `qty` null ⇒ the icon alone as a label. */
export function ticketAmountHtml(qty, { size = 14, delta = false } = {}) {
  const tail = qty == null ? "" : delta ? escapeHtml(String(qty)) : `×${escapeHtml(String(qty))}`;
  return `<span class="u-amt u-ticket-amt">${ticketIconHtml({ size })}${SR_TICKET}${tail ? `<span class="u-ticket-n">${tail}</span>` : ""}</span>`;
}

/**
 * Escape plain text, then turn number-adjacent units into icons:
 *   「50 韭币」「+20 韭币」→ 50<coin> / +20<coin>;  「后悔券 ×2」「后悔券×2」「2 张后悔券」→ <ticket>×2;  「后悔券 −1」→ <ticket>−1.
 * Everything else (including prose 韭币 / 后悔券 without a number) stays text.
 */
export function unitIconsHtml(text, { size = 14 } = {}) {
  let h = escapeHtml(text);
  h = h.replace(/([+＋\-−]?)(\d[\d,]*)\s*韭币/g, (_, sign, n) => coinAmountHtml(n, { size, sign }));
  h = h.replace(/后悔券\s*[×x]\s*(\d+)/g, (_, n) => ticketAmountHtml(n, { size }));
  h = h.replace(/(\d+)\s*张后悔券/g, (_, n) => ticketAmountHtml(n, { size }));
  h = h.replace(/后悔券\s*([−\-]\d+)/g, (_, d) => ticketAmountHtml(d.replace("-", "−"), { size, delta: true }));
  return h;
}

/** True when unitIconsHtml would change the markup (callers keep textContent for plain strings). */
export function hasUnitIcons(text) {
  return /\d\s*韭币|后悔券\s*[×x]\s*\d|\d+\s*张后悔券|后悔券\s*[−\-]\d/.test(String(text ?? ""));
}
