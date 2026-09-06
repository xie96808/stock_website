const RESERVED = new Set(["admin","root","system","administrator","null","undefined"]);
const WEAK = new Set(["1234","12345","123456","password","pass","qwer","abcd","aaaa","0000","1111","admin","test","letmein"]);

export function unicodeLen(s) {
  return Array.from(s).length;
}

export function normalizeUsername(raw) {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{3,23}$/.test(u)) return null;
  if (RESERVED.has(u)) return null;
  return u;
}

export function validatePassword(raw) {
  if (typeof raw !== "string") return "密码无效";
  const n = unicodeLen(raw);
  if (n < 4) return "密码至少 4 个字符";
  if (n > 128) return "密码最多 128 个字符";
  if (Buffer.byteLength(raw, "utf8") > 512) return "密码过长";
  if (WEAK.has(raw.toLowerCase())) return "密码过于简单";
  return null;
}

export function normalizeNickname(raw, fallback = "新同学") {
  let s = typeof raw === "string" ? raw : fallback;
  try { s = s.normalize("NFC"); } catch {}
  s = s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
  if (!s) s = fallback;
  if (/[\u0000-\u001F\u007F]/.test(s)) return null;
  const n = unicodeLen(s);
  if (n < 2 || n > 16) return null;
  const low = s.toLowerCase();
  if (RESERVED.has(low) || /官方|客服|管理员/.test(s)) return null;
  return s;
}

export function validateAvatarId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}
