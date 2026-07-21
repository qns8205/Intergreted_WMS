import React, { useMemo, useState } from "react";
import { Check, Minus, Package, Plus, Search, Undo2 } from "lucide-react";
import { InventoryItem, RentLog } from "../types";
import { C, cardStyle, fuzzy, inputStyle, labelStyle, pillBtn, pillGroupStyle, primaryBtn, qtyBtnStyle, secondaryBtnStyle, Spinner } from "../ui";
import { callGas } from "../api";

interface Props {
  scriptUrl: string;
  inventory: InventoryItem[];
  rentLogs: RentLog[];
  onRefresh: () => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  initialType?: "대여" | "반납";
  onBack: () => void;
  title: string;
}

export default function RentalTab({ scriptUrl, inventory, rentLogs, onRefresh, showToast, initialType, onBack, title }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [type, setType] = useState<"대여" | "반납">(initialType || "대여");
  const [qty, setQty] = useState(1);
  const [user, setUser] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const base = search.trim()
      ? inventory.filter((it) => fuzzy(it.name, search) || fuzzy(it.location, search))
      : inventory;
    return base.slice(0, 40);
  }, [inventory, search]);

  async function submit() {
    if (!selected) {
      showToast("물품을 선택해주세요.", "warn");
      return;
    }
    if (!user.trim()) {
      showToast("이름을 입력해주세요.", "warn");
      return;
    }
    setSubmitting(true);
    try {
      await callGas(scriptUrl, "rentInventoryItem", {
        location: selected.location,
        name: selected.name,
        type,
        qty,
        user: user.trim(),
        note: note.trim(),
      });
      showToast(`${type} 처리되었습니다. (${selected.name} x ${qty})`, "ok");
      setSelected(null);
      setQty(1);
      setNote("");
      await onRefresh();
    } catch (e: any) {
      showToast("처리 실패: " + e.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ ...secondaryBtnStyle, padding: "8px 12px" }}>
          ← 메뉴로
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h3>
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>구분</label>
        <div style={pillGroupStyle}>
          <button style={pillBtn(type === "대여")} onClick={() => setType("대여")}>
            <Package size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
            공구 및 부품류 대여
          </button>
          <button style={pillBtn(type === "반납", C.success)} onClick={() => setType("반납")}>
            <Undo2 size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
            공구 및 부품류 반납
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>물품 검색</label>
        <div style={{ position: "relative", marginBottom: 10 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: C.sub }} />
          <input
            style={{ ...inputStyle, paddingLeft: 34 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="품명 · 위치로 검색"
          />
        </div>
        <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: 13 }}>검색 결과가 없습니다.</div>
          ) : (
            filtered.map((it) => (
              <div
                key={it.rowIndex}
                onClick={() => setSelected(it)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderBottom: `1px solid ${C.border}`,
                  cursor: "pointer",
                  background: selected?.rowIndex === it.rowIndex ? C.primaryLight : "transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>
                    {it.location} · 재고 {it.stock ?? "N/A"}
                  </div>
                </div>
                {selected?.rowIndex === it.rowIndex && <Check size={16} style={{ color: C.primary }} />}
              </div>
            ))
          )}
        </div>
      </div>

      {selected && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 14 }}>
            {selected.name}{" "}
            <span style={{ color: C.sub, fontWeight: 400, fontSize: 12 }}>({selected.location})</span>
          </div>
          <label style={labelStyle}>수량</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ ...qtyBtnStyle, width: 36, height: 36 }}>
              <Minus size={14} />
            </button>
            <span style={{ fontWeight: 700, fontSize: 16, minWidth: 24, textAlign: "center" }}>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} style={{ ...qtyBtnStyle, width: 36, height: 36 }}>
              <Plus size={14} />
            </button>
          </div>
          <label style={labelStyle}>신청자 이름</label>
          <input style={{ ...inputStyle, marginBottom: 14 }} value={user} onChange={(e) => setUser(e.target.value)} placeholder="이름을 입력해주세요" />
          <label style={labelStyle}>메모 (선택)</label>
          <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="용도나 특이사항" />
        </div>
      )}

      <button
        style={primaryBtn(!selected || submitting, type === "반납" ? C.success : C.primary)}
        disabled={!selected || submitting}
        onClick={submit}
      >
        {submitting ? <Spinner size={16} /> : type === "대여" ? <Package size={16} /> : <Undo2 size={16} />}
        {submitting ? "처리 중..." : `${type} 신청하기`}
      </button>

      {rentLogs.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.sub, marginBottom: 8 }}>최근 대여/반납 기록</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rentLogs
              .slice(-6)
              .reverse()
              .map((log, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                >
                  <span>
                    {log.type === "대여" ? "📥" : "🔄"} {log.name} x {log.qty}{" "}
                    <span style={{ color: C.sub }}>({log.user})</span>
                  </span>
                  <span style={{ color: C.sub }}>{log.timestamp}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
