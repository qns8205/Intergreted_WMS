import React, { useState } from "react";
import { X } from "lucide-react";
import { InventoryItem } from "../types";
import { C, cardStyle, inputStyle, labelStyle, primaryBtn, secondaryBtnStyle, Spinner } from "../ui";
import { readFileAsDataUrl } from "../api";

interface Props {
  editing: InventoryItem | null;
  defaultLocation?: string;
  onClose: () => void;
  onSubmit: (payload: {
    location: string;
    spec: string;
    name: string;
    link: string;
    stock: string | number;
    manager: string;
    note: string;
    photo: string;
    rowIndex?: number;
  }) => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
}

export default function InventoryItemForm({ editing, defaultLocation, onClose, onSubmit, showToast }: Props) {
  const [form, setForm] = useState({
    location: editing?.location || defaultLocation || "",
    spec: editing?.spec || "",
    name: editing?.name || "",
    link: editing?.link || "",
    stock: editing && editing.stock !== "N/A" && editing.stock != null ? String(editing.stock) : "",
    manager: editing?.manager || "",
    note: editing?.note || "",
    photo: editing?.photo || "",
  });
  const [saving, setSaving] = useState(false);

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast("이미지 용량은 4MB 이하로 올려주세요.", "warn");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setForm((f) => ({ ...f, photo: dataUrl }));
    } catch (err: any) {
      showToast("이미지를 읽지 못했습니다: " + err.message, "error");
    }
  }

  async function submit() {
    if (!form.name.trim()) {
      showToast("품명을 입력해주세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        location: form.location.trim(),
        spec: form.spec.trim(),
        name: form.name.trim(),
        link: form.link.trim(),
        stock: form.stock.trim() === "" ? "" : Number(form.stock),
        manager: form.manager.trim(),
        note: form.note.trim(),
        photo: form.photo,
        rowIndex: editing?.rowIndex,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div style={{ ...cardStyle, width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>{editing ? "물품 수정" : "새 물품 등록"}</div>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: 6 }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>품명 *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>위치</label>
            <input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="예: A-1-2" />
          </div>
          <div>
            <label style={labelStyle}>규격 및 추가 정보</label>
            <input style={inputStyle} value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>재고 수량 (숫자, N/A는 비워두기)</label>
            <input style={inputStyle} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/[^\d]/g, "") })} inputMode="numeric" />
          </div>
          <div>
            <label style={labelStyle}>담당자</label>
            <input style={inputStyle} value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>링크</label>
            <input style={inputStyle} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>비고</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "none" }} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle}>사진 (드라이브에 업로드되어 링크로 저장됩니다)</label>
            <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ fontSize: 12 }} />
            {form.photo && <img src={form.photo} alt="" style={{ marginTop: 8, width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />}
          </div>
          <button style={primaryBtn(saving)} disabled={saving} onClick={submit}>
            {saving ? <Spinner size={16} /> : null}
            {saving ? "저장 중..." : editing ? "수정 저장" : "등록하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
