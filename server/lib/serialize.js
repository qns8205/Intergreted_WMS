/** Maps DB rows (snake_case, numeric `id`) to the JSON shapes the existing frontend types expect. */

export function toInventoryItem(r) {
  return {
    rowIndex: r.id,
    location: r.location,
    photo: r.image_path,
    name: r.name,
    link: r.purchase_link,
    stock: r.stock,
    updatedAt: r.updated_at,
    manager: r.manager,
    manager2: r.manager2,
    note: r.note,
    spec: r.subcategory,
    keywords: r.keywords,
    consumable: r.consumable,
    isConsumable: !["", "false", "0", "x", "n", "no", "off"].includes(String(r.consumable ?? "").trim().toLowerCase()),
    archived: !!(r.archived && r.archived !== "FALSE" && r.archived !== "0"),
  };
}

export function toDefectLog(r) {
  return {
    rowIndex: r.id,
    timestamp: r.occurred_date,
    location: null,
    name: r.product,
    qty: r.qty,
    defectType: r.defect_type,
    manager: r.breaker,
    // breaker 칸에는 "누가 파손했는지"가 들어간다. 화면에 따라 manager로도, culprit으로도
    // 읽고 있어서 둘 다 같은 값으로 내보낸다.
    culprit: r.breaker,
    note: r.detail,
    actionTaken: r.action_taken,
    photo: r.image_path,
    itemCategory: null,
  };
}

export function toRentLog(r) {
  return {
    rowIndex: r.id,
    timestamp: r.occurred_at,
    location: r.location,
    name: r.name,
    type: r.type,
    qty: r.qty,
    user: r.manager,
    employeeId: r.employee_id || "",
    note: r.note,
  };
}

export function toSector(r) {
  return {
    id: r.id,
    name: r.name,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    rotation: r.rotation,
    color: r.color,
    shelves: [],
  };
}

export function toAdminUserPublic(r) {
  return { id: r.id, loginId: r.login_id, name: r.name };
}

/** Sheet-imported checkbox columns store the original cell text verbatim (e.g. "TRUE"/"true"/"O"),
 *  so treat anything that isn't blank/false-ish as checked rather than assuming one exact spelling. */
function toBool(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s !== "" && s !== "false" && s !== "0" && s !== "x" && s !== "n";
}

/** `opts.forAdmin`일 때만 구매 링크를 싣는다. 기본이 비공개인 이유는, 이 함수의 결과가
 *  대여 화면·모바일 조회 등 여러 경로로 그대로 나가기 때문이다 — 한 곳만 빠뜨려도 새어나간다. */
export function toScenarioObject(r, opts = {}) {
  return {
    rowIndex: r.id,
    id: r.id,
    name: r.name,
    sector: r.sector,
    rootSlot: r.root_slot,
    category: r.category,
    subcategory: r.subcategory,
    image: r.image_path,
    stock: r.stock,
    rented: r.rented,
    unassignedStock: Number(r.unassigned_stock) || 0,
    excludeFromRanking: toBool(r.exclude_low_rent),
    fragile: toBool(r.fragile),
    fireRisk: toBool(r.fire),
    requestFor: r.request ?? undefined,
    personalOwner: r.personal_owner ?? undefined,
    archived: toBool(r.is_storage),
    // 실측 치수(mm). 선택 입력이라 안 넣은 물품은 undefined로 나간다.
    widthMm: r.width_mm ?? undefined,
    depthMm: r.depth_mm ?? undefined,
    heightMm: r.height_mm ?? undefined,
    // 치수를 그릴 형태. 안 고른 물품은 육면체로 본다.
    shape: r.shape || "box",
    // 구매 링크는 관리 화면 전용이다.
    // 구매 링크와 SM 등록용 값들은 관리 화면 전용이다.
    ...(opts.forAdmin
      ? {
          purchaseLink: r.purchase_link || "",
          smSize: r.sm_size || "",
          smProperty: r.sm_property || "",
          productMemo: r.product_memo || "",
        }
      : {}),
  };
}

/** 테이블보는 이름을 붙이지 않고 번호로 부른다 — 자동 증가 id를 그대로 라벨로 쓴다. */
export function tableclothLabel(id) {
  return `TC-${String(Number(id) || 0).padStart(4, "0")}`;
}

export function toTableclothItem(r) {
  return {
    id: r.id,
    // 화면·장부에 쓰는 이름은 항상 번호 라벨이다. name 컬럼은 예전 데이터 보존용으로만 남겨둔다.
    name: tableclothLabel(r.id),
    location: r.location || "",
    image: r.image_path || "",
    stock: Number(r.stock) || 0,
    rented: Number(r.rented) || 0,
    // 천은 두께가 의미 없어 가로·세로만 쓴다
    widthMm: r.width_mm ?? undefined,
    depthMm: r.depth_mm ?? undefined,
    // 무늬 분류 — 분류 전이면 빈 문자열이라 화면에서는 "미분류"로 묶인다.
    category: r.category || "",
    subcategory: r.subcategory || "",
    // 참고 링크. 여러 개면 줄바꿈으로 이어 붙여 두고, 화면에서 줄 단위로 끊어 보여준다.
    link: r.link || "",
    note: r.note || "",
    archived: toBool(r.archived),
    updatedAt: r.updated_at || "",
  };
}
