import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

// 운영 장부는 사용하지 않는다.
process.env.WMS_DB_PATH = ":memory:";
delete process.env.WMS_MAIN_URL;
const { requestLookupRouter, REQUEST_LOOKUP_PATH, MAIN_APP_URL } = await import("./requestLookup.js");

async function fetchPage() {
  const app = express();
  app.use(requestLookupRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${REQUEST_LOOKUP_PATH}`);
    return { status: res.status, html: await res.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// 이번 근무일 처리 내역은 '내 대여 조회'로 옮겼다. QR 페이지의 버튼은 그 주소를 안내해야 한다.
test("QR 조회 페이지가 내 대여 조회 주소를 안내하도록 채워져 나온다", async () => {
  const { status, html } = await fetchPage();
  assert.equal(status, 200);
  assert.equal(MAIN_APP_URL, "http://192.168.100.152:3000/");
  assert.ok(html.includes(`const MAIN_APP_URL = "${MAIN_APP_URL}"`), "안내 주소가 스크립트에 들어가야 한다");
  assert.ok(html.includes("내 대여 조회"), "안내 문구가 있어야 한다");
  assert.ok(html.includes('id="status"'), "처리 내역 버튼이 있어야 한다");
});

test("치환 자리표시자가 그대로 남지 않는다", async () => {
  const { html } = await fetchPage();
  assert.equal(html.includes("__MAIN_APP_URL__"), false);
  assert.equal(html.includes("__LOOKUP_PATH__"), false);
});
