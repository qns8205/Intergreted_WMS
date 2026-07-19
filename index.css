import React, { useState, useMemo, useEffect, useRef } from "react";
import { InventoryItem, RentLog } from "../types";
import { ArrowLeft, Search, Check, ChevronDown, Package, User, Calendar, FileText, Image as ImageIcon } from "lucide-react";
import { formatTimestampLocal, getGoogleDriveImageUrl, isFuzzyMatch } from "../utils/drive";

interface RentalPageProps {
  inventory: InventoryItem[];
  onAddRentLog: (log: RentLog) => Promise<void>;
  onBack: () => void;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  connected: boolean;
  lastSync: Date | null;
  onOpenSetup: () => void;
}

export default function RentalPage({
  inventory,
  onAddRentLog,
  onBack,
  isLightMode,
  showToast,
  connected,
  lastSync,
  onOpenSetup,
}: RentalPageProps) {
  // 상태 선언
  const [rentUser, setRentUser] = useState("");
  const [actionType, setActionType] = useState<"대여" | "반납" | "소모">("대여");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [rentQty, setRentQty] = useState(1);
  const [noteInput, setNoteInput] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 리스트에 없는 임시 물품 추가 모드 상태
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customLocation, setCustomLocation] = useState("기타");

  // Cart for multiple items
  const [cart, setCart] = useState<{
    id: string;
    item: InventoryItem;
    qty: number;
    type: "대여" | "반납";
    note: string;
  }[]>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 드롭다운 외부 클릭 감지하여 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // 검색 쿼리에 따라 물품 필터링
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return inventory;
    return inventory.filter(
      (item) =>
        isFuzzyMatch(item.name || "", searchQuery) ||
        isFuzzyMatch(item.location || "", searchQuery) ||
        (item.spec && isFuzzyMatch(item.spec, searchQuery))
    );
  }, [inventory, searchQuery]);

  // 아이템 선택 시 기본 대여량 조절
  const handleSelectItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setRentQty(1);
    setNoteInput("");
    setIsDropdownOpen(false);
  };

  // 장바구니에 품목 임시 추가
  const handleAddToCart = () => {
    if (isCustomMode) {
      if (!customName.trim()) {
        showToast("물품 이름을 입력해 주세요.", "warn");
        return;
      }
      if (rentQty <= 0) {
        showToast("수량은 1개 이상이어야 합니다.", "warn");
        return;
      }

      const customItem: InventoryItem = {
        rowIndex: -1,
        location: customLocation.trim() || "기타",
        photo: "",
        name: customName.trim(),
        link: "N/A",
        stock: "N/A",
        updatedAt: "",
        manager: "",
        note: "리스트 외 임시 품목",
        spec: "",
      };

      const newCartItem = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
        item: customItem,
        qty: rentQty,
        type: actionType,
        note: noteInput.trim() || `${actionType} 신청 (리스트 외 품목)`,
      };

      setCart((prev) => [...prev, newCartItem]);
      showToast(`${customItem.name} ${rentQty}개가 신청 목록에 임시 추가되었습니다.`, "info");

      // 자재 입력 영역 리셋
      setCustomName("");
      setCustomLocation("기타");
      setRentQty(1);
      setNoteInput("");
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
      showToast("대여 또는 반납할 품목을 선택하거나 검색창에 직접 입력해 주세요.", "warn");
      return;
    }
    if (rentQty <= 0) {
      showToast("수량은 1개 이상이어야 합니다.", "warn");
      return;
    }

    // 대여 또는 소모일 때 재고 검증 (재고 수량이 숫자일 때만 수행)
    if ((actionType === "대여" || actionType === "소모") && typeof activeItem.stock === "number") {
      const currentStock = activeItem.stock ?? 0;
      if (currentStock <= 0) {
        showToast("선택한 물품의 현재고가 부족하여 대여/소모할 수 없습니다.", "error");
        return;
      }
      
      // 장바구니에 담긴 동일 품목의 대여/소모 수량 합산
      const alreadyInCartQty = cart
        .filter((c) => c.item.name === activeItem!.name && (c.type === "대여" || c.type === "소모"))
        .reduce((acc, c) => acc + c.qty, 0);

      if ((rentQty + alreadyInCartQty) > currentStock) {
        showToast(`현재고(${currentStock}개)를 초과하여 신청 장바구니에 담을 수 없습니다. (현재 장바구니: ${alreadyInCartQty}개)`, "warn");
        return;
      }
    }

    const newCartItem = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
      item: activeItem,
      qty: rentQty,
      type: actionType,
      note: noteInput.trim() || `${actionType} 신청${isTempItem ? " (리스트 외 임시 품목)" : ""}`,
    };

    setCart((prev) => [...prev, newCartItem]);
    showToast(`${activeItem.name} ${rentQty}개가 신청 목록에 임시 추가되었습니다.`, "info");

    // 자재 입력 영역만 리셋 (담당자는 유지)
    setSelectedItem(null);
    setRentQty(1);
    setNoteInput("");
    setSearchQuery("");
  };

  // 장바구니에서 특정 행 삭제
  const handleRemoveFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
    showToast("신청 목록에서 제외했습니다.", "info");
  };

  // 대여/반납 신청서 일괄 제출 처리
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!rentUser.trim()) {
      const roleName = actionType === "대여" ? "대여자" : actionType === "반납" ? "반납자" : "소모자";
      showToast(`${roleName} 이름을 입력해 주세요.`, "warn");
      return;
    }
    if (cart.length === 0) {
      showToast("신청 목록에 품목을 1개 이상 추가해 주세요.", "warn");
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date();
      // 순차적으로 등록
      for (let i = 0; i < cart.length; i++) {
        const cartItem = cart[i];
        
        // 시간 중복으로 인한 스프레드시트 덮어쓰기 등을 막기 위해 미세 조정한 로컬 타임스탬프 구성
        const baseTime = new Date(now.getTime() + i * 1000);
        const pad = (n: number) => String(n).padStart(2, "0");
        const customTsStr = `${baseTime.getFullYear()}-${pad(baseTime.getMonth() + 1)}-${pad(baseTime.getDate())} ${pad(baseTime.getHours())}:${pad(baseTime.getMinutes())}:${pad(baseTime.getSeconds())}`;

        const log: RentLog = {
          timestamp: customTsStr,
          location: cartItem.item.location,
          name: cartItem.item.name,
          type: cartItem.type,
          qty: cartItem.qty,
          user: rentUser.trim(),
          note: cartItem.note,
        };
        await onAddRentLog(log);
      }

      // 초기화
      setCart([]);
      setRentUser("");
      showToast(`총 ${cart.length}건의 대여/반납 신청서가 성공적으로 일괄 접수되었습니다!`, "ok");
    } catch (err: any) {
      showToast("신청 처리에 실패했습니다: " + err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: isLightMode ? "#f8fafc" : "#0b0f19",
        color: isLightMode ? "#0f172a" : "#f1f5f9",
        padding: "40px 20px",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* 뒤로가기 버튼 */}
      <div style={{ maxWidth: "1000px", width: "100%", marginBottom: "24px", display: "flex", justifyContent: "flex-start" }}>
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: isLightMode ? "#ffffff" : "#1e293b",
            border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
            color: isLightMode ? "#475569" : "#94a3b8",
            fontSize: "13px",
            fontWeight: 700,
            cursor: "pointer",
            padding: "10px 16px",
            borderRadius: "12px",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateX(0)";
          }}
        >
          <ArrowLeft size={16} />
          처음 화면으로
        </button>
      </div>

      {/* 실시간 연동 상태 바 */}
      <div
        style={{
          maxWidth: "1000px",
          width: "100%",
          background: connected ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
          border: connected ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(245, 158, 11, 0.25)",
          borderRadius: "14px",
          padding: "12px 20px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: connected ? "#10b981" : "#f59e0b",
              boxShadow: connected ? "0 0 10px #10b981" : "0 0 10px #f59e0b",
              display: "inline-block",
            }}
          />
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: 700, color: connected ? (isLightMode ? "#047857" : "#34d399") : (isLightMode ? "#b45309" : "#fbbf24"), marginRight: "8px" }}>
              {connected ? "구글 시트 실시간 연동 활성화" : "데모 가상 모드 작동 중"}
            </span>
            <span style={{ color: isLightMode ? "#475569" : "#94a3b8", fontSize: "12px" }}>
              {connected 
                ? `(10초 주기 실시간 자동 동기화 중 | 최근 동기화: ${lastSync ? lastSync.toLocaleTimeString() : "진행 중..."})`
                : "(스프레드시트 미연동 상태로, 기록이 파일에 보존되지 않습니다)"}
            </span>
          </div>
        </div>
        <button
          onClick={onOpenSetup}
          style={{
            background: connected ? "rgba(99, 102, 241, 0.15)" : "#f59e0b",
            color: connected ? "#6366f1" : "#ffffff",
            border: "none",
            borderRadius: "8px",
            padding: "6px 14px",
            fontSize: "12px",
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {connected ? "연동 설정 확인" : "구글 시트 연동 설정하기"}
        </button>
      </div>

      <div
        style={{
          maxWidth: "1000px",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "32px",
        }}
      >
        {/* 왼쪽: 대여/반납 신청 폼 */}
        <div
          style={{
            background: isLightMode ? "#ffffff" : "#151d30",
            border: `1px solid ${isLightMode ? "#e2e8f0" : "#222f4b"}`,
            borderRadius: "24px",
            padding: "32px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)",
          }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: 800, color: isLightMode ? "#0f172a" : "#f1f5f9", marginBottom: "8px" }}>
            📋 대여 및 반납 신청서
          </h2>
          <p style={{ fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8", marginBottom: "24px" }}>
            필요한 자재의 대여 또는 반납을 신청하면 실시간으로 재고가 정산됩니다.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            
            {/* 대여 / 반납 / 소모 토글 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                구분
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", background: isLightMode ? "#f1f5f9" : "#0f172a", padding: "4px", borderRadius: "10px" }}>
                <button
                  type="button"
                  onClick={() => setActionType("대여")}
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: actionType === "대여" ? "#4f46e5" : "transparent",
                    color: actionType === "대여" ? "#ffffff" : (isLightMode ? "#475569" : "#94a3b8"),
                    transition: "all 0.2s",
                  }}
                >
                  📥 자재 대여
                </button>
                <button
                  type="button"
                  onClick={() => setActionType("반납")}
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: actionType === "반납" ? "#10b981" : "transparent",
                    color: actionType === "반납" ? "#ffffff" : (isLightMode ? "#475569" : "#94a3b8"),
                    transition: "all 0.2s",
                  }}
                >
                  🔄 자재 반납
                </button>
                <button
                  type="button"
                  onClick={() => setActionType("소모")}
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "none",
                    cursor: "pointer",
                    background: actionType === "소모" ? "#f59e0b" : "transparent",
                    color: actionType === "소모" ? "#ffffff" : (isLightMode ? "#475569" : "#94a3b8"),
                    transition: "all 0.2s",
                  }}
                >
                  🔥 자재 소모
                </button>
              </div>
            </div>

            {/* 대여자 / 반납자 / 소모자 이름 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                {actionType === "대여" ? "대여자" : actionType === "반납" ? "반납자" : "소모자"} <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <User size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: isLightMode ? "#94a3b8" : "#64748b" }} />
                <input
                  type="text"
                  placeholder="예: 홍길동"
                  value={rentUser}
                  onChange={(e) => setRentUser(e.target.value)}
                  style={{
                    width: "100%",
                    background: isLightMode ? "#f8fafc" : "#0f172a",
                    border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                    borderRadius: "10px",
                    padding: "10px 12px 10px 38px",
                    color: isLightMode ? "#0f172a" : "#f1f5f9",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            {/* 대여 품목 선택 드롭다운 및 검색창 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                  품목 검색 및 선택 <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomMode(!isCustomMode);
                    setSelectedItem(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#6366f1",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  {isCustomMode ? "🔍 기존 리스트에서 선택" : "✏️ 리스트에 없는 새 물건 입력"}
                </button>
              </div>
              
              {isCustomMode ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: isLightMode ? "rgba(99, 102, 241, 0.03)" : "rgba(99, 102, 241, 0.05)", padding: "14px", borderRadius: "12px", border: `1px dashed ${isLightMode ? "#cbd5e1" : "#334155"}` }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>임시 품목명</span>
                    <input
                      type="text"
                      placeholder="예: 특수 고정용 고무 밴드"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      style={{
                        width: "100%",
                        background: isLightMode ? "#ffffff" : "#0f172a",
                        border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                        borderRadius: "8px",
                        padding: "8px 12px",
                        color: isLightMode ? "#0f172a" : "#f1f5f9",
                        fontSize: "13px",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>보관 위치</span>
                    <input
                      type="text"
                      placeholder="예: 기타, N/A, A-1-1"
                      value={customLocation}
                      onChange={(e) => setCustomLocation(e.target.value)}
                      style={{
                        width: "100%",
                        background: isLightMode ? "#ffffff" : "#0f172a",
                        border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                        borderRadius: "8px",
                        padding: "8px 12px",
                        color: isLightMode ? "#0f172a" : "#f1f5f9",
                        fontSize: "13px",
                        outline: "none",
                      }}
                    />
                  </div>
                  <p style={{ fontSize: "10.5px", color: isLightMode ? "#64748b" : "#94a3b8", lineHeight: "1.4", margin: 0 }}>
                    ⚠️ 입력하신 물품명과 위치는 <strong>일회성 로그</strong>에만 기록되며, 메인 창고 자재 마스터 목록에는 저장되지 않습니다.
                  </p>
                </div>
              ) : (
                <div ref={dropdownRef} style={{ position: "relative" }}>
                {/* 검색 필드 */}
                <div style={{ position: "relative", marginBottom: "4px" }}>
                  <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: isLightMode ? "#94a3b8" : "#64748b" }} />
                  <input
                    type="text"
                    placeholder="품목 이름, 규격 또는 위치 검색..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsDropdownOpen(true);
                    }}
                    onFocus={() => setIsDropdownOpen(true)}
                    style={{
                      width: "100%",
                      background: isLightMode ? "#f8fafc" : "#0f172a",
                      border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                      borderRadius: "10px",
                      padding: "10px 12px 10px 38px",
                      color: isLightMode ? "#0f172a" : "#f1f5f9",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>

                {/* 선택된 품목 트리거 버튼 (드롭다운 열기/닫기) */}
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: isLightMode ? "#f8fafc" : "#0f172a",
                    border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                    borderRadius: "10px",
                    padding: "12px",
                    color: selectedItem ? (isLightMode ? "#0f172a" : "#f1f5f9") : (isLightMode ? "#94a3b8" : "#64748b"),
                    fontSize: "13px",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {selectedItem ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {selectedItem.photo ? (
                        <img
                          src={getGoogleDriveImageUrl(selectedItem.photo)}
                          alt={selectedItem.name}
                          referrerPolicy="no-referrer"
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "6px",
                            objectFit: "cover",
                            border: "1px solid rgba(0,0,0,0.1)",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "6px",
                            background: "rgba(99,102,241,0.1)",
                            color: "#6366f1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Package size={16} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 700 }}>{selectedItem.name}</div>
                        <div style={{ fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
                          위치: {selectedItem.location} | 재고: {selectedItem.stock === "N/A" || selectedItem.stock === null ? "N/A" : `${selectedItem.stock}개`}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span>--- 대여할 품목을 선택해 주세요 ---</span>
                  )}
                  <ChevronDown size={16} style={{ color: isLightMode ? "#64748b" : "#94a3b8" }} />
                </button>

                {/* 커스텀 이미지 드롭다운 메뉴 */}
                {isDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      background: isLightMode ? "#ffffff" : "#1e293b",
                      border: `1px solid ${isLightMode ? "#cbd5e1" : "#334155"}`,
                      borderRadius: "12px",
                      marginTop: "6px",
                      maxHeight: "260px",
                      overflowY: "auto",
                      zIndex: 1000,
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
                    }}
                  >
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
                          handleSelectItem(tempItem);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "10px 12px",
                          borderBottom: `1px solid ${isLightMode ? "#cbd5e1" : "#334155"}`,
                          cursor: "pointer",
                          background: isLightMode ? "rgba(99, 102, 241, 0.05)" : "rgba(99, 102, 241, 0.12)",
                          color: "#6366f1",
                        }}
                      >
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "8px",
                            background: "rgba(99, 102, 241, 0.15)",
                            color: "#6366f1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "14px"
                          }}
                        >
                          ➕
                        </div>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontSize: "13px", fontWeight: 700 }}>
                            "{searchQuery.trim()}" (새 임시 물품으로 직접 대여/반납 신청)
                          </div>
                          <div style={{ fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
                            목록에 없으므로 임시 지정하여 대여/반납 목록에 추가합니다.
                          </div>
                        </div>
                      </div>
                    )}

                    {filteredItems.length === 0 ? (
                      searchQuery.trim() === "" ? (
                        <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
                          일치하는 자재 품목이 없습니다.
                        </div>
                      ) : null
                    ) : (
                      filteredItems.map((item) => {
                        const isSelected = selectedItem?.rowIndex === item.rowIndex;
                        return (
                          <div
                            key={item.rowIndex}
                            onClick={() => handleSelectItem(item)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "10px 12px",
                              borderBottom: `1px solid ${isLightMode ? "#f1f5f9" : "#222f4b"}`,
                              cursor: "pointer",
                              background: isSelected
                                ? "rgba(99,102,241,0.08)"
                                : "transparent",
                              transition: "background 0.2s",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) e.currentTarget.style.background = isLightMode ? "#f8fafc" : "#273549";
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              {item.photo ? (
                                <img
                                  src={getGoogleDriveImageUrl(item.photo)}
                                  alt={item.name}
                                  referrerPolicy="no-referrer"
                                  style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    objectFit: "cover",
                                    border: "1px solid rgba(0,0,0,0.1)",
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: "36px",
                                    height: "36px",
                                    borderRadius: "8px",
                                    background: "rgba(99,102,241,0.08)",
                                    color: "#6366f1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Package size={18} />
                                </div>
                              )}
                              <div style={{ textAlign: "left" }}>
                                <div style={{ fontSize: "13px", fontWeight: 700, color: isLightMode ? "#1e293b" : "#f1f5f9" }}>{item.name}</div>
                                <div style={{ fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
                                  위치: <span style={{ color: "#6366f1", fontWeight: 600 }}>{item.location}</span> | 재고: <span style={{ color: "#10b981", fontWeight: 600 }}>{item.stock ?? 0}개</span>
                                </div>
                              </div>
                            </div>
                            {isSelected && <Check size={16} style={{ color: "#6366f1" }} />}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              )}
            </div>

            {/* 수량 입력 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                대여/반납 수량 <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setRentQty((prev) => Math.max(1, prev - 1))}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    background: isLightMode ? "#f1f5f9" : "#0f172a",
                    border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                    color: isLightMode ? "#475569" : "#f1f5f9",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "bold",
                    width: "40px",
                  }}
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  value={rentQty}
                  onChange={(e) => setRentQty(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    background: isLightMode ? "#f8fafc" : "#0f172a",
                    border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                    borderRadius: "10px",
                    padding: "10px 12px",
                    color: isLightMode ? "#0f172a" : "#f1f5f9",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if ((actionType === "대여" || actionType === "소모") && selectedItem && rentQty >= (selectedItem.stock ?? 0)) {
                      showToast("재고를 초과할 수 없습니다.", "warn");
                      return;
                    }
                    setRentQty((prev) => prev + 1);
                  }}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    background: isLightMode ? "#f1f5f9" : "#0f172a",
                    border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                    color: isLightMode ? "#475569" : "#f1f5f9",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "bold",
                    width: "40px",
                  }}
                >
                  +
                </button>
              </div>
              {(actionType === "대여" || actionType === "소모") && selectedItem && (selectedItem.stock ?? 0) < rentQty && (
                <span style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px" }}>
                  ⚠️ 현재고({selectedItem.stock ?? 0}개)를 초과했습니다. 대여/소모 신청을 완료할 수 없습니다.
                </span>
              )}
            </div>

            {/* 특이사항 / 대여 용도 */}
            {/* 장바구니 담기 버튼 */}
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={submitting}
              style={{
                width: "100%",
                background: actionType === "대여" ? "#4f46e5" : actionType === "소모" ? "#f59e0b" : "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "12px",
                padding: "12px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: `0 4px 14px ${actionType === "대여" ? "rgba(79, 70, 229, 0.3)" : actionType === "소모" ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
                opacity: submitting ? 0.5 : 1,
                marginTop: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              <Check size={16} />
              신청 목록에 담기
            </button>
          </form>
        </div>

        {/* 오른쪽: 신청 목록 장바구니 (Cart) 및 최종 제출 */}
        <div
          style={{
            background: isLightMode ? "#ffffff" : "#151d30",
            border: `1px solid ${isLightMode ? "#e2e8f0" : "#222f4b"}`,
            borderRadius: "24px",
            padding: "32px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          {/* 장바구니 영역 */}
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, color: isLightMode ? "#0f172a" : "#f1f5f9", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>🛒 대여/반납 신청 대기 목록</span>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  style={{
                    background: "transparent",
                    color: "#ef4444",
                    border: "none",
                    fontSize: "11px",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  비우기
                </button>
              )}
            </h2>
            <p style={{ fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8", marginBottom: "16px" }}>
              왼쪽에서 품목을 입력해 담은 후, 아래 제출 버튼을 클릭해 최종 접수하세요.
            </p>

            {cart.length === 0 ? (
              <div
                style={{
                  border: `2px dashed ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                  borderRadius: "16px",
                  padding: "40px 20px",
                  textAlign: "center",
                  color: isLightMode ? "#94a3b8" : "#475569",
                  fontSize: "13px",
                }}
              >
                <Package size={36} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
                신청 대기 목록이 비어 있습니다.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "240px", overflowY: "auto", paddingRight: "4px" }}>
                {cart.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: isLightMode ? "#f8fafc" : "#0f172a",
                      border: `1px solid ${isLightMode ? "#e2e8f0" : "#222f4b"}`,
                      borderRadius: "14px",
                      padding: "12px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: isLightMode ? "#1e293b" : "#f1f5f9" }}>
                        {c.item.name}
                      </div>
                      <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8", marginTop: "4px" }}>
                        <span
                          style={{
                            fontWeight: 800,
                            color: c.type === "대여" ? "#4f46e5" : c.type === "소모" ? "#f59e0b" : "#10b981",
                          }}
                        >
                          [{c.type}]
                        </span>
                        <span>{c.qty}개</span>
                        <span>위치: {c.item.location}</span>
                      </div>
                      {c.note && (
                        <div style={{ fontSize: "11px", color: isLightMode ? "#94a3b8" : "#64748b", marginTop: "2px", fontStyle: "italic" }}>
                          사유: {c.note}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromCart(c.id)}
                      style={{
                        background: "rgba(239, 68, 68, 0.1)",
                        color: "#ef4444",
                        border: "none",
                        width: "28px",
                        height: "28px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 최종 제출 폼 */}
          <form onSubmit={handleSubmit} style={{ marginTop: "auto", borderTop: `1px solid ${isLightMode ? "#e2e8f0" : "#222f4b"}`, paddingTop: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", fontSize: "14px" }}>
              <span style={{ fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>총 대기 품목</span>
              <span style={{ fontWeight: 800, color: "#4f46e5" }}>{cart.length}개 건</span>
            </div>

            <button
              type="submit"
              disabled={submitting || cart.length === 0}
              style={{
                width: "100%",
                background: "#4f46e5",
                color: "#ffffff",
                border: "none",
                borderRadius: "14px",
                padding: "14px",
                fontSize: "15px",
                fontWeight: 800,
                cursor: (submitting || cart.length === 0) ? "not-allowed" : "pointer",
                boxShadow: "0 10px 15px -3px rgba(79, 70, 229, 0.3)",
                opacity: (submitting || cart.length === 0) ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              {submitting ? "구글 시트 전송 중..." : `대여/반납 신청서 일괄 제출하기 (총 ${cart.length}건)`}
            </button>
          </form>

          <div style={{ height: "1px", background: isLightMode ? "#e2e8f0" : "#222f4b" }} />

          {/* 선택한 품목 상세 요약 (간략히 제공) */}
          {selectedItem ? (
            <div
              style={{
                background: isLightMode ? "#f8fafc" : "#0f172a",
                border: `1px solid ${isLightMode ? "#cbd5e1" : "#222f4b"}`,
                borderRadius: "16px",
                padding: "16px",
                display: "flex",
                gap: "12px",
                alignItems: "center"
              }}
            >
              {selectedItem.photo ? (
                <img
                  src={getGoogleDriveImageUrl(selectedItem.photo)}
                  alt={selectedItem.name}
                  referrerPolicy="no-referrer"
                  style={{
                    width: "50px",
                    height: "50px",
                    borderRadius: "8px",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "50px",
                    height: "50px",
                    borderRadius: "8px",
                    background: isLightMode ? "#e2e8f0" : "#1e293b",
                    color: isLightMode ? "#64748b" : "#94a3b8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <Package size={20} />
                </div>
              )}
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: 700 }}>🔍 선택된 자재 사양</div>
                <div style={{ fontSize: "13px", fontWeight: 800 }}>{selectedItem.name}</div>
                <div style={{ fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
                  위치: {selectedItem.location} | 현재고: {selectedItem.stock ?? 0}개
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "11px", color: isLightMode ? "#94a3b8" : "#475569", textAlign: "center" }}>
              품목을 선택하면 해당 자재 정보의 요약이 여기에 표출됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
