import React, { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { TcCategory, tcCategory, tcNewKey } from "../utils/tableclothCategory";
import { TableclothCategory, saveTableclothCategories } from "../utils/borrowApi";

/** 분류를 고르는 자리에서 쓰는 색상 토큰. 부모 화면에서 쓰던 것을 그대로 넘겨받아 톤을 맞춘다. */
export interface PickerColors {
  card: string; cardSub: string; border: string; text: string; label: string;
  accent: string; error: string;
}

interface Props {
  scriptUrl: string;
  cats: TcCategory[];
  /** 분류표가 바뀌면(추가·이름 수정) 저장된 최신 표를 돌려준다. */
  onCatsChange: (next: TcCategory[]) => void;
  /** 대분류를 고르는 자리면 비우고, 소분류 자리면 그 대분류의 key를 넘긴다. */
  parentKey?: string;
  value: string;
  onChange: (key: string) => void;
  colors: PickerColors;
  inputStyle: React.CSSProperties;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  /** 소분류 자리에서 대분류가 아직 안 골라졌을 때처럼, 고를 것이 없는 상태. */
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 분류 고르기 + 그 자리에서 만들기·이름 고치기.
 *
 * 목록에 없는 무늬를 만났을 때 "분류 관리 탭으로 가서 만들고 → 돌아와서 고른다"는 왕복이 생기면
 * 대개는 그냥 미분류로 남긴다. 그래서 고르는 자리에서 바로 새 이름을 입력해 만들 수 있게 하고,
 * 이름이 어색한 기존 분류도 연필 버튼으로 즉시 고치게 했다.
 *
 * 이름을 고쳐도 물품에 박힌 것은 key라서 이미 분류해 둔 테이블보는 그대로 따라온다.
 */
export default function TableclothCategoryPicker({
  scriptUrl, cats, onCatsChange, parentKey, value, onChange,
  colors: C, inputStyle, showToast, disabled, placeholder,
}: Props) {
  // "" = 평소(고르는 중), "new" = 새로 입력하는 중, "rename" = 고른 것의 이름을 고치는 중
  const [mode, setMode] = useState<"" | "new" | "rename">("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const parent = parentKey ? tcCategory(cats, parentKey) : null;
  const options = parentKey ? (parent?.subs || []) : cats.map((c) => ({ key: c.key, label: c.label }));
  const selected = options.find((o) => o.key === value) || null;

  const commit = async (next: TcCategory[], selectKey: string, okMsg: string) => {
    setSaving(true);
    try {
      const res = await saveTableclothCategories(scriptUrl, next as TableclothCategory[]);
      if (!res?.success) throw new Error(res?.message || "저장에 실패했습니다.");
      onCatsChange((res.categories?.length ? res.categories : next) as TcCategory[]);
      onChange(selectKey);
      setMode(""); setDraft("");
      showToast(okMsg, "ok");
    } catch (e: any) {
      showToast("분류 저장 실패: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const label = draft.trim();
    if (!label) return;
    // 같은 이름이 이미 있으면 만들지 않고 그것을 고른다 — 이름만 같고 속은 다른 분류가 둘 생기면
    // 나중에 어느 쪽에 담았는지 아무도 모른다.
    const dup = options.find((o) => o.label === label);
    if (dup) { onChange(dup.key); setMode(""); setDraft(""); showToast(`이미 있는 분류 '${label}'을(를) 골랐습니다.`, "info"); return; }

    if (parentKey) {
      if (!parent) return;
      const key = tcNewKey("s");
      const next = cats.map((c) => (c.key === parentKey ? { ...c, subs: [...c.subs, { key, label }] } : c));
      await commit(next, key, `'${label}' 세부 분류를 만들었습니다.`);
    } else {
      const key = tcNewKey();
      const next = [...cats, { key, label, emoji: "🏷️", color: "#94a3b8", subs: [] }];
      await commit(next, key, `'${label}' 분류를 만들었습니다. 색과 이모지는 분류 관리 탭에서 바꿀 수 있습니다.`);
    }
  };

  const rename = async () => {
    const label = draft.trim();
    if (!label || !selected) return;
    if (label === selected.label) { setMode(""); return; }
    if (options.some((o) => o.key !== selected.key && o.label === label)) {
      showToast(`'${label}'은(는) 이미 있는 이름입니다.`, "warn");
      return;
    }
    const next = parentKey
      ? cats.map((c) => (c.key === parentKey
          ? { ...c, subs: c.subs.map((s) => (s.key === selected.key ? { ...s, label } : s)) }
          : c))
      : cats.map((c) => (c.key === selected.key ? { ...c, label } : c));
    await commit(next, selected.key, `이름을 '${label}'(으)로 바꿨습니다.`);
  };

  const iconBtn: React.CSSProperties = {
    padding: "8px 9px", borderRadius: "9px", border: `1px solid ${C.border}`,
    background: "transparent", color: C.label, cursor: "pointer", display: "flex", flex: "none",
  };

  // 새 이름을 입력하거나 기존 이름을 고치는 중 — 두 경우의 생김새가 같아 헷갈릴 일이 없다.
  if (mode) {
    const onDone = mode === "new" ? add : rename;
    return (
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onDone(); }
            if (e.key === "Escape") { setMode(""); setDraft(""); }
          }}
          placeholder={mode === "new" ? (parentKey ? "새 세부 분류 이름" : "새 분류 이름") : "새 이름"}
          autoFocus
          disabled={saving}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" onClick={onDone} disabled={saving || !draft.trim()} title="적용"
          style={{ ...iconBtn, color: "#fff", background: draft.trim() ? C.accent : C.border, border: "none", cursor: saving ? "wait" : "pointer" }}>
          <Check size={15} />
        </button>
        <button type="button" onClick={() => { setMode(""); setDraft(""); }} disabled={saving} title="취소" style={iconBtn}>
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "6px" }}>
      <select
        value={value}
        onChange={(e) => {
          // 목록 맨 아래의 "직접 입력"은 고르는 값이 아니라 입력 칸을 여는 스위치다.
          if (e.target.value === "__new__") { setDraft(""); setMode("new"); return; }
          onChange(e.target.value);
        }}
        disabled={disabled}
        style={{ ...inputStyle, flex: 1, opacity: disabled ? 0.55 : 1 }}
      >
        <option value="">{placeholder || "미지정"}</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
        {!disabled ? <option value="__new__">➕ 직접 입력…</option> : null}
      </select>
      <button
        type="button"
        onClick={() => { setDraft(selected?.label || ""); setMode("rename"); }}
        disabled={!selected}
        title={selected ? `'${selected.label}' 이름 고치기` : "먼저 분류를 고르세요"}
        style={{ ...iconBtn, color: selected ? C.label : C.border, cursor: selected ? "pointer" : "not-allowed" }}
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
