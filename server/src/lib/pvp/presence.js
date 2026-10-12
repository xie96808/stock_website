const FRESH_MS = 45_000;

/** In-process “可约战” flag. A restart clears it. Heartbeats do not opt anyone in. */
const presence = new Map();

export function clearPresence() {
  presence.clear();
}

export function setAvailable(userId, available, now = Date.now()) {
  const id = Number(userId);
  presence.set(id, { available: available === true, lastSeen: now });
  return presence.get(id);
}

export function touchPresence(userId, now = Date.now()) {
  const row = presence.get(Number(userId));
  if (!row?.available) return false;
  row.lastSeen = now;
  return true;
}

export function isAvailable(userId, now = Date.now()) {
  const row = presence.get(Number(userId));
  return !!(row?.available && now - row.lastSeen <= FRESH_MS);
}

export function listAvailableIds(now = Date.now()) {
  const ids = [];
  for (const [userId, row] of presence) {
    if (row.available && now - row.lastSeen <= FRESH_MS) ids.push(userId);
  }
  ids.sort((a, b) => a - b);
  return ids;
}

/** Drop stale presence rows so memory and lobby counts stay honest. */
export function prunePresence(now = Date.now(), maxAgeMs = FRESH_MS) {
  for (const [userId, row] of presence) {
    if (!row || now - row.lastSeen > maxAgeMs) presence.delete(userId);
  }
}
