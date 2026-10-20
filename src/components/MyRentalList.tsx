import { rentalTermsLabel, rentalTimeLeftMs, rentalTimeMs, isRentalLunchBreak } from '../../shared/rentalTerms.js';
import React, { useEffect, useRef, useState } from "react";
import { Boxes, Check, ClipboardList, Copy, Fingerprint, Info, PauseCircle, RotateCcw, Timer, Warehouse } from "lucide-react";
import { getThumbImageUrl } from "../utils/drive";
import { scenarioVariantText } from "../utils/scenarioVariant";
import { copyRentalText, rentalItemName, rentalItemId, rentalIdsText, rentalCartText } from "../utils/rentalClipboard";
import { MyReservations } from "./ItemReservations";
import { ItemReservation } from "../utils/borrowApi";
import { BorrowerObjectReports, type ObjectReportAction } from './ObjectReports';

export interface MyRentalResult {
  scenario: any[];
  general: any[];
  warehouse: any[];
  returned: any[];
}

const RETURN_LABELS: Record<string, string> = {
  admin: "관리자 반납", self: "본인 반납", unattended: "무인 반납",
  transfer: "양도", swap: "물품 교체", damage: "파손 반납",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const sec = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(sec / 3600)}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`;
};
/** 반납 기한이 있는 일반 대여 줄인지 — 수령 확인 전에는 기한이 아직 시작되지 않는다. */
const deadlineOf = (item: any) => (item?.rentalTerms?.mode === "general" && item.rentalTerms.deadlineAt ? rentalTimeMs(item.rentalTerms.deadlineAt) : NaN);

/** 일반 대여 반납 타이머. 점심시간(12:00~13:00)에는 남은 시간이 줄지 않고 멈춰 있다. */
function ReturnTimer({ C, deadline, now }: { C: Record<string, string>; deadline: number; now: number }) {
  const overdue = now >= deadline;
  const left = overdue ? now - deadline : Math.max(0, rentalTimeLeftMs(now, deadline));
  const paused = !overdue && isRentalLunchBreak(now);
  const soon = !overdue && left < 30 * 60000;
  const fg = overdue ? C.error : soon ? C.warn : C.accentText;
  const bg = overdue ? C.errorSoft : soon ? C.warnSoft : C.accentSoft;
  return (
    <div role="timer" aria-live="off" style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: bg, color: fg, wordBreak: "keep-all" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
        {paused ? <PauseCircle size={14} /> : <Timer size={14} />}
        {overdue ? "반납 기한이 지났습니다" : paused ? "점심시간 · 타이머 멈춤" : "반납까지 남은 시간"}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25, marginTop: 2, fontVariantNumeric: "tabular-nums", letterSpacing: 0.5 }}>
        {overdue ? `+${clock(left)}` : clock(left)}
      </div>
      <div style={{ fontSize: 10.5, marginTop: 2, opacity: 0.85, lineHeight: 1.5 }}>
        {overdue ? "지금 바로 반납해주세요." : "점심시간(12:00~13:00)에는 타이머가 잠시 멈춥니다."}
      </div>
    </div>
  );
}

export default function MyRentalList({ C, result, name, employeeId, loading = false, onRefresh, onImage, onDetails, showToast, reservationUrl, onBorrowReservation }: {
  employeeId?: string;
  reservationUrl?: string;
  onBorrowReservation?: (item: ItemReservation) => void;
  C: Record<string, string>;
  result: MyRentalResult;
  name: string;
  loading?: boolean;
  onRefresh: () => void;
  onImage: (item: any) => void;
  onDetails: (item: any) => void;
  showToast: (message: string, type: "ok" | "error") => void;
}) {
  const [tab, setTab] = useState<"active" | "returned">("active");
  const [reportAction, setReportAction] = useState<ObjectReportAction | null>(null);
  const activeItems = [...result.scenario, ...result.general, ...result.warehouse];
  const returnedItems = result.returned.filter((item) => !item.cancelled);
  const cancelledItems = result.returned.filter((item) => item.cancelled);
  const visibleItems = tab === "active" ? activeItems : result.returned;
  // 반납 타이머: 기한이 있는 일반 대여가 보일 때만 1초마다 다시 그린다.
  const [now, setNow] = useState(() => Date.now());
  const hasTimer = tab === "active" && activeItems.some((item) => Number.isFinite(deadlineOf(item)));
  useEffect(() => {
    if (!hasTimer) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasTimer]);
  // 복사 결과 안내. 내 대여 조회는 App이 화면을 일찍 반환해서 토스트가 그려질 자리가 없으므로(App의 토스트는 메인
  // 레이아웃 끝에서만 그려진다), 이 화면 안에서 직접 보여준다. 특히 "ID가 없어 제외했다"는 안내가 사용자에게 닿아야 한다.
  const [notice, setNotice] = useState<{ message: string; type: "ok" | "error" } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const announce = (message: string, type: "ok" | "error") => {
    showToast(message, type);
    setNotice({ message, type });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  };
  const copy = async (text: string, message = `물품 ID를 복사했습니다. (${text})`) => {
    try { await copyRentalText(text); announce(message, "ok"); }
    catch (error) { announce(error instanceof Error ? error.message : "ID를 복사하지 못했습니다.", "error"); }
  };
  // 목록 복사: ID가 없는 물품(COS 공구는 번호 없이 이름·위치로만 구분한다)은 복사에서 빠진다.
  // 조용히 빠지면 일부만 복사된 줄 모르고 쓰게 되므로, 몇 종이 빠졌는지 알려준다.
  const copyList = async (items: any[]) => {
    const { text, count, skipped } = rentalIdsText(items);
    if (!text) { announce("복사할 수 있는 물품 ID가 없습니다. (COS 물품은 ID가 없습니다)", "error"); return; }
    await copy(text, skipped ? `물품 ID ${count}종을 복사했습니다. ID가 없는 ${skipped}종(COS 물품 등)은 제외했어요.` : `물품 ID ${count}종을 복사했습니다.`);
  };
  // 다시 빌릴 때 쓰는 복사: 수량·종류까지 붙여 시나리오 물품 대여의 "ID로 담기"에 그대로 붙여 넣을 수 있게 한다.
  const copyCartList = async (items: any[]) => {
    const { text, count, skipped } = rentalCartText(items);
    if (!text) { announce("복사할 수 있는 물품 ID가 없습니다. (COS 물품은 ID가 없습니다)", "error"); return; }
    await copy(text, `ID·수량·종류 ${count}건을 복사했습니다. 시나리오 물품 대여의 "ID로 담기"에 붙여 넣으세요.${skipped ? ` ID가 없는 ${skipped}종(COS 물품 등)은 제외했어요.` : ""}`);
  };
  const buttonStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.card, color: C.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer",
  };
  const row = (item: any, icon: React.ReactNode, tone = "accent", isReturned = false) => {
    const color = tone === "success" ? C.success : C.accentText;
    return (
      <div key={`${item.sheetType}:${item.rowIndex ?? item.itemLabel}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: 13, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 8, background: C.card }}>
        <button type="button" disabled={!item.image} onClick={() => onImage(item)} aria-label={`${rentalItemName(item)} 사진 보기`} style={{ flex: "0 0 40px", width: 40, height: 40, padding: 0, border: 0, borderRadius: 10, overflow: "hidden", background: tone === "success" ? C.successSoft : C.accentSoft, color, display: "flex", alignItems: "center", justifyContent: "center", cursor: item.image ? "zoom-in" : "default", opacity: 1 }}>
          {item.image ? <img src={getThumbImageUrl(item.image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : icon}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, overflowWrap: "anywhere" }}>{item.itemLabel}</div>
          {item.rentalTerms ? <div style={{fontSize:12,color:C.accentText,marginTop:5,lineHeight:1.6}}>{rentalTermsLabel(item.rentalTerms)}</div> : null}
          {!isReturned && Number.isFinite(deadlineOf(item)) ? <ReturnTimer C={C} deadline={deadlineOf(item)} now={now} /> : null}
          {scenarioVariantText(item) ? <div style={{ fontSize: 11, color: C.label, marginTop: 2 }}>종류: {scenarioVariantText(item)}</div> : null}
          <div style={{ fontSize: 11, color: C.label, marginTop: 2, lineHeight: 1.5 }}>
            {isReturned ? `${item.cancelled ? "취소" : "반납"}일: ${item.returnDate || "-"}${!item.cancelled && RETURN_LABELS[item.returnSource] ? ` · ${RETURN_LABELS[item.returnSource]}` : ""}` : `대여일: ${item.borrowDate || "-"}`}
            {item.scenarioId ? ` · ${item.scenarioId}` : item.generalOption ? ` · ${item.generalOption}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          {rentalItemId(item) ? (
            <>
              <button type="button" onClick={() => copy(rentalItemId(item))} aria-label={`${rentalItemName(item)} ID 복사`} style={{ ...buttonStyle, fontSize: 11, padding: "7px 10px", background: C.cardSub }}><Copy size={12} /> ID 복사</button>
              {/* 이 물품 하나를 수량·종류까지 붙여 복사한다. "ID로 담기"에 그대로 붙여 넣을 수 있다. */}
              <button type="button" onClick={() => { const { text } = rentalCartText([item]); void copy(text, `ID·수량·종류를 복사했습니다. (${text})`); }}
                aria-label={`${rentalItemName(item)} ID·수량·종류 복사`} title={'수량·종류까지 붙여 복사합니다. "ID로 담기"에 그대로 붙여 넣을 수 있습니다.'}
                style={{ ...buttonStyle, fontSize: 11, padding: "7px 10px", background: C.cardSub }}><Copy size={12} /> ID·수량·종류</button>
            </>
          ) : (
            // COS 물품처럼 ID가 없는 물품: 버튼이 사라지면 오히려 헷갈리니 자리는 두고 비활성으로 이유를 보여준다.
            <button type="button" disabled title="이 물품은 ID가 없습니다" aria-label={`${rentalItemName(item)} ID 없음`} style={{ ...buttonStyle, fontSize: 11, padding: "7px 10px", background: C.cardSub, opacity: 0.5, cursor: "not-allowed" }}><Copy size={12} /> ID 없음</button>
          )}
          <button type="button" onClick={() => onDetails(item)} style={{ ...buttonStyle, fontSize: 11, padding: "7px 10px", background: C.cardSub }}><Info size={12} /> 상세 정보</button>
          {!isReturned && reservationUrl && employeeId && item.pickedUp && ["scenario", "general"].includes(item.sheetType) ? <button type="button" aria-label={`${rentalItemName(item)} 요청·신고`} onClick={() => setReportAction({ mode: "choose", item })} style={{ ...buttonStyle, fontSize: 11, padding: "7px 10px", background: C.cardSub }}><ClipboardList size={12} /> 요청·신고</button> : null}
        </div>
      </div>
    );
  };
  const section = (title: string, items: any[], icon: React.ReactNode, tone = "accent", isReturned = false) => items.length ? (
    <section>
      <h3 style={{ fontSize: 12, fontWeight: 700, color: tone === "success" ? C.success : C.accentText, margin: "16px 0 8px" }}>{title} · {items.length}종</h3>
      {items.map((item) => row(item, icon, tone, isReturned))}
    </section>
  ) : null;
  return (
    <div>
      {reservationUrl && onBorrowReservation ? <MyReservations C={C} scriptUrl={reservationUrl} onBorrow={onBorrowReservation} onChanged={onRefresh} /> : null}
      <div role="tablist" aria-label="내 대여 내역" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, padding: 5, borderRadius: 14, background: C.cardSub, marginBottom: 16 }}>
        {([{ id: "active", label: "현재 대여", count: activeItems.length }, { id: "returned", label: "이번 작업일 반납", count: returnedItems.length }] as const).map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`my-rentals-${item.id}`} id={`my-rentals-tab-${item.id}`} onClick={() => setTab(item.id)} style={{ padding: "13px 8px", border: 0, borderRadius: 10, background: tab === item.id ? C.card : "transparent", color: tab === item.id ? C.accent : C.label, fontSize: 13, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: tab === item.id ? "0 2px 8px rgba(15,23,42,.06)" : "none" }}>
            {item.label}<span style={{ borderRadius: 999, padding: "2px 7px", fontSize: 11, background: C.accentSoft }}>{item.count}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`my-rentals-${tab}`} aria-labelledby={`my-rentals-tab-${tab}`}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{name}님의 {tab === "active" ? "현재 대여 물품" : "이번 작업일 반납 내역"}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {reservationUrl && employeeId ? <button type="button" onClick={() => setReportAction({ mode: "history" })} style={buttonStyle}><ClipboardList size={12} /> 요청·신고 내역</button> : null}
            {visibleItems.length ? <button type="button" onClick={() => copyList(visibleItems)} title="물품 ID만 쉼표로 이어 복사합니다" style={buttonStyle}><Copy size={12} /> 목록 ID 복사</button> : null}
            {visibleItems.length ? <button type="button" onClick={() => copyCartList(visibleItems)} title={'수량·종류까지 붙여 복사합니다. 시나리오 물품 대여의 "ID로 담기"에 그대로 붙여 넣을 수 있습니다.'} style={buttonStyle}><Copy size={12} /> ID·수량·종류 복사</button> : null}
            <button type="button" disabled={loading} onClick={onRefresh} style={{ ...buttonStyle, opacity: loading ? 0.6 : 1, cursor: loading ? "wait" : "pointer" }}><RotateCcw size={12} /> {loading ? "갱신 중…" : "새로고침"}</button>
          </div>
        </div>
        {/* 복사 결과 안내. 항상 자리를 두면(aria-live) 스크린리더가 읽고, 안내가 뜨고 사라져도 아래 목록이 흔들리지 않는다. */}
        <div role="status" aria-live="polite" style={{ minHeight: notice ? undefined : 0 }}>
          {notice ? (
            <div style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 9, fontSize: 12, fontWeight: 700, lineHeight: 1.5, border: `1px solid ${notice.type === "ok" ? C.success : "#ef4444"}66`, background: notice.type === "ok" ? C.successSoft : "rgba(239,68,68,0.1)", color: notice.type === "ok" ? C.success : "#ef4444" }}>
              {notice.message}
            </div>
          ) : null}
        </div>
        {tab === "returned" ? <p style={{ margin: "0 0 14px", fontSize: 11, color: C.label, lineHeight: 1.6 }}>작업일은 오전 1시 기준입니다. 자정 이후 오전 1시 전 반납은 전날 작업일에 포함됩니다.</p> : null}
        {!visibleItems.length ? <div className="wms-empty-state" style={{ textAlign: "center", padding: "48px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: 8 }} /><div>{tab === "active" ? "현재 대여 중인 물품이 없습니다." : "이번 작업일에 반납된 물품이 없습니다."}</div></div> : tab === "active" ? (
          <>
            {section("시나리오 물품 (SID 대여)", result.scenario, <Fingerprint size={17} />)}
            {section("일반 대여", result.general, <Boxes size={17} />)}
            {section("COS 물품", result.warehouse, <Warehouse size={17} />, "success")}
          </>
        ) : (
          <>
            {section("반납", returnedItems, <RotateCcw size={17} />, "success", true)}
            {section("대여 확인 전 취소", cancelledItems, <Boxes size={17} />, "accent", true)}
          </>
        )}
      </div>
      {reservationUrl && employeeId ? <BorrowerObjectReports C={C} scriptUrl={reservationUrl} identity={{ name, employeeId }} action={reportAction} onClose={() => setReportAction(null)} onSubmitted={message => announce(message, "ok")} /> : null}
    </div>
  );
}
