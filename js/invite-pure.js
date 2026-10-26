/**
 * 邀请奖励 — pure helpers (no DOM, no network) so they can be unit-tested in node.
 * The invite link is `https://stockgame.xieyw.top/?invite=ABC234`; the code is remembered for 30 days
 * (a friend may open the link now and register later) and sent along with the register request.
 */
export const INVITE_STORAGE_KEY = "stockgame.invite.code";
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITE_SITE_ORIGIN = "https://stockgame.xieyw.top";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = new RegExp(`^[${ALPHABET}]{6}$`);

export function normalizeInviteCode(raw) {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(c) ? c : null;
}

/** `?invite=abc234&x=1` → "ABC234"; anything malformed → null. */
export function parseInviteFromSearch(search) {
  try {
    return normalizeInviteCode(new URLSearchParams(String(search || "")).get("invite") || "");
  } catch {
    return null;
  }
}

/** The same URL without the `invite` param (keeps every other param and the hash). */
export function stripInviteFromUrl(pathname, search, hash) {
  const q = new URLSearchParams(String(search || ""));
  q.delete("invite");
  const rest = q.toString();
  return `${pathname || "/"}${rest ? `?${rest}` : ""}${hash || ""}`;
}

export function buildInviteLink(code, origin = INVITE_SITE_ORIGIN) {
  const base = /^https?:\/\//.test(origin || "") ? origin : INVITE_SITE_ORIGIN;
  const c = normalizeInviteCode(code);
  return c ? `${base.replace(/\/$/, "")}/?invite=${c}` : base.replace(/\/$/, "");
}

export function readPendingInvite(storage, now = Date.now()) {
  try {
    const raw = storage && storage.getItem(INVITE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const code = normalizeInviteCode(v && v.code);
    if (!code || !(now - Number(v.at) < INVITE_TTL_MS)) return null;
    return code;
  } catch {
    return null;
  }
}

export function writePendingInvite(storage, code, now = Date.now()) {
  const c = normalizeInviteCode(code);
  if (!c || !storage) return false;
  try {
    storage.setItem(INVITE_STORAGE_KEY, JSON.stringify({ code: c, at: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingInvite(storage) {
  try { storage && storage.removeItem(INVITE_STORAGE_KEY); } catch { /* private mode */ }
}

/** Line shown on the register form when a code is waiting. */
export function registerNote(code, inviteeCoins = 80) {
  const c = normalizeInviteCode(code);
  return c ? `已使用邀请码 ${c}：注册后完成第一局，你和好友各得韭币（你 +${inviteeCoins}）` : "";
}

/** Toast after a successful register that carried a code (`data.invite` from the API). */
export function registerToast(invite) {
  if (!invite || !invite.accepted) return "";
  return `邀请码已生效，完成第一局可得 +${invite.inviteeCoins} 韭币`;
}

/** Toast when the first settled game paid out (`data.inviteReward` from the finish response). */
export function rewardToast(reward) {
  if (!reward || !(Number(reward.inviteeCoins) > 0)) return "";
  return `好友邀请奖励 +${reward.inviteeCoins} 韭币已到账`;
}

export function statsLine(state) {
  const s = state && state.stats;
  if (!s) return "";
  if (!s.invited) return "还没有人使用你的邀请码";
  const parts = [`已邀请 ${s.invited} 人`, `${s.rewarded} 人已完成首局`];
  if (s.pending) parts.push(`${s.pending} 人待完成`);
  return parts.join(" · ");
}

export function earnedLine(state) {
  if (!state || !state.stats) return "";
  const earned = Number(state.stats.coinsEarned) || 0;
  const left = Number(state.remaining);
  return `累计获得 ${earned} 韭币` + (Number.isFinite(left) ? ` · 还可奖励 ${left} 位好友` : "");
}

export function ruleLines(state) {
  const inviter = state?.inviterCoins ?? 100;
  const invitee = state?.inviteeCoins ?? 80;
  return [
    `好友用你的链接注册，并完成第一局`,
    `你得 ${inviter} 韭币，好友得 ${invitee} 韭币`,
    `每天最多奖励 ${state?.dailyCap ?? 5} 位好友，累计 ${state?.maxRewards ?? 20} 位`,
  ];
}

export function shareText(code, link, siteName = "早知道当初不炒了") {
  return `来玩《${siteName}》：用真实 A 股行情模拟炒股。用我的邀请码 ${code} 注册并完成第一局，我们俩都能拿韭币！${link}`;
}

/** Poster footer copy for the settlement card. `invite` = GET /me/invite data or null. */
export function posterFooter(invite) {
  const code = invite && invite.enabled ? normalizeInviteCode(invite.code) : null;
  if (code) {
    return {
      code,
      link: buildInviteLink(code),
      line1: "扫码来玩 · 一起赚韭币",
      line2: `邀请码 ${code}`,
      line3: `注册并完成第一局，我们各得韭币`,
    };
  }
  return {
    code: null,
    link: INVITE_SITE_ORIGIN,
    line1: "扫码来玩",
    line2: "用真实 A 股行情，重走每一次错过的行情",
    line3: "stockgame.xieyw.top",
  };
}
