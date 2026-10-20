import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

process.env.WMS_DB_PATH = ":memory:";
const fixtureUploads = await mkdtemp(path.join(process.cwd(), '.tmp-variant-photos-'));
process.env.WMS_UPLOADS_DIR = fixtureUploads;
const { db, run, get } = await import("../db.js");
const { scenarioVariantInfo, photoItemVariant } = await import("./scenarioVariantDisplay.js");
const { itemBorrowers } = await import("./itemBorrowers.js");
const { issueAdminSession } = await import("./auth.js");
const { gasRouter } = await import("../routes/gas.js");
const { unattendedRouter } = await import("../routes/unattended.js");
const app = express();
app.use(express.json());
app.use("/api", gasRouter, unattendedRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
run("INSERT INTO scenario_items (id,name) VALUES ('000001','상자'),('000002','단일 물품'),('000003','별도 물품')");
run("INSERT INTO scenario_item_variants (id,item_id,name) VALUES (1,'000001','작은 것'),(2,'000001','큰 것'),(3,'000003','다른 물품 종류')");
run("INSERT INTO general_rentals (id,item_id,item_label,borrower_name,qty,variant_id,variant_pending,status) VALUES (1,'000001','상자','테스트',1,2,'N','active'),(2,'000001','상자','종류 대기',1,NULL,'Y','active'),(3,'000001','상자','옛 기록',1,NULL,'N','active')");
const admin = run("INSERT INTO admin_users (login_id,password_hash,name) VALUES ('variant-fixture','not-a-login-password','테스트')");
const token = issueAdminSession(Number(admin.lastInsertRowid));
const headers = { "x-admin-token": token, "Content-Type": "text/plain" };

test("선택된 종류·미정·미확인·종류 없는 물품을 구분하며 타 물품의 종류는 쓰지 않는다", () => {
  assert.equal(scenarioVariantInfo('1', {variant_id:2}).variantName, '큰 것');
  assert.equal(scenarioVariantInfo('1', {variant_pending:'Y'}).variantPending, true);
  assert.equal(scenarioVariantInfo('1').variantUnassigned, true);
  assert.equal(scenarioVariantInfo('2').variantUnassigned, false);
  assert.equal(scenarioVariantInfo('1', {variant_id:3}).variantUnassigned, true);
  assert.ok(itemBorrowers({itemId:'1'}).some((item) => item.variantName === '종류 미확인'));
});

test("사진은 대여 행/선택 종류로 저장하며 이전 사진의 종류를 새 대여 행에서 추측하지 않는다", () => {
  assert.equal(photoItemVariant({itemId:'1',sheetType:'general',rowIndex:1}, {snapshot:true}).variantName, '큰 것');
  assert.equal(photoItemVariant({itemId:'1',sheetType:'general',rowIndex:1,variantId:1}, {snapshot:true}).variantName, '큰 것');
  assert.equal(photoItemVariant({itemId:'1',sheetType:'general',rowIndex:2,variantId:1}, {snapshot:true}).variantName, '작은 것');
  assert.equal(photoItemVariant({itemLabel:'[000001] 상자'}).variantUnassigned, true);
  assert.equal(photoItemVariant({itemLabel:'상자'}).variantUnassigned, true);
  assert.equal(photoItemVariant({itemId:'1',variantName:'촬영 당시 이름'}).variantName, '촬영 당시 이름');
  assert.deepEqual(photoItemVariant({itemId:'1',sheetType:'warehouse'}), {itemId:'1',sheetType:'warehouse'});
});

test("일반 반납 저장와 세 사진 탭의 조회·종류 검색에서 메타데이터를 유지한다", async () => {
  const response = await (await fetch(origin + '/api/gas', {method:'POST',headers,body:JSON.stringify({action:'saveReturnPhoto',payload:{photo:'/fixture-photo.webp',clientId:'variant-photo',items:[{itemId:'1',sheetType:'general',rowIndex:1,itemLabel:'상자',borrower:'테스트',qty:1,action:'반납'}]}})})).json();
  assert.equal(response.success, true);
  const stored = JSON.parse(get("SELECT items_json FROM return_photos WHERE client_id='variant-photo'").items_json)[0];
  assert.equal(stored.variantName, '큰 것');
  run("UPDATE scenario_item_variants SET name='변경된 큰 것' WHERE id=2");
  run("INSERT INTO return_photos (occurred_at,image_path,source,items_json) VALUES ('2026-10-07','/fixture.webp','unattended',?)", [JSON.stringify([{itemId:'1',variantId:1,variantName:'작은 것',itemLabel:'상자',qty:1,action:'반납'}])]);
  run("INSERT INTO unattended_pickup_photos (client_id,created_at,image_path,items_json) VALUES ('pickup-fixture','2026-10-07','/fixture.webp',?)", [JSON.stringify([{itemId:'1',variantId:1,variantName:'작은 것',itemLabel:'상자',qty:1}])]);
  for (const [action, name] of [['getReturnPhotos','큰 것'],['getUnattendedReturnPhotos','작은 것'],['getPickupPhotos','작은 것']]) {
    const result = await (await fetch(`${origin}/api/gas?action=${action}&itemSearch=${encodeURIComponent(name)}`, {headers})).json();
    assert.equal(result.success, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].items[0].variantName, name);
    const empty = await (await fetch(`${origin}/api/gas?action=${action}&itemSearch=NO_MATCH`, {headers})).json();
    assert.equal(empty.items.length, 0);
  }
});

test("사진·대여자 조회는 관리자 권한과 기존 공개 범위를 그대로 유지한다", async () => {
  const photos = await (await fetch(origin + '/api/gas?action=getReturnPhotos')).json();
  assert.equal(photos.success, false);
  const borrowers = await (await fetch(origin + '/api/gas?action=getItemBorrowers&itemId=1')).json();
  assert.equal(borrowers.success, true);
  assert.ok(borrowers.borrowers.every((item) => !('employeeId' in item) && !('email' in item) && !('location' in item)));
});

test("무인 조회와 실제 대여 확인·반납 사진 모두 각 대여 행의 종류를 따로 보존한다", async () => {
  const device = 'local-fixture-device';
  run("INSERT INTO settings (key,value) VALUES ('unattended_enabled','1'),('unattended_device_hash',?)", [crypto.createHash('sha256').update(device).digest('hex')]);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('9876','무인 테스트',1)");
  run("INSERT INTO general_rentals (id,employee_id,borrower_name,item_id,item_label,qty,returned,status,variant_id) VALUES (40,'9876','무인 테스트','000001','상자',1,'X','active',1)");
  run("INSERT INTO sid_rentals (id,employee_id,borrower_name,item_label,returned,status,variant_id) VALUES (41,'9876','무인 테스트','[000001] 상자','X','active',2)");
  const post = async (route, body) => (await fetch(origin+'/api/unattended/'+route, {method:'POST',headers:{'Content-Type':'application/json','x-unattended-device':device},body:JSON.stringify(body)})).json();
  const found = await post('find-mine', {employeeId:'9876',operation:'pickup'});
  assert.equal(found.success, true);
  assert.deepEqual(found.items.map((item) => item.variantName).sort(), ['변경된 큰 것','작은 것'].sort());
  const selections = found.items.map((item) => ({sheetType:item.sheetType,rowIndex:item.rowIndex,quantity:1}));
  const photo = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>').toString('base64');
  const pickup = await post('confirm-pickup', {clientId:'unattended-variant-pickup',items:selections,photo});
  assert.equal(pickup.success, true);
  const pickupItems = JSON.parse(get("SELECT items_json FROM unattended_pickup_photos WHERE client_id='unattended-variant-pickup'").items_json);
  assert.deepEqual(pickupItems.map((item) => item.variantName).sort(), found.items.map((item) => item.variantName).sort());
  const returned = await post('return', {clientId:'unattended-variant-return',items:selections,photo});
  assert.equal(returned.success, true);
  const returnItems = JSON.parse(get("SELECT items_json FROM return_photos WHERE client_id='unattended-variant-return'").items_json);
  assert.deepEqual(returnItems.map((item) => item.variantName).sort(), pickupItems.map((item) => item.variantName).sort());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // The normal stock-sync nudge drains its timer before this isolated DB closes.
  process.once('beforeExit', () => db.close());
  await rm(fixtureUploads, {recursive:true,force:true});
});
