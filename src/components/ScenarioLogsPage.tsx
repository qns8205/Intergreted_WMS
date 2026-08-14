import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Search, RotateCcw, Package, MapPin, User, Check, Undo2, RefreshCw,
  TrendingUp, Clock, CheckCircle2, Repeat, X, UserCheck, AlertTriangle,
} from "lucide-react";
import {
  ScenarioLogEntry, ReturnRequest, padSlot,
  fetchScenarioAllLogs, fetchScenarioAllLogsPaged, postProcessReturn, fetchBorrowAppVersion, reBorrowScenarioLogs,
  fetchScenarioObjectsForAdmin, ScenarioObjectAdmin,
  isVersionMismatchMessage, signalVersionOutdated, postSwapBorrowItem,
  fetchWarehouseLogs, fetchWarehouseLogsPaged, WarehouseLogEntry,
} from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import ScrollToTopButton from "./ScrollToTopButton";

// 미반납/반납완료 이력을 "사람 수" 기준으로 페이지네이션한다. 처음엔 각 5명치만 서버에서
// 받아오고, "더 보기"를 누르면 그때 실제로 다음 5명치를 새로 요청한다 — 전체를 미리
// 받아놓고 화면에서만 잘라 보여주는 방식이 아니다.
const PEOPLE_PAGE_SIZE = 5;

// 이 일수를 넘겨 반납하지 않은 건은 "장기 체납"으로 본다.
const OVERDUE_DAYS = 3;

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  isAdmin: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

type StatusFilter = "all" | "unreturned" | "returned";

// 서버가 "몇 명째 처리 중"인지 실시간으로 알려주진 않기 때문에(응답이 한 번에 통째로 옴),
// 5명을 기준으로 일정 간격마다 1명씩 채워지는 것처럼 흉내 낸다. 실제 응답이 오면
// 그 즉시 5/5로 마무리된다 — 그 전까지는 4/5(80%)에서 멈춰 기다린다.
function useFakeStepProgress(active: boolean, steps: number, intervalMs: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) { setCount(0); return; }
    setCount(1);
    const timer = window.setInterval(() => {
      setCount((c) => (c < steps - 1 ? c + 1 : c));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, steps, intervalMs]);
  return count;
}

export default function ScenarioLogsPage({ scriptUrl, connected, isLightMode, isAdmin, showToast }: Props) {
  const C = {
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#2563eb" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#111827" : "#f1f5f9",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  const [logs, setLogs] = useState<ScenarioLogEntry[]>([]);
  const [allItems, setAllItems] = useState<ScenarioObjectAdmin[]>([]);
  const [allItemsLoaded, setAllItemsLoaded] = useState(false);
  const [allItemsLoading, setAllItemsLoading] = useState(false);

  // 전체 물품 카탈로그(통계/물품별 보기 전용) — 처음엔 안 받아오다가, 그 기능을 실제로 열 때만 받아온다.
  const loadAllItemsIfNeeded = useCallback(() => {
    if (allItemsLoaded || allItemsLoading || !connected || !scriptUrl) return;
    setAllItemsLoading(true);
    fetchScenarioObjectsForAdmin(scriptUrl)
      .then((catalog) => { setAllItems(catalog); setAllItemsLoaded(true); })
      .catch((e: any) => showToast(`물품 카탈로그를 불러오지 못했습니다: ${e.message}`, "warn"))
      .finally(() => setAllItemsLoading(false));
  }, [allItemsLoaded, allItemsLoading, connected, scriptUrl, showToast]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "scenario" | "general">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [borrowerFilter, setBorrowerFilter] = useState("");
  const [sel, setSel] = useState<Record<string, number>>({});
  // 대여 중인 한 건을 다른 물품으로 교체 (기존 반납 + 새 물품 대여를 한 번에)
  const [swapTarget, setSwapTarget] = useState<ScenarioLogEntry | null>(null);
  const [swapItemId, setSwapItemId] = useState("");
  const [swapQty, setSwapQty] = useState(1);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reborrowing, setReborrowing] = useState(false);
  const [reborrowModalOpen, setReborrowModalOpen] = useState(false);
  const [reborrowTargetName, setReborrowTargetName] = useState("");
  const [reborrowTargetEmpId, setReborrowTargetEmpId] = useState("");
  const [reborrowTargetAffiliation, setReborrowTargetAffiliation] = useState<"cfgw" | "configds" | "other">("cfgw");
  const [reborrowSameName, setReborrowSameName] = useState(true); // true: 원래 반납자 명의 유지, false: 다른 사람 명의로 재대여
  const [showStats, setShowStats] = useState(false);

  // 미반납/반납완료 각각 독립적으로 "몇 명치 받아왔는지"와 "더 있는지"를 추적한다.
  const [scopeOffsets, setScopeOffsets] = useState<Record<"unreturned" | "returned", number>>({ unreturned: 0, returned: 0 });
  const [scopeHasMore, setScopeHasMore] = useState<Record<"unreturned" | "returned", boolean>>({ unreturned: true, returned: true });
  // 진행률 표시용 — 서버가 페이지마다 "전체 몇 명 중"을 같이 내려준다.
  const [scopeTotalPeople, setScopeTotalPeople] = useState<Record<"unreturned" | "returned", number>>({ unreturned: 0, returned: 0 });
  const [scopeLoadingMore, setScopeLoadingMore] = useState<Record<"unreturned" | "returned", boolean>>({ unreturned: false, returned: false });

  const [viewMode, setViewMode] = useState<"log" | "byItem">("log");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  // 화면에 데이터가 떠 있는지 여부는 ref로 추적한다.
  // (state를 load의 의존성에 넣으면 로드 완료 → load 재생성 → useEffect 재실행의 무한 재조회 루프가 생긴다)
  const hasDataRef = useRef(false);
  // 반납 이력(2단계)이 백그라운드로 들어오는 중인지
  const [historyLoading, setHistoryLoading] = useState(false);
  // 전체 기간 이력까지 다 받아왔는지 (검색 범위 안내용)
  const [historyComplete, setHistoryComplete] = useState(false);

  // 분야 탭: 시나리오 물품 / 공구 및 부품류
  const [category, setCategory] = useState<"scenario" | "warehouse">("scenario");
  // 시나리오: 대여 | 반납, 공구: 대여 | 반납 | 소모
  const [scenarioTab, setScenarioTab] = useState<"borrow" | "return">("borrow");
  const [whTab, setWhTab] = useState<"대여" | "반납" | "소모">("대여");
  const [whLogs, setWhLogs] = useState<WarehouseLogEntry[]>([]);
  const [whLogsLoading, setWhLogsLoading] = useState(false);
  const [whLogsLoaded, setWhLogsLoaded] = useState(false);
  const [whOffset, setWhOffset] = useState(0);
  const [whHasMore, setWhHasMore] = useState(true);
  const [whLoadingMore, setWhLoadingMore] = useState(false);
  const [whTotalPeople, setWhTotalPeople] = useState(0);

  // 5명 기준 진행률 시뮬레이션 — 초기 로딩과 각 "더 보기"마다 따로 추적한다.
  const initialProgress = useFakeStepProgress(loading && !loaded, PEOPLE_PAGE_SIZE, 550);
  const unreturnedProgress = useFakeStepProgress(scopeLoadingMore.unreturned, PEOPLE_PAGE_SIZE, 550);
  const returnedProgress = useFakeStepProgress(scopeLoadingMore.returned, PEOPLE_PAGE_SIZE, 550);
  const whProgress = useFakeStepProgress(whLoadingMore, PEOPLE_PAGE_SIZE, 550);

  // 공구 탭을 처음 열 때 첫 5명치만 불러온다
  useEffect(() => {
    if (category !== "warehouse" || whLogsLoaded || whLogsLoading) return;
    if (!connected || !scriptUrl) { setWhLogsLoaded(true); return; }
    setWhLogsLoading(true);
    fetchWarehouseLogsPaged(scriptUrl, { peopleLimit: PEOPLE_PAGE_SIZE })
      .then((page) => { setWhLogs(page.items); setWhOffset(PEOPLE_PAGE_SIZE); setWhHasMore(page.hasMore); setWhTotalPeople(page.totalPeople); setWhLogsLoaded(true); })
      .catch((e: any) => showToast(`공구 및 부품류 로그를 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => setWhLogsLoading(false));
  }, [category, whLogsLoaded, whLogsLoading, connected, scriptUrl]);

  // "더 보기" — 공구 로그 다음 5명을 실제로 새로 요청한다.
  const loadMoreWarehouse = useCallback(async () => {
    if (!connected || !scriptUrl || whLoadingMore || !whHasMore) return;
    setWhLoadingMore(true);
    try {
      const page = await fetchWarehouseLogsPaged(scriptUrl, { peopleLimit: PEOPLE_PAGE_SIZE, peopleOffset: whOffset });
      setWhLogs((prev) => {
        const seen = new Set(prev.map((l) => l.rowIndex));
        return prev.concat(page.items.filter((l) => !seen.has(l.rowIndex)));
      });
      setWhOffset((o) => o + PEOPLE_PAGE_SIZE);
      setWhHasMore(page.hasMore);
      setWhTotalPeople(page.totalPeople);
    } catch (e: any) {
      showToast(`공구 및 부품류 로그를 더 불러오지 못했습니다: ${e.message}`, "warn");
    } finally {
      setWhLoadingMore(false);
    }
  }, [connected, scriptUrl, whOffset, whHasMore, whLoadingMore, showToast]);

  const whFilteredLogs = useMemo(() => {
    const q = search.trim();
    return whLogs.filter((l) => {
      if (l.type !== whTab) return false;
      if (!q) return true;
      return smartMatch([l.name, l.location, l.user, l.note], q);
    });
  }, [whLogs, whTab, search]);

  // 대여일과 반납일 중 더 최근인 시점(=마지막 활동 시각) 기준 내림차순.
  // 서버가 구버전이라 borrowDateTime을 안 내려주면 서버 순서를 그대로 신뢰한다.
  function parseTs(v?: string) {
    const s = String(v || "").trim();
    if (!s) return 0;
    const t = Date.parse(s.replace(" ", "T"));
    return isNaN(t) ? 0 : t;
  }
  function activityTs(l: ScenarioLogEntry) {
    return Math.max(parseTs(l.borrowDateTime || l.borrowDate), parseTs(l.returnDate));
  }
  function sortLogs(arr: ScenarioLogEntry[]) {
    if (!arr.some((l) => !!l.borrowDateTime)) return arr;
    return arr.sort((a, b) => (activityTs(b) - activityTs(a)) || ((b.rowIndex || 0) - (a.rowIndex || 0)));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setSel({});
    try {
      if (connected && scriptUrl) {
        // 미반납/반납완료 각각 첫 5명치만 받아온다. "더 보기"를 눌러야 다음 5명이 온다.
        // 전체 물품 카탈로그(296개 등)는 여기서 안 받는다 — 통계/물품별 보기를 열 때만 따로 받아온다.
        const [unreturnedPage, returnedPage, ver] = await Promise.all([
          fetchScenarioAllLogsPaged(scriptUrl, { scope: "unreturned", slim: true, peopleLimit: PEOPLE_PAGE_SIZE }),
          fetchScenarioAllLogsPaged(scriptUrl, { scope: "returned", slim: true, peopleLimit: PEOPLE_PAGE_SIZE }),
          fetchBorrowAppVersion(scriptUrl).catch(() => ""),
        ]);
        setLogs(sortLogs([...unreturnedPage.items, ...returnedPage.items]));
        setScopeOffsets({ unreturned: PEOPLE_PAGE_SIZE, returned: PEOPLE_PAGE_SIZE });
        setScopeHasMore({ unreturned: unreturnedPage.hasMore, returned: returnedPage.hasMore });
        setScopeTotalPeople({ unreturned: unreturnedPage.totalPeople, returned: returnedPage.totalPeople });
        setAppVersion(ver);
        hasDataRef.current = unreturnedPage.items.length > 0 || returnedPage.items.length > 0;
        setLoaded(true);
      } else {
        setLogs([
          { sheetType: "scenario", rowIndex: 2, borrowerName: "홍길동", scenarioId: "S00001", itemLabel: "[000060] 소화기 x 2", itemKind: "필수 물품", location: "000060", itemId: "000060", itemName: "소화기", quantity: 2, borrowDate: "2026-07-15 09:00", borrowPurpose: "훈련", email: "", batchId: "b1", returned: false, image: "", stock: 5, rented: 2 },
          { sheetType: "general", rowIndex: 3, borrowerName: "김철수", itemLabel: "[000012] 삼각대 x 1", location: "000012", itemId: "000012", itemName: "삼각대", quantity: 1, borrowDate: "2026-07-11 14:00", borrowPurpose: "촬영", email: "", batchId: "b2", generalOption: "일반 대여", returned: true, image: "", stock: 3, rented: 0 },
        ]);
        hasDataRef.current = true;
        setLoaded(true);
      }
    } catch (e: any) {
      // 이미 대장이 화면에 떠 있는 상태의 새로고침 실패라면(보기 전용 갱신) 조용한 경고로만 알린다.
      if (hasDataRef.current) {
        showToast("대장 새로고침이 지연되어 기존 데이터를 그대로 표시합니다.", "warn");
      } else {
        showToast(`시나리오 대여 대장을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
    finally { setLoading(false); }
  }, [connected, scriptUrl, showToast]);

  // "더 보기" — 미반납/반납완료 중 지금 탭에 해당하는 쪽만 다음 5명을 실제로 새로 요청한다.
  const loadMoreScope = useCallback(async (scope: "unreturned" | "returned") => {
    if (!connected || !scriptUrl || scopeLoadingMore[scope] || !scopeHasMore[scope]) return;
    setScopeLoadingMore((p) => ({ ...p, [scope]: true }));
    try {
      const offset = scopeOffsets[scope];
      const page = await fetchScenarioAllLogsPaged(scriptUrl, { scope, slim: true, peopleLimit: PEOPLE_PAGE_SIZE, peopleOffset: offset });
      setLogs((prev) => {
        const seen = new Set(prev.map((l) => `${l.sheetType}:${l.rowIndex}`));
        return sortLogs(prev.concat(page.items.filter((l) => !seen.has(`${l.sheetType}:${l.rowIndex}`))));
      });
      setScopeOffsets((p) => ({ ...p, [scope]: offset + PEOPLE_PAGE_SIZE }));
      setScopeHasMore((p) => ({ ...p, [scope]: page.hasMore }));
      setScopeTotalPeople((p) => ({ ...p, [scope]: page.totalPeople }));
    } catch (e: any) {
      showToast(`이력을 더 불러오지 못했습니다: ${e.message}`, "warn");
    } finally {
      setScopeLoadingMore((p) => ({ ...p, [scope]: false }));
    }
  }, [connected, scriptUrl, scopeOffsets, scopeHasMore, scopeLoadingMore, showToast]);

  // 최초 진입(및 연동 상태가 실제로 바뀐 경우)에만 1회 로드. 이후에는 새로고침 버튼으로만 갱신한다.
  const loadedKeyRef = useRef("");
  useEffect(() => {
    const key = `${connected}|${scriptUrl}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    load();
  }, [connected, scriptUrl, load]);

  const borrowers = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((it) => { if (it.borrowerName) set.add(it.borrowerName); });
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return logs.filter((it) => {
      if (kindFilter !== "all" && it.sheetType !== kindFilter) return false;
      if (statusFilter === "unreturned" && it.returned) return false;
      if (statusFilter === "returned" && !it.returned) return false;
      if (borrowerFilter && it.borrowerName !== borrowerFilter) return false;
      if (!q) return true;
      return smartMatch([it.itemLabel, it.borrowerName, it.scenarioId, it.borrowPurpose, it.location, padSlot(it.location)], q);
    });
  }, [logs, search, kindFilter, statusFilter, borrowerFilter]);

  // 신청 단위(batchId+borrower)로 그룹화, 이미 최신순으로 서버 정렬됨
  // 묶음 기준:
  //  - 미반납 건은 "같은 시각에 대여한 묶음"(대여자 + 배치ID)으로 묶는다.
  //  - 반납 완료 건은 "같은 시각에 반납한 묶음"(대여자 + 반납시각)으로 따로 묶는다.
  // 한 번에 대여한 물품을 나눠서 반납한 경우, 대여 묶음이 아니라 반납한 시점별로 나뉘어 보인다.
  const groups = useMemo(() => {
    const map = new Map<string, {
      key: string; borrower: string; scenarioId?: string; date: string; purpose: string;
      kind: string; seat: string; items: ScenarioLogEntry[]; allReturned: boolean; isReturnGroup: boolean;
    }>();

    // 반납 묶음은 분 단위까지만 보고 묶는다 (초가 1~2초 어긋나는 경우가 있다)
    const returnBucket = (v?: string) => String(v || "").trim().slice(0, 16) || "(반납일 미상)";

    filtered.forEach((it) => {
      const isReturned = !!it.returned;
      const gkey = isReturned
        ? `R|${it.borrowerName}|${returnBucket(it.returnDate)}`
        : `B|${it.borrowerName}|${it.batchId || it.scenarioId || it.borrowDate}`;

      if (!map.has(gkey)) {
        map.set(gkey, {
          key: gkey,
          borrower: it.borrowerName,
          scenarioId: it.scenarioId,
          date: isReturned ? (it.returnDate || it.borrowDate) : it.borrowDate,
          purpose: it.borrowPurpose,
          kind: isReturned ? "반납" : (it.sheetType === "scenario" ? "SID 대여" : "일반 대여"),
          seat: [it.floor, it.unit].filter(Boolean).join(" · "),
          items: [],
          allReturned: isReturned,
          isReturnGroup: isReturned,
        });
      }
      const g = map.get(gkey)!;
      g.items.push(it);
      if (!it.returned) g.allReturned = false;
      // 같은 묶음 안에 SID가 섞여 있으면 첫 값을 유지하되, 비어 있으면 채운다
      if (!g.scenarioId && it.scenarioId) g.scenarioId = it.scenarioId;
      if (!g.seat) g.seat = [it.floor, it.unit].filter(Boolean).join(" · ");
    });

    // 묶음 시각(대여 묶음은 대여일, 반납 묶음은 반납일) 기준 최신순
    const ts = (v?: string) => {
      const t = Date.parse(String(v || "").trim().replace(" ", "T"));
      return isNaN(t) ? 0 : t;
    };
    return Array.from(map.values())
      // 시나리오 탭(대여/반납)에 맞는 묶음만 남긴다
      .filter((g) => (scenarioTab === "return" ? g.isReturnGroup : !g.isReturnGroup))
      .sort((a, b) => ts(b.date) - ts(a.date));
  }, [filtered, scenarioTab]);

  // 물품별 보기: 현재 미반납(대여 중)인 항목만 물품 기준으로 묶는다.
  const byItemGroups = useMemo(() => {
    const map = new Map<string, {
      key: string; itemName: string; itemId: string; location: string; totalQty: number;
      entries: { borrowerName: string; quantity: number; floor?: string; unit?: string; borrowDate: string; scenarioId?: string; sheetType: string }[];
    }>();
    logs.forEach((it) => {
      if (it.returned) return;
      const nm = String(it.itemName || it.itemLabel || "").trim() || "(물품 미등록)";
      const key = it.itemId ? `id:${it.itemId}` : `nm:${nm}`;
      if (!map.has(key)) map.set(key, { key, itemName: nm, itemId: it.itemId || "", location: it.location || "", totalQty: 0, entries: [] });
      const g = map.get(key)!;
      g.totalQty += it.quantity || 1;
      g.entries.push({ borrowerName: it.borrowerName, quantity: it.quantity || 1, floor: it.floor, unit: it.unit, borrowDate: it.borrowDate, scenarioId: it.scenarioId, sheetType: it.sheetType });
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty || a.itemName.localeCompare(b.itemName));
  }, [logs]);

  const selectedItemGroup = useMemo(() => byItemGroups.find((g) => g.key === selectedItemKey) || null, [byItemGroups, selectedItemKey]);

  // ── 분석: 대여자별·기간별 집계 ──
  const stats = useMemo(() => {
    const byBorrower: Record<string, { total: number; unreturned: number; returned: number }> = {};
    const byItem: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    // 카탈로그의 모든 물품을 먼저 0으로 깔아둔다 — 한 번도 대여된 적 없는 물품도
    // "가장 적게 대여된 물품"에 (당연히 0회로) 나와야 하기 때문.
    allItems.forEach((it) => {
      const nm = String(it.name || "").trim();
      if (nm) byItem[nm] = 0;
    });
    logs.forEach((l) => {
      const b = l.borrowerName || "(미상)";
      if (!byBorrower[b]) byBorrower[b] = { total: 0, unreturned: 0, returned: 0 };
      byBorrower[b].total += 1;
      if (l.returned) byBorrower[b].returned += 1; else byBorrower[b].unreturned += 1;
      // '(물품 미등록)' 등 이름 없는 항목은 품목 통계에서 제외
      const nm = String(l.itemName || "").trim();
      if (nm && nm !== "(물품 미등록)") byItem[nm] = (byItem[nm] || 0) + l.quantity;
      const day = String(l.borrowDate || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    });
    const topBorrowers = Object.entries(byBorrower).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    const topItems = Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 5);
    // "가장 적게 대여된 물품" 랭킹에서 제외하도록 표시된 물품은 여기서만 걸러낸다 (많이 대여된 물품 순위엔 영향 없음).
    const excludedNames = new Set(allItems.filter((it) => it.excludeFromRanking).map((it) => String(it.name || "").trim()));
    const bottomItems = Object.entries(byItem).filter(([name]) => !excludedNames.has(name)).sort((a, b) => a[1] - b[1]).slice(0, 5);
    const recentDays = Object.entries(byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7);
    return { topBorrowers, topItems, bottomItems, recentDays };
  }, [logs, allItems]);

  // 장기 체납자: 미반납 상태로 OVERDUE_DAYS를 넘긴 건을 대여자별로 모은다.
  const overdueBorrowers = useMemo(() => {
    const now = Date.now();
    const limitMs = OVERDUE_DAYS * 24 * 60 * 60 * 1000;
    const map = new Map<string, { name: string; count: number; qty: number; oldestMs: number; items: ScenarioLogEntry[] }>();

    logs.forEach((l) => {
      if (l.returned) return;
      const raw = String(l.borrowDateTime || l.borrowDate || "").trim();
      if (!raw) return;
      const t = Date.parse(raw.replace(" ", "T"));
      if (isNaN(t)) return;
      if (now - t < limitMs) return;

      const name = String(l.borrowerName || "").trim() || "(이름 없음)";
      if (!map.has(name)) map.set(name, { name, count: 0, qty: 0, oldestMs: t, items: [] });
      const g = map.get(name)!;
      g.count += 1;
      g.qty += l.quantity || 1;
      g.items.push(l);
      if (t < g.oldestMs) g.oldestMs = t;
    });

    // 가장 오래 안 돌려준 사람이 위로
    return Array.from(map.values())
      .map((g) => ({ ...g, days: Math.floor((now - g.oldestMs) / (24 * 60 * 60 * 1000)) }))
      .sort((a, b) => b.days - a.days || b.qty - a.qty);
  }, [logs]);

  const selKey = (it: ScenarioLogEntry) => `${it.sheetType}:${it.rowIndex}`;
  const selCount = Object.keys(sel).length;
  const selEntries = useMemo(() => Object.keys(sel).map((k) => logs.find((l) => selKey(l) === k)).filter(Boolean) as ScenarioLogEntry[], [sel, logs]);
  const selHasReturned = selEntries.some((e) => e.returned);
  const selHasUnreturned = selEntries.some((e) => !e.returned);

  function toggle(it: ScenarioLogEntry) {
    const k = selKey(it);
    setSel((p) => { const n = { ...p }; if (k in n) delete n[k]; else n[k] = it.quantity; return n; });
  }
  function toggleGroup(g: { items: ScenarioLogEntry[] }) {
    setSel((p) => {
      const n = { ...p };
      const allSel = g.items.every((it) => selKey(it) in n);
      g.items.forEach((it) => { const k = selKey(it); if (allSel) delete n[k]; else n[k] = it.quantity; });
      return n;
    });
  }

  async function doReturn() {
    if (!isAdmin) { showToast("반납 처리는 관리자만 가능합니다.", "warn"); return; }
    const targets = selEntries.filter((e) => !e.returned);
    if (!targets.length) { showToast("반납할(미반납) 물품을 선택해주세요.", "warn"); return; }
    setSubmitting(true);
    try {
      const reqs: ReturnRequest[] = targets.map((e) => ({ sheetType: e.sheetType, rowIndex: e.rowIndex, quantity: sel[selKey(e)] }));
      if (connected && scriptUrl) {
        const res = await postProcessReturn(scriptUrl, reqs, appVersion);
        // 구버전으로 거절된 경우: 토스트 대신 전체 화면 안내 오버레이를 띄운다.
        if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
        if (!res.success) { showToast(res.message || "반납 처리 실패", "error"); return; }
        showToast(res.message || `${targets.length}건을 반납 처리했습니다.`, "ok");
      } else { showToast("데모 모드: 실제 반납은 연동 시 동작합니다.", "info"); }

      // 서버 재조회는 반납 이력을 뒤늦게 받아오기 때문에, 방금 반납한 건이 한동안 목록에서 사라진다.
      // 화면에서 먼저 반납 상태로 바꿔 "반납 묶음"이 즉시 맨 위에 뜨도록 한다. (이후 재조회로 정합성 확보)
      const nowStamp = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const returnedAt = `${nowStamp.getFullYear()}-${pad(nowStamp.getMonth() + 1)}-${pad(nowStamp.getDate())} ${pad(nowStamp.getHours())}:${pad(nowStamp.getMinutes())}:${pad(nowStamp.getSeconds())}`;
      const returnedKeys = new Set(targets.map((e) => selKey(e)));
      setLogs((prev) => prev.map((l) => (returnedKeys.has(selKey(l)) ? { ...l, returned: true, returnDate: returnedAt } : l)));
      setSel({});

      await load();
    } catch (e: any) { showToast(`반납 처리 실패: ${e.message}`, "error"); }
    finally { setSubmitting(false); }
  }

  function openSwapModal() {
    if (!isAdmin) { showToast("물품 교체는 관리자만 가능합니다.", "warn"); return; }
    const targets = selEntries.filter((e) => !e.returned);
    if (targets.length !== 1) { showToast("교체할 대여 건 1개만 선택해주세요.", "warn"); return; }
    const t = targets[0];
    setSwapTarget(t);
    setSwapItemId("");
    setSwapQty(t.quantity || 1);
    setSwapSearch("");
    setSwapReason("");
    loadAllItemsIfNeeded();
  }

  async function doSwap() {
    if (!swapTarget) return;
    if (!swapItemId) { showToast("교체할 물품을 선택해주세요.", "warn"); return; }
    if (!swapQty || swapQty <= 0) { showToast("수량을 1개 이상으로 입력해주세요.", "warn"); return; }
    setSwapping(true);
    try {
      if (connected && scriptUrl) {
        const res = await postSwapBorrowItem(scriptUrl, {
          sheetType: swapTarget.sheetType,
          rowIndex: swapTarget.rowIndex,
          newItemId: swapItemId,
          newQuantity: swapQty,
          reason: swapReason.trim(),
        }, appVersion);
        if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
        if (!res.success) { showToast(res.message || "물품 교체 실패", "error"); return; }
        showToast(res.message || "물품을 교체했습니다.", "ok");
      } else { showToast("데모 모드: 실제 교체는 연동 시 동작합니다.", "info"); }
      setSwapTarget(null);
      setSel({});
      await load();
    } catch (e: any) { showToast(`물품 교체 실패: ${e.message}`, "error"); }
    finally { setSwapping(false); }
  }

  function openReBorrowModal() {
    if (!isAdmin) { showToast("재대여는 관리자만 가능합니다.", "warn"); return; }
    const targets = selEntries.filter((e) => e.returned);
    if (!targets.length) { showToast("재대여할(반납완료) 물품을 선택해주세요.", "warn"); return; }
    // 선택된 항목의 원래 대여자가 전부 동일하면 이름을 미리 채워준다.
    const names = new Set(targets.map((e) => e.borrowerName));
    setReborrowTargetName(names.size === 1 ? targets[0].borrowerName : "");
    setReborrowTargetEmpId("");
    setReborrowTargetAffiliation("cfgw");
    setReborrowSameName(true);
    setReborrowModalOpen(true);
  }

  async function doReBorrow() {
    const targets = selEntries.filter((e) => e.returned);
    if (!targets.length) return;

    // 명의를 그대로 유지하는 경우: 기존처럼 원래 대여자별로 묶어서 각각 재대여.
    // 다른 사람 명의로 재대여하는 경우: 선택된 항목 전부를 지정한 한 사람 앞으로 한 번에 재대여.
    setReborrowing(true);
    try {
      if (connected && scriptUrl) {
        let ok = 0;
        if (reborrowSameName) {
          const byBorrower: Record<string, ScenarioLogEntry[]> = {};
          targets.forEach((e) => { (byBorrower[e.borrowerName] ||= []).push(e); });
          for (const b of Object.keys(byBorrower)) {
            const res = await reBorrowScenarioLogs(scriptUrl, byBorrower[b], appVersion);
            if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); setReborrowModalOpen(false); return; }
            if (res.success) ok += byBorrower[b].length;
            else showToast(`${b} 재대여 실패: ${res.message}`, "error");
          }
        } else {
          const name = reborrowTargetName.trim();
          if (!name) { showToast("재대여할 사람의 이름을 입력해주세요.", "warn"); setReborrowing(false); return; }
          const empId = reborrowTargetEmpId.trim();
          if (reborrowTargetAffiliation === "cfgw" && !empId) {
            showToast("Cfgw-kr 소속은 사번을 입력해야 Slack 태깅이 정확히 됩니다.", "warn"); setReborrowing(false); return;
          }
          const res = await reBorrowScenarioLogs(scriptUrl, targets, appVersion, {
            name,
            employeeId: reborrowTargetAffiliation === "cfgw" ? empId : "",
            affiliation: reborrowTargetAffiliation,
          });
          if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); setReborrowModalOpen(false); return; }
          if (res.success) ok += targets.length;
          else showToast(`재대여 실패: ${res.message}`, "error");
        }
        if (ok) showToast(`${ok}건을 ${reborrowSameName ? "동일 조건으로" : `${reborrowTargetName.trim()}님 명의로`} 다시 대여 신청했습니다.`, "ok");
      } else { showToast("데모 모드: 실제 재대여는 연동 시 동작합니다.", "info"); }
      setReborrowModalOpen(false);
      setSel({});
      setReborrowing(false);      // 목록 재조회를 기다리며 "처리 중"으로 남지 않게 먼저 푼다
      await load();
    } catch (e: any) { showToast(`재대여 실패: ${e.message}`, "error"); }
    finally { setReborrowing(false); setReborrowModalOpen(false); }
  }

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "slp-spin 0.9s linear infinite" }} />;
  }

  const total = logs.length;
  const unreturnedCount = logs.filter((l) => !l.returned).length;
  const returnedCount = logs.filter((l) => l.returned).length;

  return (
    <div className="slp-root">
      <style>{`
        @keyframes slp-spin { to { transform: rotate(360deg); } }
        @media (min-width: 900px) {
          .slp-root { zoom: 1.15; }
        }
      `}</style>

      {/* 내부 탭: 대여 로그 / 물품별 보기 */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
        {[
          { key: "log" as const, label: "대여 로그" },
          { key: "byItem" as const, label: "현재 대여 물품별 보기" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setViewMode(t.key)}
            style={{
              padding: "8px 16px", borderRadius: "10px",
              border: `1px solid ${viewMode === t.key ? C.accent : C.border}`,
              background: viewMode === t.key ? C.accentSoft : C.card,
              color: viewMode === t.key ? C.accentText : C.label,
              cursor: "pointer", fontSize: "12.5px", fontWeight: 700,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {viewMode === "byItem" ? (
        <div>
          <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>
            현재 대여 중인 물품 <b style={{ color: C.accentText }}>{byItemGroups.length}종</b>
          </div>
          {loading && !loaded ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "64px 0", color: C.label }}>
              <Spinner size={30} />
              <div>불러오는 중... ({initialProgress}/{PEOPLE_PAGE_SIZE})</div>
              <div style={{ width: "180px", height: "6px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
                <div style={{ width: `${(initialProgress / PEOPLE_PAGE_SIZE) * 100}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.4s ease" }} />
              </div>
            </div>
          ) : byItemGroups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>현재 대여 중인 물품이 없습니다.</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
              {byItemGroups.map((g) => (
                <div
                  key={g.key}
                  onClick={() => setSelectedItemKey(g.key)}
                  style={{ padding: "14px", borderRadius: "12px", border: `1px solid ${C.border}`, background: C.card, cursor: "pointer", display: "flex", flexDirection: "column", gap: "6px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Package size={15} style={{ color: C.label, flexShrink: 0 }} />
                    <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, wordBreak: "break-word", flex: 1 }}>{g.itemName}</div>
                  </div>
                  {g.itemId ? <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>[{padSlot(g.itemId)}]</div> : null}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                    <span style={{ fontSize: "11px", color: C.label }}>{new Set(g.entries.map((e) => e.borrowerName)).size}명에게 대여 중</span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px" }}>{g.totalQty}개</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
      {/* 요약 통계 */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        {[
          { label: "전체 기록", value: total, color: C.accentText, bg: C.accentSoft, icon: <Package size={16} /> },
          { label: "미반납", value: unreturnedCount, color: C.warn, bg: C.warnSoft, icon: <Clock size={16} /> },
          { label: "반납 완료", value: returnedCount, color: C.success, bg: C.successSoft, icon: <CheckCircle2 size={16} /> },
        ].map((s) => (
          <div key={s.label} style={{ flex: "1 1 120px", padding: "12px 14px", borderRadius: "12px", background: s.bg, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.label, fontWeight: 600 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
        <button onClick={() => { setShowStats((v) => !v); loadAllItemsIfNeeded(); }} style={{ flex: "0 0 auto", padding: "0 16px", borderRadius: "12px", border: `1px solid ${showStats ? C.accent : C.border}`, background: showStats ? C.accentSoft : C.card, color: showStats ? C.accentText : C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
          <TrendingUp size={15} /> 분석 {showStats ? "닫기" : "보기"}
        </button>
      </div>

      {/* 분석 패널 */}
      {showStats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "14px" }}>
          <StatCard C={C} title="대여자별 (상위 5)" rows={stats.topBorrowers.map(([name, v]) => ({ label: name, value: `${v.total}건 (미반납 ${v.unreturned})` }))} />
          <StatCard C={C} title="많이 대여된 물품 (상위 5)" rows={stats.topItems.map(([name, v]) => ({ label: name, value: `${v}개` }))} />
          <StatCard C={C} title="가장 적게 대여된 물품 (하위 5)" rows={stats.bottomItems.map(([name, v]) => ({ label: name, value: `${v}개` }))} />
          <StatCard C={C} title="최근 대여일별 (7일)" rows={stats.recentDays.map(([day, v]) => ({ label: day, value: `${v}건` }))} />
        </div>
      ) : null}

      {/* 분야 탭: 시나리오 물품 / 공구 및 부품류 */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        {([["scenario", "🧩 시나리오 물품"], ["warehouse", "🔧 공구 및 부품류"]] as const).map(([v, label]) => {
          const on = category === v;
          return (
            <button
              key={v}
              onClick={() => setCategory(v)}
              style={{
                flex: 1, padding: "11px", borderRadius: "12px", cursor: "pointer",
                fontSize: "13.5px", fontWeight: 800,
                border: `1px solid ${on ? C.accent : C.border}`,
                background: on ? C.accentSoft : C.card,
                color: on ? C.accentText : C.label,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 하위 탭 */}
      <div style={{ display: "flex", gap: "5px", marginBottom: "10px", flexWrap: "wrap" }}>
        {category === "scenario"
          ? ([["borrow", "대여"], ["return", "반납"]] as const).map(([v, label]) => {
              const on = scenarioTab === v;
              return (
                <button key={v} onClick={() => setScenarioTab(v)}
                  style={{ padding: "7px 16px", borderRadius: "999px", cursor: "pointer", fontSize: "12.5px", fontWeight: 700,
                    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.card, color: on ? "#fff" : C.label }}>
                  {label}
                </button>
              );
            })
          : (["대여", "반납", "소모"] as const).map((v) => {
              const on = whTab === v;
              const n = whLogs.filter((l) => l.type === v).length;
              return (
                <button key={v} onClick={() => setWhTab(v)}
                  style={{ padding: "7px 16px", borderRadius: "999px", cursor: "pointer", fontSize: "12.5px", fontWeight: 700,
                    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.card, color: on ? "#fff" : C.label }}>
                  {v} {whLogsLoaded ? <span style={{ fontWeight: 500, opacity: 0.8 }}>{n}</span> : null}
                </button>
              );
            })}
      </div>

      {/* 필터 (스크롤해도 고정) */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center", position: "sticky", top: 0, zIndex: 30, background: isLightMode ? "#f8fafc" : "#0b0f19", padding: "10px 0" }}>
        <div style={{ position: "relative", flex: "2 1 240px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 · 대여자 · SID · 목적 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", width: "100%" }} />
        </div>
        {category === "scenario" ? (
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="all">전체 상태</option>
          <option value="unreturned">미반납만</option>
          <option value="returned">반납완료만</option>
        </select>
        ) : null}
        {category === "scenario" ? (
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="all">전체 유형</option>
          <option value="scenario">SID 대여</option>
          <option value="general">일반 대여</option>
        </select>
        ) : null}
        {category === "scenario" ? (
        <select value={borrowerFilter} onChange={(e) => setBorrowerFilter(e.target.value)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="">전체 대여자</option>
          {borrowers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        ) : null}
        <button onClick={() => { if (category === "warehouse") { setWhLogs([]); setWhOffset(0); setWhHasMore(true); setWhLogsLoaded(false); } else { load(); } }} title="새로고침" style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText }}><RotateCcw size={14} /></button>
      </div>
      {/* 장기 체납자: 미반납 상태로 오래 지난 대여자를 맨 위에 모아 보여준다 */}
      {category === "scenario" && loaded && overdueBorrowers.length > 0 ? (
        <div style={{ marginBottom: "12px", border: `1px solid ${C.error}55`, background: C.errorSoft, borderRadius: "14px", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
            <AlertTriangle size={15} style={{ color: C.error }} />
            <span style={{ fontSize: "13px", fontWeight: 800, color: C.error, flex: 1 }}>
              장기 체납 {overdueBorrowers.length}명 <span style={{ fontWeight: 600, opacity: 0.85 }}>({OVERDUE_DAYS}일 이상 미반납)</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
            {overdueBorrowers.map((p) => {
              const on = borrowerFilter === p.name;
              return (
                <button
                  key={p.name}
                  onClick={() => setBorrowerFilter(on ? "" : p.name)}
                  title={`${p.name} · ${p.count}건 · 총 ${p.qty}개 · 최장 ${p.days}일 경과`}
                  style={{
                    display: "flex", alignItems: "center", gap: "7px",
                    padding: "6px 12px", borderRadius: "999px", cursor: "pointer",
                    border: `1px solid ${on ? C.error : C.border}`,
                    background: on ? C.error : C.card,
                    color: on ? "#fff" : C.text,
                    fontSize: "12px", fontWeight: 700,
                  }}
                >
                  {p.name}
                  <span style={{ fontWeight: 800, color: on ? "#fff" : C.error }}>{p.days}일</span>
                  <span style={{ fontWeight: 500, opacity: 0.8 }}>{p.qty}개</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: "11px", color: C.label, marginTop: "8px" }}>
            이름을 누르면 그 사람의 기록만 걸러서 봅니다. 한 번 더 누르면 해제됩니다.
          </div>
        </div>
      ) : null}

      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>
        {category === "warehouse" ? (
          whLogsLoaded ? `${whFilteredLogs.length}건 (최신순) · 검색은 지금까지 불러온 범위 안에서만 됩니다` : ""
        ) : loaded ? (
          `${filtered.length} / ${logs.length}건 (최신순) · 검색은 지금까지 불러온 범위 안에서만 됩니다`
        ) : ""}
      </div>

      {/* 공구 및 부품류 로그 */}
      {category === "warehouse" ? (
        whLogsLoading && !whLogsLoaded ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "64px 0", color: C.label }}>
            <Spinner size={30} />
            <div>불러오는 중... ({initialProgress}/{PEOPLE_PAGE_SIZE})</div>
            <div style={{ width: "180px", height: "6px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
              <div style={{ width: `${(initialProgress / PEOPLE_PAGE_SIZE) * 100}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.4s ease" }} />
            </div>
          </div>
        ) : whFilteredLogs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
            <Check size={36} style={{ color: C.border, marginBottom: "8px" }} />
            <div>표시할 {whTab} 기록이 없습니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {whFilteredLogs.map((l) => {
              const tone = l.type === "반납" ? C.success : l.type === "소모" ? C.warn : C.accentText;
              const toneBg = l.type === "반납" ? C.successSoft : l.type === "소모" ? C.warnSoft : C.accentSoft;
              return (
                <div key={`${l.rowIndex}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", border: `1px solid ${C.border}`, borderRadius: "12px", background: C.card }}>
                  <span style={{ fontSize: "11px", fontWeight: 800, color: tone, background: toneBg, borderRadius: "999px", padding: "3px 10px", flexShrink: 0 }}>{l.type}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.name}
                      {l.location ? <span style={{ fontSize: "11px", color: C.warn, fontFamily: "monospace", marginLeft: "6px" }}>{l.location}</span> : null}
                    </div>
                    <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                      {l.timestamp}{l.user ? ` · ${l.user}` : ""}{l.note ? ` · ${l.note}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>{l.quantity}개</span>
                </div>
              );
            })}
            {whTotalPeople > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: whHasMore ? "0" : undefined }}>
                <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, Math.round((Math.min(whOffset, whTotalPeople) / whTotalPeople) * 100))}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.3s ease" }} />
                </div>
                <span style={{ fontSize: "11px", color: C.label, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {Math.min(whOffset, whTotalPeople)} / {whTotalPeople}명 ({Math.min(100, Math.round((Math.min(whOffset, whTotalPeople) / whTotalPeople) * 100))}%)
                </span>
              </div>
            ) : null}
            {whHasMore ? (
              <button onClick={loadMoreWarehouse} disabled={whLoadingMore} style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: whLoadingMore ? "wait" : "pointer", fontSize: "13px", fontWeight: 700, opacity: whLoadingMore ? 0.7 : 1 }}>
                {whLoadingMore ? "불러오는 중..." : "더 보기 (다음 5명)"}
              </button>
            ) : null}
            {whLoadingMore ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
                  <div style={{ width: `${(whProgress / PEOPLE_PAGE_SIZE) * 100}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.4s ease" }} />
                </div>
                <span style={{ fontSize: "11px", color: C.label, fontWeight: 700, whiteSpace: "nowrap" }}>{whProgress}/{PEOPLE_PAGE_SIZE}명 확인 중...</span>
              </div>
            ) : null}
          </div>
        )
      ) : loading && !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "64px 0", color: C.label }}>
          <Spinner size={30} />
          <div>불러오는 중... ({initialProgress}/{PEOPLE_PAGE_SIZE})</div>
          <div style={{ width: "180px", height: "6px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
            <div style={{ width: `${(initialProgress / PEOPLE_PAGE_SIZE) * 100}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.4s ease" }} />
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>표시할 대여 기록이 없습니다.</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map((g) => (
            <div key={g.key} style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden", opacity: g.allReturned ? 0.85 : 1 }}>
              <div onClick={() => isAdmin && toggleGroup(g)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: C.cardSub, cursor: isAdmin ? "pointer" : "default" }}>
                <div style={{ width: 34, height: 34, borderRadius: "9px", background: g.allReturned ? C.successSoft : C.accentSoft, color: g.allReturned ? C.success : C.accentText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{g.borrower} {g.scenarioId ? <span style={{ fontSize: "11px", color: C.warn, fontWeight: 700 }}>· {g.scenarioId}</span> : null}</div>
                  <div style={{ fontSize: "11px", color: C.label }}>
                    {g.isReturnGroup ? `반납 · ${g.date}` : `${g.kind} · ${g.date}`}
                    {g.seat ? <span style={{ color: C.warn, fontWeight: 700 }}> · 📍 {g.seat}</span> : null}
                    {g.purpose ? ` · ${g.purpose}` : ""}
                  </div>
                </div>
                {g.allReturned ? <span style={{ fontSize: "11px", fontWeight: 700, color: C.success, background: C.successSoft, padding: "3px 10px", borderRadius: "14px", flexShrink: 0 }}>반납완료</span>
                  : <span style={{ fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, padding: "3px 10px", borderRadius: "14px", flexShrink: 0 }}>미반납 포함</span>}
              </div>
              <div style={{ padding: "8px 12px" }}>
                {g.items.map((it) => {
                  const k = selKey(it);
                  const checked = k in sel;
                  return (
                    <div key={k} onClick={() => isAdmin && toggle(it)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 8px", borderRadius: "10px", cursor: isAdmin ? "pointer" : "default", background: checked ? C.accentSoft : "transparent" }}>
                      {isAdmin ? <input type="checkbox" readOnly checked={checked} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} /> : <Package size={15} style={{ color: C.label, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, wordBreak: "break-word", textDecoration: it.returned ? "line-through" : "none", opacity: it.returned ? 0.7 : 1 }}>{it.itemLabel}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "3px", flexWrap: "wrap" }}>
                          {it.location ? <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={10} />{padSlot(it.location)}</span> : null}
                          {it.returned ? <span style={{ fontSize: "10px", fontWeight: 700, color: C.success, background: C.successSoft, borderRadius: "6px", padding: "2px 7px" }}>반납완료</span> : <span style={{ fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px" }}>미반납</span>}
                          {it.itemKind ? <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "6px", padding: "2px 7px" }}>{it.itemKind}</span> : null}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: C.label, fontWeight: 600, flexShrink: 0 }}>x{it.quantity}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {(() => {
            const scope = scenarioTab === "return" ? "returned" : "unreturned";
            const shown = Math.min(scopeOffsets[scope], scopeTotalPeople[scope] || scopeOffsets[scope]);
            const total = scopeTotalPeople[scope];
            const pct = total > 0 ? Math.min(100, Math.round((shown / total) * 100)) : 0;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {total > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.3s ease" }} />
                    </div>
                    <span style={{ fontSize: "11px", color: C.label, fontWeight: 700, whiteSpace: "nowrap" }}>{shown} / {total}명 ({pct}%)</span>
                  </div>
                ) : null}
                {scopeHasMore[scope] ? (
                  <button onClick={() => loadMoreScope(scope)} disabled={scopeLoadingMore[scope]} style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: scopeLoadingMore[scope] ? "wait" : "pointer", fontSize: "13px", fontWeight: 700, opacity: scopeLoadingMore[scope] ? 0.7 : 1 }}>
                    {scopeLoadingMore[scope] ? "불러오는 중..." : "더 보기 (다음 5명)"}
                  </button>
                ) : null}
                {scopeLoadingMore[scope] ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: C.border, overflow: "hidden" }}>
                      <div style={{ width: `${((scope === "returned" ? returnedProgress : unreturnedProgress) / PEOPLE_PAGE_SIZE) * 100}%`, height: "100%", background: C.accent, borderRadius: "999px", transition: "width 0.4s ease" }} />
                    </div>
                    <span style={{ fontSize: "11px", color: C.label, fontWeight: 700, whiteSpace: "nowrap" }}>{scope === "returned" ? returnedProgress : unreturnedProgress}/{PEOPLE_PAGE_SIZE}명 확인 중...</span>
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      )}

      {/* 액션 바 (관리자) */}
      {isAdmin && selCount > 0 ? (
        <div style={{ position: "sticky", bottom: 0, marginTop: "16px", padding: "14px 16px", background: C.card, border: `1px solid ${C.accent}`, borderRadius: "14px", display: "flex", alignItems: "center", gap: "10px", boxShadow: "0 -4px 16px rgba(0,0,0,0.15)", flexWrap: "wrap" }}>
          <span style={{ flex: 1, fontSize: "13px", fontWeight: 700, minWidth: "80px" }}>{selCount}건 선택됨</span>
          <button onClick={() => setSel({})} style={{ padding: "10px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>해제</button>
          {selHasReturned ? (
            <button onClick={openReBorrowModal} disabled={reborrowing} title="반납완료된 항목을 다시 대여 (명의 선택 가능)" style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: C.warn, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px", opacity: reborrowing ? 0.7 : 1 }}>
              {reborrowing ? <><Spinner size={14} /> 처리 중...</> : <><Repeat size={15} /> 다시 대여</>}
            </button>
          ) : null}
          {selHasUnreturned && selEntries.filter((e) => !e.returned).length === 1 ? (
            <button onClick={openSwapModal} title="이 대여 건을 다른 물품으로 교체 (기존 반납 + 새 물품 대여)" style={{ padding: "10px 16px", borderRadius: "10px", border: `1px solid ${C.accent}`, background: C.card, color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px" }}>
              <Repeat size={15} /> 물품 교체
            </button>
          ) : null}
          {selHasUnreturned ? (
            <button onClick={doReturn} disabled={submitting} style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? <><Spinner size={14} /> 처리 중...</> : <><Undo2 size={15} /> 반납 처리</>}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 물품 교체 모달 */}
      {swapTarget ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ width: "min(460px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, flex: 1, display: "flex", alignItems: "center", gap: "6px" }}><Repeat size={17} style={{ color: C.accentText }} /> 물품 교체</h2>
              <button onClick={() => setSwapTarget(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>

            <div style={{ padding: "12px 14px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}`, marginBottom: "14px" }}>
              <div style={{ fontSize: "11px", color: C.label, marginBottom: "4px" }}>기존 대여 (반납 처리됩니다)</div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{swapTarget.itemLabel}</div>
              <div style={{ fontSize: "11.5px", color: C.label, marginTop: "3px" }}>
                {swapTarget.borrowerName} · {swapTarget.borrowDate}
                {swapTarget.floor || swapTarget.unit ? ` · ${[swapTarget.floor, swapTarget.unit].filter(Boolean).join(" · ")}` : ""}
              </div>
            </div>

            <div style={{ fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "6px" }}>교체할 물품</div>
            <input
              value={swapSearch}
              onChange={(e) => setSwapSearch(e.target.value)}
              placeholder="물품명 또는 ID로 검색"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none", marginBottom: "8px", boxSizing: "border-box" }}
            />
            <div style={{ maxHeight: "180px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "14px" }}>
              {allItems
                .filter((it) => {
                  if (!swapSearch.trim()) return true;
                  return smartMatch(swapSearch, `${it.name} ${it.id}`);
                })
                .slice(0, 60)
                .map((it) => (
                  <div
                    key={it.id}
                    onClick={() => setSwapItemId(it.id)}
                    style={{ padding: "9px 12px", cursor: "pointer", background: swapItemId === it.id ? C.accentSoft : "transparent", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 700, color: swapItemId === it.id ? C.accentText : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                      <div style={{ fontSize: "11px", color: C.label }}>[{it.id}] · {it.rootSlot || "위치 없음"}</div>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: (it.stock || 0) > 0 ? C.accentText : C.error, flexShrink: 0 }}>재고 {it.stock ?? 0}</span>
                  </div>
                ))}
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "6px" }}>수량</div>
                <input
                  type="number"
                  min={1}
                  value={swapQty}
                  onChange={(e) => setSwapQty(parseInt(e.target.value, 10) || 1)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "6px" }}>사유 (선택)</div>
                <input
                  value={swapReason}
                  onChange={(e) => setSwapReason(e.target.value)}
                  placeholder="예: 파손으로 대체"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ fontSize: "11.5px", color: C.label, lineHeight: 1.6, marginBottom: "14px" }}>
              기존 물품은 반납 처리되어 재고가 복구되고, 새 물품이 같은 대여자·위치로 새로 대여됩니다. Slack에도 교체 알림이 전송됩니다.
            </div>

            <button
              onClick={doSwap}
              disabled={swapping || !swapItemId}
              style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: swapItemId ? C.accent : C.border, color: "#fff", cursor: swapItemId ? "pointer" : "not-allowed", fontSize: "14px", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: swapping ? 0.7 : 1 }}
            >
              {swapping ? <><Spinner size={15} /> 교체 중...</> : <><Repeat size={16} /> 교체하기</>}
            </button>
          </div>
        </div>
      ) : null}

      {/* 재대여 명의 선택 모달 */}
      {reborrowModalOpen ? (
        <div onClick={() => !reborrowing && setReborrowModalOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, flex: 1, display: "flex", alignItems: "center", gap: "6px" }}><UserCheck size={17} style={{ color: C.accentText }} /> 재대여 명의</h2>
              <button onClick={() => setReborrowModalOpen(false)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>

            <div style={{ fontSize: "12.5px", color: C.label, marginBottom: "16px", lineHeight: 1.6 }}>
              선택한 반납완료 {selEntries.filter((e) => e.returned).length}건을 다시 대여합니다. 명의를 원래 반납자로 유지할지, 다른 사람으로 지정할지 선택해주세요.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", border: `1.5px solid ${reborrowSameName ? C.accent : C.border}`, background: reborrowSameName ? C.accentSoft : "transparent", cursor: "pointer" }}>
                <input type="radio" checked={reborrowSameName} onChange={() => setReborrowSameName(true)} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>원래 반납자 명의로 재대여</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", border: `1.5px solid ${!reborrowSameName ? C.accent : C.border}`, background: !reborrowSameName ? C.accentSoft : "transparent", cursor: "pointer" }}>
                <input type="radio" checked={!reborrowSameName} onChange={() => setReborrowSameName(false)} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>다른 사람 명의로 재대여</span>
              </label>
            </div>

            {!reborrowSameName ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "5px" }}>대여자 이름 *</label>
                  <input value={reborrowTargetName} onChange={(e) => setReborrowTargetName(e.target.value)} placeholder="이름 입력" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "5px" }}>소속</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {([
                      { key: "cfgw" as const, label: "Cfgw-kr" },
                      { key: "configds" as const, label: "ConfigDS" },
                      { key: "other" as const, label: "기타" },
                    ]).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setReborrowTargetAffiliation(opt.key)}
                        style={{ flex: 1, padding: "9px", borderRadius: "9px", border: `1.5px solid ${reborrowTargetAffiliation === opt.key ? C.accent : C.border}`, background: reborrowTargetAffiliation === opt.key ? C.accentSoft : "transparent", color: reborrowTargetAffiliation === opt.key ? C.accentText : C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {reborrowTargetAffiliation === "cfgw" ? (
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: C.label, display: "block", marginBottom: "5px" }}>사번 * <span style={{ fontWeight: 400 }}>(Slack 태깅에 필요)</span></label>
                    <input value={reborrowTargetEmpId} onChange={(e) => setReborrowTargetEmpId(e.target.value)} placeholder="예: 1010" style={inputStyle} />
                  </div>
                ) : reborrowTargetAffiliation === "configds" ? (
                  <div style={{ fontSize: "11.5px", color: C.label, lineHeight: 1.6 }}>
                    'ConfigDS계정' 시트에 등록된 이름과 정확히 일치해야 Slack 태깅이 됩니다.
                  </div>
                ) : (
                  <div style={{ fontSize: "11.5px", color: C.label, lineHeight: 1.6 }}>
                    기타 소속은 이메일 정보가 없어 Slack 태깅 없이 이름만 표시됩니다.
                  </div>
                )}
              </div>
            ) : null}

            <button
              onClick={doReBorrow}
              disabled={reborrowing || (!reborrowSameName && (!reborrowTargetName.trim() || (reborrowTargetAffiliation === "cfgw" && !reborrowTargetEmpId.trim())))}
              style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.warn, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer", opacity: (reborrowing || (!reborrowSameName && (!reborrowTargetName.trim() || (reborrowTargetAffiliation === "cfgw" && !reborrowTargetEmpId.trim())))) ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px" }}
            >
              {reborrowing ? <><Spinner size={14} /> 처리 중...</> : <><Repeat size={15} /> 다시 대여 신청</>}
            </button>
          </div>
        </div>
      ) : null}
      </>
      )}

      {/* 물품별 보기: 대여자 상세 모달 */}
      {selectedItemGroup ? (
        <div onClick={() => setSelectedItemKey(null)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", maxHeight: "80vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0, flex: 1 }}>{selectedItemGroup.itemName}</h2>
              <button onClick={() => setSelectedItemKey(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px" }}>
              총 <b style={{ color: C.accentText }}>{selectedItemGroup.totalQty}개</b>가 <b style={{ color: C.accentText }}>{new Set(selectedItemGroup.entries.map((e) => e.borrowerName)).size}명</b>에게 대여 중
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {selectedItemGroup.entries
                .sort((a, b) => (a.borrowDate < b.borrowDate ? 1 : -1))
                .map((e, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: C.text }}>{e.borrowerName || "(대여자 미상)"}</span>
                        {e.floor || e.unit ? (
                          <span style={{ fontSize: "10.5px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "2px 8px" }}>
                            {[e.floor, e.unit].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                        {e.sheetType === "scenario" ? `SID 대여${e.scenarioId ? ` (${e.scenarioId})` : ""}` : "일반 대여"} · {e.borrowDate || "-"}
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px", flexShrink: 0 }}>{e.quantity}개</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
      <ScrollToTopButton />
    </div>
  );
}

function StatCard({ C, title, rows }: { C: any; title: string; rows: { label: string; value: string }[] }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", background: C.card, padding: "14px 16px" }}>
      <div style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, marginBottom: "10px" }}>{title}</div>
      {rows.length === 0 ? <div style={{ fontSize: "12px", color: C.label }}>데이터 없음</div> : rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <span style={{ fontSize: "12px", color: C.label, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
