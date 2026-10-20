import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

// 운영 DB·실제 SM은 쓰지 않는다. SM 로그인 확인은 가짜로 바꿔 끼운다.
process.env.WMS_DB_PATH = ":memory:";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { run, get, all } = await import("../db.js");
const { createSmSignupHandler } = await import("./signup.js");
const { createBorrowerAuthRouter } = await import("./borrowerAuth.js");

const verify = async (_id, password) => password === "outage" ? { ok: false, unavailable: true } : { ok: password === "right-pw" };
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.socket.encrypted = req.headers["x-test-tls"] === "1"; next(); });
app.post("/api/signup", createSmSignupHandler(verify));
app.use("/api", createBorrowerAuthRouter({ verify }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const post = (path, body, secure = true) => fetch(origin + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...(secure ? { "x-test-tls": "1" } : {}) }, body: JSON.stringify(body),
});
test.after(() => server.close());

test("신규 사원: SM 비밀번호가 맞으면 로그인 대신 '가입하기'를 안내한다", async () => {
  const res = await post("/api/borrower-auth/login", { employeeId: "4321", password: "right-pw" });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.unregistered, true);
  assert.equal(all("SELECT * FROM borrower_sessions").length, 0);
  // 비밀번호가 틀리면 가입 안내가 아니라 그냥 틀렸다고 한다(남의 사번이 등록됐는지 알려 주지 않는다).
  const wrong = await post("/api/borrower-auth/login", { employeeId: "4321", password: "nope" });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).unregistered, undefined);
});

test("SM에 로그인되는 사번·비밀번호면 바로 명부에 등록되고, 그 뒤로는 로그인된다", async () => {
  run("INSERT INTO signup_requests (employee_id, name, status, created_at) VALUES ('4321','옛 신청','pending','2026-10-01 10:00:00')");
  assert.equal((await post("/api/signup", { employeeId: "4321", password: "right-pw", name: "신규사원" }, false)).status, 426);
  assert.equal((await post("/api/signup", { employeeId: "4321", password: "nope", name: "신규사원" })).status, 401);
  assert.equal((await post("/api/signup", { employeeId: "4321", password: "outage", name: "신규사원" })).status, 503);
  assert.equal(get("SELECT * FROM registered_users WHERE employee_id='4321'"), undefined);

  const ok = await post("/api/signup", { employeeId: "4321", password: "right-pw", name: "  신규  사원 " });
  assert.equal(ok.status, 200);
  const user = get("SELECT * FROM registered_users WHERE employee_id='4321'");
  assert.equal(user.name, "신규 사원");
  assert.equal(user.active, 1);
  assert.equal(user.source, "signup");
  assert.equal(get("SELECT status FROM signup_requests WHERE employee_id='4321'").status, "approved");
  assert.ok(!JSON.stringify(all("SELECT * FROM registered_users")).includes("right-pw"));

  // 같은 사번은 다시 가입할 수 없다(남의 이름으로 덮어쓰기 방지).
  assert.equal((await post("/api/signup", { employeeId: "4321", password: "right-pw", name: "다른이름" })).status, 409);
  assert.equal(get("SELECT name FROM registered_users WHERE employee_id='4321'").name, "신규 사원");
  // 가입 뒤에는 로그인된다.
  assert.equal((await post("/api/borrower-auth/login", { employeeId: "4321", password: "right-pw" })).status, 200);
});

test("입력이 잘못되면 SM에 묻지 않고 거절한다", async () => {
  assert.equal((await post("/api/signup", { employeeId: "12", password: "right-pw", name: "이름" })).status, 400);
  assert.equal((await post("/api/signup", { employeeId: "5555", password: "", name: "이름" })).status, 400);
  assert.equal((await post("/api/signup", { employeeId: "5555", password: "right-pw", name: "가" })).status, 400);
});
