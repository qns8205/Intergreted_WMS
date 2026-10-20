import { all, get } from "../db.js";
import { kstTimestamp } from '../../shared/rentalTerms.js';

const UNLIMITED_ITEM_TYPES = 9999;

/** 일반 대여·예약 전환·QR 안내가 동일한 관리자 설정과 예외를 사용한다. */
export function rentalTypeLimitPolicy({ name, floor, unit } = {}) {
  const configured = get("SELECT value FROM settings WHERE key='max_item_types_default'")?.value;
  const n = configured ? Number(configured) : NaN;
  const baseMax = Number.isFinite(n) && n > 0 ? n : UNLIMITED_ITEM_TYPES;
  const target = String(name || "").trim().toLowerCase();
  const active = target ? all("SELECT * FROM penalties WHERE LOWER(TRIM(name)) = ? AND (expires_at IS NULL OR expires_at = '' OR expires_at > ?) ORDER BY id DESC", [target,kstTimestamp(Date.now())]) : [];
  const legacy = active.find(row => !row.deduction_types);
  const deductions = active.reduce((sum,row)=>sum+Math.max(0,Number(row.deduction_types)||0),0);
  const legacyMax = legacy && Number.isFinite(Number(legacy.max_types)) ? Number(legacy.max_types) : baseMax;
  const effectiveMax = Math.max(0,legacyMax-deductions);
  const penaltyRow = active.length ? {...active[0],max_types:effectiveMax} : null;
  let exempt = false;
  if (floor && unit) {
    try {
      const map = JSON.parse(get("SELECT value FROM settings WHERE key='floor_plan'")?.value || "{}");
      seatSearch: for (const f of map.floors || []) {
        if (f.id !== floor && f.name !== floor) continue;
        for (const u of f.units || []) {
          if (u.label === unit || `${f.id}-${u.row}-${u.col}` === unit) { exempt = !!u.exempt; break seatSearch; }
        }
      }
    } catch { /* 잘못된 배치도는 한도 제외로 취급하지 않는다. */ }
  }
  return { baseMax, legacyMax, penaltyRow, exempt, max:Math.max(0,(exempt ? UNLIMITED_ITEM_TYPES : legacyMax)-deductions) };
}
