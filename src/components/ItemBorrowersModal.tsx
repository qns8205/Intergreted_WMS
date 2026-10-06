import React, { useEffect, useId, useRef, useState } from "react";
import { Users, X, RotateCcw } from "lucide-react";
import { CurrentItemBorrower, fetchItemBorrowers } from "../utils/borrowApi";

export interface BorrowersTarget {
  id: string;
  name: string;
  category: "scenario" | "tablecloth";
  variantId?: number;
}

export default function ItemBorrowersModal({ target, scriptUrl, C, onClose }: {
  key?: string; target: BorrowersTarget; scriptUrl: string; C: any; onClose: () => void;
}) {
  const [borrowers, setBorrowers] = useState<CurrentItemBorrower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setBorrowers([]);
    const request = scriptUrl ? fetchItemBorrowers(scriptUrl, target.id, target.category, target.variantId) : Promise.reject(new Error("서버 연결 후 대여 현황을 확인할 수 있습니다."));
    request.then((rows) => { if (!cancelled) setBorrowers(rows); })
      .catch((err) => { if (!cancelled) setError(err.message || "대여 현황을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scriptUrl, target.id, target.category, target.variantId, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "q" || event.key === "Q") {
        event.preventDefault(); event.stopImmediatePropagation(); onClose();
      } else if (event.key === "Tab") {
        const buttons = closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, padding: "20px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,.5)" }}>
      <section role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={(event) => event.stopPropagation()} style={{ width: "min(460px, 100%)", maxHeight: "80vh", overflowY: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px", padding: "22px", color: C.text, boxShadow: "0 18px 60px rgba(0,0,0,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Users size={22} style={{ color: C.accentText }} />
          <h2 id={headingId} style={{ margin: 0, flex: 1, fontSize: "18px", fontWeight: 800 }}>현재 대여 현황</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="대여 현황 닫기" style={{ background: "transparent", border: "none", padding: "6px", color: C.label, cursor: "pointer" }}><X size={20} /></button>
        </div>
        <div style={{ marginTop: "12px", fontWeight: 700, fontSize: "14px", overflowWrap: "anywhere" }}>{target.name}</div>
        <div style={{ color: C.label, fontSize: "12px", margin: "6px 0 18px", lineHeight: 1.6 }}>반납·취소된 건은 제외됩니다. 조회만 가능하며 물품은 담기지 않습니다.</div>
        <div aria-live="polite" aria-busy={loading}>
          {loading ? <div style={{ padding: "24px 0", textAlign: "center", color: C.label }}>대여 현황을 불러오는 중…</div>
            : error ? <div style={{ color: C.label, fontSize: "13px", lineHeight: 1.6 }}>
              {error}<button type="button" onClick={() => setRetry((value) => value + 1)} style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "10px", padding: "8px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer" }}><RotateCcw size={14} /> 다시 시도</button>
            </div>
            : borrowers.length === 0 ? <div style={{ padding: "20px 0", color: C.label, textAlign: "center", fontSize: "13px", lineHeight: 1.7 }}>현재 대여 중이거나 확인 대기 중인 사람이 없습니다.<br />재고 부족 사유는 관리자에게 확인해주세요.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {borrowers.map((borrower, index) => <div key={index} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", background: C.cardSub, borderRadius: "12px", border: `1px solid ${C.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, overflowWrap: "anywhere" }}>{borrower.borrowerName}</div>
                  <div style={{ color: C.label, fontSize: "11.5px", marginTop: "4px" }}>{[borrower.pickedUp ? "대여 중" : "대여 확인 대기", borrower.variantName].filter(Boolean).join(" · ")}</div>
                </div>
                <span style={{ fontSize: "14px", fontWeight: 800, color: C.accentText, whiteSpace: "nowrap" }}>{borrower.quantity}개</span>
              </div>)}
            </div>}
        </div>
      </section>
    </div>
  );
}
