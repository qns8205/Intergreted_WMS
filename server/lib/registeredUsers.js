import { all, get, run, transaction } from "../db.js";

export function normalizeEmployeeId(value) {
  const id = String(value ?? "").trim();
  return /^\d{4}$/.test(id) ? id : "";
}

export function normalizePersonName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function registeredUser(employeeId) {
  const id = normalizeEmployeeId(employeeId);
  if (!id || id === "0000") return null;
  return get("SELECT employee_id, name FROM registered_users WHERE employee_id = ? AND active = 1", [id]) || null;
}

export function registeredUsersByName(name) {
  const key = normalizePersonName(name);
  if (!key) return [];
  return all("SELECT employee_id, name FROM registered_users WHERE active = 1 AND employee_id != '0000'")
    .filter((row) => normalizePersonName(row.name) === key);
}

export function resolveRegisteredIdentity(employeeId, suppliedName = "") {
  const user = registeredUser(employeeId);
  if (!user) return { ok: false, error: "등록된 사번을 찾지 못했습니다." };
  const given = normalizePersonName(suppliedName);
  if (given && given !== normalizePersonName(user.name)) {
    return { ok: false, error: "사번과 이름이 일치하지 않습니다." };
  }
  return { ok: true, employeeId: user.employee_id, name: user.name };
}

export function employeeIdForRentalRow(row) {
  const direct = normalizeEmployeeId(row?.employee_id);
  if (direct) return direct;
  const emailId = normalizeEmployeeId(String(row?.email || "").split("@")[0]);
  const emailUser = emailId ? registeredUser(emailId) : null;
  if (emailUser && normalizePersonName(emailUser.name) === normalizePersonName(row?.borrower_name)) return emailId;
  if (row?.request_no) {
    const request = get("SELECT employee_id FROM rental_requests WHERE id = ?", [row.request_no]);
    const linked = normalizeEmployeeId(request?.employee_id);
    if (linked) return linked;
  }
  const byName = registeredUsersByName(row?.borrower_name);
  return byName.length === 1 ? byName[0].employee_id : "";
}

export function backfillRentalEmployeeIds() {
  const summary = { mappedRequests: 0, mappedRows: 0, ambiguousRows: 0, unmatchedRows: 0 };
  transaction(() => {
    for (const request of all("SELECT id, borrower_name, employee_id FROM rental_requests")) {
      if (normalizeEmployeeId(request.employee_id)) continue;
      const matches = registeredUsersByName(request.borrower_name);
      if (matches.length === 1) {
        run("UPDATE rental_requests SET employee_id = ? WHERE id = ?", [matches[0].employee_id, request.id]);
        summary.mappedRequests++;
      }
    }
    for (const table of ["sid_rentals", "general_rentals"]) {
      for (const row of all(`SELECT id, borrower_name, employee_id, request_no FROM ${table}`)) {
        if (normalizeEmployeeId(row.employee_id)) continue;
        const id = employeeIdForRentalRow(row);
        if (id) {
          run(`UPDATE ${table} SET employee_id = ? WHERE id = ?`, [id, row.id]);
          summary.mappedRows++;
          continue;
        }
        const matches = registeredUsersByName(row.borrower_name);
        if (matches.length > 1) summary.ambiguousRows++;
        else summary.unmatchedRows++;
      }
    }
  });
  return summary;
}
