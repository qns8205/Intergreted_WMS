// 시나리오 물품 ID를 콤마로 이어 적어 장바구니에 한 번에 담는다.
//   예) 101, 000102*2, 103/빨강 x3, 104(Large) 2개
// ID는 앞의 0을 빼고 적어도 된다. 수량은 *2 · x2 · ×2 · 2개, 종류는 /이름 또는 (이름)으로 적는다.

export interface BulkToken { raw: string; id: string; variant?: string; qty: number }

interface CatalogVariant { id: number; name: string; stock: number }
export interface CatalogItem { id: string; name: string; rootSlot?: string; stock: number; variants?: CatalogVariant[] }
interface CartLine { id: string; variantId?: number; quantity: number }

export interface BulkAddLine {
  item: CatalogItem; variantId?: number; variantName?: string;
  qty: number; requested: number; stock: number;
}
export interface BulkPlan {
  /** 바로 담을 줄. 재고(장바구니에 이미 담긴 수량 포함)를 넘는 만큼은 줄였다. */
  add: BulkAddLine[];
  /** 종류가 나뉜 물품인데 종류를 안 적었거나 맞는 종류가 없어, 사람이 골라야 하는 것. */
  needVariant: { item: CatalogItem; qty: number; hint?: string }[];
  noStock: { id: string; name: string; requested: number }[];
  unknown: string[];
  invalid: string[];
}

const QTY_SUFFIX = /\s*(?:[*xX×]\s*(\d+)|(\d+)\s*개)\s*$/;
const ID_PART = /^(\d{1,6})\s*(?:\/\s*(.+)|\(\s*(.+?)\s*\))?$/;
const norm = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function parseBulkIds(text: string, pad: (id: string) => string): { tokens: BulkToken[]; invalid: string[] } {
  const merged = new Map<string, BulkToken>();
  const invalid: string[] = [];
  for (const piece of text.split(/[,，;\n\r]+/)) {
    const raw = piece.trim();
    if (!raw) continue;
    let body = raw, qty = 1;
    const q = QTY_SUFFIX.exec(body);
    if (q) { qty = Number(q[1] ?? q[2]); body = body.slice(0, q.index).trim(); }
    const m = ID_PART.exec(body);
    if (!m || !Number.isInteger(qty) || qty < 1 || qty > 999) { invalid.push(raw); continue; }
    const id = pad(m[1]);
    const variant = (m[2] ?? m[3] ?? "").trim() || undefined;
    // 같은 물품·같은 종류를 여러 번 적으면 수량을 합친다.
    const key = `${id}::${variant ? norm(variant) : ""}`;
    const prev = merged.get(key);
    if (prev) prev.qty += qty;
    else merged.set(key, { raw, id, variant, qty });
  }
  return { tokens: [...merged.values()], invalid };
}

/** 적은 이름과 같은 종류. 똑같은 이름이 없으면 그 이름을 포함하는 종류가 하나뿐일 때만 고른다. */
export function matchVariant(variants: CatalogVariant[], hint: string): CatalogVariant | null {
  const h = norm(hint);
  if (!h) return null;
  const exact = variants.filter((v) => norm(v.name) === h);
  if (exact.length === 1) return exact[0];
  const partial = variants.filter((v) => norm(v.name).includes(h));
  return partial.length === 1 ? partial[0] : null;
}

export function planBulkAdd(tokens: BulkToken[], catalog: CatalogItem[], cart: CartLine[], pad: (id: string) => string): BulkPlan {
  const plan: BulkPlan = { add: [], needVariant: [], noStock: [], unknown: [], invalid: [] };
  const byId = new Map(catalog.map((item) => [pad(String(item.id)), item]));
  // 같은 줄(물품·종류)에 이번 입력으로 이미 배정한 수량. 재고를 두 번 쓰지 않게 한다.
  const planned = new Map<string, number>();
  const inCart = (id: string, variantId?: number) => cart
    .filter((c) => pad(String(c.id)) === id && (c.variantId ?? undefined) === variantId)
    .reduce((n, c) => n + (Number(c.quantity) || 0), 0);

  for (const token of tokens) {
    const item = byId.get(token.id);
    if (!item) { plan.unknown.push(token.raw); continue; }
    let variant: CatalogVariant | null = null;
    if (item.variants?.length) {
      variant = token.variant ? matchVariant(item.variants, token.variant) : null;
      if (!variant) { plan.needVariant.push({ item, qty: token.qty, hint: token.variant }); continue; }
    }
    const stock = Number(variant ? variant.stock : item.stock) || 0;
    const key = `${token.id}::${variant?.id ?? ""}`;
    const used = inCart(token.id, variant?.id) + (planned.get(key) || 0);
    const qty = Math.min(token.qty, Math.max(0, stock - used));
    if (qty <= 0) { plan.noStock.push({ id: token.id, name: variant ? `${item.name} · ${variant.name}` : item.name, requested: token.qty }); continue; }
    planned.set(key, (planned.get(key) || 0) + qty);
    plan.add.push({ item, variantId: variant?.id, variantName: variant?.name, qty, requested: token.qty, stock });
  }
  return plan;
}
