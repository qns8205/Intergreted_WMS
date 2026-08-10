import React from "react";
import { AlertCircle } from "lucide-react";

/**
 * 깨질 위험(fragile) / 화재 위험(fireRisk) / 특정 업체 request용(requestFor) /
 * 개인 물품(personalOwner) 물품을 대여 마지막 단계 직전(또는 제출 직전)에 한 번 더
 * 확인시키는 공용 모달. 여러 대여 진입점(BorrowSystemPage, MobileViewPage, RentalPage,
 * SidePanel, App.tsx)에서 공유한다.
 */

export interface HazardItem {
  id: string;
  name: string;
  fragile?: boolean;
  fireRisk?: boolean;
  requestFor?: string;
  personalOwner?: string;
}

export interface HazardPalette {
  card: string;
  border: string;
  text: string;
  label: string;
  warn: string;
  warnSoft: string;
  error: string;
  errorSoft: string;
  accent: string;
  accentSoft: string;
  accentText: string;
}

/** 카탈로그에서 담은 물품들의 id를 찾아, 위험/request/개인 물품 플래그가 있는 것만 추린다 (중복 id 제거). */
export function collectHazardItems(
  catalog: { id: string; fragile?: boolean; fireRisk?: boolean; requestFor?: string; personalOwner?: string }[],
  picked: { id: string; name: string }[]
): HazardItem[] {
  const seen = new Set<string>();
  const result: HazardItem[] = [];
  picked.forEach((it) => {
    if (!it.id || seen.has(it.id)) return;
    const obj = catalog.find((o) => o.id === it.id);
    if (obj && (obj.fragile || obj.fireRisk || obj.requestFor || obj.personalOwner)) {
      seen.add(it.id);
      result.push({ id: it.id, name: it.name, fragile: obj.fragile, fireRisk: obj.fireRisk, requestFor: obj.requestFor, personalOwner: obj.personalOwner });
    }
  });
  return result;
}

export default function HazardConfirmModal({
  items,
  C,
  onConfirm,
  zIndex = 9999,
}: {
  items: HazardItem[];
  C: HazardPalette;
  onConfirm: () => void;
  zIndex?: number;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.warnSoft, color: C.warn, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <AlertCircle size={30} />
        </div>
        <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>확인이 필요한 물품이 있어요</div>
        <div style={{ fontSize: "13px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
          담으신 물품 중 아래는 <b style={{ color: C.warn }}>주의가 필요하거나 용도가 정해진 물품</b>입니다.<br />
          확인 후 계속 진행해주세요.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px", textAlign: "left" }}>
          {items.map((it) => (
            <div key={it.id} style={{ padding: "10px 12px", background: C.warnSoft, borderRadius: "10px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{it.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "5px" }}>
                {it.fragile ? (
                  <span style={{ fontSize: "11px", fontWeight: 800, color: C.warn, background: "rgba(245,158,11,0.16)", borderRadius: "999px", padding: "2px 8px" }}>🔺 깨질 위험</span>
                ) : null}
                {it.fireRisk ? (
                  <span style={{ fontSize: "11px", fontWeight: 800, color: C.error, background: C.errorSoft, borderRadius: "999px", padding: "2px 8px" }}>🔥 화재 위험</span>
                ) : null}
                {it.requestFor ? (
                  <span style={{ fontSize: "11px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "2px 8px" }}>📌 {it.requestFor} request용</span>
                ) : null}
                {it.personalOwner ? (
                  <span style={{ fontSize: "11px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "2px 8px" }}>👤 {it.personalOwner}님 개인 물품</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onConfirm}
          style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}
        >
          확인했습니다, 계속 진행
        </button>
      </div>
    </div>
  );
}
