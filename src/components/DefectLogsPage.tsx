import React, { useState, useMemo } from "react";
import { InventoryItem, DefectLog } from "../types";
import { AlertTriangle, Calendar, User, MapPin, Clipboard, Plus, Search, ArrowLeft, FileText, Check, Camera, Upload, X, ImageIcon } from "lucide-react";

import { isFuzzyMatch, resizeAndCompressImage } from "../utils/drive";
import { smartMatch } from "../utils/search";
import { parseDateString } from "../utils/date";

interface DefectLogsPageProps {
  defectLogs: DefectLog[];
  inventory: InventoryItem[];
  robotObjects?: any[];
  onAddDefectLog: (log: Omit<DefectLog, "rowIndex">) => Promise<void>;
  onClose: () => void;
  isLightMode: boolean;
}

const PANEL_BORDER = "var(--panel-border, #334155)";
const TEXT_MAIN = "var(--text-main, #f1f5f9)";
const TEXT_DIM = "var(--text-dim, #94a3b8)";
const ACCENT = "#2563eb";
const DANGER = "#f43f5e";
const OK = "#10b981";

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

export default function DefectLogsPage({
  defectLogs,
  inventory,
  robotObjects = [],
  onAddDefectLog,
  onClose,
  isLightMode,
}: DefectLogsPageProps) {
  // Form states
  const [locationInput, setLocationInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [qtyInput, setQtyInput] = useState<number>(1);
  const [defectType, setDefectType] = useState("파손");
  const [noteInput, setNoteInput] = useState("");
  const [actionTakenInput, setActionTakenInput] = useState("");
  const [photoInput, setPhotoInput] = useState<string>("");
  
  // Tab-selector for items category: 랙 자재 vs 로봇 오브젝트
  const [itemCategory, setItemCategory] = useState<"rack" | "robot">("rack");
  
  // Custom manual input mode toggles
  const [manualItemName, setManualItemName] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState("");

  // Filter states
  const [filterQuery, setFilterQuery] = useState("");
  const [filterType, setFilterType] = useState("전체");

  // Submitting state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  // Image Uploading States & Utilities
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const processAndUploadFile = async (file: File) => {
    try {
      setIsUploadingImage(true);
      setFormError(null);
      
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      
      setPhotoInput(compressedBase64);
    } catch (err: any) {
      console.error("Image processing error:", err);
      setFormError(`이미지 처리 실패. (에러: ${err.message || err})`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAndUploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      await processAndUploadFile(file);
    }
  };

  // Extract unique items from inventory for selection
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    const items: { name: string; location: string; stock: number | string | null }[] = [];
    for (const item of inventory) {
      if (item.name && !seen.has(item.name)) {
        seen.add(item.name);
        items.push({
          name: item.name,
          location: item.location || "",
          stock: item.stock,
        });
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory]);

  const filteredUniqueItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return uniqueItems;
    return uniqueItems.filter((item) =>
      isFuzzyMatch(item.name || "", itemSearchQuery) ||
      isFuzzyMatch(item.location || "", itemSearchQuery)
    );
  }, [uniqueItems, itemSearchQuery]);

  // Extract unique robot objects for selection
  const uniqueRobotObjects = useMemo(() => {
    const seen = new Set<string>();
    const items: { name: string; location: string; spec?: string }[] = [];
    for (const item of robotObjects) {
      if (item.name && !seen.has(item.name)) {
        seen.add(item.name);
        items.push({
          name: item.name,
          location: item.location || "",
          spec: item.spec || "",
        });
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [robotObjects]);

  const filteredRobotObjects = useMemo(() => {
    if (!itemSearchQuery.trim()) return uniqueRobotObjects;
    return uniqueRobotObjects.filter((item) =>
      isFuzzyMatch(item.name || "", itemSearchQuery) ||
      isFuzzyMatch(item.location || "", itemSearchQuery) ||
      isFuzzyMatch(item.spec || "", itemSearchQuery)
    );
  }, [uniqueRobotObjects, itemSearchQuery]);

  const handleItemSelectChange = (name: string) => {
    setNameInput(name);
    if (itemCategory === "rack") {
      const found = inventory.find((item) => item.name === name);
      if (found) {
        setLocationInput(found.location || "-");
      } else {
        setLocationInput("-");
      }
    } else {
      const found = robotObjects.find((item) => item.name === name);
      if (found) {
        setLocationInput(found.location || "로봇 구역");
      } else {
        setLocationInput("로봇 구역");
      }
    }
  };

  const handleAddLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!nameInput.trim()) {
      setFormError("품목명을 선택하거나 입력해 주세요.");
      return;
    }
    if (qtyInput <= 0) {
      setFormError("올바른 수량을 입력해 주세요.");
      return;
    }

    try {
      setSubmitting(true);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      // If location is not resolved yet, try to find it
      let finalLocation = locationInput.trim();
      if (!finalLocation || finalLocation === "-") {
        const found = inventory.find((item) => item.name.trim() === nameInput.trim());
        finalLocation = found ? found.location || "미지정" : "미지정";
      }

      // Use original name as-is without any extraction/cleanup
      const cleanName = nameInput.trim();

      await onAddDefectLog({
        timestamp: timestampStr,
        location: finalLocation,
        name: cleanName,
        qty: qtyInput,
        defectType,
        manager: "",
        note: noteInput.trim(),
        actionTaken: actionTakenInput.trim(),
        photo: photoInput || undefined,
        itemCategory: itemCategory, // Pass category to Google Apps Script
      });

      // Reset form fields
      setNoteInput("");
      setActionTakenInput("");
      setQtyInput(1);
      setPhotoInput("");
      setFormError(null);
    } catch (err: any) {
      setFormError(err.message || "불량 로그 등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered Defect Logs List
  const filteredLogs = useMemo(() => {
    return defectLogs
      .filter((log) => {
        const matchesQuery =
          !filterQuery.trim() ||
          smartMatch([log.name, log.location, log.manager, log.note, log.defectType, log.actionTaken], filterQuery);

        const matchesType = filterType === "전체" || log.defectType === filterType;

        return matchesQuery && matchesType;
      })
      .sort((a, b) => {
        const timeA = parseDateString(a.timestamp || "");
        const timeB = parseDateString(b.timestamp || "");
        
        if (timeA !== timeB) {
          return timeB - timeA; // Newer timestamp first
        }
        
        // Fallback to rowIndex if timestamps are identical or cannot be parsed
        const rowA = a.rowIndex || 0;
        const rowB = b.rowIndex || 0;
        return rowB - rowA; // Higher row index (newer) first
      }); // Latest first
  }, [defectLogs, filterQuery, filterType]);

  // Count metrics
  const stats = useMemo(() => {
    const total = defectLogs.length;
    const damaged = defectLogs.filter((l) => l.defectType === "파손").length;
    const contaminated = defectLogs.filter((l) => l.defectType === "오염").length;
    const malfunctioning = defectLogs.filter((l) => l.defectType === "기능 오작동" || l.defectType === "기능 이상").length;
    const others = total - damaged - contaminated - malfunctioning;
    return { total, damaged, contaminated, malfunctioning, others };
  }, [defectLogs]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "calc(100vh - 64px)",
        background: "var(--app-bg, #0f172a)",
        color: TEXT_MAIN,
        padding: "24px",
        overflowY: "auto",
      }}
    >
      {/* 1. Header Area */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          borderBottom: `1px solid ${PANEL_BORDER}`,
          paddingBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              background: "var(--input-bg, #0f172a)",
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: "8px",
              padding: "8px 12px",
              color: TEXT_MAIN,
              fontSize: "13px",
              fontWeight: 600,
              gap: 6,
            }}
          >
            <ArrowLeft size={16} /> WMS 모니터링으로 돌아가기
          </button>
          <div style={{ height: 24, width: 1, background: PANEL_BORDER }} />
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              ⚠️ 실시간 불량로그 관리
            </h1>
            <p style={{ fontSize: "12px", color: TEXT_DIM, margin: "4px 0 0 0" }}>
              입고 혹은 재고 이동 시 발생한 불량 현황을 실시간으로 등록하고 구글 시트에 즉시 동기화합니다.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Stat Widgets */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "10px",
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: "11px", color: TEXT_DIM, fontWeight: 600 }}>누적 불량 건수</div>
          <div style={{ fontSize: "24px", fontWeight: 900, color: TEXT_MAIN, marginTop: 4 }}>{stats.total}건</div>
        </div>
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "10px",
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: "11px", color: DANGER, fontWeight: 600 }}>💥 파손</div>
          <div style={{ fontSize: "24px", fontWeight: 900, color: DANGER, marginTop: 4 }}>{stats.damaged}건</div>
        </div>
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "10px",
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 600 }}>⚠️ 오염</div>
          <div style={{ fontSize: "24px", fontWeight: 900, color: "#f59e0b", marginTop: 4 }}>{stats.contaminated}건</div>
        </div>
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "10px",
            padding: "14px 18px",
          }}
        >
          <div style={{ fontSize: "11px", color: ACCENT, fontWeight: 600 }}>⚙️ 기능 이상/오작동</div>
          <div style={{ fontSize: "24px", fontWeight: 900, color: ACCENT, marginTop: 4 }}>{stats.malfunctioning}건</div>
        </div>
      </div>

      {/* 3. Main Dashboard Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          gap: "24px",
          alignItems: "flex-start",
        }}
      >
        {/* LEFT COLUMN: Input Form */}
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px 0", display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={18} style={{ color: ACCENT }} /> 신규 불량 로그 등록
          </h2>

          <form onSubmit={handleAddLogSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 품목명 */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: "12.5px", fontWeight: 600, color: TEXT_MAIN }}>📦 품목명</label>
                <button
                  type="button"
                  onClick={() => {
                    setManualItemName(!manualItemName);
                    setNameInput("");
                    setLocationInput("");
                  }}
                  style={{
                    background: "transparent",
                    color: ACCENT,
                    fontSize: "11.5px",
                    fontWeight: 700,
                    padding: 0,
                  }}
                >
                  {manualItemName ? "목록에서 선택" : "직접 입력하기"}
                </button>
              </div>

              {manualItemName ? (
                <input
                  type="text"
                  required
                  placeholder="품목명을 입력하세요"
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    setLocationInput("");
                  }}
                  style={{
                    width: "100%",
                    background: "var(--input-bg, #0f172a)",
                    border: `1px solid ${PANEL_BORDER}`,
                    color: TEXT_MAIN,
                    padding: "10px 12px",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* 분류 선택 (랙 자재 vs 로봇 오브젝트) */}
                  <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setItemCategory("rack");
                        setNameInput("");
                        setLocationInput("");
                        setItemSearchQuery("");
                      }}
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: `1px solid ${itemCategory === "rack" ? ACCENT : PANEL_BORDER}`,
                        background: itemCategory === "rack" ? `${ACCENT}15` : "transparent",
                        color: itemCategory === "rack" ? "#a5b4fc" : TEXT_DIM,
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      🗄️ 랙 선반 자재
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setItemCategory("robot");
                        setNameInput("");
                        setLocationInput("");
                        setItemSearchQuery("");
                      }}
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: `1px solid ${itemCategory === "robot" ? ACCENT : PANEL_BORDER}`,
                        background: itemCategory === "robot" ? `${ACCENT}15` : "transparent",
                        color: itemCategory === "robot" ? "#a5b4fc" : TEXT_DIM,
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      🤖 로봇 오브젝트
                    </button>
                  </div>

                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
                    <input
                      type="text"
                      placeholder={itemCategory === "rack" ? "랙 자재 목록 검색..." : "로봇 오브젝트 검색 (이름, 규격 등)..."}
                      value={itemSearchQuery}
                      onChange={(e) => setItemSearchQuery(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--input-bg, #0f172a)",
                        border: `1px solid ${PANEL_BORDER}`,
                        color: TEXT_MAIN,
                        padding: "8px 10px 8px 32px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        outline: "none",
                      }}
                    />
                  </div>

                  {itemCategory === "rack" ? (
                    <select
                      required
                      value={nameInput}
                      onChange={(e) => handleItemSelectChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--input-bg, #0f172a)",
                        border: `1px solid ${PANEL_BORDER}`,
                        color: TEXT_MAIN,
                        padding: "10px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    >
                      <option value="">랙 자재 선택... ({filteredUniqueItems.length}개 검색됨)</option>
                      {filteredUniqueItems.map((item, idx) => (
                        <option key={idx} value={item.name}>
                          {item.name} {item.location ? `(${item.location})` : ""} {item.stock != null ? ` - 재고: ${item.stock}개` : ""}
                        </option>
                      ))}
                      {filteredUniqueItems.length === 0 && (
                        <option disabled>일치하는 자재 품목이 없습니다.</option>
                      )}
                    </select>
                  ) : (
                    <select
                      required
                      value={nameInput}
                      onChange={(e) => handleItemSelectChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--input-bg, #0f172a)",
                        border: `1px solid ${PANEL_BORDER}`,
                        color: TEXT_MAIN,
                        padding: "10px 12px",
                        borderRadius: "6px",
                        fontSize: "13px",
                      }}
                    >
                      <option value="">로봇 오브젝트 선택... ({filteredRobotObjects.length}개 검색됨)</option>
                      {filteredRobotObjects.map((item, idx) => (
                        <option key={idx} value={item.name}>
                          {item.name} {item.spec ? `[${item.spec}]` : ""} ({item.location})
                        </option>
                      ))}
                      {filteredRobotObjects.length === 0 && (
                        <option disabled>일치하는 로봇 오브젝트가 없습니다.</option>
                      )}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* 수량 및 불량 유형 */}
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: "12.5px", display: "block", marginBottom: 6, fontWeight: 600 }}>수량</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={qtyInput}
                  onChange={(e) => setQtyInput(Math.max(1, Number(e.target.value)))}
                  style={{
                    width: "100%",
                    background: "var(--input-bg, #0f172a)",
                    border: `1px solid ${PANEL_BORDER}`,
                    color: TEXT_MAIN,
                    padding: "10px 12px",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12.5px", display: "block", marginBottom: 6, fontWeight: 600 }}>💥 불량 유형</label>
                <select
                  value={defectType}
                  onChange={(e) => setDefectType(e.target.value)}
                  style={{
                    width: "100%",
                    background: "var(--input-bg, #0f172a)",
                    border: `1px solid ${PANEL_BORDER}`,
                    color: TEXT_MAIN,
                    padding: "10px 12px",
                    borderRadius: "6px",
                    fontSize: "13px",
                  }}
                >
                  <option value="파손">💥 파손 (Damaged)</option>
                  <option value="오염">⚠️ 오염 (Contaminated)</option>
                  <option value="기능 오작동">⚙️ 기능 오작동 (Malfunctioning)</option>
                  <option value="기타">❓ 기타 (Others)</option>
                </select>
              </div>
            </div>


            {/* 세부 사항 */}
            <div>
              <label style={{ fontSize: "12.5px", display: "block", marginBottom: 6, fontWeight: 600 }}>📝 세부 사항</label>
              <textarea
                required
                placeholder="불량품에 대한 구체적인 파손 정황이나 원인 세부 사항을 기록하세요"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                style={{
                  width: "100%",
                  height: 64,
                  background: "var(--input-bg, #0f172a)",
                  border: `1px solid ${PANEL_BORDER}`,
                  color: TEXT_MAIN,
                  padding: "10px 12px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  resize: "none",
                  outline: "none",
                }}
              />
            </div>

            {/* 대처 방안 */}
            <div>
              <label style={{ fontSize: "12.5px", display: "block", marginBottom: 6, fontWeight: 600 }}>🛡️ 대처 방안</label>
              <textarea
                required
                placeholder="불량 발생 이후 취한 교환 요청, 즉시 폐기, AS 의뢰 등의 대처 방안을 입력해 주세요"
                value={actionTakenInput}
                onChange={(e) => setActionTakenInput(e.target.value)}
                style={{
                  width: "100%",
                  height: 64,
                  background: "var(--input-bg, #0f172a)",
                  border: `1px solid ${PANEL_BORDER}`,
                  color: TEXT_MAIN,
                  padding: "10px 12px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  resize: "none",
                  outline: "none",
                }}
              />
            </div>

            {/* 사진 등록 */}
            <div>
              <label style={{ fontSize: "12.5px", display: "block", marginBottom: 6, fontWeight: 600 }}>📸 불량 현장 사진 등록</label>
              
              {/* 이미지 주소(URL) 입력란 */}
              <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                <input
                  type="text"
                  placeholder={photoInput && photoInput.startsWith("data:") ? "파일이 업로드되었습니다." : "인터넷 상의 이미지 고유 주소(URL) 직접 입력도 가능합니다"}
                  value={photoInput && photoInput.startsWith("data:") ? "파일 업로드 완료 (저장 시 구글 드라이브에 원본 저장됨)" : photoInput}
                  disabled={photoInput && photoInput.startsWith("data:") ? true : false}
                  onChange={(e) => setPhotoInput(e.target.value.trim())}
                  style={{
                    flex: 1,
                    background: photoInput && photoInput.startsWith("data:") ? "rgba(16, 185, 129, 0.05)" : "var(--input-bg, #0f172a)",
                    border: photoInput && photoInput.startsWith("data:") ? "1px solid rgba(16, 185, 129, 0.3)" : `1px solid ${PANEL_BORDER}`,
                    color: photoInput && photoInput.startsWith("data:") ? "#34d399" : TEXT_MAIN,
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "12.5px",
                    outline: "none",
                  }}
                />
                {photoInput && (
                  <button
                    type="button"
                    onClick={() => setPhotoInput("")}
                    style={{
                      background: "rgba(15, 23, 42, 0.75)",
                      border: `1px solid ${PANEL_BORDER}`,
                      color: TEXT_DIM,
                      borderRadius: "6px",
                      padding: "0 10px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    초기화
                  </button>
                )}
              </div>

              {/* 드래그 앤 드롭 및 클릭 파일 업로드 영역 */}
              {!photoInput && (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("defect-photo-upload")?.click()}
                  style={{
                    width: "100%",
                    height: "90px",
                    border: `1px dashed ${isDragging ? ACCENT : PANEL_BORDER}`,
                    borderRadius: "8px",
                    background: isDragging ? "rgba(37, 99, 235, 0.05)" : "var(--input-bg, #0f172a)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer",
                    transition: "all 0.15s",
                    marginBottom: "8px"
                  }}
                >
                  <Upload size={18} style={{ color: isDragging ? ACCENT : TEXT_DIM }} />
                  <span style={{ fontSize: "11.5px", color: TEXT_MAIN, fontWeight: 500 }}>
                    {isDragging ? "여기에 이미지를 놓으세요" : "클릭하거나 이미지를 끌어다 놓으세요 (구글 드라이브 자동 저장)"}
                  </span>
                  <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                    무손실 원본 화질의 이미지 파일이 안전하게 보관됩니다
                  </span>
                  <input
                    id="defect-photo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoFileChange}
                    style={{ display: "none" }}
                  />
                </div>
              )}

              {/* 이미지 미리보기 */}
              {photoInput ? (
                <div style={{ position: "relative", width: "100%", height: "140px", borderRadius: "8px", overflow: "hidden", border: `1px solid ${PANEL_BORDER}`, background: "rgba(15, 23, 42, 0.4)" }}>
                  <img 
                    src={photoInput} 
                    alt="Photo preview" 
                    onError={(e) => {
                      // If it's not base64 and fails, show error
                      if (!photoInput.startsWith("data:")) {
                        e.currentTarget.style.display = "none";
                        const sibling = e.currentTarget.nextElementSibling as HTMLElement;
                        if (sibling) sibling.style.display = "flex";
                      }
                    }}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                  />
                  <div 
                    style={{ 
                      display: "none", 
                      width: "100%", 
                      height: "100%", 
                      alignItems: "center", 
                      justifyContent: "center", 
                      flexDirection: "column",
                      gap: "4px",
                      color: TEXT_DIM 
                    }}
                  >
                    <AlertTriangle size={20} style={{ color: DANGER }} />
                    <span style={{ fontSize: "11px" }}>올바르지 않은 이미지 주소이거나 불러올 수 없습니다.</span>
                  </div>
                  
                  {/* 업로드 상태 배지 */}
                  <div style={{
                    position: "absolute",
                    bottom: "8px",
                    left: "8px",
                    background: "rgba(15, 23, 42, 0.85)",
                    border: `1px solid ${PANEL_BORDER}`,
                    borderRadius: "4px",
                    padding: "3px 6px",
                    fontSize: "10px",
                    color: photoInput.startsWith("data:") ? "#34d399" : ACCENT,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}>
                    {photoInput.startsWith("data:") ? (
                      <>
                        <Check size={10} />
                        드라이브 저장 예정 (원본 화질)
                      </>
                    ) : (
                      <>
                        <ImageIcon size={10} />
                        외부 이미지 링크 연동됨
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {formError && (
              <div
                style={{
                  background: "rgba(244, 63, 94, 0.15)",
                  border: "1px solid #f43f5e",
                  color: "#f43f5e",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <AlertTriangle size={14} /> {formError}
              </div>
            )}

            {/* 등록 제출 버튼 */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                background: ACCENT,
                color: "#ffffff",
                padding: "12px 0",
                borderRadius: "8px",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: "pointer",
                marginTop: "6px",
                opacity: submitting ? 0.7 : 1,
                gap: 8,
              }}
            >
              {submitting ? "구글 시트 연동 기록 중..." : "불량로그 등록하기"}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: Query list & Logs History */}
        <div
          style={{
            background: "var(--panel-bg, #1e293b)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            alignSelf: "stretch",
            maxHeight: "680px",
          }}
        >
          {/* List Toolbar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              borderBottom: `1px solid ${PANEL_BORDER}`,
              paddingBottom: "14px",
            }}
          >
            <h2 style={{ fontSize: "15px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <Clipboard size={18} style={{ color: ACCENT }} /> 불량 이력 조회 및 필터링
            </h2>

            {/* Search/Filter Controls */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* Type selector */}
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                style={{
                  background: "var(--input-bg, #0f172a)",
                  border: `1px solid ${PANEL_BORDER}`,
                  color: TEXT_MAIN,
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12.5px",
                }}
              >
                <option value="전체">모든 불량유형</option>
                <option value="파손">파손</option>
                <option value="오염">오염</option>
                <option value="기능 오작동">기능 오작동</option>
                <option value="기타">기타</option>
              </select>

              {/* Text Search Input */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "var(--input-bg, #0f172a)",
                  border: `1px solid ${PANEL_BORDER}`,
                  borderRadius: "6px",
                  padding: "0 10px",
                  width: 220,
                }}
              >
                <Search size={14} style={{ color: TEXT_DIM, marginRight: 6 }} />
                <input
                  type="text"
                  placeholder="제품명, 사유, 대처방안 검색..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    color: TEXT_MAIN,
                    padding: "6px 0",
                    fontSize: "12.5px",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* History Records List (Sheet View) */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: "8px",
              background: isLightMode ? "#ffffff" : "var(--input-bg, #0f172a)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            }}
          >
            {filteredLogs.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", minWidth: "900px" }}>
                <thead>
                  <tr style={{ background: isLightMode ? "#f8fafc" : "#1e293b", borderBottom: `2px solid ${PANEL_BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "left", width: "18%" }}>제품명</th>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "center", width: "8%" }}>사진</th>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "center", width: "8%" }}>개수</th>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "left", width: "15%" }}>기록 시간</th>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "center", width: "12%" }}>불량 유형</th>
                    <th style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, textAlign: "left", width: "21%" }}>세부 사항</th>
                    <th style={{ padding: "10px 14px", color: TEXT_MAIN, textAlign: "left", width: "18%" }}>대처 방안</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, idx) => {
                    return (
                       <tr
                        key={log.rowIndex || idx}
                        style={{
                          borderBottom: `1px solid ${PANEL_BORDER}`,
                          background: idx % 2 === 0 ? "transparent" : (isLightMode ? "#f8fafc" : "rgba(255,255,255,0.01)")
                        }}
                      >
                        {/* 제품명 */}
                        <td style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, fontWeight: 700 }}>
                          {log.name}
                        </td>

                        {/* 사진 */}
                        <td style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, textAlign: "center" }}>
                          {log.photo ? (
                            <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                              <img
                                src={log.photo}
                                alt="불량 이미지"
                                referrerPolicy="no-referrer"
                                style={{
                                  width: "40px",
                                  height: "40px",
                                  objectFit: "cover",
                                  borderRadius: "6px",
                                  border: `1px solid ${PANEL_BORDER}`,
                                  cursor: "zoom-in",
                                  transition: "transform 0.15s",
                                }}
                                onClick={() => setZoomedPhoto(log.photo!)}
                                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.15)")}
                                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                              />
                            </div>
                          ) : (
                            <span style={{ color: TEXT_DIM, fontSize: "11px" }}>-</span>
                          )}
                        </td>
                        
                        {/* 개수 */}
                        <td className="mono" style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: DANGER, fontWeight: 800, textAlign: "center" }}>
                          {log.qty}개
                        </td>
                        
                        {/* 기록 시간 */}
                        <td className="mono" style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN }}>
                          {formatTimestampToMinutes(log.timestamp || "")}
                        </td>

                        {/* 불량 유형 */}
                        <td style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, textAlign: "center" }}>
                          {(() => {
                            let bg = "rgba(148, 163, 184, 0.15)";
                            let color = "var(--text-dim, #94a3b8)";
                            const typeVal = log.defectType || "기타";
                            
                            if (typeVal === "파손") {
                              bg = "rgba(244, 63, 94, 0.15)";
                              color = DANGER;
                            } else if (typeVal === "오염") {
                              bg = "rgba(245, 158, 11, 0.15)";
                              color = "#f59e0b";
                            } else if (typeVal === "기능 오작동" || typeVal === "기능 이상") {
                              bg = "rgba(37, 99, 235, 0.15)";
                              color = ACCENT;
                            } else if (typeVal === "수량 상이") {
                              bg = "rgba(16, 185, 129, 0.15)";
                              color = "#10b981";
                            } else if (typeVal === "누락") {
                              bg = "rgba(239, 68, 68, 0.15)";
                              color = "#ef4444";
                            }
                            
                            return (
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  backgroundColor: bg,
                                  color: color,
                                  border: `1px solid ${color}33`,
                                }}
                              >
                                {typeVal}
                              </span>
                            );
                          })()}
                        </td>
                        
                        {/* 세부 사항 */}
                        <td style={{ padding: "10px 14px", borderRight: `1px solid ${PANEL_BORDER}`, color: TEXT_MAIN, lineHeight: 1.4 }}>
                          {log.note || <span style={{ color: TEXT_DIM, fontStyle: "italic" }}>기재안됨</span>}
                        </td>
                        
                        {/* 대처 방안 */}
                        <td style={{ padding: "10px 14px", color: TEXT_MAIN, lineHeight: 1.4 }}>
                          {log.actionTaken ? (
                            <span style={{ display: "flex", alignItems: "center", gap: "4px", color: isLightMode ? "#047857" : OK, fontWeight: 600 }}>
                              <Check size={12} /> {log.actionTaken}
                            </span>
                          ) : (
                            <span style={{ color: TEXT_DIM, fontStyle: "italic" }}>기재안됨</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "80px 0",
                  color: TEXT_DIM,
                  gap: 10,
                }}
              >
                <FileText size={40} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, fontWeight: 500 }}>등록된 불량 이력이 없거나 검색 조건과 일치하지 않습니다.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoomed Photo Modal overlay */}
      {zoomedPhoto && (
        <div
          onClick={() => setZoomedPhoto(null)}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(15, 23, 42, 0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            cursor: "zoom-out",
            padding: "24px",
            backdropFilter: "blur(4px)",
          }}
        >
          <div style={{ position: "relative", maxWidth: "90%", maxHeight: "90%" }} onClick={(e) => e.stopPropagation()}>
            <img
              src={zoomedPhoto}
              alt="확대 사진"
              referrerPolicy="no-referrer"
              style={{
                maxWidth: "100%",
                maxHeight: "85vh",
                borderRadius: "12px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: "2px solid rgba(255, 255, 255, 0.15)"
              }}
            />
            <button
              onClick={() => setZoomedPhoto(null)}
              style={{
                position: "absolute",
                top: "-45px",
                right: "0px",
                background: "rgba(255,255,255,0.15)",
                color: "#ffffff",
                border: "none",
                borderRadius: "50%",
                width: "36px",
                height: "36px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontWeight: "bold",
                fontSize: "16px"
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
