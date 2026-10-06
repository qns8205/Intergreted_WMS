import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, MonitorCheck, PackageCheck, RefreshCw, X, User, MapPin, Clock, Search } from "lucide-react";
import { fetchPickupPhotos, fetchReturnPhotos, fetchUnattendedReturnPhotos, ReturnPhotoEntry, ReturnPhotoBatchItem } from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type?: "info" | "ok" | "warn" | "error") => void;
}

const PAGE_SIZE = 40;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function actionColor(action: string): string {
  if (action === "소모") return "#d97706";
  if (action === "반납") return "#059669";
  return "#2563eb"; // 확인
}

// 다양한 형식("2026-08-24 14:01:03", ISO 등)을 분 단위까지만("2026-08-24 14:01")로 자른다.
function toMinutePrecision(raw?: string): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : s;
}

function dateKey(raw: string): string {
  const m = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw || "");
}

function formatDateHeader(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 (${WEEKDAYS[d.getDay()]})`;
}

// 카드 첫 줄(날짜/시각)·둘째 줄(이름)용 — 대여자·대여시각 정보가 있으면 그걸 쓰고,
// 없는 옛 기록은 반납 처리 시각·요약 텍스트로 대체한다.
function cardHeadline(it: ReturnPhotoEntry): { top: string; bottom: string } {
  const list = it.items || [];
  if (list.length > 0) {
    const first = list[0];
    const who = first.borrower || "대여자 미상";
    const distinct = new Set(list.map((i) => i.borrower || "").filter(Boolean));
    const extra = distinct.size > 1 ? ` 외 ${distinct.size - 1}명` : "";
    const when = toMinutePrecision(first.borrowDate);
    return { top: when || it.occurredAt, bottom: `${who}${extra}` };
  }
  return { top: it.occurredAt, bottom: it.summary || "" };
}

export default function ReturnPhotosPage({ scriptUrl, connected, isLightMode, showToast }: Props) {
  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";
  const PANEL_BG = isLightMode ? "#ffffff" : "#1e293b";
  const CARD_SUB = isLightMode ? "#f4f6f9" : "#0f172a";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const BORDER_COLOR = isLightMode ? "#e2e8f0" : "#334155";
  const ACCENT = "#2563eb";

  const [items, setItems] = useState<ReturnPhotoEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<ReturnPhotoEntry | null>(null);
  const [photoKind, setPhotoKind] = useState<"return" | "unattendedReturn" | "pickup">("return");
  const kindLabel = photoKind === "return" ? "일반 반납" : photoKind === "unattendedReturn" ? "무인 반납" : "대여 확인";
  const photoFetcher = photoKind === "return" ? fetchReturnPhotos : photoKind === "unattendedReturn" ? fetchUnattendedReturnPhotos : fetchPickupPhotos;

  // 물품명으로 검색 — 입력을 멈춘 뒤 잠깐 기다렸다가 조회한다(타이핑마다 매번 부르지 않는다).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!connected || !scriptUrl) { setLoaded(true); return; }
    setLoading(true);
    try {
      const res = await photoFetcher(scriptUrl, { limit: PAGE_SIZE, offset: 0, itemSearch: search || undefined });
      setItems(res.items);
      setHasMore(res.hasMore);
      setLoaded(true);
    } catch (e: any) {
      showToast(`${kindLabel} 사진을 불러오지 못했습니다: ${e.message}`, "error");
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [connected, scriptUrl, showToast, search, photoKind, kindLabel, photoFetcher]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setItems([]); setLoaded(false); setDetail(null); }, [photoKind]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await photoFetcher(scriptUrl, { limit: PAGE_SIZE, offset: items.length, itemSearch: search || undefined });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch (e: any) {
      showToast(`더 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setLoadingMore(false);
    }
  }

  // 반납 처리 시각(occurredAt)의 날짜 단위로 구역을 나눠 보여준다 — 서버가 최신순으로
  // 내려주므로 로드된 순서를 그대로 유지하면 자연히 날짜별로 묶인다.
  const grouped = useMemo(() => {
    const map = new Map<string, ReturnPhotoEntry[]>();
    const order: string[] = [];
    for (const it of items) {
      const key = dateKey(it.occurredAt);
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(it);
    }
    return order.map((key) => ({ key, label: formatDateHeader(key), list: map.get(key)! }));
  }, [items]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Camera size={19} color={ACCENT} />
        <h2 style={{ fontSize: 18, fontWeight: 800, color: TEXT_MAIN, margin: 0, flex: 1 }}>대여 · 반납 사진</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10,
            border: `1px solid ${BORDER_COLOR}`, background: INPUT_BG, color: TEXT_DIM,
            fontSize: 12.5, fontWeight: 700, cursor: loading ? "default" : "pointer",
          }}
        >
          <RefreshCw size={13} className={loading ? "rp-spin" : undefined} /> 새로고침
        </button>
        <style>{`@keyframes rpSpin { to { transform: rotate(360deg); } } .rp-spin { animation: rpSpin 0.8s linear infinite; }`}</style>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setPhotoKind("return")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${photoKind === "return" ? ACCENT : BORDER_COLOR}`, background: photoKind === "return" ? (isLightMode ? "#eff6ff" : "rgba(37,99,235,.16)") : "transparent", color: photoKind === "return" ? ACCENT : TEXT_DIM, fontWeight: 800, cursor: "pointer" }}><Camera size={15} /> 일반 반납 사진</button>
        <button onClick={() => setPhotoKind("unattendedReturn")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1.5px solid ${photoKind === "unattendedReturn" ? "#f59e0b" : BORDER_COLOR}`, background: photoKind === "unattendedReturn" ? (isLightMode ? "#fffbeb" : "rgba(245,158,11,.16)") : "transparent", color: photoKind === "unattendedReturn" ? "#d97706" : TEXT_DIM, fontWeight: 900, cursor: "pointer" }}><MonitorCheck size={16} /> 무인 반납 사진</button>
        <button onClick={() => setPhotoKind("pickup")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${photoKind === "pickup" ? ACCENT : BORDER_COLOR}`, background: photoKind === "pickup" ? (isLightMode ? "#eff6ff" : "rgba(37,99,235,.16)") : "transparent", color: photoKind === "pickup" ? ACCENT : TEXT_DIM, fontWeight: 800, cursor: "pointer" }}><PackageCheck size={15} /> 대여 확인 사진</button>
      </div>

      <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 14 }}>
        {photoKind === "return" ? "관리자가 반납 처리하며 촬영한 증빙 사진입니다." : photoKind === "unattendedReturn" ? "무인 모드에서 반납자가 직접 촬영한 반납 증빙 사진입니다." : "무인 대여 확인 시 수령자가 직접 촬영한 증빙 사진입니다."} 날짜별로 나눠 보여주며, 촬영 후 7일이 지나면 자동으로 삭제됩니다.
      </div>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={`${kindLabel} 물품명으로 사진 검색`}
          style={{
            width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px", borderRadius: 10,
            border: `1px solid ${BORDER_COLOR}`, background: INPUT_BG, color: TEXT_MAIN, fontSize: 13, outline: "none",
          }}
        />
        {searchInput ? (
          <button
            onClick={() => setSearchInput("")}
            title="검색 지우기"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: TEXT_DIM, cursor: "pointer", padding: 4, display: "flex" }}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      {!loaded && loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: TEXT_DIM, fontSize: 13 }}>
          불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: TEXT_DIM, fontSize: 13 }}>
          {search ? `"${search}"이(가) 찍힌 ${kindLabel} 사진이 없습니다.` : `아직 촬영된 ${kindLabel} 사진이 없습니다.`}
        </div>
      ) : (
        <>
          {grouped.map((g) => (
            <div key={g.key} style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${BORDER_COLOR}` }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: TEXT_MAIN }}>{g.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: TEXT_DIM }}>{g.list.length}장</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {g.list.map((it) => {
                  const headline = cardHeadline(it);
                  return (
                    <div
                      key={it.id}
                      onClick={() => setDetail(it)}
                      style={{
                        borderRadius: 12, border: `1px solid ${BORDER_COLOR}`, background: PANEL_BG,
                        overflow: "hidden", cursor: "pointer",
                      }}
                    >
                      <img
                        src={it.thumb}
                        alt={headline.bottom || `${kindLabel} 사진`}
                        style={{ width: "100%", height: 130, objectFit: "cover", display: "block", background: INPUT_BG }}
                        loading="lazy"
                      />
                      <div style={{ padding: "8px 10px" }}>
                        <div style={{ fontSize: 11, color: TEXT_DIM }}>{headline.top}</div>
                        {headline.bottom ? (
                          <div style={{ fontSize: 11.5, color: TEXT_MAIN, fontWeight: 700, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {headline.bottom}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {hasMore ? (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                width: "100%", marginTop: 4, padding: 12, borderRadius: 10, border: `1px solid ${BORDER_COLOR}`,
                background: INPUT_BG, color: TEXT_DIM, fontSize: 12.5, fontWeight: 700, cursor: loadingMore ? "default" : "pointer",
              }}
            >
              {loadingMore ? "불러오는 중..." : "더 보기"}
            </button>
          ) : null}
        </>
      )}

      {detail ? (
        <div
          onClick={() => setDetail(null)}
          style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(880px, 100%)", maxHeight: "88vh", background: PANEL_BG, borderRadius: 16,
              border: `1px solid ${BORDER_COLOR}`, display: "flex", flexDirection: "column", overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: `1px solid ${BORDER_COLOR}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: TEXT_MAIN }}>{detail.occurredAt}</div>
                {detail.summary ? <div style={{ fontSize: 12, color: TEXT_DIM, marginTop: 2 }}>{detail.summary}</div> : null}
              </div>
              <button onClick={() => setDetail(null)} style={{ background: CARD_SUB, border: "none", borderRadius: 8, color: TEXT_DIM, cursor: "pointer", padding: 7 }}>
                <X size={17} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 16, padding: 18 }}>
              <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                <img
                  src={detail.photo}
                  alt={detail.summary || `${kindLabel} 사진`}
                  style={{ width: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 10, border: `1px solid ${BORDER_COLOR}`, background: INPUT_BG }}
                />
              </div>

              <div style={{ flex: "1 1 280px", minWidth: 260 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: TEXT_DIM, marginBottom: 8 }}>
                  처리된 물품 {detail.items.length > 0 ? `(${detail.items.length}종)` : ""}
                </div>
                {detail.items.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: TEXT_DIM, padding: "20px 0", textAlign: "center" }}>
                    이 사진과 연결된 물품 내역이 없습니다. (이 기능 추가 이전에 찍힌 사진일 수 있습니다)
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.items.map((line, idx) => (
                      <div
                        key={idx}
                        style={{ padding: "10px 12px", borderRadius: 10, background: CARD_SUB, border: `1px solid ${BORDER_COLOR}` }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {line.itemLabel}
                          </div>
                          <span
                            style={{
                              fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "2px 9px", flexShrink: 0,
                              color: actionColor(line.action), background: `${actionColor(line.action)}1a`,
                            }}
                          >
                            {line.action}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: TEXT_MAIN, flexShrink: 0 }}>{line.qty}개</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, fontSize: 11, color: TEXT_DIM, flexWrap: "wrap" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><User size={11} /> {line.borrower || "대여자 미상"}</span>
                          {line.location ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}><MapPin size={11} /> {line.location}</span> : null}
                          {line.borrowDate ? <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Clock size={11} /> {toMinutePrecision(line.borrowDate)} 대여</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
