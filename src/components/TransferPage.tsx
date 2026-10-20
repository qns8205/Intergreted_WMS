/**
 * 대여자 본인 양도.
 *
 * 1) 지금 들고 있는 물품 중 넘길 것을 고른다(대여 확인 전 물품은 넘길 실물이 없어 막는다).
 * 2) 넘겨주는 애니메이션 뒤에 받는 사람(등록 명부 검색)과 받는 사람의 좌석을 고른다.
 * 3) 서버가 한 번에 옮기고 나면 완료 화면을 보여준다.
 *
 * 이 화면은 App이 일찍 반환하는 화면이라 앱 토스트가 그려지지 않는다 — 오류는 화면 안에 띄운다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Handshake, Layers, Minus, Package, Plus, RotateCcw, User, Warehouse } from "lucide-react";
import { fetchMyTransferableItems, fetchSeatMap, postTransferMyItems, SeatFloor, TransferableItem, TransferResult } from "../utils/borrowApi";
import { getThumbImageUrl } from "../utils/drive";
import RegisteredUserPicker from "./RegisteredUserPicker";
import SeatMapViewerModal from "./SeatMapViewerModal";
import RentalTermsFields, { RentalMode } from "./RentalTermsFields";
import type { BorrowerSession } from "./BorrowerLoginPage";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  session: BorrowerSession;
  onBack: () => void;
  onOpenMyLookup: () => void;
}

const SEAT_MAP_CACHE_KEY = "wms_seat_map_v1";
const HANDOFF_MS = 1300;

type Step = "items" | "handoff" | "target" | "done";

export default function TransferPage({ scriptUrl, connected, isLightMode, session, onBack, onOpenMyLookup }: Props) {
  const C = {
    bg: isLightMode ? "#f7f8fa" : "#0b1120",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: isLightMode ? "rgba(220,38,38,0.08)" : "rgba(248,113,113,0.14)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: isLightMode ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.14)",
  };

  const [step, setStep] = useState<Step>("items");
  const [items, setItems] = useState<TransferableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // 고른 물품과 넘길 수량. 수량이 여러 개인 줄은 일부만 넘길 수 있다.
  const [picked, setPicked] = useState<Record<string, number>>({});

  const [toName, setToName] = useState("");
  const [toEmployeeId, setToEmployeeId] = useState("");
  const [selFloor, setSelFloor] = useState("");
  const [selUnit, setSelUnit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 대여 방식이 없는 예전 대여를 넘길 때, 그 물품 모두에 한 번에 적용할 받는 사람의 대여 방식.
  const [rentalMode, setRentalMode] = useState<RentalMode | null>(null);
  const [rentalReason, setRentalReason] = useState("");
  const [rentalDueDate, setRentalDueDate] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<TransferResult | null>(null);

  const [seatMap, setSeatMap] = useState<SeatFloor[]>(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SEAT_MAP_CACHE_KEY) || "null");
      if (Array.isArray(parsed)) return parsed as SeatFloor[];
    } catch { /* 캐시가 없거나 깨졌으면 빈 값으로 시작 */ }
    return [];
  });
  const [seatMapLoaded, setSeatMapLoaded] = useState(false);
  const [seatMapOpen, setSeatMapOpen] = useState(false);
  const [seatMapViewFloor, setSeatMapViewFloor] = useState("");

  const load = () => {
    if (!connected || !scriptUrl) { setLoading(false); setLoadError("서버에 연결되어 있지 않습니다."); return; }
    setLoading(true);
    setLoadError("");
    fetchMyTransferableItems(scriptUrl, session.employeeId)
      .then((next) => {
        setItems(next);
        // 새로 받은 목록에 없거나 이제 넘길 수 없는 줄은 선택에서 뺀다.
        setPicked((prev) => {
          const kept: Record<string, number> = {};
          for (const item of next) {
            if (item.transferable && prev[item.key]) kept[item.key] = Math.min(prev[item.key], item.quantity);
          }
          return kept;
        });
      })
      .catch((e: any) => setLoadError(e?.message || "대여 중인 물품을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  };
  useEffect(load, [connected, scriptUrl, session.employeeId]);

  useEffect(() => {
    if (!connected || !scriptUrl) { setSeatMapLoaded(true); return; }
    fetchSeatMap(scriptUrl)
      .then((m) => {
        const floors = m.floors || [];
        setSeatMap(floors);
        try { sessionStorage.setItem(SEAT_MAP_CACHE_KEY, JSON.stringify(floors)); } catch { /* 저장 실패는 무시 */ }
      })
      .catch((e: any) => console.error("[좌석배치도 조회 실패]", e))
      .finally(() => setSeatMapLoaded(true));
  }, [connected, scriptUrl]);

  // 넘겨주는 애니메이션이 끝나면 받는 사람 단계로 넘어간다.
  useEffect(() => {
    if (step !== "handoff") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setStep("target"), reduced ? 0 : HANDOFF_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  /** "Unit 3"처럼 번호만 붙은 이름을 먼저, 그다음 숫자 순으로 둔다(로그인 좌석 선택과 같다). */
  const units = useMemo(() => {
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    return [...(floor?.units || [])].sort((a, b) => {
      const plainA = /^unit\s*\d+$/i.test(a.label.trim());
      const plainB = /^unit\s*\d+$/i.test(b.label.trim());
      if (plainA !== plainB) return plainA ? -1 : 1;
      const nA = parseInt((a.label.match(/\d+/) || ["Infinity"])[0], 10);
      const nB = parseInt((b.label.match(/\d+/) || ["Infinity"])[0], 10);
      if (nA !== nB) return nA - nB;
      return a.label.localeCompare(b.label);
    });
  }, [seatMap, selFloor]);

  const transferable = items.filter((i) => i.transferable);
  const blocked = items.filter((i) => !i.transferable);
  const selected = items.filter((i) => picked[i.key]);
  const selectedQty = selected.reduce((n, i) => n + picked[i.key], 0);
  const allPicked = transferable.length > 0 && transferable.every((i) => picked[i.key]);
  const seatRequired = seatMapLoaded && seatMap.length > 0;
  const isSelf = !!toEmployeeId && toEmployeeId === session.employeeId;
  const needsMode = selected.filter((i) => i.needsRentalMode);
  const rentalTermsReady = !needsMode.length || (!!rentalMode && (rentalMode === "general" || !!rentalReason.trim()) && (rentalMode !== "long_term" || !!rentalDueDate));
  const canSubmit = selected.length > 0 && !!toEmployeeId && !isSelf && (!seatRequired || (!!selFloor && !!selUnit)) && rentalTermsReady && !submitting;

  const toggle = (item: TransferableItem) => {
    if (!item.transferable) return;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[item.key]) delete next[item.key];
      else next[item.key] = item.quantity;
      return next;
    });
  };
  const setQty = (item: TransferableItem, qty: number) =>
    setPicked((prev) => ({ ...prev, [item.key]: Math.max(1, Math.min(item.quantity, qty)) }));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await postTransferMyItems(scriptUrl, {
        employeeId: session.employeeId,
        toEmployeeId,
        floor: selFloor,
        unit: selUnit,
        items: selected.map((i) => ({ key: i.key, quantity: picked[i.key] })),
        rentalTerms: needsMode.length && rentalMode ? { mode: rentalMode, reason: rentalMode === "general" ? "" : rentalReason.trim(), dueDate: rentalMode === "long_term" ? rentalDueDate : "" } : undefined,
      });
      setResult(res);
      setStep("done");
    } catch (e: any) {
      setSubmitError(e?.message || "양도하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = { display: "block", fontSize: "15px", fontWeight: 800, marginBottom: "9px", color: C.text };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "16px 18px", borderRadius: "12px",
    border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "17px", fontWeight: 600,
  };
  const primaryButton = (enabled: boolean): React.CSSProperties => ({
    width: "100%", padding: "19px", borderRadius: "13px", border: "none",
    background: enabled ? C.accent : C.border, color: enabled ? "#fff" : C.label, fontSize: "18px", fontWeight: 800,
    cursor: enabled ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
  });

  const thumb = (item: TransferableItem, size = 46) => (
    <div style={{ flex: `0 0 ${size}px`, width: size, height: size, borderRadius: 11, overflow: "hidden", background: C.accentSoft, color: C.accent, display: "grid", placeItems: "center" }}>
      {item.image
        ? <img src={getThumbImageUrl(item.image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : item.kind === "warehouse" ? <Warehouse size={size * 0.45} /> : <Package size={size * 0.45} />}
    </div>
  );

  const itemMeta = (item: TransferableItem) => [
    item.variantName ? `종류 ${item.variantName}` : "",
    item.kind === "warehouse" ? "COS 물품" : item.scenarioId,
    item.borrowDate ? `대여 ${item.borrowDate.slice(0, 10)}` : "",
  ].filter(Boolean).join(" · ");

  const title = step === "done" ? "양도 완료" : "양도";
  const stepMark = step === "items" ? "1 / 2" : step === "done" ? "" : "2 / 2";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <style>{`
        @keyframes tfFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes tfTravel { 0% { left: 18%; opacity: 0; transform: translate(-50%, -50%) scale(.7); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 85% { opacity: 1; } 100% { left: 82%; opacity: 0; transform: translate(-50%, -50%) scale(.85); } }
        @keyframes tfPulse { 0%, 55% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,.0); } 75% { transform: scale(1.08); box-shadow: 0 0 0 10px rgba(37,99,235,.15); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37,99,235,0); } }
        @keyframes tfDash { to { stroke-dashoffset: -24; } }
        @keyframes tfPop { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
        @keyframes tfCheck { from { stroke-dashoffset: 40; } to { stroke-dashoffset: 0; } }
        .tf-step { animation: tfFadeUp .32s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .tf-step, .tf-anim { animation: none !important; } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <button
          onClick={() => {
            if (step === "target") { setSubmitError(""); setStep("items"); return; }
            onBack();
          }}
          disabled={submitting || step === "handoff"}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "11px 18px", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "15px", fontWeight: 600 }}
        >
          <ArrowLeft size={15} /> {step === "done" ? "처음 화면" : "이전"}
        </button>
        <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, flex: 1 }}>{title}</h1>
        {stepMark ? <span style={{ fontSize: "13px", fontWeight: 800, color: C.label }}>{stepMark}</span> : null}
      </div>

      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 20px 120px" }}>
        {step === "items" ? (
          <div className="tf-step" key="items">
            <div style={{ marginBottom: "22px", padding: "18px 20px", background: C.accentSoft, borderRadius: "14px", borderLeft: `5px solid ${C.accent}`, fontSize: "15px", lineHeight: 1.6 }}>
              <b>{session.name}</b>님이 대여 중인 물품입니다. 다른 사람에게 넘길 물품을 골라주세요.
              <div style={{ fontSize: "13px", color: C.label, marginTop: "4px" }}>대여 확인을 마쳐 실제로 받아 간 물품만 양도할 수 있습니다.</div>
            </div>

            {loading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: C.label, fontSize: "15px" }}>대여 중인 물품을 불러오는 중...</div>
            ) : loadError ? (
              <div style={{ padding: "18px 20px", borderRadius: "12px", background: C.errorSoft, color: C.error, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ flex: 1 }}>{loadError}</span>
                <button type="button" onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "9px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.text, fontWeight: 800, cursor: "pointer" }}><RotateCcw size={14} /> 다시 시도</button>
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center", color: C.label, fontSize: "16px", border: `1px dashed ${C.border}`, borderRadius: "14px", background: C.card }}>
                지금 대여 중인 물품이 없습니다.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 800, color: C.label }}>양도할 수 있는 물품 {transferable.length}종</span>
                  {transferable.length ? (
                    <button
                      type="button"
                      onClick={() => setPicked(allPicked ? {} : Object.fromEntries(transferable.map((i) => [i.key, i.quantity])))}
                      style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
                    >
                      {allPicked ? "선택 해제" : "전체 선택"}
                    </button>
                  ) : null}
                </div>
                {[...transferable, ...blocked].map((item) => {
                  const on = !!picked[item.key];
                  return (
                    <div
                      key={item.key}
                      role="checkbox"
                      aria-checked={on}
                      aria-disabled={!item.transferable}
                      tabIndex={item.transferable ? 0 : -1}
                      onClick={() => toggle(item)}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(item); } }}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px", padding: "14px", marginBottom: "9px", borderRadius: "14px",
                        border: `1.5px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.card,
                        cursor: item.transferable ? "pointer" : "not-allowed", opacity: item.transferable ? 1 : 0.55,
                        transition: "border-color .15s, background .15s",
                      }}
                    >
                      <div style={{ flex: "0 0 24px", width: 24, height: 24, borderRadius: 7, border: `2px solid ${on ? C.accent : C.border}`, background: on ? C.accent : "transparent", color: "#fff", display: "grid", placeItems: "center" }}>
                        {on ? <Check size={15} strokeWidth={3} /> : null}
                      </div>
                      {thumb(item)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "16px", fontWeight: 800, overflowWrap: "anywhere" }}>
                          {item.name}
                          {item.quantity > 1 ? <span style={{ color: C.label, fontWeight: 700 }}> × {item.quantity}</span> : null}
                        </div>
                        {itemMeta(item) ? <div style={{ fontSize: "12.5px", color: C.label, marginTop: "3px" }}>{itemMeta(item)}</div> : null}
                      </div>
                      {!item.transferable ? (
                        <span style={{ flexShrink: 0, padding: "5px 9px", borderRadius: "8px", background: C.cardSub, color: C.label, fontSize: "12px", fontWeight: 800 }}>{item.reason || "양도 불가"}</span>
                      ) : on && item.quantity > 1 ? (
                        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                          <button type="button" aria-label="한 개 줄이기" onClick={() => setQty(item, picked[item.key] - 1)} style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.text, display: "grid", placeItems: "center", cursor: "pointer" }}><Minus size={15} /></button>
                          <span style={{ minWidth: 34, textAlign: "center", fontSize: "16px", fontWeight: 900 }}>{picked[item.key]}</span>
                          <button type="button" aria-label="한 개 늘리기" onClick={() => setQty(item, picked[item.key] + 1)} style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.text, display: "grid", placeItems: "center", cursor: "pointer" }}><Plus size={15} /></button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </>
            )}

            <div style={{ position: "sticky", bottom: 0, paddingTop: "16px", paddingBottom: "16px", background: `linear-gradient(to bottom, transparent, ${C.bg} 30%)` }}>
              <button type="button" disabled={!selected.length} onClick={() => setStep("handoff")} style={primaryButton(selected.length > 0)}>
                {selected.length ? <>다음 · {selected.length}종 {selectedQty}개 <ChevronRight size={17} /></> : "넘길 물품을 골라주세요"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "handoff" ? (
          <div className="tf-step" key="handoff" aria-live="polite" style={{ padding: "60px 0 20px", textAlign: "center" }}>
            <div style={{ position: "relative", height: "150px", maxWidth: "520px", margin: "0 auto" }}>
              <svg width="100%" height="150" viewBox="0 0 520 150" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
                <line x1="110" y1="75" x2="410" y2="75" stroke={C.accent} strokeOpacity=".45" strokeWidth="3" strokeDasharray="8 8" className="tf-anim" style={{ animation: "tfDash .5s linear infinite" }} />
              </svg>
              <div style={{ position: "absolute", left: "18%", top: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
                <div style={{ width: 78, height: 78, borderRadius: "50%", background: C.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: "26px", fontWeight: 900 }}>{session.name.slice(0, 1)}</div>
                {/* 이름은 원 아래에 띄워, 원의 중심이 점선과 같은 높이에 오게 한다 */}
                <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 8, whiteSpace: "nowrap", fontSize: "13px", fontWeight: 800, color: C.label }}>{session.name}</div>
              </div>
              <div style={{ position: "absolute", left: "82%", top: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
                {/* 위치용 translate와 맥박용 scale이 서로 덮어쓰지 않게 맥박은 안쪽 원에만 건다 */}
                <div className="tf-anim" style={{ width: 78, height: 78, borderRadius: "50%", border: `3px dashed ${C.accent}`, background: C.card, color: C.accent, display: "grid", placeItems: "center", animation: `tfPulse ${HANDOFF_MS}ms ease-out both` }}><User size={32} /></div>
              </div>
              {selected.slice(0, 3).map((item, index) => (
                <div
                  key={item.key}
                  className="tf-anim"
                  style={{
                    position: "absolute", top: "50%", left: "18%", width: 54, height: 54, borderRadius: 14, overflow: "hidden",
                    border: `2px solid ${C.card}`, boxShadow: "0 8px 20px rgba(15,23,42,.25)", background: C.card,
                    animation: `tfTravel ${HANDOFF_MS - 250}ms cubic-bezier(.45,.05,.35,1) ${index * 110}ms both`,
                  }}
                >
                  {thumb(item, 54)}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "26px", fontSize: "19px", fontWeight: 850 }}>{selected.length}종 {selectedQty}개를 넘겨줄 준비 중</div>
            <div style={{ marginTop: "6px", fontSize: "14px", color: C.label }}>이제 받을 사람과 좌석을 골라주세요.</div>
          </div>
        ) : null}

        {step === "target" ? (
          <div className="tf-step" key="target">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "26px", padding: "14px 16px", borderRadius: "14px", border: `1px solid ${C.border}`, background: C.card }}>
              <div style={{ display: "flex" }}>
                {selected.slice(0, 3).map((item, index) => <div key={item.key} style={{ marginLeft: index ? -14 : 0, border: `2px solid ${C.card}`, borderRadius: 13 }}>{thumb(item, 42)}</div>)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "15px", fontWeight: 850 }}>{selected.length}종 {selectedQty}개를 넘깁니다</div>
                <div style={{ fontSize: "12.5px", color: C.label, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selected.map((i) => `${i.name}${picked[i.key] > 1 ? ` ×${picked[i.key]}` : ""}`).join(", ")}
                </div>
              </div>
              <button type="button" disabled={submitting} onClick={() => { setSubmitError(""); setStep("items"); }} style={{ flexShrink: 0, padding: "8px 11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>다시 고르기</button>
            </div>

            <label style={labelStyle}>양도받을 사람 <span style={{ color: "#ef4444" }}>*</span></label>
            <RegisteredUserPicker
              scriptUrl={scriptUrl}
              name={toName}
              employeeId={toEmployeeId}
              onChange={(name, employeeId) => { setToName(name); setToEmployeeId(employeeId); setSubmitError(""); }}
              isLightMode={isLightMode}
              placeholder="받을 사람 이름 또는 사번으로 검색"
            />
            {isSelf ? <div style={{ marginTop: "8px", fontSize: "13.5px", fontWeight: 800, color: C.error }}>본인에게는 양도할 수 없습니다. 다른 사람을 골라주세요.</div> : null}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", margin: "26px 0 9px" }}>
              <label htmlFor="transfer-seat-floor" style={{ ...labelStyle, marginBottom: 0 }}>양도받을 좌석 {seatRequired ? <span style={{ color: "#ef4444" }}>*</span> : null}</label>
              <button
                type="button"
                disabled={!seatMapLoaded || seatMap.length === 0}
                onClick={() => {
                  const chosen = seatMap.find((f) => (f.name || f.id) === selFloor);
                  setSeatMapViewFloor(chosen?.id || seatMap[0]?.id || "");
                  setSeatMapOpen(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accent, cursor: seatMapLoaded && seatMap.length ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 800, opacity: seatMapLoaded && seatMap.length ? 1 : 0.5 }}
              >
                <Layers size={14} /> 좌석 배치도 보기
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <select id="transfer-seat-floor" value={selFloor} onChange={(e) => { setSelFloor(e.target.value); setSelUnit(""); }} disabled={!seatMapLoaded || seatMap.length === 0} style={{ ...inputStyle, opacity: seatMapLoaded && seatMap.length ? 1 : 0.6 }}>
                <option value="">층수 선택</option>
                {seatMap.map((f) => <option key={f.id} value={f.name || f.id}>{f.name || f.id}</option>)}
              </select>
              <select value={selUnit} onChange={(e) => setSelUnit(e.target.value)} disabled={!selFloor} aria-label="양도받을 사람의 유닛" style={{ ...inputStyle, opacity: selFloor ? 1 : 0.6 }}>
                <option value="">유닛 선택</option>
                {units.map((u) => <option key={`${u.row}-${u.col}`} value={u.label}>{u.label}</option>)}
              </select>
            </div>
            <div style={{ fontSize: "13.5px", color: C.label, marginTop: "9px", marginBottom: "26px", lineHeight: 1.5 }}>
              {!seatMapLoaded ? "좌석 배치도를 불러오는 중입니다..." : seatMap.length === 0 ? "좌석 배치도를 불러오지 못했습니다. 좌석 없이 진행됩니다." : "받는 사람이 물품을 둘 자리(층·유닛)를 골라주세요."}
            </div>

            {needsMode.length ? (
              <div style={{ marginBottom: "26px" }}>
                <label style={labelStyle}>받는 사람의 대여 방식 <span style={{ color: "#ef4444" }}>*</span></label>
                <div style={{ fontSize: "13.5px", color: C.label, lineHeight: 1.55, marginBottom: "12px" }}>
                  대여 방식이 정해지지 않은 예전 대여 {needsMode.length}종({needsMode.map((i) => i.name).join(", ")})이 있습니다. 고른 방식이 이 물품 모두에 적용됩니다. 나머지 물품은 원래 대여 방식이 그대로 넘어갑니다.
                </div>
                <RentalTermsFields C={C} mode={rentalMode} reason={rentalReason} dueDate={rentalDueDate} onMode={(m) => { setRentalMode(m); setSubmitError(""); }} onReason={setRentalReason} onDueDate={setRentalDueDate} disabled={submitting} />
              </div>
            ) : null}

            {submitError ? (
              <div role="alert" style={{ marginBottom: "14px", padding: "14px 16px", borderRadius: "12px", background: C.errorSoft, color: C.error, fontSize: "14.5px", fontWeight: 750, lineHeight: 1.5, display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ flex: 1 }}>{submitError}</span>
                {/목록을 새로고침/.test(submitError) ? <button type="button" onClick={() => { setSubmitError(""); setStep("items"); load(); }} style={{ flexShrink: 0, padding: "8px 11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.text, fontWeight: 800, cursor: "pointer" }}>목록 새로고침</button> : null}
              </div>
            ) : null}

            {toEmployeeId && !isSelf ? (
              <div style={{ marginBottom: "12px", fontSize: "14.5px", color: C.label, textAlign: "center" }}>
                <b style={{ color: C.text }}>{toName}</b>님{selFloor && selUnit ? ` (${selFloor} · ${selUnit})` : ""}에게 {selectedQty}개를 넘깁니다.
              </div>
            ) : null}
            <button type="button" disabled={!canSubmit} onClick={submit} style={primaryButton(canSubmit)}>
              {submitting ? "양도하는 중..." : <><Handshake size={19} /> 양도하기</>}
            </button>
          </div>
        ) : null}

        {step === "done" && result ? (
          <div className="tf-step" key="done" style={{ textAlign: "center", paddingTop: "30px" }}>
            <div className="tf-anim" style={{ width: 96, height: 96, margin: "0 auto", borderRadius: "50%", background: C.successSoft, display: "grid", placeItems: "center", animation: "tfPop .45s ease-out both" }}>
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="40" className="tf-anim" style={{ animation: "tfCheck .45s ease-out .3s both" }} />
              </svg>
            </div>
            <h2 style={{ margin: "22px 0 6px", fontSize: "24px", fontWeight: 900 }}>양도를 마쳤습니다</h2>
            <div style={{ fontSize: "16px", color: C.label, lineHeight: 1.6 }}>
              <b style={{ color: C.text }}>{result.receiverName}</b>님에게 {selected.length}종 {result.movedQty}개를 넘겼습니다.
              {selFloor && selUnit ? <><br />받는 좌석: {selFloor} · {selUnit}</> : null}
            </div>
            <div style={{ margin: "24px 0", textAlign: "left", border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden" }}>
              {selected.map((item, index) => (
                <div key={item.key} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderTop: index ? `1px solid ${C.border}` : "none" }}>
                  {thumb(item, 38)}
                  <div style={{ flex: 1, minWidth: 0, fontSize: "15px", fontWeight: 750, overflowWrap: "anywhere" }}>{item.name}</div>
                  <span style={{ fontSize: "14px", fontWeight: 850, color: C.label }}>× {picked[item.key]}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "20px" }}>넘긴 물품은 내 대여 조회의 반납 기록에 '양도'로 남습니다.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <button type="button" onClick={onOpenMyLookup} style={{ ...primaryButton(true), background: C.card, color: C.accentText, border: `1px solid ${C.border}`, fontSize: "16px" }}>내 대여 조회</button>
              <button type="button" onClick={onBack} style={{ ...primaryButton(true), fontSize: "16px" }}>처음 화면으로</button>
            </div>
          </div>
        ) : null}
      </div>

      {seatMapOpen ? (
        <SeatMapViewerModal
          C={C}
          floors={seatMap}
          activeFloorId={seatMapViewFloor}
          selectedFloor={selFloor}
          selectedUnit={selUnit}
          onFloorChange={setSeatMapViewFloor}
          onSelect={(floor, unit) => { setSelFloor(floor.name || floor.id); setSelUnit(unit.label); setSeatMapOpen(false); }}
          onClose={() => setSeatMapOpen(false)}
        />
      ) : null}
    </div>
  );
}
