import React, { useEffect } from "react";
import { Layers, X } from "lucide-react";
import { SeatFloor } from "../utils/borrowApi";

interface Props {
  C: any;
  floors: SeatFloor[];
  activeFloorId: string;
  selectedFloor: string;
  selectedUnit: string;
  onFloorChange: (id: string) => void;
  onSelect: (floor: SeatFloor, unit: SeatFloor["units"][number]) => void;
  onClose: () => void;
}

export default function SeatMapViewerModal({ C, floors, activeFloorId, selectedFloor, selectedUnit, onFloorChange, onSelect, onClose }: Props) {
  const floor = floors.find((f) => f.id === activeFloorId) || floors[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!floor) return null;
  const floorName = floor.name || floor.id;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", background: "rgba(15,23,42,0.66)", backdropFilter: "blur(3px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(820px, 100%)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column", borderRadius: "18px", border: `1px solid ${C.border}`, background: C.card, color: C.text, boxShadow: "0 24px 70px rgba(0,0,0,0.32)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "17px 20px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", display: "grid", placeItems: "center", background: C.accentSoft, color: C.accent }}><Layers size={18} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "16px", fontWeight: 900 }}>좌석 배치도</div>
            <div style={{ marginTop: "2px", fontSize: "11.5px", color: C.label }}>층을 바꿔 위치를 확인하거나 좌석을 눌러 바로 선택하세요.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: "pointer" }}><X size={17} /></button>
        </div>
        <div style={{ display: "flex", gap: "7px", padding: "12px 20px", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
          {floors.map((f) => {
            const active = f.id === floor.id;
            return <button key={f.id} type="button" onClick={() => onFloorChange(f.id)} style={{ padding: "8px 15px", borderRadius: "9px", border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentSoft : C.cardSub, color: active ? C.accent : C.text, cursor: "pointer", fontSize: "12.5px", fontWeight: 800, whiteSpace: "nowrap" }}>{f.name || f.id}</button>;
          })}
        </div>
        <div style={{ padding: "18px 20px 22px", overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "11px" }}>
            <strong style={{ fontSize: "14px" }}>{floorName} 좌석</strong>
            <span style={{ fontSize: "11px", color: C.label }}>위쪽을 기준으로 표시됩니다</span>
          </div>
          <div style={{ minWidth: Math.max(430, floor.cols * 112) }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${floor.cols}, minmax(98px, 1fr))`, gap: "9px", padding: "13px", borderRadius: "14px", border: `1px solid ${C.border}`, background: C.cardSub }}>
              {Array.from({ length: floor.rows }).flatMap((_, row) => Array.from({ length: floor.cols }).map((__, col) => {
                const unit = floor.units.find((u) => u.row === row && u.col === col);
                if (!unit) return <div key={`${row}-${col}`} aria-hidden="true" style={{ height: 68, borderRadius: "10px", border: `1px dashed ${C.border}`, background: C.card, opacity: 0.38 }} />;
                const chosen = selectedFloor === floorName && selectedUnit === unit.label;
                return <button key={`${row}-${col}`} type="button" onClick={() => onSelect(floor, unit)} style={{ height: 68, padding: "8px", borderRadius: "10px", border: `1.5px solid ${chosen ? C.success || "#16a34a" : C.accent}`, background: chosen ? C.successSoft || "rgba(22,163,74,.1)" : C.accentSoft, color: chosen ? C.success || "#16a34a" : C.accent, cursor: "pointer", fontSize: "12px", fontWeight: 850, lineHeight: 1.35, overflow: "hidden", wordBreak: "keep-all" }}>{unit.label}{chosen ? <span style={{ display: "block", marginTop: 3, fontSize: "10px", fontWeight: 800 }}>현재 선택</span> : null}</button>;
              }))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
