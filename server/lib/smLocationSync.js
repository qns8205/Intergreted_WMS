/**
 * WMS의 위치(root_slot)를 Scenario Manager(SM)의 위치에 반영한다.
 *
 * WMS가 창고 실물 장부이므로 위치는 이쪽이 맞다. SM 쪽 위치는 오래되어 어긋나 있다.
 *
 * 조심해야 하는 이유:
 *   세션 방식에는 "이 항목만 고친다"는 경로가 없다 — 수정도 /save_object로 전체를 다시 저장한다.
 *   그래서 SM에서 읽어온 현재 값을 그대로 되돌려 보내고, 위치만 WMS 값으로 바꿔 얹는다.
 *   그렇게 하지 않으면 WMS가 모르는 값(치수·색상·메모 등)이 빈 값으로 덮어써진다.
 *
 *   사진은 되돌려 보낼 수 없다 — /save_object는 사진을 파일로 받는데 우리에게는 SM에 올라간
 *   원본이 없다. 사진을 빼고 저장했을 때 기존 사진이 남는지 지워지는지 확인되지 않았으므로,
 *   전체를 한 번에 처리하기 전에 반드시 한 건으로 확인한다(verifyOne).
 */
import { smFetch, hasSession } from "./smSync.js";
import { all, get, run, transaction } from "../db.js";
import { saveImage } from "./images.js";
import { padSlot } from "./borrowUtils.js";

const log = (msg) => console.log(`[sm-location] ${msg}`);

/**
 * 번호 하나로 오브젝트를 받아올 길이 있는지 확인한다. 아무것도 쓰지 않는다.
 *
 * 지금은 한 종만 바뀌어도 3천여 개를 전부 받는다. 번호로 바로 조회할 수 있으면
 * 그 비용이 사라진다. 후보 경로가 무엇을 돌려주는지 실제로 보고 정한다.
 */
export async function probeLookup(objectId) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = norm(objectId);
  const out = {};
  for (const [name, path] of [
    ["retrieve_object", `/retrieve_object?query=${encodeURIComponent(id)}&k=1`],
    ["get_object_activeness", `/get_object_activeness?id=${encodeURIComponent(id)}`],
    ["objects_page1", `/api/objects?page=1&sort_by=id&sort_dir=desc`],
  ]) {
    try {
      const res = await smFetch(path);
      const text = await res.text();
      let shape = text.slice(0, 400);
      try {
        const d = JSON.parse(text);
        const rows = Array.isArray(d) ? d : d.objects || d.items || d.data || d.results || null;
        shape = rows
          ? `배열 ${rows.length}개 · 첫 항목 키: ${Object.keys(rows[0] || {}).slice(0, 25).join(", ")}`
          : `객체 키: ${Object.keys(d).slice(0, 25).join(", ")}`;
        // 우리가 필요한 건 재고 정보다. 있는지 표시한다.
        const first = rows ? rows[0] : d;
        if (first && typeof first === "object") {
          shape += ` · _inventory 있음: ${!!first._inventory}`;
          if (first._inventory) shape += ` (${Object.keys(first._inventory).slice(0, 10).join(", ")})`;
        }
      } catch { /* JSON이 아니면 앞부분만 보여준다 */ }
      out[name] = { status: res.status, shape };
    } catch (e) {
      out[name] = { error: e.message };
    }
  }
  return { ok: true, id, tried: out };
}

/**
 * 목록을 미리 받아둔다. 서버가 뜬 직후에 한 번 부른다.
 * 이게 없으면 그날의 첫 수정이 목록을 받느라 몇 분을 기다린다.
 */
export function warmCache() {
  if (!hasSession()) return;
  objectsMap({ fresh: true })
    .then((m) => log(`목록 ${m.size}종을 미리 받아뒀습니다.`))
    .catch((e) => log(`목록 미리 받기 실패: ${e.message}`));
}

/** SM 오브젝트 전체를 id로 찾을 수 있게 담아온다. */
async function loadSmObjects() {
  const map = new Map();
  for (let p = 1; p <= 200; p++) {
    const res = await smFetch(`/api/objects?page=${p}`);
    if (!res.ok) throw new Error(`SM 목록 조회 실패 (HTTP ${res.status})`);
    const d = await res.json();
    const rows = Array.isArray(d) ? d : d.objects || d.items || d.data || [];
    if (!rows.length) break;
    for (const r of rows) {
      const id = String(r.id ?? "").trim();
      if (id) map.set(id, r);
    }
  }
  return map;
}

const norm = (v) => String(v ?? "").trim();
const smRootSlot = (rootSlot) => {
  const slot = norm(rootSlot);
  return slot ? slot : "Unknown";
};

// /api/objects에는 "번호 하나만 조회"가 없다(sid는 시나리오 번호용이라 오브젝트 번호로는
// 걸러지지 않는다). 그래서 전체를 한 번 받아 잠깐 들고 있는다 — 묶음 처리에서 물품마다
// 3천여 개를 다시 받는 것을 막는다.
let cache = { at: 0, map: null };
let objectsLoading = null;
const CACHE_MS = Number(process.env.SM_LOCATION_CACHE_MS || 900000); // 15분

async function objectsMap({ fresh = false } = {}) {
  if (!fresh && cache.map && Date.now() - cache.at < CACHE_MS) return cache.map;
  if (!objectsLoading) {
    objectsLoading = loadSmObjects().then(map => {
      cache = { at: Date.now(), map };
      return map;
    }).finally(() => { objectsLoading = null; });
  }
  return objectsLoading;
}

/** 번호 검색 결과 한 건. 전체 오브젝트 목록을 훑지 않아 수 초 안에 끝난다. */
async function fetchOneDirect(objectId) {
  const id = padSlot(objectId);
  if (!id) return null;
  const res = await smFetch(`/retrieve_object?query=${encodeURIComponent(id)}&k=1&_=${Date.now()}`);
  if (!res.ok) throw new Error(`SM 물품 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : data?.results || data?.objects || data?.items || data?.data || [];
  const direct = rows.find((row) => padSlot(row?.id ?? row?.iid) === id) || null;
  if (direct) return direct;

  // retrieve_object는 검색 결과 상위 k개만 주기 때문에 실제로 존재하는 번호도 누락시킨다.
  // 상세 페이지는 번호를 경로로 직접 받으므로, 검색 누락 시 이 폼의 현재 값을 읽어 쓴다.
  try {
    const detail = await fetchOneFromDetail(id);
    if (detail) return detail;
  } catch (detailError) {
    // 구역(sector)이 없는 레거시 물품은 상세 페이지가 500이고 지역별 목록에서도 빠진다.
    // 이름 검색의 후보를 넓히되, 같은 이름의 타 지역 물품이 아니라 정확히 같은 ID만 쓴다.
    const named = await fetchOneFromNameSearch(id);
    if (named) return named;
    // 드물게 상세 페이지 하나만 HTTP 500이 나는 레거시/신규 물품이 있다. 최근 번호는
    // 정렬된 목록 앞쪽에서 직접 찾을 수 있으므로, 저장을 포기하기 전에 한 번 더 찾는다.
    const listed = await fetchOneFromRecentPages(id);
    if (listed) return listed;
    throw detailError;
  }
  const named = await fetchOneFromNameSearch(id);
  if (named) return named;
  return null;
}

async function fetchOneFromNameSearch(objectId) {
  const id = padSlot(objectId);
  const name = norm(get("SELECT name FROM scenario_items WHERE id = ?", [id])?.name);
  if (!name) return null;
  const query = name.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || name;
  const res = await smFetch(`/retrieve_object?query=${encodeURIComponent(query)}&k=100&_=${Date.now()}`);
  if (!res.ok) throw new Error(`SM 물품 이름 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (data?.success === false || data?.status === "error") throw new Error(data.error || "SM 물품 이름 조회 실패");
  const rows = Array.isArray(data) ? data : data?.results || data?.objects || data?.items || data?.data;
  if (!Array.isArray(rows)) throw new Error("SM 물품 이름 조회 응답 형식이 올바르지 않습니다.");
  return rows.find((row) => padSlot(row?.id ?? row?.iid) === id) || null;
}

async function fetchOneFromRecentPages(objectId) {
  const id = padSlot(objectId);
  for (let page = 1; page <= 10; page++) {
    const res = await smFetch(`/api/objects?page=${page}&sort_by=id&sort_dir=desc&_=${Date.now()}`);
    if (!res.ok) throw new Error(`SM 목록 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data?.objects || data?.items || data?.data || [];
    const found = rows.find((row) => padSlot(row?.id ?? row?.iid) === id);
    if (found) return found;
    if (!rows.length) break;
  }
  return null;
}

const decodeHtml = (value) => String(value ?? "")
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function attrOf(tag, name) {
  const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i"));
  return decodeHtml(m?.[1] ?? m?.[2] ?? "");
}

function controlValue(html, key) {
  const controls = String(html).match(/<(?:input|select|textarea)\b[^>]*>/gi) || [];
  const open = controls.find((tag) => attrOf(tag, "name") === key || attrOf(tag, "id") === key);
  if (!open) return "";
  if (/^<input\b/i.test(open)) return attrOf(open, "value");

  const tagName = /^<(select|textarea)\b/i.exec(open)?.[1]?.toLowerCase();
  if (!tagName) return "";
  const start = String(html).indexOf(open);
  const end = String(html).indexOf(`</${tagName}>`, start);
  const inner = end >= 0 ? String(html).slice(start + open.length, end) : "";
  if (tagName === "textarea") return decodeHtml(inner.replace(/<[^>]+>/g, "")).trim();
  const options = inner.match(/<option\b[^>]*>[\s\S]*?<\/option>/gi) || [];
  const selected = options.find((option) => /\bselected(?:\s*=|\s|>)/i.test(option)) || options[0] || "";
  return attrOf(selected, "value") || decodeHtml(selected.replace(/<[^>]+>/g, "")).trim();
}

async function fetchOneFromDetail(objectId) {
  const id = padSlot(objectId);
  const res = await smFetch(`/object_detail/${encodeURIComponent(id)}?_=${Date.now()}`, { headers: { Accept: "text/html" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SM 물품 상세 조회 실패 (HTTP ${res.status})`);
  const html = await res.text();
  const foundId = padSlot(controlValue(html, "id"));
  if (foundId !== id) return null;
  const imageCandidates = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi)]
    .map((match) => decodeHtml(match[1] || match[2] || ""))
    .filter((url) => url && !/logo|favicon|icon/i.test(url));
  return {
    _detailFallback: true,
    id: foundId,
    sector: controlValue(html, "sector"),
    root_slot: controlValue(html, "root_slot"),
    location: controlValue(html, "location"),
    name: controlValue(html, "name"),
    type: controlValue(html, "type"),
    size: controlValue(html, "size"),
    property: controlValue(html, "property"),
    quantity: controlValue(html, "quantity"),
    product_link: controlValue(html, "product_link"),
    product_memo: controlValue(html, "product_memo"),
    forked_from: controlValue(html, "forked_from"),
    util_type: controlValue(html, "util_type"),
    is_restoration: controlValue(html, "is_restoration"),
    image_url: imageCandidates.find((url) => url.includes(id)) || imageCandidates.find((url) => /object|upload|image/i.test(url)) || "",
  };
}

const borrowedCount = (row) => Object.values(row?._inventory?.borrowers || {})
  .reduce((sum, value) => sum + (Number(value) || 0), 0);

function importPreviewRow(row) {
  const totalRaw = Number(row?._inventory?.total);
  const rented = borrowedCount(row);
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : rented;
  return {
    id: padSlot(row?.id),
    name: norm(row?.name) || "이름 없는 물품",
    sector: norm(row?.sector),
    rootSlot: norm(row?.root_slot),
    image: norm(row?.image_url),
    stock: Math.max(0, total - rented),
    rented,
    total,
    importable: rented === 0,
    blockedReason: rented > 0 ? "SM에서 대여 중인 기록이 있어 가져올 수 없습니다." : "",
    tracked: row?._inventory?.is_tracked === true,
    smSize: norm(row?.size),
    smProperty: norm(row?.property),
    purchaseLink: norm(row?.product_link),
    productMemo: norm(row?.product_memo),
  };
}

/** SM에는 있지만 WMS에는 없는 물품을 읽기만 한다. 기존 WMS 행은 절대 수정하지 않는다. */
export async function previewMissingImports() {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다. 관리자 계정으로 WMS에 다시 로그인해 주세요." };
  const sm = await objectsMap({ fresh: true });
  const existing = new Set(all("SELECT id FROM scenario_items").map((row) => padSlot(row.id)));
  const items = [...sm.values()]
    .map(importPreviewRow)
    .filter((row) => row.id && !existing.has(row.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { ok: true, smCount: sm.size, missingCount: items.length, items };
}

/** 번호 하나만 SM에서 찾아 가져오기 전 상태를 보여준다. */
export async function previewImportById(objectId) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다. 관리자 계정으로 WMS에 다시 로그인해 주세요." };
  const id = padSlot(objectId);
  if (!id) return { ok: false, reason: "SM 물품 번호를 입력해 주세요." };
  if (get("SELECT id FROM scenario_items WHERE id = ?", [id])) return { ok: true, found: true, alreadyExists: true, id };
  const source = await fetchOneDirect(id);
  if (!source) return { ok: true, found: false, alreadyExists: false, id };
  return { ok: true, found: true, alreadyExists: false, item: importPreviewRow(source) };
}

/** 진단용: 번호 한 건의 WMS/SM 주요 필드가 실제로 같은지 읽기만 한다. */
export async function compareItemById(objectId) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = padSlot(objectId);
  const wms = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  const source = await fetchOneDirect(id);
  if (!wms || !source) return { ok: true, id, wmsFound: !!wms, smFound: !!source };
  const sm = importPreviewRow(source);
  return {
    ok: true,
    id,
    wms: { name: norm(wms.name), sector: norm(wms.sector), rootSlot: norm(wms.root_slot), smSize: norm(wms.sm_size), smProperty: norm(wms.sm_property), productMemo: norm(wms.product_memo), hasImage: !!norm(wms.image_path) },
    sm: { name: sm.name, sector: sm.sector, rootSlot: sm.rootSlot, smSize: sm.smSize, smProperty: sm.smProperty, productMemo: sm.productMemo, hasImage: !!sm.image },
  };
}

export async function inspectEditForm(objectId) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = padSlot(objectId);
  const res = await smFetch(`/object_detail/${encodeURIComponent(id)}`, { headers: { Accept: "text/html" } });
  const html = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    forms: [...html.matchAll(/<form\b[^>]*\baction=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]),
    fields: [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]),
    fileFields: [...html.matchAll(/<input\b[^>]*\btype=["']file["'][^>]*>/gi)].map((m) => ({ tag: m[0].slice(0, 300), name: (m[0].match(/\bname=["']([^"']+)/i) || [])[1] || "" })),
    saveSnippets: [...html.matchAll(/.{0,240}(?:save_object|objectImage|FormData).{0,420}/gis)].slice(0, 12).map((m) => m[0].replace(/\s+/g, " ")),
  };
}

/** 미리보기에서 고른 SM 물품만 WMS에 추가한다. 이미 생긴 ID는 건너뛰므로 재시도해도 중복되지 않는다. */
export async function importMissing(ids = [], manager = "") {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다. 관리자 계정으로 WMS에 다시 로그인해 주세요." };
  const wanted = [...new Set((ids || []).map(padSlot).filter(Boolean))].slice(0, 100);
  if (!wanted.length) return { ok: false, reason: "가져올 물품을 선택해 주세요." };
  const imported = [], skipped = [], failed = [];

  for (const id of wanted) {
    if (get("SELECT id FROM scenario_items WHERE id = ?", [id])) { skipped.push({ id, reason: "이미 WMS에 있음" }); continue; }
    const source = await fetchOneDirect(id);
    if (!source) { failed.push({ id, reason: "SM에서 찾지 못함" }); continue; }
    const item = importPreviewRow(source);
    if (!item.importable) { skipped.push({ id, reason: item.blockedReason }); continue; }
    let imagePath = item.image || null;
    if (item.image) {
      try {
        const fetched = await fetchSmImage(item.image);
        if (fetched) imagePath = (await saveImage(Buffer.from(await fetched.blob.arrayBuffer()), "scenario_items", id)).url;
      } catch (error) {
        log(`${id} 사진 가져오기 실패(물품은 계속 가져옴): ${error.message}`);
      }
    }
    try {
      transaction(() => {
        if (get("SELECT id FROM scenario_items WHERE id = ?", [id])) return;
        run(
          `INSERT INTO scenario_items (id, name, sector, root_slot, category, subcategory, image_path, stock, rented,
             purchase_link, sm_size, sm_property, product_memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, item.name, item.sector || null, item.rootSlot || null, null, null, imagePath,
            item.stock, item.rented, item.purchaseLink || null, item.smSize || null, item.smProperty || null, item.productMemo || null]
        );
        run(
          `INSERT INTO scenario_item_edits (occurred_at, item_id, item_name, change_type, summary, manager)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [new Date().toISOString(), id, item.name, "created", `SM에서 가져옴 (재고 ${item.stock}개 · 대여 중 ${item.rented}개)`, manager || null]
        );
      });
      imported.push({ id, name: item.name });
    } catch (error) {
      failed.push({ id, reason: error.message });
    }
  }
  return { ok: true, importedCount: imported.length, skippedCount: skipped.length, failedCount: failed.length, imported, skipped, failed };
}

/**
 * 어긋난 물품 목록을 만든다. 아무것도 쓰지 않는다.
 * WMS에 위치가 비어 있는 물품은 대상에서 뺀다 — 빈 값으로 SM을 지울 이유가 없다.
 */
export async function compare() {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다. 관리자 계정으로 WMS에 다시 로그인해 주세요." };
  const sm = await objectsMap({ fresh: true });
  const rows = all("SELECT id, name, root_slot FROM scenario_items ORDER BY id");

  const diff = [];
  const skippedNotNumeric = [];
  let same = 0, notInSm = 0, noWmsLocation = 0;
  for (const w of rows) {
    const id = norm(w.id);
    const wmsLoc = norm(w.root_slot);
    if (!wmsLoc) { noWmsLocation++; continue; }
    // 숫자가 아닌 위치는 보내지 않는다 — 자리 번호가 아닌 값이 SM에 들어가면 되돌리기 번거롭다.
    if (!/^[0-9]+$/.test(wmsLoc)) { skippedNotNumeric.push({ id, name: w.name || "", wms: wmsLoc }); continue; }
    const s = sm.get(id);
    if (!s) { notInSm++; continue; }
    // 여섯 자리 숫자는 root_slot이다. SM의 location은 다른 뜻이라 건드리지 않는다.
    const smSlot = norm(s.root_slot);
    if (smSlot === wmsLoc) { same++; continue; }
    diff.push({ id, name: w.name || "", wms: wmsLoc, smRootSlot: smSlot, smLocation: norm(s.location), hasImage: !!norm(s.image_url) });
  }
  return {
    ok: true,
    total: rows.length,
    smCount: sm.size,
    same,
    notInSm,
    noWmsLocation,
    skippedNotNumericCount: skippedNotNumeric.length,
    skippedNotNumeric,
    differCount: diff.length,
    differ: diff,
  };
}

/** SM에서 읽어온 현재 값을 그대로 되돌려 보내고, 위치만 WMS 값으로 바꾼다. */
function imageBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) return null;
  const ext = (m[1].split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  return { blob: new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), filename: `object.${ext}` };
}

/**
 * SM에 올라가 있는 사진을 그대로 받아온다.
 *
 * /save_object는 오브젝트를 통째로 다시 쓰기 때문에, 사진을 안 실어 보내면 지워진다.
 * 우리에게 원본이 없다는 게 그동안 위치·링크 수정을 자동으로 하지 못한 이유였다.
 * SM이 사진 주소를 내려주므로, 저장 직전에 그 주소에서 받아 다시 실어 보내면 된다.
 */
async function fetchSmImage(imageUrl) {
  const url = norm(imageUrl);
  if (!url) return null;
  try {
    // 같은 서버의 상대 경로면 세션으로 받아오고, 외부 주소면 그대로 받는다.
    const res = url.startsWith("http") ? await fetch(url, { signal: AbortSignal.timeout(15000) }) : await smFetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const ext = (type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
    return { blob: new Blob([buf], { type }), filename: `object.${ext}` };
  } catch {
    return null;
  }
}

function saveForm(smRow, wmsLocation, imageDataUrl, keptImage) {
  const fd = new FormData();
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "") fd.append(k, String(v)); };
  put("id", norm(smRow.id));
  put("sector", norm(smRow.sector));
  put("name", norm(smRow.name));
  put("type", norm(smRow.type) || "Obj");
  put("size", norm(smRow.size) || "Medium");
  put("property", norm(smRow.property) || "Hard");
  // 이번에 바꾸는 값은 root_slot 하나다.
  put("root_slot", wmsLocation);
  // location은 SM의 현재 값을 그대로 되돌려 보낸다 — 뜻이 다른 칸이라 건드리지 않는다.
  // 다만 /save_object가 location을 필수로 받으므로, SM 쪽이 비어 있으면 root_slot으로 채운다.
  put("location", norm(smRow.location) || wmsLocation);
  // 아래는 전부 SM의 현재 값을 그대로 되돌려 보내는 것 — 안 보내면 지워진다.
  put("grid_size", smRow.grid_size);
  put("folding_grid_size", smRow.folding_grid_size);
  put("height", smRow.height);
  put("colors", smRow.colors);
  put("toyish", smRow.toyish);
  put("single_arm_manipulation", smRow.single_arm_manipulation);
  put("double_arm_manipulation", smRow.double_arm_manipulation);
  put("has_enough_number", smRow.has_enough_number);
  put("product_link", smRow.product_link);
  put("product_memo", smRow.product_memo);
  put("util_type", smRow.util_type);
  // 수량은 재고 동기화(smSync)가 따로 맞춘다. 여기서 건드리면 그쪽과 부딪힌다.
  const q = smRow.quantity ?? smRow?._inventory?.available;
  if (q !== undefined && q !== null && q !== "") put("quantity", q);
  // 사진은 파일이라 되돌려 보낼 수가 없다. 다만 방금 등록한 물품이라면 WMS가 원본을 들고
  // 있으므로 그걸 다시 올린다 — 안 그러면 등록할 때 올라간 사진이 이 저장에 지워질 수 있다.
  // 사진은 파일이라 값으로 되돌려 보낼 수 없다. WMS가 원본을 들고 있으면 그것을,
  // 없으면 SM에서 방금 받아온 것을 다시 올린다. 둘 다 없을 때만 사진 없이 저장한다.
  const img = imageBlob(imageDataUrl) || keptImage;
  if (img) fd.append("image", img.blob, img.filename);
  return fd;
}

/**
 * 현재 SM 상세 화면이 /save_object로 보내는 필드만 구성한다.
 * 예전 폼의 colors/grid_size 같은 배열 필드를 다시 보내면 일부 레거시 물품에서
 * `list index out of range`가 발생한다. 저장 API는 누락 필드를 유지하므로 보내지 않는다.
 */
function metadataSaveForm(smRow, imageDataUrl = "") {
  const fd = new FormData();
  const put = (key, value, { allowEmpty = false } = {}) => {
    if (value === undefined || value === null) return;
    const text = String(value);
    if (allowEmpty || text !== "") fd.append(key, text);
  };
  put("id", norm(smRow.id));
  put("sector", smRow.sector, { allowEmpty: true });
  put("root_slot", smRow.root_slot, { allowEmpty: true });
  put("location", smRow.location || smRow.root_slot);
  put("is_restoration", smRow.is_restoration);
  put("name", smRow.name, { allowEmpty: true });
  put("type", smRow.type || "Obj");
  put("size", smRow.size || "Small");
  put("property", smRow.property || "Hard");
  put("quantity", smRow.quantity ?? smRow?._inventory?.available);
  put("product_link", smRow.product_link, { allowEmpty: true });
  put("product_memo", smRow.product_memo, { allowEmpty: true });
  put("forked_from", smRow.forked_from);
  put("util_type", smRow.util_type || "common");
  const image = imageBlob(imageDataUrl);
  if (image) fd.append("image", image.blob, image.filename);
  return fd;
}

/**
 * 번호로 SM 오브젝트 하나를 찾는다.
 *
 * WMS는 번호를 여섯 자리로 채워 쓰고("003900") SM도 대개 같은 형태지만, 양쪽 표기가
 * 어긋나는 경우가 있다. 글자 그대로 먼저 찾고, 없으면 숫자로 견줘 같은 것을 고른다.
 */
async function fetchOne(id, { fresh = false } = {}) {
  const map = await objectsMap({ fresh });
  const want = norm(id);
  const exact = map.get(want);
  if (exact) return exact;
  const n = Number(want);
  if (!Number.isFinite(n)) return null;
  for (const [k, v] of map) if (Number(k) === n) return v;
  return null;
}

/** 번호 하나로 SM의 현재 행을 읽는다(전체 목록을 받지 않는다). 저장한 값이 실제로 반영됐는지 확인할 때 쓴다. */
export const readSmObject = (objectId) => fetchOneDirect(objectId);

/**
 * 오브젝트 하나의 위치(root_slot)만 SM에 반영한다.
 * 오브젝트를 새로 만든 직후에도 쓴다 — 등록 단계에는 위치 칸이 없어서, 번호가 난 뒤에 넣는다.
 */
export async function setRootSlot(objectId, rootSlot, { current = null, imageDataUrl = "" } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = norm(objectId), slot = smRootSlot(rootSlot);
  if (slot !== "Unknown" && !/^[0-9]+$/.test(slot)) return { ok: false, reason: `위치가 숫자가 아닙니다: ${slot}` };
  // 부르는 쪽이 현재 값을 이미 들고 있으면 그걸 쓴다. 없을 때만 SM에서 받아온다 —
  // 전체 목록을 새로 받는 건 몇 분짜리 작업이라, 방금 만든 오브젝트에까지 시킬 일이 아니다.
  const cur = current || (await fetchOne(id, { fresh: true }));
  if (!cur) return { ok: false, reason: `${id}를 SM에서 찾지 못했습니다.` };
  const kept = imageDataUrl ? null : await fetchSmImage(cur.image_url);
  const res = await smFetch("/save_object", { method: "POST", body: saveForm(cur, slot, imageDataUrl, kept), timeoutMs: 45000 });
  if (!res.ok) return { ok: false, reason: `저장 실패 (HTTP ${res.status})` };
  log(`${id} 위치 ${norm(cur.root_slot) || "(빈값)"} -> ${slot}`);
  return { ok: true, id, rootSlot: slot };
}

/**
 * WMS에서 물품을 고쳤을 때 SM의 같은 항목을 맞춘다. 위치와 구매 링크를 함께 보낸다.
 *
 * 저장은 오브젝트 전체를 다시 쓰는 방식뿐이라, 바꾸지 않을 값도 SM에서 읽어 그대로
 * 되돌려 보낸다. 사진도 SM에서 받아 다시 올린다. 그래서 이 호출로 다른 값이 사라지지 않는다.
 *
 * 실패해도 WMS 저장은 되돌리지 않는다 — 창고 장부가 먼저고, SM은 뒤따라오는 쪽이다.
 * 무엇이 됐고 무엇이 안 됐는지만 그대로 돌려준다.
 */
export async function pushItemChanges(objectId, {
  rootSlot, productLink, name, sector, smSize, smProperty, productMemo, imageDataUrl = "",
} = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = norm(objectId);
  // 번호 단건 검색이 재고까지 돌려주므로 전체 목록을 훑지 않는다.
  const cur = await fetchOneDirect(id);
  if (!cur) return { ok: false, reason: `${id}를 SM에서 찾지 못했습니다.` };

  // 위치는 여섯 자리 숫자 또는 명시적인 Unknown만 SM에 보낸다.
  // WMS의 빈 위치를 그대로 비워 보내면 SM이 기존 값을 유지하는 경우가 있어, 위치 없음은 Unknown으로 고정한다.
  const slot = norm(rootSlot);
  // 선택 업로드에서 위치를 고르지 않았으면 SM의 현재 위치를 그대로 유지한다. 명시적으로
  // 위치를 선택해 빈 값을 보낸 경우에만 기존 규칙대로 Unknown으로 바꾼다.
  const nextSlot = rootSlot === undefined
    ? norm(cur.root_slot)
    : slot ? (/^[0-9]{6}$/.test(slot) ? slot : norm(cur.root_slot)) : "Unknown";

  const merged = { ...cur };
  if (name !== undefined) merged.name = norm(name);
  if (sector !== undefined) merged.sector = norm(sector);
  if (productLink !== undefined) merged.product_link = norm(productLink);
  if (smSize !== undefined) merged.size = norm(smSize) || "Small";
  if (smProperty !== undefined) merged.property = norm(smProperty) || "Hard";
  if (productMemo !== undefined) merged.product_memo = norm(productMemo);

  merged.root_slot = nextSlot;
  // 상세 화면과 같은 최소 필드만 보낸다. 사진을 새로 올리지 않는 경우 image 필드를
  // 생략하면 SM이 기존 사진을 유지하므로, 느린 사진 재다운로드도 필요 없다.
  const res = await smFetch("/save_object", { method: "POST", body: metadataSaveForm(merged, imageDataUrl) });
  const responseText = await res.text();
  let responseData = null;
  try { responseData = JSON.parse(responseText); } catch { /* HTML/빈 응답이면 아래 검증으로 판단 */ }
  if (!res.ok) return { ok: false, reason: `저장 실패 (HTTP ${res.status}): ${responseText.slice(0, 180)}` };

  // SM은 HTTP 200을 주고도 일부 필드를 무시할 수 있다. 실제 값을 다시 읽어 같아졌을 때만
  // 성공으로 기록해야 버튼에서 거짓 성공을 보여주지 않는다.
  const after = await fetchOneDirect(id);
  const missed = [];
  if (name !== undefined && norm(after?.name) !== norm(merged.name)) missed.push("이름");
  if (sector !== undefined && norm(after?.sector) !== norm(merged.sector)) missed.push("구역");
  if (rootSlot !== undefined && norm(after?.root_slot) !== norm(merged.root_slot)) missed.push("위치");
  if (productLink !== undefined && norm(after?.product_link) !== norm(merged.product_link)) missed.push("구매 링크");
  if (smSize !== undefined && norm(after?.size) !== norm(merged.size)) missed.push("크기");
  if (smProperty !== undefined && norm(after?.property) !== norm(merged.property)) missed.push("속성");
  if (productMemo !== undefined && norm(after?.product_memo) !== norm(merged.product_memo)) missed.push("메모");
  // 상세 페이지 fallback은 사진 URL이 img 태그로 노출되지 않는 SM 버전도 있다.
  // 그 경우 저장 HTTP 성공을 기준으로 삼고, URL을 읽을 수 있을 때만 사진을 재검증한다.
  if (imageDataUrl && !norm(after?.image_url) && !after?._detailFallback) missed.push("사진");
  if (missed.length) {
    const status = norm(responseData?.status || responseData?.message || responseText.slice(0, 120));
    return { ok: false, reason: `SM이 ${missed.join("·")} 변경을 저장하지 않았습니다.${status ? ` (SM 응답: ${status})` : ""}`, missed, response: responseData };
  }

  // 들고 있는 목록도 함께 고친다. 안 그러면 다음 수정 때 옛 값을 읽어 되돌려 보낸다.
  if (cache.map) cache.map.set(norm(cur.id), { ...merged, root_slot: nextSlot });

  const changed = [];
  if (nextSlot !== norm(cur.root_slot)) changed.push(`위치 ${norm(cur.root_slot) || "(빈값)"} → ${nextSlot}`);
  if (name !== undefined && norm(name) !== norm(cur.name)) changed.push("이름");
  if (sector !== undefined && norm(sector) !== norm(cur.sector)) changed.push("구역");
  if (productLink !== undefined && norm(productLink) !== norm(cur.product_link)) changed.push("구매 링크");
  if (smSize !== undefined && (norm(smSize) || "Small") !== norm(cur.size)) changed.push("크기");
  if (smProperty !== undefined && (norm(smProperty) || "Hard") !== norm(cur.property)) changed.push("속성");
  if (productMemo !== undefined && norm(productMemo) !== norm(cur.product_memo)) changed.push("메모");
  if (imageDataUrl) changed.push("사진");
  if (slot && !/^[0-9]{6}$/.test(slot)) changed.push(`위치 "${slot}"는 여섯 자리 숫자가 아니라 보내지 않음`);
  log(`${id} 반영${changed.length ? ` · ${changed.join(" · ")}` : " (바뀐 값 없음)"}`);
  return { ok: true, id, changed };
}

/**
 * WMS의 현재 선반 재고를 SM의 가용 수량에 직접 맞춘다.
 * 총 보유 수량이나 대여 중 수량이 아니라, 지금 창고에 남아 있는 stock 값만 보낸다.
 */
export async function setAvailableQuantity(objectId, quantity, { itemName = "" } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = norm(objectId);
  const next = Number(quantity);
  if (!Number.isFinite(next) || next < 0) return { ok: false, reason: `${id}의 WMS 재고 수량이 올바르지 않습니다.` };
  const res = await smFetch("/object_inventory_quantity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oid: id, quantity: next, note: `WMS 정보 일괄 업데이트${itemName ? ` · ${itemName}` : ""}`.slice(0, 300) }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* JSON이 아니면 HTTP 상태로 판단 */ }
  const rejected = data?.success === false || data?.ok === false || !!data?.error;
  if (!res.ok || rejected) return { ok: false, reason: data?.error || data?.message || `수량 저장 실패 (HTTP ${res.status})` };
  return { ok: true, id, changed: [`재고 수량 ${next}개`] };
}

/**
 * 한 건만 반영하고, 사진과 다른 값이 살아남았는지 전후를 비교해 보고한다.
 * 전체를 돌리기 전에 이걸로 안전한지 먼저 확인한다.
 */
export async function verifyOne(objectId) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const id = norm(objectId);
  const wmsRow = all("SELECT root_slot FROM scenario_items WHERE id = ?", [id])[0];
  const wmsLoc = norm(wmsRow?.root_slot);
  if (!wmsLoc) return { ok: false, reason: `${id}는 WMS에 위치가 비어 있습니다.` };

  const before = await fetchOne(id);
  if (!before) return { ok: false, reason: `${id}를 SM에서 찾지 못했습니다.` };

  const res = await smFetch("/save_object", { method: "POST", body: saveForm(before, wmsLoc) });
  const text = await res.text();
  if (!res.ok) return { ok: false, reason: `저장 실패 (HTTP ${res.status}): ${text.slice(0, 200)}` };

  const after = await fetchOne(id, { fresh: true });
  const watch = ["root_slot", "location", "image_url", "name", "type", "size", "property", "colors", "grid_size", "height", "product_link", "product_memo", "sector"];
  const changes = {};
  for (const k of watch) {
    const b = norm(before?.[k]), a = norm(after?.[k]);
    if (b !== a) changes[k] = { before: b, after: a };
  }
  return {
    ok: true,
    id,
    wmsLocation: wmsLoc,
    imageKept: norm(before?.image_url) ? !!norm(after?.image_url) : null,
    changed: changes,
    // root_slot만 바뀌어야 안전하다. location까지 바뀌었다면 SM이 두 값을 연동해 쓰고 있다는 뜻이니
    // 그것도 확인 대상으로 남긴다.
    safe: Object.keys(changes).every((k) => k === "root_slot"),
  };
}

/**
 * 오브젝트 몇 개의 사진·위치 상태를 읽어서 보고한다. 아무것도 쓰지 않는다.
 * 위치를 고친 뒤 사진이 살아남았는지 확인할 때 쓴다.
 */
/**
 * 분석 화면용 SM 활동성 점수. 전체 목록 캐시(15분)를 그대로 쓰므로 SM에 따로 부담을 주지 않는다.
 * 목록을 처음 받는 중이면 오래 걸릴 수 있어 timeoutMs까지만 기다리고, 받기는 뒤에서 계속한다.
 * 반환: { ok, map: Map<id, { score(0~100), usage, status, createdAt }> } 또는 { ok:false, reason }
 */
export async function activenessSnapshot({ timeoutMs = 15000 } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없어 SM 점수를 불러오지 못했습니다. 관리자 계정으로 다시 로그인하면 채워집니다." };
  let timer;
  const loading = objectsMap();
  loading.catch(() => {}); // 시간이 넘어 버린 경우에도 처리되지 않은 거부로 남지 않게 한다.
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  try {
    const map = await Promise.race([loading, timeout]);
    if (!map) return { ok: false, reason: "SM 목록을 받아오는 중입니다. 잠시 뒤 새로고침하면 SM 점수가 채워집니다." };
    const out = new Map();
    for (const [id, r] of map) {
      const score = Number(r._activeness_score);
      out.set(padSlot(id), {
        score: Number.isFinite(score) ? score : null,
        usage: Number(r._usage_count) || 0,
        status: norm(r.status).toUpperCase(),
        createdAt: norm(r.created_at),
      });
    }
    return { ok: true, map: out };
  } catch (err) {
    return { ok: false, reason: `SM 목록 조회 실패: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspect(ids = [], { fresh = false } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const map = await objectsMap({ fresh });
  const want = ids.length ? ids.map(norm) : [...map.keys()];
  const rows = want.map((id) => {
    const r = map.get(id);
    if (!r) return { id, found: false };
    return { id, found: true, name: norm(r.name), rootSlot: norm(r.root_slot), hasImage: !!norm(r.image_url) };
  });
  return { ok: true, count: rows.length, withImage: rows.filter((r) => r.hasImage).length, missingImage: rows.filter((r) => r.found && !r.hasImage).map((r) => r.id), rows: rows.slice(0, 200) };
}

// ── 뒤에서 도는 작업 ─────────────────────────────────────────
//
// SM 목록을 한 번 훑는 데만 몇 분이 걸려서, 요청 하나로 끝내려 하면 브라우저나 curl이 먼저
// 끊긴다. 그래서 시작만 시켜두고 진행 상황을 따로 물어보게 한다. 한 번에 하나만 돈다.

let job = null;

/** 지금 무엇이 얼마나 진행됐는지. 최근 결과 몇 건만 같이 준다. */
export function jobStatus() {
  if (!job) return { running: false, started: false };
  return {
    running: job.running,
    started: true,
    phase: job.phase,
    total: job.total,
    doneCount: job.done.length,
    failedCount: job.failed.length,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    recent: job.done.slice(-10),
    failed: job.failed.slice(-10),
  };
}

/** 작업을 시작만 시키고 곧바로 돌아온다. 진행 상황은 jobStatus()로 본다. */
export function startApply({ ids = null, limit = 1000 } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  if (job?.running) return { ok: false, reason: "이미 진행 중입니다.", status: jobStatus() };

  job = { running: true, phase: "목록 비교 중", total: 0, done: [], failed: [], startedAt: new Date().toISOString(), finishedAt: null, error: "" };

  (async () => {
    const cmp = await compare();
    if (!cmp.ok) throw new Error(cmp.reason);

    let targets = cmp.differ;
    if (ids && ids.length) {
      const want = new Set(ids.map(norm));
      targets = targets.filter((t) => want.has(t.id));
    }
    targets = targets.slice(0, Math.max(1, Number(limit) || 1000));
    job.total = targets.length;
    job.phase = "반영 중";

    for (const t of targets) {
      try {
        const cur = await fetchOne(t.id);
        if (!cur) { job.failed.push({ id: t.id, reason: "SM에서 찾지 못했습니다." }); continue; }
        const kept = await fetchSmImage(cur.image_url);
        const res = await smFetch("/save_object", { method: "POST", body: saveForm(cur, t.wms, "", kept) });
        if (!res.ok) { job.failed.push({ id: t.id, reason: `HTTP ${res.status}` }); continue; }
        job.done.push({ id: t.id, name: t.name, from: t.smRootSlot, to: t.wms });
      } catch (e) {
        job.failed.push({ id: t.id, reason: e.message });
      }
    }
  })()
    .catch((e) => { job.error = e.message; })
    .finally(() => {
      job.running = false;
      job.phase = job.error ? "오류로 중단" : "완료";
      job.finishedAt = new Date().toISOString();
      log(`위치 반영 ${job.done.length}건${job.failed.length ? ` · 실패 ${job.failed.length}건` : ""}${job.error ? ` · 오류: ${job.error}` : ""}`);
    });

  return { ok: true, started: true, status: jobStatus() };
}

/**
 * 어긋난 물품들의 위치를 SM에 반영한다.
 * `limit`으로 한 번에 처리할 건수를 묶는다 — 실수로 수백 건이 한꺼번에 나가지 않게 한다.
 */
export async function apply({ ids = null, limit = 25 } = {}) {
  if (!hasSession()) return { ok: false, reason: "Scenario Manager 세션이 없습니다." };
  const cmp = await compare();
  if (!cmp.ok) return cmp;

  let targets = cmp.differ;
  if (ids && ids.length) {
    const want = new Set(ids.map(norm));
    targets = targets.filter((t) => want.has(t.id));
  }
  targets = targets.slice(0, Math.max(1, Number(limit) || 25));

  const done = [], failed = [];
  for (const t of targets) {
    try {
      const cur = await fetchOne(t.id);
      if (!cur) { failed.push({ id: t.id, reason: "SM에서 찾지 못했습니다." }); continue; }
      const kept = await fetchSmImage(cur.image_url);
      const res = await smFetch("/save_object", { method: "POST", body: saveForm(cur, t.wms, "", kept) });
      if (!res.ok) { failed.push({ id: t.id, reason: `HTTP ${res.status}` }); continue; }
      done.push({ id: t.id, from: t.smRootSlot, to: t.wms });
    } catch (e) {
      failed.push({ id: t.id, reason: e.message });
    }
  }
  log(`위치 반영 ${done.length}건${failed.length ? ` · 실패 ${failed.length}건` : ""}`);
  return { ok: true, appliedCount: done.length, failedCount: failed.length, remaining: cmp.differCount - done.length, done, failed };
}
