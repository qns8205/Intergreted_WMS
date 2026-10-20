export function rentalItemName(item: { itemName?: string; name?: string; itemLabel?: string }): string {
  if (item.itemName?.trim()) return item.itemName.trim();
  if (item.name?.trim()) return item.name.trim();
  return String(item.itemLabel || "").replace(/^\[\d+\]\s*/, "").replace(/\s+[x×]\s*\d+\s*$/i, "").trim();
}

export function rentalNamesText(items: Parameters<typeof rentalItemName>[0][]): string {
  return [...new Set(items.map(rentalItemName).filter(Boolean))].join(", ");
}

/** 서버(padSlot)와 같은 규칙: 숫자만 남기고 6자리로 맞춘다. 숫자가 없으면 ID가 아니다. */
function normalizeItemId(raw: unknown): string {
  const digits = String(raw ?? "").trim().replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : "";
}

/**
 * 물품 ID(예: "000045"). itemId를 우선하고, 없으면 라벨 앞의 "[000045]"에서 뽑는다.
 * ID가 없는 물품(COS 공구는 위치+이름으로만 구분한다)은 빈 문자열이다 — 이름을 ID인 척 내보내면
 * 받는 쪽에서 엉뚱한 물품으로 읽히므로 절대 대신 채우지 않는다.
 */
export function rentalItemId(item: { itemId?: string; itemLabel?: string; [key: string]: unknown }): string {
  const direct = normalizeItemId(item.itemId);
  if (direct) return direct;
  const fromLabel = /^\s*\[(\d+)\]/.exec(String(item.itemLabel || ""));
  return fromLabel ? normalizeItemId(fromLabel[1]) : "";
}

/**
 * 목록의 물품 ID를 중복 없이 순서대로 쉼표로 잇는다.
 * ID가 없는 물품은 빠지므로, 몇 종이 빠졌는지(skipped)를 함께 돌려줘서 화면이 조용히 빠지지 않게 안내한다.
 * 빠진 물품은 같은 이름을 한 종류로 센다.
 */
export function rentalIdsText(items: Parameters<typeof rentalItemId>[0][] & Parameters<typeof rentalItemName>[0][]): { text: string; count: number; skipped: number } {
  const ids: string[] = [];
  const skippedNames = new Set<string>();
  for (const item of items as (Parameters<typeof rentalItemId>[0] & Parameters<typeof rentalItemName>[0])[]) {
    const id = rentalItemId(item);
    if (id) { if (!ids.includes(id)) ids.push(id); }
    else skippedNames.add(rentalItemName(item) || "(이름 없음)");
  }
  return { text: ids.join(", "), count: ids.length, skipped: skippedNames.size };
}

/**
 * 시나리오 물품 대여의 "ID로 담기"에 그대로 붙여 넣을 수 있게 ID·수량·종류를 함께 적는다.
 * 예) "000101*2, 000103(Red)*3, 000105". 같은 물품·같은 종류는 수량을 합친다.
 * 종류가 아직 정해지지 않은 줄은 종류 없이 적는다 — 담을 때 화면이 종류를 묻는다.
 * 종류 이름의 쉼표는 구분자와 헷갈리므로 공백으로 바꾼다.
 */
export function rentalCartText(items: (Parameters<typeof rentalItemId>[0] & Parameters<typeof rentalItemName>[0] & {
  quantity?: unknown; variantName?: string; variantPending?: boolean; variantUnassigned?: boolean;
})[]): { text: string; count: number; skipped: number } {
  const lines = new Map<string, { id: string; variant: string; qty: number }>();
  const skippedNames = new Set<string>();
  for (const item of items) {
    const id = rentalItemId(item);
    if (!id) { skippedNames.add(rentalItemName(item) || "(이름 없음)"); continue; }
    const rawVariant = item.variantPending || item.variantUnassigned ? "" : String(item.variantName || "").trim();
    const variant = rawVariant === "종류 미정" || rawVariant === "종류 미확인" ? "" : rawVariant.replace(/[,，]/g, " ").replace(/\s+/g, " ").trim();
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const key = `${id}::${variant.toLowerCase()}`;
    const prev = lines.get(key);
    if (prev) prev.qty += qty;
    else lines.set(key, { id, variant, qty });
  }
  const text = [...lines.values()].map((l) => `${l.id}${l.variant ? `(${l.variant})` : ""}${l.qty > 1 ? `*${l.qty}` : ""}`).join(", ");
  return { text, count: lines.size, skipped: skippedNames.size };
}

// 사내 HTTP 주소에서도 복사 가능해야 한다. Clipboard API는 HTTPS/localhost에만 제공된다.
export async function copyRentalText(text: string): Promise<void> {
  if (!text) throw new Error("복사할 내용이 없습니다.");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* 권한이 없으면 HTTP 호환 복사 방식을 시도한다. */ }
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.appendChild(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand("copy")) throw new Error("복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해주세요.");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
