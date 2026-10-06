import { Router } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import { db, all, run, get, transaction } from "../db.js";
import { toAdminUserPublic } from "../lib/serialize.js";
import { verifyAdminLogin, requireAdmin, issueAdminSession, revokeAdminSession } from "../lib/auth.js";
import { importXlsx } from "../lib/xlsxImport.js";
import { padSlot, normalizeSid } from "../lib/borrowUtils.js";
import { attachSession, status as smSyncStatus } from "../lib/smSync.js";
import { penaltyDetails } from "../lib/unattendedPenalties.js";
import XLSX from "xlsx";
import { normalizeEmployeeId } from "../lib/registeredUsers.js";

export const adminRouter = Router();
const upload = multer({ dest: os.tmpdir() });

adminRouter.post("/admin/login", (req, res) => {
  const { loginId, password } = req.body || {};
  const user = verifyAdminLogin(loginId, password);
  if (!user) return res.status(401).json({ success: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  // Scenario Manager도 같은 계정을 쓰므로, 방금 확인된 자격증명으로 그쪽 세션도 만들어 둔다.
  // 이후 재고 동기화가 이 관리자 이름으로 기록된다. 실패해도 WMS 로그인은 그대로 진행한다.
  attachSession(loginId, password);
  res.json({ success: true, user, token: issueAdminSession(user.id) });
});

adminRouter.post("/admin/logout", (req, res) => {
  revokeAdminSession(req.header("x-admin-token"));
  res.json({ success: true });
});

// 브라우저에 남은 관리자 표시가 아직 유효한 세션인지 확인한다.
adminRouter.get("/admin/me", requireAdmin, (req, res) => {
  res.json({ success: true, user: req.admin });
});

// 동기화가 지금 어떤 상태인지(누구 세션으로 돌고 있는지, 마지막 처리 결과) 확인용.
adminRouter.get("/sm-sync/status", requireAdmin, (req, res) => {
  res.json({ success: true, ...smSyncStatus() });
});

adminRouter.get("/admin/users", requireAdmin, (req, res) => {
  res.json({ success: true, users: all("SELECT * FROM admin_users ORDER BY id").map(toAdminUserPublic) });
});

adminRouter.post("/admin/users", requireAdmin, (req, res) => {
  const { loginId, password, name } = req.body || {};
  if (!loginId || !password) return res.status(400).json({ success: false, error: "아이디와 비밀번호는 필수입니다." });
  run("INSERT INTO admin_users (login_id, password_hash, name) VALUES (?, ?, ?)", [
    loginId, bcrypt.hashSync(String(password), 10), name ?? null,
  ]);
  res.json({ success: true });
});

adminRouter.put("/admin/users/:id", requireAdmin, (req, res) => {
  const { password, name } = req.body || {};
  if (password) {
    run("UPDATE admin_users SET password_hash=?, name=? WHERE id=?", [bcrypt.hashSync(String(password), 10), name ?? null, req.params.id]);
  } else {
    run("UPDATE admin_users SET name=? WHERE id=?", [name ?? null, req.params.id]);
  }
  res.json({ success: true });
});

adminRouter.delete("/admin/users/:id", requireAdmin, (req, res) => {
  run("DELETE FROM admin_users WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ── WMS 대여자 계정(사번 명부) ──────────────────────────────

adminRouter.get("/registered-users", requireAdmin, (req, res) => {
  res.json({
    success: true,
    users: all("SELECT employee_id, name, active, imported_at, source FROM registered_users WHERE active = 1 AND employee_id != '0000' ORDER BY name, employee_id"),
  });
});

adminRouter.post("/registered-users", requireAdmin, (req, res) => {
  const employeeId = normalizeEmployeeId(req.body?.employeeId);
  const name = String(req.body?.name || "").trim();
  if (!employeeId || employeeId === "0000") return res.status(400).json({ success: false, error: "사번은 0000을 제외한 4자리 숫자여야 합니다." });
  if (!name) return res.status(400).json({ success: false, error: "이름은 필수입니다." });
  const existing = get("SELECT active FROM registered_users WHERE employee_id = ?", [employeeId]);
  if (existing?.active) return res.status(409).json({ success: false, error: "이미 등록된 사번입니다." });
  run(
    `INSERT INTO registered_users (employee_id, name, active, imported_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(employee_id) DO UPDATE SET name=excluded.name, active=1, imported_at=excluded.imported_at`,
    [employeeId, name, new Date().toISOString()]
  );
  res.json({ success: true });
});

adminRouter.put("/registered-users/:employeeId", requireAdmin, (req, res) => {
  const employeeId = normalizeEmployeeId(req.params.employeeId);
  const name = String(req.body?.name || "").trim();
  if (!employeeId || employeeId === "0000") return res.status(400).json({ success: false, error: "올바른 사번이 아닙니다." });
  if (!name) return res.status(400).json({ success: false, error: "이름은 필수입니다." });
  const existing = get("SELECT employee_id FROM registered_users WHERE employee_id = ? AND active = 1", [employeeId]);
  if (!existing) return res.status(404).json({ success: false, error: "등록된 사용자를 찾지 못했습니다." });
  run("UPDATE registered_users SET name = ?, imported_at = ? WHERE employee_id = ?", [name, new Date().toISOString(), employeeId]);
  res.json({ success: true });
});

adminRouter.delete("/registered-users/:employeeId", requireAdmin, (req, res) => {
  const employeeId = normalizeEmployeeId(req.params.employeeId);
  if (!employeeId || employeeId === "0000") return res.status(400).json({ success: false, error: "올바른 사번이 아닙니다." });
  run("UPDATE registered_users SET active = 0, imported_at = ? WHERE employee_id = ?", [new Date().toISOString(), employeeId]);
  res.json({ success: true });
});

// ── ConfigDS 직원 명부 ──────────────────────────────────────

adminRouter.get("/staff-accounts", requireAdmin, (req, res) => {
  res.json({ success: true, staff: all("SELECT * FROM staff_accounts ORDER BY name") });
});

adminRouter.post("/staff-accounts", requireAdmin, (req, res) => {
  const { name, email, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: "이름은 필수입니다." });
  run("INSERT INTO staff_accounts (name, email, employee_id) VALUES (?, ?, ?)",
      [String(name).trim(), email || null, employeeId || null]);
  res.json({ success: true });
});

adminRouter.put("/staff-accounts/:id", requireAdmin, (req, res) => {
  const { name, email, employeeId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: "이름은 필수입니다." });
  run("UPDATE staff_accounts SET name=?, email=?, employee_id=? WHERE id=?",
      [String(name).trim(), email || null, employeeId || null, req.params.id]);
  res.json({ success: true });
});

adminRouter.delete("/staff-accounts/:id", requireAdmin, (req, res) => {
  run("DELETE FROM staff_accounts WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ── Settings ────────────────────────────────────────────────

adminRouter.get("/settings", requireAdmin, (req, res) => {
  const rows = all("SELECT key, value FROM settings WHERE key != 'floor_plan' AND key NOT LIKE 'slack_%'");
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json({ success: true, settings });
});

adminRouter.put("/settings", requireAdmin, (req, res) => {
  const entries = req.body || {};
  for (const [key, value] of Object.entries(entries)) {
    if (String(key).startsWith("slack_")) continue;
    run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value == null ? null : String(value)]
    );
  }
  res.json({ success: true });
});

// ── Penalties ────────────────────────────────────────────────

adminRouter.get("/penalties", (req, res) => {
  res.json({ success: true, penalties: all("SELECT * FROM penalties ORDER BY id DESC") });
});

// 대여 기록이 담기므로 목록과 달리 관리자만 본다.
adminRouter.get("/penalties/:id/details", requireAdmin, (req, res) => {
  const details = penaltyDetails(req.params.id);
  if (!details) return res.status(404).json({ success: false, error: "이미 삭제되었거나 없는 페널티입니다." });
  res.json({ success: true, ...details });
});

adminRouter.post("/penalties", requireAdmin, (req, res) => {
  const { name, maxTypes, reason, expiresAt } = req.body || {};
  run("INSERT INTO penalties (name, max_types, reason, expires_at) VALUES (?, ?, ?, ?)", [name ?? null, maxTypes ?? null, reason ?? null, expiresAt ?? null]);
  res.json({ success: true });
});

adminRouter.put("/penalties/:id", requireAdmin, (req, res) => {
  const { name, maxTypes, reason, expiresAt } = req.body || {};
  run("UPDATE penalties SET name=?, max_types=?, reason=?, expires_at=? WHERE id=?", [name ?? null, maxTypes ?? null, reason ?? null, expiresAt ?? null, req.params.id]);
  res.json({ success: true });
});

adminRouter.delete("/penalties/:id", requireAdmin, (req, res) => {
  run("DELETE FROM penalties WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ── SID(시나리오) 편집 — 요구 오브젝트 종류·수량을 관리자가 직접 수정 ──

// 검색/목록용 — SID마다 안내문(한글) 첫 줄과 오브젝트 종류 수만. 상세(오브젝트 목록)는
// 편집 화면을 열 때 SID별로 따로 불러온다(전체를 한 번에 내려주면 6천 행이 넘는다).
adminRouter.get("/scenarios", requireAdmin, (req, res) => {
  const rows = all(`
    SELECT sid, MIN(instruction_ko) AS instruction_ko, COUNT(*) AS object_count
    FROM scenarios
    WHERE sid IS NOT NULL AND sid != ''
    GROUP BY sid
  `);
  rows.sort((a, b) => {
    const na = Number(String(a.sid).replace(/\D/g, "")) || 0;
    const nb = Number(String(b.sid).replace(/\D/g, "")) || 0;
    return na - nb || String(a.sid).localeCompare(String(b.sid));
  });
  res.json({ success: true, sids: rows.map((r) => ({ sid: r.sid, instructionKo: r.instruction_ko || "", objectCount: r.object_count })) });
});

// 특정 SID의 편집 상세
adminRouter.get("/scenarios/:sid", requireAdmin, (req, res) => {
  const target = normalizeSid(req.params.sid);
  const rows = all("SELECT * FROM scenarios WHERE UPPER(REPLACE(sid, ' ', '')) = ?", [target]);
  if (!rows.length) {
    return res.json({ success: true, sid: req.params.sid, found: false, instructionEn: "", instructionKo: "", objects: [] });
  }
  res.json({
    success: true,
    sid: rows[0].sid,
    found: true,
    instructionEn: rows[0].instruction_en || "",
    instructionKo: rows[0].instruction_ko || "",
    objects: rows.filter((r) => r.object_id).map((r) => ({ objectId: r.object_id, objectName: r.object_name || "", quantity: r.quantity || 1 })),
  });
});

// 저장 — 이 SID의 오브젝트 행 전체를 통째로 교체한다(추가·삭제·수량변경을 한 번에 반영).
// object_id는 반드시 실제 시나리오 물품 카탈로그(scenario_items)에 있는 ID여야 한다 —
// 없는 ID를 그냥 받아버리면 대여 화면에서 조용히 빈 항목으로 나타나는 문제가 있었다.
adminRouter.put("/scenarios/:sid", requireAdmin, (req, res) => {
  const sid = String(req.params.sid || "").trim();
  if (!sid) return res.status(400).json({ success: false, error: "SID가 없습니다." });
  const { instructionEn, instructionKo, objects } = req.body || {};
  const list = Array.isArray(objects) ? objects : [];

  const resolved = [];
  for (const o of list) {
    const objectId = padSlot(o.objectId);
    const qty = Number(o.quantity);
    if (!objectId || !Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: `잘못된 오브젝트 항목입니다 (ID: ${o.objectId ?? "-"}, 수량: ${o.quantity ?? "-"})` });
    }
    const item = get("SELECT name FROM scenario_items WHERE id = ?", [objectId]);
    if (!item) return res.status(400).json({ success: false, error: `물품 카탈로그에 없는 오브젝트 ID입니다: ${objectId}` });
    resolved.push({ objectId, objectName: item.name || "", quantity: qty });
  }

  transaction(() => {
    run("DELETE FROM scenarios WHERE UPPER(REPLACE(sid, ' ', '')) = ?", [normalizeSid(sid)]);
    for (const o of resolved) {
      run(
        "INSERT INTO scenarios (sid, instruction_en, instruction_ko, object_id, object_name, quantity) VALUES (?, ?, ?, ?, ?, ?)",
        [sid, instructionEn || "", instructionKo || "", o.objectId, o.objectName, o.quantity]
      );
    }
  });

  res.json({ success: true, objectCount: resolved.length });
});

adminRouter.delete("/scenarios/:sid", requireAdmin, (req, res) => {
  run("DELETE FROM scenarios WHERE UPPER(REPLACE(sid, ' ', '')) = ?", [normalizeSid(req.params.sid)]);
  res.json({ success: true });
});

// ── xlsx import (overwrite) ──────────────────────────────────

adminRouter.post("/admin/import-xlsx", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "업로드된 파일이 없습니다." });
  try {
    const summary = await importXlsx(req.file.path);
    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// 현재 SQLite 전체를 xlsx로 내려받는다. 각 사용자 테이블이 워크북의 시트 하나가 된다.
adminRouter.get("/admin/export-xlsx", requireAdmin, (req, res) => {
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM "${name}"`).all().map((row) => {
      const clean = {};
      for (const col of columns) {
        const value = row[col];
        clean[col] = Buffer.isBuffer(value) ? value.toString("base64") : value;
      }
      return clean;
    });
    const sheet = rows.length
      ? XLSX.utils.json_to_sheet(rows, { header: columns })
      : XLSX.utils.aoa_to_sheet([columns]);
    let sheetName = String(name).replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Sheet";
    const base = sheetName;
    let suffix = 2;
    while (usedNames.has(sheetName)) sheetName = `${base.slice(0, 27)}_${suffix++}`;
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="wms-db-${stamp}.xlsx"`);
  res.send(buffer);
});

// ── DB 열람 (관리자 전용, 조회 전용) ──────────────────────────

adminRouter.get("/admin/db/tables", requireAdmin, (req, res) => {
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const withCounts = tables.map((t) => {
    const { c } = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
    return { name: t.name, count: c };
  });
  res.json({ success: true, tables: withCounts });
});

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

adminRouter.get("/admin/db/table/:name", requireAdmin, (req, res) => {
  const { name } = req.params;
  if (!IDENT_RE.test(name)) return res.status(400).json({ success: false, error: "잘못된 테이블명입니다." });
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  if (!exists) return res.status(404).json({ success: false, error: "존재하지 않는 테이블입니다." });

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
  const { c: total } = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get();
  const rows = db.prepare(`SELECT * FROM "${name}" LIMIT ? OFFSET ?`).all(limit, offset);
  res.json({ success: true, columns, rows, total, limit, offset });
});

// 읽기 전용 SQL 창 — SELECT 문만 허용한다 (그 외는 전부 거부).
adminRouter.post("/admin/db/query", requireAdmin, (req, res) => {
  const sql = String(req.body?.sql || "").trim();
  if (!sql) return res.status(400).json({ success: false, error: "SQL을 입력해주세요." });
  // 세미콜론으로 여러 문장을 이어붙이는 것도 막는다 (첫 문장 이후 내용이 있으면 거부).
  const withoutTrailingSemicolon = sql.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return res.status(400).json({ success: false, error: "한 번에 하나의 SELECT 문만 실행할 수 있습니다." });
  }
  if (!/^select\s/i.test(withoutTrailingSemicolon)) {
    return res.status(400).json({ success: false, error: "SELECT 문만 실행할 수 있습니다 (조회 전용)." });
  }
  try {
    const rows = db.prepare(withoutTrailingSemicolon).all();
    const columns = rows.length ? Object.keys(rows[0]) : [];
    res.json({ success: true, columns, rows: rows.slice(0, 1000), truncated: rows.length > 1000 });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});
