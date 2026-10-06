import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const uploadsDir = process.env.WMS_UPLOADS_DIR || path.join(process.cwd(), "server", "uploads");

/**
 * Saves an image (Buffer, or a `data:image/...;base64,...` string) under `uploads/{scope}/{id}/`,
 * writing a resized original (max 1280px, matching the client-side compression cap in
 * src/utils/drive.ts — keep the two in sync) and a thumbnail (max 320px), both webp.
 * Returns { url, thumbUrl } paths served at /uploads/*.
 *
 * 원본은 확대 보기에서만 쓰이므로 1280px/q82면 충분하다. 목록·카드에 나가는 건 전부 썸네일이다.
 */
export async function saveImage(input, scope, id) {
  const buffer = toBuffer(input);
  const stamp = Date.now();
  const dir = path.join(uploadsDir, scope, String(id));
  fs.mkdirSync(dir, { recursive: true });

  const originalPath = path.join(dir, `original-${stamp}.webp`);
  const thumbPath = path.join(dir, `thumb-${stamp}.webp`);

  await sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(originalPath);
  await sharp(buffer).rotate().resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toFile(thumbPath);

  return {
    url: `/uploads/${scope}/${id}/original-${stamp}.webp`,
    thumbUrl: `/uploads/${scope}/${id}/thumb-${stamp}.webp`,
  };
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string" && input.startsWith("data:")) {
    const base64 = input.slice(input.indexOf(",") + 1);
    return Buffer.from(base64, "base64");
  }
  throw new Error("지원하지 않는 이미지 형식입니다.");
}

export function randomId() {
  return crypto.randomBytes(8).toString("hex");
}

/** If `value` is a `data:image/...` URL, saves it and returns the served URL; otherwise passes the value through unchanged. */
export async function maybeSaveImage(value, scope, id) {
  if (typeof value === "string" && value.startsWith("data:image/")) {
    const { url } = await saveImage(value, scope, id);
    return url;
  }
  return value ?? null;
}

export { uploadsDir };
