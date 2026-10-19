/**
 * Track R wiring: the wheel pays item prizes (后悔券) into the inventory.
 * Imported once for its side effect by app.js; tests may re-register a stub via registerItemGranter().
 */
import { registerItemGranter } from "./luckyWheel.js";
import { grantItem } from "./userItems.js";
import { config } from "./config.js";

export function wheelItemGranter(db, { userId, item, qty, spinId }) {
  const cap = item === "rewind_ticket" ? config.rewindTicketHoldCap : undefined;
  const r = grantItem(db, {
    userId,
    itemType: item,
    qty,
    reason: "wheel_prize",
    refType: "wheel_spin",
    refId: spinId,
    meta: { spinId },
    cap,
  });
  if (r.overflow) return { overflow: true, reason: "ticket_hold_cap" };
  return { ledgerId: r.ledgerId, qtyAfter: r.qtyAfter };
}

export function installWheelItems() {
  registerItemGranter(wheelItemGranter);
}

installWheelItems();
