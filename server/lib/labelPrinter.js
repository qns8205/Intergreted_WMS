import fs from "node:fs";
import sharp from "sharp";
import QRCode from "qrcode";
import { get, all } from "../db.js";
import { locationSortIndex } from "./locationSort.js";
import { resolveRentalRequest } from "./requestCode.js";

const DEVICE = process.env.WMS_LABEL_PRINTER || "/dev/usb/lp0";
const ITEMS_PER_LABEL = 6;
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

function fitText(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function labelSvg(title, borrowerName, items, page, totalPages) {
  // 세로로 읽히는 40×60 구성을 먼저 만든 뒤 90도 회전해 60×40 실제 라벨에 싣는다.
  const width = 320, height = 480;
  // XP-DT427B 203dpi 기준 약 8dot/mm. 세로로 읽을 때 위쪽 여백을 3mm 더 둔다.
  const verticalOffset = 24;
  const rowTop = 88 + verticalOffset;
  const rowHeight = Math.floor((height - rowTop - 16) / Math.max(1, items.length));
  const fontSize = items.length <= 3 ? 24 : items.length <= 4 ? 21 : 18;
  const rows = items.map((item, index) => {
    const y = rowTop + index * rowHeight;
    const variant = item.variantName ? ` · ${item.variantName}` : "";
    const name = fitText(`${item.name}${variant}`, 23);
    const employee = item.employeeId ? `   사번 ${item.employeeId}` : "";
    const meta = `×${item.quantity}   ${item.location}${employee}`;
    return `<g><text x="14" y="${y + Math.min(28, rowHeight * 0.46)}" class="item">${escapeXml(name)}</text><text x="14" y="${y + Math.min(54, rowHeight * 0.82)}" class="meta">${escapeXml(meta)}</text><line x1="12" y1="${y + rowHeight - 2}" x2="308" y2="${y + rowHeight - 2}" stroke="#999" stroke-width="1"/></g>`;
  }).join("");
  const pageMark = totalPages > 1 ? `${page}/${totalPages}` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><style>text{fill:#000;font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif}.title{font-size:28px;font-weight:900}.person{font-size:17px;font-weight:700}.item{font-size:${fontSize}px;font-weight:900}.meta{font-size:${Math.max(15, fontSize - 2)}px;font-weight:750}</style><text x="14" y="${39 + verticalOffset}" class="title">${escapeXml(title)}</text><text x="306" y="${37 + verticalOffset}" text-anchor="end" class="person">${escapeXml(pageMark)}</text><text x="14" y="${65 + verticalOffset}" class="person">${escapeXml(fitText(borrowerName, 18))}</text><line x1="12" y1="${75 + verticalOffset}" x2="308" y2="${75 + verticalOffset}" stroke="#000" stroke-width="3"/>${rows}</svg>`);
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

/** 방금 반납 처리에 성공한 물품만 받아 원래 보관 위치표로 출력한다. */
export async function printReturnedItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw new Error("출력할 반납 물품이 없습니다.");
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
  if (!grouped.size) throw new Error("출력할 반납 물품이 없습니다.");

  const jobs = [];
  for (const group of grouped.values()) {
    group.items.sort((a, b) => locationSortIndex(a.location) - locationSortIndex(b.location));
    const pages = Array.from({ length: Math.ceil(group.items.length / ITEMS_PER_LABEL) }, (_, index) => group.items.slice(index * ITEMS_PER_LABEL, (index + 1) * ITEMS_PER_LABEL));
    pages.forEach((items, index) => jobs.push({
      title: "반납 위치표",
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
