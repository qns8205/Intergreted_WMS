import React, { useState, useMemo, useRef, useEffect } from "react";
import { InventoryItem, RentLog } from "../types";
import { 
  Calendar, 
  User, 
  MapPin, 
  Clipboard, 
  Plus, 
  Search, 
  ArrowLeft, 
  FileText, 
  Check, 
  ArrowRightLeft, 
  X, 
  ChevronDown, 
  RotateCcw, 
  AlertCircle 
} from "lucide-react";
import { parseDateString } from "../utils/date";

interface RentLogsPageProps {
  rentLogs: RentLog[];
  inventory: InventoryItem[];
  onAddRentLog: (log: RentLog) => Promise<void>;
  onClose: () => void;
  isLightMode: boolean;
  isAdmin: boolean;
  showToast?: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  isGuestMode?: boolean;
}

const PANEL_BORDER = "var(--panel-border, #334155)";
const TEXT_MAIN = "var(--text-main, #f1f5f9)";
const TEXT_DIM = "var(--text-dim, #94a3b8)";
const ACCENT = "#6366f1";
const DANGER = "#f43f5e";
const OK = "#10b981";
const WARNING = "#f59e0b";

function formatTimestampToMinutes(tsStr: string): string {
  if (!tsStr) return "실시간 동기화";
  const clean = tsStr.trim();
  
  // 1. ISO format with timezone (e.g. 2026-07-08T21:07:59.000Z or 2026-07-08T21:07:59+09:00)
  if (clean.includes("T") && (clean.includes("Z") || clean.includes("+") || /-\d{2}:\d{2}$/.test(clean))) {
    try {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    } catch (e) {
      // fallback
    }
  }

  // 2. YYYY-MM-DD HH:mm:ss or YYYY/MM/DD HH:mm:ss or ISO without timezone (e.g. 2026-07-09T15:00:00)
  const dateTimeRegex = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})/;
  const dtMatch = clean.match(dateTimeRegex);
  if (dtMatch) {
    const pad = (s: string) => s.padStart(2, "0");
    return `${dtMatch[1]}/${pad(dtMatch[2])}/${pad(dtMatch[3])} ${pad(dtMatch[4])}:${pad(dtMatch[5])}`;
  }

  // 3. YYYY-MM-DD or YYYY/MM/DD
  const dateRegex = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
  const dMatch = clean.match(dateRegex);
  if (dMatch) {
    const pad = (s: string) => s.padStart(2, "0");
    return `${dMatch[1]}/${pad(dMatch[2])}/${pad(dMatch[3])}`;
  }

  // 4. Korean style display format (e.g., "2026. 7. 9. 오후 1:35:13" or "2026. 7. 9.")
  const krDateRegex = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/;
  const krMatch = clean.match(krDateRegex);
  if (krMatch) {
    const pad = (s: string) => s.padStart(2, "0");
    const year = krMatch[1];
    const month = pad(krMatch[2]);
    const day = pad(krMatch[3]);
    
    // Check if there is "오전" / "오후" time
    const timeMatch = clean.match(/(오전|오후)\s*(\d{1,2}):(\d{1,2})/);
    if (timeMatch) {
      const isPm = timeMatch[1] === "오후";
      let hourNum = parseInt(timeMatch[2], 10);
      if (isPm && hourNum < 12) hourNum += 12;
      if (!isPm && hourNum === 12) hourNum = 0;
      const hour = String(hourNum).padStart(2, "0");
      const min = pad(timeMatch[3]);
      return `${year}/${month}/${day} ${hour}:${min}`;
    }
    
    return `${year}/${month}/${day}`;
  }

  // 5. Fallback - parse string to local date safely
  try {
    const parsedPart = clean.replace(/-/g, "/");
    const d = new Date(parsedPart);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  } catch (e) {
    // ignore
  }

  return clean;
}

export default function RentLogsPage({
  rentLogs,
  inventory,
  onAddRentLog,
  onClose,
  isLightMode,
  isAdmin,
  showToast,
  isGuestMode = false,
}: RentLogsPageProps) {
  // Search and Filter states
  const [filterQuery, setFilterQuery] = useState("");
  const [filterType, setFilterType] = useState("전체");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Collapsible Registration Form State (Guest Mode defaults to true)
  const [showAddForm, setShowAddForm] = useState(isGuestMode);
  
  // Registration Form Fields
  const [rentUser, setRentUser] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rentQty, setRentQty] = useState(1);
  const [actionType, setActionType] = useState<"대여" | "반납" | "소모">("대여");
  const [noteInput, setNoteInput] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Instant Return Trackers (prevents double clicking and gives visual checkmark)
  const [returnedTimestamps, setReturnedTimestamps] = useState<string[]>([]);
  const [returningStates, setReturningStates] = useState<{ [key: string]: boolean }>({});
  const [consumingStates, setConsumingStates] = useState<{ [key: string]: boolean }>({});

  // Dynamically compute returned timestamps from the logs history (handles refresh/initial load)
  const computedReturnedTimestamps = useMemo(() => {
    const returnedSet = new Set<string>();

    // Sort all rentLogs chronologically (oldest first)
    const chronoLogs = [...rentLogs].sort((a, b) => {
      const timeA = parseDateString(a.timestamp || "");
      const timeB = parseDateString(b.timestamp || "");
      if (timeA !== timeB) {
        return timeA - timeB; // Oldest timestamp first
      }
      const rowA = a.rowIndex || 0;
      const rowB = b.rowIndex || 0;
      return rowA - rowB; // Lower row index (older) first
    });

    const outstanding: { [key: string]: Array<{ timestamp: string; qty: number; remainingQty: number }> } = {};

    for (const log of chronoLogs) {
      if (!log.name || !log.user) continue;
      const key = `${log.name.trim()}||${log.user.trim()}`;
      const logQty = Number(log.qty) || 0;

      if (log.type === "대여") {
        if (!outstanding[key]) {
          outstanding[key] = [];
        }
        outstanding[key].push({
          timestamp: log.timestamp,
          qty: logQty,
          remainingQty: logQty,
        });
      } else if (log.type === "반납") {
        let matchedByNote = false;

        if (log.note && (log.note.includes("[즉시반납]") || log.note.includes("[소모완료]"))) {
          const list = outstanding[key] || [];
          for (const item of list) {
            if (item.remainingQty > 0) {
              const formatted = formatTimestampToMinutes(item.timestamp);
              if (log.note.includes(formatted)) {
                item.remainingQty = 0;
                returnedSet.add(item.timestamp);
                matchedByNote = true;
                break;
              }
            }
          }
        }

        if (!matchedByNote) {
          let returnQtyRemaining = logQty;
          const list = outstanding[key] || [];
          for (const item of list) {
            if (item.remainingQty > 0) {
              const deduct = Math.min(item.remainingQty, returnQtyRemaining);
              item.remainingQty -= deduct;
              returnQtyRemaining -= deduct;
              if (item.remainingQty === 0) {
                returnedSet.add(item.timestamp);
              }
              if (returnQtyRemaining <= 0) {
                break;
              }
            }
          }
        }
      }
    }

    return Array.from(returnedSet);
  }, [rentLogs]);

  const allReturnedTimestamps = useMemo(() => {
    const combined = new Set([...computedReturnedTimestamps, ...returnedTimestamps]);
    return Array.from(combined);
  }, [computedReturnedTimestamps, returnedTimestamps]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close item dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter inventory for dropdown autocomplete
  const filteredInventoryItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return inventory;
    return inventory.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q)
    );
  }, [inventory, searchQuery]);

  // Handle local form submission
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!rentUser.trim()) {
      showToast?.("신청자 성함을 입력해 주세요.", "warn");
      return;
    }

    let activeItem = selectedItem;
    let isTempItem = false;

    if (!activeItem && searchQuery.trim()) {
      // 드롭다운에 없는 것을 직접 입력한 경우, 임시 품목으로 자동 처리
      activeItem = {
        rowIndex: -1,
        location: "기타",
        photo: "",
        name: searchQuery.trim(),
        link: "N/A",
        stock: "N/A",
        updatedAt: "",
        manager: "",
        note: "리스트 외 임시 품목",
        spec: "",
      };
      isTempItem = true;
    }

    if (!activeItem) {
      showToast?.("대여 또는 반납할 품목을 선택하거나 검색창에 직접 입력해 주세요.", "warn");
      return;
    }

    if (rentQty <= 0) {
      showToast?.("수량은 1개 이상이어야 합니다.", "warn");
      return;
    }

    // N/A가 아닐 때만 재고 제약 적용 (Bypass if null/N/A)
    if (actionType === "대여" && typeof activeItem.stock === "number" && activeItem.stock !== null) {
      if (activeItem.stock <= 0) {
        showToast?.("선택한 품목의 현재고가 부족하여 대여할 수 없습니다.", "error");
        return;
      }
      if (rentQty > activeItem.stock) {
        showToast?.(`현재고(${activeItem.stock}개)를 초과하여 대여할 수 없습니다.`, "warn");
        return;
      }
    }

    setSubmitting(true);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const customTsStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const log: RentLog = {
        timestamp: customTsStr,
        location: activeItem.location,
        name: activeItem.name,
        type: actionType,
        qty: rentQty,
        user: rentUser.trim(),
        note: noteInput.trim() || `${actionType} 등록${isTempItem ? " (리스트 외 임시 품목)" : ""}`,
      };

      await onAddRentLog(log);
      
      showToast?.(`${activeItem.name} ${rentQty}개 ${actionType} 등록이 완료되었습니다.`, "ok");
      
      // Reset form (except manager name for successive logging convenience)
      setSelectedItem(null);
      setRentQty(1);
      setNoteInput("");
      setSearchQuery("");
      setShowAddForm(false);
    } catch (err: any) {
      showToast?.("등록 실패: " + err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Instant Return execution
  const handleInstantReturn = async (log: RentLog) => {
    if (returningStates[log.timestamp] || allReturnedTimestamps.includes(log.timestamp)) return;

    setReturningStates((prev) => ({ ...prev, [log.timestamp]: true }));
    showToast?.(`${log.name} 즉시 반납 진행 중...`, "info");

    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const customTsStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const returnLog: RentLog = {
        timestamp: customTsStr,
        location: log.location,
        name: log.name,
        type: "반납",
        qty: log.qty,
        user: log.user,
        note: `[즉시반납] ${formatTimestampToMinutes(log.timestamp)} 대여 건 반납 완료`,
      };

      await onAddRentLog(returnLog);
      setReturnedTimestamps((prev) => [...prev, log.timestamp]);
      showToast?.(`${log.name} 반납 처리가 즉시 완료되었습니다!`, "ok");
    } catch (err: any) {
      showToast?.("반납 실패: " + err.message, "error");
    } finally {
      setReturningStates((prev) => ({ ...prev, [log.timestamp]: false }));
    }
  };

  // Instant Consume execution
  const handleInstantConsume = async (log: RentLog) => {
    if (consumingStates[log.timestamp] || allReturnedTimestamps.includes(log.timestamp)) return;

    setConsumingStates((prev) => ({ ...prev, [log.timestamp]: true }));
    showToast?.(`${log.name} 소모 처리 진행 중...`, "info");

    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const customTsStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const consumeLog: RentLog = {
        timestamp: customTsStr,
        location: log.location,
        name: log.name,
        type: "반납",
        qty: log.qty,
        user: log.user,
        note: `[소모완료] ${formatTimestampToMinutes(log.timestamp)} 대여 건 소모 처리 (아예 사용함)`,
      };

      await onAddRentLog(consumeLog);
      setReturnedTimestamps((prev) => [...prev, log.timestamp]);
      showToast?.(`${log.name} 소모(아예 사용) 처리가 완료되었습니다!`, "ok");
    } catch (err: any) {
      showToast?.("소모 처리 실패: " + err.message, "error");
    } finally {
      setConsumingStates((prev) => ({ ...prev, [log.timestamp]: false }));
    }
  };

  // Filter logs for table rendering
  const filteredLogs = useMemo(() => {
    const filtered = rentLogs.filter((log) => {
      const matchesQuery =
        !filterQuery ||
        log.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        log.user.toLowerCase().includes(filterQuery.toLowerCase()) ||
        (log.location && log.location.toLowerCase().includes(filterQuery.toLowerCase())) ||
        (log.note && log.note.toLowerCase().includes(filterQuery.toLowerCase()));

      const matchesType = filterType === "전체" || log.type === filterType;

      // 날짜 범위 필터 (기록 시간 기준)
      let matchesDate = true;
      if (dateFrom || dateTo) {
        const ts = String(log.timestamp || "").slice(0, 10); // YYYY-MM-DD
        if (dateFrom && ts && ts < dateFrom) matchesDate = false;
        if (dateTo && ts && ts > dateTo) matchesDate = false;
        if (!ts) matchesDate = false;
      }

      return matchesQuery && matchesType && matchesDate;
    });

    // Sort by timestamp descending (newest first)
    return [...filtered].sort((a, b) => {
      const timeA = parseDateString(a.timestamp || "");
      const timeB = parseDateString(b.timestamp || "");
      if (timeA !== timeB) {
        return timeB - timeA; // Newer timestamp first
      }
      const rowA = a.rowIndex || 0;
      const rowB = b.rowIndex || 0;
      return rowB - rowA; // Higher row index (newer) first
    });
  }, [rentLogs, filterQuery, filterType, dateFrom, dateTo]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--canvas-bg, #020617)",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: `1px solid ${PANEL_BORDER}`,
          background: "var(--panel-bg, #0f172a)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: TEXT_DIM,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
            }}
          >
            <ArrowLeft size={16} />
            {isGuestMode ? "로그인 화면으로" : "돌아가기"}
          </button>
          <div style={{ width: 1, height: 16, background: PANEL_BORDER }} />
          <h1 style={{ fontSize: 16, fontWeight: 800, color: TEXT_MAIN, display: "flex", alignItems: "center", gap: 6 }}>
            <ArrowRightLeft size={18} style={{ color: ACCENT }} />
            {isGuestMode ? "📦 외부인 대여 및 반납 간편 신청대장" : "📦 물품 대여 및 반납 대장 관리"}
          </h1>
        </div>

        <button
          onClick={() => setShowAddForm((prev) => !prev)}
          style={{
            background: showAddForm ? "rgba(239, 68, 68, 0.15)" : `rgba(99, 102, 241, 0.15)`,
            color: showAddForm ? DANGER : ACCENT,
            border: `1px solid ${showAddForm ? "rgba(239, 68, 68, 0.3)" : "rgba(99, 102, 241, 0.3)"}`,
            borderRadius: "8px",
            padding: "6px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            transition: "all 0.15s",
          }}
        >
          {showAddForm ? (
            <>
              <X size={14} />
              {isGuestMode ? "신청 입력란 접기" : "신청 폼 닫기"}
            </>
          ) : (
            <>
              <Plus size={14} />
              {isGuestMode ? "대여/반납 신청란 열기" : "신규 대여/반납 등록"}
            </>
          )}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", flexDirection: "column" }}>
        
        {/* Collapsible Add Form */}
        {showAddForm && (
          <div
            style={{
              padding: "20px 24px",
              background: "var(--panel-bg, #0f172a)",
              borderBottom: `2px solid ${PANEL_BORDER}`,
              boxShadow: "inset 0 -10px 20px -10px rgba(0,0,0,0.3)",
              animation: "slideDown 0.2s ease-out",
            }}
          >
            <form onSubmit={handleFormSubmit} style={{ maxWidth: "1100px", margin: "0 auto" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 700, color: TEXT_MAIN, marginBottom: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Plus size={16} style={{ color: ACCENT }} />
                {isGuestMode ? "외부인 대여 / 반납 직접 등록 및 신청" : "간편 신규 대여 / 반납 직접 등록"}
              </h3>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "16px",
                  alignItems: "end",
                }}
              >
                {/* 1. 구분 (대여 / 반납 / 소모) */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>구분</label>
                  <div style={{ display: "flex", background: "var(--input-bg, #020617)", borderRadius: "8px", padding: "3px", border: `1px solid ${PANEL_BORDER}`, gap: "2px" }}>
                    <button
                      type="button"
                      onClick={() => setActionType("대여")}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        background: actionType === "대여" ? ACCENT : "transparent",
                        color: actionType === "대여" ? "#ffffff" : TEXT_DIM,
                        transition: "all 0.15s",
                      }}
                    >
                      대여
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionType("반납")}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        background: actionType === "반납" ? OK : "transparent",
                        color: actionType === "반납" ? "#ffffff" : TEXT_DIM,
                        transition: "all 0.15s",
                      }}
                    >
                      반납
                    </button>
                    <button
                      type="button"
                      onClick={() => setActionType("소모")}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        background: actionType === "소모" ? WARNING : "transparent",
                        color: actionType === "소모" ? "#ffffff" : TEXT_DIM,
                        transition: "all 0.15s",
                      }}
                    >
                      소모
                    </button>
                  </div>
                </div>

                {/* 2. 신청자 성함 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>신청자 성함</label>
                  <div style={{ position: "relative" }}>
                    <User size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
                    <input
                      type="text"
                      placeholder="신청자명 입력"
                      value={rentUser}
                      onChange={(e) => setRentUser(e.target.value)}
                      required
                      style={{
                        width: "100%",
                        padding: "7px 10px 7px 30px",
                        borderRadius: "8px",
                        background: "var(--input-bg, #020617)",
                        border: `1px solid ${PANEL_BORDER}`,
                        color: TEXT_MAIN,
                        fontSize: "12px",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>

                {/* 3. 품목 검색 및 선택 */}
                <div ref={dropdownRef} style={{ display: "flex", flexDirection: "column", gap: "6px", position: "relative" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>품목 검색 및 선택</label>
                  <div
                    onClick={() => setIsDropdownOpen(true)}
                    style={{ position: "relative" }}
                  >
                    <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
                    <input
                      type="text"
                      placeholder={selectedItem ? `${selectedItem.name} (${selectedItem.location})` : "자재명/보관소 검색..."}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (selectedItem) setSelectedItem(null); // 수정하기 시작하면 리셋
                        setIsDropdownOpen(true);
                      }}
                      style={{
                        width: "100%",
                        padding: "7px 24px 7px 30px",
                        borderRadius: "8px",
                        background: "var(--input-bg, #020617)",
                        border: selectedItem ? `1.5px solid ${OK}` : `1px solid ${PANEL_BORDER}`,
                        color: selectedItem ? OK : TEXT_MAIN,
                        fontSize: "12px",
                        outline: "none",
                        fontWeight: selectedItem ? 700 : "normal",
                      }}
                    />
                    <ChevronDown size={14} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM, cursor: "pointer" }} />
                  </div>

                  {/* Autocomplete Dropdown */}
                  {isDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        background: "var(--panel-bg, #0f172a)",
                        border: `1px solid ${PANEL_BORDER}`,
                        borderRadius: "8px",
                        marginTop: "4px",
                        maxHeight: "220px",
                        overflowY: "auto",
                        zIndex: 100,
                        boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5)",
                      }}
                    >
                      {/* 검색어 입력 시, 목록에 없는 새로운 물건 직접 신청용 버튼 노출 */}
                      {searchQuery.trim() !== "" && (
                        <div
                          onClick={() => {
                            const tempItem: InventoryItem = {
                              rowIndex: -1,
                              location: "기타",
                              photo: "",
                              name: searchQuery.trim(),
                              link: "N/A",
                              stock: "N/A",
                              updatedAt: "",
                              manager: "",
                              note: "리스트 외 임시 품목",
                              spec: "",
                            };
                            setSelectedItem(tempItem);
                            setSearchQuery("");
                            setIsDropdownOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "10px 12px",
                            borderBottom: `1px solid ${PANEL_BORDER}`,
                            cursor: "pointer",
                            background: "rgba(99, 102, 241, 0.12)",
                            color: "#818cf8",
                          }}
                        >
                          <span style={{ fontSize: "14px" }}>➕</span>
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700 }}>
                              "{searchQuery.trim()}" (새 임시 물품으로 직접 대여/반납 신청)
                            </div>
                            <div style={{ fontSize: "10px", color: TEXT_DIM }}>
                              목록에 없으므로 임시 지정하여 대여/반납 목록에 추가합니다.
                            </div>
                          </div>
                        </div>
                      )}

                      {filteredInventoryItems.length === 0 ? (
                        searchQuery.trim() === "" ? (
                          <div style={{ padding: "10px", fontSize: "12px", color: TEXT_DIM, textAlign: "center" }}>
                            검색된 자재가 없습니다.
                          </div>
                        ) : null
                      ) : (
                        filteredInventoryItems.map((item) => (
                          <div
                            key={item.rowIndex}
                            onClick={() => {
                              setSelectedItem(item);
                              setSearchQuery("");
                              setIsDropdownOpen(false);
                            }}
                            style={{
                              padding: "8px 12px",
                              fontSize: "12px",
                              borderBottom: `1px solid ${PANEL_BORDER}`,
                              cursor: "pointer",
                              color: TEXT_MAIN,
                              display: "flex",
                              justifyContent: "space-between",
                              background: selectedItem?.rowIndex === item.rowIndex ? "rgba(99, 102, 241, 0.1)" : "transparent",
                            }}
                          >
                            <span style={{ fontWeight: 600 }}>{item.name}</span>
                            <span style={{ color: TEXT_DIM, fontSize: "11px" }}>
                              위치: {item.location} | 재고: {item.stock === null ? "N/A" : `${item.stock}개`}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* 4. 신청 수량 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>
                    수량 {selectedItem && selectedItem.stock !== null && `(최대 ${selectedItem.stock}개)`}
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => setRentQty(prev => Math.max(1, prev - 1))}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "6px",
                        border: `1px solid ${PANEL_BORDER}`,
                        background: "var(--input-bg, #020617)",
                        color: TEXT_MAIN,
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={rentQty}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setRentQty(isNaN(val) || val <= 0 ? 1 : val);
                      }}
                      style={{
                        width: "55px",
                        height: "32px",
                        borderRadius: "6px",
                        background: "var(--input-bg, #020617)",
                        border: `1px solid ${PANEL_BORDER}`,
                        color: TEXT_MAIN,
                        textAlign: "center",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setRentQty(prev => prev + 1)}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "6px",
                        border: `1px solid ${PANEL_BORDER}`,
                        background: "var(--input-bg, #020617)",
                        color: TEXT_MAIN,
                        fontWeight: "bold",
                        cursor: "pointer",
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* 5. 사유 / 비고 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>비고 (사유 등)</label>
                  <input
                    type="text"
                    placeholder="대여/반납 목적 또는 사유 기입"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      borderRadius: "8px",
                      background: "var(--input-bg, #020617)",
                      border: `1px solid ${PANEL_BORDER}`,
                      color: TEXT_MAIN,
                      fontSize: "12px",
                      outline: "none",
                    }}
                  />
                </div>

                {/* 6. 제출 버튼 */}
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    height: "32px",
                    background: actionType === "대여" ? ACCENT : OK,
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 800,
                    cursor: submitting ? "not-allowed" : "pointer",
                    padding: "0 16px",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? "등록 중..." : `${actionType} 등록 완료`}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Right Side: Logs Search Table */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px", overflow: "hidden" }}>
          
          {/* Filters Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {/* Search Input */}
            <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
              <input
                type="text"
                placeholder="품목명, 신청자, 위치, 사유 검색..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 10px 7px 30px",
                  borderRadius: 6,
                  background: "var(--panel-bg, #0f172a)",
                  border: `1px solid ${PANEL_BORDER}`,
                  color: TEXT_MAIN,
                  fontSize: 12,
                }}
              />
            </div>

            {/* Type buttons */}
            <div style={{ display: "flex", gap: 6, background: "var(--panel-bg, #0f172a)", padding: 3, borderRadius: 6, border: `1px solid ${PANEL_BORDER}` }}>
              {["전체", "대여", "반납", "소모"].map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: filterType === t ? (t === "대여" ? "rgba(99,102,241,0.2)" : t === "반납" ? "rgba(16,185,129,0.2)" : t === "소모" ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.1)") : "transparent",
                    color: filterType === t ? (t === "대여" ? ACCENT : t === "반납" ? OK : t === "소모" ? WARNING : TEXT_MAIN) : TEXT_DIM,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* 날짜 범위 필터 */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", background: "var(--panel-bg, #0f172a)", padding: "3px 8px", borderRadius: 6, border: `1px solid ${PANEL_BORDER}` }}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="시작일" style={{ background: "transparent", border: "none", color: TEXT_MAIN, fontSize: 11, outline: "none" }} />
              <span style={{ color: TEXT_DIM, fontSize: 11 }}>~</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="종료일" style={{ background: "transparent", border: "none", color: TEXT_MAIN, fontSize: 11, outline: "none" }} />
              {(dateFrom || dateTo) ? (
                <button onClick={() => { setDateFrom(""); setDateTo(""); }} title="날짜 필터 해제" style={{ background: "transparent", border: "none", color: TEXT_DIM, cursor: "pointer", fontSize: 13, padding: "0 2px" }}>✕</button>
              ) : null}
            </div>
          </div>

          {/* Table Container */}
          <div
            style={{
              flex: 1,
              background: "var(--panel-bg, #0f172a)",
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 8,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--input-bg, #020617)", zIndex: 1, borderBottom: `1px solid ${PANEL_BORDER}` }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>기록 시각</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>구분</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>품목명</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>위치</th>
                    <th style={{ textAlign: "center", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>수량</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>신청자</th>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600 }}>사유 / 비고</th>
                    <th style={{ textAlign: "center", padding: "10px 14px", color: TEXT_DIM, fontWeight: 600, width: "180px" }}>즉시 반납/소모</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "40px", color: TEXT_DIM }}>
                        <FileText size={24} style={{ margin: "0 auto 8px", opacity: 0.3, display: "block" }} />
                        조회된 대여/반납 로그 기록이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log, index) => {
                      const isReturned = allReturnedTimestamps.includes(log.timestamp);
                      const isReturning = returningStates[log.timestamp] || false;
                      const isConsuming = consumingStates[log.timestamp] || false;

                      // Check if resolved as consumed
                      let isConsumed = false;
                      if (isReturned) {
                        const formatted = formatTimestampToMinutes(log.timestamp);
                        isConsumed = rentLogs.some(
                          (l) => l.note && l.note.includes("[소모완료]") && l.note.includes(formatted)
                        );
                      }

                      // 반납 예정일 파싱 및 연체 판단 (대여 건이고, 미반납이며, 예정일이 오늘보다 이전)
                      const dueMatch = log.note ? log.note.match(/\[반납예정:(\d{4}-\d{2}-\d{2})\]/) : null;
                      const dueDate = dueMatch ? dueMatch[1] : "";
                      const todayStr = new Date().toISOString().slice(0, 10);
                      const isOverdue = log.type === "대여" && !isReturned && dueDate && dueDate < todayStr;

                      return (
                        <tr
                          key={index}
                          style={{
                            borderBottom: `1px solid ${PANEL_BORDER}`,
                            background: isOverdue ? "rgba(239,68,68,0.10)" : index % 2 === 1 ? "rgba(255,255,255,0.01)" : "transparent",
                          }}
                        >
                          <td style={{ padding: "11px 14px", color: TEXT_DIM, whiteSpace: "nowrap" }}>
                            {formatTimestampToMinutes(log.timestamp)}
                          </td>
                          <td style={{ padding: "11px 14px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 800,
                                background: log.type === "대여" ? "rgba(99, 102, 241, 0.15)" : log.type === "소모" ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                                color: log.type === "대여" ? ACCENT : log.type === "소모" ? WARNING : OK,
                              }}
                            >
                              {log.type === "대여" ? "대여" : log.type === "소모" ? "소모" : "반납"}
                            </span>
                          </td>
                          <td style={{ padding: "11px 14px", color: TEXT_MAIN, fontWeight: 600 }}>
                            {log.name}
                          </td>
                          <td style={{ padding: "11px 14px", color: TEXT_DIM }}>
                            <span className="mono" style={{ fontSize: 11, background: "rgba(255,255,255,0.04)", padding: "2px 5px", borderRadius: 3 }}>
                              {log.location || "-"}
                            </span>
                          </td>
                          <td style={{ padding: "11px 14px", textAlign: "center", color: TEXT_MAIN, fontWeight: 700 }}>
                            {log.qty}개
                          </td>
                          <td style={{ padding: "11px 14px", color: TEXT_MAIN }}>
                            {log.user}
                          </td>
                          <td style={{ padding: "11px 14px", color: TEXT_DIM, maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.note}>
                            {dueDate ? (
                              <span style={{ display: "inline-block", marginRight: 6, fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: isOverdue ? "rgba(239,68,68,0.2)" : "rgba(99,102,241,0.15)", color: isOverdue ? "#f87171" : ACCENT }}>
                                {isOverdue ? `연체 (예정 ${dueDate})` : `예정 ${dueDate}`}
                              </span>
                            ) : null}
                            {(log.note || "-").replace(/\s*\[반납예정:\d{4}-\d{2}-\d{2}\]/, "") || "-"}
                          </td>
                          <td style={{ padding: "11px 14px", textAlign: "center" }}>
                            {log.type === "대여" ? (
                              isReturned ? (
                                isConsumed ? (
                                  <span
                                    style={{
                                      background: "rgba(245, 158, 11, 0.15)",
                                      color: WARNING,
                                      border: `1px solid rgba(245, 158, 11, 0.3)`,
                                      borderRadius: "6px",
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px",
                                    }}
                                  >
                                    <Check size={12} />
                                    소모 완료
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      background: "rgba(16, 185, 129, 0.15)",
                                      color: OK,
                                      border: `1px solid rgba(16, 185, 129, 0.3)`,
                                      borderRadius: "6px",
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px",
                                    }}
                                  >
                                    <Check size={12} />
                                    반납 완료
                                  </span>
                                )
                              ) : (
                                <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                                  <button
                                    onClick={() => handleInstantReturn(log)}
                                    disabled={isReturning || isConsuming}
                                    style={{
                                      background: isReturning ? "rgba(165,180,252,0.1)" : "rgba(16, 185, 129, 0.15)",
                                      color: isReturning ? TEXT_DIM : OK,
                                      border: `1px solid ${isReturning ? "transparent" : "rgba(16, 185, 129, 0.3)"}`,
                                      borderRadius: "6px",
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      cursor: (isReturning || isConsuming) ? "not-allowed" : "pointer",
                                      transition: "all 0.15s",
                                      whiteSpace: "nowrap",
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isReturning && !isConsuming) {
                                        e.currentTarget.style.background = OK;
                                        e.currentTarget.style.color = "#ffffff";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isReturning && !isConsuming) {
                                        e.currentTarget.style.background = "rgba(16, 185, 129, 0.15)";
                                        e.currentTarget.style.color = OK;
                                      }
                                    }}
                                  >
                                    {isReturning ? "처리 중" : "즉시 반납"}
                                  </button>
                                  <button
                                    onClick={() => handleInstantConsume(log)}
                                    disabled={isReturning || isConsuming}
                                    style={{
                                      background: isConsuming ? "rgba(253,186,116,0.1)" : "rgba(245, 158, 11, 0.15)",
                                      color: isConsuming ? TEXT_DIM : WARNING,
                                      border: `1px solid ${isConsuming ? "transparent" : "rgba(245, 158, 11, 0.3)"}`,
                                      borderRadius: "6px",
                                      padding: "4px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      cursor: (isReturning || isConsuming) ? "not-allowed" : "pointer",
                                      transition: "all 0.15s",
                                      whiteSpace: "nowrap",
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isReturning && !isConsuming) {
                                        e.currentTarget.style.background = WARNING;
                                        e.currentTarget.style.color = "#ffffff";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isReturning && !isConsuming) {
                                        e.currentTarget.style.background = "rgba(245, 158, 11, 0.15)";
                                        e.currentTarget.style.color = WARNING;
                                      }
                                    }}
                                  >
                                    {isConsuming ? "처리 중" : "소모 처리"}
                                  </button>
                                </div>
                              )
                            ) : (
                              <span style={{ color: TEXT_DIM }}>-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            {/* Table Footer */}
            <div style={{ padding: "10px 14px", borderTop: `1px solid ${PANEL_BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--input-bg, #020617)", fontSize: 11, color: TEXT_DIM }}>
              <div>전체 로그: {rentLogs.length}건 / 필터 결과: {filteredLogs.length}건</div>
              <div>
                {isGuestMode 
                  ? "대여 및 반납 신청은 구글 스프레드시트에 즉시 저장되며, 실시간 재고에 자동 연동됩니다." 
                  : <>대여 로그는 구글 스프레드시트의 <strong>RentLog</strong> 시트에 실시간 동기화됩니다.</>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Animation Styles */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
