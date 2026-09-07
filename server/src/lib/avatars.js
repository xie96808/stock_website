import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "../db/connection.js";

export const AVATAR_MAX_BYTES = 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID_RE = /^[a-f0-9]{16,64}\.(jpg|jpeg|png|webp)$/;

export function avatarsDir() {
  const dir = path.join(getDataDir(), "avatars");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

export function detectImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function isSafeAvatarId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

export function avatarFilePath(id) {
  if (!isSafeAvatarId(id)) return null;
  return path.join(avatarsDir(), id);
}

export function saveAvatarBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { error: { status: 400, code: "INVALID_AVATAR_FILE", message: "请选择图片文件" } };
  }
  if (buf.length > AVATAR_MAX_BYTES) {
    return { error: { status: 400, code: "AVATAR_TOO_LARGE", message: "头像不能超过 1MB" } };
  }
  const mime = detectImageMime(buf);
  if (!mime || !ALLOWED.has(mime)) {
    return { error: { status: 400, code: "INVALID_AVATAR_TYPE", message: "仅支持 JPEG / PNG / WebP" } };
  }
  const ext = extForMime(mime);
  const filename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const dest = path.join(avatarsDir(), filename);
  fs.writeFileSync(dest, buf, { flag: "wx" });
  return { filename, mime };
}

export async function readMultipartAvatar(req) {
  const ctype = String(req.headers["content-type"] || "");
  const m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
  if (!m) {
    return { error: { status: 400, code: "EXPECTED_MULTIPART", message: "请使用 multipart 上传" } };
  }
  const boundary = m[1] || m[2];
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > AVATAR_MAX_BYTES + 64 * 1024) {
      return { error: { status: 400, code: "AVATAR_TOO_LARGE", message: "头像不能超过 1MB" } };
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const sep = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(sep);
  if (pos < 0) {
    return { error: { status: 400, code: "INVALID_MULTIPART", message: "上传格式无效" } };
  }
  pos += sep.length;
  while (pos < body.length) {
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), pos);
    if (headerEnd < 0) break;
    const headerText = body.slice(pos, headerEnd).toString("utf8");
    const nextSep = body.indexOf(sep, headerEnd + 4);
    if (nextSep < 0) break;
    let dataEnd = nextSep - 2;
    if (dataEnd < headerEnd + 4) dataEnd = headerEnd + 4;
    const data = body.slice(headerEnd + 4, dataEnd);
    pos = nextSep + sep.length;
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch ? nameMatch[1] : "";
    if ((name === "avatar" || name === "file") && filenameMatch) {
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      const declared = ctMatch ? ctMatch[1].trim().toLowerCase() : null;
      return { buffer: data, declaredMime: declared, originalName: filenameMatch[1] };
    }
  }
  return { error: { status: 400, code: "MISSING_AVATAR_FILE", message: "缺少头像文件字段 avatar" } };
}
