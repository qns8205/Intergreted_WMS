import test from "node:test";
import assert from "node:assert/strict";
process.env.WMS_DB_PATH = ":memory:";
const { db, get, run, all } = await import("../db.js");
const { recordWarehouseManualRequest, pendingWarehouseManualRequests, resolveWarehouseManualRequest, outstandingWarehouseTools, returnWarehouseTools } = await import("./warehouseManualRequests.js");
const { warehouseLoanGroups } = await import("./warehouseRentals.js");
const photo = "data:image/jpeg;base64,AA==";
const save = async () => ({ url: "/uploads/test.webp" });
function reset() {
  for (const table of ["warehouse_manual_request_items", "warehouse_manual_requests", "warehouse_manual_returns", "warehouse_rental_logs", "warehouse_items", "inventory_history", "registered_users", "return_photos", "settings"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','1'),('floor_plan','{\"floors\":[{\"id\":\"2\",\"name\":\"2F\"}]}')");
  run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1111','사용자',1),('2222','다른 사용자',1)");
  run("INSERT INTO warehouse_items(location,name,stock,consumable) VALUES ('A-01','Hammer','5','N'),('B-01','부품','6','Y')");
}
const payload = (overrides = {}) => ({ clientId: "request-test-12345", employeeId: "1111", floor: "2F", items: [{ name: "Hammer", qty: 2 }], photo, ...overrides });
const stock = () => Number(get("SELECT stock FROM warehouse_items WHERE name='Hammer'").stock);
test("무인 직접 입력 공구 신청 및 반납", async t => {
  await t.test("이름 정규화 매칭 및 실제 명부 이름으로 출고", async () => {
    reset(); const result = await recordWarehouseManualRequest(payload({ items: [{ name: "  HAMMER  ", qty: 2 }], name: "위조" }), save);
    assert.equal(result.processed, 1); assert.equal(stock(), 3);
    const log = get("SELECT * FROM warehouse_rental_logs");
    assert.equal(log.manager, "사용자"); assert.equal(log.employee_id, "1111"); assert.match(log.note, /2F/);
    assert.equal(result.items[0].type, "대여");
  });
  await t.test("미일치·동일 이름·재고 부족은 사진과 함께 대기", async () => {
    reset(); run("INSERT INTO warehouse_items(location,name,stock) VALUES ('C-01','Hammer','8')");
    const result = await recordWarehouseManualRequest(payload({ items: [{ name: "Hammer", qty: 1 }, { name: "드라이버", qty: 1 }, { name: "부품", qty: 10 }] }), save);
    assert.equal(result.pending, 3); assert.equal(stock(), 5); assert.equal(warehouseLoanGroups().size, 0);
    assert.equal(pendingWarehouseManualRequests()[0].image_path, "/uploads/test.webp");
  });
  await t.test("검색에서 직접 선택한 ID만 연결하고 같은 이름의 다른 재고는 보존", async () => {
    reset(); run("INSERT INTO warehouse_items(location,name,stock) VALUES ('C-01','Hammer','8')");
    const chosen = get("SELECT id FROM warehouse_items WHERE location='C-01'");
    const result = await recordWarehouseManualRequest(payload({ items: [{ name: "Hammer", qty: 2, itemId: chosen.id }] }), save);
    assert.equal(result.processed, 1);
    assert.equal(Number(get("SELECT stock FROM warehouse_items WHERE location='A-01'").stock), 5);
    assert.equal(Number(get("SELECT stock FROM warehouse_items WHERE location='C-01'").stock), 6);
  });
  await t.test("선택 후 이름 변경·삭제·재고 부족은 다른 물품으로 자동 연결하지 않음", async () => {
    for (const change of ["UPDATE warehouse_items SET name='다른 이름' WHERE name='Hammer'", "DELETE FROM warehouse_items WHERE name='Hammer'", "UPDATE warehouse_items SET stock='0' WHERE name='Hammer'"]) {
      reset(); const itemId = get("SELECT id FROM warehouse_items WHERE name='Hammer'").id;
      db.exec(change);
      const result = await recordWarehouseManualRequest(payload({ items: [{ name: "Hammer", qty: 1, itemId }] }), save);
      assert.equal(result.pending, 1); assert.equal(all("SELECT * FROM warehouse_rental_logs").length, 0);
    }
    reset(); await assert.rejects(recordWarehouseManualRequest(payload({ items: [{ name: "Hammer", qty: 1, itemId: -1 }] }), save));
  });
  await t.test("관리자 연결도 한 번만 차감", async () => {
    reset(); await recordWarehouseManualRequest(payload({ items: [{ name: "망치", qty: 2 }] }), save);
    const line = pendingWarehouseManualRequests()[0]; const item = get("SELECT id FROM warehouse_items WHERE name='Hammer'");
    resolveWarehouseManualRequest(line.id, item.id, "관리자"); resolveWarehouseManualRequest(line.id, item.id, "관리자");
    assert.equal(stock(), 3); assert.equal(pendingWarehouseManualRequests().length, 0);
    assert.equal(get("SELECT COUNT(*) AS n FROM warehouse_rental_logs").n, 1);
  });
  await t.test("신청 응답 유실 및 사진 저장 중 동시 재시도도 이중 출고하지 않음", async () => {
    reset(); const results = await Promise.all([recordWarehouseManualRequest(payload(), save), recordWarehouseManualRequest(payload(), save)]);
    assert.equal(results[0].requestId, results[1].requestId); await recordWarehouseManualRequest(payload(), save); assert.equal(stock(), 3);
    await assert.rejects(recordWarehouseManualRequest(payload({ employeeId: "2222" }), save), /다른 사용자/);
  });
  await t.test("소모품은 소모·재고 반영, 반납 목록에서 제외", async () => {
    reset(); const result = await recordWarehouseManualRequest(payload({ items: [{ name: "부품", qty: 2 }] }), save);
    assert.equal(result.items[0].type, "소모"); assert.equal(outstandingWarehouseTools("1111").items.length, 0);
    assert.equal(Number(get("SELECT stock FROM warehouse_items WHERE name='부품'").stock), 4);
  });
  await t.test("사번별 반납 대상과 부분 반납 및 재시도 재고 복구", async () => {
    reset(); await recordWarehouseManualRequest(payload(), save);
    const item = outstandingWarehouseTools("1111").items[0]; assert.equal(outstandingWarehouseTools("2222").items.length, 0);
    const body = { clientId: "return-test-12345", employeeId: "1111", photo, items: [{ key: item.key, qty: 1 }] };
    const results = await Promise.all([returnWarehouseTools(body, save), returnWarehouseTools(body, save)]);
    assert.equal(results[0].returnId, results[1].returnId); assert.equal(stock(), 4);
    assert.equal(outstandingWarehouseTools("1111").items[0].qty, 1);
    assert.equal(get("SELECT COUNT(*) AS n FROM return_photos").n, 1);
    db.exec("DELETE FROM return_photos");
    await returnWarehouseTools(body, save); assert.equal(stock(), 4);
    await assert.rejects(returnWarehouseTools({ ...body, employeeId: "2222" }, save), /다른 사용자/);
  });
  await t.test("다른 사람 물품·중복 항목·초과 반납을 거부하고 재고 유지", async () => {
    reset(); await recordWarehouseManualRequest(payload(), save); const key = outstandingWarehouseTools("1111").items[0].key;
    for (const overrides of [{ employeeId: "2222" }, { items: [{ key, qty: 3 }] }, { items: [{ key, qty: 1 }, { key, qty: 1 }] }]) {
      await assert.rejects(returnWarehouseTools({ clientId: "return-test-12345", employeeId: "1111", photo, items: [{ key, qty: 1 }], ...overrides }, save));
    }
    assert.equal(stock(), 3); assert.equal(get("SELECT COUNT(*) AS n FROM return_photos").n, 0);
  });
  await t.test("여러 항목 중 하나가 만료되면 반납 전체를 되돌림", async () => {
    reset(); await recordWarehouseManualRequest(payload(), save); const key = outstandingWarehouseTools("1111").items[0].key;
    await assert.rejects(returnWarehouseTools({ clientId: "return-test-12345", employeeId: "1111", photo, items: [{ key, qty: 1 }, { key: "loan:없는항목", qty: 1 }] }, save));
    assert.equal(stock(), 3); assert.equal(outstandingWarehouseTools("1111").items[0].qty, 2);
  });
  await t.test("재고 연결 전 물품 반납은 임의 재고 증감 없이 기록", async () => {
    reset(); await recordWarehouseManualRequest(payload({ items: [{ name: "망치", qty: 2 }] }), save);
    const key = outstandingWarehouseTools("1111").items[0].key;
    await returnWarehouseTools({ clientId: "return-test-12345", employeeId: "1111", photo, items: [{ key, qty: 1 }] }, save);
    assert.equal(pendingWarehouseManualRequests()[0].qty, 1);
    await returnWarehouseTools({ clientId: "return-test-67890", employeeId: "1111", photo, items: [{ key, qty: 1 }] }, save);
    assert.equal(stock(), 5); assert.equal(pendingWarehouseManualRequests().length, 0); assert.equal(outstandingWarehouseTools("1111").items.length, 0);
  });
  await t.test("꺼진 무인 모드·잘못된 사번·층·사진 검증", async () => {
    reset();
    for (const bad of [{ employeeId: "9999" }, { floor: "9F" }, { photo: "" }, { items: [{ name: "", qty: 1 }] }]) await assert.rejects(recordWarehouseManualRequest(payload(bad), save));
    run("UPDATE settings SET value='0' WHERE key='unattended_enabled'");
    await assert.rejects(recordWarehouseManualRequest(payload(), save), /무인 모드/);
    await assert.rejects(returnWarehouseTools({ employeeId: "1111" }, save), /무인 모드/);
    assert.equal(all("SELECT * FROM warehouse_manual_requests").length, 0);
  });
});

test("HTTP 경로는 관리자 연결을 보호하고 사번 및 무인 모드를 검증", async () => {
  reset();
  const { default: express } = await import("express");
  const { warehouseRequestsRouter } = await import("../routes/warehouseRequests.js");
  const app = express(); app.use(express.json()); app.use("/api", warehouseRequestsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/warehouse-requests`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/1/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: 1 }) })).status, 401);
    await recordWarehouseManualRequest(payload(), save);
    const response = await fetch(`${base}/mine?employeeId=1111`); assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].qty, 2);
    assert.equal((await fetch(`${base}/mine?employeeId=9999`)).status, 400);
    const before = stock();
    const search = await fetch(`${base}/search?employeeId=1111&q=망치`);
    assert.equal(search.status, 200); assert.equal((await search.json()).items[0].name, "Hammer"); assert.equal(stock(), before);
    assert.equal((await fetch(`${base}/search?employeeId=9999&q=망치`)).status, 400);
    assert.equal((await fetch(`${base}/search?employeeId=1111&q=`)).status, 400);
    for (let n = 0; n < 4; n++) assert.equal((await fetch(`${base}/search?employeeId=1111&q=망치`)).status, 200);
    assert.equal((await fetch(`${base}/search?employeeId=1111&q=망치`)).status, 429);
    run("UPDATE settings SET value='0' WHERE key='unattended_enabled'");
    assert.equal((await fetch(`${base}/mine?employeeId=1111`)).status, 400);
    assert.equal((await fetch(`${base}/search?employeeId=1111&q=망치`)).status, 400);
    assert.equal((await fetch(`${base}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
