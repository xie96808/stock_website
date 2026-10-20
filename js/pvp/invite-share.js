/**
 * Battle invite: one invite link (POST /pvp/shares — the server reuses the
 * caller's open code until it expires), copied or rendered into a share image.
 *
 *   复制链接  → navigator.clipboard (ClipboardItem promise keeps Safari's user
 *              gesture alive while the link is fetched) → execCommand("copy").
 *              The Android shell (StockGameApp) has no clipboard method today;
 *              if one is added as copyText(text), it is used first.
 *   保存邀请图 → S6 card drawn on a canvas (invite-card-s6.js, 2160×2880)
 *              → deliverImage(): Android StockGameApp.saveImage → Web Share
 *              files → <a download>.
 */
import { displayAvatarUrl, getAuthState, showToast } from "../auth.js";
import { buildBattleSharePayload, PVP_INVITE_SHARE_TEXT } from "./copy.js";
import { pvpFetch } from "./transport.js";

let cached = null; // { payload, code, expiresAt }

function fresh(entry, now = Date.now()) {
  if (!entry) return false;
  const exp = Number(entry.expiresAt);
  return !Number.isFinite(exp) || exp - now > 60_000;
}

/** Resolves { title, text, url, clipboard, code }. Throws on server/link errors. */
export async function getInvitePayload() {
  if (fresh(cached)) return cached.payload;
  const { data } = await pvpFetch("/pvp/shares", { method: "POST", body: {} });
  const payload = buildBattleSharePayload(data?.code, location.origin);
  if (!payload.url) throw new Error("没能生成分享链接");
  cached = { payload: { ...payload, code: data.code }, code: data.code, expiresAt: data.expiresAt };
  return cached.payload;
}

export function forgetInvitePayload() {
  cached = null;
}

function execCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}

function bridgeCopy(text) {
  try {
    const app = window.StockGameApp;
    if (app && typeof app.copyText === "function") {
      const res = app.copyText(text);
      return res === undefined || res === true || res === "true" || res === "copied";
    }
  } catch { /* ignore */ }
  return false;
}

/** Copy text that may still be loading. Returns { ok, text }. */
export async function copyInvite(textPromise) {
  const promise = Promise.resolve(textPromise);
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : null;
  // Safari drops the user gesture across an await; a promised ClipboardItem keeps it.
  if (clip?.write && typeof window.ClipboardItem === "function" && !fresh(cached)) {
    try {
      const item = new window.ClipboardItem({
        "text/plain": promise.then((t) => new Blob([t], { type: "text/plain" })),
      });
      await clip.write([item]);
      return { ok: true, text: await promise };
    } catch { /* fall through */ }
  }
  let text = "";
  try { text = await promise; } catch (err) { return { ok: false, text: "", error: err }; }
  if (bridgeCopy(text)) return { ok: true, text };
  try {
    if (clip?.writeText) {
      await clip.writeText(text);
      return { ok: true, text };
    }
  } catch { /* fall through to execCommand */ }
  return { ok: execCopy(text), text };
}

/** 复制链接 button. */
export async function copyInviteLink({ note } = {}) {
  let payload = null;
  const textPromise = getInvitePayload().then((p) => { payload = p; return p.clipboard; });
  const res = await copyInvite(textPromise);
  if (res.error) {
    showToast(res.error.message || "没能生成分享链接", "error");
    return "error";
  }
  if (note && payload) note.textContent = payload.url;
  if (res.ok) {
    showToast("链接已复制", "success");
    return "copied";
  }
  showToast("没能复制，请长按下方链接", "error");
  return "failed";
}

const DONE_COPY = {
  "bridge-saved": "已保存到相册",
  "bridge-shared": "已打开系统分享",
  shared: "已打开分享",
  downloaded: "邀请图已保存",
};

/** Avatar sources for the card, best first: custom → preset → default preset. */
export function inviteAvatarSources(user) {
  const list = [];
  if (user) list.push(displayAvatarUrl(user));
  if (user?.avatarUrl) list.push(displayAvatarUrl(user.avatarId || 1));
  list.push(DEFAULT_AVATAR);
  return [...new Set(list.filter(Boolean))];
}
const DEFAULT_AVATAR = "/images/avatars/01.png";

/** 2160×2880 unless the device is short on canvas budget. */
function cardScale(win = typeof window !== "undefined" ? window : null) {
  const mem = Number(win?.navigator?.deviceMemory);
  return Number.isFinite(mem) && mem > 0 && mem < 2 ? 1 : 2;
}

/** Builds the S6 invite card canvas for the current user. */
export async function buildInviteCanvas(payload, { user = getAuthState()?.user, scale = cardScale() } = {}) {
  const { renderInviteCardS6 } = await import("./invite-card-s6.js");
  return renderInviteCardS6({
    url: payload.url,
    nickname: user?.nickname || "我",
    avatarSources: inviteAvatarSources(user),
    scale,
  });
}

/** 保存邀请图 button. Never throws. */
export async function saveInviteImage({ note } = {}) {
  try {
    const payload = await getInvitePayload();
    if (note) note.textContent = payload.url;
    const share = await import("../share-image.js");
    const { canvas } = await buildInviteCanvas(payload);
    const how = await share.deliverImage(canvas, `zaozhidao-pvp-invite-${payload.code}.png`, { text: PVP_INVITE_SHARE_TEXT });
    if (DONE_COPY[how]) showToast(DONE_COPY[how], "success");
    return how;
  } catch (err) {
    console.warn("invite image failed", err);
    showToast(err?.message && err.status ? err.message : "邀请图没生成出来，请稍后再试", "error");
    return "error";
  }
}
