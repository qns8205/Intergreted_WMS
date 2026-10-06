import fs from "node:fs";
import sharp from "sharp";
import QRCode from "qrcode";
import { get, all } from "../db.js";
import { locationSortIndex } from "./locationSort.js";
import { resolveRentalRequest } from "./requestCode.js";

const DEVICE = process.env.WMS_LABEL_PRINTER || "/dev/usb/lp0";
// 한 장에 싣는 물품 수. 머리글을 한 줄로 줄여서 5개까지 크게 싣는다(예전 6개는 글자가 2mm대로 작았다).
const ITEMS_PER_LABEL = 5;
const LOOKUP_URL = process.env.QR_LOOKUP_URL
  || `http://192.168.100.152:${process.env.CAMERA_PORT || 3002}${process.env.QR_LOOKUP_PATH || "/pickup/4e91c7b2a860"}`;
// 말풍선 "SCAN ME" QR 스티커가 여는 주소 — 사내 Slack 워크스페이스 초대 링크.
const SCAN_ME_DATA = process.env.SCAN_ME_QR_DATA
  || "https://cfgwkr.slack.com/join/shared_invite/zt-4boqdks9t-LZIKZ5kiWD996ZKJac5vqw#/shared-invite";
const SCAN_ME_MAX_COPIES = 50;
let printQueue = Promise.resolve();

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[char] || char));
}

function padId(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : "";
}

function parseItemLabel(label) {
  const text = String(label || "").trim();
  const idMatch = /^\[(\d+)\]\s*(.*)$/.exec(text);
  let id = "", rest = text;
  if (idMatch) { id = padId(idMatch[1]); rest = idMatch[2]; }
  const qtyMatch = /\s*[x×]\s*(\d+)\s*$/i.exec(rest);
  let quantity = 1, name = rest;
  if (qtyMatch) { quantity = Number(qtyMatch[1]) || 1; name = rest.slice(0, qtyMatch.index); }
  return { id, name: name.trim(), quantity };
}

function requestItems(requestNo) {
  const request = get("SELECT id, borrower_name, employee_id FROM rental_requests WHERE id = ?", [requestNo]);
  if (!request) throw new Error("신청번호를 찾을 수 없습니다.");
  const merged = new Map();
  const add = ({ id, name, quantity, location, variantName }) => {
    const key = `${id || name}|${variantName || ""}|${location || ""}`;
    const previous = merged.get(key);
    if (previous) previous.quantity += quantity || 1;
    else merged.set(key, { id, name, quantity: quantity || 1, location: location || "위치 미등록", variantName: variantName || "" });
  };
  const details = (id, variantId) => ({
    object: id ? get("SELECT name, root_slot FROM scenario_items WHERE id = ?", [id]) : null,
    variant: variantId ? get("SELECT name FROM scenario_item_variants WHERE id = ?", [variantId]) : null,
  });
  for (const row of all("SELECT item_label, variant_id FROM sid_rentals WHERE request_no = ? AND COALESCE(returned, '') != 'O' AND COALESCE(status, '') != 'archived' ORDER BY id", [requestNo])) {
    const parsed = parseItemLabel(row.item_label);
    if (!parsed.id && !parsed.name) continue;
    const { object, variant } = details(parsed.id, row.variant_id);
    add({ id: parsed.id, name: parsed.name || object?.name || "물품", quantity: parsed.quantity, location: object?.root_slot, variantName: variant?.name });
  }
  for (const row of all("SELECT item_id, item_label, qty, variant_id FROM general_rentals WHERE request_no = ? AND COALESCE(returned, '') != 'O' AND COALESCE(status, '') != 'archived' ORDER BY id", [requestNo])) {
    const id = padId(row.item_id);
    const { object, variant } = details(id, row.variant_id);
    add({ id, name: row.item_label || object?.name || "물품", quantity: Number(row.qty) || 1, location: object?.root_slot, variantName: variant?.name });
  }
  const items = [...merged.values()]
    // QR 조회 화면과 같은 창고 동선 순서로 출력한다.
    .sort((a, b) => locationSortIndex(a.location) - locationSortIndex(b.location));
  return { borrowerName: request.borrower_name || "", employeeId: request.employee_id || "", items };
}

/**
 * 글자 폭을 em 단위로 어림한다. 한글·한자·전각은 1em, 영문 대문자·숫자는 약 0.62em, 나머지는 약 0.55em.
 * 글자 수가 아니라 폭으로 맞춰야 한글 이름이 라벨 밖으로 넘치지 않는다.
 */
function textUnits(value) {
  let units = 0;
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0);
    const wide = (code >= 0x1100 && code <= 0x11FF) || (code >= 0x2E80 && code <= 0xD7FF)
      || (code >= 0xF900 && code <= 0xFAFF) || (code >= 0xFF00 && code <= 0xFFEF);
    units += wide ? 1 : ch === " " ? 0.3 : /[A-Z0-9]/.test(ch) ? 0.62 : 0.55;
  }
  return units;
}

/**
 * maxWidth(px) 안에 들어가는 가장 큰 글자 크기를 고른다(maxSize→minSize, 2px씩).
 * 최소 크기로도 넘치면 뒤를 잘라 …을 붙인다. 굵은 글자는 조금 더 넓어서 여유를 둔다.
 */
function fitLine(value, maxSize, minSize, maxWidth) {
  const text = String(value ?? "").trim();
  const BOLD = 1.06;
  for (let size = maxSize; size >= minSize; size -= 2) {
    if (textUnits(text) * size * BOLD <= maxWidth) return { text, size };
  }
  let cut = Array.from(text);
  while (cut.length > 1 && (textUnits(cut.join("")) + 0.6) * minSize * BOLD > maxWidth) cut.pop();
  return { text: `${cut.join("").trimEnd()}…`, size: minSize };
}

/**
 * "홍길동 · 1234" 같은 대여자 표기를 맞춘다. 줄여야 할 때 이름만 줄이고 뒤의 사번은 항상 남긴다 —
 * 같은 이름을 가려내는 건 사번이라, 사번이 잘리면 라벨이 누구 것인지 알 수 없다.
 */
export function fitPerson(value, maxSize, minSize, maxWidth) {
  const whole = fitLine(value, maxSize, minSize, maxWidth);
  if (!whole.text.endsWith("…")) return whole;
  const text = String(value ?? "");
  const cut = text.lastIndexOf(" · ");
  if (cut < 0) return whole;
  const suffix = text.slice(cut);
  const room = maxWidth - Math.ceil(textUnits(suffix) * minSize * 1.06);
  const head = fitLine(text.slice(0, cut), minSize, minSize, room);
  return { text: `${head.text}${suffix}`, size: minSize };
}

/**
 * 긴 이름을 줄이는 대신 maxWidth에 맞춰 최대 maxLines줄로 나눈다(단어 단위, 한 단어가 너무 길면 글자 단위).
 * 줄 수를 넘으면 마지막 줄을 …로 줄인다.
 */
function wrapLines(value, size, maxWidth, maxLines) {
  const BOLD = 1.06;
  const fits = (s) => textUnits(s) * size * BOLD <= maxWidth;
  const lines = [];
  let current = "";
  for (const word of String(value ?? "").trim().split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) { current = candidate; continue; }
    if (current) { lines.push(current); current = ""; }
    if (fits(word)) { current = word; continue; }
    for (const ch of word) {
      if (fits(current + ch)) current += ch;
      else { if (current) lines.push(current); current = ch; }
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = Array.from(kept[maxLines - 1]);
  while (last.length > 1 && !fits(`${last.join("")}…`)) last.pop();
  kept[maxLines - 1] = `${last.join("").trimEnd()}…`;
  return kept;
}

/**
 * 세로로 읽히는 40×60 구성을 먼저 만든 뒤 90도 회전해 60×40 실제 라벨에 싣는다.
 *
 * 멀리서도 읽히는 것이 목적이다. 머리글은 한 줄(왼쪽 대여자, 오른쪽 종류·쪽수)로 줄여
 * 물품에 세로 공간을 더 준다. 한 줄에는 물품명(크게)·수량(가장 크게, 오른쪽), 그 아래 줄에는
 * 보관 위치(크고 굵게)를 둔다. 구분선은 회색 대신 검정 2px — 열전사 출력은 회색을 흐리게 뭉개기 때문이다.
 */
// 머리글 오른쪽에 두는 짧은 종류 표시. 제목 전체를 쓰면 대여자 이름 자리가 줄어든다.
const TITLE_TAGS = { "대여 물품": "대여", "반납 위치표": "반납", "한도 제외 물품": "한도제외" };

function labelSvg(title, borrowerName, items, page, totalPages) {
  const width = 320, height = 480;
  // XP-DT427B 203dpi 기준 약 8dot/mm. 세로로 읽을 때 위쪽 여백을 3mm 더 둔다.
  const top = 24;
  const left = 14, right = 306, inner = right - left;
  const tag = [TITLE_TAGS[title] || String(title || "").slice(0, 4), totalPages > 1 ? `${page}/${totalPages}` : ""].filter(Boolean).join(" ");

  // 오른쪽 종류·쪽수 칸을 먼저 떼어 두고, 남은 폭에 대여자 이름을 맞춘다.
  const tagSize = 16;
  const tagWidth = Math.ceil(textUnits(tag) * tagSize * 1.06);
  const person = fitPerson(borrowerName, 26, 18, inner - tagWidth - 10);
  const headRule = top + 36;
  const rowTop = headRule + 6;
  const rowHeight = Math.min(96, Math.floor((height - rowTop - 12) / Math.max(items.length, ITEMS_PER_LABEL)));

  const rows = items.map((item, index) => {
    const y = rowTop + index * rowHeight;
    const qtyText = `×${item.quantity}`;
    const qtySize = textUnits(qtyText) * 38 > 84 ? 28 : 38;
    // 수량 칸을 먼저 떼어 두고, 남은 폭에 물품명을 맞춘다.
    const qtyWidth = Math.ceil(textUnits(qtyText) * qtySize * 1.06) + 10;
    const variant = item.variantName ? ` · ${item.variantName}` : "";
    const fullName = `${item.name}${variant}`;
    const nameMax = inner - qtyWidth;
    // 한 줄에 22px 이상으로 들어가면 한 줄로, 아니면 글자를 줄이지 않고 22px 두 줄로 나눈다.
    const single = fitLine(fullName, 28, 18, nameMax);
    const wrapped = single.size < 22 ? wrapLines(fullName, 22, nameMax, 2) : null;
    const twoLines = !!wrapped && wrapped.length > 1;
    const nameLines = twoLines ? wrapped : [single.size < 22 ? (wrapped?.[0] ?? single.text) : single.text];
    const nameSize = single.size < 22 ? 22 : single.size;
    // 두 줄일 때는 위치 글자를 한 단계 줄이고, 줄 위치는 행 높이에 비례시킨다(행이 80~96px로 달라진다).
    const loc = fitLine(item.location || "위치 미등록", twoLines ? 22 : 28, 18, inner);
    const nameYs = twoLines
      ? [y + Math.round(rowHeight * 0.27), y + Math.round(rowHeight * 0.54)]
      : [y + Math.round(rowHeight * 0.38)];
    const locY = y + Math.round(rowHeight * (twoLines ? 0.85 : 0.80));
    const qtyY = twoLines ? y + Math.round(rowHeight * 0.5) : nameYs[0] + 4;
    return `<g>`
      + nameLines.map((line, n) => `<text x="${left}" y="${nameYs[n]}" class="item" font-size="${nameSize}">${escapeXml(line)}</text>`).join("")
      + `<text x="${right}" y="${qtyY}" text-anchor="end" class="qty" font-size="${qtySize}">${escapeXml(qtyText)}</text>`
      + `<text x="${left}" y="${locY}" class="loc" font-size="${loc.size}">${escapeXml(loc.text)}</text>`
      + `<line x1="${left - 2}" y1="${y + rowHeight - 4}" x2="${right + 2}" y2="${y + rowHeight - 4}" stroke="#000" stroke-width="2"/>`
      + `</g>`;
  }).join("");

  // 글자 획이 가늘면 203dpi 열전사에서 끊겨 보인다. 외곽선을 살짝 둘러 굵게 만든다.
  const style = "text{fill:#000;font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif}"
    + ".tag{font-weight:900;stroke:#000;stroke-width:.4px}"
    + ".person{font-weight:900;stroke:#000;stroke-width:.6px}"
    + ".item{font-weight:900;stroke:#000;stroke-width:.7px}"
    + ".qty{font-weight:900;stroke:#000;stroke-width:.9px}"
    + ".loc{font-weight:800;stroke:#000;stroke-width:.5px;letter-spacing:.5px}";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="100%" height="100%" fill="white"/><style>${style}</style>`
    + `<text x="${left}" y="${top + 26}" class="person" font-size="${person.size}">${escapeXml(person.text)}</text>`
    + `<text x="${right}" y="${top + 26}" text-anchor="end" class="tag" font-size="${tagSize}">${escapeXml(tag)}</text>`
    + `<line x1="${left - 2}" y1="${headRule}" x2="${right + 2}" y2="${headRule}" stroke="#000" stroke-width="3"/>`
    + `${rows}</svg>`,
  );
}

/** 프린터로 보낼 것과 같은 60×40mm 1비트 이미지를 PNG로 만든다(출력 전 확인·테스트용). */
export async function labelPreviewPng(title, borrowerName, items, page = 1, totalPages = 1) {
  return sharp(labelSvg(title, borrowerName, items, page, totalPages))
    .rotate(90).flatten({ background: "white" }).greyscale().threshold(180).png().toBuffer();
}

async function bitmapCommand(svg, copies = 1) {
  const { data, info } = await sharp(svg)
    .rotate(90)
    .flatten({ background: "white" })
    .greyscale()
    .threshold(180)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 480 || info.height !== 320 || info.channels !== 1) {
    throw new Error(`라벨 렌더링 크기가 올바르지 않습니다: ${info.width}x${info.height}x${info.channels}`);
  }
  const widthBytes = info.width / 8;
  const bitmap = Buffer.alloc(widthBytes * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 128) bitmap[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([
    Buffer.from(`SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nSPEED 3\r\nDENSITY 9\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,${widthBytes},${info.height},0,`, "ascii"),
    bitmap,
    Buffer.from(`\r\nPRINT 1,${copies}\r\n`, "ascii"),
  ]);
}

export function printerStatus() {
  try {
    fs.accessSync(DEVICE, fs.constants.W_OK);
    return { connected: true, device: DEVICE };
  } catch (error) {
    return { connected: false, device: DEVICE, error: error.code || error.message };
  }
}

export async function printRentalRequest(requestNo) {
  const request = resolveRentalRequest(requestNo);
  if (!request) throw new Error("올바른 신청번호가 필요합니다.");
  const number = Number(request.id);
  const { borrowerName, employeeId, items } = requestItems(number);
  if (!items.length) throw new Error("출력할 물품이 없습니다.");
  const pages = Array.from({ length: Math.ceil(items.length / ITEMS_PER_LABEL) }, (_, index) => items.slice(index * ITEMS_PER_LABEL, (index + 1) * ITEMS_PER_LABEL));
  const job = async () => {
    for (let index = 0; index < pages.length; index++) {
      const command = await bitmapCommand(labelSvg("대여 물품", `${borrowerName}${employeeId ? ` · ${employeeId}` : ""}`, pages[index], index + 1, pages.length));
      await fs.promises.writeFile(DEVICE, command);
    }
    return { requestNo: number, pages: pages.length, itemTypes: items.length };
  };
  const result = printQueue.then(job, job);
  printQueue = result.then(() => undefined, () => undefined);
  return result;
}

// 물품 목록을 받아 위치표로 뽑는 출력에 쓸 수 있는 제목. 임의 문자열은 받지 않는다.
const LOCATION_LABEL_TITLES = new Set(["반납 위치표", "한도 제외 물품"]);

/**
 * 받은 물품 목록을 사람별로 묶어 보관 위치표로 출력한다.
 * 기본은 방금 반납 처리에 성공한 물품의 "반납 위치표"이고, title로 "한도 제외 물품"도 뽑을 수 있다.
 */
export async function printReturnedItems(rawItems, rawTitle) {
  const title = LOCATION_LABEL_TITLES.has(rawTitle) ? rawTitle : "반납 위치표";
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw new Error("출력할 물품이 없습니다.");
  const merged = new Map();
  for (const raw of rawItems) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const quantity = Math.max(1, Math.min(999, Number(raw.quantity) || 1));
    const item = {
      id: padId(raw.id), name, quantity,
      location: String(raw.location || "위치 미등록").trim() || "위치 미등록",
      variantName: String(raw.variantName || "").trim(),
      employeeId: String(raw.employeeId || "").trim(),
      borrowerName: String(raw.borrowerName || "").trim(),
    };
    const key = `${item.employeeId}|${item.borrowerName}|${item.id || item.name}|${item.variantName}|${item.location}`;
    const previous = merged.get(key);
    if (previous) previous.quantity += quantity;
    else merged.set(key, item);
  }
  const grouped = new Map();
  for (const item of merged.values()) {
    const key = `${item.employeeId}|${item.borrowerName}`;
    if (!grouped.has(key)) grouped.set(key, { employeeId: item.employeeId, borrowerName: item.borrowerName, items: [] });
    grouped.get(key).items.push(item);
  }
  if (!grouped.size) throw new Error("출력할 물품이 없습니다.");

  const jobs = [];
  for (const group of grouped.values()) {
    group.items.sort((a, b) => locationSortIndex(a.location) - locationSortIndex(b.location));
    const pages = Array.from({ length: Math.ceil(group.items.length / ITEMS_PER_LABEL) }, (_, index) => group.items.slice(index * ITEMS_PER_LABEL, (index + 1) * ITEMS_PER_LABEL));
    pages.forEach((items, index) => jobs.push({
      title,
      borrowerName: `${group.borrowerName}${group.employeeId ? ` · ${group.employeeId}` : ""}`,
      items, page: index + 1, totalPages: pages.length,
    }));
  }
  const job = async () => {
    for (const page of jobs) {
      await fs.promises.writeFile(DEVICE, await bitmapCommand(labelSvg(page.title, page.borrowerName, page.items, page.page, page.totalPages)));
    }
    return { pages: jobs.length, itemTypes: merged.size };
  };
  const result = printQueue.then(job, job);
  printQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** 사번 조회 전용 페이지로 연결되는 공용 QR 라벨 한 장을 출력한다. */
export async function printLookupQr() {
  if (!/^https?:\/\//i.test(LOOKUP_URL)) throw new Error("QR 조회 주소가 올바르지 않습니다.");
  // 60×40mm(480×320dot) 안에서 QR을 크게 중앙 배치한다. QR은 회전과 무관하게 인식된다.
  const safeUrl = LOOKUP_URL.replace(/["\r\n]/g, "");
  const command = Buffer.from(
    `SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nSPEED 3\r\nDENSITY 9\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nQRCODE 92,10,L,9,A,0,M2,S7,"${safeUrl}"\r\nPRINT 1,1\r\n`,
    "ascii",
  );
  const job = async () => {
    await fs.promises.writeFile(DEVICE, command);
    return { url: LOOKUP_URL, pages: 1 };
  };
  const result = printQueue.then(job, job);
  printQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** 말풍선 테두리 안에 QR, 아래에 "SCAN ME"를 둔 40×60(세로) 스티커 SVG. */
function scanMeSvg(data) {
  const width = 320, height = 480;
  const qr = QRCode.create(data, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  // 모듈을 정수 dot로 맞춰 열전사 출력에서도 경계가 흐려지지 않게 하고, 테두리와의 사이에
  // 약 2.5모듈 이상의 여백(quiet zone)을 남긴다. 긴 초대 링크(41×41)도 모듈당 6dot(0.75mm)가 된다.
  const left = 16, right = 304, top = 40, bottom = 328, radius = 22, stroke = 7;
  const module = Math.floor((right - left - stroke) / (size + 5));
  const qrSize = module * size;
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = Math.round(top + (bottom - top - qrSize) / 2);
  let cells = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col)) cells += `M${qrX + col * module} ${qrY + row * module}h${module}v${module}h-${module}z`;
    }
  }
  const tailX = width / 2, tailHalf = 24, tailDepth = 38;
  const bubble = [
    `M${left + radius} ${top}H${right - radius}A${radius} ${radius} 0 0 1 ${right} ${top + radius}`,
    `V${bottom - radius}A${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
    `H${tailX + tailHalf}L${tailX} ${bottom + tailDepth}L${tailX - tailHalf} ${bottom}`,
    `H${left + radius}A${radius} ${radius} 0 0 1 ${left} ${bottom - radius}`,
    `V${top + radius}A${radius} ${radius} 0 0 1 ${left + radius} ${top}Z`,
  ].join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><path d="${bubble}" fill="white" stroke="#000" stroke-width="${stroke}" stroke-linejoin="miter"/><path d="${cells}" fill="#000" shape-rendering="crispEdges"/><text x="${width / 2}" y="438" text-anchor="middle" font-family="'Noto Sans CJK KR','Noto Sans KR','Segoe UI',sans-serif" font-size="60" font-weight="500" letter-spacing="2" fill="#000">SCAN ME</text></svg>`);
}

/** 출력 전 확인용 — 프린터에 보낼 것과 같은 60×40mm 1비트 이미지를 PNG로 돌려준다. */
export async function scanMeQrPreview() {
  return sharp(scanMeSvg(SCAN_ME_DATA)).rotate(90).flatten({ background: "white" }).greyscale().threshold(180).png().toBuffer();
}

/** 말풍선 "SCAN ME" QR 스티커를 원하는 장수만큼 출력한다. */
export async function printScanMeQr(rawCopies) {
  const copies = Math.trunc(Number(rawCopies ?? 1));
  if (!Number.isFinite(copies) || copies < 1 || copies > SCAN_ME_MAX_COPIES) {
    throw new Error(`출력 장수는 1~${SCAN_ME_MAX_COPIES}장 사이여야 합니다.`);
  }
  const command = await bitmapCommand(scanMeSvg(SCAN_ME_DATA), copies);
  const job = async () => {
    await fs.promises.writeFile(DEVICE, command);
    return { data: SCAN_ME_DATA, copies };
  };
  const result = printQueue.then(job, job);
  printQueue = result.then(() => undefined, () => undefined);
  return result;
}
