import { Router } from "express";
import { all, run, transaction } from "../db.js";
import { requireAdmin } from "../lib/auth.js";
import { nowKst } from "../lib/time.js";

/**
 * 관리자 상단 알림.
 * - 가입 신청: 대기 중인 동안만 모든 관리자에게 뜬다. 누가 승인·거절하면 전원에게서 사라진다.
 * - 물품 상태 변경: "물품 상태 변경 이력" 화면과 같은 기록을 관리자마다 읽음 처리할 때까지 쌓는다.
 *   본인이 한 변경은 알리지 않는다 — 다른 관리자가 한 것만 뜬다.
 */
export const notificationsRouter = Router();

// 양도는 별도 메뉴에서 조회한다. 한 관리자라도 확인했으면 모두에게 확인 완료로 표시한다.
// 기존 확인 기록도 함께 적용하며, 누가 확인했는지와 원본 양도 이력은 그대로 보관한다.
const readTransfersSql = `SELECT notif_key FROM admin_notification_reads WHERE notif_key LIKE 'transfer:%'`;
const unreadTransfersSql = `SELECT COUNT(*) AS n FROM transfer_notifications t
  WHERE 'transfer:'||t.id NOT IN (${readTransfersSql})`;
notificationsRouter.get('/admin/transfer-notifications/count', requireAdmin, (req,res) => {
  res.json({success:true, unread:Number(all(unreadTransfersSql)[0].n)});
});
notificationsRouter.get('/admin/transfer-notifications', requireAdmin, (req,res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = all(`SELECT t.*, ('transfer:'||t.id IN (${readTransfersSql})) AS is_read
    FROM transfer_notifications t WHERE t.id < ? ORDER BY t.id DESC LIMIT 101`,[before]);
  const entries = rows.slice(0,100).map(r => ({id:r.id,timestamp:r.occurred_at,
    fromName:r.from_name,fromEmployeeId:r.from_employee_id,toName:r.to_name,toEmployeeId:r.to_employee_id,
    floor:r.floor,unit:r.unit,items:JSON.parse(r.items_json),read:!!r.is_read}));
  res.json({success:true,entries,nextBefore:rows.length>100?entries.at(-1).id:null});
});
notificationsRouter.post('/admin/transfer-notifications/read', requireAdmin, (req,res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids)].filter(id => Number.isSafeInteger(id) && id>0).slice(0,100) : [];
  transaction(() => {
    for (const id of ids) run(`INSERT OR IGNORE INTO admin_notification_reads (admin_id,notif_key,read_at)
      SELECT ?,'transfer:'||id,? FROM transfer_notifications WHERE id=?`,[req.admin.id,nowKst(),id]);
  });
  res.json({success:true});
});

// 이 시각 이후의 변경부터 알림으로 쌓는다.
const CHANGE_NOTIFY_SINCE = "2026-09-24 01:00:00";
// 불량 알림 기능을 켠 시점 이전의 누적 로그가 한꺼번에 미확인 알림으로 뜨지 않게 한다.
const DEFECT_NOTIFY_SINCE = "2026-09-29 09:00:00";
// 한 번에 내려보내는 변경 알림 개수(읽지 않은 수는 전체로 센다).
const MAX_LIST = 150;
const CATEGORY_LABEL = { scenario: "시나리오 물품", inventory: "COS 물품", tablecloth: "테이블보", defect: "불량·파손" };

// 물품 상태 변경 이력(getItemChangeHistory)과 같은 기준으로 모은다.
function changeEntries() {
  const rows = [];
  for (const r of all("SELECT * FROM scenario_item_edits WHERE occurred_at >= ?", [CHANGE_NOTIFY_SINCE])) {
    rows.push({ key: `edit:${r.id}`, timestamp: r.occurred_at, category: "scenario", itemId: r.item_id, itemName: r.item_name, changeType: r.change_type, summary: r.summary, manager: r.manager || "" });
  }
  for (const r of all("SELECT * FROM inventory_history WHERE occurred_at >= ?", [CHANGE_NOTIFY_SINCE])) {
    // 불량·대여·반납에서 생긴 재고 변화는 각 장부에서 본다(이력 화면과 같은 규칙).
    // 단, COS 물품은 재고 증가·감소 자체가 중요하므로 사유와 관계없이 전부 알린다.
    if (r.category !== "inventory" && /불량|파손|대여|반납/.test(r.reason || "")) continue;
    if (!CATEGORY_LABEL[r.category]) continue;
    rows.push({ key: `stock:${r.id}`, timestamp: r.occurred_at, category: r.category, itemId: r.ref_id, itemName: r.item_name, changeType: "stock_adjust", summary: `재고 ${r.before_val} → ${r.after_val} (${r.diff > 0 ? "+" : ""}${r.diff})${r.reason ? ` · ${r.reason}` : ""}`, manager: r.manager || "" });
  }
  for (const r of all("SELECT * FROM item_change_logs WHERE occurred_at >= ?", [CHANGE_NOTIFY_SINCE])) {
    rows.push({ key: `change:${r.id}`, timestamp: r.occurred_at, category: r.category, itemId: r.item_id, itemName: r.item_name, changeType: r.change_type, summary: r.summary, manager: r.manager || "" });
  }
  // 불량 로그 자체를 알림 원본으로 쓴다. 파손 반납에서 생긴 재고 이력은 위에서 제외하므로
  // 같은 작업이 '재고 변경 + 불량 등록' 두 건으로 중복 표시되지 않는다.
  for (const r of all("SELECT * FROM defect_logs WHERE occurred_date >= ?", [DEFECT_NOTIFY_SINCE])) {
    const qty = Number(r.qty) || 1;
    const defectType = String(r.defect_type || "불량").trim();
    const detail = String(r.detail || "").trim();
    const action = String(r.action_taken || "").trim();
    const extras = [detail, action].filter(Boolean).join(" · ");
    rows.push({
      key: `defect:${r.id}`,
      timestamp: r.occurred_date,
      category: "defect",
      itemId: "",
      itemName: r.product || "(물품명 없음)",
      changeType: "defect",
      summary: `${defectType} ${qty}개 등록${extras ? ` · ${extras}` : ""}`,
      manager: r.breaker || "",
      // 알림에서 "본인이 한 것"을 가릴 때는 파손자가 아니라 등록한 관리자를 본다.
      actor: r.reported_by || "",
    });
  }
  return rows;
}

// 기록의 담당자는 관리자 이름(없으면 로그인 아이디)으로 남는다(gas.js changeActor). 같으면 본인이 한 것.
function isOwnChange(entry, admin) {
  const who = String(entry.category === "defect" ? entry.actor : entry.manager || "").trim();
  if (!who) return false;
  return who === String(admin.name || "").trim() || who === String(admin.loginId || "").trim();
}

notificationsRouter.get("/admin/notifications", requireAdmin, (req, res) => {
  const admin = req.admin;
  const read = new Set(all("SELECT notif_key FROM admin_notification_reads WHERE admin_id = ?", [admin.id]).map((r) => r.notif_key));
  const changes = changeEntries()
    .filter((e) => !isOwnChange(e, admin))
    .map((e) => ({ ...e, categoryLabel: CATEGORY_LABEL[e.category] || e.category, read: read.has(e.key) }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  // 읽은 알림은 목록에서 빠진다.
  const unread = changes.filter((e) => !e.read);
  // 관리자 가입 신청은 employeeId 자리에 로그인 아이디를 담고 kind로 구분한다.
  const signups = [
    ...all("SELECT id, employee_id AS employeeId, name, created_at AS createdAt FROM signup_requests WHERE status = 'pending'").map((r) => ({ ...r, kind: "borrower" })),
    ...all("SELECT id, login_id AS employeeId, name, created_at AS createdAt FROM admin_signup_requests WHERE status = 'pending'").map((r) => ({ ...r, kind: "admin" })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  res.json({
    success: true,
    signups,
    changes: unread.slice(0, MAX_LIST),
    unreadChanges: unread.length,
    total: signups.length + unread.length,
  });
});

// body: { keys: string[] } 또는 { all: true }
notificationsRouter.post("/admin/notifications/read", requireAdmin, (req, res) => {
  const adminId = req.admin.id;
  const keys = req.body?.all
    ? changeEntries().map((e) => e.key)
    : (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).filter((k) => /^(edit|stock|change|defect):\d+$/.test(k)).slice(0, 1000);
  const now = nowKst();
  transaction(() => {
    for (const key of keys) run("INSERT OR IGNORE INTO admin_notification_reads (admin_id, notif_key, read_at) VALUES (?, ?, ?)", [adminId, key, now]);
  });
  res.json({ success: true, marked: keys.length });
});
