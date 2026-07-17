import React, { useMemo, useState } from "react";
import { ImageOff, MapPin, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { InventoryItem } from "../types";
import { C, cardStyle, fuzzy, inputStyle, labelStyle, primaryBtn, secondaryBtnStyle, Spinner } from "../ui";
import { callGas, readFileAsDataUrl } from "../api";

interface Props {
  scriptUrl: string;
  inventory: InventoryItem[];
  onRefresh: () => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
}

const emptyForm = { location: "", spec: "", name: "", link: "", stock: "", manager: "", note: "", photo: "" };

export default function InventoryTab({ scriptUrl, inventory, onRefresh, showToast }: Props) {
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return inventory;
    return inventory.filter(
      (it) => fuzzy(it.name, search) || fuzzy(it.location, search) || fuzzy(it.spec, search)
    );
  }, [inventory, search]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (e: any) {
      showToast("새로고침 실패: " + e.message, "error");
    } finally {
      setRefreshing(false);
    }
  }

  function openAddForm() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEditForm(item: InventoryItem) {
    setEditing(item);
    setForm({
      location: item.location || "",
      spec: item.spec || "",
      name: item.name || "",
      link: item.link || "",
      stock: item.stock === "N/A" || item.stock == null ? "" : String(item.stock),
      manager: item.manager || "",
      note: item.note || "",
      photo: item.photo || "",
    });
    setShowForm(true);
  }

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

  async function submitForm() {
    if (!form.name.trim()) {
      showToast("품명을 입력해주세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        location: form.location.trim(),
        spec: form.spec.trim(),
        name: form.name.trim(),
        link: form.link.trim(),
        stock: form.stock.trim() === "" ? "" : Number(form.stock),
        manager: form.manager.trim(),
        note: form.note.trim(),
        photo: form.photo,
      };
      if (editing) {
        await callGas(scriptUrl, "updateInventoryItem", { ...payload, rowIndex: editing.rowIndex });
        showToast("물품 정보를 수정했습니다.", "ok");
      } else {
        await callGas(scriptUrl, "addInventoryItem", payload);
        showToast("새 물품을 등록했습니다.", "ok");
      }
      setShowForm(false);
      await onRefresh();
    } catch (e: any) {
      showToast("저장 실패: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (!confirm(`'${item.name}' 항목을 삭제할까요?`)) return;
    try {
      await callGas(scriptUrl, "deleteInventoryItem", { rowIndex: item.rowIndex });
      showToast("삭제되었습니다.", "ok");
      await onRefresh();
    } catch (e: any) {
      showToast("삭제 실패: " + e.message, "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: C.sub }} />
          <input
            style={{ ...inputStyle, paddingLeft: 34 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="위치 · 품명 · 규격으로 검색"
          />
        </div>
        <button onClick={handleRefresh} style={{ ...secondaryBtnStyle, padding: "0 14px" }} disabled={refreshing}>
          {refreshing ? <Spinner size={14} /> : <RefreshCw size={14} />}
        </button>
        <button onClick={openAddForm} style={primaryBtn(false)}>
          <Plus size={14} /> 등록
        </button>
      </div>

      <div style={{ fontSize: 11, color: C.sub }}>
        총 {inventory.length}건 중 {filtered.length}건 표시
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: C.sub }}>표시할 재고가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {filtered.map((it) => (
            <div key={it.rowIndex} style={{ ...cardStyle, padding: 14 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: "#f1f5f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    overflow: "hidden",
                  }}
                >
                  {it.photo ? (
                    <img src={it.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <ImageOff size={16} style={{ color: C.sub }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: C.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {it.name}
                  </div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{it.spec || "규격 정보 없음"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                {it.location && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: C.warn,
                      background: "rgba(245,158,11,0.12)",
                      borderRadius: 6,
                      padding: "2px 7px",
                      fontFamily: "monospace",
                    }}
                  >
                    <MapPin size={10} style={{ display: "inline", marginRight: 2, verticalAlign: -1 }} />
                    {it.location}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.success,
                    background: "rgba(16,185,129,0.12)",
                    borderRadius: 6,
                    padding: "2px 7px",
                  }}
                >
                  재고 {it.stock ?? "N/A"}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button
                    onClick={() => openEditForm(it)}
                    style={{ ...secondaryBtnStyle, padding: "4px 10px", fontSize: 11 }}
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(it)}
                    style={{ ...secondaryBtnStyle, padding: "4px 8px", fontSize: 11, color: C.danger }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setShowForm(false)}
        >
          <div
            style={{ ...cardStyle, width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>
                {editing ? "물품 수정" : "새 물품 등록"}
              </div>
              <button onClick={() => setShowForm(false)} style={{ ...secondaryBtnStyle, padding: 6 }}>
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
                <input
                  style={inputStyle}
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="예: A-1-2"
                />
              </div>
              <div>
                <label style={labelStyle}>규격 및 추가 정보</label>
                <input style={inputStyle} value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>재고 수량 (숫자, N/A는 비워두기)</label>
                <input
                  style={inputStyle}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/[^\d]/g, "") })}
                  inputMode="numeric"
                />
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
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: "none" }}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>사진</label>
                <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ fontSize: 12 }} />
                {form.photo && (
                  <img
                    src={form.photo}
                    alt=""
                    style={{ marginTop: 8, width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }}
                  />
                )}
              </div>

              <button style={primaryBtn(saving)} disabled={saving} onClick={submitForm}>
                {saving ? <Spinner size={16} /> : null}
                {saving ? "저장 중..." : editing ? "수정 저장" : "등록하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
