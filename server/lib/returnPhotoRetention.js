import fs from "node:fs";
import path from "node:path";
import { all, run } from "../db.js";
import { uploadsDir } from "./images.js";

const RETENTION_DAYS = Number(process.env.WMS_RETURN_PHOTO_RETENTION_DAYS) || 7;

// return_photos.occurred_at은 "YYYY-MM-DD HH:mm:ss"(서울 로컬 시각) 형식이라 문자열 비교로
// 정렬/대소 비교가 그대로 맞는다 — nowKst()와 같은 포맷으로 기준 시각을 만든다.
function cutoffKst(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 반납 사진은 증빙용이라 오래 쌓아둘 필요가 없다 — 기본 7일이 지나면 사진 파일과 DB 기록을 함께 지운다. */
export function cleanupOldReturnPhotos() {
  const cutoff = cutoffKst(RETENTION_DAYS);
  const stale = all("SELECT id,image_path FROM return_photos WHERE occurred_at < ?", [cutoff]);
  for (const row of stale) {
    // 직접 입력 공구 반납 사진은 DB id 발급 전에 저장되어 client_id 폴더를 사용한다.
    // 정해진 파일 형식만 지워 업로드 루트 밖으로 나갈 수 없게 한다.
    const toolPath = /^\/uploads\/warehouse_returns\/([a-zA-Z0-9_-]{12,80})\/(original-[0-9]+\.webp)$/.exec(row.image_path || "");
    if (toolPath) {
      const toolDir = path.join(uploadsDir, "warehouse_returns", toolPath[1]);
      for (const file of [toolPath[2], toolPath[2].replace("original-", "thumb-")]) {
        try { fs.unlinkSync(path.join(toolDir, file)); } catch { /* 이미 정리된 파일 */ }
      }
      try { fs.rmdirSync(toolDir); } catch { /* 다른 파일이 남으면 폴더를 보존 */ }
    }
    const dir = path.join(uploadsDir, "return_photos", String(row.id));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 이미 없거나 접근 실패 — DB 정리는 계속 진행 */ }
  }
  if (stale.length) run("DELETE FROM return_photos WHERE occurred_at < ?", [cutoff]);

  // 대여 확인 사진도 같은 증빙 보관 기간을 적용한다. 예전 ISO 시각과 새 서울 로컬 시각이
  // 함께 있을 수 있어 JS Date로 비교한다.
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pickupStale = all("SELECT id,client_id,created_at FROM unattended_pickup_photos").filter((row) => {
    const raw = String(row.created_at || "");
    const parsed = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw.replace(" ", "T")).getTime();
    return Number.isFinite(parsed) && parsed < cutoffMs;
  });
  for (const row of pickupStale) {
    const dir = path.join(uploadsDir, "unattended_pickups", String(row.client_id));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 파일이 없어도 DB 정리는 계속 */ }
    run("DELETE FROM unattended_pickup_photos WHERE id=?", [row.id]);
  }
  const deleted = stale.length + pickupStale.length;
  if (deleted) console.log(`[photo-retention] 반납 ${stale.length}건 · 대여 확인 ${pickupStale.length}건 삭제 (${RETENTION_DAYS}일 경과)`);
  return { deleted };
}
