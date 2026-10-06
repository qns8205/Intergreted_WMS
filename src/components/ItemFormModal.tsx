import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { InventoryItem, Rack } from "../types";
import { parseLocation, resizeAndCompressImage, getGoogleDriveImageUrl } from "../utils/drive";
import { Upload, X, Camera, ImageIcon, Save } from "lucide-react";
import ItemPhotoGallery, { StagedPhoto } from "./ItemPhotoGallery";
import { postAddItemPhoto, fetchWarehouseRackSections, postSetWarehouseRackSections, fetchWarehouseRackLevels } from "../utils/borrowApi";
import { parseToolLocation } from "../utils/toolLocation";
import ToolLocationPicker from "./ToolLocationPicker";

// 컴포넌트 함수 내부에 정의하면 렌더링(=키 입력)마다 새 함수 정체성이 생겨 React가
// 매번 다른 컴포넌트로 취급해 <input>까지 통째로 리마운트시킨다 (입력할 때마다 포커스가
// 풀리는 버그의 원인이었다) — 그래서 모듈 스코프로 뺐다.
function Field({ label, labelStyle, children, style }: { label: string; labelStyle: React.CSSProperties; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

interface ItemFormModalProps {
  item: InventoryItem | null;
  defaultRackId: string;
  defaultLocation?: string | null;
  defaultSpec?: string | null;
  racks: Rack[];
  onSave: (item: any) => void;
  // 신규 등록 중에 "추가 사진"을 함께 골라둔 경우에만 쓴다 — 실제 서버 저장을 기다렸다가
  // 발급된 rowIndex를 돌려준다(실패하면 null). 없으면 추가 사진 없이 등록할 때처럼
  // 기존 onSave(낙관적 즉시 닫기)를 그대로 쓴다.
  onSaveNewItem?: (item: any) => Promise<number | null>;
  onClose: () => void;
  defaultManager?: string;
  inventory: InventoryItem[];
  isLightMode?: boolean;
  scriptUrl?: string;
  showToast?: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

export default function ItemFormModal({
  item,
  defaultRackId,
  defaultLocation,
  defaultSpec,
  racks,
  onSave,
  onSaveNewItem,
  onClose,
  defaultManager,
  inventory,
  isLightMode = false,
  scriptUrl = "",
  showToast,
}: ItemFormModalProps) {
  // 시나리오 물품 편집 모달(ScenarioAdminPage)과 완전히 같은 색 팔레트를 쓴다.
  const C = {
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#2563eb" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#111827" : "#f1f5f9",
    error: isLightMode ? "#dc2626" : "#f87171",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 13px", fontSize: "14px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  const lblStyle: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "5px" };

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
          keywords: "",
          isConsumable: false,
        }
  );

  // 위치는 랙-구역 코드 하나로 다룬다 (utils/toolLocation.ts). 편집·신규 모두 같은 그림 선택을 쓴다.
  const [loc, setLoc] = useState<string>(item ? item.location : (defaultLocation || ""));
  // 랙별 구역 수. 이 창에서 바꾼 값(sectionEdits)은 저장할 때 서버에 함께 반영한다.
  const [rackSections, setRackSections] = useState<Record<string, number>>({});
  const [sectionEdits, setSectionEdits] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!scriptUrl) return;
    fetchWarehouseRackSections(scriptUrl).then(setRackSections).catch(() => { /* 없으면 모든 랙을 3구역으로 본다 */ });
    fetchWarehouseRackLevels(scriptUrl).then(setRackLevels).catch(() => { /* 없으면 물품이 있는 층만 고를 수 있다 */ });
  }, [scriptUrl]);
  const [rackLevels, setRackLevels] = useState<Record<string, number>>({});
  /** 고른 랙의 구역 수를 바꿨으면 저장한다. 실패해도 물품 저장은 막지 않는다. */
  async function saveSectionEdit() {
    const rack = parseToolLocation(location).rack;
    const n = rack ? sectionEdits[rack] : undefined;
    if (!scriptUrl || !rack || !n || rackSections[rack] === n) return;
    try {
      const res = await postSetWarehouseRackSections(scriptUrl, rack, n);
      if (!res?.success) throw new Error(res?.message || "");
    } catch (e: any) {
      showToast?.(`랙 구역 수를 저장하지 못했습니다: ${e?.message || e}`, "warn");
    }
  }

  // 신규 등록 중 골라둔 "추가 사진" — 아직 rowIndex가 없어 서버에 못 올리니, 저장 완료 후에
  // 한꺼번에 업로드한다.
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [savingNew, setSavingNew] = useState(false);

  async function handleSaveClick() {
    const payload = { ...form, location };
    await saveSectionEdit();
    if (!item && stagedPhotos.length > 0 && onSaveNewItem) {
      setSavingNew(true);
      try {
        const rowIndex = await onSaveNewItem(payload);
        if (rowIndex == null) return; // 실패 — 토스트는 onSaveNewItem 쪽에서 이미 띄운다
        for (const sp of stagedPhotos) {
          const res = await postAddItemPhoto(scriptUrl, "warehouse", String(rowIndex), sp.dataUrl);
          if (!res.success) showToast?.(res.error || "추가 사진 일부를 올리지 못했습니다.", "warn");
        }
        onClose();
      } finally {
        setSavingNew(false);
      }
      return;
    }
    onSave(payload);
  }

  // Image Uploading States & Utilities
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const processAndUploadFile = async (file: File) => {
    try {
      setIsUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file);
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

  function update(field: string, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const location = loc.trim().toUpperCase();
  const canSave = location.trim() !== "" && form.name.trim() !== "";

  const existingSubcategories = React.useMemo(() => {
    if (!location || !inventory) return [];
    // 정확히 같은 슬롯(예: "A-00")만 보면 그 슬롯에 다른 물품이 없는 한 후보가 항상 비어서
    // 드롭다운이 뜰 일이 없다. RackGroupedView의 "같은 랙끼리 서브분류 묶기"와 통일되게,
    // 같은 랙 전체에서 이미 쓰인 서브분류를 후보로 보여준다.
    const targetRack = parseLocation(location).rack;
    if (!targetRack) return [];
    const set = new Set<string>();
    inventory.forEach((itm) => {
      if (parseLocation(itm.location).rack === targetRack && itm.spec && itm.spec.trim() && itm.spec !== "기타") {
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
        zIndex: 2000,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        className="item-modal"
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: "14px",
        }}
      >
        <style>{`
          .item-modal input, .item-modal select, .item-modal textarea {
            background: ${isLightMode ? "#ffffff" : "#0f172a"} !important;
            color: ${C.text} !important;
            border: 1px solid ${C.border} !important;
            border-radius: 10px !important;
            padding: 11px 13px !important;
            font-size: 14px !important;
            outline: none !important;
            box-sizing: border-box !important;
            transition: border-color 0.15s ease-in-out !important;
          }
          .item-modal input[type="checkbox"] {
            border-radius: 3px !important;
            padding: 0 !important;
            width: 16px !important;
            height: 16px !important;
          }
          .item-modal input:focus, .item-modal select:focus, .item-modal textarea:focus {
            border-color: ${C.accent} !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2) !important;
          }
        `}</style>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
          <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0, color: C.text }}>{item ? "품목 수정" : "품목 추가"}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px" }}>
          {/* 사진 — 시나리오 물품 편집과 동일하게 맨 위에 썸네일+업로드 버튼 형태로 배치 */}
          <div>
            <label style={lblStyle}>사진</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith("image/")) await processAndUploadFile(file);
              }}
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
              <div style={{ flex: "0 0 96px", width: 96, height: 96, borderRadius: "12px", overflow: "hidden", border: `1px solid ${isDragging ? C.accent : C.border}`, background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {form.photo ? (
                  <img
                    src={form.photo.startsWith("data:image/") ? form.photo : getGoogleDriveImageUrl(form.photo)}
                    alt=""
                    referrerPolicy="no-referrer"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : <ImageIcon size={28} style={{ color: C.border }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => document.getElementById("pc-item-photo-upload")?.click()}
                  disabled={isUploadingImage}
                  style={{ padding: "10px", borderRadius: "10px", border: `1px dashed ${C.accent}`, background: "rgba(37,99,235,0.09)", color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                >
                  <Upload size={14} /> {isUploadingImage ? "처리 중..." : "이미지 업로드"}
                </button>
                <input
                  type="file"
                  id="pc-item-photo-upload"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handlePhotoFileChange}
                />
                <input
                  value={form.photo && form.photo.startsWith("data:image/") ? "" : form.photo}
                  disabled={!!(form.photo && form.photo.startsWith("data:image/"))}
                  onChange={(e) => update("photo", e.target.value)}
                  placeholder={form.photo && form.photo.startsWith("data:image/") ? "파일이 업로드되었습니다" : "드라이브 공유 링크 직접 입력"}
                  style={{ width: "100%", fontSize: "12px", opacity: form.photo && form.photo.startsWith("data:image/") ? 0.6 : 1 }}
                />
                {form.photo ? (
                  <button
                    type="button"
                    onClick={() => update("photo", "")}
                    style={{ fontSize: "11px", color: C.error, background: "none", border: "none", cursor: "pointer", textAlign: "left", fontWeight: 600, padding: 0 }}
                  >
                    이미지 제거
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div>
            <label style={lblStyle}>추가 사진 (여러 장)</label>
            <ItemPhotoGallery
              scriptUrl={scriptUrl}
              category="warehouse"
              itemId={item ? String(item.rowIndex) : null}
              isLightMode={isLightMode}
              showToast={showToast || (() => {})}
              stagedPhotos={item ? undefined : stagedPhotos}
              onStagedPhotosChange={item ? undefined : setStagedPhotos}
            />
          </div>
          <Field label="보관 위치 (랙 구역)" labelStyle={lblStyle}>
            <ToolLocationPicker value={loc} onChange={setLoc} inventory={inventory || []}
              sections={{ ...rackSections, ...sectionEdits }}
              onSectionsChange={(rack, n) => setSectionEdits((cur) => ({ ...cur, [rack]: n }))}
              rackLevels={rackLevels}
              isLightMode={isLightMode} />
          </Field>

          <div>
            <label style={lblStyle}>품목명 <span style={{ color: C.error }}>*</span></label>
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="품목 이름 입력"
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: C.accentText }}>
                선반 내 서브 분류 (예: 공구, M2 규격, M3 규격 등)
              </label>
              {existingSubcategories.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSubMode((m) => (m === "select" ? "custom" : "select"))}
                  style={{ background: "none", border: "none", color: C.accent, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}
                >
                  {subMode === "select" ? "직접 입력" : "목록에서 선택"}
                </button>
              ) : null}
            </div>
            {subMode === "select" && existingSubcategories.length > 0 ? (
              <select
                value={form.spec}
                onChange={(e) => update("spec", e.target.value)}
                style={inputStyle}
              >
                <option value="">선택 안 함 (기타)</option>
                {existingSubcategories.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.spec}
                onChange={(e) => update("spec", e.target.value)}
                placeholder="선반 내에서 구분할 서브 분류 직접 입력"
                style={{ width: "100%" }}
              />
            )}
          </div>

          <Field label="특이사항" labelStyle={lblStyle}>
            <input
              value={form.note}
              onChange={(e) => update("note", e.target.value)}
              placeholder="특이사항 또는 주의사항 입력"
              style={{ width: "100%" }}
            />
          </Field>

          <Field label="🔎 한글 검색어 (선택)" labelStyle={lblStyle}>
            <input
              value={form.keywords || ""}
              onChange={(e) => update("keywords", e.target.value)}
              placeholder="예: 물병, 생수, 페트병 (쉼표로 구분)"
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)", marginTop: 5, lineHeight: 1.5 }}>
              품목명이 영어일 때, 여기에 한글 별칭을 넣어두면 그 단어로도 검색됩니다. (예: "Bottled water" 물품에 "물병, 생수"를 넣으면 물병으로 검색 가능)
            </div>
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <Field label="재고 수량" labelStyle={lblStyle} style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={form.stock === null ? "" : String(form.stock)}
                  disabled={!!item}
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
                  title={item ? "등록된 물품의 수량은 '재고 변경'에서만 바꿀 수 있습니다." : undefined}
                  style={{ width: "100%", flex: 1, opacity: item ? 0.6 : 1, cursor: item ? "not-allowed" : undefined }}
                />
                <button
                  type="button"
                  onClick={() => update("stock", "N/A")}
                  disabled={!!item}
                  style={{
                    background: form.stock === "N/A" ? C.accent : C.accentSoft,
                    border: `1px solid ${form.stock === "N/A" ? C.accent : C.border}`,
                    borderRadius: "10px",
                    padding: "0 12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: form.stock === "N/A" ? "#ffffff" : C.label,
                    cursor: item ? "not-allowed" : "pointer",
                    opacity: item ? 0.55 : 1,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  N/A 지정
                </button>
              </div>
              {item ? <div style={{ fontSize: 11, color: C.label, marginTop: 5 }}>등록 후 수량 변경은 물품 카드의 ‘재고 변경’을 이용해주세요.</div> : null}
            </Field>
          </div>

          <Field label="구매링크" labelStyle={lblStyle}>
            <input
              value={form.link}
              onChange={(e) => update("link", e.target.value)}
              placeholder="N/A 또는 구매 URL"
              style={{ width: "100%" }}
            />
          </Field>

          {/* 체크박스 묶음 — 시나리오 물품 편집과 동일하게 본문 맨 아래에 모아둔다 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "4px" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer", fontSize: "13px", color: C.text, lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={!!form.isConsumable}
                onChange={(e) => update("isConsumable", e.target.checked)}
                style={{ width: 16, height: 16, accentColor: C.accent, marginTop: 1, flexShrink: 0 }}
              />
              <span>
                🔥 소모성 물품
                <span style={{ display: "block", fontSize: "11px", color: C.label, marginTop: 2 }}>
                  대여자가 "대여"를 눌러도 자동으로 소모 처리되어 반납 대상에서 제외됩니다.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px", position: "sticky", bottom: 0, background: C.card }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: "14px", fontWeight: 700 }}
          >
            취소
          </button>
          <button
            onClick={handleSaveClick}
            disabled={!canSave || savingNew}
            style={{
              flex: 2,
              padding: "13px",
              borderRadius: "11px",
              border: "none",
              background: C.accent,
              color: "#fff",
              cursor: canSave && !savingNew ? "pointer" : "not-allowed",
              fontSize: "14px",
              fontWeight: 700,
              opacity: !canSave || savingNew ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <Save size={15} /> {savingNew ? "저장 중..." : item ? "저장하기" : "추가하기"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
