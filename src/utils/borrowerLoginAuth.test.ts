import test from "node:test";
import assert from "node:assert/strict";
import { createBorrowerLoginAuth } from "./borrowerLoginAuth.ts";

const person = (employeeId: string) => ({ employeeId, name: "테스트", affiliation: "cfgw" as const });
test("비밀번호 blur와 로그인 클릭은 진행 중 인증을 공유하고 성공 후 다시 인증하지 않는다", async () => {
  let finish!: () => void, calls = 0;
  const auth = createBorrowerLoginAuth(async (id) => { calls++; await new Promise<void>((resolve) => { finish = resolve; }); return person(id); }, async () => {});
  const blur = auth.authenticate("1234", "test-only");
  const click = auth.authenticate("1234", "test-only");
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await blur, person("1234"));
  assert.deepEqual(await click, person("1234"));
  assert.deepEqual(await auth.authenticate("1234", ""), person("1234"));
  assert.equal(calls, 1);
});
test("실패한 인증은 추천·로그인에 재사용하지 않고 재시도할 수 있다", async () => {
  let calls = 0;
  const auth = createBorrowerLoginAuth(async (id) => { if (++calls === 1) throw Error("wrong password"); return person(id); }, async () => {});
  await assert.rejects(auth.authenticate("1234", "wrong"));
  assert.deepEqual(await auth.authenticate("1234", "correct"), person("1234"));
  assert.equal(calls, 2);
});
test("사번·비밀번호 변경은 이전 인증을 폐기하며 로그아웃이 끝난 후 새 인증을 시작한다", async () => {
  const events: string[] = [];
  const auth = createBorrowerLoginAuth(async (id) => { events.push(`login:${id}`); return person(id); }, async () => { events.push("logout"); });
  await auth.authenticate("1234", "first");
  void auth.invalidate();
  await auth.authenticate("5678", "second");
  assert.deepEqual(events, ["login:1234", "logout", "login:5678"]);
});
test("변경 전 늦게 도착한 응답은 버리고 해당 세션을 폐기한다", async () => {
  let finish!: () => void, logouts = 0;
  const auth = createBorrowerLoginAuth(async (id) => { await new Promise<void>((resolve) => { finish = resolve; }); return person(id); }, async () => { logouts++; });
  const pending = auth.authenticate("1234", "test-only");
  await Promise.resolve();
  const stale = assert.rejects(pending, /로그인 정보가 변경/);
  const reset = auth.invalidate();
  finish();
  await stale;
  await reset;
  assert.equal(logouts, 1);
});
