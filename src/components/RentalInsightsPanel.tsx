/**
 * 반납 로그 > 분석.
 *
 * "누가 많이 빌렸나"가 아니라 "그래서 무엇을 할까"가 바로 보이게 나눴다:
 * 언제 붐비는지(시간대 수요) → 무엇을 더 살지(구매 추천) → 무엇을 뺄지(retire 추천) → 어떻게 둘지(같이 나가는 물품).
 * 계산은 서버(getRentalInsights)가 한다. retire는 추천만 보여주고 처리는 SM에서 직접 한다.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, ShoppingCart, Archive, Link2, RotateCcw, AlertTriangle, Users, Package, Timer } from "lucide-react";
import { fetchRentalInsights, RentalInsights, InsightItem } from "../utils/borrowApi";
import { getThumbImageUrl } from "../utils/drive";

interface Props {
  scriptUrl: string;
  connected: boolean;
  C: Record<string, string>;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

const PERIODS = [7, 30, 90] as const;
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일
const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** 시간대 수요 격자에서 커서를 올린(모바일은 누른) 칸. 좌표는 말풍선을 칸 옆에 놓기 위한 화면 위치다. */
interface DemandTip { kind: "cell" | "hour"; dow: number; hour: number; left: number; right: number; top: number; bottom: number }
const TIP_WIDTH = 252;
type RetireTab = "overuse" | "wear" | "unused";
const RETIRE_TABS: { key: RetireTab; label: string; hint: string }[] = [
  { key: "overuse", label: "과사용", hint: "업무 시간에 자주 품절되고 SM 활동성도 70% 이상인 물품입니다. 데이터에 과하게 나오므로 더 사기보다 다른 물품으로 바꾸는 쪽을 검토하세요." },
  { key: "wear", label: "마모·파손", hint: "대여 횟수에 비해 불량이 잦은 물품입니다(5회 이상 대여, 불량 2건 이상)." },
  { key: "unused", label: "미사용", hint: "이 기간 한 번도 나가지 않았고 SM 활동성도 20% 미만인 물품입니다. 등록 14일 안 된 물품은 뺐습니다." },
];

// SM 화면과 같은 색 구간.
function smColor(score: number) {
  return score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : score >= 20 ? "#f97316" : "#ef4444";
}

export default function RentalInsightsPanel({ scriptUrl, connected, C, showToast }: Props) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<RentalInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const toast = useRef(showToast);
  toast.current = showToast;
  const [demandKind, setDemandKind] = useState<"borrow" | "return">("borrow");
  const [retireTab, setRetireTab] = useState<RetireTab>("overuse");
  const [tip, setTip] = useState<DemandTip | null>(null);

  // 말풍선은 칸 밖을 누르거나, 스크롤·창 크기가 바뀌면 닫는다(모바일은 마우스를 떼는 일이 없다).
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.("[data-rip-cell]")) hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [tip]);

  const load = useCallback(async (d: number, fresh = false) => {
    if (!connected || !scriptUrl) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await fetchRentalInsights(scriptUrl, d, fresh);
      if (id === requestId.current) setData(next);
    }
    catch (e: any) {
      if (id !== requestId.current) return;
      setError(e.message || "분석 조회 실패");
      toast.current(`분석을 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { if (id === requestId.current) setLoading(false); }
  }, [connected, scriptUrl]);

  useEffect(() => { load(days); return () => { requestId.current += 1; }; }, [days, load]);

  // retire 탭은 처음 열 때 비어 있지 않은 쪽을 먼저 보여준다.
  useEffect(() => {
    if (!data) return;
    if (!data.retire[retireTab].length) {
      const firstFull = RETIRE_TABS.find((t) => data.retire[t.key].length);
      if (firstFull) setRetireTab(firstFull.key);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const section: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 14, background: C.card, padding: "16px 18px", minWidth: 0 };
  const h3: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, margin: 0, fontSize: 14, fontWeight: 800, color: C.text };
  const sub: React.CSSProperties = { fontSize: 11.5, color: C.label, marginTop: 4, lineHeight: 1.5 };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: "6px 13px", borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: "pointer",
    border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accent : "transparent", color: active ? "#fff" : C.label,
  });

  if (!data && loading) {
    return <div style={{ ...section, marginBottom: 14, textAlign: "center", color: C.label, fontSize: 13 }}>분석을 계산하고 있습니다...</div>;
  }
  if (!data) return error ? <div role="alert" style={{ ...section, marginBottom: 14, color: C.error, fontSize: 13 }}>
    {error} <button onClick={() => load(days, true)} style={chip(false)}>다시 시도</button>
  </div> : null;

  const s = data.summary;
  const grid = demandKind === "borrow" ? data.timeDemand.borrow : data.timeDemand.return;
  const peaks = demandKind === "borrow" ? data.timeDemand.borrowPeaks : data.timeDemand.returnPeaks;
  const byHour = demandKind === "borrow" ? data.timeDemand.borrowByHour : data.timeDemand.returnByHour;
  const maxCell = Math.max(1, ...grid.flat());
  const maxHour = Math.max(1, ...byHour);
  const retireList = data.retire[retireTab];
  const cells = demandKind === "borrow" ? data.timeDemand.borrowCells : data.timeDemand.returnCells;
  const demandVerb = demandKind === "borrow" ? "대여 신청" : "반납";
  const demandTotal = byHour.reduce((a, b) => a + b, 0);
  // 같은 요일이 기간 안에 몇 번 있었는지(대략). 발생한 날 수와 견줘 "매주 나오는 패턴인지"를 보여준다.
  const weekdayCount = Math.max(1, Math.round(data.period / 7));
  const showTip = (e: React.SyntheticEvent<HTMLElement>, kind: DemandTip["kind"], dow: number, hour: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ kind, dow, hour, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  };
  const tipRow: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 };
  const tipDim: React.CSSProperties = { color: C.label, fontSize: 11 };

  const tipBody = () => {
    if (!tip) return null;
    const hh = String(tip.hour).padStart(2, "0");
    const head = (title: string) => (
      <div style={{ ...tipRow, justifyContent: "space-between", marginBottom: 6 }}>
        <b style={{ fontSize: 12.5, color: C.text }}>{title}</b>
        <span style={{ ...tipDim, whiteSpace: "nowrap" }}>{demandVerb}</span>
      </div>
    );
    if (tip.kind === "hour") {
      const n = byHour[tip.hour];
      return (
        <>
          {head(`${hh}시 합계`)}
          {n === 0 ? <div style={tipDim}>이 시간대에는 한 건도 없었습니다.</div> : (
            <>
              <div style={tipRow}><b style={{ fontSize: 15, color: C.text }}>{n}건</b><span style={tipDim}>전체의 {Math.round((n / Math.max(1, demandTotal)) * 100)}%</span></div>
              <div style={{ ...tipDim, marginTop: 6 }}>요일별</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                {DOW_ORDER.map((d) => (
                  <span key={d} style={{ opacity: grid[d][tip.hour] ? 1 : 0.4, color: C.text }}>{DOW_LABEL[d]} <b>{grid[d][tip.hour]}</b></span>
                ))}
              </div>
            </>
          )}
        </>
      );
    }
    const n = grid[tip.dow][tip.hour];
    const c = cells?.[`${tip.dow}-${tip.hour}`];
    return (
      <>
        {head(`${DOW_LABEL[tip.dow]}요일 ${hh}:00~${hh}:59`)}
        {n === 0 || !c ? <div style={tipDim}>최근 {data.period}일 동안 이 시간대에는 한 건도 없었습니다.</div> : (
          <>
            <div style={tipRow}><b style={{ fontSize: 15, color: C.text }}>{n}건</b><span style={tipDim}>물품 {c.qty}개 · 전체의 {Math.round((n / Math.max(1, demandTotal)) * 100)}%</span></div>
            <div style={{ color: C.text, marginTop: 4 }}>{demandKind === "borrow" ? "신청한" : "반납한"} 사람 <b>{c.borrowers}명</b></div>
            <div style={{ ...tipDim, marginTop: 1 }}>{c.days}일에 나눠 발생 (이 요일 약 {weekdayCount}번 중)</div>
            <div style={{ ...tipDim, marginTop: 8 }}>{demandKind === "borrow" ? "많이 나간 물품" : "많이 반납된 물품"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
              {c.top.map((t, i) => (
                <div key={t.id} style={{ ...tipRow, color: C.text }}>
                  <span style={{ ...tipDim, width: 12, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.name}>{t.name}</span>
                  <b style={{ flexShrink: 0 }}>{t.qty}개</b>
                </div>
              ))}
              {c.moreTypes > 0 ? <div style={tipDim}>외 {c.moreTypes}종</div> : null}
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14, opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
      {/* 기간 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {PERIODS.map((p) => <button key={p} onClick={() => setDays(p)} style={chip(days === p)}>최근 {p}일</button>)}
        <span style={{ fontSize: 11.5, color: C.label }}>
          {data.since} 이후{data.dataSince && data.dataSince > data.since ? ` · 기록은 ${data.dataSince}부터 있습니다` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => load(days, true)} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 9, border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          <RotateCcw size={13} /> 새로고침
        </button>
      </div>
      {error ? <div role="alert" style={{ color: C.error, fontSize: 12 }}>갱신하지 못해 기존 분석을 표시합니다: {error}</div> : null}

      {/* 요약 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[
          { icon: <Package size={14} />, label: "대여", value: `${s.rentals.toLocaleString()}건`, note: `${s.itemTypes}종 · ${s.quantity.toLocaleString()}개` },
          { icon: <Users size={14} />, label: "대여자", value: `${s.borrowers}명`, note: `지금 미반납 ${s.open}건` },
          { icon: <Timer size={14} />, label: "보유 시간 (중앙값)", value: s.holdMedianHours != null ? `${s.holdMedianHours}시간` : "-", note: s.holdP90Hours != null ? `90%는 ${s.holdP90Hours}시간 안에 반납` : "" },
          { icon: <Clock size={14} />, label: "3일 넘게 보유", value: `${s.longHolds}건`, note: "반납까지 72시간 이상" },
        ].map((k) => (
          <div key={k.label} style={{ ...section, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.label, fontWeight: 700 }}>{k.icon} {k.label}</div>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.text, marginTop: 3 }}>{k.value}</div>
            {k.note ? <div style={{ fontSize: 11, color: C.label, marginTop: 1 }}>{k.note}</div> : null}
          </div>
        ))}
      </div>

      {/* 시간대 수요 */}
      <div style={section}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={h3}><Clock size={16} color={C.accent} /> 시간대 수요</h3>
            <div style={sub}>
              {demandKind === "borrow" ? "대여 신청이 들어온 시각" : "반납된 시각"} 기준입니다.
              {peaks.length ? <> 가장 붐비는 때: {peaks.map((p, i) => <b key={i} style={{ color: C.text }}>{i ? ", " : " "}{DOW_LABEL[p.dow]} {String(p.hour).padStart(2, "0")}시 ({p.n}건)</b>)}</> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setDemandKind("borrow")} style={chip(demandKind === "borrow")}>대여</button>
            <button onClick={() => setDemandKind("return")} style={chip(demandKind === "return")}>반납</button>
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "28px repeat(24, minmax(18px, 1fr))", gap: 2, minWidth: 520 }}>
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ fontSize: 9.5, color: C.label, textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>)}
            {DOW_ORDER.map((dow) => (
              <React.Fragment key={dow}>
                <span style={{ fontSize: 11, fontWeight: 700, color: dow === 0 || dow === 6 ? C.label : C.text, alignSelf: "center" }}>{DOW_LABEL[dow]}</span>
                {grid[dow].map((n, h) => {
                  const a = n / maxCell;
                  return (
                    <span
                      key={h}
                      data-rip-cell=""
                      aria-label={`${DOW_LABEL[dow]}요일 ${String(h).padStart(2, "0")}시 ${demandVerb} ${n}건`}
                      onMouseEnter={(e) => showTip(e, "cell", dow, h)}
                      onMouseLeave={() => setTip(null)}
                      onClick={(e) => showTip(e, "cell", dow, h)}
                      style={{
                        height: 20, borderRadius: 4, cursor: "default", boxSizing: "border-box",
                        background: n ? `rgba(37,99,235,${0.08 + a * 0.87})` : C.cardSub, border: `1px solid ${n ? "transparent" : C.border}`,
                        outline: tip?.kind === "cell" && tip.dow === dow && tip.hour === h ? `2px solid ${C.text}` : "none", outlineOffset: 1,
                      }}
                    />
                  );
                })}
              </React.Fragment>
            ))}
            <span style={{ fontSize: 10, color: C.label, alignSelf: "end" }}>합계</span>
            {byHour.map((n, h) => (
              <span
                key={h}
                data-rip-cell=""
                aria-label={`${String(h).padStart(2, "0")}시 ${demandVerb} 합계 ${n}건`}
                onMouseEnter={(e) => showTip(e, "hour", 0, h)}
                onMouseLeave={() => setTip(null)}
                onClick={(e) => showTip(e, "hour", 0, h)}
                style={{ height: 34, display: "flex", alignItems: "flex-end", cursor: "default" }}
              >
                <span style={{ width: "100%", height: `${Math.max(n ? 6 : 0, (n / maxHour) * 100)}%`, background: C.accent, opacity: 0.55, borderRadius: "3px 3px 0 0" }} />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 12 }}>
        {/* 구매 추천 */}
        <div style={section}>
          <h3 style={h3}><ShoppingCart size={16} color={C.success} /> 구매 추천 <span style={{ color: C.label, fontWeight: 700 }}>{data.buy.length}</span></h3>
          <div style={sub}>평일 08~22시 중 가진 수량이 <b>전부 대여 중</b>이던 시간이 25%를 넘은 물품입니다. 권장 수량은 품절 비율로 정한 대략치입니다.</div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {data.buy.length === 0 ? <Empty C={C} text="이 기간 수량이 모자랐던 물품이 없습니다." /> : data.buy.map((it) => (
              <ItemRow key={it.id} C={C} it={it}
                main={<><b style={{ color: C.text }}>업무 시간 {it.stockoutPct}% 품절</b> · {it.rentals}회 대여 / 보유 {it.owned}개</>}
                side={<span style={{ padding: "3px 9px", borderRadius: 999, background: C.successSoft, color: C.success, fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" }}>+{it.suggestAdd}개</span>}
              />
            ))}
          </div>
        </div>

        {/* retire 추천 */}
        <div style={section}>
          <h3 style={h3}><Archive size={16} color={C.warn} /> retire 추천</h3>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {RETIRE_TABS.map((t) => (
              <button key={t.key} onClick={() => setRetireTab(t.key)} style={chip(retireTab === t.key)}>
                {t.label} {data.retire[t.key].length}
              </button>
            ))}
          </div>
          <div style={sub}>{RETIRE_TABS.find((t) => t.key === retireTab)?.hint}</div>
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, background: C.warnSoft, color: C.warn, fontSize: 11.5, lineHeight: 1.5, display: "flex", gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>retire된 물품이 들어간 SID는 SM에서 대여할 수 없게 됩니다. 처리 전에 <b>SID 수</b>를 확인하고, 처리는 SM에서 직접 해 주세요.</span>
          </div>
          {!data.sm.ok ? (
            <div style={{ marginTop: 8, fontSize: 11.5, color: C.label, lineHeight: 1.5 }}>SM 점수 없음: {data.sm.reason}{retireTab === "overuse" ? " 과사용 추천은 SM 점수가 있어야 계산됩니다." : ""}</div>
          ) : null}
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {retireList.length === 0 ? <Empty C={C} text="해당하는 물품이 없습니다." /> : retireList.map((it) => (
              <ItemRow key={it.id} C={C} it={it}
                main={<>{it.reason}{it.lastRented && retireTab === "unused" ? ` · 마지막 대여 ${it.lastRented.slice(0, 10)}` : ""}</>}
                side={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <SmBadge C={C} sm={it.sm} />
                    <span title="이 물품이 들어간 SID 수" style={{ fontSize: 11, fontWeight: 800, color: it.sidCount ? C.error : C.label, whiteSpace: "nowrap" }}>SID {it.sidCount}개</span>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* 같이 나가는 물품 */}
      <div style={section}>
        <h3 style={h3}><Link2 size={16} color={C.accent} /> 같이 나가는 물품</h3>
        <div style={sub}>한 신청에 함께 담긴 횟수입니다. 가까운 칸에 두면 찾기 쉬워집니다.</div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6 }}>
          {data.pairs.length === 0 ? <Empty C={C} text="3번 이상 같이 나간 물품이 없습니다." /> : data.pairs.map((p) => (
            <div key={`${p.a.id}-${p.b.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, background: C.cardSub, border: `1px solid ${C.border}` }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>
                <div style={{ fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.a.name} + {p.b.name}</div>
                <div style={{ fontSize: 11, color: C.label, fontFamily: "monospace" }}>{p.a.rootSlot || "위치 없음"} · {p.b.rootSlot || "위치 없음"}</div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 900, color: C.accent, whiteSpace: "nowrap" }}>{p.count}회</span>
            </div>
          ))}
        </div>
      </div>
      {tip && typeof document !== "undefined" ? createPortal(
        (() => {
          // 칸 위에 두되 위쪽 공간이 모자라면 아래에 둔다. 화면 가장자리에서는 안쪽으로 밀어 넣는다.
          const left = Math.min(Math.max(8, (tip.left + tip.right) / 2 - TIP_WIDTH / 2), Math.max(8, window.innerWidth - TIP_WIDTH - 8));
          const above = tip.top > 230;
          return (
            <div
              role="tooltip"
              style={{
                position: "fixed", left, width: TIP_WIDTH, zIndex: 6000, pointerEvents: "none", boxSizing: "border-box",
                ...(above ? { bottom: window.innerHeight - tip.top + 8 } : { top: tip.bottom + 8 }),
                padding: "10px 12px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, color: C.text,
                boxShadow: "0 10px 28px rgba(0,0,0,0.28)", fontSize: 12, lineHeight: 1.45,
              }}
            >
              {tipBody()}
            </div>
          );
        })(),
        document.body
      ) : null}
    </div>
  );
}

const ItemRow: React.FC<{ C: Record<string, string>; it: InsightItem; main: React.ReactNode; side: React.ReactNode }> = ({ C, it, main, side }) => {
  const [broken, setBroken] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: C.cardSub, border: `1px solid ${C.border}` }}>
      <div style={{ width: 38, height: 38, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: C.card, display: "grid", placeItems: "center" }}>
        {it.image && !broken ? <img src={getThumbImageUrl(it.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={16} color={C.label} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {it.name} <span style={{ fontSize: 10.5, color: C.label, fontWeight: 600, fontFamily: "monospace" }}>{it.id}{it.rootSlot ? ` · ${it.rootSlot}` : ""}</span>
        </div>
        <div style={{ fontSize: 11.5, color: C.label, marginTop: 2, lineHeight: 1.4 }}>{main}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{side}</div>
    </div>
  );
};

function SmBadge({ C, sm }: { C: Record<string, string>; sm: InsightItem["sm"] }) {
  if (!sm) return <span style={{ fontSize: 10.5, color: C.label }}>SM 없음</span>;
  if (sm.isNew || sm.score == null) return <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#0ea5e9", borderRadius: 6, padding: "1px 6px" }}>NEW</span>;
  return (
    <span title={`SM 활동성 ${sm.score}% · 사용 ${sm.usage}회`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 44, height: 6, borderRadius: 4, background: C.border, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${sm.score}%`, height: "100%", background: smColor(sm.score) }} />
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: C.text }}>{sm.score}%</span>
    </span>
  );
}

function Empty({ C, text }: { C: Record<string, string>; text: string }) {
  return <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: C.label }}>{text}</div>;
}
