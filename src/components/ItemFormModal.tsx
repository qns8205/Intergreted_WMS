import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { InventoryItem, Rack } from "../types";
import { parseLocation, resizeAndCompressImage } from "../utils/drive";
import { Upload, X, Camera, ImageIcon } from "lucide-react";

interface ItemFormModalProps {
  item: InventoryItem | null;
  defaultRackId: string;
  defaultLocation?: string | null;
  defaultSpec?: string | null;
  racks: Rack[];
  onSave: (item: any) => void;
  onClose: () => void;
  defaultManager?: string;
  inventory: InventoryItem[];
}

const PANEL = "var(--panel-bg, #1e293b)";
const PANEL_BORDER = "var(--panel-border, #334155)";
const TEXT_MAIN = "var(--text-main, #f1f5f9)";
const TEXT_DIM = "var(--text-dim, #94a3b8)";
const ACCENT = "#475569";
const ACCENT_SOFT = "#94a3b8";

export default function ItemFormModal({
  item,
  defaultRackId,
  defaultLocation,
  defaultSpec,
  racks,
  onSave,
  onClose,
  defaultManager,
  inventory,
}: ItemFormModalProps) {
  const parsedLoc = defaultLocation ? parseLocation(defaultLocation) : null;
  const initialRack = item 
    ? parseLocation(item.location).rack 
    : (parsedLoc ? parsedLoc.rack : defaultRackId || (racks[0] && racks[0].id) || "");
  const initialShelfPick = item
    ? item.location
    : (defaultLocation || "");
  const initialNewShelfNum = item 
    ? parseLocation(item.location).shelf 
    : (parsedLoc ? parsedLoc.shelf : "");

  const [form, setForm] = useState<Omit<InventoryItem, "rowIndex"> & { rowIndex?: number }>(
    item
      ? { ...item, manager: item.manager || defaultManager || "관리자" }
      : {
          location: "",
          photo: "",
          name: "",
          link: "N/A",
          stock: 0,
          updatedAt: "",
          manager: defaultManager || "관리자",
          note: "",
          spec: defaultSpec || "",
        }
  );

  const [rackId, setRackId] = useState(initialRack);
  const [shelfMode, setShelfMode] = useState<"existing" | "new">("existing");
  const [shelfPick, setShelfPick] = useState(initialShelfPick);
  const [newShelfNum, setNewShelfNum] = useState(initialNewShelfNum);

  // Image Uploading States & Utilities
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const processAndUploadFile = async (file: File) => {
    try {
      setIsUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      update("photo", compressedBase64);
    } catch (err: any) {
      console.error("Image processing error:", err);
      alert(`이미지 처리 실패: ${err.message || err}`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAndUploadFile(file);
  };

  const currentRack = racks.find((r) => r.id === rackId);
  const existingShelves = currentRack && currentRack.shelves ? currentRack.shelves : [];

  useEffect(() => {
    if (existingShelves.length === 0) {
      setShelfMode("new");
    } else if (!item) {
      setShelfMode("existing");
    }
  }, [rackId]); // eslint-disable-line

  function update(field: string, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function composedLocation() {
    if (shelfMode === "existing" && shelfPick) {
      // Picked shelves already have format like "A-01"
      return shelfPick;
    }
    if (shelfMode === "new" && newShelfNum.trim()) {
      return `${rackId}-${newShelfNum.trim()}`;
    }
    return "";
  }

  const location = item ? form.location : composedLocation();
  const canSave = location.trim() !== "" && form.name.trim() !== "";

  const existingSubcategories = React.useMemo(() => {
    if (!location || !inventory) return [];
    const set = new Set<string>();
    inventory.forEach((itm) => {
      if (itm.location === location && itm.spec && itm.spec.trim() && itm.spec !== "기타") {
        set.add(itm.spec.trim());
      }
    });
    return Array.from(set).sort();
  }, [location, inventory]);

  const [subMode, setSubMode] = useState<"select" | "custom">("select");

  useEffect(() => {
    if (existingSubcategories.length === 0) {
      setSubMode("custom");
    } else {
      setSubMode("select");
    }
  }, [existingSubcategories.length]);

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,10,11,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        backdropFilter: "blur(2px)",
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="item-modal"
        style={{
          width: 540,
          maxWidth: "94vw",
          maxHeight: "88vh",
          overflowY: "auto",
          background: PANEL,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <style>{`
          .item-modal input, .item-modal select, .item-modal textarea {
            background: var(--input-bg, #0f172a) !important;
            color: var(--text-main, #f1f5f9) !important;
            border: 1px solid var(--panel-border, #334155) !important;
            border-radius: 6px !important;
            padding: 8px 12px !important;
            font-size: 13px !important;
            outline: none !important;
            transition: border-color 0.15s ease-in-out !important;
          }
          .item-modal input:focus, .item-modal select:focus, .item-modal textarea:focus {
            border-color: #475569 !important;
            box-shadow: 0 0 0 2px rgba(71, 85, 105, 0.2) !important;
          }
        `}</style>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{item ? "품목 수정" : "품목 추가"}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: TEXT_DIM, fontSize: 18, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {item ? (
            <Field label="위치 (코드)">
              <input
                className="mono"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
                style={{ width: "100%" }}
              />
            </Field>
          ) : (
            <>
              <Field label="랙 구역 선택">
                <select
                  value={rackId}
                  onChange={(e) => {
                    setRackId(e.target.value);
                    setShelfPick("");
                  }}
                  style={{ width: "100%", background: "#101114", color: TEXT_MAIN, border: `1px solid ${PANEL_BORDER}`, padding: "6px 10px", borderRadius: 6 }}
                >
                  {racks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id} 랙 ({r.name})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="선반(Shelf) 위치">
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShelfMode("existing")}
                    style={{
                      flex: 1,
                      background: shelfMode === "existing" ? "rgba(168,166,160,0.12)" : "transparent",
                      border: `1px solid ${shelfMode === "existing" ? ACCENT_SOFT : PANEL_BORDER}`,
                      color: shelfMode === "existing" ? TEXT_MAIN : TEXT_DIM,
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    기존 선반 위치에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => setShelfMode("new")}
                    style={{
                      flex: 1,
                      background: shelfMode === "new" ? "rgba(168,166,160,0.12)" : "transparent",
                      border: `1px solid ${shelfMode === "new" ? ACCENT_SOFT : PANEL_BORDER}`,
                      color: shelfMode === "new" ? TEXT_MAIN : TEXT_DIM,
                      borderRadius: 6,
                      padding: "6px 8px",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    새 선반 위치 만들기
                  </button>
                </div>
                {shelfMode === "existing" ? (
                  existingShelves.length > 0 ? (
                    <select
                      value={shelfPick}
                      onChange={(e) => setShelfPick(e.target.value)}
                      style={{ width: "100%", background: "#101114", color: TEXT_MAIN, border: `1px solid ${PANEL_BORDER}`, padding: "6px 10px", borderRadius: 6 }}
                    >
                      <option value="">선반을 선택하세요</option>
                      {existingShelves.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: 12, color: TEXT_DIM }}>
                      이 랙에는 아직 활성 선반 위치가 없습니다. "새 선반 위치 만들기"를 진행해주세요.
                    </div>
                  )
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 13, color: TEXT_DIM }}>
                      {rackId}-
                    </span>
                    <input
                      value={newShelfNum}
                      onChange={(e) => setNewShelfNum(e.target.value)}
                      placeholder="예: 05"
                      style={{ flex: 1 }}
                    />
                  </div>
                )}
              </Field>
            </>
          )}

          <Field label="품목명">
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="품목 이름 입력"
              style={{ width: "100%" }}
            />
          </Field>

          <Field label="선반 내 서브 분류 (예: 공구, M2 규격, M3 규격 등)">
            {subMode === "select" && existingSubcategories.length > 0 ? (
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={form.spec}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__custom__") {
                      setSubMode("custom");
                    } else {
                      update("spec", val);
                    }
                  }}
                  style={{
                    flex: 1,
                    background: "var(--input-bg, #0f172a)",
                    color: TEXT_MAIN,
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "6px",
                    padding: "10px 14px",
                    fontSize: "13px",
                    outline: "none",
                  }}
                >
                  <option value="">선택 안 함 (기타)</option>
                  {existingSubcategories.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                  <option value="__custom__">➕ 새 서브 분류 직접 입력...</option>
                </select>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  value={form.spec}
                  onChange={(e) => update("spec", e.target.value)}
                  placeholder="선반 내에서 구분할 서브 분류 직접 입력"
                  style={{ width: "100%" }}
                />
                {existingSubcategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubMode("select")}
                    style={{
                      alignSelf: "flex-end",
                      background: "transparent",
                      border: "none",
                      color: ACCENT_SOFT,
                      fontSize: "11px",
                      cursor: "pointer",
                      padding: "2px 4px",
                    }}
                  >
                    📋 기존 서브 분류 목록에서 선택하기
                  </button>
                )}
              </div>
            )}
          </Field>

          <Field label="특이사항">
            <input
              value={form.note}
              onChange={(e) => update("note", e.target.value)}
              placeholder="특이사항 또는 주의사항 입력"
              style={{ width: "100%" }}
            />
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <Field label="재고 수량" style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={form.stock === null ? "" : String(form.stock)}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    if (val.toUpperCase() === "N/A") {
                      update("stock", "N/A");
                    } else if (val === "") {
                      update("stock", null);
                    } else {
                      const num = Number(val);
                      update("stock", isNaN(num) ? val : num);
                    }
                  }}
                  placeholder="숫자 또는 N/A"
                  style={{ width: "100%", flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => update("stock", "N/A")}
                  style={{
                    background: form.stock === "N/A" ? "#475569" : "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "6px",
                    padding: "0 10px",
                    fontSize: "11px",
                    color: form.stock === "N/A" ? "#ffffff" : "var(--text-dim, #94a3b8)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    height: "36px"
                  }}
                >
                  N/A 지정
                </button>
              </div>
            </Field>
            <Field label="담당자" style={{ flex: 1 }}>
              <input
                value={form.manager}
                onChange={(e) => update("manager", e.target.value)}
                placeholder="담당자명"
                style={{
                  width: "100%",
                  height: "36px"
                }}
              />
            </Field>
          </div>

          <Field label="사진 등록 (구글 드라이브 주소 또는 이미지 파일 직접 업로드)">
            <input
              value={form.photo && form.photo.startsWith("data:image/") ? "" : form.photo}
              disabled={!!(form.photo && form.photo.startsWith("data:image/"))}
              onChange={(e) => update("photo", e.target.value)}
              placeholder={form.photo && form.photo.startsWith("data:image/") ? "파일이 업로드되었습니다" : "구글 드라이브 공유 링크나 이미지 URL 주소를 입력하세요"}
              style={{ width: "100%", opacity: form.photo && form.photo.startsWith("data:image/") ? 0.6 : 1 }}
            />
            
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith("image/")) {
                  await processAndUploadFile(file);
                }
              }}
              style={{
                border: `1px dashed ${isDragging ? "#475569" : PANEL_BORDER}`,
                background: isDragging ? "rgba(71, 85, 105, 0.05)" : "rgba(255, 255, 255, 0.02)",
                borderRadius: 8,
                padding: "14px",
                textAlign: "center",
                cursor: "pointer",
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6
              }}
              onClick={() => document.getElementById("pc-item-photo-upload")?.click()}
            >
              <input
                type="file"
                id="pc-item-photo-upload"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handlePhotoFileChange}
              />
              {form.photo && form.photo.startsWith("data:image/") ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%" }}>
                  <img
                    src={form.photo}
                    alt="Preview"
                    style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }}
                  />
                  <div style={{ textAlign: "left" }}>
                    <span style={{ fontSize: 11, fontWeight: "bold", color: "#475569", display: "block" }}>
                      📸 이미지 직접 등록 준비 완료
                    </span>
                    <span style={{ fontSize: 9.5, color: TEXT_DIM, display: "block" }}>
                      저장 시 클라우드 드라이브에 자동 업로드됩니다.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      update("photo", "");
                    }}
                    style={{
                      background: "rgba(239, 68, 68, 0.15)",
                      color: "#f43f5e",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 10,
                      cursor: "pointer",
                      fontWeight: "bold",
                      marginLeft: "auto"
                    }}
                  >
                    삭제
                  </button>
                </div>
              ) : isUploadingImage ? (
                <span style={{ fontSize: 11, color: TEXT_DIM }}>이미지 변환 및 등록 대기 중...</span>
              ) : (
                <>
                  <Upload size={16} color={isDragging ? "#475569" : TEXT_DIM} />
                  <span style={{ fontSize: 11.5, color: TEXT_MAIN, fontWeight: 500 }}>
                    클릭하거나 이미지 파일을 여기로 드래그하여 직접 업로드
                  </span>
                  <span style={{ fontSize: 9.5, color: TEXT_DIM }}>
                    (선택한 이미지는 구글 드라이브 지정 폴더에 자동 업로드되어 안전하게 관리됩니다)
                  </span>
                </>
              )}
            </div>
            
            <span style={{ fontSize: 10, color: TEXT_DIM, marginTop: 4, display: "block" }}>
              * 드라이브 공유 링크를 직접 입력하거나, 이미지 파일을 직접 업로드해 오브젝트 이름으로 관리할 수 있습니다.
            </span>
          </Field>

          <Field label="구매링크">
            <input
              value={form.link}
              onChange={(e) => update("link", e.target.value)}
              placeholder="N/A 또는 구매 URL"
              style={{ width: "100%" }}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={() => onSave({ ...form, location })}
            disabled={!canSave}
            style={{
              flex: 1,
              background: ACCENT,
              border: `1px solid ${ACCENT}`,
              color: "#15161A",
              borderRadius: 7,
              padding: "11px 0",
              fontSize: 13.5,
              fontWeight: 600,
              opacity: !canSave ? 0.5 : 1,
              cursor: "pointer",
            }}
          >
            저장
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "transparent",
              border: `1px solid ${PANEL_BORDER}`,
              color: TEXT_DIM,
              borderRadius: 7,
              padding: "11px 0",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            취소
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 11.5, color: TEXT_DIM, display: "block", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
