import test from "node:test";
import assert from "node:assert/strict";

process.env.WMS_DB_PATH = ":memory:";
const { db, run } = await import("../db.js");
const { itemBorrowers } = await import("./itemBorrowers.js");

test("신청용 현재 대여 조회는 반납·취소를 제외하고 필요한 정보만 반환한다", () => {
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','상자',0,5),('000002','다른 물품',0,1)");
  run("INSERT INTO scenario_item_variants (id,item_id,name) VALUES (1,'000001','작은 것'),(2,'000001','큰 것'),(3,'000002','별도 물품')");
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','현재 이름',1)");
  run("INSERT INTO sid_rentals (borrower_name,employee_id,item_label,returned,status,picked_up_at,variant_id,email) VALUES ('옛 이름','1234','[000001] 상자 x 2',NULL,'active','2026-10-02',1,'hidden@example.test')");
  run("INSERT INTO general_rentals (borrower_name,item_id,qty,returned,status,variant_id) VALUES ('확인 대기','1',3,'','active',2)");
  run("INSERT INTO general_rentals (borrower_name,item_id,qty,returned,status) VALUES ('반납자','000001',4,'O','archived'),('취소자','000001',2,'','cancelled'),('다른 물품 대여자','000002',1,'','active')");
  run("INSERT INTO sid_rentals (borrower_name,item_label,returned,status) VALUES ('SID 반납자','[000001] 상자','O','active'),('ID가 비슷한 물품','[000010] 다른 것','','active')");
  const rows = itemBorrowers({ itemId: '1' });
  assert.deepEqual(rows, [
    { borrowerName: '현재 이름', quantity: 2, pickedUp: true, variantName: '작은 것' },
    { borrowerName: '확인 대기', quantity: 3, pickedUp: false, variantName: '큰 것' },
  ]);
  assert.deepEqual(itemBorrowers({ itemId: '1', variantId: '1' }), [rows[0]]);
  assert.deepEqual(itemBorrowers({ itemId: '1', variantId: '2' }), [rows[1]]);
  assert.deepEqual(itemBorrowers({ itemId: '1', variantId: '3' }), []);
  assert.deepEqual(itemBorrowers({ itemId: '999' }), []);
  assert.throws(() => itemBorrowers({ itemId: '1', category: 'invalid' }), /올바르지/);
  assert.throws(() => itemBorrowers({ itemId: '1', variantId: '-1' }), /올바르지/);
  assert.ok(rows.every((row) => !('email' in row) && !('employeeId' in row) && !('location' in row)));

  // 부분 반납 이후 남은 장부 수량만 표시한다. 종류 미정 신청은 별도로 구분한다.
  run("UPDATE sid_rentals SET item_label='[000001] 상자' WHERE borrower_name='옛 이름'");
  assert.equal(itemBorrowers({ itemId: '1', variantId: 1 })[0].quantity, 1);
  run("INSERT INTO general_rentals (borrower_name,item_id,qty,returned,status,variant_pending) VALUES ('종류 미정','000001',1,NULL,'active','Y')");
  assert.ok(itemBorrowers({ itemId: '1' }).some((row) => row.variantName === '종류 미정'));

  run("INSERT INTO tablecloth_items (id,name,stock,rented) VALUES (1,'천',1,1)");
  run("INSERT INTO tablecloth_rentals (item_id,borrower_name,qty,returned,status,picked_up_at,email) VALUES (1,'천 대여자',1,NULL,'active','2026-10-02','hidden@example.test'),(1,'천 반납자',1,'O','archived',NULL,NULL)");
  assert.deepEqual(itemBorrowers({ category: 'tablecloth', itemId: '1' }), [{ borrowerName: '천 대여자', quantity: 1, pickedUp: true, variantName: '' }]);
});

test.after(() => db.close());
