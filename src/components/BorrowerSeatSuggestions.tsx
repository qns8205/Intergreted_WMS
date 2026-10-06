import React, { useEffect, useState } from "react";
import { BorrowerSeatRecommendation, fetchRegisteredUser, SeatFloor } from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  employeeId: string;
  floors: SeatFloor[];
  seatsLoaded: boolean;
  selectedFloor: string;
  selectedUnit: string;
  onSelect: (floor: string, unit: string) => void;
}

/** 사번 확인 응답의 추천만 사용한다. 대여자를 관리자 이력 조회에 연결하지 않는다. */
export default function BorrowerSeatSuggestions({ scriptUrl, connected, isLightMode, employeeId, floors, seatsLoaded, selectedFloor, selectedUnit, onSelect }: Props) {
  const id = employeeId.trim();
  const [result, setResult] = useState<{ id: string; found: boolean; name?: string; items: BorrowerSeatRecommendation[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    if (!connected || !scriptUrl || !/^\d{4}$/.test(id)) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchRegisteredUser(scriptUrl, id, { includeSeatRecommendations: true })
        .then((user) => { if (!cancelled) setResult({ id, found: user.found, name: user.name, items: user.seatRecommendations || [] }); })
        .catch(() => { if (!cancelled) setError(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [scriptUrl, connected, id]);

  const border = isLightMode ? "#e6e9ef" : "#26324a";
  const text = isLightMode ? "#111827" : "#f1f5f9";
  const dim = isLightMode ? "#64748b" : "#94a3b8";
  const card = isLightMode ? "#ffffff" : "#161f30";
  const current = result?.id === id ? result : null;
  const items = (current?.items || []).flatMap((item) => {
    const floor = floors.find((f) => f.id === item.floor || f.name === item.floor);
    return floor?.units.some((u) => u.label === item.unit) ? [{ ...item, floor: floor.name || floor.id }] : [];
  }).slice(0, 3);
  const message = !/^\d{4}$/.test(id) ? "4자리 사번을 입력하면 자주 사용한 유닛을 추천합니다."
    : !connected || !scriptUrl ? "서버에 연결하면 유닛 추천을 확인할 수 있습니다."
    : loading || !seatsLoaded ? "자주 사용한 유닛을 확인하는 중입니다..."
    : error ? "유닛 추천을 불러오지 못했습니다. 아래에서 좌석을 직접 선택해주세요."
    : current && !current.found ? "등록된 사번을 찾지 못했습니다. 사번을 확인해주세요."
    : !items.length ? "추천할 대여 이력이 없습니다. 아래에서 좌석을 선택해주세요." : "";

  return <section aria-label="자주 사용하는 유닛" style={{ marginBottom: 24, padding: "16px 18px", borderRadius: 12, border: `1px solid ${border}`, background: isLightMode ? "#f4f6f9" : "#0f172a", color: text }}>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>자주 사용하는 유닛</h2>
      {current?.found && current.name ? <span style={{ color: dim, fontSize: 13 }}>{current.name}님</span> : null}
    </div>
    {message ? <p role="status" style={{ margin: 0, fontSize: 14, color: dim, lineHeight: 1.5 }}>{message}</p>
      : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{items.map((item) => {
        const selected = selectedFloor === item.floor && selectedUnit === item.unit;
        return <button key={`${item.floor}:${item.unit}`} type="button" aria-pressed={selected}
          onClick={() => onSelect(item.floor, item.unit)}
          style={{ textAlign: "left", padding: "12px 14px", borderRadius: 11, border: `1px solid ${selected ? "#2563eb" : border}`, background: selected ? "rgba(37,99,235,.1)" : card, color: text, cursor: "pointer" }}>
          <b style={{ display: "block", fontSize: 14 }}>{item.floor} · {item.unit}</b>
          <span style={{ display: "block", marginTop: 4, fontSize: 12, color: dim }}>대여 {item.count}회</span>
        </button>;
      })}</div>}
  </section>;
}
