/**
 * 반납 로그 "분석" 화면의 계산.
 *
 * 예전 분석은 전체 기간의 상위 5명·상위 5개만 보여줘서, 보고 나서 할 일이 떠오르지 않았다.
 * 여기서는 기간(7/30/90일)을 정해 "무엇을 사고, 무엇을 retire하고, 언제 붐비는지"를 계산한다.
 *
 * - 신청만 하고 안 가져가 자동/수동 취소된 줄(picked_up_at 없이 닫힌 줄)은 실제 대여가 아니라 뺀다.
 * - 시나리오 물품만 대상으로 한다. request(업체 요청) 물품은 사거나 retire할 대상이 아니라 추천에서 뺀다.
 * - SM 활동성 점수는 SM 목록 캐시에서 가져온다. 세션이 없으면 점수 없이 WMS 기준으로만 계산한다.
 */
import { all, get } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { activenessSnapshot } from "./smLocationSync.js";
import { sampledStockoutRate } from "./insightsMath.js";

const PERIODS = [7, 30, 90];
const DAY_MS = 864e5;
// SM 화면이 쓰는 등급 경계(초록 70 이상 / 노랑 40 / 주황 20 / 빨강 20 미만)를 그대로 쓴다.
const SM_HIGH = 70;
const SM_LOW = 20;
// SM은 등록 14일 전에는 점수를 내지 않는다(NEW 표시).
const SM_GRACE_DAYS = 14;

// "YYYY-MM-DD HH:mm:ss"(서울 시각)를 그대로 쪼갠다 — 서버 시간대에 흔들리지 않게.
function parts(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(String(ts || ""));
  if (!m) return null;
  const [y, mo, d, h] = m.slice(1).map(Number);
  return { ms: Date.UTC(y, mo - 1, d, h), dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), hour: h, day: `${m[1]}-${m[2]}-${m[3]}` };
}
function fullMs(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(ts || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN;
}
function nowKstMs() {
  // Stored timestamps use Seoul wall time; the Ubuntu host may run in UTC.
  return Date.now() + 9 * 36e5;
}
const isOn = (v) => !!v && !["FALSE", "N", "0", "NO"].includes(String(v).trim().toUpperCase());
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** 실제로 나간 대여 줄만. 취소된 신청은 뺀다. */
function rentalRows() {
  const rows = [];
  const valid = (r) => !(r.returned === "O" && !r.picked_up_at);
  for (const r of all("SELECT item_label, sid, batch_id, borrower_name, applied_at, borrow_date, picked_up_at, returned, return_date FROM sid_rentals")) {
    if (!valid(r)) continue;
    const p = parseItemLabel(r.item_label);
    if (!p.id) continue;
    rows.push({ id: padSlot(p.id), qty: p.quantity || 1, sid: r.sid || "", batch: r.batch_id || "", who: r.borrower_name || "", at: r.applied_at || r.borrow_date, out: r.picked_up_at || r.borrow_date, returned: r.returned === "O", back: r.return_date });
  }
  for (const r of all("SELECT item_id, item_label, qty, batch_id, borrower_name, applied_at, borrow_date, picked_up_at, returned, return_date FROM general_rentals")) {
    if (!valid(r)) continue;
    const id = padSlot(r.item_id || parseItemLabel(r.item_label).id);
    if (!id) continue;
    rows.push({ id, qty: Number(r.qty) || 1, sid: "", batch: r.batch_id || "", who: r.borrower_name || "", at: r.applied_at || r.borrow_date, out: r.picked_up_at || r.borrow_date, returned: r.returned === "O", back: r.return_date });
  }
  return rows;
}

const results = new Map();
export function rentalInsights({ days = 30, fresh = false } = {}) {
  const period = PERIODS.includes(Number(days)) ? Number(days) : 30;
  // Local writes and writes from another SQLite connection both invalidate the result.
  const signature = `${get("SELECT total_changes() AS n").n}|${get("PRAGMA data_version").data_version}`;
  const previous = results.get(period);
  if (previous?.signature === signature) {
    if (previous.pending) return previous.pending;
    if (!fresh && Date.now() - previous.at < 30000) return Promise.resolve(previous.value);
  }
  const entry = { signature, at: 0, value: null, pending: null };
  entry.pending = calculateRentalInsights({ days: period }).then(value => {
    entry.value = value; entry.at = Date.now(); entry.pending = null;
    return value;
  }, error => { if (results.get(period) === entry) results.delete(period); throw error; });
  results.set(period, entry);
  return entry.pending;
}

async function calculateRentalInsights({ days = 30 } = {}) {
  const period = PERIODS.includes(Number(days)) ? Number(days) : 30;
  const now = nowKstMs();
  const since = now - period * DAY_MS;

  const items = all("SELECT id, name, stock, rented, request, personal_owner, is_storage, exclude_low_rent, image_path, root_slot FROM scenario_items");
  const itemById = new Map(items.map((i) => [padSlot(i.id), i]));
  const owned = (i) => Math.max(0, Number(i.stock) || 0) + Math.max(0, Number(i.rented) || 0);
  const recommendable = (i) => i && !isOn(i.request) && !String(i.personal_owner || "").trim() && !isOn(i.is_storage);

  const all_ = rentalRows();
  const inPeriod = all_.filter((r) => { const p = parts(r.at); return p && p.ms >= since; });
  const firstDay = all_.map((r) => r.at).filter(Boolean).sort()[0] || "";

  // ── 요약 ──
  const holds = inPeriod.filter((r) => r.returned && r.back).map((r) => (fullMs(r.back) - fullMs(r.out)) / 36e5).filter((h) => Number.isFinite(h) && h >= 0).sort((a, b) => a - b);
  const pct = (p) => (holds.length ? round(holds[Math.floor(p * (holds.length - 1))]) : null);
  const summary = {
    rentals: inPeriod.length,
    quantity: inPeriod.reduce((s, r) => s + r.qty, 0),
    borrowers: new Set(inPeriod.map((r) => r.who).filter(Boolean)).size,
    itemTypes: new Set(inPeriod.map((r) => r.id)).size,
    holdMedianHours: pct(0.5),
    holdP90Hours: pct(0.9),
    longHolds: holds.filter((h) => h >= 72).length,
    open: all_.filter((r) => !r.returned).length,
  };

  // ── 시간대 수요: 요일(0=일)×시간 격자. 대여는 신청 시각, 반납은 반납 시각. ──
  const grid = () => Array.from({ length: 7 }, () => Array(24).fill(0));
  const borrowGrid = grid(), returnGrid = grid();
  // 칸에 커서를 올렸을 때 보여줄 상세: 개수, 사람 수, 몇 날에 걸쳐 생겼는지, 많이 나간 물품. 비어 있는 칸은 싣지 않는다.
  const borrowCells = new Map(), returnCells = new Map();
  const addCell = (cells, p, r) => {
    const key = `${p.dow}-${p.hour}`;
    let c = cells.get(key);
    if (!c) { c = { qty: 0, who: new Set(), days: new Set(), items: new Map() }; cells.set(key, c); }
    c.qty += r.qty; if (r.who) c.who.add(r.who); c.days.add(p.day);
    c.items.set(r.id, (c.items.get(r.id) || 0) + r.qty);
  };
  for (const r of inPeriod) { const p = parts(r.at); if (p) { borrowGrid[p.dow][p.hour] += 1; addCell(borrowCells, p, r); } }
  for (const r of all_) { if (!r.returned) continue; const p = parts(r.back); if (p && p.ms >= since) { returnGrid[p.dow][p.hour] += 1; addCell(returnCells, p, r); } }
  const cellDetails = (cells) => Object.fromEntries([...cells].map(([key, c]) => {
    const ranked = [...c.items].sort((a, b) => b[1] - a[1]);
    return [key, {
      qty: c.qty, borrowers: c.who.size, days: c.days.size,
      top: ranked.slice(0, 3).map(([id, qty]) => ({ id, name: itemById.get(id)?.name || id, qty })),
      moreTypes: Math.max(0, ranked.length - 3),
    }];
  }));
  const peaks = (g) => g.flatMap((row, dow) => row.map((n, hour) => ({ dow, hour, n }))).filter((c) => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  const hourTotals = (g) => Array.from({ length: 24 }, (_, h) => g.reduce((s, row) => s + row[h], 0));
  const timeDemand = {
    borrow: borrowGrid, return: returnGrid,
    borrowCells: cellDetails(borrowCells), returnCells: cellDetails(returnCells),
    borrowPeaks: peaks(borrowGrid), returnPeaks: peaks(returnGrid),
    borrowByHour: hourTotals(borrowGrid), returnByHour: hourTotals(returnGrid),
  };

  // ── 물품별 집계 ──
  const rentCount = new Map(), borrowers = new Map(), holdSum = new Map();
  for (const r of inPeriod) {
    rentCount.set(r.id, (rentCount.get(r.id) || 0) + r.qty);
    if (!borrowers.has(r.id)) borrowers.set(r.id, new Set());
    borrowers.get(r.id).add(r.who);
  }
  for (const r of inPeriod) {
    if (!r.returned || !r.back) continue;
    const h = (fullMs(r.back) - fullMs(r.out)) / 36e5;
    if (!Number.isFinite(h) || h < 0) continue;
    const cur = holdSum.get(r.id) || { sum: 0, n: 0 };
    holdSum.set(r.id, { sum: cur.sum + h, n: cur.n + 1 });
  }
  const lastRented = new Map();
  for (const r of all_) if (!lastRented.has(r.id) || r.at > lastRented.get(r.id)) lastRented.set(r.id, r.at);

  // 품절 시간 비율: 평일 08~22시를 30분마다 찍어, 가진 수량이 전부 나가 있던 비율.
  // 대여 횟수만 보면 몇 시간씩 짧게 도는 물품이 과하게 잡히고, 밤새 들고 있던 물품은 부족해 보인다.
  const samples = [];
  for (let t = since + 18e5; t < now; t += 36e5) {
    const d = new Date(t), dow = d.getUTCDay(), h = d.getUTCHours();
    if (dow >= 1 && dow <= 5 && h >= 8 && h < 22) samples.push(t, t + 18e5);
  }
  const intervalsById = new Map();
  for (const r of all_) {
    const start = fullMs(r.out);
    const end = r.returned ? fullMs(r.back) : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < since || end <= start) continue;
    if (!intervalsById.has(r.id)) intervalsById.set(r.id, []);
    intervalsById.get(r.id).push([start, end, r.qty]);
  }
  const stockoutRate = (id, own) => {
    const list = intervalsById.get(id);
    if (!own || !list || !samples.length) return 0;
    return sampledStockoutRate(list, samples, own);
  };

  const defects = new Map();
  for (const d of all("SELECT product, qty, occurred_date, defect_type FROM defect_logs")) {
    const p = parts(d.occurred_date);
    if (!p || p.ms < since) continue;
    const id = padSlot(parseItemLabel(d.product).id);
    if (!id) continue;
    defects.set(id, (defects.get(id) || 0) + (Number(d.qty) || 1));
  }

  const sidCount = new Map();
  for (const r of all("SELECT object_id, COUNT(DISTINCT sid) AS n FROM scenarios WHERE object_id IS NOT NULL AND object_id != '' GROUP BY object_id")) {
    sidCount.set(padSlot(r.object_id), r.n);
  }

  // WMS analysis must not wait 15 seconds for the entire SM catalog. Loading continues
  // in the background; a later refresh can include the completed activity scores.
  const sm = await activenessSnapshot({ timeoutMs: 1000 });
  const smOf = (id) => (sm.ok ? sm.map.get(id) || null : null);
  const smNew = (s) => {
    if (!s?.createdAt) return false;
    const c = fullMs(s.createdAt);
    return Number.isFinite(c) && now - c < SM_GRACE_DAYS * DAY_MS;
  };

  const row = (id) => {
    const i = itemById.get(id);
    const s = smOf(id);
    const n = rentCount.get(id) || 0;
    const own = i ? owned(i) : 0;
    const hs = holdSum.get(id);
    const def = defects.get(id) || 0;
    return {
      id, name: i?.name || "(미등록)", image: i?.image_path || "", rootSlot: i?.root_slot || "",
      owned: own, stock: Math.max(0, Number(i?.stock) || 0),
      rentals: n, borrowers: borrowers.get(id)?.size || 0,
      turnsPerUnit: own ? round(n / own) : null,
      stockoutPct: own ? Math.round(stockoutRate(id, own) * 100) : null,
      avgHoldHours: hs ? round(hs.sum / hs.n) : null,
      defects: def, defectRate: n ? round((def / n) * 100, 0) : null,
      sidCount: sidCount.get(id) || 0,
      lastRented: lastRented.get(id) || "",
      sm: s ? { score: smNew(s) ? null : s.score, usage: s.usage, status: s.status, isNew: smNew(s) } : null,
    };
  };

  const candidates = items.map((i) => padSlot(i.id)).filter((id) => recommendable(itemById.get(id)) && smOf(id)?.status !== "RETIRED");

  // ── 구매 추천: 가진 수량에 비해 대여가 몰리는 물품. SM 점수가 높으면(과사용) retire 쪽으로 보낸다. ──
  // 기준: 평일 업무 시간의 25% 이상을 전부 대여 중으로 보낸 물품은 모자란 것으로 본다.
  const rows = candidates.map(row);
  const minRentals = Math.max(3, Math.round(period / 6));
  const smHigh = (r) => r.sm?.score != null && r.sm.score >= SM_HIGH;
  const busy = (r) => r.rentals >= minRentals && r.owned > 0 && r.stockoutPct >= 25;
  const suggestAdd = (r) => (r.stockoutPct >= 60 ? Math.max(2, Math.ceil(r.owned * 0.5)) : r.stockoutPct >= 40 ? Math.max(1, Math.ceil(r.owned * 0.3)) : 1);
  const buy = rows
    .filter((r) => busy(r) && !smHigh(r))
    .map((r) => ({ ...r, suggestAdd: suggestAdd(r) }))
    .sort((a, b) => b.stockoutPct - a.stockoutPct || b.rentals - a.rentals)
    .slice(0, 15);

  // ── retire 추천 ──
  // 과사용: 수량 대비 대여가 많고 SM에서도 활발(70% 이상)하게 쓰이는 물품. 데이터에 과하게 나오는 물품이라
  // 더 사기보다 다른 물품으로 바꾸는 쪽을 권한다. SM 점수가 없으면 구분할 수 없어 구매 추천에만 남긴다.
  const overuse = rows
    .filter((r) => busy(r) && smHigh(r))
    .map((r) => ({ ...r, reason: `업무 시간 ${r.stockoutPct}% 품절 · SM ${r.sm.score}%` }))
    .sort((a, b) => b.sm.score - a.sm.score || b.turnsPerUnit - a.turnsPerUnit)
    .slice(0, 15);
  // 마모·파손: 대여 대비 불량이 잦은 물품(최소 5회 이상 대여된 것만).
  const wear = rows
    .filter((r) => r.defects >= 2 && r.rentals >= 5 && r.defectRate >= 5)
    .map((r) => ({ ...r, reason: `${r.rentals}회 대여 중 불량 ${r.defects}건 (${r.defectRate}%)` }))
    .sort((a, b) => b.defectRate - a.defectRate || b.defects - a.defects)
    .slice(0, 15);
  // 미사용: SM에서 20% 미만이고, WMS에서도 이 기간 한 번도 안 나간 물품. 등록 14일 안 된 물품은 뺀다.
  const unused = rows
    .filter((r) => r.rentals === 0 && !r.sm?.isNew && (r.sm?.score == null ? period >= 90 : r.sm.score < SM_LOW))
    .map((r) => ({ ...r, reason: r.sm?.score != null ? `${period}일 대여 0회 · SM ${r.sm.score}%` : `${period}일 대여 0회` }))
    .sort((a, b) => (a.sm?.score ?? 101) - (b.sm?.score ?? 101) || a.sidCount - b.sidCount)
    .slice(0, 30);

  // ── 같이 나가는 물품: 한 신청(batch) 안에 함께 담긴 쌍 ──
  const byBatch = new Map();
  for (const r of inPeriod) {
    const key = r.batch || (r.sid ? `${r.sid}|${String(r.at).slice(0, 10)}|${r.who}` : "");
    if (!key) continue;
    if (!byBatch.has(key)) byBatch.set(key, new Set());
    byBatch.get(key).add(r.id);
  }
  const pairCount = new Map();
  for (const ids of byBatch.values()) {
    const list = [...ids].sort();
    if (list.length > 40) continue; // SID 통째 대여는 쌍이 폭발해 의미가 흐려진다
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const k = `${list[a]}|${list[b]}`;
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }
  }
  const nameOf = (id) => itemById.get(id)?.name || id;
  const pairs = [...pairCount.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => {
      const [a, b] = k.split("|");
      return { a: { id: a, name: nameOf(a), rootSlot: itemById.get(a)?.root_slot || "" }, b: { id: b, name: nameOf(b), rootSlot: itemById.get(b)?.root_slot || "" }, count: n };
    });

  return {
    period, since: new Date(since).toISOString().slice(0, 10), dataSince: firstDay.slice(0, 10),
    summary, timeDemand, buy,
    retire: { overuse, wear, unused },
    pairs,
    sm: sm.ok ? { ok: true, high: SM_HIGH, low: SM_LOW } : { ok: false, reason: sm.reason },
  };
}
