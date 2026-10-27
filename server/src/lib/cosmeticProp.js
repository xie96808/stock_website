import { config } from "./config.js";
import { isEntranceId } from "./cosmeticDefs.js";

export function pvpCosmeticsEnabled() {
  return !!config.pvpCosmeticsEnabled;
}

/**
 * Spread into a public player DTO: `{ ...entranceProp(row.pvp_entrance) }`. Emits `{pvpEntrance}` only while the flag is
 * on AND the stored id is a known effect, so with the flag off every payload is byte-for-byte what it was before.
 */
export function entranceProp(raw) {
  return pvpCosmeticsEnabled() && isEntranceId(raw) ? { pvpEntrance: raw } : {};
}
