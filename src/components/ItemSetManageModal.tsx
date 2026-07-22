import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Trash2, Search, Save, PackageOpen, Pencil } from "lucide-react";
import { InventoryItem } from "../types";
import { ItemSet, fetchItemSets, saveItemSet, deleteItemSet } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  inventory: InventoryItem[];
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  onClose: () => void;
}

/**
 * 물품 세트(여러 부품 묶음) 관리 모달 — 관리자 전용.
 * 창고 물품 대여 화면에서 "세트로 담기"로 노출되는 세트를 여기서 만들고 편집한다.
 */
export default function ItemSetManageModal({ scriptUrl, connected, isLightMode, inventory, showToast, onClose }: Props) {
  const C = {
    overlay: "rgba(0,0,0,0.6)",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#8b98ac",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239,68,68,0.12)",
  };

  const [sets, setSets] = useState<ItemSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ originalName: string | null; name: string; items: { rowIndex: number; location: string; name: string; qty: number }[] } | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    if (!connected || !scriptUrl) return;
    setLoading(true);
    fetchItemSets(scriptUrl)
      .then(setSets)
      .catch((e) => showToast(`세트 목록을 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function startNew() {
    setEditing({ originalName: null, name: "", items: [] });
    setItemSearch("");
  }

  function startEdit(set: ItemSet) {
    // 저장된 세트는 rowIndex가 없으므로(위치+이름으로 저장됨), 현재 재고 목록에서 매칭되는 행을 찾아 붙여준다.
    // 매칭 실패(물품이 삭제된 경우)는 rowIndex -1로 두고, 편집 화면에서 계속 표시는 하되 목록 하이라이트만 안 된다.
    const items = set.items.map((i) => {
      const match = inventory.find((inv) => inv.location.trim().toUpperCase() === i.location.trim().toUpperCase() && inv.name === i.name);
      return { rowIndex: match ? match.rowIndex : -Math.random(), location: i.location, name: i.name, qty: i.qty };
    });
    setEditing({ originalName: set.name, name: set.name, items });
    setItemSearch("");
  }

  function toggleItem(it: InventoryItem) {
    if (!editing) return;
    const idx = editing.items.findIndex((i) => i.rowIndex === it.rowIndex);
    if (idx !== -1) {
      setEditing({ ...editing, items: editing.items.filter((_, i) => i !== idx) });
    } else {
      setEditing({ ...editing, items: [...editing.items, { rowIndex: it.rowIndex, location: it.location, name: it.name, qty: 1 }] });
    }
  }

  function setQty(rowIndex: number, qty: number) {
    if (!editing) return;
    setEditing({ ...editing, items: editing.items.map((i) => (i.rowIndex === rowIndex ? { ...i, qty: Math.max(1, qty) } : i)) });
  }

  async function handleSave() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) { showToast("세트 이름을 입력해주세요.", "warn"); return; }
    if (!editing.items.length) { showToast("세트에 물품을 1개 이상 추가해주세요.", "warn"); return; }
    setSaving(true);
    try {
      if (connected && scriptUrl) {
        const res = await saveItemSet(scriptUrl, { name, items: editing.items, originalName: editing.originalName || undefined });
        if (!res.success) { showToast(res.message || "저장에 실패했습니다.", "error"); return; }
        showToast("세트를 저장했습니다.", "ok");
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      setEditing(null);
      load();
    } catch (e: any) {
      showToast(`저장 실패: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(set: ItemSet) {
    if (!window.confirm(`'${set.name}' 세트를 삭제할까요?`)) return;
    try {
      if (connected && scriptUrl) {
        const res = await deleteItemSet(scriptUrl, set.name);
        if (!res.success) { showToast(res.message || "삭제에 실패했습니다.", "error"); return; }
        showToast("삭제했습니다.", "ok");
      }
      load();
    } catch (e: any) {
      showToast(`삭제 실패: ${e.message}`, "error");
    }
  }

  const filteredInventory = itemSearch.trim()
    ? inventory.filter((it) => smartMatch([it.name, it.location, it.spec, it.keywords], itemSearch))
    : inventory;

  return createPortal(
    <div onClick={() => !editing && onClose()} style={{ position: "fixed", inset: 0, zIndex: 4000, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, flex: 1, display: "flex", alignItems: "center", gap: "6px", color: C.text }}>
            <PackageOpen size={17} style={{ color: C.accent }} /> {editing ? (editing.originalName ? "세트 편집" : "새 세트 만들기") : "물품 세트 관리"}
          </h2>
          <button onClick={() => (editing ? setEditing(null) : onClose())} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ padding: "18px 20px" }}>
          {!editing ? (
            <>
              <button
                onClick={startNew}
                style={{ width: "100%", padding: "12px", borderRadius: "12px", border: `1.5px dashed ${C.accent}`, background: C.accentSoft, color: C.accent, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px" }}
              >
                <Plus size={15} /> 새 세트 만들기
              </button>

              {loading ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "12px" }}>불러오는 중...</div>
              ) : sets.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "13px" }}>등록된 세트가 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {sets.map((set) => (
                    <div key={set.name} style={{ padding: "12px 14px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 800, color: C.text, flex: 1 }}>{set.name}</span>
                        <button onClick={() => startEdit(set)} style={{ width: 30, height: 30, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(set)} style={{ width: 30, height: 30, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} /></button>
                      </div>
                      <div style={{ fontSize: "11.5px", color: C.label }}>
                        {set.items.map((i) => `${i.name} x${i.qty}`).join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "6px" }}>세트 이름 *</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="예: 기본 조립 세트"
                style={{ width: "100%", padding: "11px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none", marginBottom: "14px" }}
              />

              {editing.items.length > 0 ? (
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "6px" }}>선택된 물품 ({editing.items.length}종)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {editing.items.map((it) => (
                      <div key={it.rowIndex} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", background: C.accentSoft, borderRadius: "9px" }}>
                        <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name} <span style={{ color: C.label, fontWeight: 400 }}>({it.location})</span></span>
                        <input
                          type="number"
                          min={1}
                          value={it.qty}
                          onChange={(e) => setQty(it.rowIndex, parseInt(e.target.value, 10) || 1)}
                          style={{ width: "52px", padding: "5px 6px", borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: "12px", textAlign: "center" }}
                        />
                        <button onClick={() => setEditing({ ...editing, items: editing.items.filter((i) => i.rowIndex !== it.rowIndex) })} style={{ width: 26, height: 26, borderRadius: "7px", border: "none", background: "transparent", color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "6px" }}>물품 추가</label>
              <div style={{ position: "relative", marginBottom: "10px" }}>
                <Search size={14} style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="물품명·위치로 검색..."
                  style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "12.5px", outline: "none" }}
                />
              </div>
              <div style={{ maxHeight: "220px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "5px", marginBottom: "18px" }}>
                {filteredInventory.slice(0, 60).map((it) => {
                  const inSet = editing.items.some((i) => i.rowIndex === it.rowIndex);
                  return (
                    <div
                      key={it.rowIndex}
                      onClick={() => toggleItem(it)}
                      style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "9px", border: `1px solid ${inSet ? C.accent : C.border}`, background: inSet ? C.accentSoft : "transparent", cursor: "pointer" }}
                    >
                      <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                      <span style={{ fontSize: "11px", color: C.label, fontFamily: "monospace" }}>{it.location}</span>
                      {inSet ? <Check_ color={C.accent} /> : null}
                    </div>
                  );
                })}
                {filteredInventory.length === 0 ? <div style={{ textAlign: "center", padding: "16px 0", color: C.label, fontSize: "12px" }}>검색 결과가 없습니다.</div> : null}
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px" }}
              >
                <Save size={15} /> {saving ? "저장 중..." : "세트 저장"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 간단한 체크 표시 (별도 아이콘 임포트 없이)
function Check_({ color }: { color: string }) {
  return (
    <span style={{ width: 16, height: 16, borderRadius: "50%", background: color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", flexShrink: 0 }}>✓</span>
  );
}
