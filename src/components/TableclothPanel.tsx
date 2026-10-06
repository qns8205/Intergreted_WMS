import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Layers, MapPin, User, Clock, ArrowLeft, Check, ExternalLink } from "lucide-react";
import { getThumbImageUrl, getGoogleDriveImageUrl } from "../utils/drive";
import { smartMatch } from "../utils/search";
import { TC_DEFAULT_CATEGORIES, tcCategory, tcLabel, tcColor, tcCategoryOptions, tcLinks, tcLinkLabel } from "../utils/tableclothCategory";
import ImageZoomModal from "./ImageZoomModal";
import { locationKey, locationOptions, withMyFloorFirst, isMyFloor } from "../utils/tableclothLocation";
import {
  TableclothItem, TableclothRental, TableclothBorrower,
  fetchTableclothItems, fetchTableclothCategories, recordTableclothBorrow, processTableclothReturn,
  fetchMyTableclothRentals, fetchTableclothBorrowers, fetchTableclothActiveBorrowers,
} from "../utils/borrowApi";

/**
 * 테이블보 — 담당자를 거치지 않는 셀프 대여·반납.
 *
 * 모달이 아니라 대여 흐름 안의 한 페이지다. 대여 화면 위에 창이 덮이면 어디에 있는지
 * 놓치기 쉬워서, 다른 단계들과 똑같이 페이지로 넘어가게 뒀다. 물품 상세도 목록 위에
 * 겹치지 않고 한 페이지 더 들어가는 방식이며, 어느 쪽이든 화면 왼쪽 위 뒤로가기가
 * 한 단계씩 되돌린다(뒤로가기 대상은 부모가 detailId 로 쥐고 있다).
 *
 * 층마다 따로 보관하는 물건이라 담당자가 실물을 확인해주는 흐름이 맞지 않았다. 그래서
 * 시나리오 물품과 달리 "대여 확인" 단계가 없다 — 빌리는 순간 대여 중이 되고, 돌려놓는
 * 사람이 직접 반납을 누른다. 대신 본인이 스스로 확인할 수 있어야 하므로
 *   ① 내가 지금 빌린 것과 지난 1주 기록을 직접 보고,
 *   ② 물품을 누르면 지금 누가 가져갔는지 보이도록
 * 두 창구를 열어 뒀다. 반납은 본인 것만 가능하다(서버에서도 대조한다).
 */

interface Props {
  scriptUrl: string;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  /** 열람 화면에서 이미 확인한 신원 — 대여자·반납자로 그대로 쓴다 */
  identity: { name: string; employeeId: string; affiliation: string };
  /** 대여 기록에 남길 층 (선택) */
  floor?: string;
  /** 지금 펼쳐 본 물품. 뒤로가기를 부모 헤더가 처리해야 해서 부모가 쥔다. */
  detailId: number | null;
  onDetailId: (id: number | null) => void;
  /** 어느 탭으로 들어올지 — 반납하러 들어온 사람은 곧바로 내 기록에서 시작한다. */
  initialTab?: "list" | "mine";
}

function sizeLabel(it: { widthMm?: number; depthMm?: number }): string {
  const w = Number(it.widthMm), d = Number(it.depthMm);
  if (!(w > 0 && d > 0)) return "";
  const cm = (v: number) => { const n = v / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); };
  return `${cm(w)} × ${cm(d)}cm`;
}

/** "2026-09-04T…" → "9/4 14:30". 목록에서 한 줄에 들어가야 해서 짧게 쓴다. */
function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TableclothPanel({ scriptUrl, isLightMode, showToast, identity, floor, detailId, onDetailId, initialTab = "list" }: Props) {
  const C = {
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#475569" : "#94a3b8",
    accent: "#3b82f6",
    accentSoft: "rgba(59, 130, 246, 0.12)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#b91c1c" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  const [tab, setTab] = useState<"list" | "mine">(initialTab);
  // 반납으로 들어왔으면 이 화면은 "내 기록" 하나뿐이다.
  const returnOnly = initialTab === "mine";
  const [items, setItems] = useState<TableclothItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  // 층별 필터 — 천은 층마다 따로 보관하고, 빌리는 사람은 결국 자기 층까지 걸어간다.
  // 그래서 로그인할 때 고른 층으로 처음부터 좁혀 두고, 다른 층은 "전체"를 눌러야 보인다.
  const [locFilter, setLocFilter] = useState(() => locationKey(floor));
  // 로그인 층이 늦게 들어오거나 바뀌면 그 층으로 다시 맞춘다.
  useEffect(() => { setLocFilter(locationKey(floor)); }, [floor]);
  // 무늬 분류 필터 — 빌리는 사람은 번호가 아니라 "체크무늬 있나?"로 찾는다.
  const [catFilter, setCatFilter] = useState("");
  // 분류표는 관리 화면에서 고칠 수 있으므로 서버에서 받아 쓴다. 도착 전에는 기본 목록으로 그린다
  // — 어차피 물품에는 key만 붙어 있어, 표가 늦게 와도 라벨만 잠깐 다를 뿐 필터는 어긋나지 않는다.
  const [cats, setCats] = useState(TC_DEFAULT_CATEGORIES);
  const [zoomUrl, setZoomUrl] = useState("");
  // 지금 나가 있는 천 — 물품 번호별 대여자. 담당자가 없는 물건이라, 남은 게 0이면
  // "누구에게 물어야 하는지"가 곧 재고 정보다. 목록에서 바로 보이게 한 번에 받아 둔다.
  const [out, setOut] = useState<Record<string, typeof borrowers>>({});

  // 물품 상세 — 누가 빌려갔는지 + 여기서 바로 대여
  const detail = useMemo(() => items.find((x) => x.id === detailId) || null, [items, detailId]);
  const [borrowers, setBorrowers] = useState<TableclothBorrower[]>([]);
  const [borrowersLoading, setBorrowersLoading] = useState(false);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);

  // 내 기록
  const [mine, setMine] = useState<{ days: number; active: TableclothRental[]; recent: TableclothRental[] }>({ days: 7, active: [], recent: [] });
  const [mineLoading, setMineLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, active] = await Promise.all([
        fetchTableclothItems(scriptUrl),
        fetchTableclothActiveBorrowers(scriptUrl).catch(() => ({})),
      ]);
      setItems(list);
      setOut(active);
    } catch (e: any) {
      showToast("테이블보 목록을 불러오지 못했습니다: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [scriptUrl, showToast]);

  const loadMine = useCallback(async () => {
    if (!identity?.name) return;
    setMineLoading(true);
    try {
      setMine(await fetchMyTableclothRentals(scriptUrl, {
        name: identity.name, employeeId: identity.employeeId, affiliation: identity.affiliation,
      }, 7));
    } catch (e: any) {
      showToast("내 기록을 불러오지 못했습니다: " + e.message, "error");
    } finally {
      setMineLoading(false);
    }
  }, [scriptUrl, identity, showToast]);

  useEffect(() => { load(); loadMine(); }, [load, loadMine]);

  // 분류표는 자주 바뀌지 않으니 화면을 열 때 한 번만 받는다. 실패하면 기본 목록으로 계속 간다.
  useEffect(() => {
    let alive = true;
    fetchTableclothCategories(scriptUrl)
      .then((list) => { if (alive && list.length) setCats(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, [scriptUrl]);

  // 상세를 열면 그 물품의 대여자를 그때 불러온다 — 목록 전체에 붙이면 요청이 커진다.
  useEffect(() => {
    if (!detailId) { setBorrowers([]); return; }
    setQty(1);
    let alive = true;
    setBorrowersLoading(true);
    fetchTableclothBorrowers(scriptUrl, detailId)
      .then((b) => { if (alive) setBorrowers(b); })
      .catch(() => { if (alive) setBorrowers([]); })
      .finally(() => { if (alive) setBorrowersLoading(false); });
    return () => { alive = false; };
  }, [detailId, scriptUrl]);

  const shown = useMemo(() => {
    const q = search.trim();
    return items
      .filter((it) => !it.archived)
      .filter((it) => (locFilter ? locationKey(it.location) === locFilter : true))
      .filter((it) => (catFilter ? (catFilter === "__none__" ? !tcCategory(cats, it.category) : it.category === catFilter) : true))
      .filter((it) => (q ? smartMatch([it.name, it.location, it.note, it.link, tcLabel(cats, it.category)], q) : true));
  }, [items, search, locFilter, catFilter, cats]);

  // 내 층에 천이 하나도 없으면(아직 안 채웠거나 층 표기가 다르면) 빈 화면만 남는다.
  // 그럴 때는 조용히 전체로 되돌려 적어도 무언가 보이게 한다.
  useEffect(() => {
    if (!locFilter || loading || !items.length) return;
    if (!items.some((it) => !it.archived && locationKey(it.location) === locFilter)) setLocFilter("");
  }, [items, loading, locFilter]);

  const catScope = useMemo(() => items.filter((it) => !it.archived), [items]);
  const catOptions = useMemo(() => tcCategoryOptions(cats, catScope), [cats, catScope]);
  // 내가 있는 층의 천을 맨 앞에 둔다 — 빌리러 걸어가야 하므로 같은 층부터 보는 게 자연스럽다.
  const locOptions = useMemo(
    () => withMyFloorFirst(locationOptions(items.filter((it) => !it.archived)), floor),
    [items, floor]
  );

  // 지금 보고 있는 물품 중 내가 빌린 줄 — 상세 화면에서 대여 바로 밑에 반납 버튼을 놓기 위해서다.
  // (내 기록 탭까지 들어가지 않고 그 자리에서 돌려줄 수 있어야 한다)
  const myLinesForDetail = useMemo(
    () => (detail ? mine.active.filter((r) => r.itemId === detail.id) : []),
    [detail, mine.active]
  );

  // 위치별로 끊어 보여준다 — 순서는 위치 필터 칩과 같다.
  const groupedShown = useMemo(() => {
    const order = withMyFloorFirst(locationOptions(shown), floor);
    return order
      .map((o) => ({ ...o, items: shown.filter((it) => locationKey(it.location) === o.key) }))
      .filter((g) => g.items.length);
  }, [shown, floor]);

  async function doBorrow() {
    if (!detail) return;
    if (!identity?.name) { showToast("대여자 정보가 없습니다.", "warn"); return; }
    const n = Math.max(1, Math.min(qty, detail.stock));
    setBusy(true);
    try {
      const res = await recordTableclothBorrow(scriptUrl, {
        borrowerName: identity.name, affiliation: identity.affiliation, employeeId: identity.employeeId,
        floor: floor || undefined, items: [{ id: detail.id, name: detail.name, qty: n }],
      });
      if (!res?.success) { showToast(res?.message || "대여에 실패했습니다.", "error"); return; }
      showToast(`'${detail.name}' ${n}개를 대여했습니다.`, "ok");
      onDetailId(null);
      await Promise.all([load(), loadMine()]);
    } catch (e: any) {
      showToast("대여 실패: " + e.message, "error");
    } finally { setBusy(false); }
  }

  async function doReturn(r: TableclothRental) {
    setBusy(true);
    try {
      const res = await processTableclothReturn(scriptUrl, [{ rowIndex: r.rowIndex, quantity: r.quantity }], {
        borrowerName: identity.name, affiliation: identity.affiliation, employeeId: identity.employeeId,
      });
      if (!res?.success) { showToast(res?.message || "반납에 실패했습니다.", "error"); return; }
      showToast(`'${r.itemLabel}'을(를) 반납했습니다.`, "ok");
      await Promise.all([load(), loadMine()]);
    } catch (e: any) {
      showToast("반납 실패: " + e.message, "error");
    } finally { setBusy(false); }
  }

  const tabBtn = (key: "list" | "mine", label: string, badge?: number) => (
    <button
      onClick={() => setTab(key)}
      style={{
        flex: 1, padding: "9px 10px", borderRadius: "9px", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
        border: `1px solid ${tab === key ? C.accent : C.border}`,
        background: tab === key ? C.accentSoft : "transparent",
        color: tab === key ? C.accentText : C.label,
        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
      }}
    >
      {label}
      {badge ? (
        <span style={{ fontSize: "10.5px", fontWeight: 800, background: C.accent, color: "#fff", borderRadius: "999px", padding: "1px 6px" }}>{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div>
      <div>
        <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>
          {returnOnly
            ? `담당자 확인 없이 직접 반납합니다 · ${identity?.name || "이름 없음"}`
            : `담당자 확인 없이 직접 빌리고 직접 반납합니다 · ${identity?.name || "이름 없음"}`}
        </div>

        {/* 반납하러 들어온 경우엔 탭을 두지 않는다 — 여기서 할 일은 돌려놓는 것뿐이고,
            빌리러 가는 길은 대여 화면에 따로 있다. */}
        {!detail && !returnOnly ? (
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
            {tabBtn("list", "🧵 목록 · 대여")}
            {tabBtn("mine", "📋 내 기록", mine.active.length)}
          </div>
        ) : null}

        {tab === "list" && !detail ? (
          <div style={{ marginBottom: "14px" }}>
            <div style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름 · 위치로 검색"
                style={{ width: "100%", padding: "9px 11px 9px 32px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none" }}
              />
            </div>
          </div>
        ) : null}

        <div>
          {/* ── 물품 상세: 누가 빌려갔는지 + 대여 ── */}
          {tab === "list" && detail ? (
            <>
              <button
                onClick={() => onDetailId(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "none", border: "none", color: C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700, padding: "0 0 10px" }}
              >
                <ArrowLeft size={14} /> 목록으로
              </button>

              <div style={{ display: "flex", gap: "13px", marginBottom: "14px" }}>
                <div
                  onClick={() => detail.image && setZoomUrl(getGoogleDriveImageUrl(detail.image))}
                  style={{ width: "128px", height: "104px", flexShrink: 0, background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: detail.image ? "zoom-in" : "default" }}
                >
                  {detail.image
                    ? <img src={getThumbImageUrl(detail.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <Layers size={30} style={{ color: C.border }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, wordBreak: "break-word" }}>{detail.name}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {tcLabel(cats, detail.category) ? (
                      <span style={{
                        fontSize: "10.5px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px",
                        color: tcColor(cats, detail.category), background: `${tcColor(cats, detail.category)}1f`,
                      }}>
                        {tcCategory(cats, detail.category)?.emoji} {tcLabel(cats, detail.category)}
                      </span>
                    ) : null}
                    {detail.location ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10.5px", fontWeight: 700, color: C.label, background: C.cardSub, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}>
                        <MapPin size={10} />{detail.location}
                      </span>
                    ) : null}
                    {sizeLabel(detail) ? (
                      <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", border: `1px solid ${C.border}`, color: C.label }}>📐 {sizeLabel(detail)}</span>
                    ) : null}
                    <span style={{ fontSize: "10.5px", fontWeight: 700, color: detail.stock > 0 ? C.success : C.error, background: detail.stock > 0 ? C.successSoft : C.errorSoft, padding: "2px 7px", borderRadius: "6px" }}>
                      남음 {detail.stock}
                    </span>
                    {detail.rented ? (
                      <span style={{ fontSize: "10.5px", fontWeight: 700, color: C.accentText, background: C.accentSoft, padding: "2px 7px", borderRadius: "6px" }}>
                        대여 중 {detail.rented}
                      </span>
                    ) : null}
                  </div>
                  {/* 참고 링크 — 빌리기 전에 원단·구매처를 확인하는 자리라 상세에 그대로 노출한다. */}
                  {tcLinks(detail.link).length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                      {tcLinks(detail.link).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={url}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "100%",
                            fontSize: "10.5px", fontWeight: 700, textDecoration: "none",
                            color: C.accent, background: C.accentSoft, borderRadius: "6px", padding: "3px 8px",
                          }}
                        >
                          <ExternalLink size={11} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tcLinkLabel(url)}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {detail.note ? <div style={{ fontSize: "11.5px", color: C.label }}>{detail.note}</div> : null}
                </div>
              </div>

              {/* 누가 빌려갔는지 */}
              <div style={{ fontSize: "12.5px", fontWeight: 800, color: C.text, marginBottom: "7px" }}>지금 빌려간 사람</div>
              {borrowersLoading ? (
                <div style={{ padding: "16px", textAlign: "center", color: C.label, fontSize: "12.5px" }}>불러오는 중…</div>
              ) : borrowers.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", color: C.label, fontSize: "12.5px", border: `1px dashed ${C.border}`, borderRadius: "10px" }}>
                  대여 중인 사람이 없습니다.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {borrowers.map((b) => (
                    <div key={b.rowIndex} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 11px", background: C.cardSub, borderRadius: "10px" }}>
                      <User size={14} style={{ color: C.label, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "12.5px", fontWeight: 700, color: C.text }}>
                          {b.borrowerName}
                          <span style={{ fontWeight: 600, color: C.label, marginLeft: "6px", fontSize: "11px" }}>
                            {[b.affiliation, b.floor].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: C.label }}>
                          {shortDate(b.borrowDate)}부터{b.purpose ? ` · ${b.purpose}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>{b.quantity}개</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 대여 */}
              <div style={{ marginTop: "16px", borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
                {detail.stock > 0 ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "9px" }}>
                      <span style={{ fontSize: "12.5px", fontWeight: 800, color: C.text }}>수량</span>
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        style={{ width: 30, height: 30, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", justifyContent: "center" }}
                      >−</button>
                      <span style={{ minWidth: "34px", textAlign: "center", fontSize: "14px", fontWeight: 800, color: C.text }}>{qty}</span>
                      <button
                        onClick={() => setQty((q) => Math.min(detail.stock, q + 1))}
                        style={{ width: 30, height: 30, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", justifyContent: "center" }}
                      >+</button>
                    </div>
                    <button
                      onClick={doBorrow}
                      disabled={busy}
                      style={{ width: "100%", padding: "12px", borderRadius: "11px", border: "none", background: C.accent, color: "#fff", fontSize: "13.5px", fontWeight: 800, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
                    >
                      {busy ? "처리 중…" : `${qty}개 대여하기`}
                    </button>
                    <div style={{ fontSize: "11px", color: C.label, textAlign: "center", marginTop: "7px" }}>
                      누르는 즉시 대여 처리됩니다 — 담당자 확인 단계가 없습니다.
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "14px", textAlign: "center", fontSize: "12.5px", fontWeight: 700, color: C.error, background: C.errorSoft, borderRadius: "10px" }}>
                    남은 수량이 없습니다.
                  </div>
                )}

                {/* 반납 — 이 물품을 내가 빌린 게 있으면 대여 바로 밑에서 그대로 돌려줄 수 있다. */}
                {myLinesForDetail.length ? (
                  <div style={{ marginTop: "16px", borderTop: `1px solid ${C.border}`, paddingTop: "14px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 800, color: C.text, marginBottom: "9px" }}>
                      내가 빌린 것 · {myLinesForDetail.reduce((n, r) => n + r.quantity, 0)}개
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                      {myLinesForDetail.map((r) => (
                        <div
                          key={r.rowIndex}
                          style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 11px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12.5px", fontWeight: 700, color: C.text }}>{r.quantity}개</div>
                            <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                              {shortDate(r.borrowDate)} 대여{r.purpose ? ` · ${r.purpose}` : ""}
                            </div>
                          </div>
                          <button
                            onClick={() => doReturn(r)}
                            disabled={busy}
                            style={{
                              display: "flex", alignItems: "center", gap: "5px",
                              padding: "9px 15px", borderRadius: "9px", border: "none",
                              background: C.success, color: "#fff", fontSize: "12.5px", fontWeight: 800,
                              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, flexShrink: 0,
                            }}
                          >
                            <Check size={13} /> {busy ? "처리 중…" : "반납하기"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {/* 층 필터 — 이 화면에서 제일 먼저 정해지는 값이라 맨 위에 둔다.
              로그인할 때 고른 층이 기본으로 켜져 있고, 다른 층은 "전체"를 눌러야 나온다. */}
          {tab === "list" && !detail && locOptions.length > 1 ? (
            <div style={{ marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", fontWeight: 800, color: C.label, marginBottom: "6px" }}>
                <MapPin size={13} /> 층 / 보관 위치
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setLocFilter("")}
                  style={{
                    padding: "7px 13px", borderRadius: "9px", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
                    border: `1px solid ${locFilter === "" ? C.accent : C.border}`,
                    background: locFilter === "" ? C.accentSoft : "transparent",
                    color: locFilter === "" ? C.text : C.label,
                  }}
                >
                  전체 층
                </button>
                {locOptions.map((o) => {
                  const on = locFilter === o.key;
                  return (
                    <button
                      key={o.key || "none"}
                      onClick={() => setLocFilter(on ? "" : o.key)}
                      style={{
                        padding: "7px 13px", borderRadius: "9px", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
                        border: `1px solid ${on ? C.accent : C.border}`,
                        background: on ? C.accentSoft : "transparent",
                        color: on ? C.text : C.label,
                      }}
                    >
                      {isMyFloor(o.key, floor) ? "★ " : ""}{o.key ? o.label : "위치 미지정"} {o.count}
                    </button>
                  );
                })}
              </div>
              {locFilter && isMyFloor(locFilter, floor) ? (
                <div style={{ fontSize: "11px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                  지금은 내 층({locOptions.find((o) => o.key === locFilter)?.label || floor})만 보고 있습니다. 다른 층의 천을 보려면 위에서 층을 바꾸거나 "전체 층"을 누르세요.
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 무늬 분류 필터 — 층을 정한 다음에 무늬로 좁힌다. */}
          {tab === "list" && !detail && catOptions.length > 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setCatFilter("")}
                  style={{
                    padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                    border: `1px solid ${catFilter === "" ? C.accent : C.border}`,
                    background: catFilter === "" ? C.accentSoft : "transparent",
                    color: catFilter === "" ? C.text : C.label,
                  }}
                >
                  전체 무늬
                </button>
                {catOptions.map((o) => {
                  const on = catFilter === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setCatFilter(on ? "" : o.key)}
                      style={{
                        padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                        border: `1px solid ${on ? o.color : C.border}`,
                        background: on ? `${o.color}22` : "transparent",
                        color: on ? o.color : C.label,
                      }}
                    >
                      {o.emoji} {o.label} {o.count}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── 목록 ── */}
          {tab === "list" && !detail ? (
            loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: C.label, fontSize: "13px" }}>불러오는 중…</div>
            ) : shown.length === 0 ? (
              <div style={{ padding: "44px 20px", textAlign: "center", color: C.label, fontSize: "13px", border: `1px dashed ${C.border}`, borderRadius: "12px" }}>
                {search ? "검색 결과가 없습니다." : "등록된 테이블보가 없습니다."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {groupedShown.map((g) => (
                  <section key={g.key || "none"}>
                    {/* 위치 구분선 — 창고에서 실제로 걸어가는 곳이 갈리므로 구역으로 끊어 보여준다. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <MapPin size={12} style={{ color: C.label, flexShrink: 0 }} />
                      <span style={{ fontSize: "12px", fontWeight: 800, color: C.text, flexShrink: 0 }}>
                        {g.key ? g.label : "위치 미지정"}
                      </span>
                      {isMyFloor(g.key, floor) ? (
                        <span style={{
                          fontSize: "10px", fontWeight: 800, padding: "2px 7px", borderRadius: "999px",
                          background: C.accentSoft, color: C.accent, flexShrink: 0,
                        }}>
                          내 층
                        </span>
                      ) : null}
                      <span style={{ fontSize: "10.5px", fontWeight: 700, color: C.label, flexShrink: 0 }}>{g.items.length}종</span>
                      <span style={{ flex: 1, height: 1, background: C.border }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))", gap: "11px" }}>
                {g.items.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => onDetailId(it.id)}
                    style={{
                      border: `1px solid ${C.border}`, background: C.card, borderRadius: "13px", overflow: "hidden",
                      display: "flex", flexDirection: "column", cursor: "pointer",
                    }}
                  >
                    <div style={{ height: "124px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${C.border}` }}>
                      {it.image
                        ? <img src={getThumbImageUrl(it.image)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <Layers size={32} style={{ color: C.border }} />}
                    </div>
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", lineHeight: 1.35, color: C.text, wordBreak: "break-word" }}>{it.name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {tcLabel(cats, it.category) ? (
                          <span style={{
                            fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 6px",
                            color: tcColor(cats, it.category), background: `${tcColor(cats, it.category)}1f`,
                          }}>
                            {tcCategory(cats, it.category)?.emoji} {tcLabel(cats, it.category)}
                          </span>
                        ) : null}
                        {it.location ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: C.label, background: C.cardSub, borderRadius: "6px", padding: "2px 6px", fontFamily: "monospace" }}>
                            <MapPin size={10} />{it.location}
                          </span>
                        ) : null}
                        {sizeLabel(it) ? (
                          <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "6px", border: `1px solid ${C.border}`, color: C.label }}>
                            📐 {sizeLabel(it)}
                          </span>
                        ) : null}
                      </div>
                      {tcLinks(it.link).length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {tcLinks(it.link).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={url}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: "3px", maxWidth: "100%",
                                fontSize: "10px", fontWeight: 700, textDecoration: "none",
                                color: C.accent, background: C.accentSoft, borderRadius: "6px", padding: "2px 6px",
                              }}
                            >
                              <ExternalLink size={10} style={{ flexShrink: 0 }} />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tcLinkLabel(url)}</span>
                            </a>
                          ))}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: it.stock > 0 ? C.success : C.error, background: it.stock > 0 ? C.successSoft : C.errorSoft, padding: "2px 8px", borderRadius: "6px" }}>
                          남음 {it.stock}
                        </span>
                        {it.rented ? (
                          <span style={{ fontSize: "11px", fontWeight: 600, color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>
                            대여 중 {it.rented}
                          </span>
                        ) : null}
                      </div>
                      {it.stock <= 0 && (out[String(it.id)] || []).length ? (
                        <div style={{ fontSize: "10.5px", lineHeight: 1.5, color: C.error, background: C.errorSoft, borderRadius: "7px", padding: "5px 7px" }}>
                          {(out[String(it.id)] || []).map((b, i) => (
                            <div key={i}>
                              {b.borrowerName || "(이름 없음)"}
                              {b.floor || b.unit ? ` · ${[b.floor, b.unit].filter(Boolean).join(" ")}` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {it.note ? (
                        <div style={{ fontSize: "11px", color: C.label, borderLeft: `2px solid ${C.border}`, paddingLeft: "7px" }}>{it.note}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : null}

          {/* ── 내 기록 ── */}
          {tab === "mine" ? (
            mineLoading ? (
              <div style={{ padding: "40px", textAlign: "center", color: C.label, fontSize: "13px" }}>불러오는 중…</div>
            ) : (
              <>
                <div style={{ fontSize: "12.5px", fontWeight: 800, color: C.text, marginBottom: "8px" }}>
                  대여 중 <span style={{ color: C.accentText }}>{mine.active.length}건</span>
                </div>
                {mine.active.length === 0 ? (
                  <div style={{ padding: "22px", textAlign: "center", color: C.label, fontSize: "12.5px", border: `1px dashed ${C.border}`, borderRadius: "11px" }}>
                    빌린 테이블보가 없습니다.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                    {mine.active.map((r) => (
                      <div key={r.rowIndex} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "11px" }}>
                        {r.image ? (
                          <img src={getThumbImageUrl(r.image)} alt="" loading="lazy" style={{ width: 42, height: 42, borderRadius: "8px", objectFit: "cover", flexShrink: 0 }} />
                        ) : null}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.itemLabel} <span style={{ color: C.accentText }}>×{r.quantity}</span>
                          </div>
                          <div style={{ fontSize: "11px", color: C.label, display: "flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={10} />{shortDate(r.borrowDate)}부터{r.location ? ` · ${r.location}` : ""}
                          </div>
                        </div>
                        <button
                          onClick={() => doReturn(r)}
                          disabled={busy}
                          style={{ flexShrink: 0, padding: "8px 14px", borderRadius: "9px", border: "none", background: C.success, color: "#fff", fontSize: "12.5px", fontWeight: 800, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, display: "flex", alignItems: "center", gap: "5px" }}
                        >
                          <Check size={13} /> 반납
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: "12.5px", fontWeight: 800, color: C.text, margin: "18px 0 8px" }}>
                  지난 {mine.days}일 기록
                </div>
                {mine.recent.length === 0 ? (
                  <div style={{ padding: "22px", textAlign: "center", color: C.label, fontSize: "12.5px", border: `1px dashed ${C.border}`, borderRadius: "11px" }}>
                    지난 {mine.days}일 동안의 기록이 없습니다.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {mine.recent.map((r) => (
                      <div key={r.rowIndex} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 11px", background: C.cardSub, borderRadius: "10px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.itemLabel} <span style={{ color: C.label, fontWeight: 600 }}>×{r.quantity}</span>
                          </div>
                          <div style={{ fontSize: "11px", color: C.label }}>
                            {shortDate(r.borrowDate)} 대여{r.returned && r.returnDate ? ` · ${shortDate(r.returnDate)} 반납` : ""}
                          </div>
                        </div>
                        <span style={{
                          flexShrink: 0, fontSize: "10.5px", fontWeight: 800, padding: "3px 9px", borderRadius: "999px",
                          color: r.returned ? C.success : C.accentText,
                          background: r.returned ? C.successSoft : C.accentSoft,
                        }}>
                          {r.returned ? "반납 완료" : "대여 중"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          ) : null}
        </div>
      </div>

      <ImageZoomModal url={zoomUrl} onClose={() => setZoomUrl("")} />
    </div>
  );
}
