import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

// 운영 장부는 쓰지 않는다. 메모리 DB에 같은 물품의 지난 대여·반납과 지금 대여를 직접 만든다.
process.env.WMS_DB_PATH = ":memory:";
const { run } = await import("../db.js");
const { issueAdminSession } = await import("../lib/auth.js");
const { gasRouter } = await import("./gas.js");
const app = express();
app.use(express.json());
app.use("/api", gasRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

run("INSERT INTO scenario_items (id,name,stock) VALUES ('000001','상자',5),('000002','공',5)");
run("INSERT INTO scenario_item_variants (id,item_id,name,stock) VALUES (1,'000001','작은 것',3),(2,'000001','큰 것',3),(3,'000002','빨강',3),(4,'000002','파랑',3)");
// 상자: 어제 '큰 것'으로 반납 → 오늘 '큰 것'으로 다시 나감(같은 종류), '종류 상관없음' 신청 1건
// 공: 어제 '빨강' 반납 → 오늘 '파랑'(다른 종류)
run(`INSERT INTO general_rentals (id,item_id,item_label,borrower_name,qty,variant_id,variant_pending,status,returned,return_date,picked_up_at) VALUES
  (1,'000001','상자','지난 사람',1,2,NULL,'archived','O','2026-10-19 17:00:00','2026-10-19 10:00:00'),
  (2,'000001','상자','오늘 사람',1,2,NULL,'active','X',NULL,'2026-10-20 09:00:00'),
  (3,'000001','상자','종류 대기',1,NULL,'Y','active','X',NULL,NULL),
  (4,'000002','공','지난 사람',1,3,NULL,'archived','O','2026-10-19 17:00:00','2026-10-19 10:00:00'),
  (5,'000002','공','오늘 사람',1,4,NULL,'active','X',NULL,'2026-10-20 09:00:00'),
  (6,'000002','공','나중 사람',1,4,NULL,'active','X',NULL,'2026-10-20 11:00:00')`);
const admin = run("INSERT INTO admin_users (login_id,password_hash,name) VALUES ('repeat-fixture','x','테스트')");
const token = issueAdminSession(Number(admin.lastInsertRowid));

test("같은 물품의 직전 대여·반납과 종류가 같으면 표시하고, 종류 선택 대기 줄에는 직전 종류를 알려준다", async () => {
  const res = await (await fetch(`${origin}/api/gas?action=getUnreturnedItems`, { headers: { "x-admin-token": token } })).json();
  const row = (id) => res.items.find((it) => it.sheetType === "general" && it.rowIndex === id);
  assert.equal(row(2).sameVariantAsPrevious, true);
  assert.deepEqual({ ...row(2).previousVariant }, { variantId: 2, variantName: "큰 것", kind: "반납", at: "2026-10-19 17:00:00" });
  assert.equal(row(5).sameVariantAsPrevious, false);
  // 수령한 줄은 그보다 앞선 기록과만 비교한다 — 나중에 같은 종류를 빌려 간 6번 때문에 5번이 표시되지 않는다.
  assert.equal(row(5).previousVariant.variantName, "빨강");
  assert.equal(row(6).sameVariantAsPrevious, true);
  // 종류 대기 줄의 직전 기록은 가장 최근인 오늘 대여(큰 것)다.
  assert.equal(row(3).sameVariantAsPrevious, false);
  assert.equal(row(3).previousVariant.variantName, "큰 것");
  assert.equal(row(3).previousVariant.kind, "대여");
});
