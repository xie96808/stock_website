/**
 * Track R3 — 后悔券 copy + state helpers (DOM-free, unit-tested).
 * Design: lucky-wheel DESIGN.md Rev 4 §8.1.4. The coin copy MUST stay byte-identical to today's.
 */

/** Normalise GET /me/items (or a missing endpoint on an older API ⇒ no tickets, legacy UI). */
export function normalizeItems(data) {
  const n = Number(data?.rewindTickets);
  return {
    tickets: Number.isInteger(n) && n > 0 ? n : 0,
    board: data?.rewindTicketBoard === "undo" ? "undo" : "clean",
    known: !!data && typeof data === "object" && "rewindTickets" in data,
  };
}

/** Rewind button label state: tickets > 0 ⇒ '反悔 · 券×N', else today's '反悔 50🪙' (rendered by the caller). */
export function rewindButtonMode(tickets) {
  const n = Number(tickets) || 0;
  return n > 0 ? { mode: "ticket", text: `反悔 · 券×${n}`, key: `t${n}` } : { mode: "coin", text: "反悔", key: "coin" };
}

/** Default payment in the confirm sheet. */
export function defaultPayWith(tickets) {
  return (Number(tickets) || 0) > 0 ? "ticket" : "coin";
}

/**
 * Ticket confirm copy (plain text; the caller adds markup). `left` = tickets after use.
 * board 'clean' (default): normal board; 'undo': admin switch says ticket games go to the 反悔 board.
 */
export function ticketConfirmCopy({ tickets, targetDay, board = "clean" }) {
  const left = Math.max(0, (Number(tickets) || 0) - 1);
  const tail = board === "undo" ? "本局将记为反悔局，每局限一次。" : "本局仍按普通对局计入排行榜，每局限一次。";
  return `使用 1 张后悔券（剩 ${left} 张），回到第 ${targetDay} 日。${tail}`;
}

/** Success toast. Coin text is today's string, unchanged. */
export function rewindToast(paidWith) {
  return paidWith === "ticket" ? "已回到上一决策日（后悔券 −1）" : "已回到上一决策日（本局记为反悔）";
}

/** Result-page chip (owner only). */
export function ticketChip(view) {
  return view && view.rewindVia === "ticket" ? "用过后悔券" : null;
}

/** Account-panel / wheel inventory line. */
export function inventoryLine(tickets) {
  return `后悔券 ×${Math.max(0, Number(tickets) || 0)}`;
}
