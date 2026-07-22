import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowUpDown, History } from "lucide-react";
import { adjustStock, fetchStockChangeHistory, StockChangeRecord } from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  category: "inventory" | "scenario";
  rowIndex: number;
  itemId: string; // 위치(공구 및 부품류) 또는 물품 ID(시나리오)
  itemLabel: string; // 화면에 보여줄 물품명
  currentStock: number;
  managerName?: string;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  onClose: () => void;
  onSaved: (newStock: number) => void;
}

/**
 * 재고 변경 모달 (사유 필수 + 변경 이력 기록)
 * 공구 및 부품류(inventory)와 시나리오 물품(scenario) 양쪽에서 공용으로 사용.
 * 캐릭터(테마) 색상은 호출부와 결합시키지 않고 이 컴포넌트가 자체적으로 관리한다.
 */
export default function StockAdjustModal({
  scriptUrl, connected, isLightMode, category, rowIndex, itemId, itemLabel, currentStock,
  managerName = "", showToast, onClose, onSaved,
}: Props) {
  const C = {
    overlay: "rgba(0,0,0,0.6)",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#8b98ac",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    success: isLightMode ? "#0d9488" : "#34d399",
    successSoft: "rgba(16,185,129,0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239,68,68,0.12)",
  };

  const [newStock, setNewStock] = useState(String(currentStock));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<StockChangeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    if (!connected || !scriptUrl) return;
    setHistoryLoading(true);
    fetchStockChangeHistory(scriptUrl, category, itemId)
      .then(setHistory)
      .catch((e) => showToast(`변경 이력을 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => { setHistoryLoading(false); setHistoryLoaded(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptUrl, connected, category, itemId]);

  const parsed = parseInt(newStock, 10);
  const diff = !isNaN(parsed) ? parsed - currentStock : null;

  async function handleSubmit() {
    if (isNaN(parsed) || parsed < 0) { showToast("새 재고 수량을 올바르게 입력해주세요.", "warn"); return; }
    if (!reason.trim()) { showToast("재고 변경 사유를 입력해주세요.", "warn"); return; }
    if (parsed === currentStock) { showToast("현재 재고와 동일합니다. 값을 변경해주세요.", "warn"); return; }
    setSubmitting(true);
    try {
      if (connected && scriptUrl) {
        const res = await adjustStock(scriptUrl, { category, rowIndex, newStock: parsed, reason: reason.trim(), manager: managerName });
        if (!res.success) { showToast(res.message || "재고 변경에 실패했습니다.", "error"); return; }
        if (res.warning) showToast(res.warning, "warn");
        else showToast("재고를 변경했습니다.", "ok");
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      onSaved(parsed);
      onClose();
    } catch (e: any) {
      showToast(`재고 변경 실패: ${e.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: "6px", color: C.text }}>
              <ArrowUpDown size={16} style={{ color: C.accent }} /> 재고 변경
            </h2>
            <div style={{ fontSize: "12px", color: C.label, marginTop: "3px" }}>{itemLabel} ({itemId})</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            <div style={{ flex: 1, padding: "10px 12px", background: C.cardSub, borderRadius: "10px", textAlign: "center" }}>
              <div style={{ fontSize: "11px", color: C.label, fontWeight: 700 }}>현재 재고</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: C.text, marginTop: "2px" }}>{currentStock}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", color: C.label }}>→</div>
            <div style={{ flex: 1, padding: "10px 12px", background: C.accentSoft, borderRadius: "10px" }}>
              <label style={{ fontSize: "11px", color: C.label, fontWeight: 700, display: "block", textAlign: "center" }}>새 재고</label>
              <input
                type="number"
                min={0}
                value={newStock}
                onChange={(e) => setNewStock(e.target.value)}
                style={{ width: "100%", border: "none", background: "transparent", outline: "none", fontSize: "18px", fontWeight: 800, color: C.text, textAlign: "center" }}
              />
            </div>
          </div>

          {diff !== null && diff !== 0 ? (
            <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: diff > 0 ? C.success : C.error, marginBottom: "14px" }}>
              {diff > 0 ? `+${diff}` : diff}개 변경됩니다
            </div>
          ) : null}

          <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "6px" }}>변경 사유 *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 실사 결과 반영, 파손 3개 폐기, 신규 입고 등"
            style={{ width: "100%", minHeight: "70px", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", resize: "none", outline: "none", marginBottom: "16px", fontFamily: "inherit" }}
          />

          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1, marginBottom: "20px" }}
          >
            {submitting ? "변경 중..." : "재고 변경하기"}
          </button>

          <div style={{ fontSize: "13px", fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: "5px", marginBottom: "10px" }}>
            <History size={13} style={{ color: C.label }} /> 변경 이력
          </div>
          {historyLoading && !historyLoaded ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.label, fontSize: "12px" }}>불러오는 중...</div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: C.label, fontSize: "12px" }}>변경 이력이 없습니다.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {history.map((h, i) => (
                <div key={i} style={{ padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: C.label }}>{h.changedAt}{h.manager ? ` · ${h.manager}` : ""}</span>
                    <span style={{ fontSize: "12px", fontWeight: 800, color: h.diff === 0 ? C.label : h.diff > 0 ? C.success : C.error }}>
                      {h.diff > 0 ? `+${h.diff}` : h.diff}
                    </span>
                  </div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: C.text, marginTop: "4px" }}>
                    {h.oldStock} → {h.newStock}
                  </div>
                  {h.reason ? <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>{h.reason}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
