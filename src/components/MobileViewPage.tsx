import React, { useState, useMemo, useEffect, useRef } from "react";
import { InventoryItem, RentLog, DefectLog, Rack, WmsUser } from "../types";
import {
  ArrowLeft,
  Search,
  X,
  Package,
  Sun,
  Moon,
  Minus,
  Plus,
  MapPin,
  ChevronRight,
  Check,
  ImageOff,
  User,
  Clock,
  AlertTriangle,
  ClipboardList,
  Camera,
  Upload,
} from "lucide-react";
import { getGoogleDriveImageUrl, isFuzzyMatch, formatTimestampLocal, resizeAndCompressImage } from "../utils/drive";
import { parseDateString, compareDatesDescending } from "../utils/date";
import { compareRackSlot } from "../utils/borrowApi";

interface MobileViewPageProps {
  inventory: InventoryItem[];
  rentLogs: RentLog[];
  defectLogs?: DefectLog[];
  racks?: Rack[];
  isAdmin?: boolean;
  onOpenScenario?: () => void;
  currentUser?: WmsUser | null;
  onAddRentLog: (log: RentLog) => Promise<void>;
  onAddDefectLog?: (log: Omit<DefectLog, "rowIndex">) => Promise<void>;
  onSaveInventoryItem?: (item: Omit<InventoryItem, "rowIndex"> & { rowIndex?: number }) => Promise<void>;
  onBack: () => void;
  isLightMode: boolean;
  toggleLightMode: () => void;
  connected: boolean;
  currentView?: "landing" | "login" | "rental" | "monitor" | "defect" | "rent";
}

type Mode = "대여" | "반납" | "등록" | "불량";
type SheetMode = "detail" | "form" | "edit-inventory" | null;

interface OutstandingRental {
  key: string;
  name: string;
  location: string;
  user: string;
  qty: number;
  lastTimestamp: string;
}

/**
 * 모바일 전용 "열람용 모드" 화면.
 * PC 화면을 그대로 축소한 것이 아니라, 맨 위의 [대여]/[반납] 두 버튼으로 모드를 고른 뒤
 * - 대여: 전체 품목을 검색/열람하며 바로 대여
 * - 반납: 지금까지 대여했지만 아직 반납되지 않은 물품만 모아서 보여주고 바로 반납
 * 흐름에만 집중한 터치 친화적 UI. 불량로그, 랙 위치도(모니터링)는 노출하지 않는다.
 */
export default function MobileViewPage({
  inventory,
  rentLogs,
  defectLogs = [],
  racks = [],
  isAdmin = false,
  onOpenScenario,
  currentUser = null,
  onAddRentLog,
  onAddDefectLog,
  onSaveInventoryItem,
  onBack,
  isLightMode,
  toggleLightMode,
  connected,
  currentView = "monitor",
}: MobileViewPageProps) {
  const [mode, setMode] = useState<Mode>("대여");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [outstandingContext, setOutstandingContext] = useState<OutstandingRental | null>(null);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);

  // 대여 / 반납 일반 폼 상태
  const [formUser, setFormUser] = useState("");
  const [formQty, setFormQty] = useState(1);
  const [formNote, setFormNote] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Current logged in user name or default
  const defaultManagerName = currentUser ? (currentUser.name || currentUser.id) : "관리자";

  // --- 모바일 품목 등록(등록 탭) 폼 상태 ---
  const [regName, setRegName] = useState("");
  const [regRackId, setRegRackId] = useState(racks[0]?.id || "");
  const [regShelf, setRegShelf] = useState("");
  const [regCustomLocation, setRegCustomLocation] = useState("");
  const [regIsCustomLoc, setRegIsCustomLoc] = useState(false);
  const [regSpec, setRegSpec] = useState("");
  const [regStock, setRegStock] = useState<string>("0");
  const [regManager, setRegManager] = useState(defaultManagerName);
  const [regNote, setRegNote] = useState("");
  const [regPhoto, setRegPhoto] = useState("");
  const [regLink, setRegLink] = useState("N/A");
  const [regSubmitting, setRegSubmitting] = useState(false);

  // --- 모바일 불량(불량 탭) 폼 상태 ---
  const [defectTab, setDefectTab] = useState<"list" | "register">("list");
  const [defSelectedInvIndex, setDefSelectedInvIndex] = useState<number>(-1); // -1: 직접 입력
  const [defCustomName, setDefCustomName] = useState("");
  const [defCustomLoc, setDefCustomLoc] = useState("");
  const [defQty, setDefQty] = useState(1);
  const [defType, setDefType] = useState("파손");
  const [defManager, setDefManager] = useState(defaultManagerName);
  const [defNote, setDefNote] = useState("");
  const [defActionTaken, setDefActionTaken] = useState("폐기 대기");
  const [defPhoto, setDefPhoto] = useState("");
  const [defectSubmitting, setDefectSubmitting] = useState(false);

  // --- 이미지 업로드 상태 및 헬퍼 ---
  const [isRegUploadingImage, setIsRegUploadingImage] = useState(false);
  const [isDefUploadingImage, setIsDefUploadingImage] = useState(false);

  // 바텀시트가 열려 있는 동안 뒤쪽 본문이 스크롤되지 않도록 body 스크롤을 잠근다.
  // (모바일에서 시트/키보드가 뜰 때 배경이 아래로 밀려 내려가는 문제 방지)
  useEffect(() => {
    if (sheetMode) {
      const prevOverflow = document.body.style.overflow;
      const prevPosition = document.body.style.position;
      const prevWidth = document.body.style.width;
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.top = `-${scrollY}px`;
      return () => {
        document.body.style.overflow = prevOverflow;
        document.body.style.position = prevPosition;
        document.body.style.width = prevWidth;
        document.body.style.top = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [sheetMode]);

  const handleRegPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsRegUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setRegPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsRegUploadingImage(false);
    }
  };

  const handleDefPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsDefUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setDefPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsDefUploadingImage(false);
    }
  };

  // --- 인라인 품목 수정(edit-inventory) 폼 상태 (Admin 전용) ---
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLink, setEditLink] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [editStock, setEditStock] = useState<string>("0");
  const [editSpec, setEditSpec] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editManager, setEditManager] = useState(defaultManagerName);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [isEditUploadingImage, setIsEditUploadingImage] = useState(false);

  const handleEditPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsEditUploadingImage(true);
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setEditPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsEditUploadingImage(false);
    }
  };

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<{ msg: string; type: "ok" | "error" | "warn" } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (msg: string, type: "ok" | "error" | "warn" = "ok") => {
    setLocalToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLocalToast(null), 2400);
  };

  // Sync manager states when currentUser changes
  useEffect(() => {
    if (currentUser) {
      const name = currentUser.name || currentUser.id;
      setRegManager(name);
      setDefManager(name);
      setEditManager(name);
    }
  }, [currentUser]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ---------- 색상 토큰 (기존 데스크탑 배색과 동일하게 유지) ----------
  const ACCENT = "#4f46e5";
  const ACCENT_LIGHT = "#818cf8";
  const GREEN = "#10b981";
  const GREEN_LIGHT = "#34d399";
  const DANGER = "#ef4444";
  const AMBER = "#f59e0b";
  const BG = isLightMode ? "#f8fafc" : "#0b0f19";
  const HEADER_BG = isLightMode ? "#ffffff" : "#151d30";
  const CARD_BG = isLightMode ? "#ffffff" : "#151d30";
  const BORDER = isLightMode ? "#e2e8f0" : "#222f4b";
  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const MODE_COLOR = mode === "대여" ? ACCENT : mode === "반납" ? GREEN : mode === "등록" ? "#6366f1" : AMBER;
  const MODE_COLOR_LIGHT = mode === "대여" ? ACCENT_LIGHT : mode === "반납" ? GREEN_LIGHT : mode === "등록" ? "#818cf8" : "#fbbf24";

  // ---------- 대여 가능 여부: 숫자 재고가 0 이하일 때만 차단, N/A(문자/없음)는 항상 대여 가능 ----------
  const isRentDisabled = (item: InventoryItem) =>
    typeof item.stock === "number" && item.stock <= 0;

  // ---------- 대여 탭: 전체 재고 검색 (랙 순서 정렬) ----------
  const filteredInventory = useMemo(() => {
    const base = !searchQuery.trim() ? inventory : inventory.filter(
      (item) =>
        isFuzzyMatch(item.name || "", searchQuery) ||
        isFuzzyMatch(item.location || "", searchQuery) ||
        (item.spec && isFuzzyMatch(item.spec, searchQuery))
    );
    return [...base].sort((a, b) => compareRackSlot(a.location, b.location));
  }, [inventory, searchQuery]);

  // ---------- 불량 탭: 불량 로그 검색 ----------
  const filteredDefectLogs = useMemo(() => {
    if (!searchQuery.trim()) return defectLogs;
    return defectLogs.filter(
      (log) =>
        isFuzzyMatch(log.name || "", searchQuery) ||
        isFuzzyMatch(log.defectType || "", searchQuery) ||
        isFuzzyMatch(log.note || "", searchQuery) ||
        isFuzzyMatch(log.actionTaken || "", searchQuery) ||
        isFuzzyMatch(log.manager || "", searchQuery)
    );
  }, [defectLogs, searchQuery]);

  // ---------- 반납 탭: 아직 반납되지 않은(미반납) 대여 내역 집계 ----------
  const outstandingRentals = useMemo(() => {
    const map = new Map<string, OutstandingRental>();
    for (const log of rentLogs) {
      const name = (log.name || "").trim();
      const location = (log.location || "").trim();
      const user = (log.user || "").trim();
      if (!name) continue;
      const key = `${name}||${location}||${user}`;
      const qtyNum = Number(log.qty) || 0;
      const note = String(log.note || "");
      const isConsumeNote = note.indexOf("[소모완료]") !== -1 || note.indexOf("[즉시반납]") !== -1;
      // 소모는 반납 대상이 아님: 대여량 집계에서 제외. 소모완료 note가 붙은 반납은 대여 차감.
      let delta = 0;
      if (log.type === "소모") delta = 0;
      else if (log.type === "반납" || isConsumeNote) delta = -qtyNum;
      else delta = qtyNum;
      const existing = map.get(key);
      if (existing) {
        existing.qty += delta;
        const logTime = parseDateString(log.timestamp || "");
        const existingTime = parseDateString(existing.lastTimestamp);
        if (logTime > existingTime) {
          existing.lastTimestamp = log.timestamp || "";
        }
      } else {
        map.set(key, { key, name, location, user, qty: delta, lastTimestamp: log.timestamp || "" });
      }
    }
    return Array.from(map.values())
      .filter((o) => o.qty > 0)
      .sort((a, b) => compareDatesDescending(a.lastTimestamp, b.lastTimestamp));
  }, [rentLogs]);

  const filteredOutstanding = useMemo(() => {
    if (!searchQuery.trim()) return outstandingRentals;
    return outstandingRentals.filter(
      (o) =>
        isFuzzyMatch(o.name, searchQuery) ||
        isFuzzyMatch(o.location, searchQuery) ||
        isFuzzyMatch(o.user, searchQuery)
    );
  }, [outstandingRentals, searchQuery]);

  // ---------- URL Hash Synchronization for Mobile View ----------
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash || "";
      const parts = hash.split("/");
      if (parts.length < 2) return;

      const mainPath = parts[1]; // "monitor", "rent", "defect", "register"
      const subPath = parts[2] as SheetMode || null; // "detail", "form", "edit-inventory" or null

      // Sync tab mode
      if (mainPath === "monitor") {
        setMode("대여");
      } else if (mainPath === "rent") {
        setMode("반납");
      } else if (mainPath === "defect") {
        setMode("불량");
      } else if (mainPath === "register") {
        setMode("등록");
      }

      // Sync sheet mode
      setSheetMode(subPath);

      // If there's no sheet mode, clear active selected item
      if (!subPath) {
        setSelectedItem(null);
        setOutstandingContext(null);
      }
    };

    window.addEventListener("hashchange", syncFromHash);
    syncFromHash(); // Initial load sync

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  const switchMode = (m: Mode) => {
    setSearchQuery("");
    if (m === "대여") {
      window.location.hash = "#/monitor";
    } else if (m === "반납") {
      window.location.hash = "#/rent";
    } else if (m === "불량") {
      window.location.hash = "#/defect";
    } else if (m === "등록") {
      window.location.hash = "#/register";
    }
  };

  // ---------- 대여 탭에서 품목 탭 ----------
  const openItemDetail = (item: InventoryItem) => {
    setSelectedItem(item);
    setOutstandingContext(null);
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  // ---------- 반납 탭에서 미반납 내역 탭 ----------
  const openReturnDetail = (outstanding: OutstandingRental) => {
    const matched = inventory.find(
      (inv) => (inv.name || "").trim() === outstanding.name && (inv.location || "").trim() === outstanding.location
    );
    const item: InventoryItem =
      matched ||
      ({
        rowIndex: -1,
        location: outstanding.location,
        photo: "",
        name: outstanding.name,
        link: "N/A",
        stock: "N/A",
        updatedAt: "",
        manager: "",
        note: "",
        spec: "",
      } as InventoryItem);
    setSelectedItem(item);
    setOutstandingContext(outstanding);
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  const closeSheet = () => {
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}`;
  };

  const openForm = () => {
    if (!selectedItem) return;
    if (mode === "반납" && outstandingContext) {
      setFormUser(outstandingContext.user);
      setFormQty(outstandingContext.qty);
    } else {
      setFormUser("");
      setFormQty(1);
    }
    setFormNote("");
    setFormDueDate("");
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/form`;
  };

  const backToDetail = () => {
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  const maxQty =
    mode === "대여" && selectedItem && typeof selectedItem.stock === "number"
      ? selectedItem.stock
      : mode === "반납" && outstandingContext
      ? outstandingContext.qty
      : undefined;

  const handleSubmit = async (overrideType?: "대여" | "반납" | "소모") => {
    const actionType = overrideType || mode;
    if (!selectedItem) return;
    if (!formUser.trim()) {
      notify("이름을 입력해 주세요.", "warn");
      return;
    }
    if (formQty <= 0) {
      notify("수량은 1개 이상이어야 합니다.", "warn");
      return;
    }
    if (maxQty !== undefined && formQty > maxQty) {
      notify(
        actionType === "반납" ? `미반납 수량(${maxQty}개)을 초과할 수 없습니다.` : `현재고(${maxQty}개)를 초과할 수 없습니다.`,
        "warn"
      );
      return;
    }

    setSubmitting(true);
    try {
      const dueTag = actionType === "대여" && formDueDate ? ` [반납예정:${formDueDate}]` : "";
      const log: RentLog = {
        timestamp: formatTimestampLocal(),
        location: selectedItem.location,
        name: selectedItem.name,
        type: actionType,
        qty: formQty,
        user: formUser.trim(),
        note: (formNote.trim() || `${actionType} 처리 (모바일 관리자)`) + dueTag,
      };
      await onAddRentLog(log);
      notify(
        actionType === "대여"
          ? `${selectedItem.name} ${formQty}개 대여 신청이 접수되었습니다.`
          : actionType === "소모"
          ? `${selectedItem.name} ${formQty}개 소모 처리되었습니다. (반납 대상 아님)`
          : `${selectedItem.name} ${formQty}개 반납이 접수되었습니다.`,
        "ok"
      );
      closeSheet();
    } catch (err: any) {
      notify("처리에 실패했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  // 1. 신규 품목 등록 (등록 탭) 제출 처리
  const handleRegisterItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      notify("품목명을 입력해 주세요.", "warn");
      return;
    }
    const location = regIsCustomLoc
      ? regCustomLocation.trim()
      : `${regRackId}-${regShelf.trim()}`;
    if (!location) {
      notify("위치를 지정하거나 직접 입력해 주세요.", "warn");
      return;
    }

    setRegSubmitting(true);
    try {
      let numericStock: number | string | null = null;
      if (regStock.trim().toUpperCase() === "N/A") {
        numericStock = "N/A";
      } else {
        const val = Number(regStock);
        numericStock = isNaN(val) ? regStock : val;
      }

      const item: Omit<InventoryItem, "rowIndex"> = {
        name: regName.trim(),
        location: location,
        spec: regSpec.trim(),
        stock: numericStock,
        manager: regManager.trim(),
        note: regNote.trim(),
        photo: regPhoto.trim(),
        link: regLink.trim() || "N/A",
        updatedAt: formatTimestampLocal(),
      };

      if (onSaveInventoryItem) {
        await onSaveInventoryItem(item);
        notify(`${regName} 품목이 성공적으로 등록되었습니다.`, "ok");
        // Reset form
        setRegName("");
        setRegShelf("");
        setRegCustomLocation("");
        setRegSpec("");
        setRegStock("0");
        setRegNote("");
        setRegPhoto("");
        setRegLink("N/A");
      } else {
        notify("품목 등록 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("등록 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setRegSubmitting(false);
    }
  };

  // 2. 불량 접수 (불량 탭) 제출 처리
  const handleRegisterDefectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let itemName = "";
    let itemLocation = "";

    if (defSelectedInvIndex === -1) {
      if (!defCustomName.trim()) {
        notify("품목명을 입력해 주세요.", "warn");
        return;
      }
      if (!defCustomLoc.trim()) {
        notify("보관 위치를 입력해 주세요.", "warn");
        return;
      }
      itemName = defCustomName.trim();
      itemLocation = defCustomLoc.trim();
    } else {
      const selectedInv = inventory[defSelectedInvIndex];
      if (!selectedInv) {
        notify("선택된 품목이 올바르지 않습니다.", "warn");
        return;
      }
      itemName = selectedInv.name;
      itemLocation = selectedInv.location;
    }

    setDefectSubmitting(true);
    try {
      const log: Omit<DefectLog, "rowIndex"> = {
        timestamp: formatTimestampLocal(),
        location: itemLocation,
        name: itemName,
        qty: defQty,
        defectType: defType,
        manager: defManager.trim() || "관리자",
        note: defNote.trim(),
        actionTaken: defActionTaken.trim() || "조치 예정",
        photo: defPhoto,
      };

      if (onAddDefectLog) {
        await onAddDefectLog(log);
        notify(`불량 접수 완료: ${itemName} (${defQty}개)`, "ok");
        // Reset form
        setDefCustomName("");
        setDefCustomLoc("");
        setDefQty(1);
        setDefNote("");
        setDefPhoto(""); // Reset photo state
        setDefectTab("list"); // Go back to list!
      } else {
        notify("불량 등록 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("등록 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setDefectSubmitting(false);
    }
  };

  // 3. 인라인 품목 재고/정보 수정 (Admin 전용) 제출 처리
  const handleEditInventorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    setEditSubmitting(true);
    try {
      let numericStock: number | string | null = null;
      if (editStock.trim().toUpperCase() === "N/A") {
        numericStock = "N/A";
      } else {
        const val = Number(editStock);
        numericStock = isNaN(val) ? editStock : val;
      }

      const updatedItem: Omit<InventoryItem, "rowIndex"> & { rowIndex?: number } = {
        ...selectedItem,
        name: editName.trim(),
        location: editLocation.trim(),
        link: editLink.trim() || "N/A",
        photo: editPhoto.trim(),
        stock: numericStock,
        spec: editSpec.trim(),
        note: editNote.trim(),
        manager: editManager.trim(),
        updatedAt: formatTimestampLocal(),
      };

      if (onSaveInventoryItem) {
        await onSaveInventoryItem(updatedItem);
        notify(`${editName} 정보가 성공적으로 수정되었습니다.`, "ok");
        closeSheet();
      } else {
        notify("수정 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("수정 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  // 4. 인라인 수정 활성화할 때 상태 세팅
  const openEditInventory = () => {
    if (!selectedItem) return;
    setEditName(selectedItem.name || "");
    setEditLocation(selectedItem.location || "");
    setEditLink(selectedItem.link || "N/A");
    setEditPhoto(selectedItem.photo || "");
    setEditStock(selectedItem.stock === null ? "" : String(selectedItem.stock));
    setEditSpec(selectedItem.spec || "");
    setEditNote(selectedItem.note || "");
    setEditManager(selectedItem.manager && selectedItem.manager !== "관리자" ? selectedItem.manager : defaultManagerName);
    
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/edit-inventory`;
  };

  const inputBaseStyle: React.CSSProperties = {
    width: "100%",
    background: INPUT_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: "12px",
    padding: "13px 14px",
    color: TEXT_MAIN,
    fontSize: "15px",
    outline: "none",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: TEXT_MAIN,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .mvp-btn { cursor: pointer; border: none; transition: all 0.15s ease-in-out; }
        .mvp-btn:active { transform: scale(0.97); }
        .mvp-btn:disabled { cursor: not-allowed; }
        .mvp-card:active { transform: scale(0.985); }
        .mvp-input:focus { border-color: ${ACCENT} !important; box-shadow: 0 0 0 3px rgba(79,70,229,0.15) !important; }
        @keyframes mvpSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes mvpFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mvpToastIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        ::-webkit-scrollbar { width: 0px; height: 0px; }
      `}</style>

      {/* ===== 상단 헤더 (고정) ===== */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: HEADER_BG,
          borderBottom: `1px solid ${BORDER}`,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <button
            className="mvp-btn"
            onClick={onBack}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: isLightMode ? "#f1f5f9" : "#1e293b",
              color: TEXT_MAIN,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: TEXT_MAIN, whiteSpace: "nowrap" }}>
              {isAdmin ? "📱 모바일 관리자" : "👀 열람용 모드"}
            </div>
            <div
              style={{
                fontSize: "10.5px",
                color: connected ? GREEN_LIGHT : AMBER,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: connected ? GREEN : AMBER,
                  display: "inline-block",
                }}
              />
              {connected ? "실시간 연동 중" : "데모 모드"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {isAdmin && onOpenScenario ? (
            <button
              className="mvp-btn"
              onClick={onOpenScenario}
              title="시나리오 물품 관리"
              style={{
                height: "36px",
                padding: "0 12px",
                borderRadius: "10px",
                background: "rgba(99,102,241,0.15)",
                border: "1px solid rgba(99,102,241,0.3)",
                color: "#818cf8",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "12px",
                fontWeight: 800,
              }}
            >
              🧩 시나리오
            </button>
          ) : null}
          <button
            className="mvp-btn"
            onClick={toggleLightMode}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: isLightMode ? "#f1f5f9" : "#1e293b",
              color: TEXT_MAIN,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {isLightMode ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      {/* ===== 대여/반납 모드 탭 + 검색창 (고정) ===== */}
      <div
        style={{
          position: "sticky",
          top: "60px",
          zIndex: 19,
          background: BG,
          padding: "12px 14px 10px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isAdmin ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr",
            gap: "6px",
            background: isLightMode ? "#f1f5f9" : "#111827",
            padding: "4px",
            borderRadius: "14px",
            marginBottom: (mode === "등록" || mode === "불량") ? "0px" : "10px",
          }}
        >
          <button
            className="mvp-btn"
            onClick={() => switchMode("대여")}
            style={{
              padding: isAdmin ? "10px 4px" : "13px",
              borderRadius: "11px",
              fontSize: isAdmin ? "12px" : "14.5px",
              fontWeight: 800,
              background: mode === "대여" ? ACCENT : "transparent",
              color: mode === "대여" ? "#ffffff" : TEXT_DIM,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              boxShadow: mode === "대여" ? "0 6px 14px rgba(79,70,229,0.3)" : "none",
            }}
          >
            📥 대여
          </button>
          <button
            className="mvp-btn"
            onClick={() => switchMode("반납")}
            style={{
              padding: isAdmin ? "10px 4px" : "13px",
              borderRadius: "11px",
              fontSize: isAdmin ? "12px" : "14.5px",
              fontWeight: 800,
              background: mode === "반납" ? GREEN : "transparent",
              color: mode === "반납" ? "#ffffff" : TEXT_DIM,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              boxShadow: mode === "반납" ? "0 6px 14px rgba(16,185,129,0.3)" : "none",
            }}
          >
            🔄 반납
            {outstandingRentals.length > 0 && (
              <span
                style={{
                  background: mode === "반납" ? "rgba(255,255,255,0.25)" : DANGER,
                  color: "#ffffff",
                  fontSize: "9px",
                  fontWeight: 800,
                  borderRadius: "999px",
                  padding: "1px 5px",
                }}
              >
                {outstandingRentals.length}
              </span>
            )}
          </button>
          {isAdmin && (
            <>
              <button
                className="mvp-btn"
                onClick={() => switchMode("등록")}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: mode === "등록" ? "#6366f1" : "transparent",
                  color: mode === "등록" ? "#ffffff" : TEXT_DIM,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  boxShadow: mode === "등록" ? "0 6px 14px rgba(99,102,241,0.3)" : "none",
                }}
              >
                📦 등록
              </button>
              <button
                className="mvp-btn"
                onClick={() => switchMode("불량")}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: mode === "불량" ? AMBER : "transparent",
                  color: mode === "불량" ? "#ffffff" : TEXT_DIM,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  boxShadow: mode === "불량" ? "0 6px 14px rgba(245,158,11,0.3)" : "none",
                }}
              >
                ⚠️ 불량
              </button>
              <button
                className="mvp-btn"
                onClick={() => onOpenScenario && onOpenScenario()}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: "transparent",
                  color: "#818cf8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                }}
              >
                🧩 물품
              </button>
            </>
          )}
        </div>

        {!(mode === "등록" || (mode === "불량" && defectTab === "register")) && (
          <>
            <div style={{ position: "relative" }}>
              <Search
                size={16}
                style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }}
              />
              <input
                className="mvp-input"
                type="text"
                inputMode="search"
                placeholder={
                  mode === "대여"
                    ? "품목명, 위치, 규격으로 검색"
                    : mode === "반납"
                    ? "품목명, 위치, 대여자 이름으로 검색"
                    : "제품명, 불량 유형, 상세 내용으로 검색"
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: "12px",
                  padding: "12px 14px 12px 38px",
                  color: TEXT_MAIN,
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              {searchQuery && (
                <button
                  className="mvp-btn"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    color: TEXT_DIM,
                    width: "24px",
                    height: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div style={{ fontSize: "11px", color: TEXT_DIM, marginTop: "8px", fontWeight: 600 }}>
              {mode === "대여" ? `총 ${filteredInventory.length}개 품목` : `미반납 ${filteredOutstanding.length}건`}
            </div>
          </>
        )}
      </div>

      {/* ===== 리스트 & 폼 메인 영역 ===== */}
      <main style={{ flex: 1, padding: "14px 14px 32px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto" }}>
        {mode === "대여" ? (
          filteredInventory.length === 0 ? (
            <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
              <Package size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              검색 결과가 없습니다.
            </div>
          ) : (
            filteredInventory.map((item, idx) => {
              const hasImage = !!item.photo;
              const imageUrl = hasImage ? getGoogleDriveImageUrl(item.photo) : "";
              const stockLabel = item.stock === null || item.stock === "N/A" ? "N/A" : `${item.stock}개`;
              const stockColor =
                item.stock === null || item.stock === "N/A"
                  ? TEXT_DIM
                  : item.stock === 0
                  ? DANGER
                  : GREEN;

              return (
                <div
                  key={`${item.rowIndex}-${idx}`}
                  className="mvp-card"
                  onClick={() => openItemDetail(item)}
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: "16px",
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "54px",
                      height: "54px",
                      borderRadius: "12px",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {hasImage ? (
                      <img
                        src={imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={20} color={TEXT_DIM} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "13.5px",
                        fontWeight: 800,
                        color: TEXT_MAIN,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name || "(이름 없음)"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        color: TEXT_DIM,
                        marginTop: "3px",
                      }}
                    >
                      <MapPin size={10} />
                      <span className="mono">{item.location || "위치 미지정"}</span>
                      {item.spec && (
                        <>
                          <span>·</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.spec}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        color: stockColor,
                        background:
                          item.stock === 0 ? "rgba(239,68,68,0.1)" : item.stock === null || item.stock === "N/A" ? "transparent" : "rgba(16,185,129,0.1)",
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      {stockLabel}
                    </span>
                    <ChevronRight size={16} color={TEXT_DIM} />
                  </div>
                </div>
              );
            })
          )
        ) : mode === "반납" ? (
          filteredOutstanding.length === 0 ? (
            <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
              <Check size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              {searchQuery ? "검색 결과가 없습니다." : "현재 반납할 물품이 없습니다."}
            </div>
          ) : (
            filteredOutstanding.map((o) => {
              const matched = inventory.find(
                (inv) => (inv.name || "").trim() === o.name && (inv.location || "").trim() === o.location
              );
              const hasImage = !!matched?.photo;
              const imageUrl = hasImage ? getGoogleDriveImageUrl(matched!.photo) : "";

              return (
                <div
                  key={o.key}
                  className="mvp-card"
                  onClick={() => openReturnDetail(o)}
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: "16px",
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "54px",
                      height: "54px",
                      borderRadius: "12px",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {hasImage ? (
                      <img
                        src={imageUrl}
                        alt={o.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={20} color={TEXT_DIM} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "13.5px",
                        fontWeight: 800,
                        color: TEXT_MAIN,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: TEXT_DIM, marginTop: "3px" }}>
                      <MapPin size={10} />
                      <span className="mono">{o.location || "위치 미지정"}</span>
                      <span>·</span>
                      <User size={10} />
                      <span>{o.user || "이름 미상"}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        color: AMBER,
                        background: "rgba(245,158,11,0.12)",
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      미반납 {o.qty}개
                    </span>
                    <ChevronRight size={16} color={TEXT_DIM} />
                  </div>
                </div>
              );
            })
          )
        ) : mode === "등록" ? (
          /* =========================================================
             3. 신규 품목 등록 폼 (Admin 모바일 전용)
             ========================================================= */
          <form onSubmit={handleRegisterItemSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Package size={20} color="#6366f1" />
              <div style={{ fontSize: "16px", fontWeight: 800, color: TEXT_MAIN }}>
                📦 신규 물품 등록하기
              </div>
            </div>

            {/* 품목명 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품명 *</label>
              <input
                className="mvp-input"
                type="text"
                placeholder="물품 이름을 입력하세요"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                style={inputBaseStyle}
                required
              />
            </div>

            {/* 위치 선택 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 *</label>
                <button
                  type="button"
                  onClick={() => setRegIsCustomLoc(!regIsCustomLoc)}
                  style={{
                    fontSize: "11px",
                    color: "#6366f1",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {regIsCustomLoc ? "랙 선택하기" : "위치 직접 입력"}
                </button>
              </div>

              {regIsCustomLoc ? (
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="보관 위치 입력 (예: A-01)"
                  value={regCustomLocation}
                  onChange={(e) => setRegCustomLocation(e.target.value)}
                  style={inputBaseStyle}
                  required
                />
              ) : (
                <div style={{ display: "flex", gap: "8px" }}>
                  <select
                    className="mvp-input"
                    value={regRackId}
                    onChange={(e) => setRegRackId(e.target.value)}
                    style={{
                      ...inputBaseStyle,
                      flex: 1.2,
                      padding: "12px",
                      background: INPUT_BG,
                      color: TEXT_MAIN,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                    }}
                  >
                    <option value="" disabled>랙 선택</option>
                    {racks.map((r) => (
                      <option key={r.id} value={r.id}>{r.name || r.id}</option>
                    ))}
                  </select>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="선반 (예: 01)"
                    value={regShelf}
                    onChange={(e) => setRegShelf(e.target.value)}
                    style={{ ...inputBaseStyle, flex: 0.8 }}
                    required={!regIsCustomLoc}
                  />
                </div>
              )}
            </div>

            {/* 규격 및 초기 수량 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>규격 (상세 설명)</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="예: 50A"
                  value={regSpec}
                  onChange={(e) => setRegSpec(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>초기 재고수량</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="수량"
                    value={regStock}
                    onChange={(e) => setRegStock(e.target.value)}
                    style={{ ...inputBaseStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setRegStock("N/A")}
                    style={{
                      padding: "0 12px",
                      background: regStock === "N/A" ? "#6366f1" : "rgba(255,255,255,0.05)",
                      color: regStock === "N/A" ? "#ffffff" : TEXT_DIM,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    N/A
                  </button>
                </div>
              </div>
            </div>

            {/* 담당자 & 특이사항 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>등록 담당자</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="담당자명"
                  value={regManager}
                  onChange={(e) => setRegManager(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>비고 (참고사항)</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="비고"
                  value={regNote}
                  onChange={(e) => setRegNote(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>
            </div>

            {/* 사진 등록 (링크 입력 + 파일 직접 업로드) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>사진 주소 또는 이미지 직접 업로드</label>
              <input
                className="mvp-input"
                type="text"
                placeholder={regPhoto.startsWith("data:image/") ? "파일 직접 촬영/업로드됨" : "구글 드라이브 주소를 입력하거나 아래에서 직접 촬영/업로드하세요"}
                value={regPhoto.startsWith("data:image/") ? "" : regPhoto}
                disabled={regPhoto.startsWith("data:image/")}
                onChange={(e) => setRegPhoto(e.target.value)}
                style={{ ...inputBaseStyle, opacity: regPhoto.startsWith("data:image/") ? 0.6 : 1 }}
              />
              <div
                style={{
                  border: `1px dashed ${BORDER}`,
                  borderRadius: "12px",
                  padding: "12px",
                  textAlign: "center",
                  background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  marginTop: "4px"
                }}
                onClick={() => document.getElementById("mobile-reg-photo-upload")?.click()}
              >
                <input
                  type="file"
                  id="mobile-reg-photo-upload"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleRegPhotoChange}
                />
                {regPhoto && regPhoto.startsWith("data:image/") ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                    <img
                      src={regPhoto}
                      alt="Uploaded Preview"
                      style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                    />
                    <div style={{ textAlign: "left" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#6366f1", display: "block" }}>
                        📸 이미지 업로드 준비 완료
                      </span>
                      <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                        등록 완료 시 드라이브 폴더에 자동 저장됩니다.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRegPhoto("");
                      }}
                      style={{
                        marginLeft: "auto",
                        background: "rgba(239, 68, 68, 0.15)",
                        color: "#ef4444",
                        border: "none",
                        borderRadius: "6px",
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: 700
                      }}
                    >
                      삭제
                    </button>
                  </div>
                ) : isRegUploadingImage ? (
                  <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 가져오는 중...</span>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <Camera size={16} style={{ color: TEXT_DIM }} />
                      <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>사진 직접 찍기 / 이미지 파일 업로드</span>
                    </div>
                    <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                      (지정 드라이브 폴더에 오브젝트 이름으로 저장됩니다)
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 구매 링크 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>구매 링크</label>
              <input
                className="mvp-input"
                type="text"
                placeholder="URL 주소 (기본값: N/A)"
                value={regLink}
                onChange={(e) => setRegLink(e.target.value)}
                style={inputBaseStyle}
              />
            </div>

            <button
              type="submit"
              className="mvp-btn"
              disabled={regSubmitting}
              style={{
                width: "100%",
                padding: "15px",
                borderRadius: "14px",
                background: "#6366f1",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 800,
                marginTop: "10px",
                boxShadow: "0 6px 20px rgba(99,102,241,0.25)",
              }}
            >
              {regSubmitting ? "실시간 클라우드 등록 중..." : "📦 신규 물품 정식 등록"}
            </button>
          </form>
        ) : (
          /* =========================================================
             4. 불량 제품 관리 및 등록 (Admin 모바일 전용)
             ========================================================= */
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* 불량 탭 내부 서브 탭 스위처 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px",
                background: isLightMode ? "#f1f5f9" : "#111827",
                padding: "3px",
                borderRadius: "10px",
              }}
            >
              <button
                type="button"
                className="mvp-btn"
                onClick={() => setDefectTab("list")}
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: defectTab === "list" ? AMBER : "transparent",
                  color: defectTab === "list" ? "#ffffff" : TEXT_DIM,
                }}
              >
                📜 불량 대장 ({defectLogs.length}건)
              </button>
              <button
                type="button"
                className="mvp-btn"
                onClick={() => setDefectTab("register")}
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: defectTab === "register" ? AMBER : "transparent",
                  color: defectTab === "register" ? "#ffffff" : TEXT_DIM,
                }}
              >
                ⚠️ 불량품 등록
              </button>
            </div>

            {defectTab === "list" ? (
              /* 4-A. 불량 로그 목록 */
              filteredDefectLogs.length === 0 ? (
                <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
                  <Check size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                  {searchQuery ? "검색 결과와 일치하는 불량 내역이 없습니다." : "기록된 불량 내역이 존재하지 않습니다."}
                </div>
              ) : (
                [...filteredDefectLogs]
                  .sort((a, b) => compareDatesDescending(a.timestamp, b.timestamp))
                  .map((log, index) => (
                    <div
                      key={log.rowIndex || index}
                      style={{
                        background: CARD_BG,
                        border: `1px solid ${BORDER}`,
                        borderRadius: "16px",
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 800, color: TEXT_MAIN }}>
                          {log.name}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            color: DANGER,
                            background: "rgba(239,68,68,0.1)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                          }}
                        >
                          {log.defectType}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: TEXT_DIM }}>
                        <span>📍 {log.location}</span>
                        <span>·</span>
                        <span>📦 {log.qty}개</span>
                        <span>·</span>
                        <span>👤 {log.manager}</span>
                      </div>

                      {log.note && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: TEXT_DIM,
                            background: isLightMode ? "#f8fafc" : "rgba(255,255,255,0.03)",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            borderLeft: `3px solid ${AMBER}`,
                            marginTop: "4px",
                          }}
                        >
                          {log.note}
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: GREEN,
                          alignSelf: "flex-start",
                          background: "rgba(16,185,129,0.08)",
                          padding: "3px 6px",
                          borderRadius: "4px",
                          marginTop: "2px",
                        }}
                      >
                        ✅ {log.actionTaken || "조치 예정"}
                      </div>

                      <div style={{ fontSize: "9.5px", color: TEXT_DIM, alignSelf: "flex-end", marginTop: "2px" }}>
                        📅 {log.timestamp}
                      </div>
                    </div>
                  ))
              )
            ) : (
              /* 4-B. 불량 제품 등록 폼 */
              <form onSubmit={handleRegisterDefectSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {/* 품목 선택 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>품목 고르기</label>
                  <select
                    className="mvp-input"
                    value={defSelectedInvIndex}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setDefSelectedInvIndex(idx);
                      if (idx !== -1) {
                        setDefCustomName(inventory[idx].name);
                        setDefCustomLoc(inventory[idx].location);
                      } else {
                        setDefCustomName("");
                        setDefCustomLoc("");
                      }
                    }}
                    style={{
                      ...inputBaseStyle,
                      background: INPUT_BG,
                      color: TEXT_MAIN,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                    }}
                  >
                    <option value={-1}>직접 품목 입력하기</option>
                    {inventory.map((item, idx) => (
                      <option key={idx} value={idx}>
                        {item.name} ({item.location})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 직접 입력 시 물품명/위치 노출 */}
                {defSelectedInvIndex === -1 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품명 *</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="이름 입력"
                        value={defCustomName}
                        onChange={(e) => setDefCustomName(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 *</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="위치 입력"
                        value={defCustomLoc}
                        onChange={(e) => setDefCustomLoc(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "12px",
                      color: AMBER,
                      background: "rgba(245,158,11,0.08)",
                      border: "1px dashed rgba(245,158,11,0.2)",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      fontWeight: 700,
                    }}
                  >
                    📍 선택 물품 보관 위치: {defCustomLoc || "지정되지 않음"}
                  </div>
                )}

                {/* 수량 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 수량 *</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={() => setDefQty((q) => Math.max(1, q - 1))}
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        fontSize: "18px",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      className="mvp-input"
                      type="number"
                      value={defQty}
                      onChange={(e) => setDefQty(Math.max(1, Number(e.target.value)))}
                      style={{ ...inputBaseStyle, flex: 1, textAlign: "center" }}
                      required
                    />
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={() => setDefQty((q) => q + 1)}
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        fontSize: "18px",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* 불량 유형 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 유형</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {["파손", "부식", "기능 오작동", "오염", "기타"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="mvp-btn"
                        onClick={() => setDefType(type)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          background: defType === type ? AMBER : (isLightMode ? "#e2e8f0" : "#1e293b"),
                          color: defType === type ? "#ffffff" : TEXT_MAIN,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 접수자 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 접수자</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="접수 담당자 이름"
                    value={defManager}
                    onChange={(e) => setDefManager(e.target.value)}
                    style={inputBaseStyle}
                    required
                  />
                </div>

                {/* 상세 내역 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>상세 불량 내용</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="현상 및 고장 정보 입력"
                    value={defNote}
                    onChange={(e) => setDefNote(e.target.value)}
                    style={inputBaseStyle}
                  />
                </div>

                {/* 후속 조치 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>조치 예정 사항</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="예: 폐기 대기, AS 접수 예정"
                    value={defActionTaken}
                    onChange={(e) => setDefActionTaken(e.target.value)}
                    style={inputBaseStyle}
                  />
                </div>

                {/* 불량 사진 직접 촬영 / 업로드 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 사진 직접 촬영 / 업로드</label>
                  <div
                    style={{
                      border: `1px dashed ${BORDER}`,
                      borderRadius: "12px",
                      padding: "12px",
                      textAlign: "center",
                      background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      marginTop: "4px"
                    }}
                    onClick={() => document.getElementById("mobile-def-photo-upload")?.click()}
                  >
                    <input
                      type="file"
                      id="mobile-def-photo-upload"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleDefPhotoChange}
                    />
                    {defPhoto ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                        <img
                          src={defPhoto}
                          alt="Defect Preview"
                          style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                        />
                        <div style={{ textAlign: "left" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: AMBER, display: "block" }}>
                            📸 불량 사진 등록 완료
                          </span>
                          <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                            접수 시 구글 드라이브에 자동 등록됩니다.
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mvp-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefPhoto("");
                          }}
                          style={{
                            marginLeft: "auto",
                            background: "rgba(239, 68, 68, 0.15)",
                            color: "#ef4444",
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            fontWeight: 700
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    ) : isDefUploadingImage ? (
                      <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 로드 중...</span>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <Camera size={16} style={{ color: TEXT_DIM }} />
                          <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>불량 사진 직접 찍기 / 이미지 파일 업로드</span>
                        </div>
                        <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                          (자동으로 연동된 구글 드라이브 폴더에 업로드되어 실시간 연동됩니다)
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  className="mvp-btn"
                  disabled={defectSubmitting}
                  style={{
                    width: "100%",
                    padding: "15px",
                    borderRadius: "14px",
                    background: AMBER,
                    color: "#ffffff",
                    fontSize: "15px",
                    fontWeight: 800,
                    boxShadow: "0 6px 20px rgba(245,158,11,0.25)",
                    marginTop: "8px",
                  }}
                >
                  {defectSubmitting ? "실시간 동기화 중..." : "⚠️ 불량 제품 접수 등록"}
                </button>
              </form>
            )}
          </div>
        )}
      </main>

      {/* ===== 상세/신청 바텀시트 ===== */}
      {sheetMode && selectedItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "flex-end",
            animation: "mvpFadeIn 0.15s ease-out",
          }}
        >
          <div
            onClick={closeSheet}
            style={{ position: "absolute", inset: 0, background: "rgba(2, 6, 17, 0.6)", backdropFilter: "blur(2px)" }}
          />

          <div
            style={{
              position: "relative",
              width: "100%",
              maxHeight: "88vh",
              background: isLightMode ? "#ffffff" : "#101827",
              borderTopLeftRadius: "24px",
              borderTopRightRadius: "24px",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.3)",
              animation: "mvpSheetUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
              <div style={{ width: "36px", height: "4px", borderRadius: "999px", background: BORDER }} />
            </div>

            <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
              {sheetMode === "detail" ? (
                <>
                  {/* 사진 */}
                  <div
                    onClick={() => selectedItem.photo && setLightbox(getGoogleDriveImageUrl(selectedItem.photo))}
                    style={{
                      width: "100%",
                      aspectRatio: "1.4 / 1",
                      borderRadius: "14px",
                      overflow: "hidden",
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                      cursor: selectedItem.photo ? "zoom-in" : "default",
                    }}
                  >
                    {selectedItem.photo ? (
                      <img
                        src={getGoogleDriveImageUrl(selectedItem.photo)}
                        alt={selectedItem.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", color: TEXT_DIM }}>
                        <ImageOff size={32} />
                        <span style={{ fontSize: "12px" }}>등록된 사진이 없습니다</span>
                      </div>
                    )}
                  </div>

                  <h2 style={{ fontSize: "19px", fontWeight: 800, color: TEXT_MAIN, marginBottom: "6px" }}>
                    {selectedItem.name || "(이름 없음)"}
                  </h2>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: ACCENT_LIGHT,
                        background: "rgba(99,102,241,0.12)",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <MapPin size={11} />
                      {selectedItem.location || "위치 미지정"}
                    </span>

                    {mode === "대여" ? (
                      <>
                        {selectedItem.spec && (
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              color: TEXT_DIM,
                              background: isLightMode ? "#f1f5f9" : "#1e293b",
                              padding: "4px 10px",
                              borderRadius: "999px",
                            }}
                          >
                            {selectedItem.spec}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 800,
                            color:
                              selectedItem.stock === null || selectedItem.stock === "N/A"
                                ? TEXT_DIM
                                : selectedItem.stock === 0
                                ? DANGER
                                : GREEN,
                            background: selectedItem.stock === 0 ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
                            padding: "4px 10px",
                            borderRadius: "999px",
                          }}
                        >
                          현재고: {selectedItem.stock === null || selectedItem.stock === "N/A" ? "N/A" : `${selectedItem.stock}개`}
                        </span>
                      </>
                    ) : (
                      outstandingContext && (
                        <>
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              color: TEXT_DIM,
                              background: isLightMode ? "#f1f5f9" : "#1e293b",
                              padding: "4px 10px",
                              borderRadius: "999px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <User size={11} />
                            {outstandingContext.user || "이름 미상"}
                          </span>
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 800,
                              color: AMBER,
                              background: "rgba(245,158,11,0.12)",
                              padding: "4px 10px",
                              borderRadius: "999px",
                            }}
                          >
                            미반납 수량: {outstandingContext.qty}개
                          </span>
                        </>
                      )
                    )}
                  </div>

                  {mode === "반납" && outstandingContext?.lastTimestamp && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "11px",
                        color: TEXT_DIM,
                        marginBottom: "14px",
                      }}
                    >
                      <Clock size={11} />
                      최근 대여일시: {outstandingContext.lastTimestamp}
                    </div>
                  )}

                  {mode === "대여" && selectedItem.note && (
                    <div
                      style={{
                        background: isLightMode ? "#f8fafc" : "#0f172a",
                        border: `1px solid ${BORDER}`,
                        borderRadius: "12px",
                        padding: "12px 14px",
                        fontSize: "12.5px",
                        color: TEXT_DIM,
                        marginBottom: "16px",
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ fontWeight: 700, color: TEXT_MAIN }}>📝 비고 · </span>
                      {selectedItem.note}
                    </div>
                  )}

                  <button
                    className="mvp-btn"
                    onClick={openForm}
                    disabled={mode === "대여" && isRentDisabled(selectedItem)}
                    style={{
                      width: "100%",
                      background: MODE_COLOR,
                      color: "#ffffff",
                      borderRadius: "14px",
                      padding: "14px",
                      fontSize: "14.5px",
                      fontWeight: 800,
                      opacity: mode === "대여" && isRentDisabled(selectedItem) ? 0.4 : 1,
                      cursor: mode === "대여" && isRentDisabled(selectedItem) ? "not-allowed" : "pointer",
                      boxShadow: `0 6px 16px ${mode === "대여" ? "rgba(79,70,229,0.3)" : "rgba(16,185,129,0.3)"}`,
                    }}
                  >
                    {mode === "대여" ? "📥 대여하기" : "🔄 반납하기"}
                  </button>

                  {isAdmin && (
                    <button
                      className="mvp-btn"
                      onClick={openEditInventory}
                      style={{
                        width: "100%",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        borderRadius: "14px",
                        padding: "13px",
                        fontSize: "14px",
                        fontWeight: 700,
                        marginTop: "10px",
                        border: `1px solid ${BORDER}`,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                      }}
                    >
                      ✏️ 기존 물품 정보 수정 (관리자)
                    </button>
                  )}
                </>
              ) : sheetMode === "edit-inventory" ? (
                <>
                  {/* ===== 기존 물품 정보 수정 폼 ===== */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <button
                      className="mvp-btn"
                      type="button"
                      onClick={backToDetail}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "10px",
                        background: isLightMode ? "#f1f5f9" : "#1e293b",
                        color: TEXT_MAIN,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <h2 style={{ fontSize: "17px", fontWeight: 800, color: AMBER, margin: 0 }}>
                      ✏️ 기존 물품 정보 수정 (관리자)
                    </h2>
                  </div>

                  {/* 물품 사진 촬영 / 업로드 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>물품 이미지 직접 촬영 / 업로드</label>
                    <div
                      style={{
                        border: `1px dashed ${BORDER}`,
                        borderRadius: "12px",
                        padding: "12px",
                        textAlign: "center",
                        background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        marginTop: "4px"
                      }}
                      onClick={() => document.getElementById("mobile-edit-photo-upload")?.click()}
                    >
                      <input
                        type="file"
                        id="mobile-edit-photo-upload"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleEditPhotoChange}
                      />
                      {editPhoto ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                          <img
                            src={editPhoto.startsWith("data:image/") ? editPhoto : getGoogleDriveImageUrl(editPhoto)}
                            alt="Edit Preview"
                            style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                          />
                          <div style={{ textAlign: "left" }}>
                            <span style={{ fontSize: "12px", fontWeight: 700, color: AMBER, display: "block" }}>
                              📸 물품 이미지 선택됨
                            </span>
                            <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                              저장 시 구글 드라이브에 자동 업로드됩니다.
                            </span>
                          </div>
                          <button
                            type="button"
                            className="mvp-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditPhoto("");
                            }}
                            style={{
                              marginLeft: "auto",
                              background: "rgba(239, 68, 68, 0.15)",
                              color: "#ef4444",
                              border: "none",
                              borderRadius: "6px",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 700
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      ) : isEditUploadingImage ? (
                        <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 로드 중...</span>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <Camera size={16} style={{ color: TEXT_DIM }} />
                            <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>이미지 직접 찍기 / 파일 업로드</span>
                          </div>
                          <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                            (구글 드라이브 폴더에 업로드되어 실시간 연동됩니다)
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <form onSubmit={handleEditInventorySubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* 품목명 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>품목명 <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 위치 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 (예: A-01) <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 규격/설명 (Spec) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>규격 / 서브카테고리</label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editSpec}
                        onChange={(e) => setEditSpec(e.target.value)}
                        style={inputBaseStyle}
                        placeholder="예: i7, 16GB, 256GB"
                      />
                    </div>

                    {/* 재고수량 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>현재고 수량 (숫자 또는 N/A) <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editStock}
                        onChange={(e) => setEditStock(e.target.value)}
                        style={inputBaseStyle}
                        placeholder="예: 5 또는 N/A"
                        required
                      />
                    </div>

                    {/* 링크 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>연결 링크 (N/A 또는 URL)</label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editLink}
                        onChange={(e) => setEditLink(e.target.value)}
                        style={inputBaseStyle}
                        placeholder="N/A"
                      />
                    </div>

                    {/* 담당자 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>수정 담당 관리자 <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editManager}
                        onChange={(e) => setEditManager(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 비고 (Note) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>비고 / 특이사항</label>
                      <textarea
                        className="mvp-input"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        style={{ ...inputBaseStyle, minHeight: "80px", resize: "none" }}
                        placeholder="특이사항 입력"
                      />
                    </div>

                    {/* 제출 버튼 */}
                    <button
                      type="submit"
                      className="mvp-btn"
                      disabled={editSubmitting || isEditUploadingImage}
                      style={{
                        width: "100%",
                        background: AMBER,
                        color: "#ffffff",
                        borderRadius: "14px",
                        padding: "15px",
                        fontSize: "15px",
                        fontWeight: 800,
                        opacity: editSubmitting || isEditUploadingImage ? 0.6 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        marginTop: "8px",
                        boxShadow: "0 8px 20px rgba(245,158,11,0.25)",
                      }}
                    >
                      <Check size={17} />
                      {editSubmitting ? "실시간 연동 저장 중..." : "✏️ 품목 정보 수정 완료"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {/* ===== 대여/반납 신청 폼 ===== */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <button
                      className="mvp-btn"
                      onClick={backToDetail}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "10px",
                        background: isLightMode ? "#f1f5f9" : "#1e293b",
                        color: TEXT_MAIN,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <h2 style={{ fontSize: "17px", fontWeight: 800, color: MODE_COLOR_LIGHT, margin: 0 }}>
                      {mode === "대여" ? "📥 물품 대여 신청" : "🔄 물품 반납 접수"}
                    </h2>
                  </div>

                  <div
                    style={{
                      background: isLightMode ? "#f8fafc" : "#0f172a",
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                      padding: "12px 14px",
                      marginBottom: "18px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {selectedItem.photo ? (
                      <img
                        src={getGoogleDriveImageUrl(selectedItem.photo)}
                        alt={selectedItem.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "40px", height: "40px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "8px",
                          background: isLightMode ? "#e2e8f0" : "#1e293b",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Package size={16} color={TEXT_DIM} />
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 800,
                          color: TEXT_MAIN,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {selectedItem.name}
                      </div>
                      <div style={{ fontSize: "11px", color: TEXT_DIM }}>
                        {mode === "대여"
                          ? `위치: ${selectedItem.location} · 현재고: ${
                              selectedItem.stock === null || selectedItem.stock === "N/A" ? "N/A" : `${selectedItem.stock}개`
                            }`
                          : `위치: ${selectedItem.location} · 미반납: ${outstandingContext?.qty ?? formQty}개`}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>
                        {mode === "대여" ? "대여자 이름" : "반납자 이름"} <span style={{ color: DANGER }}>*</span>
                      </label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="예: 홍길동"
                        value={formUser}
                        onChange={(e) => setFormUser(e.target.value)}
                        style={inputBaseStyle}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>
                        수량 <span style={{ color: DANGER }}>*</span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button
                          className="mvp-btn"
                          onClick={() => setFormQty((q) => Math.max(1, q - 1))}
                          style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "12px",
                            background: isLightMode ? "#f1f5f9" : "#1e293b",
                            color: TEXT_MAIN,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Minus size={18} />
                        </button>
                        <div className="mono" style={{ flex: 1, textAlign: "center", fontSize: "20px", fontWeight: 800, color: TEXT_MAIN }}>
                          {formQty}
                        </div>
                        <button
                          className="mvp-btn"
                          onClick={() => setFormQty((q) => (maxQty !== undefined ? Math.min(maxQty, q + 1) : q + 1))}
                          style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "12px",
                            background: isLightMode ? "#f1f5f9" : "#1e293b",
                            color: TEXT_MAIN,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {maxQty !== undefined && formQty >= maxQty && (
                        <span style={{ fontSize: "11px", color: AMBER }}>
                          {mode === "대여" ? `현재고(${maxQty}개)까지 대여할 수 있습니다.` : `미반납 수량(${maxQty}개)까지 반납할 수 있습니다.`}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>메모 (선택)</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="예: 테스트 목적 대여"
                        value={formNote}
                        onChange={(e) => setFormNote(e.target.value)}
                        style={{ ...inputBaseStyle, fontSize: "14px" }}
                      />
                    </div>

                    {mode === "대여" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>반납 예정일 (선택 · 연체 관리)</label>
                        <input
                          className="mvp-input"
                          type="date"
                          value={formDueDate}
                          onChange={(e) => setFormDueDate(e.target.value)}
                          style={{ ...inputBaseStyle, fontSize: "14px" }}
                        />
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      {mode === "대여" && isAdmin ? (
                        <button
                          className="mvp-btn"
                          onClick={() => handleSubmit("소모")}
                          disabled={submitting}
                          style={{
                            flex: "0 0 auto",
                            background: AMBER,
                            color: "#ffffff",
                            borderRadius: "14px",
                            padding: "15px 18px",
                            fontSize: "15px",
                            fontWeight: 800,
                            opacity: submitting ? 0.6 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            boxShadow: "0 8px 20px rgba(245,158,11,0.3)",
                          }}
                        >
                          🔥 소모
                        </button>
                      ) : null}
                      <button
                        className="mvp-btn"
                        onClick={() => handleSubmit()}
                        disabled={submitting}
                        style={{
                          flex: 1,
                          background: MODE_COLOR,
                          color: "#ffffff",
                          borderRadius: "14px",
                          padding: "15px",
                          fontSize: "15px",
                          fontWeight: 800,
                          opacity: submitting ? 0.6 : 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          boxShadow: `0 8px 20px ${mode === "대여" ? "rgba(79,70,229,0.3)" : "rgba(16,185,129,0.3)"}`,
                        }}
                      >
                        <Check size={17} />
                        {submitting ? "제출 중..." : mode === "대여" ? "대여 제출" : "반납 제출"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 사진 라이트박스 ===== */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "mvpFadeIn 0.15s ease-out",
          }}
        >
          <button
            className="mvp-btn"
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={20} />
          </button>
          <img
            src={lightbox}
            alt="확대 이미지"
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "12px", objectFit: "contain" }}
          />
        </div>
      )}

      {/* ===== 로컬 토스트 ===== */}
      {localToast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 70,
            background: localToast.type === "ok" ? "#10b981" : localToast.type === "error" ? "#ef4444" : "#f59e0b",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "999px",
            fontSize: "13px",
            fontWeight: 700,
            boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            maxWidth: "90vw",
            textAlign: "center",
            animation: "mvpToastIn 0.2s ease-out",
          }}
        >
          {localToast.msg}
        </div>
      )}
    </div>
  );
}
