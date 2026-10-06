import React, { useEffect, useRef, useState } from "react";
import { Search, UserCheck } from "lucide-react";
import { RegisteredUser, searchRegisteredUsers } from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  name: string;
  employeeId: string;
  onChange: (name: string, employeeId: string) => void;
  isLightMode: boolean;
  placeholder?: string;
}

/** 관리자 입력에서도 자유 문자열 대신 등록 명부의 한 사람을 확정하도록 하는 이름 검색기. */
export default function RegisteredUserPicker({ scriptUrl, name, employeeId, onChange, isLightMode, placeholder = "이름을 검색해주세요" }: Props) {
  const [items, setItems] = useState<RegisteredUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const border = isLightMode ? "#e2e8f0" : "#334155";
  const card = isLightMode ? "#fff" : "#172033";
  const text = isLightMode ? "#111827" : "#f1f5f9";
  const dim = isLightMode ? "#64748b" : "#94a3b8";

  useEffect(() => {
    const q = name.trim();
    if (!q || employeeId) { setItems([]); setLoading(false); return; }
    const request = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const next = await searchRegisteredUsers(scriptUrl, q);
        if (request === requestRef.current) { setItems(next); setOpen(true); }
      } catch {
        if (request === requestRef.current) setItems([]);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [scriptUrl, name, employeeId]);

  return <div style={{ position: "relative" }}>
    <Search size={16} style={{ position: "absolute", left: 14, top: 16, color: dim, zIndex: 1 }} />
    <input
      value={name}
      onChange={(e) => { onChange(e.target.value, ""); setOpen(true); }}
      onFocus={() => { if (!employeeId && name.trim()) setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      placeholder={placeholder}
      autoComplete="off"
      style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px 14px 40px", borderRadius: 12, border: `1px solid ${employeeId ? "#22c55e" : border}`, background: card, color: text, outline: "none", fontSize: 15, fontWeight: 700 }}
    />
    {employeeId ? <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, color: "#16a34a", fontSize: 12, fontWeight: 800 }}><UserCheck size={14} />명부 확인됨 <span style={{ color: dim, fontFamily: "monospace", fontSize: 11 }}>사번 {employeeId}</span></div> : null}
    {open && !employeeId ? <div style={{ position: "absolute", zIndex: 100, top: 51, left: 0, right: 0, maxHeight: 230, overflowY: "auto", borderRadius: 12, border: `1px solid ${border}`, background: card, boxShadow: "0 12px 30px rgba(15,23,42,.22)" }}>
      {loading ? <div style={{ padding: 14, color: dim, fontSize: 12 }}>명부 검색 중...</div> : items.length ? items.map((user) => <button
        key={user.employeeId}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { onChange(user.name, user.employeeId); setOpen(false); }}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", border: 0, borderBottom: `1px solid ${border}`, background: "transparent", color: text, textAlign: "left", cursor: "pointer" }}
      ><b>{user.name}</b><small style={{ color: dim, fontFamily: "monospace" }}>사번 {user.employeeId}</small></button>) : <div style={{ padding: 14, color: dim, fontSize: 12 }}>일치하는 등록 사용자가 없습니다.</div>}
    </div> : null}
  </div>;
}
