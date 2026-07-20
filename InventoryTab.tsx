import React, { useState } from "react";
import { AlertTriangle, ImageOff, Plus, X } from "lucide-react";
import { DefectLog } from "../types";
import { C, cardStyle, inputStyle, labelStyle, primaryBtn, secondaryBtnStyle, Spinner } from "../ui";
import { callGas, readFileAsDataUrl } from "../api";

interface Props {
  scriptUrl: string;
  defectLogs: DefectLog[];
  onRefresh: () => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
}

const emptyForm = { name: "", qty: "", defectType: "", note: "", actionTaken: "", photo: "" };

export default function DefectTab({ scriptUrl, defectLogs, onRefresh, showToast }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
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

  async function submitForm() {
    if (!form.name.trim() || !form.defectType.trim()) {
      showToast("제품명과 불량 유형은 필수입니다.", "warn");
      return;
    }
    setSaving(true);
    try {
      await callGas(scriptUrl, "addDefectLog", {
        name: form.name.trim(),
        qty: form.qty.trim() === "" ? "" : Number(form.qty),
        defectType: form.defectType.trim(),
        note: form.note.trim(),
        actionTaken: form.actionTaken.trim(),
        photo: form.photo,
      });
      showToast("불량 기록이 등록되었습니다.", "ok");
      setForm(emptyForm);
      setShowForm(false);
      await onRefresh();
    } catch (e: any) {
      showToast("등록 실패: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button style={primaryBtn(false, C.danger)} onClick={() => setShowForm(true)}>
        <Plus size={14} /> 불량 기록 등록
      </button>

      {defectLogs.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: C.sub }}>등록된 불량 기록이 없습니다.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...defectLogs].reverse().map((log, i) => (
            <div key={i} style={{ ...cardStyle, padding: 14, display: "flex", gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "#fef2f2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                {log.photo ? (
                  <img src={log.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <ImageOff size={16} style={{ color: C.danger }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertTriangle size={13} style={{ color: C.danger }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{log.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: C.danger,
                      background: "rgba(239,68,68,0.1)",
                      borderRadius: 6,
                      padding: "1px 6px",
                    }}
                  >
                    {log.defectType}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>
                  수량 {log.qty ?? "-"} · {log.timestamp}
                </div>
                {log.note && <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{log.note}</div>}
                {log.actionTaken && (
                  <div style={{ fontSize: 11, color: C.success, marginTop: 3 }}>조치: {log.actionTaken}</div>
                )}
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
              <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>불량 기록 등록</div>
              <button onClick={() => setShowForm(false)} style={{ ...secondaryBtnStyle, padding: 6 }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={labelStyle}>제품명 *</label>
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>불량 개수</label>
                <input
                  style={inputStyle}
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/[^\d]/g, "") })}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label style={labelStyle}>불량 유형 *</label>
                <input
                  style={inputStyle}
                  value={form.defectType}
                  onChange={(e) => setForm({ ...form, defectType: e.target.value })}
                  placeholder="예: 파손, 오염, 기능 오작동"
                />
              </div>
              <div>
                <label style={labelStyle}>세부 사항</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: "none" }}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>대처 방안</label>
                <input
                  style={inputStyle}
                  value={form.actionTaken}
                  onChange={(e) => setForm({ ...form, actionTaken: e.target.value })}
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
              <button style={primaryBtn(saving, C.danger)} disabled={saving} onClick={submitForm}>
                {saving ? <Spinner size={16} /> : null}
                {saving ? "등록 중..." : "등록하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
