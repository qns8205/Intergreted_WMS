import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowUpDown, History } from "lucide-react";
import { adjustStock, fetchStockChangeHistory, StockChangeRecord, saveScenarioVariants } from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  category: "inventory" | "scenario" | "tablecloth";
  rowIndex: number;
  itemId: string;
  itemLabel: string;
  currentStock: number;
  currentRented?: number; // 시나리오 물품의 "대여 중" 수량 (있을 때만 편집 가능)
  /** 종류가 나뉜 물품이면 종류별로 고치게 한다 — 총재고는 합계로 다시 계산되므로 직접 고칠 수 없다. */
  variants?: { id: number; name: string; stock: number; rented?: number; image?: string }[];
  unassignedStock?: number;
  managerName?: string;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  onClose: () => void;
  onSaved: (newStock: number, newRented?: number) => void;
}

export default function StockAdjustModal({
  scriptUrl, connected, isLightMode, category, rowIndex, itemId, itemLabel, currentStock,
  currentRented, variants, unassignedStock = 0, managerName = "", showToast, onClose, onSaved,
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

  const hasVariants = !!variants && variants.length > 0;
  // 종류별 입력값. 총재고는 이 합계 + 미확인으로 서버가 다시 계산한다.
  const [vStock, setVStock] = useState<Record<number, string>>(() =>
    Object.fromEntries((variants || []).map((v) => [v.id, String(v.stock ?? 0)]))
  );
  const [unassigned, setUnassigned] = useState(String(unassignedStock ?? 0));

  const [newStock, setNewStock] = useState(String(currentStock));
  // 대여 중 수량 편집은 시나리오 물품에서만 지원한다 (창고물품에는 해당 열이 없다)
  const canEditRented = category === "scenario" && currentRented !== undefined;
  const [newRented, setNewRented] = useState(String(currentRented ?? 0));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<StockChangeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!connected || !scriptUrl) return;
    setHistoryLoading(true);
    // COS 물품은 위치(슬롯)에 여러 물품이 같이 놓일 수 있어 슬롯만으로는 특정이 안 된다.
    // 그래서 공구류는 물품명으로, 시나리오 물품은 고유 ID로 이력을 구분한다.
    fetchStockChangeHistory(scriptUrl, category, itemId, category === "inventory" ? itemLabel : undefined)
      .then(setHistory)
      .catch((e) => showToast(`변경 이력을 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => setHistoryLoading(false));
    // showToast는 매 렌더링마다 새로 만들어지는 함수라 의존성에 넣으면 렌더될 때마다
    // 이력을 다시 불러와 깜빡이게 된다. 조회 조건(scriptUrl/connected/category/itemId/itemLabel)이
    // 바뀔 때만 다시 불러오면 되므로 의도적으로 뺐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptUrl, connected, category, itemId, itemLabel]);

  const parsed = parseInt(newStock, 10);
  const diff = !isNaN(parsed) ? parsed - currentStock : null;
  const parsedRented = parseInt(newRented, 10);
  const rentedDiff = canEditRented && !isNaN(parsedRented) ? parsedRented - (currentRented ?? 0) : null;

  const vTotal = (variants || []).reduce((n, v) => n + (parseInt(vStock[v.id], 10) || 0), 0) + (parseInt(unassigned, 10) || 0);

  async function handleSubmitVariants() {
    if ((variants || []).some((v) => { const n = parseInt(vStock[v.id], 10); return isNaN(n) || n < 0; })) {
      showToast("종류별 재고를 올바르게 입력해주세요.", "warn"); return;
    }
    if (isNaN(parseInt(unassigned, 10)) || parseInt(unassigned, 10) < 0) {
      showToast("미확인 수량을 올바르게 입력해주세요.", "warn"); return;
    }
    if (!reason.trim()) { showToast("재고 변경 사유를 입력해주세요.", "warn"); return; }
    const unchanged = (variants || []).every((v) => (parseInt(vStock[v.id], 10) || 0) === (v.stock ?? 0))
      && (parseInt(unassigned, 10) || 0) === (unassignedStock ?? 0);
    if (unchanged) { showToast("변경된 값이 없습니다.", "warn"); return; }

    setSubmitting(true);
    try {
      const res = await saveScenarioVariants(
        scriptUrl,
        itemId,
        (variants || []).map((v) => ({ id: v.id, name: v.name, stock: parseInt(vStock[v.id], 10) || 0, image: v.image })),
        parseInt(unassigned, 10) || 0,
        managerName,
        { stockAdjustment: true, reason: reason.trim() }
      );
      if (res && res.success === false) { showToast(res.message || "재고 변경에 실패했습니다.", "error"); return; }
      showToast("종류별 재고를 변경했습니다.", "ok");
      window.dispatchEvent(new Event("wms-notifications-changed"));
      onSaved(vTotal, undefined);
      onClose();
    } catch (e: any) {
      showToast(`재고 변경 실패: ${e.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (hasVariants) return handleSubmitVariants();
    if (isNaN(parsed) || parsed < 0) { 
      showToast("새 재고 수량을 올바르게 입력해주세요.", "warn"); 
      return; 
    }
    if (!reason.trim()) { 
      showToast("재고 변경 사유를 입력해주세요.", "warn"); 
      return; 
    }
    if (canEditRented && (isNaN(parsedRented) || parsedRented < 0)) {
      showToast("대여 중 수량을 올바르게 입력해주세요.", "warn");
      return;
    }
    if (parsed === currentStock && (!canEditRented || parsedRented === (currentRented ?? 0))) {
      showToast("변경된 값이 없습니다.", "warn");
      return;
    }

    setSubmitting(true);
    try {
      if (connected && scriptUrl) {
        const res = await adjustStock(scriptUrl, {
          category,
          rowIndex,
          id: itemId,
          newStock: parsed,
          ...(canEditRented ? { newRented: parsedRented } : {}),
          reason: reason.trim(),
          manager: managerName
        });
        if (!res.success) { 
          showToast(res.message || "재고 변경에 실패했습니다.", "error"); 
          return; 
        }
        if (res.warning) showToast(res.warning, "warn");
        else showToast("재고를 변경했습니다.", "ok");
        window.dispatchEvent(new Event("wms-notifications-changed"));
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      onSaved(parsed, canEditRented ? parsedRented : undefined);
      onClose();
    } catch (e: any) {
      showToast(`재고 변경 실패: ${e.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div style={{ width: "min(440px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: "6px", color: C.text }}>
              <ArrowUpDown size={16} style={{ color: C.accent }} /> 재고 변경
            </h2>
            <div style={{ fontSize: "12px", color: C.label, marginTop: "3px" }}>{itemLabel} ({itemId})</div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ width: 40, height: 40, margin: "-8px -8px -8px 0", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "none", border: "none", color: C.label, cursor: "pointer", flexShrink: 0 }}><X size={20} /></button>
        </div>

        <div style={{ padding: "18px 20px" }}>
          {/* 종류가 나뉜 물품은 총재고를 직접 못 고친다 — 서버가 "종류 합계 + 미확인"으로
              다시 계산하기 때문이다. 그래서 종류별 칸을 보여주고 그쪽으로 저장한다. */}
          {hasVariants ? (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: C.text }}>종류별 재고</div>
                <div style={{ fontSize: "11.5px", color: C.label }}>
                  총재고 <b style={{ color: C.text }}>{currentStock}</b> → <b style={{ color: vTotal === currentStock ? C.text : C.accent }}>{vTotal}</b>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {(variants || []).map((v) => {
                  const cur = v.stock ?? 0;
                  const next = parseInt(vStock[v.id], 10);
                  const d = isNaN(next) ? 0 : next - cur;
                  return (
                    <div key={v.id} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 10px", background: C.cardSub, borderRadius: "10px" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.name}
                      </span>
                      {v.rented ? <span style={{ fontSize: "11px", color: C.label, flexShrink: 0 }}>대여 중 {v.rented}</span> : null}
                      <span style={{ fontSize: "11.5px", color: C.label, flexShrink: 0 }}>{cur} →</span>
                      <input
                        type="number"
                        min={0}
                        value={vStock[v.id] ?? ""}
                        onChange={(e) => setVStock((q) => ({ ...q, [v.id]: e.target.value }))}
                        onFocus={(e) => e.target.select()}
                        style={{ width: 62, flexShrink: 0, border: `1px solid ${C.border}`, background: C.card, borderRadius: "8px", padding: "6px 8px", outline: "none", fontSize: "13px", fontWeight: 800, color: C.text, textAlign: "center" }}
                      />
                      <span style={{ width: 34, flexShrink: 0, textAlign: "right", fontSize: "11.5px", fontWeight: 800, color: d === 0 ? "transparent" : d > 0 ? C.success : C.error }}>
                        {d > 0 ? `+${d}` : d}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 10px", background: C.cardSub, borderRadius: "10px", border: `1px dashed ${C.border}` }}>
                  <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 700, color: C.label }}>미확인 (종류 미지정)</span>
                  <span style={{ fontSize: "11.5px", color: C.label, flexShrink: 0 }}>{unassignedStock ?? 0} →</span>
                  <input
                    type="number"
                    min={0}
                    value={unassigned}
                    onChange={(e) => setUnassigned(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ width: 62, flexShrink: 0, border: `1px solid ${C.border}`, background: C.card, borderRadius: "8px", padding: "6px 8px", outline: "none", fontSize: "13px", fontWeight: 800, color: C.text, textAlign: "center" }}
                  />
                  <span style={{ width: 34, flexShrink: 0 }} />
                </div>
              </div>
            </div>
          ) : (
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
                onFocus={(e) => e.target.select()}
                style={{ width: "100%", border: "none", background: "transparent", outline: "none", fontSize: "18px", fontWeight: 800, color: C.text, textAlign: "center" }}
              />
            </div>
          </div>

          )}

          {!hasVariants && diff !== null && diff !== 0 ? (
            <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: diff > 0 ? C.success : C.error, marginBottom: "10px" }}>
              재고 {diff > 0 ? `+${diff}` : diff}개 변경됩니다
            </div>
          ) : null}

          {canEditRented && !hasVariants ? (
            <>
              <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                <div style={{ flex: 1, padding: "10px 12px", background: C.cardSub, borderRadius: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: C.label, fontWeight: 700 }}>현재 대여 중</div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: C.text, marginTop: "2px" }}>{currentRented ?? 0}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", color: C.label }}>→</div>
                <div style={{ flex: 1, padding: "10px 12px", background: C.accentSoft, borderRadius: "10px" }}>
                  <label style={{ fontSize: "11px", color: C.label, fontWeight: 700, display: "block", textAlign: "center" }}>새 대여 중</label>
                  <input
                    type="number"
                    min={0}
                    value={newRented}
                    onChange={(e) => setNewRented(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ width: "100%", border: "none", background: "transparent", outline: "none", fontSize: "18px", fontWeight: 800, color: C.text, textAlign: "center" }}
                  />
                </div>
              </div>
              {rentedDiff !== null && rentedDiff !== 0 ? (
                <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: rentedDiff > 0 ? C.success : C.error, marginBottom: "10px" }}>
                  대여 중 {rentedDiff > 0 ? `+${rentedDiff}` : rentedDiff}개 변경됩니다
                </div>
              ) : null}
              <div style={{ fontSize: "11px", color: C.label, lineHeight: 1.6, marginBottom: "14px" }}>
                대여 중 수량은 대여·반납 기록과 별개로 직접 고칩니다. 실사 결과가 기록과 어긋날 때만 사용해주세요.
              </div>
            </>
          ) : <div style={{ marginBottom: "4px" }} />}

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
          {historyLoading ? (
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
