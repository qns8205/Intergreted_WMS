import React, { useEffect, useState } from "react";
import {
  ArrowLeft, Plus, Trash2, Sun, Moon, X, Package, User, Clock,
} from "lucide-react";
import {
  SeatFloor, SeatMap, fetchSeatMap, saveSeatMap,
  SeatOccupancyEntry, fetchSeatOccupancy,
} from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  onBack: () => void;
}

function makeFloorId(existing: SeatFloor[]): string {
  let n = 1;
  while (existing.some((f) => f.id === `F${n}`)) n++;
  return `F${n}`;
}

export default function SeatMapAdminPage({ scriptUrl, connected, isLightMode, showToast, onBack }: Props) {
  const C = {
    bg: isLightMode ? "#f4f6f9" : "#0b1120",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#8b98ac",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    success: isLightMode ? "#0d9488" : "#34d399",
    successSoft: "rgba(16,185,129,0.12)",
    warn: "#d97706",
    warnSoft: "rgba(217,119,6,0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239,68,68,0.12)",
  };

  const [floors, setFloors] = useState<SeatFloor[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [shift, setShift] = useState<"day" | "night">("day");

  const [occModal, setOccModal] = useState<{ floor: string; unit: string } | null>(null);
  const [occEntries, setOccEntries] = useState<SeatOccupancyEntry[]>([]);
  const [occLoading, setOccLoading] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    if (!connected || !scriptUrl) return;
    setLoading(true);
    fetchSeatMap(scriptUrl)
      .then((m) => {
        setFloors(m.floors || []);
        if (m.floors && m.floors.length && !activeFloorId) setActiveFloorId(m.floors[0].id);
      })
      .catch((e) => showToast(`좌석맵을 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => setLoading(false));
  }

  async function persist(next: SeatFloor[]) {
    setFloors(next);
    setSaving(true);
    try {
      if (connected && scriptUrl) {
        const res = await saveSeatMap(scriptUrl, { floors: next } as SeatMap);
        if (!res.success) showToast(res.message || "저장에 실패했습니다.", "error");
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
    } catch (e: any) {
      showToast(`저장 실패: ${e.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  const activeFloor = floors.find((f) => f.id === activeFloorId) || null;

  function addFloor() {
    const id = makeFloorId(floors);
    const next = [...floors, { id, name: id, rows: 3, cols: 4, units: [] }];
    persist(next);
    setActiveFloorId(id);
  }

  function renameFloor(name: string) {
    if (!activeFloor) return;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, name } : f)));
  }

  function deleteFloor() {
    if (!activeFloor) return;
    if (!window.confirm(`'${activeFloor.name || activeFloor.id}' 층을 삭제할까요? 배치된 유닛도 함께 사라집니다.`)) return;
    const next = floors.filter((f) => f.id !== activeFloor.id);
    persist(next);
    setActiveFloorId(next[0]?.id || "");
  }

  function addRow() {
    if (!activeFloor) return;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, rows: f.rows + 1 } : f)));
  }
  function removeRow() {
    if (!activeFloor || activeFloor.rows <= 1) return;
    const newRows = activeFloor.rows - 1;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, rows: newRows, units: f.units.filter((u) => u.row < newRows) } : f)));
  }
  function addCol() {
    if (!activeFloor) return;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, cols: f.cols + 1 } : f)));
  }
  function removeCol() {
    if (!activeFloor || activeFloor.cols <= 1) return;
    const newCols = activeFloor.cols - 1;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, cols: newCols, units: f.units.filter((u) => u.col < newCols) } : f)));
  }

  function toggleCell(row: number, col: number) {
    if (!activeFloor) return;
    const existing = activeFloor.units.find((u) => u.row === row && u.col === col);
    if (existing) {
      persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, units: f.units.filter((u) => !(u.row === row && u.col === col)) } : f)));
    } else {
      const nextNum = activeFloor.units.length + 1;
      const label = `Unit ${nextNum}`;
      persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, units: [...f.units, { row, col, label }] } : f)));
    }
  }

  function renameUnit(row: number, col: number, label: string) {
    if (!activeFloor) return;
    persist(floors.map((f) => (f.id === activeFloor.id ? { ...f, units: f.units.map((u) => (u.row === row && u.col === col ? { ...u, label } : u)) } : f)));
  }

  function openOccupancy(unitLabel: string) {
    if (!activeFloor) return;
    setOccModal({ floor: activeFloor.id, unit: unitLabel });
    setOccLoading(true);
    if (connected && scriptUrl) {
      fetchSeatOccupancy(scriptUrl, activeFloor.id, unitLabel, shift)
        .then(setOccEntries)
        .catch((e) => showToast(`조회 실패: ${e.message}`, "error"))
        .finally(() => setOccLoading(false));
    } else {
      setOccEntries([]);
      setOccLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          <ArrowLeft size={15} /> 뒤로
        </button>
        <h1 style={{ fontSize: "17px", fontWeight: 800, margin: 0, flex: 1 }}>좌석 배치도 관리</h1>

        {/* Day / Night 전환 */}
        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden" }}>
          <button
            onClick={() => setShift("day")}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 14px", border: "none", background: shift === "day" ? C.warn : C.card, color: shift === "day" ? "#fff" : C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
          >
            <Sun size={14} /> Day Shift
          </button>
          <button
            onClick={() => setShift("night")}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 14px", border: "none", borderLeft: `1px solid ${C.border}`, background: shift === "night" ? C.accent : C.card, color: shift === "night" ? "#fff" : C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
          >
            <Moon size={14} /> Night Shift
          </button>
        </div>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 20px 80px" }}>
        {/* 층 선택/관리 */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "20px" }}>
          {floors.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFloorId(f.id)}
              style={{ padding: "9px 16px", borderRadius: "10px", border: `1.5px solid ${f.id === activeFloorId ? C.accent : C.border}`, background: f.id === activeFloorId ? C.accentSoft : C.card, color: f.id === activeFloorId ? C.accent : C.text, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
            >
              {f.name || f.id}
            </button>
          ))}
          <button onClick={addFloor} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "9px 14px", borderRadius: "10px", border: `1.5px dashed ${C.accent}`, background: C.accentSoft, color: C.accent, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>
            <Plus size={14} /> 층 추가
          </button>
          {saving ? <span style={{ fontSize: "12px", color: C.label }}>저장 중...</span> : null}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.label }}>불러오는 중...</div>
        ) : !activeFloor ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.label, fontSize: "13px" }}>
            아직 등록된 층이 없습니다. "층 추가"로 시작해보세요.
          </div>
        ) : (
          <div style={{ background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
              <input
                value={activeFloor.name}
                onChange={(e) => renameFloor(e.target.value)}
                placeholder="층 이름 (예: B2)"
                style={{ ...inputStyle, fontWeight: 700, fontSize: "14px", flex: "1 1 160px" }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button onClick={addRow} style={{ padding: "8px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>행 추가</button>
                <button onClick={removeRow} style={{ padding: "8px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>행 제거</button>
                <button onClick={addCol} style={{ padding: "8px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>열 추가</button>
                <button onClick={removeCol} style={{ padding: "8px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>열 제거</button>
              </div>
              <button onClick={deleteFloor} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 12px", borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                <Trash2 size={13} /> 층 삭제
              </button>
            </div>

            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px" }}>
              빈 칸을 클릭하면 유닛이 생기고, 유닛을 다시 클릭하면 없어집니다. 유닛 이름은 칸 안 입력창에서 바로 바꿀 수 있어요.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: `repeat(${activeFloor.cols}, 1fr)`, gap: "10px" }}>
              {Array.from({ length: activeFloor.rows }).map((_, r) =>
                Array.from({ length: activeFloor.cols }).map((_, c) => {
                  const unit = activeFloor.units.find((u) => u.row === r && u.col === c);
                  return unit ? (
                    <div
                      key={`${r}-${c}`}
                      style={{ borderRadius: "12px", border: `1.5px solid ${C.accent}`, background: C.accentSoft, padding: "10px", minHeight: "64px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}
                    >
                      <input
                        value={unit.label}
                        onChange={(e) => renameUnit(r, c, e.target.value)}
                        style={{ background: "transparent", border: "none", outline: "none", fontWeight: 800, fontSize: "13px", color: C.accent, width: "100%" }}
                      />
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => openOccupancy(unit.label)}
                          style={{ flex: 1, padding: "6px", borderRadius: "7px", border: "none", background: C.card, color: C.text, cursor: "pointer", fontSize: "11px", fontWeight: 700 }}
                        >
                          조회
                        </button>
                        <button
                          onClick={() => toggleCell(r, c)}
                          style={{ padding: "6px 8px", borderRadius: "7px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer" }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => toggleCell(r, c)}
                      style={{ borderRadius: "12px", border: `1.5px dashed ${C.border}`, minHeight: "64px", display: "flex", alignItems: "center", justifyContent: "center", color: C.label, fontSize: "12px", cursor: "pointer" }}
                    >
                      + 유닛 추가
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 좌석 점유 조회 모달 */}
      {occModal ? (
        <div onClick={() => setOccModal(null)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0 }}>{occModal.floor} · {occModal.unit}</h2>
                <div style={{ fontSize: "12px", color: C.label, marginTop: "3px", display: "flex", alignItems: "center", gap: "5px" }}>
                  {shift === "day" ? <Sun size={12} /> : <Moon size={12} />} {shift === "day" ? "Day Shift" : "Night Shift"}
                </div>
              </div>
              <button onClick={() => setOccModal(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              {occLoading ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "12px" }}>불러오는 중...</div>
              ) : occEntries.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "13px" }}>이 시프트에 이 유닛에서 대여한 기록이 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {occEntries.map((e, i) => (
                    <div key={i} style={{ padding: "12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "13.5px", color: C.text, marginBottom: "4px" }}>
                        <User size={13} /> {e.borrowerName || "(대여자 미상)"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.label, marginBottom: "8px" }}>
                        <Clock size={11} /> {e.timestamp}
                      </div>
                      {e.items.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          {e.items.map((it, j) => (
                            <div key={j} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: C.text }}>
                              <Package size={11} style={{ color: C.label, flexShrink: 0 }} /> {it.name} <span style={{ color: C.label }}>x{it.qty}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: "11px", color: C.label }}>대여 물품 정보 없음</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
