import React, { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, X, Pencil, Trash2, MapPin, Boxes, Upload, Download, Save, Image as ImageIcon, Users, RotateCcw, ClipboardCheck, ArrowUpDown, History, ChevronRight, Package, Archive, ArchiveRestore, ShieldAlert, ImagePlus, Link2, SlidersHorizontal,
} from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import { BoxCanvas, hasDims, dimsLabel, SHAPE_LABEL, ItemShape } from "./SizeViewer";
import StockAdjustModal from "./StockAdjustModal";
import ScrollToTopButton from "./ScrollToTopButton";
import {
  ScenarioObjectAdmin, padSlot,
  fetchScenarioObjectsForAdmin, updateScenarioObject, addScenarioObject, deleteScenarioObject, saveScenarioVariants, assignUnassignedStock,
  fetchUnreturnedItems, UnreturnedItem,
  fetchStockAuditHistory, recordStockAudit, StockAuditRecord,
  fetchStockFormulaStatus, StockFormulaStatus,
  fetchScenarioAllLogs, ScenarioLogEntry,
  fetchBatchDetail, BatchDetailItem,
  fetchSmObjectStatus, SmObjectStatus, previewSmObjectImport, importSmObjects, SmImportCandidate,
  fetchSmSyncStatus, syncSmChangesNow, syncAllSmMetadataNow, startSmMetadataUpload, fetchSmUploadJob, SmSyncRunResult, SmUploadJob, SmMetadataField,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl, getThumbImageUrl, resizeAndCompressImage } from "../utils/drive";
import ItemPhotoGallery from "./ItemPhotoGallery";
import CameraCaptureModal from "./CameraCaptureModal";
import { smartMatch } from "../utils/search";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import ScenarioManagerObjectLink from "./ScenarioManagerObjectLink";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  adminName?: string;
  /** 이 페이지를 감싼 스크롤 영역의 안쪽 여백(px). 고정 검색 줄이 그만큼 바깥으로 펴져야 틈이 없다. PC 24, 모바일 14. */
  gutter?: number;
}

type EditForm = Partial<ScenarioObjectAdmin> & { rowIndex?: number };

// 창고 랙에 실제로 있는 시나리오 보관 위치 범위 (rackConfig.ts와 같다).
const FIXED_SLOT_RANGES: [number, number][] = [[0, 251], [100000, 100026]];

const SM_METADATA_UPLOAD_FIELDS: { key: SmMetadataField; group: "기본 정보" | "분류 및 속성" | "재고 및 대여 현황" | "보관 및 참고 정보"; label: string; description: string }[] = [
  { key: "name", group: "기본 정보", label: "물품명", description: "WMS 물품명을 SM 이름에 반영" },
  { key: "image", group: "기본 정보", label: "대표 사진", description: "WMS 사진이 있는 물품만 반영" },
  { key: "sector", group: "분류 및 속성", label: "구역", description: "오브젝트가 속한 구역" },
  { key: "smSize", group: "분류 및 속성", label: "크기", description: "SM 크기 분류" },
  { key: "smProperty", group: "분류 및 속성", label: "속성", description: "Soft·Hard 등 SM 속성" },
  { key: "quantity", group: "재고 및 대여 현황", label: "현재 재고 수량", description: "WMS의 현재 선반 재고 숫자" },
  { key: "rentalStatus", group: "재고 및 대여 현황", label: "대여·반납 현황", description: "현재 미반납 대여자와 수량을 SM 장부에 반영" },
  { key: "rootSlot", group: "보관 및 참고 정보", label: "보관 위치", description: "6자리 보관 위치(root slot)" },
  { key: "productLink", group: "보관 및 참고 정보", label: "구매 링크", description: "등록된 제품 구매 주소" },
  { key: "productMemo", group: "보관 및 참고 정보", label: "기타 메모", description: "제품 관련 참고 내용" },
];
const ALL_SM_METADATA_FIELDS = SM_METADATA_UPLOAD_FIELDS.map((field) => field.key);
const SM_METADATA_UPLOAD_GROUPS = ["기본 정보", "분류 및 속성", "재고 및 대여 현황", "보관 및 참고 정보"] as const;

export default function ScenarioAdminPage({ scriptUrl, connected, isLightMode, showToast, adminName = "", gutter = 24 }: Props) {
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
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

  const [items, setItems] = useState<ScenarioObjectAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "available" | "out" | "rented" | "variant">("");
  const [requestFilter, setRequestFilter] = useState<"all" | "request" | "normal">(() => {
    try {
      const saved = sessionStorage.getItem("wms_scenario_request_filter");
      return saved === "request" || saved === "normal" ? saved : "all";
    } catch { return "all"; }
  });
  const [sortOrder, setSortOrder] = useState<"id_asc" | "id_desc" | "location_asc" | "name_asc" | "stock_desc">("id_desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 기본은 활성(=보관 안 된) 물품만 보여준다. "보관함" 모드에서는 반대로 보관 처리된 것만 보여준다.
  // 파손 등으로 오브젝트로 쓰기 어려운 물품을 목록/대여 카탈로그에서 치워두는 용도.
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  // 편집 중인 물품의 "종류" 목록. 빈 배열이면 종류 구분을 쓰지 않는 물품이며,
  // 그때는 위의 재고 입력칸이 지금까지처럼 그대로 총재고를 관리한다.
  const [variantDraft, setVariantDraft] = useState<{
    id?: number; name: string; stock: number; rented?: number; image?: string;
    // 종류별 실측 치수 — 안 채우면 물품 자체의 치수를 쓴다.
    widthMm?: number; depthMm?: number; heightMm?: number; shape?: ItemShape;
  }[]>([]);
  // 어떤 종류의 치수 칸을 펼쳐 두었는지(순번별). 대부분은 쓸 일이 없어 기본은 접어 둔다.
  const [variantDimsOpen, setVariantDimsOpen] = useState<Record<number, boolean>>({});
  // 아직 어느 종류인지 모르는 선반 재고. 종류 도입 전 대여분이 돌아오면 여기 쌓인다.
  const [unassignedDraft, setUnassignedDraft] = useState(0);
  // 미확인 → 종류 배분 입력값 (종류 id별 수량)
  const [assignQty, setAssignQty] = useState<Record<number, number>>({});
  // 서버 PC 웹캠 촬영 — null이면 닫힘, "item"이면 대표 사진, 숫자면 그 순번의 종류 사진.
  const [cameraTarget, setCameraTarget] = useState<"item" | number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [modalUrl, setModalUrl] = useState("");

  // 오브젝트 클릭 시 "누가 얼마나 빌려갔는지" 보여주는 대여자 상세 모달
  const [borrowersItem, setBorrowersItem] = useState<ScenarioObjectAdmin | null>(null);
  const [stockAdjustItem, setStockAdjustItem] = useState<ScenarioObjectAdmin | null>(null);
  // 새 물품의 ID는 Scenario Manager가 부여한다. 연동이 살아 있으면 ID 칸을 비워둔 채
  // 저장할 수 있고, 아니면 지금까지처럼 관리자가 번호를 직접 적어야 한다.
  const [smStatus, setSmStatus] = useState<SmObjectStatus | null>(null);
  const smAutoId = !!smStatus?.enabled && !!smStatus?.ok;
  // 방금 SM이 부여한 번호. ID 칸 아래에 한 번 강조해서 보여주고, 창을 닫으면 지운다.
  const [smAssignedId, setSmAssignedId] = useState("");
  const [smImportOpen, setSmImportOpen] = useState(false);
  const [smImportLoading, setSmImportLoading] = useState(false);
  const [smImportSaving, setSmImportSaving] = useState(false);
  const [smImportItems, setSmImportItems] = useState<SmImportCandidate[]>([]);
  const [smImportSelected, setSmImportSelected] = useState<Set<string>>(new Set());
  const [smImportSearch, setSmImportSearch] = useState("");
  const [smSyncing, setSmSyncing] = useState(false);
  const [smFullSyncing, setSmFullSyncing] = useState(false);
  const [smLastRun, setSmLastRun] = useState<SmSyncRunResult | null>(null);
  const [smErrorReport, setSmErrorReport] = useState<{ title: string; message: string; result?: SmSyncRunResult } | null>(null);
  const [smUploadJob, setSmUploadJob] = useState<SmUploadJob | null>(null);
  const [smFullUploadOpen, setSmFullUploadOpen] = useState(false);
  const [smFullUploadFields, setSmFullUploadFields] = useState<Set<SmMetadataField>>(() => new Set(ALL_SM_METADATA_FIELDS));
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkRootSlot, setBulkRootSlot] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // 등록 창을 열 때마다 새로 뽑는 중복 방지 키. 저장이 두 번 나가도 SM 오브젝트는 하나만
  // 생긴다 — SM 오브젝트는 지울 수 없고 폐기만 되므로, 실수로 둘을 만들면 되돌릴 수 없다.
  const [newItemKey, setNewItemKey] = useState("");
  const [unreturned, setUnreturned] = useState<UnreturnedItem[]>([]);
  // "대여중 불일치 검사" — 기록상 대여중 수와 실제 미반납 건수를 전수 비교해서 보여주는 모달
  const [mismatchOpen, setMismatchOpen] = useState(false);
  useEffect(() => {
    try { sessionStorage.setItem("wms_scenario_request_filter", requestFilter); } catch { /* 저장소 접근 불가 */ }
  }, [requestFilter]);
  // 신청 묶음 상세 (어떤 건이 함께 나갔는지)
  const [batchDetail, setBatchDetail] = useState<{ batchId: string; title: string; items: BatchDetailItem[] } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  useVersionWorkGuard(
    "scenario-admin-work",
    !!editing || saving || uploading || smImportSaving || smSyncing || smFullSyncing || !!(smUploadJob && smUploadJob.status === "running") || bulkSaving,
    smSyncing || smFullSyncing || (smUploadJob && smUploadJob.status === "running") ? "SM 동기화·정보 반영 중" : "시나리오 물품 편집 중",
  );

  async function openBatchDetail(batchId: string, title: string) {
    if (!batchId) { showToast("이 기록에는 신청 묶음 정보가 없습니다.", "warn"); return; }
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    setBatchLoading(true);
    setBatchDetail({ batchId, title, items: [] });
    try {
      const items = await fetchBatchDetail(scriptUrl, batchId);
      setBatchDetail({ batchId, title, items });
    } catch (e: any) {
      showToast(`묶음 조회 실패: ${e.message}`, "error");
      setBatchDetail(null);
    } finally {
      setBatchLoading(false);
    }
  }
  const [unreturnedLoading, setUnreturnedLoading] = useState(false);
  const [unreturnedLoaded, setUnreturnedLoaded] = useState(false);
  const [detailTab, setDetailTab] = useState<"borrowers" | "audit" | "history">("borrowers");

  // 재고 실사 기록 (수동으로 세어본 수량 vs 시스템 재고)
  const [auditHistory, setAuditHistory] = useState<StockAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadedForId, setAuditLoadedForId] = useState<string | null>(null);
  const [auditCountInput, setAuditCountInput] = useState("");
  const [auditNote, setAuditNote] = useState("");
  const [auditSubmitting, setAuditSubmitting] = useState(false);

  // 진단: 왜 이런 차이가 발생했는지 지금까지의 기록으로 추측
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosedForId, setDiagnosedForId] = useState<string | null>(null);
  const [formulaStatus, setFormulaStatus] = useState<StockFormulaStatus | null>(null);
  const [itemLogs, setItemLogs] = useState<ScenarioLogEntry[]>([]);
  // "전체 이력" 탭: 이 물품의 지금까지의 모든 대여·반납 기록 (반납완료 포함)
  // 반납완료 건은 처음엔 최근 14일치만 받고, "더 보기"를 눌러야 그 이전 전체 기록을 받는다
  // (미반납 건은 이 창과 무관하게 항상 포함된다 — recentDays 필터가 미반납 건은 건너뛰기 때문).
  const HISTORY_RECENT_DAYS = 14;
  const [historyLogs, setHistoryLogs] = useState<ScenarioLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyLoadedForId, setHistoryLoadedForId] = useState<string | null>(null);
  const [historyFullyLoaded, setHistoryFullyLoaded] = useState(false);

  const loadHistory = useCallback(async (itemId: string, full = false) => {
    (full ? setHistoryLoadingMore : setHistoryLoading)(true);
    try {
      if (connected && scriptUrl) {
        // 한 번에 다 받으면(로그가 쌓일수록) 응답이 커지므로, 처음엔 14일치만 받고
        // "더 보기"를 눌렀을 때만 200일 전체를 받는다.
        const logs = await fetchScenarioAllLogs(scriptUrl, { recentDays: full ? 200 : HISTORY_RECENT_DAYS });
        const targetId = padSlot(itemId);
        setHistoryLogs(logs.filter((l) => l.itemId && padSlot(l.itemId) === targetId));
        setHistoryFullyLoaded(full);
      } else {
        setHistoryLogs([]);
        setHistoryFullyLoaded(true);
      }
      setHistoryLoadedForId(itemId);
    } catch (e: any) {
      showToast(`대여·반납 기록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setHistoryLoading(false);
      setHistoryLoadingMore(false);
    }
  }, [connected, scriptUrl, showToast]);

  const loadUnreturned = useCallback(async () => {
    setUnreturnedLoading(true);
    try {
      if (connected && scriptUrl) setUnreturned(await fetchUnreturnedItems(scriptUrl));
      else setUnreturned([]);
      setUnreturnedLoaded(true);
    } catch (e: any) {
      showToast(`대여 현황을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setUnreturnedLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  const loadAuditHistory = useCallback(async (itemId: string) => {
    setAuditLoading(true);
    try {
      if (connected && scriptUrl) {
        setAuditHistory(await fetchStockAuditHistory(scriptUrl, itemId));
      } else {
        setAuditHistory([]);
      }
      setAuditLoadedForId(itemId);
    } catch (e: any) {
      showToast(`재고 실사 기록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setAuditLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  function openBorrowers(it: ScenarioObjectAdmin) {
    setBorrowersItem(it);
    setDetailTab("borrowers");
    setAuditCountInput("");
    setAuditNote("");
    setDiagnosedForId(null);
    setFormulaStatus(null);
    setItemLogs([]);
    setHistoryLoadedForId(null);
    setHistoryLogs([]);
    if (!unreturnedLoaded && !unreturnedLoading) loadUnreturned();
    setHistoryFullyLoaded(false);
    if (!unreturnedLoaded && !unreturnedLoading) loadUnreturned();
  }

  async function runDiagnosis() {
    if (!borrowersItem) return;
    setDiagnosing(true);
    try {
      if (connected && scriptUrl) {
        // 위 loadHistory와 같은 이유로 recentDays를 걸어 응답 크기를 줄인다.
        const [status, logs] = await Promise.all([
          fetchStockFormulaStatus(scriptUrl, borrowersItem.id),
          fetchScenarioAllLogs(scriptUrl, { recentDays: 200 }),
        ]);
        setFormulaStatus(status);
        const targetId = padSlot(borrowersItem.id);
        setItemLogs(logs.filter((l) => l.itemId && padSlot(l.itemId) === targetId));
      } else {
        setFormulaStatus({ found: true, stockIsFormula: false, rentedIsFormula: false });
        setItemLogs([]);
      }
      setDiagnosedForId(borrowersItem.id);
    } catch (e: any) {
      showToast(`진단 정보를 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setDiagnosing(false);
    }
  }

  // 날짜 문자열("yyyy-MM-dd HH:mm:ss" 등)을 타임스탬프로. 실패 시 0.
  function parseTs(v?: string): number {
    const s = String(v || "").trim();
    if (!s) return 0;
    const t = Date.parse(s.replace(" ", "T"));
    return isNaN(t) ? 0 : t;
  }

  async function submitAudit() {
    if (!borrowersItem) return;
    const actual = parseInt(auditCountInput, 10);
    if (isNaN(actual) || actual < 0) { showToast("실사 수량을 올바르게 입력해주세요.", "warn"); return; }
    setAuditSubmitting(true);
    try {
      if (connected && scriptUrl) {
        const res = await recordStockAudit(scriptUrl, {
          itemId: borrowersItem.id,
          itemName: borrowersItem.name,
          systemStock: borrowersItem.stock || 0,
          actualCount: actual,
          note: auditNote.trim(),
        });
        if (!res.success) { showToast(res.message || "재고 실사 기록에 실패했습니다.", "error"); return; }
        showToast("재고 실사를 기록했습니다.", "ok");
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      setAuditCountInput("");
      setAuditNote("");
      loadAuditHistory(borrowersItem.id);
    } catch (e: any) {
      showToast(`재고 실사 기록 실패: ${e.message}`, "error");
    } finally {
      setAuditSubmitting(false);
    }
  }

  // 선택된 오브젝트를 현재 대여 중인 사람들 (동일 물품 ID 기준)
  const borrowersForItem = useMemo(() => {
    if (!borrowersItem) return [];
    const targetId = padSlot(borrowersItem.id);
    return unreturned
      .filter((u) => (u.itemId ? padSlot(u.itemId) === targetId : false))
      .sort((a, b) => (a.borrowDate < b.borrowDate ? 1 : -1));
  }, [unreturned, borrowersItem]);

  // "대여중 불일치 검사": 물품에 기록된 rented 값 vs 실제 미반납 건 수를 전수 비교
  const rentedMismatches = useMemo(() => {
    const actualByItem: Record<string, number> = {};
    for (const u of unreturned) {
      if (!u.itemId) continue;
      const key = padSlot(u.itemId);
      actualByItem[key] = (actualByItem[key] || 0) + (u.quantity || 1);
    }
    return items
      .map((it) => ({ item: it, actual: actualByItem[padSlot(it.id)] || 0, recorded: it.rented || 0 }))
      .filter((x) => x.actual !== x.recorded)
      .sort((a, b) => Math.abs(b.actual - b.recorded) - Math.abs(a.actual - a.recorded));
  }, [items, unreturned]);

  function openMismatchScan() {
    setMismatchOpen(true);
    if (!unreturnedLoaded && !unreturnedLoading) loadUnreturned();
  }

  // 실사 기록 사이 구간마다: 로그 기반 예상 변화량 vs 실제 시스템 재고 변화량을 비교해
  // 기록에 안 잡히는 변동(수동 수정, 누락된 반납 처리 등)이 있었는지 짚어준다.
  const diagnosis = useMemo(() => {
    if (!borrowersItem || diagnosedForId !== borrowersItem.id) return null;

    const overdueDays = 14;
    const now = Date.now();
    const overdue = borrowersForItem
      .map((u) => ({ ...u, days: Math.floor((now - parseTs(u.borrowDate)) / 86400000) }))
      .filter((u) => u.days >= overdueDays)
      .sort((a, b) => b.days - a.days);

    // 실사 기록을 오래된 순으로 정렬하고, 구간별 대여/반납 순변화를 로그와 대조
    const auditsAsc = [...auditHistory].sort((a, b) => parseTs(a.auditedAt) - parseTs(b.auditedAt));
    const points = [
      ...auditsAsc.map((a) => ({ label: a.auditedAt, ts: parseTs(a.auditedAt), systemStock: a.systemStock })),
      { label: "현재", ts: now, systemStock: borrowersItem.stock || 0 },
    ];

    const windows: { from: string; to: string; expected: number; actual: number; mismatch: number; borrowCount: number; returnCount: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i], to = points[i + 1];
      if (to.ts <= from.ts) continue;
      let borrowQty = 0, returnQty = 0, borrowCount = 0, returnCount = 0;
      itemLogs.forEach((l) => {
        const bts = parseTs(l.borrowDate);
        if (bts > from.ts && bts <= to.ts) { borrowQty += l.quantity || 1; borrowCount++; }
        const rts = parseTs(l.returnDate);
        if (l.returned && rts > from.ts && rts <= to.ts) { returnQty += l.quantity || 1; returnCount++; }
      });
      const expected = returnQty - borrowQty; // 반납은 재고 증가, 대여는 재고 감소
      const actual = to.systemStock - from.systemStock;
      const mismatch = actual - expected;
      windows.push({ from: from.label, to: to.label, expected, actual, mismatch, borrowCount, returnCount });
    }

    const hasIssue = !!(formulaStatus?.stockIsFormula) || overdue.length > 0 || windows.some((w) => w.mismatch !== 0);

    return { overdue, windows, hasIssue };
  }, [borrowersItem, diagnosedForId, borrowersForItem, auditHistory, itemLogs, formulaStatus]);

  useEffect(() => {
    if (detailTab === "audit" && borrowersItem && auditLoadedForId !== borrowersItem.id && !auditLoading) {
      loadAuditHistory(borrowersItem.id);
    }
  }, [detailTab, borrowersItem, auditLoadedForId, auditLoading, loadAuditHistory]);

  useEffect(() => {
    if (detailTab === "history" && borrowersItem && historyLoadedForId !== borrowersItem.id && !historyLoading) {
      loadHistory(borrowersItem.id);
    }
  }, [detailTab, borrowersItem, historyLoadedForId, historyLoading, loadHistory]);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      if (connected && scriptUrl) setItems(await fetchScenarioObjectsForAdmin(scriptUrl, forceRefresh));
      else setItems([
        { rowIndex: 2, id: "000008", name: "fruit", sector: "Seoul-Root", rootSlot: "000060", category: "식음료", subcategory: "간식 및 식사류", image: "", stock: 15, rented: 8 },
      ]);
      setLoaded(true);
    } catch (e: any) {
      showToast(`시나리오 물품을 불러오지 못했습니다: ${e.message}`, "error");
      // 실패해도 "시도는 끝났다"고 표시해야 재요청이 무한 반복되지 않는다.
      setLoaded(true);
    }
    finally { setLoading(false); }
  }, [connected, scriptUrl, showToast]);

  useEffect(() => { load(); }, [load]);

  // 연동 상태는 화면을 열 때 한 번만 본다. 실패해도 화면은 그대로 쓸 수 있어야 하므로
  // 조용히 "연동 없음"으로 두고, 그러면 ID를 직접 입력하는 예전 방식이 된다.
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    let alive = true;
    fetchSmObjectStatus(scriptUrl)
      .then((st) => { if (alive) setSmStatus(st); })
      .catch(() => { if (alive) setSmStatus({ enabled: false, ok: false, reason: "연동 상태를 확인하지 못했습니다." }); });
    fetchSmSyncStatus(scriptUrl)
      .then((st) => { if (alive) setSmLastRun(st.lastRun || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [connected, scriptUrl]);

  async function openSmImport() {
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    if (!smAutoId) { showToast(smStatus?.reason || "Scenario Manager 연결을 확인해 주세요.", "warn"); return; }
    setSmImportOpen(true);
    setSmImportItems([]);
    setSmImportSelected(new Set());
    setSmImportSearch("");
  }

  async function lookupSmImport() {
    const id = padSlot(smImportSearch);
    if (!id) { showToast("SM 물품 번호를 입력해 주세요.", "warn"); return; }
    setSmImportLoading(true);
    setSmImportItems([]);
    setSmImportSelected(new Set());
    try {
      const result = await previewSmObjectImport(scriptUrl, id);
      if (result.alreadyExists) { showToast(`${result.id || id}번은 이미 WMS에 등록되어 있습니다.`, "info"); return; }
      if (!result.found || !result.item) { showToast(`${id}번 물품을 SM에서 찾지 못했습니다.`, "warn"); return; }
      setSmImportItems([result.item]);
      if (result.item.importable) setSmImportSelected(new Set([result.item.id]));
    } catch (e: any) {
      showToast(`SM 물품 조회 실패: ${e.message}`, "error");
    } finally {
      setSmImportLoading(false);
    }
  }

  async function confirmSmImport() {
    const ids = [...smImportSelected];
    if (!ids.length) { showToast("가져올 물품을 선택해 주세요.", "warn"); return; }
    setSmImportSaving(true);
    try {
      const result = await importSmObjects(scriptUrl, ids, adminName);
      const imported = Number(result?.importedCount) || 0;
      const failed = Number(result?.failedCount) || 0;
      showToast(`${imported}개 물품을 SM에서 가져왔습니다.${failed ? ` 실패 ${failed}개` : ""}`, failed ? "warn" : "ok");
      setSmImportOpen(false);
      await load(true);
    } catch (e: any) {
      showToast(`SM 가져오기 실패: ${e.message}`, "error");
    } finally {
      setSmImportSaving(false);
    }
  }

  async function applySmChanges() {
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    setSmSyncing(true);
    try {
      const job = await startSmMetadataUpload(scriptUrl, "changes");
      await watchSmUploadJob(job, "SM 변경사항 적용 실패");
    } catch (e: any) {
      setSmErrorReport({ title: "SM 변경사항 적용 실패", message: e.message || "SM 변경사항 적용에 실패했습니다." });
      setSmSyncing(false);
      setSmUploadJob(null);
    }
  }

  async function watchSmUploadJob(initialJob: SmUploadJob, errorTitle: string) {
    let job: SmUploadJob | null = initialJob;
    setSmUploadJob(job);
    while (job && job.status === "running") {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      job = await fetchSmUploadJob(scriptUrl, job.id);
      if (job) setSmUploadJob(job);
    }
    if (!job) throw new Error("SM 정보 반영 상태를 확인하지 못했습니다.");
    const result = job.result || { ok: job.status === "done" };
    if (job.status !== "done" || !result.ok || Number(result.metadataFailed || 0) > 0 || Number(result.failed || 0) > 0) {
      setSmErrorReport({ title: errorTitle, message: result.reason || "일부 정보를 SM에 반영하지 못했습니다.", result });
    } else {
      setSmLastRun(result);
      if (job.mode === "all") {
        showToast(`SM 정보 일괄 업데이트 완료 (${Number(result.metadata) || 0}/${Number(result.total) || 0}건)`, "ok");
      } else {
        const changed = Number(result.changed) || 0;
        const quantity = Number(result.quantity) || 0;
        const borrow = Number(result.borrow) || 0;
        const metadata = Number(result.metadata) || 0;
        showToast(changed || metadata ? `SM에 적용했습니다. (물품 정보 ${metadata}건 · 수량 ${quantity}건 · 대여 ${borrow}건)` : "마지막 동기화 이후 변경사항이 없습니다.", "ok");
      }
    }
    setSmUploadJob(null);
    setSmSyncing(false);
    setSmFullSyncing(false);
  }

  async function uploadAllSmMetadata() {
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    const fields = ALL_SM_METADATA_FIELDS.filter((field) => smFullUploadFields.has(field));
    if (!fields.length) { showToast("SM에 반영할 정보를 하나 이상 선택해주세요.", "warn"); return; }
    setSmFullUploadOpen(false);
    setSmFullSyncing(true);
    try {
      const job = await startSmMetadataUpload(scriptUrl, "all", fields);
      await watchSmUploadJob(job, "SM 정보 일괄 업데이트 실패");
    } catch (e: any) {
      setSmErrorReport({ title: "SM 정보 일괄 업데이트 실패", message: e.message || "SM 정보 일괄 업데이트에 실패했습니다." });
      setSmFullSyncing(false);
      setSmUploadJob(null);
    } finally {
      // watchSmUploadJob이 정상 종료되면 여기서 별도 처리할 일이 없다.
    }
  }

  // 화면을 켜둔 채로 오래 두면 물품 목록의 "대여중" 값과 실제 미반납 현황이 서로
  // 벌어져서(둘 다 처음 한 번만 불러오고 이후로는 갱신되지 않았다) "대여중 불일치 검사"에
  // 계속 걸리는 문제가 있었다 — 30초마다 조용히 다시 불러와 최신 상태를 유지한다.
  // (탭이 백그라운드면 굳이 부르지 않는다)
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      load();
      if (unreturnedLoaded && !unreturnedLoading) loadUnreturned();
    }, 30000);
    const onVisible = () => {
      if (document.hidden) return;
      load();
      if (unreturnedLoaded && !unreturnedLoading) loadUnreturned();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, scriptUrl, load, unreturnedLoaded, unreturnedLoading, loadUnreturned]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const onScroll = () => {
      if (window.matchMedia("(max-width: 640px)").matches) setMobileFiltersOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileFiltersOpen]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.category) set.add(it.category); });
    return Array.from(set).sort();
  }, [items]);

  // 서브카테고리는 기본적으로 "지금 선택된 카테고리 안에서 실제로 쓰인 것들"만 보여준다.
  // 카테고리가 비어있거나 그 카테고리에 아직 서브카테고리가 하나도 없으면, 전체 서브카테고리를 보여준다.
  const allSubcategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.subcategory) set.add(it.subcategory); });
    return Array.from(set).sort();
  }, [items]);
  const subcategoriesForCategory = useMemo(() => {
    const cat = editing?.category?.trim();
    if (!cat) return allSubcategories;
    const set = new Set<string>();
    items.forEach((it) => { if (it.category === cat && it.subcategory) set.add(it.subcategory); });
    const scoped = Array.from(set).sort();
    return scoped.length > 0 ? scoped : allSubcategories;
  }, [items, editing?.category, allSubcategories]);

  // 목록 필터의 서브카테고리는 선택한 카테고리와 함께 중첩 적용한다.
  const filterSubcategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if ((!cat || it.category === cat) && it.subcategory) set.add(it.subcategory);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [items, cat]);

  useEffect(() => {
    if (subcatFilter && !filterSubcategories.includes(subcatFilter)) setSubcatFilter("");
  }, [filterSubcategories, subcatFilter]);

  const sectors = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.sector) set.add(it.sector); });
    return Array.from(set).sort();
  }, [items]);

  // 카테고리/서브카테고리/Sector를 드롭다운(select)으로 고를지, 직접 텍스트로 입력할지.
  // 기존 목록에 없는 값으로 편집을 열면(레거시 데이터), 값이 사라져 보이지 않도록 직접입력 모드로 시작한다.
  const [catCustom, setCatCustom] = useState(false);
  const [subcatCustom, setSubcatCustom] = useState(false);
  const [sectorCustom, setSectorCustom] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim();
    return items.filter((it) => {
      if (!!it.archived !== showArchived) return false; // 보관함 모드에 따라 서로 배타적으로 보여준다
      if (cat && it.category !== cat) return false;
      if (subcatFilter && it.subcategory !== subcatFilter) return false;
      if (sectorFilter && it.sector !== sectorFilter) return false;
      if (requestFilter === "request" && it.requestFor === undefined) return false;
      if (requestFilter === "normal" && it.requestFor !== undefined) return false;
      if (stockFilter === "available" && Number(it.stock || 0) <= 0) return false;
      if (stockFilter === "out" && Number(it.stock || 0) > 0) return false;
      if (stockFilter === "rented" && Number(it.rented || 0) <= 0) return false;
      if (stockFilter === "variant" && !(it.variants || []).length) return false;
      if (!q) return true;
      const slotPad = padSlot(it.rootSlot);
      return smartMatch([it.name, it.id, it.category, it.subcategory, it.sector, slotPad, it.rootSlot, it.requestFor], q);
    }).sort((a, b) => {
      const numeric = (value: unknown) => {
        const parsed = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
        return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
      };
      if (sortOrder === "id_asc" || sortOrder === "id_desc") {
        const result = numeric(a.id) - numeric(b.id) || String(a.id).localeCompare(String(b.id), "ko", { numeric: true });
        return sortOrder === "id_desc" ? -result : result;
      }
      if (sortOrder === "location_asc") {
        return numeric(a.rootSlot) - numeric(b.rootSlot) || a.name.localeCompare(b.name, "ko");
      }
      if (sortOrder === "stock_desc") {
        return Number(b.stock || 0) - Number(a.stock || 0) || numeric(a.id) - numeric(b.id);
      }
      return a.name.localeCompare(b.name, "ko") || numeric(a.id) - numeric(b.id);
    });
  }, [items, search, cat, subcatFilter, sectorFilter, stockFilter, requestFilter, sortOrder, showArchived]);

  const hasCustomFilters = !!(search || cat || subcatFilter || sectorFilter || stockFilter || requestFilter !== "all" || sortOrder !== "id_desc");

  function resetFilters() {
    setSearch("");
    setCat("");
    setSubcatFilter("");
    setSectorFilter("");
    setStockFilter("");
    setRequestFilter("all");
    setSortOrder("id_desc");
  }

  const archivedCount = useMemo(() => items.filter((it) => it.archived).length, [items]);
  const [emptySlotsOpen, setEmptySlotsOpen] = useState(false);
  // 비어 있는 보관 위치. 보관함으로 치운 물품은 자리를 차지하지 않는 것으로 본다.
  const emptySlotGroups = useMemo(() => {
    const used = new Set<number>();
    for (const it of items) {
      const slot = String(it.rootSlot ?? "").trim();
      if (!it.archived && /^\d+$/.test(slot)) used.add(Number(slot));
    }
    const groups: { label: string; total: number; empty: string[] }[] = [];
    const pushRange = (start: number, end: number) => {
      const empty: string[] = [];
      for (let n = start; n <= end; n++) if (!used.has(n)) empty.push(padSlot(String(n)));
      groups.push({ label: `${padSlot(String(start))}~${padSlot(String(end))}`, total: end - start + 1, empty });
    };
    for (const [start, end] of FIXED_SLOT_RANGES) pushRange(start, end);
    // 정해진 범위 밖의 10만 단위 구역은 등록된 위치의 처음~끝을 범위로 삼는다.
    const extra = new Map<number, number[]>();
    for (const n of used) {
      if (FIXED_SLOT_RANGES.some(([s, e]) => n >= s && n <= e)) continue;
      const block = Math.floor(n / 100000);
      extra.set(block, [...(extra.get(block) || []), n]);
    }
    for (const nums of [...extra.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) pushRange(Math.min(...nums), Math.max(...nums));
    return groups;
  }, [items]);
  const emptySlotCount = emptySlotGroups.reduce((sum, g) => sum + g.empty.length, 0);
  const selectedItems = useMemo(() => items.filter((it) => selectedRows.has(it.rowIndex)), [items, selectedRows]);
  const toolStatusCount = (showArchived ? 1 : 0) + (smSyncing || smFullSyncing ? 1 : 0) + (selectMode ? 1 : 0);

  // 종류를 쓰는 물품의 총재고 = 종류 재고의 합. 폼에서도 이 값을 그대로 보여준다.
  const variantTotalStock = useMemo(
    () => variantDraft.reduce((sum, v) => sum + (Number(v.stock) || 0), 0) + (Number(unassignedDraft) || 0),
    [variantDraft, unassignedDraft]
  );

  function openEdit(it: ScenarioObjectAdmin) {
    setEditing({ ...it });
    setSmAssignedId("");
    setVariantDraft((it.variants || []).map((v) => ({
      id: v.id, name: v.name, stock: v.stock, rented: v.rented, image: v.image,
      widthMm: v.widthMm, depthMm: v.depthMm, heightMm: v.heightMm, shape: v.shape,
    })));
    setVariantDimsOpen({});
    setUnassignedDraft(Number(it.unassignedStock) || 0);
    setAssignQty({});
    setIsNew(false);
    // 기존 목록에 없는 값이면(레거시 데이터) 드롭다운에 안 보여서 값이 사라진 것처럼 보이니, 직접입력 모드로 연다.
    setCatCustom(!!it.category && !categories.includes(it.category));
    setSubcatCustom(!!it.subcategory && !allSubcategories.includes(it.subcategory));
    setSectorCustom(!!it.sector && !sectors.includes(it.sector));
  }
  function openNew(rootSlot = "") {
    setEditing({ id: "", name: "", sector: "", rootSlot, category:"", subcategory: "", image: "", stock: 0, purchaseLink: "", smSize: "", smProperty: "", productMemo: "" });
    setSmAssignedId("");
    setNewItemKey(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    setVariantDraft([]);
    setUnassignedDraft(0);
    setAssignQty({});
    setIsNew(true);
    setCatCustom(false);
    setSubcatCustom(false);
    setSectorCustom(false);
  }

  async function handleFile(file: File) {
    try {
      setUploading(true);
      const base64 = await resizeAndCompressImage(file);
      setEditing((p) => (p ? { ...p, image: base64 } : p));
    } catch (e: any) { showToast(`이미지 처리 실패: ${e.message || e}`, "error"); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { showToast("물품명을 입력해주세요.", "warn"); return; }
    if (isNew && !editing.id?.trim() && !smAutoId) {
      showToast(smStatus?.reason || "ID를 입력해주세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      if (connected && scriptUrl) {
        if (isNew) {
          const res = await addScenarioObject(scriptUrl, { ...editing, clientId: newItemKey });
          // 서버는 실패를 예외가 아니라 {success:false, error}로 돌려준다. 이걸 확인하지 않으면
          // Scenario Manager가 거절했는데도 "추가했습니다"가 뜨고 창이 닫힌다(실제로 그랬다).
          if (!res?.success) {
            showToast(res?.error || "등록에 실패했습니다.", "error");
            return;   // 창을 닫지 않는다 — 입력한 내용을 잃지 않게 그대로 둔다
          }
          if (res.item) setItems((p) => [...p, res.item]);
          // 위치·수량은 번호가 난 뒤에 따로 넣는다. 그중 일부가 실패했으면 조용히 넘기지 않는다.
          const fin = res.smFinalize;
          const finFailed = [
            fin?.rootSlot && !fin.rootSlot.ok ? `위치(${fin.rootSlot.reason})` : "",
            fin?.quantity && !fin.quantity.ok ? `수량(${fin.quantity.reason})` : "",
          ].filter(Boolean);

          // 부여받은 번호는 알림으로 알려주고 창은 닫는다. 등록이 끝났는데 폼이 계속 떠
          // 있으면 저장이 안 된 것처럼 보인다. 번호는 목록의 새 물품 카드에서도 바로 보인다.
          if (res?.smRegistered && res.item) {
            showToast(
              finFailed.length
                ? `번호 ${res.item.id}로 등록했지만 ${finFailed.join(", ")} 반영에 실패했습니다.`
                : `Scenario Manager에 등록했습니다. 부여된 번호 ${res.item.id}`,
              finFailed.length ? "warn" : "ok"
            );
          } else {
            showToast("시나리오 물품을 추가했습니다.", "ok");
          }
        } else {
          // "대여 중"은 이 폼에서 입력받는 값이 아니라 폼을 연 시점의 스냅샷일 뿐이다 — 그대로
          // 같이 보내면, 수정하는 동안 다른 곳에서 실제로 일어난 대여/반납이 저장 시점에
          // 조용히 덮어써져 버린다 (재고/대여중 불일치의 주요 원인이었다). 빼고 보낸다.
          const { rented, variants, ...editPayload } = editing as any;
          // JSON.stringify는 값이 undefined인 키를 통째로 지운다. request/개인 물품 표시를
          // 해제하면 undefined가 되는데, 그 상태로 보내면 서버에는 "안 보낸 것"과 구별되지
          // 않아 기존 값이 그대로 남는다(체크가 안 풀리던 원인). null로 바꿔 명시적으로 보낸다.
          if (editPayload.requestFor === undefined) editPayload.requestFor = null;
          if (editPayload.personalOwner === undefined) editPayload.personalOwner = null;
          const res = await updateScenarioObject(scriptUrl, editPayload);
          if (res && res.success && res.item) setItems((p) => p.map((x) => (x.rowIndex === res.item.rowIndex ? { ...res.item, variants: x.variants } : x)));

          // 종류 목록은 별도 액션으로 저장한다 — 서버가 총재고를 종류 합계로 다시 계산하므로,
          // 물품 저장보다 뒤에 와야 총재고가 종류 합계로 확정된다.
          // 치수까지 비교해야 "이름·재고는 그대로고 크기만 고친" 경우가 저장된다.
          const dimKey = (v: any) => [v.widthMm ?? "", v.depthMm ?? "", v.heightMm ?? "", v.shape ?? ""];
          const before = JSON.stringify([(editing.variants || []).map((v) => [v.id, v.name, v.stock, v.image || "", ...dimKey(v)]), Number(editing.unassignedStock) || 0]);
          const after = JSON.stringify([variantDraft.map((v) => [v.id ?? null, v.name.trim(), Number(v.stock) || 0, v.image || "", ...dimKey(v)]), Number(unassignedDraft) || 0]);
          if (before !== after) {
            if (variantDraft.some((v) => !v.name.trim())) { showToast("종류 이름을 모두 입력해주세요.", "warn"); return; }
            const vRes = await saveScenarioVariants(
              scriptUrl,
              editing.id,
              variantDraft.map((v) => ({
                id: v.id, name: v.name.trim(), stock: Number(v.stock) || 0, image: v.image,
                // 치수는 항상 실어 보낸다(빈 값이면 null로 지워진다) — 이 화면이 치수를 다루는 곳이라
                // "지웠다"는 뜻도 정확히 전달돼야 한다.
                widthMm: v.widthMm ?? null, depthMm: v.depthMm ?? null, heightMm: v.heightMm ?? null,
                shape: v.shape ?? null,
              })),
              Number(unassignedDraft) || 0
            );
            if (!vRes?.success) { showToast(vRes?.message || "종류 저장에 실패했습니다.", "error"); return; }
            setItems((p) => p.map((x) => (x.id === editing.id ? { ...x, ...(vRes.item || {}), variants: vRes.variants || [] } : x)));
          }
          showToast("수정 사항을 저장했습니다.", "ok");
        }
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      setEditing(null);
    } catch (e: any) { showToast(`저장 실패: ${e.message}`, "error"); }
    finally { setSaving(false); }
  }

  async function remove(it: ScenarioObjectAdmin) {
    if (!window.confirm(`'${it.name}'(${it.id})을(를) 삭제할까요? DB에서 삭제됩니다.`)) return;
    try {
      if (connected && scriptUrl) await deleteScenarioObject(scriptUrl, it.rowIndex);
      setItems((p) => p.filter((x) => x.rowIndex !== it.rowIndex));
      showToast("삭제했습니다.", "ok");
    } catch (e: any) { showToast(`삭제 실패: ${e.message}`, "error"); }
  }

  // 파손 등으로 오브젝트로 쓰기 어려운 물품을 보관함으로 치우거나(archived: true), 다시 꺼낸다.
  // 보관 처리된 물품은 대여 카탈로그와 "가장 적게 대여된 물품" 랭킹에서 자동으로 빠진다.
  async function toggleArchive(it: ScenarioObjectAdmin) {
    const next = !it.archived;
    if (next && !window.confirm(`'${it.name}'을(를) 보관함으로 옮길까요?\n대여 카탈로그·랭킹 목록에서 더 이상 안 보이게 됩니다.`)) return;
    try {
      if (connected && scriptUrl) await updateScenarioObject(scriptUrl, { rowIndex: it.rowIndex, archived: next });
      setItems((p) => p.map((x) => (x.rowIndex === it.rowIndex ? { ...x, archived: next } : x)));
      showToast(next ? "보관함으로 옮겼습니다." : "보관함에서 꺼냈습니다.", "ok");
    } catch (e: any) { showToast(`처리 실패: ${e.message}`, "error"); }
  }

  function toggleSelected(rowIndex: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedRows(new Set());
    setBulkRootSlot("");
  }

  function selectAllFiltered() {
    setSelectedRows(new Set(filtered.map((it) => it.rowIndex)));
  }

  async function applyBulkScenarioUpdate(kind: "location" | "clearLocation" | "archive") {
    if (!selectedItems.length) { showToast("선택된 물품이 없습니다.", "warn"); return; }
    const picked = selectedItems;
    const slot = bulkRootSlot.trim();
    if (kind === "location" && !slot) { showToast("변경할 위치를 입력해주세요.", "warn"); return; }

    const actionText = kind === "location"
      ? `위치를 ${slot}(으)로 변경`
      : kind === "clearLocation"
        ? "위치를 없음으로 변경"
      : "보관함으로 이동";
    const rentedCount = picked.filter((it) => Number(it.rented) > 0).length;
    const warn = [
      rentedCount ? `\n\n이 중 ${rentedCount}종은 대여 중입니다.` : "",
    ].join("");
    if (!window.confirm(`${picked.length}종의 ${actionText} 작업을 진행할까요?${warn}`)) return;

    setBulkSaving(true);
    try {
      if (connected && scriptUrl) {
        for (const it of picked) {
          if (kind === "location") {
            await updateScenarioObject(scriptUrl, { rowIndex: it.rowIndex, rootSlot: slot, manager: adminName });
          } else if (kind === "clearLocation") {
            await updateScenarioObject(scriptUrl, { rowIndex: it.rowIndex, rootSlot: "", manager: adminName });
          } else {
            await updateScenarioObject(scriptUrl, { rowIndex: it.rowIndex, archived: true, manager: adminName });
          }
        }
      }

      setItems((prev) => prev.map((it) => {
        if (!selectedRows.has(it.rowIndex)) return it;
        if (kind === "location") return { ...it, rootSlot: slot };
        if (kind === "clearLocation") return { ...it, rootSlot: "" };
        return { ...it, archived: true };
      }));
      showToast(`${picked.length}종의 ${actionText} 완료`, "ok");
      exitSelectMode();
    } catch (e: any) {
      showToast(`일괄 처리 실패: ${e.message}`, "error");
    } finally {
      setBulkSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 13px", fontSize: "14px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  const lblStyle: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "5px" };

  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "sap-spin 0.9s linear infinite" }} />;
  }

  return (
    <div className="sap-root" style={{ ["--sap-g" as any]: `${gutter}px` }}>
      <style>{`
        @keyframes sap-spin { to { transform: rotate(360deg); } }
        @keyframes sap-skel-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        .sap-skel { animation: sap-skel-pulse 1.3s ease-in-out infinite; }
        .sap-filter-actions { display: contents; }
        .sap-mobile-filter-toggle { display: none; }
        @media (min-width: 900px) {
          .sap-root { zoom: 1.15; }
        }
        @media (max-width: 640px) {
          /* 카테고리 칩은 한 줄로 옆으로 밀어서 보고, 검색 줄 아래 버튼들은 작게 해서 한 줄에 담는다. */
          .sap-toolbar-shell { padding-bottom: 8px !important; margin-bottom: 10px !important; border-bottom: 1px solid var(--panel-border, #26324a); box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12); }
          .sap-category-nav { flex-wrap: nowrap !important; overflow-x: auto; margin-bottom: 8px !important; scrollbar-width: none; }
          .sap-category-nav::-webkit-scrollbar { display: none; }
          .sap-category-nav > * { flex-shrink: 0; }
          .sap-filter-bar { gap: 6px !important; padding-bottom: 0 !important; }
          .sap-filter-bar > .sap-search-sticky { flex: 1 1 100% !important; }
          .sap-filter-bar button { padding: 9px 10px !important; font-size: 12px !important; }
          .sap-filter-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0 0; }
          .sap-filter-actions select { flex: 1 1 calc(50% - 6px) !important; min-width: 0 !important; padding: 9px 10px !important; font-size: 13px !important; }

          /* 카드: 사진을 왼쪽에 작게, 정보와 버튼은 오른쪽에. 한 화면에 여러 개가 보이게 한다. */
          .sap-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; }
          .sap-card { flex-direction: row !important; border-radius: 12px !important; }
          .sap-card-media { height: auto !important; width: 88px !important; min-height: 88px; flex-shrink: 0; border-bottom: none !important; border-right: 1px solid var(--panel-border, #26324a); }
          .sap-card-body { padding: 10px 12px !important; min-width: 0; }
          .sap-card-actions { flex-direction: row !important; flex-wrap: wrap; gap: 6px !important; padding-top: 6px !important; }
          .sap-card-actions-row { display: contents !important; }
          .sap-card-actions button, .sap-card-actions a { flex: 1 1 calc(50% - 6px) !important; min-width: 0; padding: 8px 6px !important; }
          .sap-card-actions .sap-card-delete { flex: 0 0 40px !important; }

          /* 편집 창: 아래에서 올라오는 시트. 입력 칸은 한 줄에 하나. */
          .sap-modal-overlay { padding: 0 !important; align-items: flex-end !important; }
          .sap-modal { width: 100% !important; max-height: 94vh !important; border-radius: 16px 16px 0 0 !important; }
          .sap-form-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>

      <div className="sap-mobile-filter-toggle">
        <button
          onClick={() => setMobileFiltersOpen((v) => !v)}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", borderRadius: "10px", border: `1px solid ${mobileFiltersOpen || hasCustomFilters ? C.accent : C.border}`, background: mobileFiltersOpen || hasCustomFilters ? C.accentSoft : C.card, color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 900 }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Search size={15} />
            검색·필터
          </span>
          <span style={{ fontSize: "11.5px", fontWeight: 800, color: C.label }}>
            {mobileFiltersOpen ? "접기" : hasCustomFilters ? "적용 중" : "열기"}
          </span>
        </button>
      </div>

      {/* 헤더 전체(카테고리 내비게이터 + 검색바)를 하나로 묶어 함께 고정한다.
          따로 고정하면 칩 줄은 스크롤에 그냥 흘러가버려서, 그 틈으로 아래 목록 사진이
          비쳐 보이는 문제가 있었다. */}
      {/* 스크롤 시 아래 내용이 비쳐 보이지 않도록 배경을 캔버스와 같은 변수로 맞추고,
          부모의 24px 패딩만큼 음수 마진으로 넓혀 가장자리 틈을 없앤다 */}
      <div className={`sap-toolbar-shell${mobileFiltersOpen ? " sap-mobile-open" : ""}`} style={{
        position: "sticky", top: "calc(var(--sap-g) * -1)", zIndex: 30,
        background: "var(--canvas-bg, #0b1120)",
        margin: "calc(var(--sap-g) * -1) calc(var(--sap-g) * -1) 14px",
        padding: "var(--sap-g) var(--sap-g) 0",
        boxSizing: "border-box",
      }}>
        {/* 카테고리 내비게이터 — 검색창 위 공간을 채우면서 빠른 필터로도 쓴다.
            물품이 로드되기 전엔 칩이 하나도 없어 이 줄 자체가 접혀 있다가, 로드되는 순간
            갑자기 나타나면서 아래 검색바·버튼이 밀려 내려가 실수로 다른 걸 누르게 되는
            문제가 있었다 — 로드 전에는 같은 높이의 스켈레톤을 대신 깔아 자리를 미리 잡아둔다. */}
        {!loaded ? (
          <div className="sap-category-nav" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
            {[52, 68, 60, 74, 56].map((w, i) => (
              <div key={i} className="sap-skel" style={{ width: w, height: 31, borderRadius: "9px", background: C.cardSub, border: `1px solid ${C.border}` }} />
            ))}
          </div>
        ) : categories.length > 0 ? (
          <div className="sap-category-nav" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
            <button
              onClick={() => { setCat(""); setSubcatFilter(""); }}
              style={{
                padding: "7px 13px", borderRadius: "9px", cursor: "pointer",
                border: `1px solid ${cat === "" ? C.accent : C.border}`,
                background: cat === "" ? C.accent : C.card, color: cat === "" ? "#fff" : C.text,
                fontSize: "12px", fontWeight: 800,
              }}
            >
              전체
            </button>
            {categories.map((c) => {
              const on = cat === c;
              return (
                <button
                  key={c}
                  onClick={() => { setCat(on ? "" : c); setSubcatFilter(""); }}
                  style={{
                    padding: "7px 13px", borderRadius: "9px", cursor: "pointer",
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accent : C.card, color: on ? "#fff" : C.text,
                    fontSize: "12px", fontWeight: 800,
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 필터 바 */}
        <div className="sap-filter-bar" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", paddingBottom: "10px" }}>
          <div className="sap-search-sticky" style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
            <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID · 물품명 · 위치 · 분류 · 구역으로 검색..." style={{ ...inputStyle, paddingLeft: "36px" }} />
          </div>
          {(() => {
            const activeFilterCount = (cat ? 1 : 0) + (subcatFilter ? 1 : 0) + (sectorFilter ? 1 : 0) + (stockFilter ? 1 : 0) + (requestFilter !== "all" ? 1 : 0) + (sortOrder !== "id_desc" ? 1 : 0);
            return (
              <>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  style={{
                    ...inputStyle,
                    width: "auto",
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 800,
                    color: C.accentText,
                    borderColor: filtersOpen || activeFilterCount > 0 ? C.accent : C.border,
                    background: filtersOpen || activeFilterCount > 0 ? C.accentSoft : C.card,
                    whiteSpace: "nowrap",
                  }}
                >
                  <SlidersHorizontal size={15} /> 필터{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}{filtersOpen ? " 접기" : ""}
                </button>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    title="검색과 필터 초기화"
                    style={{
                      ...inputStyle,
                      width: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: C.label,
                      background: C.card,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <X size={14} /> 초기화
                  </button>
                )}
              </>
            );
          })()}
        <style>{`@keyframes sapSpinBtn2 { to { transform: rotate(360deg); } } .sap-spin-btn2 { animation: sapSpinBtn2 0.9s linear infinite; }`}</style>
        <button onClick={() => load(true)} disabled={loading} title="지금 새로고침" style={{ display: "flex", alignItems: "center", gap: "5px", padding: "11px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: loading ? "wait" : "pointer", fontSize: "13px", fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
          <RotateCcw size={15} className={loading ? "sap-spin-btn2" : undefined} />
        </button>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setToolsOpen((v) => !v)}
            title="보관함과 SM 연동 도구"
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "11px 14px", borderRadius: "10px",
              border: `1px solid ${toolsOpen || toolStatusCount ? C.accent : C.border}`,
              background: toolsOpen || showArchived ? C.accentSoft : C.card,
              color: C.accentText,
              cursor: "pointer", fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap",
            }}
          >
            <SlidersHorizontal size={15} />
            관리 도구
            {toolStatusCount ? (
              <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999, background: C.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 900 }}>
                {toolStatusCount}
              </span>
            ) : null}
          </button>
          {toolsOpen ? (
            <div
              style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 60,
                width: 250, padding: "8px", borderRadius: "12px", border: `1px solid ${C.border}`,
                background: C.card, boxShadow: "0 16px 36px rgba(15,23,42,0.18)", display: "flex", flexDirection: "column", gap: "6px",
              }}
            >
              <button
                onClick={() => { setShowArchived((v) => !v); setToolsOpen(false); }}
                title={showArchived ? "보관함 닫기" : "보관함 열기 (파손 등으로 치워둔 물품)"}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px",
                  border: `1px solid ${showArchived ? C.accent : "transparent"}`,
                  background: showArchived ? C.accentSoft : "transparent",
                  color: C.text, cursor: "pointer", fontSize: "13px", fontWeight: 800, textAlign: "left",
                }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{showArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</span>
                <span style={{ flex: 1 }}>{showArchived ? "보관함 닫기" : "보관함 보기"}</span>
                {archivedCount > 0 ? <span style={{ color: C.label, fontSize: "12px" }}>{archivedCount}</span> : null}
              </button>
              <button
                onClick={() => { setToolsOpen(false); setEmptySlotsOpen(true); }}
                disabled={!loaded}
                title="아무 물품도 놓여 있지 않은 보관 위치를 봅니다"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px", border: "1px solid transparent", background: "transparent", color: C.text, cursor: loaded ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 800, textAlign: "left", opacity: loaded ? 1 : 0.55 }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}><MapPin size={15} /></span>
                <span style={{ flex: 1 }}>빈 슬롯 보기</span>
                {loaded ? <span style={{ color: C.label, fontSize: "12px" }}>{emptySlotCount}</span> : null}
              </button>
              <button
                onClick={() => { setToolsOpen(false); applySmChanges(); }}
                disabled={smSyncing || smFullSyncing || !connected}
                title="마지막 SM 동기화 이후 변경된 재고와 대여 상태를 지금 적용합니다"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px", border: "1px solid transparent", background: "transparent", color: C.success, cursor: smSyncing || smFullSyncing || !connected ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 800, textAlign: "left", opacity: connected ? 1 : 0.55 }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{smSyncing ? <Spinner size={14} /> : <Upload size={15} />}</span>
                <span style={{ flex: 1 }}>{smSyncing ? "SM 적용 중..." : "변경사항 SM에 적용"}</span>
              </button>
              <button
                onClick={() => { setToolsOpen(false); setSmFullUploadFields(new Set(ALL_SM_METADATA_FIELDS)); setSmFullUploadOpen(true); }}
                disabled={smSyncing || smFullSyncing || !connected}
                title="SM에 등록된 시나리오 오브젝트에서 선택한 정보만 WMS 값으로 일괄 변경합니다"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px", border: `1px solid ${smFullSyncing ? C.accent : "transparent"}`, background: smFullSyncing ? C.accentSoft : "transparent", color: C.accentText, cursor: smSyncing || smFullSyncing || !connected ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 800, textAlign: "left", opacity: connected ? 1 : 0.55 }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{smFullSyncing ? <Spinner size={14} /> : <Upload size={15} />}</span>
                <span style={{ flex: 1 }}>{smFullSyncing ? "일괄 업데이트 중..." : "SM 정보 일괄 업데이트"}</span>
              </button>
              <button
                onClick={() => { setToolsOpen(false); openSmImport(); }}
                disabled={smImportLoading || !smAutoId}
                title={smAutoId ? "Scenario Manager에만 있는 물품을 WMS로 가져옵니다" : (smStatus?.reason || "SM 연결 확인 중")}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px", border: "1px solid transparent", background: "transparent", color: C.accentText, cursor: smAutoId ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 800, textAlign: "left", opacity: smAutoId ? 1 : 0.55 }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}><Download size={15} /></span>
                <span style={{ flex: 1 }}>SM에서 불러오기</span>
              </button>
              <div style={{ height: 1, background: C.border, margin: "2px 0" }} />
              <button
                onClick={() => { setToolsOpen(false); selectMode ? exitSelectMode() : setSelectMode(true); }}
                title="여러 물품을 체크해서 위치, 재고, 보관함을 일괄 변경합니다"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 11px", borderRadius: "9px", border: `1px solid ${selectMode ? C.accent : "transparent"}`, background: selectMode ? C.accentSoft : "transparent", color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 800, textAlign: "left" }}
              >
                <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}><ClipboardCheck size={15} /></span>
                <span style={{ flex: 1 }}>{selectMode ? "선택 모드 끄기" : "일괄 변경 선택"}</span>
                {selectedRows.size ? <span style={{ color: C.label, fontSize: "12px" }}>{selectedRows.size}</span> : null}
              </button>
            </div>
          ) : null}
        </div>
        <button onClick={() => openNew()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "11px 16px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>
          <Plus size={15} /> 새 물품
        </button>
        {filtersOpen ? (
          <div className="sap-filter-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", width: "100%", paddingTop: "6px" }}>
            <select value={cat} onChange={(e) => { setCat(e.target.value); setSubcatFilter(""); }} style={{ ...inputStyle, flex: "1 1 145px", minWidth: "135px" }}>
              <option value="">전체 카테고리</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={subcatFilter} onChange={(e) => setSubcatFilter(e.target.value)} style={{ ...inputStyle, flex: "1 1 145px", minWidth: "135px" }}>
              <option value="">전체 서브카테고리</option>
              {filterSubcategories.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} style={{ ...inputStyle, flex: "1 1 130px", minWidth: "120px" }}>
              <option value="">전체 구역</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)} style={{ ...inputStyle, flex: "1 1 140px", minWidth: "130px" }}>
              <option value="">전체 재고 상태</option>
              <option value="available">재고 있음</option>
              <option value="out">재고 없음</option>
              <option value="rented">대여 중</option>
              <option value="variant">종류 구분 있음</option>
            </select>
            <select value={requestFilter} onChange={(e) => setRequestFilter(e.target.value as typeof requestFilter)} style={{ ...inputStyle, flex: "1 1 155px", minWidth: "145px" }} aria-label="물품 구분">
              <option value="all">전체 물품</option>
              <option value="request">Request 물품만</option>
              <option value="normal">일반 물품만</option>
            </select>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)} style={{ ...inputStyle, flex: "1 1 155px", minWidth: "145px" }}>
              <option value="id_desc">ID 내림차순 (기본)</option>
              <option value="id_asc">ID 오름차순</option>
              <option value="location_asc">위치 오름차순</option>
              <option value="name_asc">이름 가나다순</option>
              <option value="stock_desc">재고 많은 순</option>
            </select>
          </div>
        ) : null}
      </div>
        {smUploadJob?.status === "running" ? (
          <div style={{ margin: "0 0 10px", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${C.accent}33`, background: C.accentSoft }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "7px" }}>
              <span style={{ fontSize: "12px", fontWeight: 900, color: C.accentText, flex: 1 }}>
                {smUploadJob.mode === "all" ? "SM 정보 일괄 업데이트" : "SM 변경사항 적용"} · {smUploadJob.phase}
              </span>
              <span style={{ fontSize: "12px", fontWeight: 900, color: C.accent }}>
                {smUploadJob.percent}%
              </span>
              <span style={{ fontSize: "11.5px", fontWeight: 800, color: C.label }}>
                {smUploadJob.processed}/{smUploadJob.total || "?"}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: isLightMode ? "rgba(37,99,235,0.14)" : "rgba(148,163,184,0.20)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${smUploadJob.percent}%`, borderRadius: 999, background: C.accent, transition: "width 0.25s ease" }} />
            </div>
            {smUploadJob.currentItemId ? (
              <div style={{ marginTop: "7px", fontSize: "11.5px", color: C.label, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                현재 <b style={{ color: C.accentText, fontFamily: "monospace" }}>ID {smUploadJob.currentItemId}</b>
                {smUploadJob.currentItemName ? <> &lt;<b style={{ color: C.text }}>{smUploadJob.currentItemName}</b>&gt;</> : null}
                의 정보를 업데이트 중
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>
        {loaded ? (showArchived
          ? `보관함 · ${filtered.length}개 물품 (파손 등으로 목록·대여 카탈로그에서 제외됨)`
          : `${filtered.length} / ${items.length - archivedCount}개 시나리오 물품`) : ""}
        {smLastRun?.at ? <span style={{ marginLeft: 10 }}>· SM 마지막 동기화 {new Date(smLastRun.at).toLocaleString("ko-KR")}</span> : null}
      </div>

      {selectMode ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "12px", padding: "10px 12px", borderRadius: "12px", border: `1px solid ${C.border}`, background: C.card, boxShadow: "0 2px 8px rgba(15,23,42,0.06)" }}>
          <span style={{ fontSize: "12px", fontWeight: 800, color: C.text, marginRight: "auto" }}>
            선택 {selectedRows.size}종
          </span>
          <button
            onClick={selectAllFiltered}
            disabled={!filtered.length || bulkSaving}
            style={{ padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, cursor: filtered.length && !bulkSaving ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 800, opacity: filtered.length ? 1 : 0.55 }}
          >
            현재 목록 전체 선택
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            disabled={!selectedRows.size || bulkSaving}
            style={{ padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: selectedRows.size && !bulkSaving ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 800, opacity: selectedRows.size ? 1 : 0.55 }}
          >
            선택 해제
          </button>
          <input
            value={bulkRootSlot}
            onChange={(e) => setBulkRootSlot(e.target.value)}
            placeholder="변경할 위치 예: 000060"
            disabled={bulkSaving}
            style={{ ...inputStyle, width: 180, padding: "8px 10px", fontSize: "12px" }}
          />
          <button
            onClick={() => applyBulkScenarioUpdate("location")}
            disabled={!selectedRows.size || !bulkRootSlot.trim() || bulkSaving}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accentText, cursor: selectedRows.size && bulkRootSlot.trim() && !bulkSaving ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 800, opacity: selectedRows.size && bulkRootSlot.trim() ? 1 : 0.55 }}
          >
            <MapPin size={13} /> 위치 변경
          </button>
          <button
            onClick={() => applyBulkScenarioUpdate("clearLocation")}
            disabled={!selectedRows.size || bulkSaving}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: selectedRows.size && !bulkSaving ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 800, opacity: selectedRows.size ? 1 : 0.55 }}
          >
            <MapPin size={13} /> 위치 없음으로
          </button>
          <button
            onClick={() => applyBulkScenarioUpdate("archive")}
            disabled={!selectedRows.size || bulkSaving}
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.warn}`, background: C.warnSoft, color: C.warn, cursor: selectedRows.size && !bulkSaving ? "pointer" : "not-allowed", fontSize: "12px", fontWeight: 800, opacity: selectedRows.size ? 1 : 0.55 }}
          >
            <Archive size={13} /> 보관함으로
          </button>
          <button
            onClick={exitSelectMode}
            disabled={bulkSaving}
            style={{ padding: "8px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: bulkSaving ? "default" : "pointer", fontSize: "12px", fontWeight: 800 }}
          >
            닫기
          </button>
          {bulkSaving ? <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: C.label }}><Spinner size={14} /> 처리 중...</span> : null}
        </div>
      ) : null}

      {loading && !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>결과가 없습니다.</div>
      ) : (
        <div className="sap-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "16px" }}>
          {filtered.map((it) => (
            <div
              key={it.rowIndex}
              className="sap-card"
              onClick={() => selectMode ? toggleSelected(it.rowIndex) : openBorrowers(it)}
              style={{ position: "relative", border: `1px solid ${selectedRows.has(it.rowIndex) ? C.accent : C.border}`, background: C.card, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: selectedRows.has(it.rowIndex) ? `0 0 0 2px ${C.accent}22` : "0 2px 4px rgba(0,0,0,0.04)", cursor: "pointer" }}
            >
              {selectMode ? (
                <label onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 9, left: 9, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: "999px", border: `1px solid ${selectedRows.has(it.rowIndex) ? C.accent : C.border}`, background: selectedRows.has(it.rowIndex) ? C.accent : C.card, color: selectedRows.has(it.rowIndex) ? "#fff" : C.text, boxShadow: "0 4px 12px rgba(15,23,42,0.16)", fontSize: "11px", fontWeight: 900, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedRows.has(it.rowIndex)}
                    onChange={() => toggleSelected(it.rowIndex)}
                    style={{ margin: 0, accentColor: C.accent }}
                  />
                  선택
                </label>
              ) : null}
              <div className="sap-card-media" onClick={(e) => { e.stopPropagation(); if (it.image) setModalUrl(getGoogleDriveImageUrl(it.image)); }} style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: it.image ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
                {it.image ? <img src={getThumbImageUrl(it.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
              </div>
              <div className="sap-card-body" style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.35, wordBreak: "break-word" }}>{it.name}</div>
                <div style={{ fontSize: "11px", color: C.label }}><ScenarioManagerObjectLink id={it.id} color={C.label}>ID: {it.id}</ScenarioManagerObjectLink></div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {it.rootSlot ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={11} />{padSlot(it.rootSlot)}</span> : <span style={{ fontSize: "10px", fontWeight: 700, color: C.error, background: C.errorSoft, borderRadius: "6px", padding: "2px 7px" }}>위치 없음</span>}
                  {it.category ? <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>{it.category}</span> : null}
                  {/* 서브카테고리는 대분류 바로 옆에, 한 톤 낮춰서 — 어느 쪽이 상위인지 한눈에 구분되게 */}
                  {it.subcategory ? <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: "transparent", color: C.label, border: `1px solid ${C.border}` }}>{it.subcategory}</span> : null}
                </div>
                {it.fragile || it.fireRisk || it.requestFor !== undefined || it.personalOwner !== undefined || it.excludeFromRanking || it.variants?.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {it.variants?.length ? (
                      <span
                        title={`종류 ${it.variants.length}개 · ${it.variants.map((v: any) => `${v.name}(${v.stock})`).join(", ")}${Number(it.unassignedStock) > 0 ? ` · 미확인 ${it.unassignedStock}` : ""}`}
                        style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.successSoft, color: C.success }}
                      >
                        🏷 종류 {it.variants.length}
                        {Number(it.unassignedStock) > 0 ? ` · 미확인 ${it.unassignedStock}` : ""}
                      </span>
                    ) : null}
                    {it.fragile ? <span title="깨질 위험이 있는 물품" style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.warnSoft, color: C.warn }}>🔺 파손주의</span> : null}
                    {it.fireRisk ? <span title="화재 위험이 있는 물품" style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.errorSoft, color: C.error }}>🔥 화재주의</span> : null}
                    {it.requestFor !== undefined ? <span title={`특정 업체 request용${it.requestFor ? `: ${it.requestFor}` : ""}`} style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>📌 {it.requestFor || "Request"}</span> : null}
                    {it.personalOwner !== undefined ? <span title={`개인 물품${it.personalOwner ? `: ${it.personalOwner}` : ""}`} style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>👤 {it.personalOwner || "개인 물품"}</span> : null}
                    {it.excludeFromRanking ? <span title="랭킹 제외" style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.cardSub, color: C.label }}>랭킹 제외</span> : null}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600 }}>
                  <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {it.stock}</span>
                  <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {it.rented}</span>
                </div>
                <div className="sap-card-actions" style={{ marginTop: "auto", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                  <div className="sap-card-actions-row" style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => openEdit(it)} style={{ flex: 1, padding: "8px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}><Pencil size={13} /> 편집</button>
                    <button className="sap-card-delete" onClick={() => remove(it)} style={{ flex: "0 0 auto", padding: "8px 10px", borderRadius: "9px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} /></button>
                  </div>
                  <button onClick={() => setStockAdjustItem(it)} style={{ padding: "8px", borderRadius: "9px", border: "none", background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}><ArrowUpDown size={13} /> 재고 변경</button>
                  {it.purchaseLink ? (
                    <a
                      href={it.purchaseLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ padding: "8px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", textDecoration: "none" }}
                    >
                      <Link2 size={13} /> 구매 링크
                    </a>
                  ) : null}
                  <button
                    onClick={() => toggleArchive(it)}
                    style={{
                      padding: "8px", borderRadius: "9px", border: "none", cursor: "pointer",
                      fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                      background: it.archived ? C.successSoft : C.warnSoft,
                      color: it.archived ? C.success : C.warn,
                    }}
                  >
                    {it.archived ? <><ArchiveRestore size={13} /> 보관함에서 꺼내기</> : <><Archive size={13} /> 보관 처리 (파손 등)</>}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {smFullUploadOpen ? createPortal(
        <div className="sap-root" onClick={() => !smFullSyncing && setSmFullUploadOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2550, background: "rgba(15,23,42,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: "18px", backdropFilter: "blur(3px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(700px, 100%)", maxHeight: "90vh", overflowY: "auto", background: C.card, border: `1px solid ${C.border}`, borderRadius: "18px", boxShadow: "0 24px 64px rgba(15,23,42,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: C.accentSoft, color: C.accentText }}><Upload size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: C.text }}>SM 오브젝트 정보 일괄 업데이트</h2>
                <div style={{ marginTop: 4, fontSize: "12px", color: C.label }}>선택한 정보만 WMS 기준으로 반영하며, 나머지 SM 정보는 유지합니다.</div>
              </div>
              <button onClick={() => setSmFullUploadOpen(false)} aria-label="닫기" style={{ border: "none", background: "transparent", color: C.label, cursor: "pointer", padding: 5 }}><X size={20} /></button>
            </div>

            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 900, color: C.text }}>업데이트할 정보</span>
                <button onClick={() => setSmFullUploadFields(new Set(ALL_SM_METADATA_FIELDS))} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "11.5px", fontWeight: 800 }}>전체 선택</button>
                <button onClick={() => setSmFullUploadFields(new Set())} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: "pointer", fontSize: "11.5px", fontWeight: 800 }}>전체 해제</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {SM_METADATA_UPLOAD_GROUPS.map((group) => {
                  const groupFields = SM_METADATA_UPLOAD_FIELDS.filter((field) => field.group === group);
                  const selectedCount = groupFields.filter((field) => smFullUploadFields.has(field.key)).length;
                  return (
                    <section key={group} style={{ padding: "11px", borderRadius: 13, border: `1px solid ${C.border}`, background: C.cardSub }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 900, color: C.text }}>{group}</span>
                        <span style={{ fontSize: "10.5px", fontWeight: 800, color: selectedCount ? C.accentText : C.label }}>{selectedCount}/{groupFields.length} 선택</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
                        {groupFields.map((field) => {
                          const checked = smFullUploadFields.has(field.key);
                          return (
                            <button key={field.key} type="button" onClick={() => setSmFullUploadFields((prev) => { const next = new Set(prev); checked ? next.delete(field.key) : next.add(field.key); return next; })} style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr)", alignItems: "start", columnGap: 9, minHeight: 58, padding: "10px 11px", textAlign: "left", borderRadius: 10, border: `1px solid ${checked ? C.accent : C.border}`, background: checked ? (isLightMode ? "#eef4ff" : C.accentSoft) : C.card, color: C.text, cursor: "pointer" }}>
                              <span style={{ width: 18, height: 18, marginTop: 1, borderRadius: 5, border: `2px solid ${checked ? C.accent : C.border}`, background: checked ? C.accent : C.card, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{checked ? <ClipboardCheck size={12} /> : null}</span>
                              <span style={{ minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: "12.5px", fontWeight: 900, lineHeight: 1.25 }}>{field.label}</span>
                                <span style={{ display: "block", marginTop: 4, fontSize: "10.5px", lineHeight: 1.4, color: C.label }}>{field.description}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>

              <div style={{ marginTop: 14, padding: "11px 13px", borderRadius: 10, background: C.warnSoft, color: C.warn, fontSize: "11.5px", lineHeight: 1.55, fontWeight: 700 }}>
                선택한 정보는 SM에 등록된 시나리오 오브젝트에 WMS 값으로 일괄 반영됩니다. 대여·반납 현황을 선택하면 장부 정합성을 위해 관련 가용 재고도 함께 맞춥니다.
              </div>
            </div>

            <div style={{ display: "flex", gap: 9, padding: "14px 20px 18px", borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => setSmFullUploadOpen(false)} style={{ flex: 1, padding: "11px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "13px", fontWeight: 800 }}>취소</button>
              <button onClick={uploadAllSmMetadata} disabled={!smFullUploadFields.size} style={{ flex: 2, padding: "11px", borderRadius: 10, border: "none", background: smFullUploadFields.size ? C.accent : C.border, color: "#fff", cursor: smFullUploadFields.size ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <Upload size={15} /> 선택한 정보 {smFullUploadFields.size}개 일괄 반영
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {smErrorReport ? createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 2600, background: "rgba(15,23,42,0.58)", display: "flex", alignItems: "center", justifyContent: "center", padding: "18px" }}>
          <div style={{ width: "min(640px, 100%)", maxHeight: "86vh", overflowY: "auto", background: C.card, border: `1px solid ${C.error}55`, borderRadius: "16px", boxShadow: "0 24px 60px rgba(15,23,42,0.28)", padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <ShieldAlert size={19} style={{ color: C.error, flexShrink: 0 }} />
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 900, color: C.text, flex: 1 }}>{smErrorReport.title}</h2>
            </div>
            <div style={{ fontSize: "13px", lineHeight: 1.6, color: C.label, marginBottom: "14px" }}>
              {smErrorReport.message}
            </div>
            {smErrorReport.result ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
                {smErrorReport.result.total !== undefined ? <span style={{ padding: "4px 9px", borderRadius: "999px", background: C.accentSoft, color: C.accentText, fontSize: "12px", fontWeight: 800 }}>전체 {smErrorReport.result.total}건</span> : null}
                <span style={{ padding: "4px 9px", borderRadius: "999px", background: C.successSoft, color: C.success, fontSize: "12px", fontWeight: 800 }}>성공 {Number(smErrorReport.result.metadata) || 0}건</span>
                <span style={{ padding: "4px 9px", borderRadius: "999px", background: C.errorSoft, color: C.error, fontSize: "12px", fontWeight: 800 }}>실패 {Number(smErrorReport.result.metadataFailed || smErrorReport.result.failed) || 0}건</span>
              </div>
            ) : null}
            {smErrorReport.result?.metadataErrors?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                {smErrorReport.result.metadataErrors.map((err, i) => (
                  <div key={`${err.id || "unknown"}-${i}`} style={{ padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.error}44`, background: C.errorSoft }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 900, color: C.text }}>
                      {err.id || "ID 없음"}{err.name ? ` · ${err.name}` : ""}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "12px", lineHeight: 1.5, color: C.error, wordBreak: "break-word" }}>
                      {err.reason || "알 수 없는 오류"}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setSmErrorReport(null)}
                style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: C.error, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 900 }}
              >
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}


      {emptySlotsOpen ? createPortal(
        <div className="sap-root" onClick={() => setEmptySlotsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "86vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <MapPin size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, color: C.text, flex: 1 }}>빈 슬롯 {emptySlotCount}칸</span>
              <button onClick={() => setEmptySlotsOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px", lineHeight: 1.5 }}>
              등록된 물품이 하나도 없는 보관 위치입니다(보관함으로 치운 물품은 빼고 계산). 슬롯을 누르면 그 위치로 새 물품을 등록합니다.
            </div>
            {emptySlotGroups.map((g) => (
              <div key={g.label} style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, color: C.text, fontFamily: "monospace" }}>{g.label}</span>
                  <span style={{ fontSize: "12px", color: C.label }}>{g.empty.length} / {g.total}칸 비어 있음</span>
                </div>
                {g.empty.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {g.empty.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => { setEmptySlotsOpen(false); openNew(slot); }}
                        title={`${slot} 위치로 새 물품 등록`}
                        style={{ padding: "5px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700, fontFamily: "monospace" }}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                ) : <div style={{ fontSize: "12px", color: C.label }}>빈 슬롯이 없습니다.</div>}
              </div>
            ))}
          </div>
        </div>,
        document.body
      ) : null}

      {smImportOpen ? createPortal((() => {
        const q = smImportSearch.trim().toLowerCase();
        const visible = smImportItems.filter((item) => !q || `${item.id} ${item.name} ${item.sector} ${item.rootSlot}`.toLowerCase().includes(q));
        return (
          <div className="sap-root" style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ width: "min(820px, 100%)", maxHeight: "90vh", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: C.accentSoft, color: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Download size={20} /></div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 800 }}>SM에서 물품 불러오기</h2>
                  <div style={{ marginTop: 4, fontSize: "12px", color: C.label }}>SM 물품 번호를 입력해 한 건을 확인한 뒤 WMS로 가져옵니다.</div>
                </div>
                <button onClick={() => !smImportSaving && setSmImportOpen(false)} style={{ border: "none", background: "none", color: C.label, cursor: "pointer", padding: 4 }}><X size={20} /></button>
              </div>
              {smImportLoading ? (
                <div style={{ minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.label }}><Spinner size={28} />SM에서 해당 번호를 조회하는 중입니다...</div>
              ) : (
                <>
                  <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ position: "relative", flex: "1 1 280px" }}>
                      <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.label }} />
                      <input value={smImportSearch} onChange={(e) => { setSmImportSearch(e.target.value); setSmImportItems([]); setSmImportSelected(new Set()); }} onKeyDown={(e) => { if (e.key === "Enter") lookupSmImport(); }} inputMode="numeric" autoFocus placeholder="SM 물품 번호 입력 (예: 003962)" style={{ ...inputStyle, paddingLeft: 36 }} />
                    </div>
                    <button onClick={lookupSmImport} disabled={!smImportSearch.trim()} style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontWeight: 800, cursor: smImportSearch.trim() ? "pointer" : "not-allowed", opacity: smImportSearch.trim() ? 1 : 0.55 }}>
                      번호 조회
                    </button>
                  </div>
                  <div style={{ overflowY: "auto", padding: "12px 20px", minHeight: 220 }}>
                    {!visible.length ? <div style={{ textAlign: "center", color: C.label, padding: "54px 0" }}>위에 SM 물품 번호를 입력하고 조회해 주세요.</div> :
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
                        {visible.map((item) => {
                          const checked = smImportSelected.has(item.id);
                          return <button key={item.id} disabled={!item.importable} title={item.blockedReason || ""} onClick={() => setSmImportSelected((prev) => { const next = new Set(prev); checked ? next.delete(item.id) : next.add(item.id); return next; })} style={{ display: "flex", gap: 11, alignItems: "center", textAlign: "left", padding: 10, borderRadius: 12, border: `1px solid ${checked ? C.accent : C.border}`, background: checked ? C.accentSoft : C.cardSub, color: C.text, cursor: item.importable ? "pointer" : "not-allowed", opacity: item.importable ? 1 : 0.58 }}>
                            <div style={{ width: 62, height: 62, flex: "0 0 62px", borderRadius: 9, overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.border}` }}>
                              {item.image ? <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={24} color={C.label} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                              <div style={{ marginTop: 4, fontSize: 11, color: C.label }}>ID {item.id}{item.rootSlot ? ` · 위치 ${item.rootSlot}` : ""}</div>
                              <div style={{ marginTop: 5, fontSize: 11, fontWeight: 700, color: item.importable ? C.success : C.warn }}>재고 {item.stock} · 대여 중 {item.rented}{item.importable ? "" : " · 반납 후 가능"}</div>
                            </div>
                            <input type="checkbox" checked={checked} disabled={!item.importable} readOnly aria-label={`${item.name} 선택`} style={{ width: 17, height: 17, accentColor: C.accent }} />
                          </button>;
                        })}
                      </div>}
                  </div>
                  <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 9 }}>
                    <button onClick={() => setSmImportOpen(false)} disabled={smImportSaving} style={{ padding: "10px 16px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontWeight: 700, cursor: "pointer" }}>취소</button>
                    <button onClick={confirmSmImport} disabled={smImportSaving || !smImportSelected.size} style={{ padding: "10px 17px", borderRadius: 9, border: "none", background: C.accent, color: "#fff", fontWeight: 800, cursor: smImportSelected.size ? "pointer" : "not-allowed", opacity: smImportSelected.size ? 1 : 0.55, display: "flex", alignItems: "center", gap: 7 }}>
                      {smImportSaving ? <><Spinner size={14} />가져오는 중...</> : <><Download size={15} />이 물품 가져오기</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })(), document.body) : null}

      {/* 편집 모달 (뷰포트 중앙 고정 — 사이드바 영향 없이 화면 정중앙) */}
      {editing ? createPortal(
        <div className="sap-root sap-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div className="sap-modal" style={{ width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", background: C.card, borderRadius: "14px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
              <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>{isNew ? "새 시나리오 물품" : "시나리오 물품 편집"}</h2>
              <button onClick={() => !saving && setEditing(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: "20px" }}>
              {/* 이미지 */}
              <label style={lblStyle}>사진</label>
              <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 96px", width: 96, height: 96, borderRadius: "12px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {editing.image ? (
                    <img src={editing.image.startsWith("data:image/") ? editing.image : getGoogleDriveImageUrl(editing.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : <ImageIcon size={28} style={{ color: C.border }} />}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button onClick={() => document.getElementById("sap-photo-upload")?.click()} disabled={uploading} style={{ padding: "10px", borderRadius: "10px", border: `1px dashed ${C.accent}`, background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    {uploading ? <><Spinner size={14} /> 처리 중...</> : <><Upload size={14} /> 이미지 업로드</>}
                  </button>
                  <input id="sap-photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />
                  {/* 서버 PC에 연결된 카메라로 바로 찍는다 — 사진을 옮겨오는 과정이 생략된다 */}
                  <button
                    type="button"
                    onClick={() => setCameraTarget("item")}
                    style={{ padding: "10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    📷 카메라로 촬영
                  </button>
                  <input value={editing.image && editing.image.startsWith("data:image/") ? "" : (editing.image || "")} disabled={!!(editing.image && editing.image.startsWith("data:image/"))} onChange={(e) => setEditing((p) => (p ? { ...p, image: e.target.value } : p))} placeholder={editing.image && editing.image.startsWith("data:image/") ? "파일이 업로드되었습니다" : "드라이브 공유 링크 직접 입력"} style={{ ...inputStyle, fontSize: "12px", opacity: editing.image && editing.image.startsWith("data:image/") ? 0.6 : 1 }} />
                  {editing.image ? <button onClick={() => setEditing((p) => (p ? { ...p, image: "" } : p))} style={{ fontSize: "11px", color: C.error, background: "none", border: "none", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>이미지 제거</button> : null}
                </div>
              </div>

              {!isNew ? (
                <div style={{ marginBottom: "16px" }}>
                  <label style={lblStyle}>추가 사진 (여러 장)</label>
                  <ItemPhotoGallery
                    scriptUrl={scriptUrl}
                    category="scenario"
                    itemId={editing.id}
                    isLightMode={isLightMode}
                    showToast={showToast}
                    onImageClick={(url) => setModalUrl(url)}
                  />
                </div>
              ) : null}

              <div className="sap-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  {/* 번호는 Scenario Manager가 정한다. 연동이 살아 있으면 손대지 못하게 잠가둔다 —
                      사람이 적은 번호와 SM이 부여한 번호가 갈리면 두 장부가 어긋난다.
                      연동이 안 될 때만 예전처럼 직접 입력할 수 있게 열어준다. */}
                  <label style={lblStyle}>ID {isNew && !smAutoId ? <span style={{ color: C.error }}>*</span> : null}</label>
                  <input
                    value={editing.id || ""}
                    disabled={!isNew || smAutoId}
                    readOnly={smAutoId}
                    onChange={(e) => setEditing((p) => (p ? { ...p, id: e.target.value } : p))}
                    placeholder={isNew && smAutoId ? "Scenario Manager가 부여합니다" : "예: 000008"}
                    style={{ ...inputStyle, opacity: isNew && !smAutoId ? 1 : 0.6 }}
                  />
                  {smAssignedId ? (
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.success, background: C.successSoft, borderRadius: "7px", padding: "5px 8px", marginTop: "5px", lineHeight: 1.4 }}>
                      Scenario Manager가 부여한 번호입니다.
                    </div>
                  ) : isNew ? (
                    <div style={{ fontSize: "10.5px", color: smAutoId ? C.label : C.warn, marginTop: "4px", lineHeight: 1.4 }}>
                      {smAutoId
                        ? "저장하면 Scenario Manager에 등록하면서 번호를 받아와 이 칸에 채웁니다."
                        : smStatus?.reason || "Scenario Manager 연동 상태를 확인하는 중입니다."}
                    </div>
                  ) : null}
                </div>
                <div>
                  <label style={lblStyle}>위치 (root_slot)</label>
                  <input value={editing.rootSlot || ""} onChange={(e) => setEditing((p) => (p ? { ...p, rootSlot: e.target.value } : p))} placeholder="예: 000060" style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={lblStyle}>물품명 <span style={{ color: C.error }}>*</span></label>
                <input value={editing.name || ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} placeholder="물품명" style={inputStyle} />
              </div>

              {/* 크기와 속성은 Scenario Manager 등록 화면이 받는 값이다. WMS에는 대응하는 개념이
                  없어서 여기서 입력받는다. 비워두면 SM 기본값(Small / Hard)으로 등록된다. */}
              <div className="sap-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={lblStyle}>크기 (SM)</label>
                  <select
                    value={editing.smSize || ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, smSize: e.target.value as any } : p))}
                    style={inputStyle}
                  >
                    <option value="">선택 안 함 (Small)</option>
                    <option value="Extra-Small">Extra-Small</option>
                    <option value="Small">Small</option>
                    <option value="Medium">Medium</option>
                    <option value="Large">Large</option>
                  </select>
                </div>
                <div>
                  <label style={lblStyle}>속성 (SM)</label>
                  <select
                    value={editing.smProperty || ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, smProperty: e.target.value as any } : p))}
                    style={inputStyle}
                  >
                    <option value="">선택 안 함 (Hard)</option>
                    <option value="Soft">Soft</option>
                    <option value="Hard">Hard</option>
                    <option value="Deformable">Deformable</option>
                    <option value="Fragile">Fragile</option>
                  </select>
                </div>
              </div>

              {/* 구매 링크는 관리 화면에서만 다룬다 — 대여 화면으로 나가는 응답에는 아예 실리지 않는다.
                  같은 값이 Scenario Manager 오브젝트의 product_link로도 들어간다. */}
              <div style={{ marginBottom: "12px" }}>
                <label style={lblStyle}>구매 링크</label>
                <input
                  value={editing.purchaseLink || ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, purchaseLink: e.target.value } : p))}
                  placeholder="https://..."
                  style={inputStyle}
                />
                <div style={{ fontSize: "10.5px", color: C.label, marginTop: "4px", lineHeight: 1.4 }}>
                  관리자에게만 보입니다. Scenario Manager의 구매 링크에도 같이 저장됩니다.
                </div>
              </div>

              {/* SM의 product_memo. 구매처 특이사항처럼 링크만으로는 안 남는 내용을 적는다. */}
              <div style={{ marginBottom: "12px" }}>
                <label style={lblStyle}>기타 메모</label>
                <input
                  value={editing.productMemo || ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, productMemo: e.target.value } : p))}
                  placeholder="구매처 특이사항 등"
                  style={inputStyle}
                />
                <div style={{ fontSize: "10.5px", color: C.label, marginTop: "4px", lineHeight: 1.4 }}>
                  관리자에게만 보입니다. 등록할 때 Scenario Manager에도 함께 저장됩니다.
                </div>
              </div>

              <div className="sap-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={lblStyle}>카테고리</label>
                    <button type="button" onClick={() => setCatCustom((v) => !v)} style={{ background: "none", border: "none", color: C.accentText, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: "5px" }}>
                      {catCustom ? "목록에서 선택" : "직접 입력"}
                    </button>
                  </div>
                  {catCustom ? (
                    <input value={editing.category || ""} onChange={(e) => setEditing((p) => (p ? { ...p, category: e.target.value } : p))} placeholder="새 카테고리 이름" style={inputStyle} />
                  ) : (
                    <select
                      value={categories.includes(editing.category || "") ? editing.category : ""}
                      onChange={(e) => setEditing((p) => (p ? { ...p, category: e.target.value } : p))}
                      style={inputStyle}
                    >
                      <option value="">선택 안 함</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={lblStyle}>서브카테고리</label>
                    <button type="button" onClick={() => setSubcatCustom((v) => !v)} style={{ background: "none", border: "none", color: C.accentText, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: "5px" }}>
                      {subcatCustom ? "목록에서 선택" : "직접 입력"}
                    </button>
                  </div>
                  {subcatCustom ? (
                    <input value={editing.subcategory || ""} onChange={(e) => setEditing((p) => (p ? { ...p, subcategory: e.target.value } : p))} placeholder="새 서브카테고리 이름" style={inputStyle} />
                  ) : (
                    <select
                      value={subcategoriesForCategory.includes(editing.subcategory || "") ? editing.subcategory : ""}
                      onChange={(e) => setEditing((p) => (p ? { ...p, subcategory: e.target.value } : p))}
                      style={inputStyle}
                    >
                      <option value="">선택 안 함</option>
                      {subcategoriesForCategory.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* 실측 치수 — 선택 입력. 셋 다 채우면 물품 열람·대여 신청에서 "실제 크기 보기"가 뜬다.
                  렌더링은 보는 사람의 브라우저가 하므로 서버에는 숫자 세 개만 저장된다. */}
              <div style={{ marginBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
                  <label style={{ ...lblStyle, marginBottom: 0 }}>실측 크기 (선택)</label>
                  <span style={{ fontSize: "10.5px", color: C.label }}>
                    {hasDims(editing)
                      ? dimsLabel(editing)
                      : (editing.shape || "box") === "cylinder"
                        ? "가로·세로는 밑면 지름입니다"
                        : (editing.shape || "box") === "pyramid"
                          ? "가로·세로는 밑면 크기입니다"
                          : "셋 다 입력하면 미리보기가 나옵니다"}
                  </span>
                </div>
                {/* 형태 — 같은 치수라도 통·뿔이면 차지하는 부피와 생김새가 전혀 다르다. */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                  {(["box", "cylinder", "pyramid"] as ItemShape[]).map((sh) => {
                    const on = (editing.shape || "box") === sh;
                    return (
                      <button
                        key={sh}
                        type="button"
                        onClick={() => setEditing((prev) => (prev ? { ...prev, shape: sh } : prev))}
                        style={{
                          flex: 1, padding: "7px", borderRadius: "8px", cursor: "pointer",
                          fontSize: "11.5px", fontWeight: 700,
                          border: `1px solid ${on ? C.accent : C.border}`,
                          background: on ? C.accentSoft : "transparent",
                          color: on ? C.accentText : C.label,
                        }}
                      >
                        {sh === "box" ? "⬛" : sh === "cylinder" ? "⬤" : "▲"} {SHAPE_LABEL[sh]}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {([["widthMm", "가로"], ["depthMm", "세로"], ["heightMm", "높이"]] as const).map(([key, label]) => (
                    <div key={key}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={(editing as any)[key] ?? ""}
                        onChange={(e) =>
                          setEditing((prev) => {
                            if (!prev) return prev;
                            const raw = e.target.value;
                            const n = Number(raw);
                            // 빈 칸·0·음수는 "값 없음"으로 둔다 — 0mm짜리 물건은 없다.
                            return { ...prev, [key]: raw === "" || !Number.isFinite(n) || n <= 0 ? undefined : n } as any;
                          })
                        }
                        placeholder={label}
                        style={inputStyle}
                      />
                      <div style={{ fontSize: "10px", color: C.label, marginTop: "3px", textAlign: "center" }}>{label} (mm)</div>
                    </div>
                  ))}
                </div>
                {hasDims(editing) ? (
                  <div style={{ marginTop: "8px", borderRadius: "10px", overflow: "hidden", background: "rgba(0,0,0,0.25)", border: `1px solid ${C.border}` }}>
                    <BoxCanvas
                      widthMm={editing.widthMm}
                      depthMm={editing.depthMm}
                      heightMm={editing.heightMm}
                      shape={editing.shape}
                      height={200}
                      accent={C.accentText}
                    />
                  </div>
                ) : null}
              </div>

              <div className="sap-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "4px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={lblStyle}>Sector</label>
                    <button type="button" onClick={() => setSectorCustom((v) => !v)} style={{ background: "none", border: "none", color: C.accentText, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: "5px" }}>
                      {sectorCustom ? "목록에서 선택" : "직접 입력"}
                    </button>
                  </div>
                  {sectorCustom ? (
                    <input value={editing.sector || ""} onChange={(e) => setEditing((p) => (p ? { ...p, sector: e.target.value } : p))} placeholder="예: Seoul-Root" style={inputStyle} />
                  ) : (
                    <select
                      value={sectors.includes(editing.sector || "") ? editing.sector : ""}
                      onChange={(e) => setEditing((p) => (p ? { ...p, sector: e.target.value } : p))}
                      style={inputStyle}
                    >
                      <option value="">선택 안 함</option>
                      {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label style={lblStyle}>재고</label>
                  <input
                    type="number"
                    value={variantDraft.length ? variantTotalStock : (editing.stock ?? 0)}
                    disabled={!isNew || variantDraft.length > 0}
                    onChange={(e) => setEditing((p) => (p ? { ...p, stock: e.target.value === "" ? 0 : Number(e.target.value) } : p))}
                    placeholder="0"
                    title={!isNew ? "등록 후 수량 변경은 '재고 변경'에서만 할 수 있습니다." : undefined}
                    style={{ ...inputStyle, opacity: !isNew || variantDraft.length ? 0.6 : 1, cursor: !isNew ? "not-allowed" : undefined }}
                  />
                </div>
              </div>
              {!isNew ? <div style={{ fontSize: "11px", color: C.label, marginTop: "8px" }}>재고 열에 수식이 걸려 있으면 재고 값은 무시됩니다. 대여 중({editing.rented ?? 0})은 자동 계산됩니다.</div> : null}

              {/* ── 종류(예: 색상·모델 차이) ─────────────────────────────────
                  한 물품 안에서 실물이 갈리는 경우, 여기서 종류를 나누고 종류마다 재고를 잡는다.
                  종류를 하나라도 등록하면 위의 총재고는 종류 재고의 합으로 자동 계산되고,
                  대여 신청 화면에는 종류 선택(+ "상관없음") 옵션이 생긴다. */}
              <div style={{ marginTop: "18px", padding: "14px", borderRadius: "12px", border: `1px solid ${C.border}`, background: isLightMode ? "#f8fafc" : "#0b1220" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                  <label style={{ ...lblStyle, marginBottom: 0 }}>종류 (선택)</label>
                  <span style={{ fontSize: "11px", color: C.label }}>
                    {variantDraft.length ? `합계 ${variantTotalStock}개` : "종류 구분 없음"}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: C.label, lineHeight: 1.6, marginBottom: "10px" }}>
                  같은 물품이지만 실물이 갈리는 경우(예: 색상·모델) 종류를 나눠 재고를 따로 관리합니다.
                  종류를 등록하면 총재고는 종류 재고의 합으로 자동 계산되고, 대여 신청 화면에 종류 선택 옵션이 생깁니다.
                </div>

                {isNew ? (
                  <div style={{ fontSize: "12px", color: C.label }}>물품을 먼저 저장한 뒤 다시 열어 종류를 추가할 수 있습니다.</div>
                ) : (
                  <>
                    {variantDraft.map((v, i) => (
                      <div key={v.id ?? `new-${i}`} style={{ marginBottom: "8px" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        {/* 종류별 사진 — 신청 화면에서 신청자가 이걸 보고 종류를 고른다.
                            파일 업로드와 카메라 촬영을 같은 무게의 버튼으로 나란히 둔다
                            (예전엔 카메라가 작은 글씨 링크라 잘 안 보였다). */}
                        <div
                          onClick={() => { if (v.image) setModalUrl(v.image.startsWith("data:") ? v.image : getGoogleDriveImageUrl(v.image)); }}
                          title={v.image ? "클릭하면 크게 봅니다" : undefined}
                          style={{ width: "44px", height: "44px", flex: "0 0 auto", borderRadius: "9px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: v.image ? "zoom-in" : "default" }}>
                          {v.image
                            ? <img src={v.image.startsWith("data:") ? v.image : getThumbImageUrl(v.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <ImagePlus size={16} style={{ color: C.label }} />}
                        </div>
                        <input
                          id={`sap-variant-photo-${i}`}
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            try {
                              const b64 = await resizeAndCompressImage(f);
                              setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, image: b64 } : x)));
                            } catch (err: any) { showToast(`이미지 처리 실패: ${err.message || err}`, "error"); }
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <input
                            value={v.name}
                            onChange={(e) => setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
                            placeholder="종류 이름 (예: 검정)"
                            style={{ ...inputStyle }}
                          />
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", paddingTop: "5px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => document.getElementById(`sap-variant-photo-${i}`)?.click()}
                              style={{ fontSize: "11px", fontWeight: 700, padding: "4px 9px", borderRadius: "7px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, cursor: "pointer" }}
                            >
                              📁 파일
                            </button>
                            <button
                              type="button"
                              onClick={() => setCameraTarget(i)}
                              title="서버 PC에 연결된 카메라로 이 종류의 사진을 찍습니다"
                              style={{ fontSize: "11px", fontWeight: 700, padding: "4px 9px", borderRadius: "7px", border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accentText, cursor: "pointer" }}
                            >
                              📷 카메라 촬영
                            </button>
                            {v.image ? (
                              <button
                                type="button"
                                onClick={() => setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, image: "" } : x)))}
                                style={{ fontSize: "11px", fontWeight: 600, padding: "4px 8px", borderRadius: "7px", border: "none", background: "none", color: C.error, cursor: "pointer" }}
                              >
                                사진 제거
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <input
                          type="number"
                          value={v.stock}
                          disabled={!!v.id}
                          onChange={(e) => setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, stock: e.target.value === "" ? 0 : Number(e.target.value) } : x)))}
                          placeholder="0"
                          title={v.id ? "기존 종류의 수량은 '재고 변경'에서만 바꿀 수 있습니다." : "새 종류의 최초 재고"}
                          style={{ ...inputStyle, width: "78px", flex: "0 0 auto", opacity: v.id ? 0.6 : 1, cursor: v.id ? "not-allowed" : undefined }}
                        />
                        <span style={{ fontSize: "11px", color: C.label, width: "52px", flex: "0 0 auto" }}>
                          대여 {v.rented ?? 0}
                        </span>
                        <button
                          type="button"
                          disabled={!!v.id && (Number(v.stock) > 0 || Number(v.rented) > 0)}
                          onClick={() => setVariantDraft((p) => p.filter((_, xi) => xi !== i))}
                          title={v.id && (Number(v.stock) > 0 || Number(v.rented) > 0) ? "재고 또는 대여 중 수량이 남은 기존 종류는 삭제할 수 없습니다." : "이 종류 삭제"}
                          style={{ background: "none", border: "none", color: C.error, cursor: v.id && (Number(v.stock) > 0 || Number(v.rented) > 0) ? "not-allowed" : "pointer", opacity: v.id && (Number(v.stock) > 0 || Number(v.rented) > 0) ? 0.35 : 1, padding: "4px", flex: "0 0 auto" }}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      {/* 종류별 실측 치수 — 종류마다 크기가 갈리는 물품(대·중·소 같은)만 쓴다.
                          안 적으면 물품 자체의 치수를 그대로 쓰므로, 대부분의 종류는 건드릴 일이 없다.
                          그래서 기본은 접어 두고 필요한 사람만 펼치게 했다. */}
                      <div style={{ paddingLeft: "52px", marginTop: "5px" }}>
                        <button
                          type="button"
                          onClick={() => setVariantDimsOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                          style={{
                            fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "7px",
                            border: `1px solid ${hasDims(v) ? C.accent : C.border}`,
                            background: hasDims(v) ? C.accentSoft : "transparent",
                            color: hasDims(v) ? C.accentText : C.label, cursor: "pointer",
                          }}
                        >
                          📐 {hasDims(v) ? dimsLabel(v) : "크기 따로 입력"}
                          <span style={{ marginLeft: "5px", opacity: 0.6 }}>{variantDimsOpen[i] ? "▲" : "▼"}</span>
                        </button>

                        {variantDimsOpen[i] ? (
                          <div style={{ marginTop: "7px", padding: "10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub }}>
                            <div style={{ fontSize: "10.5px", color: C.label, lineHeight: 1.6, marginBottom: "8px" }}>
                              비워두면 물품 자체의 치수를 씁니다. 이 종류만 크기가 다를 때 채우세요.
                            </div>
                            <div style={{ display: "flex", gap: "6px", marginBottom: "7px" }}>
                              {(["box", "cylinder", "pyramid"] as ItemShape[]).map((sh) => {
                                const on = (v.shape || "box") === sh;
                                return (
                                  <button
                                    key={sh}
                                    type="button"
                                    onClick={() => setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, shape: sh } : x)))}
                                    style={{
                                      flex: 1, padding: "6px", borderRadius: "7px", cursor: "pointer",
                                      fontSize: "11px", fontWeight: 700,
                                      border: `1px solid ${on ? C.accent : C.border}`,
                                      background: on ? C.accentSoft : "transparent",
                                      color: on ? C.accentText : C.label,
                                    }}
                                  >
                                    {sh === "box" ? "⬛" : sh === "cylinder" ? "⬤" : "▲"} {SHAPE_LABEL[sh]}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                              {([["widthMm", "가로"], ["depthMm", "세로"], ["heightMm", "높이"]] as const).map(([key, label]) => (
                                <div key={key}>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={(v as any)[key] ?? ""}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const n = Number(raw);
                                      // 빈 칸·0·음수는 "값 없음" — 물품 치수로 되돌아간다.
                                      const val = raw === "" || !Number.isFinite(n) || n <= 0 ? undefined : n;
                                      setVariantDraft((p) => p.map((x, xi) => (xi === i ? { ...x, [key]: val } : x)));
                                    }}
                                    placeholder={label}
                                    style={{ ...inputStyle, padding: "7px 9px", fontSize: "12px" }}
                                  />
                                  <div style={{ fontSize: "9.5px", color: C.label, marginTop: "2px", textAlign: "center" }}>{label} (mm)</div>
                                </div>
                              ))}
                            </div>
                            {hasDims(v) ? (
                              <div style={{ marginTop: "8px", borderRadius: "9px", overflow: "hidden", background: "rgba(0,0,0,0.25)", border: `1px solid ${C.border}` }}>
                                <BoxCanvas widthMm={v.widthMm} depthMm={v.depthMm} heightMm={v.heightMm} shape={v.shape} height={150} accent={C.accentText} />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setVariantDraft((p) => [...p, { name: "", stock: 0 }])}
                      style={{ padding: "8px 12px", borderRadius: "9px", border: `1px dashed ${C.border}`, background: "none", color: C.accentText, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                    >
                      + 종류 추가
                    </button>

                    {/* ── 미확인 ────────────────────────────────────────────
                        아직 어느 종류인지 모르는 선반 재고. 종류를 나누기 전에 나갔던 물건이
                        돌아오거나, 등록할 때 배분을 못 한 수량이 여기 쌓인다. 총재고에는
                        포함되지만 대여 화면의 종류 선택지로는 안 보인다. */}
                    {variantDraft.length ? (
                      <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: `1px dashed ${C.border}` }}>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12.5px", fontWeight: 800, color: C.warn }}>미확인</div>
                            <div style={{ fontSize: "10.5px", color: C.label, marginTop: "2px" }}>
                              종류를 아직 모르는 재고 · 대여 중 {editing.unassignedRented ?? 0}개
                            </div>
                          </div>
                          <input
                            type="number"
                            value={unassignedDraft}
                            disabled
                            onChange={(e) => setUnassignedDraft(e.target.value === "" ? 0 : Number(e.target.value))}
                            placeholder="0"
                            title="미확인 수량은 '재고 변경'에서만 바꿀 수 있습니다."
                            style={{ ...inputStyle, width: "78px", flex: "0 0 auto", opacity: 0.6, cursor: "not-allowed" }}
                          />
                          <span style={{ width: "52px", flex: "0 0 auto" }} />
                          <span style={{ width: "24px", flex: "0 0 auto" }} />
                        </div>

                        {/* 배분: 미확인에서 실제 종류로 옮긴다. 저장과 별개로 즉시 반영된다. */}
                        {unassignedDraft > 0 && !isNew ? (
                          <div style={{ marginTop: "10px", padding: "10px", borderRadius: "9px", background: isLightMode ? "#fffbeb" : "#1c1917", border: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: "11px", fontWeight: 700, color: C.label, marginBottom: "8px" }}>
                              실물을 확인했다면 미확인 재고를 종류로 옮기세요.
                            </div>
                            {variantDraft.filter((v) => v.id).map((v) => (
                              <div key={v.id} style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px" }}>
                                <span style={{ flex: 1, fontSize: "12px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {v.name}</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={assignQty[v.id!] ?? ""}
                                  onChange={(e) => setAssignQty((p) => ({ ...p, [v.id!]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                                  placeholder="0"
                                  style={{ ...inputStyle, width: "66px", flex: "0 0 auto", padding: "7px 9px" }}
                                />
                              </div>
                            ))}

                            {/* 입력을 다 마친 뒤 한 번에 옮긴다. 서버가 한 트랜잭션으로 처리하므로
                                일부만 옮겨진 상태가 남지 않는다. */}
                            {(() => {
                              const totalAssign: number = Object.values(assignQty).reduce<number>((n, q) => n + (Number(q) || 0), 0);
                              const over = totalAssign > unassignedDraft;
                              const canMove = totalAssign > 0 && !over && !saving;
                              return (
                                <>
                                  <div style={{ fontSize: "11px", fontWeight: 700, color: over ? C.error : C.label, margin: "8px 0 6px" }}>
                                    합계 {totalAssign} / 미확인 {unassignedDraft}
                                    {over ? " — 미확인 재고보다 많습니다" : ""}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={!canMove}
                                    onClick={async () => {
                                      const items = Object.entries(assignQty)
                                        .map(([vid, q]) => ({ variantId: Number(vid), quantity: Number(q) || 0 }))
                                        .filter((x) => x.quantity > 0);
                                      if (!items.length) return;
                                      try {
                                        const res = await assignUnassignedStock(scriptUrl, editing.id, items);
                                        if (!res?.success) { showToast(res?.message || "배분에 실패했습니다.", "error"); return; }
                                        setVariantDraft((res.variants || []).map((x: any) => ({ id: x.id, name: x.name, stock: x.stock, rented: x.rented, image: x.image })));
                                        setUnassignedDraft(Number(res.item?.unassignedStock) || 0);
                                        setAssignQty({});
                                        setItems((p) => p.map((x) => (x.id === editing.id ? { ...x, ...(res.item || {}), variants: res.variants || [] } : x)));
                                        setEditing((p) => (p ? { ...p, ...(res.item || {}), variants: res.variants || [] } : p));
                                        showToast(`미확인 ${res.moved ?? totalAssign}개를 종류로 옮겼습니다.`, "ok");
                                      } catch (e: any) { showToast(`배분 실패: ${e.message}`, "error"); }
                                    }}
                                    style={{
                                      width: "100%", padding: "10px", borderRadius: "9px", border: "none",
                                      background: canMove ? C.accent : C.border,
                                      color: canMove ? "#fff" : C.label,
                                      cursor: canMove ? "pointer" : "not-allowed", fontSize: "12.5px", fontWeight: 800,
                                    }}
                                  >
                                    옮기기
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: C.text }}>
                  <input
                    type="checkbox"
                    checked={!!editing.excludeFromRanking}
                    onChange={(e) => setEditing((p) => (p ? { ...p, excludeFromRanking: e.target.checked } : p))}
                    style={{ width: 16, height: 16, accentColor: C.accent }}
                  />
                  "가장 적게 대여된 물품" 랭킹에서 이 물품 제외
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: editing.fragile ? C.warn : C.text }}>
                  <input
                    type="checkbox"
                    checked={!!editing.fragile}
                    onChange={(e) => setEditing((p) => (p ? { ...p, fragile: e.target.checked } : p))}
                    style={{ width: 16, height: 16, accentColor: C.warn }}
                  />
                  🔺 깨질 위험이 있는 물품
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: editing.fireRisk ? C.error : C.text }}>
                  <input
                    type="checkbox"
                    checked={!!editing.fireRisk}
                    onChange={(e) => setEditing((p) => (p ? { ...p, fireRisk: e.target.checked } : p))}
                    style={{ width: 16, height: 16, accentColor: C.error }}
                  />
                  🔥 화재 위험이 있는 물품
                </label>

                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: editing.personalOwner !== undefined ? C.accentText : C.text }}>
                    <input
                      type="checkbox"
                      // undefined = 체크 안 함 / "" 이상 문자열 = 체크됨 (빈 값이어도 "체크는 됐지만 소유자명 미입력" 상태로 구분)
                      checked={editing.personalOwner !== undefined}
                      onChange={(e) => setEditing((p) => (p ? { ...p, personalOwner: e.target.checked ? "" : undefined } : p))}
                      style={{ width: 16, height: 16, accentColor: C.accent }}
                    />
                    👤 개인 물품
                  </label>
                  {editing.personalOwner !== undefined ? (
                    <input
                      value={editing.personalOwner}
                      onChange={(e) => setEditing((p) => (p ? { ...p, personalOwner: e.target.value } : p))}
                      placeholder="소유자 이름을 입력하세요"
                      style={{ ...inputStyle, marginTop: "8px" }}
                    />
                  ) : null}
                </div>

                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: editing.requestFor !== undefined ? C.accentText : C.text }}>
                    <input
                      type="checkbox"
                      // undefined = 체크 안 함 / "" 이상 문자열 = 체크됨 (빈 값이어도 "체크는 됐지만 업체명 미입력" 상태로 구분)
                      checked={editing.requestFor !== undefined}
                      onChange={(e) => setEditing((p) => (p ? { ...p, requestFor: e.target.checked ? "" : undefined } : p))}
                      style={{ width: 16, height: 16, accentColor: C.accent }}
                    />
                    📌 특정 업체 request용 물품
                  </label>
                  {editing.requestFor !== undefined ? (
                    <input
                      value={editing.requestFor}
                      onChange={(e) => setEditing((p) => (p ? { ...p, requestFor: e.target.value } : p))}
                      placeholder="업체명을 입력하세요 (예: OO전자)"
                      style={{ ...inputStyle, marginTop: "8px" }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px", position: "sticky", bottom: 0, background: C.card }}>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>취소</button>
              <button onClick={save} disabled={saving || uploading} style={{ flex: 2, padding: "13px", borderRadius: "11px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", opacity: saving || uploading ? 0.7 : 1 }}>
                {saving ? <><Spinner size={15} /> 저장 중...</> : <><Save size={15} /> {isNew ? "추가하기" : "저장하기"}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 오브젝트 상세 모달 (오브젝트 클릭 시 — 대여 현황 / 재고 실사) */}
      {borrowersItem ? createPortal(
        <div className="sap-root" onClick={() => setBorrowersItem(null)} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "14px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px 12px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0 }}>{borrowersItem.name}</h2>
                <div style={{ fontSize: "12px", color: C.label, marginTop: "3px" }}><ScenarioManagerObjectLink id={borrowersItem.id} color={C.label}>ID: {borrowersItem.id}</ScenarioManagerObjectLink> · 재고 {borrowersItem.stock} · 대여 중 {borrowersItem.rented}</div>
              </div>
              <button
                onClick={() => {
                  if (detailTab === "borrowers") { if (!unreturnedLoading) loadUnreturned(); }
                  else if (detailTab === "audit") { if (!auditLoading) loadAuditHistory(borrowersItem.id); }
                  else { if (!historyLoading) loadHistory(borrowersItem.id); }
                }}
                disabled={detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading}
                title="새로고침"
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: (detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? "default" : "pointer", opacity: (detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? 0.6 : 1, fontSize: "11px", fontWeight: 700 }}
              >
                <style>{`@keyframes sapSpinBtn { to { transform: rotate(360deg); } } .sap-spin-btn { animation: sapSpinBtn 0.9s linear infinite; }`}</style>
                <RotateCcw size={13} className={(detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? "sap-spin-btn" : undefined} />
              </button>
              <button onClick={() => setBorrowersItem(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* 탭 */}
            <div style={{ display: "flex", gap: "4px", padding: "10px 20px 0", borderBottom: `1px solid ${C.border}`, position: "sticky", top: "69px", background: C.card, zIndex: 1 }}>
              {[
                { key: "borrowers" as const, label: "대여 현황", icon: <Users size={13} /> },
                { key: "history" as const, label: "전체 이력", icon: <History size={13} /> },
                { key: "audit" as const, label: "재고 실사", icon: <ClipboardCheck size={13} /> },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px", padding: "9px 14px",
                    border: "none", borderBottom: detailTab === t.key ? `2px solid ${C.accent}` : "2px solid transparent",
                    background: "none", color: detailTab === t.key ? C.accentText : C.label,
                    fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div style={{ padding: "16px 20px" }}>
              {detailTab === "borrowers" ? (
                !unreturnedLoaded ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={26} /> 대여 현황을 불러오는 중...</div>
                ) : borrowersForItem.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "13px" }}>현재 이 물품을 대여 중인 사람이 없습니다.</div>
                ) : (
                  <>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                      총 <b style={{ color: C.accentText }}>{borrowersForItem.reduce((s, u) => s + (u.quantity || 1), 0)}개</b>가 <b style={{ color: C.accentText }}>{new Set(borrowersForItem.map((u) => u.borrowerName)).size}명</b>에게 대여 중
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {borrowersForItem.map((u, idx) => (
                        <div
                          key={`${u.sheetType}-${u.rowIndex}-${idx}`}
                          onClick={() => openBatchDetail(u.batchId || "", `${u.borrowerName || "대여자 미상"} · ${u.borrowDate || ""}`)}
                          title="이 신청 묶음에 무엇이 함께 나갔는지 보기"
                          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px", cursor: u.batchId ? "pointer" : "default" }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.borrowerName || "(대여자 미상)"}</span>
                              {u.floor || u.unit ? (
                                <span style={{ fontSize: "10.5px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "2px 8px", flexShrink: 0 }}>
                                  {[u.floor, u.unit].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: "11px", color: C.label, marginTop: "2px", display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                              <span>{u.sheetType === "scenario" ? `SID 대여${u.scenarioId ? ` (${u.scenarioId})` : ""}` : "일반 대여"}</span>
                              <span>·</span>
                              <span>{u.borrowDate || "-"}</span>
                            </div>
                          </div>
                          <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px", flexShrink: 0 }}>{u.quantity || 1}개</span>
                          {u.batchId ? <ChevronRight size={15} style={{ color: C.label, flexShrink: 0 }} /> : null}
                        </div>
                      ))}
                    </div>
                  </>
                )
              ) : detailTab === "history" ? (
                historyLoading && historyLoadedForId !== borrowersItem.id ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={26} /> 대여·반납 기록을 불러오는 중...</div>
                ) : historyLogs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "13px" }}>이 물품의 대여·반납 기록이 없습니다.</div>
                ) : (
                  <>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                      총 <b style={{ color: C.accentText }}>{historyLogs.length}건</b>의 기록 (최신순)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {[...historyLogs]
                        .sort((a, b) => {
                          const ta = new Date((a.returnDate || a.borrowDate || "").replace(" ", "T")).getTime();
                          const tb = new Date((b.returnDate || b.borrowDate || "").replace(" ", "T")).getTime();
                          return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
                        })
                        .map((l, idx) => (
                          <div
                            key={`${l.sheetType}-${l.rowIndex}-${idx}`}
                            onClick={() => openBatchDetail(l.batchId || "", `${l.borrowerName || "대여자 미상"} · ${l.returned ? `반납 ${l.returnDate || ""}` : `대여 ${l.borrowDate || ""}`}`)}
                            title="이 신청 묶음에 무엇이 함께 나갔는지 보기"
                            style={{ padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px", cursor: l.batchId ? "pointer" : "default" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.borrowerName || "(대여자 미상)"}</span>
                                  {l.floor || l.unit ? (
                                    <span style={{ fontSize: "10.5px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "2px 8px", flexShrink: 0 }}>
                                      {[l.floor, l.unit].filter(Boolean).join(" · ")}
                                    </span>
                                  ) : null}
                                </div>
                                <div style={{ fontSize: "11px", color: C.label, marginTop: "2px", display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                                  <span>{l.sheetType === "scenario" ? `SID 대여${l.scenarioId ? ` (${l.scenarioId})` : ""}` : "일반 대여"}</span>
                                  {/* 같은 물품이라도 어떤 종류를 빌려갔는지 이력에서 구분되게 한다 */}
                                  {l.variantName ? (
                                    <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33` }}>
                                      {l.variantName}
                                    </span>
                                  ) : l.variantPending ? (
                                    <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", background: C.warnSoft, color: C.warn, border: `1px solid ${C.warn}55` }}>
                                      종류 미정
                                    </span>
                                  ) : null}
                                  <span>·</span>
                                  <span>대여 {l.borrowDate || "-"}</span>
                                </div>
                              </div>
                              <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px", flexShrink: 0 }}>{l.quantity || 1}개</span>
                              <span
                                style={{
                                  fontSize: "10.5px", fontWeight: 800, borderRadius: "999px", padding: "2px 9px", flexShrink: 0,
                                  color: l.returned ? C.success : C.warn,
                                  background: l.returned ? C.successSoft : C.warnSoft,
                                }}
                              >
                                {l.returned ? "반납 완료" : "미반납"}
                              </span>
                            </div>
                            {l.returned && l.returnDate ? (
                              <div style={{ fontSize: "11px", color: C.label, marginTop: "5px" }}>반납 {l.returnDate}</div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                    {!historyFullyLoaded ? (
                      <button
                        onClick={() => loadHistory(borrowersItem.id, true)}
                        disabled={historyLoadingMore}
                        style={{ width: "100%", marginTop: "10px", padding: "10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: historyLoadingMore ? "default" : "pointer", fontSize: "12.5px", fontWeight: 700 }}
                      >
                        {historyLoadingMore ? "불러오는 중..." : `이전 기록 더 보기 (최근 ${HISTORY_RECENT_DAYS}일 이전)`}
                      </button>
                    ) : null}
                  </>
                )
              ) : (
                <>
                  {/* 실사 입력 */}
                  <div style={{ padding: "14px", background: C.cardSub, borderRadius: "12px", border: `1px solid ${C.border}`, marginBottom: "16px" }}>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px", lineHeight: 1.6 }}>
                      현재 시스템 재고는 <b style={{ color: C.accentText }}>{borrowersItem.stock}개</b>입니다. 실제로 세어본 수량을 입력해 기록하세요.
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      <input
                        type="number"
                        min={0}
                        value={auditCountInput}
                        onChange={(e) => setAuditCountInput(e.target.value)}
                        placeholder="실사 수량"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        onClick={submitAudit}
                        disabled={auditSubmitting || auditCountInput.trim() === ""}
                        style={{ padding: "0 18px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, opacity: auditSubmitting || auditCountInput.trim() === "" ? 0.6 : 1, whiteSpace: "nowrap" }}
                      >
                        {auditSubmitting ? "기록 중..." : "기록하기"}
                      </button>
                    </div>
                    {auditCountInput.trim() !== "" && !isNaN(parseInt(auditCountInput, 10)) ? (
                      (() => {
                        const diff = parseInt(auditCountInput, 10) - (borrowersItem.stock || 0);
                        return diff !== 0 ? (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: diff > 0 ? C.success : C.error }}>
                            시스템 대비 {diff > 0 ? `+${diff}` : diff}개 차이
                          </div>
                        ) : (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: C.label }}>시스템 재고와 일치합니다.</div>
                        );
                      })()
                    ) : null}
                    <input
                      value={auditNote}
                      onChange={(e) => setAuditNote(e.target.value)}
                      placeholder="메모 (선택 — 예: 창고 B구역 실사, 파손 3개 확인 등)"
                      style={{ ...inputStyle, marginTop: "8px", fontSize: "12px" }}
                    />
                  </div>

                  {/* 실사 이력 */}
                  {auditLoading && auditLoadedForId !== borrowersItem.id ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "24px 0", color: C.label }}><Spinner size={24} /> 실사 이력을 불러오는 중...</div>
                  ) : auditHistory.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "13px" }}>이 물품의 실사 기록이 아직 없습니다.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {auditHistory.map((a, idx) => (
                        <div key={idx} style={{ padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "11px", color: C.label }}>{a.auditedAt}{a.auditor ? ` · ${a.auditor}` : ""}</span>
                            <span style={{ fontSize: "12px", fontWeight: 800, color: a.diff === 0 ? C.label : a.diff > 0 ? C.success : C.error }}>
                              {a.diff === 0 ? "일치" : a.diff > 0 ? `+${a.diff}` : a.diff}
                            </span>
                          </div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, marginTop: "4px" }}>
                            실사 {a.actualCount}개 <span style={{ color: C.label, fontWeight: 400 }}>(당시 시스템 재고 {a.systemStock}개)</span>
                          </div>
                          {a.note ? <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>{a.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 진단: 왜 차이가 발생했는지 기록으로 추측 */}
                  <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: `1px dashed ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: "5px" }}>
                        <Search size={13} style={{ color: C.accentText }} /> 원인 진단
                      </div>
                      <button
                        onClick={runDiagnosis}
                        disabled={diagnosing}
                        style={{ padding: "6px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: diagnosing ? "default" : "pointer", fontSize: "11px", fontWeight: 700, opacity: diagnosing ? 0.6 : 1 }}
                      >
                        {diagnosing ? "분석 중..." : diagnosedForId === borrowersItem.id ? "다시 진단" : "진단하기"}
                      </button>
                    </div>

                    {!diagnosis ? (
                      <div style={{ fontSize: "12px", color: C.label, lineHeight: 1.6 }}>
                        지금까지의 대여·반납 기록과 실사 이력을 대조해서, 불일치가 왜 발생했을지 단서를 찾아드립니다. (확정적인 원인이 아니라 참고용 추정입니다.)
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {formulaStatus?.stockIsFormula ? (
                          <div style={{ padding: "10px 12px", background: C.errorSoft, borderRadius: "10px", fontSize: "12px", color: C.error, lineHeight: 1.6 }}>
                            <b>이 물품의 '재고' 값은 수식으로 계산되고 있습니다.</b> 대여/반납이 발생해도 스크립트가 자동으로 값을 갱신하지 않으므로, 수식이 실제 흐름을 반영하지 못하면 실사와 어긋날 수 있습니다.
                          </div>
                        ) : null}

                        {diagnosis.windows.filter((w) => w.mismatch !== 0).length > 0 ? (
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>기록에 안 잡히는 변동이 있는 구간</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {diagnosis.windows.filter((w) => w.mismatch !== 0).map((w, i) => (
                                <div key={i} style={{ padding: "9px 11px", background: C.warnSoft, borderRadius: "9px", fontSize: "11.5px", color: C.text, lineHeight: 1.6 }}>
                                  <b>{w.from} ~ {w.to}</b>: 이 구간에 대여 {w.borrowCount}건 · 반납 {w.returnCount}건이 로그에 기록되어 예상 변화는 {w.expected >= 0 ? `+${w.expected}` : w.expected}개였지만, 실제 시스템 재고는 {w.actual >= 0 ? `+${w.actual}` : w.actual}개 변동했습니다.
                                  {" "}차이 <b style={{ color: C.error }}>{w.mismatch >= 0 ? `+${w.mismatch}` : w.mismatch}개</b> — 로그에 남지 않은 변동(수동 재고 수정, 대여 로그에 없는 실물 이동, 반납 처리 누락 등)이 있었을 가능성이 있습니다.
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {diagnosis.overdue.length > 0 ? (
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>장기 미반납 (분실 의심)</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {diagnosis.overdue.map((u, i) => (
                                <div key={i} style={{ padding: "9px 11px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "9px", fontSize: "11.5px", color: C.text }}>
                                  <b>{u.borrowerName || "(대여자 미상)"}</b>가 {u.borrowDate}에 {u.quantity || 1}개 대여 — <span style={{ color: C.warn, fontWeight: 700 }}>{u.days}일째 미반납</span>. 실물이 사라졌거나 반납 처리를 놓쳤을 수 있습니다.
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {!diagnosis.hasIssue ? (
                          <div style={{ fontSize: "12px", color: C.label, lineHeight: 1.6 }}>
                            기록 기준으로는 뚜렷한 이상 신호가 없습니다. 데이터 입력 실수(수량 오기입), 실물 카운트 오차, 또는 아직 실사 기록이 부족해서 비교할 구간이 없을 가능성이 있습니다.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 이미지 확대 */}
      {/* 신청 묶음 상세 */}
      {batchDetail ? createPortal(
        <div
          onClick={() => setBatchDetail(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4200, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "82vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <Boxes size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, color: C.text, flex: 1 }}>이 신청에 함께 나간 물품</span>
              <button onClick={() => setBatchDetail(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>{batchDetail.title}</div>

            {batchLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={24} /> 불러오는 중...</div>
            ) : batchDetail.items.length === 0 ? (
              <div style={{ textAlign: "center", padding: "28px 0", color: C.label, fontSize: "13px" }}>이 묶음에서 기록을 찾지 못했습니다.</div>
            ) : (
              <>
                <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                  총 <b style={{ color: C.accentText }}>{batchDetail.items.length}종</b> ·{" "}
                  <b style={{ color: C.accentText }}>{batchDetail.items.reduce((n, x) => n + (x.quantity || 1), 0)}개</b>
                  {" · "}반납 완료 {batchDetail.items.filter((x) => x.returned).length}건
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {batchDetail.items.map((x, i) => (
                    <div
                      key={`${x.sheetType}-${x.rowIndex}-${i}`}
                      style={{
                        display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                        background: C.cardSub, borderRadius: "10px",
                        border: `1px solid ${x.returned ? C.border : `${C.warn}55`}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {x.itemName || x.itemLabel}
                          {/* 같은 물품이라도 어떤 종류를 빌려갔는지 구분되게 한다 */}
                          {x.variantName ? (
                            <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", marginLeft: "5px", background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33` }}>
                              {x.variantName}
                            </span>
                          ) : x.variantPending ? (
                            <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", marginLeft: "5px", background: C.warnSoft, color: C.warn, border: `1px solid ${C.warn}55` }}>
                              종류 미정
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: "11px", color: C.label, marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {x.itemId ? <span style={{ fontFamily: "monospace" }}>{x.itemId}</span> : null}
                          {x.location ? <span>📍 {x.location}</span> : null}
                          {x.itemKind ? <span>· {x.itemKind}</span> : null}
                        </div>
                        <div style={{ fontSize: "10.5px", color: C.label, marginTop: "3px" }}>
                          대여 {x.borrowDate || "-"}{x.returned && x.returnDate ? ` · 반납 ${x.returnDate}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 800, borderRadius: "999px", padding: "3px 10px", flexShrink: 0, color: x.returned ? C.success : C.warn, background: x.returned ? C.successSoft : C.warnSoft }}>
                        {x.returned ? "반납 완료" : "미반납"}
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>{x.quantity || 1}개</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      ) : null}

      {modalUrl ? createPortal(
        <ImageZoomModal url={modalUrl} onClose={() => setModalUrl("")} />,
        document.body
      ) : null}

      {/* 대여중 불일치 검사 모달 */}
      {mismatchOpen ? createPortal(
        <div
          onClick={() => setMismatchOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 2600, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "82vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <ShieldAlert size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, color: C.text, flex: 1 }}>대여중 불일치 검사</span>
              <button
                onClick={() => loadUnreturned()}
                disabled={unreturnedLoading}
                title="다시 스캔"
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: unreturnedLoading ? "default" : "pointer" }}
              >
                <RotateCcw size={14} className={unreturnedLoading ? "sap-spin-btn2" : undefined} />
              </button>
              <button onClick={() => setMismatchOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>
              모든 시나리오 물품에 기록된 "대여중" 수량과, 실제 미반납 건을 합산한 수량을 비교합니다. 다른 물품을 클릭하면 바로 재고/대여중을 고칠 수 있습니다.
            </div>

            {unreturnedLoading && !unreturnedLoaded ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={26} /> 전체 물품을 스캔하는 중...</div>
            ) : rentedMismatches.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "13px" }}>
                <ClipboardCheck size={26} style={{ marginBottom: "8px", color: C.success }} /><br />
                불일치가 없습니다. 기록과 실제 대여 현황이 일치합니다.
              </div>
            ) : (
              <>
                <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                  총 <b style={{ color: C.accentText }}>{items.length}개</b> 중 <b style={{ color: C.error }}>{rentedMismatches.length}개</b> 불일치
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {rentedMismatches.map(({ item, actual, recorded }) => (
                    <div
                      key={item.rowIndex}
                      onClick={() => { setStockAdjustItem(item); }}
                      title="클릭해서 재고/대여중 수정"
                      style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.error}55`, borderRadius: "10px", cursor: "pointer" }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {item.name}{item.archived ? " (보관함)" : ""}
                        </div>
                        <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                          ID {item.id} · 위치 {item.rootSlot || "-"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: "11.5px", color: C.label }}>기록 {recorded}개 · 실제 {actual}개</div>
                        <div style={{ fontSize: "12px", fontWeight: 800, color: C.error }}>{actual > recorded ? `+${actual - recorded}` : actual - recorded}</div>
                      </div>
                      <ChevronRight size={15} style={{ color: C.label, flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      ) : null}

      {/* 재고 변경 모달 (시나리오 물품) */}
      {stockAdjustItem && (
        <StockAdjustModal
          scriptUrl={scriptUrl}
          connected={connected}
          isLightMode={isLightMode}
          category="scenario"
          rowIndex={stockAdjustItem.rowIndex}
          itemId={stockAdjustItem.id}
          itemLabel={stockAdjustItem.name}
          currentStock={stockAdjustItem.stock || 0}
          currentRented={stockAdjustItem.rented || 0}
          variants={stockAdjustItem.variants as any}
          unassignedStock={Number(stockAdjustItem.unassignedStock) || 0}
          showToast={showToast}
          onClose={() => setStockAdjustItem(null)}
          onSaved={(newStock, newRented) => {
            setItems((prev) => prev.map((it) => (it.rowIndex === stockAdjustItem.rowIndex
              ? { ...it, stock: newStock, ...(newRented !== undefined ? { rented: newRented } : {}) }
              : it)));
          }}
        />
      )}
      <CameraCaptureModal
        open={cameraTarget !== null}
        onClose={() => setCameraTarget(null)}
        onCapture={(dataUrl) => {
          if (cameraTarget === "item") setEditing((p) => (p ? { ...p, image: dataUrl } : p));
          else if (typeof cameraTarget === "number") {
            setVariantDraft((p) => p.map((x, xi) => (xi === cameraTarget ? { ...x, image: dataUrl } : x)));
          }
        }}
        title={cameraTarget === "item" ? "물품 사진 촬영" : "종류 사진 촬영"}
        isLightMode={isLightMode}
      />

      <ScrollToTopButton />
    </div>
  );
}
