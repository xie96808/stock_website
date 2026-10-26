import { config } from "./config.js";
import { isFrameId } from "./frameDefs.js";

export function avatarFramesEnabled() {
  return !!config.avatarFramesEnabled;
}

/**
 * Spread into any public avatar DTO: `{ ...frameProp(row.avatar_frame) }`.
 * Emits `{avatarFrame}` only while the flag is on AND the stored id is a known frame, so with the flag off (or no frame)
 * every payload is byte-for-byte what it was before.
 */
export function frameProp(raw) {
  return avatarFramesEnabled() && isFrameId(raw) ? { avatarFrame: raw } : {};
}
