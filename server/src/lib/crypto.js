import crypto from "node:crypto";
import argon2 from "argon2";
import { config } from "./config.js";

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function deriveCsrfToken(sessionToken) {
  return crypto
    .createHmac("sha256", config.csrfSecret)
    .update(`csrf:v1:${sessionToken}`)
    .digest("base64url");
}

export function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function hashRecoveryCode(code) {
  return sha256Hex(`recovery:v1:${code}`);
}
