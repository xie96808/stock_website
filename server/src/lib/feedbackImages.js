import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDataDir } from "../db/connection.js";
import { detectImageMime } from "./avatars.js";

export const FEEDBACK_IMAGE_MAX_BYTES = 1024 * 1024;
export const FEEDBACK_MAX_IMAGES = 3;
/** Multipart body budget: 3 images + text + overhead */
export const FEEDBACK_MULTIPART_MAX_BYTES = FEEDBACK_IMAGE_MAX_BYTES * FEEDBACK_MAX_IMAGES + 128 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID_RE = /^[a-f0-9]{16,64}\.(jpg|jpeg|png|webp)$/;

export function feedbackImagesDir() {
  const dir = path.join(getDataDir(), "feedback");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

export function isSafeFeedbackImageId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

export function feedbackImageFilePath(id) {
  if (!isSafeFeedbackImageId(id)) return null;
  return path.join(feedbackImagesDir(), id);
}

export function saveFeedbackImageBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { error: { status: 400, code: "INVALID_IMAGE_FILE", message: "请选择图片文件" } };
  }
  if (buf.length > FEEDBACK_IMAGE_MAX_BYTES) {
    return { error: { status: 400, code: "IMAGE_TOO_LARGE", message: "单张图片不能超过 1MB" } };
  }
  const mime = detectImageMime(buf);
  if (!mime || !ALLOWED.has(mime)) {
    return { error: { status: 400, code: "INVALID_IMAGE_TYPE", message: "仅支持 JPEG / PNG / WebP" } };
  }
  const ext = extForMime(mime);
  const filename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const dest = path.join(feedbackImagesDir(), filename);
  fs.writeFileSync(dest, buf, { flag: "wx" });
  return { filename, mime, byteSize: buf.length };
}

/**
 * Parse multipart for feedback: text field "body" + up to 3 image parts
 * named "images" / "image" / "images[]".
 */
export async function readMultipartFeedback(req) {
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
    if (total > FEEDBACK_MULTIPART_MAX_BYTES) {
      return { error: { status: 400, code: "PAYLOAD_TOO_LARGE", message: "反馈内容过大" } };
    }
    chunks.push(chunk);
  }
  const bodyBuf = Buffer.concat(chunks);
  const sep = Buffer.from(`--${boundary}`);
  let pos = bodyBuf.indexOf(sep);
  if (pos < 0) {
    return { error: { status: 400, code: "INVALID_MULTIPART", message: "上传格式无效" } };
  }
  pos += sep.length;

  let textBody = null;
  const images = [];

  while (pos < bodyBuf.length) {
    if (bodyBuf[pos] === 0x2d && bodyBuf[pos + 1] === 0x2d) break;
    if (bodyBuf[pos] === 0x0d && bodyBuf[pos + 1] === 0x0a) pos += 2;
    const headerEnd = bodyBuf.indexOf(Buffer.from("\r\n\r\n"), pos);
    if (headerEnd < 0) break;
    const headerText = bodyBuf.slice(pos, headerEnd).toString("utf8");
    const nextSep = bodyBuf.indexOf(sep, headerEnd + 4);
    if (nextSep < 0) break;
    let dataEnd = nextSep - 2;
    if (dataEnd < headerEnd + 4) dataEnd = headerEnd + 4;
    const data = bodyBuf.slice(headerEnd + 4, dataEnd);
    pos = nextSep + sep.length;

    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const name = nameMatch ? nameMatch[1] : "";

    if (name === "body" && !filenameMatch) {
      textBody = data.toString("utf8");
      continue;
    }
    const isImageField =
      name === "images" ||
      name === "image" ||
      name === "images[]" ||
      name === "file";
    if (isImageField && filenameMatch && filenameMatch[1]) {
      if (images.length >= FEEDBACK_MAX_IMAGES) {
        return {
          error: {
            status: 400,
            code: "TOO_MANY_IMAGES",
            message: `最多附带 ${FEEDBACK_MAX_IMAGES} 张图片`,
          },
        };
      }
      images.push({ buffer: data, originalName: filenameMatch[1] });
    }
  }

  return { body: textBody, images };
}
