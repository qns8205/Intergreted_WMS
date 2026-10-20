import test from "node:test";
import assert from "node:assert/strict";

// 운영 장부는 사용하지 않는다. 무인 PC 로그인 표가 등록된 PC·본인 사번에만 통하는지 본다.
process.env.WMS_DB_PATH = ":memory:";
const { db, run } = await import("../db.js");
const { digest, issueKioskSession, kioskUserFromRequest, revokeKioskSession, SESSION_HEADER, DEVICE_HEADER } = await import("./unattendedKiosk.js");

const DEVICE = "device-token-for-test";
function reset() {
  for (const table of ["settings", "registered_users"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO settings (key,value) VALUES ('unattended_enabled','1')");
  run("INSERT INTO settings (key,value) VALUES ('unattended_device_hash',?)", [digest(DEVICE)]);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','홍길동',1)");
}
const req = (headers) => ({ header: (name) => headers[name.toLowerCase()] ?? "" });

test("등록된 무인 PC에서 받은 표로만 본인 사번이 확인된다", () => {
  reset();
  const now = 1_000_000;
  const token = issueKioskSession("1234", now);
  assert.deepEqual(kioskUserFromRequest(req({ [DEVICE_HEADER]: DEVICE, [SESSION_HEADER]: token }), now), { employeeId: "1234", name: "홍길동" });
  // 다른 PC(무인 PC 표시가 없거나 틀림)에서는 같은 표라도 통하지 않는다.
  assert.equal(kioskUserFromRequest(req({ [SESSION_HEADER]: token }), now), null);
  assert.equal(kioskUserFromRequest(req({ [DEVICE_HEADER]: "other", [SESSION_HEADER]: token }), now), null);
  // 엉터리 표는 통하지 않는다.
  assert.equal(kioskUserFromRequest(req({ [DEVICE_HEADER]: DEVICE, [SESSION_HEADER]: "x".repeat(43) }), now), null);
});

test("로그아웃하면 바로, 15분 쓰지 않거나 1시간이 지나면 끝난다", () => {
  reset();
  const start = 5_000_000;
  const headers = (token) => req({ [DEVICE_HEADER]: DEVICE, [SESSION_HEADER]: token });
  const a = issueKioskSession("1234", start);
  revokeKioskSession(headers(a));
  assert.equal(kioskUserFromRequest(headers(a), start), null);

  const b = issueKioskSession("1234", start);
  assert.ok(kioskUserFromRequest(headers(b), start + 14 * 60_000));        // 쓰는 동안은 연장된다
  assert.equal(kioskUserFromRequest(headers(b), start + 30 * 60_000), null); // 마지막 사용 후 16분

  const c = issueKioskSession("1234", start);
  for (let t = start; t <= start + 55 * 60_000; t += 10 * 60_000) assert.ok(kioskUserFromRequest(headers(c), t));
  assert.equal(kioskUserFromRequest(headers(c), start + 61 * 60_000), null);
});

test("무인 모드를 끄거나 명부에서 빠진 사번은 통하지 않는다", () => {
  reset();
  const token = issueKioskSession("1234", 1);
  const r = req({ [DEVICE_HEADER]: DEVICE, [SESSION_HEADER]: token });
  run("UPDATE settings SET value='0' WHERE key='unattended_enabled'");
  assert.equal(kioskUserFromRequest(r, 1), null);
  run("UPDATE settings SET value='1' WHERE key='unattended_enabled'");
  run("DELETE FROM registered_users");
  assert.equal(kioskUserFromRequest(r, 1), null);
});
