import test from "node:test";
import assert from "node:assert/strict";
import { rankScenarios, scenarioDocument, scenarioLexicalScore, filterScenarioSearchItems } from "./scenarioAiSearch.js";
import { createToolSearch, localEmbeddingClient } from "./warehouseToolSearch.js";
const items = [
  { id: "000013", name: "Plush Toy", category: "장난감", subcategory: "인형", request: null },
  { id: "000014", name: "Paper Cup", category: "주방", subcategory: "컵", request: "" },
  { id: "000015", name: "Plastic Cup", category: "주방", subcategory: "컵", request: null, variantNames: "파랑 빨강" },
];
const vector = () => Array.from({ length: 768 }, (_, n) => n === 0 ? 1 : 0);

test("AI는 카테고리뿐 아니라 이름 단어·순서를 판단하며 이름 일치를 우선", () => {
  const named = { id: '2', name: 'Jenga Orange', category: '기타' };
  const categoryOnly = { id: '1', name: 'Unrelated prop', category: 'Orange Jenga' };
  assert.equal(scenarioLexicalScore('Orange Jenga', named), 2.7);
  assert.equal(scenarioLexicalScore('Orange Jenga', categoryOnly), .6);
  const cache = new Map([[named.id, { text: scenarioDocument(named), vector: vector().map(x => x * .1) }],
    [categoryOnly.id, { text: scenarioDocument(categoryOnly), vector: vector() }]]);
  assert.equal(rankScenarios('Orange Jenga', [categoryOnly, named], cache, vector())[0].id, named.id);
  assert.equal(rankScenarios('Orange Jenga', [categoryOnly, named])[0].id, named.id);
  assert.equal(scenarioLexicalScore('Orange Jenga', {name:'Orange Jenga'}), 3);
  assert.equal(scenarioLexicalScore('small box for storing things', {name:'Box Cutter'}), .35);
});
test("시나리오 한영 유사어·종류·ID 검색, 문자열 ID 유지", () => {
  assert.equal(rankScenarios("곰인형", items)[0].id, "000013");
  assert.equal(scenarioLexicalScore("13", items[0]), 3.5);
  assert.equal(rankScenarios("빨강", items)[0].id, "000015");
  assert.equal(rankScenarios("상자", [{id:'1',name:'Box cutter'},{id:'2',name:'Shoes Box'}])[0].id, '2');
  assert.equal(rankScenarios("컵", [{id:'1',name:'Cup Carrier'},{id:'2',name:'Paper Cup'}])[0].id, '2');
  const document = scenarioDocument({ ...items[0], root_slot: "SECRET-LOCATION", sm_property: "PRIVATE-META", purchase_link: "PRIVATE-LINK" });
  assert.doesNotMatch(document, /SECRET|PRIVATE/);
});
test("카테고리·서브카테고리·Request 필터를 후보 수 제한 전에 적용", () => {
  assert.deepEqual(filterScenarioSearchItems(items, { request: "normal" }).map(i => i.id), ["000013", "000015"]);
  const many = Array.from({ length: 30 }, (_, n) => ({ id: String(n).padStart(6, "0"), name: "Cup", category: n < 25 ? "제외" : "선택", subcategory: "컵", request: null }));
  assert.equal(rankScenarios("cup", many, new Map(), null, { category: "선택" }).length, 5);
  assert.equal(rankScenarios("cup", items, new Map(), null, { category: "주방", subcategory: "컵", request: "normal" })[0].id, "000015");
});
test("필터 검색이 다른 카테고리 벡터를 지우거나 재생성하지 않음", async () => {
  let calls = 0;
  const service = createToolSearch({ embed: async () => { calls++; return vector(); }, document: scenarioDocument, rank: rankScenarios, delay: 0 });
  await service.warm(items); assert.equal(calls, 3);
  const filtered = await service.search("컵", items, { category: "주방", request: "normal" });
  assert.equal(filtered.mode, "ai"); assert.deepEqual(filtered.items, [{ id: "000015" }]);
  await service.warm(items); assert.equal(calls, 4);
  const next = await service.search("곰인형", items, { category: "장난감" });
  assert.equal(next.items[0].id, "000013"); assert.equal(calls, 5);
});
test("공구·시나리오 모델 클라이언트가 동시에 추론을 큐에 쌓지 않음", async () => {
  const { default: express } = await import("express");
  const app = express(); let requests = 0;
  app.post('/v1/embeddings', (_req, res) => { requests++; setTimeout(() => res.json({ data: [{ embedding: vector() }] }), 40); });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const tool = localEmbeddingClient(url), scenario = localEmbeddingClient(url);
    const first = tool('tool'); await assert.rejects(scenario('scenario'), /busy/); await first;
    await scenario('scenario'); assert.equal(requests, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

process.env.WMS_DB_PATH = ":memory:";
test("일반 모드에서도 AI 경로 사용, 사번/관리자 보호 및 보관 물품 제외", async () => {
  const { db, run } = await import("../db.js");
  const { issueAdminSession } = await import("./auth.js");
  const { scenarioAiSearchRouter } = await import("../routes/scenarioAiSearch.js");
  const { default: express } = await import("express");
  db.exec("DELETE FROM settings; DELETE FROM scenario_items; DELETE FROM registered_users;");
  run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','0')");
  run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1111','테스트',1)");
  run("INSERT INTO scenario_items(id,name,category,subcategory,request,is_storage) VALUES ('000013','Plush Toy','장난감','인형',NULL,'N'),('000014','Plush Toy','장난감','인형',NULL,'TRUE'),('000015','Plush Toy','장난감','인형','','N')");
  run("INSERT INTO admin_users(login_id,name,password_hash) VALUES ('ai-test-admin','관리자','unused')");
  const adminId = db.prepare("SELECT id FROM admin_users WHERE login_id='ai-test-admin'").get().id;
  const token = issueAdminSession(adminId);
  const app = express(); app.use('/api', scenarioAiSearchRouter);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/scenario-search`;
  try {
    assert.equal((await fetch(`${base}?q=곰인형`)).status, 401);
    const response = await fetch(`${base}?employeeId=1111&q=곰인형&request=normal`);
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).items, [{ id: "000013" }]);
    const adminResponse = await fetch(`${base}?q=곰인형`, { headers: { 'x-admin-token': token } });
    assert.equal(adminResponse.status, 200); assert.equal((await adminResponse.json()).items.length, 2);
    assert.equal((await fetch(`${base}?employeeId=1111&q=`)).status, 400);
    assert.equal((await fetch(`${base}?employeeId=1111&q=cup&request=invalid`)).status, 400);
    for (let n = 0; n < 4; n++) assert.equal((await fetch(`${base}?employeeId=1111&q=곰인형`)).status, 200);
    assert.equal((await fetch(`${base}?employeeId=1111&q=곰인형`)).status, 429);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sid_rentals').get().n, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
