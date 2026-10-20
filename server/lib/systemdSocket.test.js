import test from "node:test";
import assert from "node:assert/strict";
import { consumeHttpsSocket } from "./systemdSocket.js";

test("일반 실행 및 다른 프로세스의 소켓은 사용하지 않는다", () => {
  assert.equal(consumeHttpsSocket({}, 100), null);
  assert.equal(consumeHttpsSocket({ LISTEN_PID: "200", LISTEN_FDS: "1", LISTEN_FDNAMES: "wms-https" }, 100), null);
});
test("명명된 HTTPS 소켓을 선택하고 자식 프로세스로 전달할 환경 변수를 제거한다", () => {
  const env = { LISTEN_PID: "100", LISTEN_FDS: "2", LISTEN_FDNAMES: "other:wms-https", OTHER: "keep" };
  assert.equal(consumeHttpsSocket(env, 100), 4);
  assert.deepEqual(env, { OTHER: "keep" });
  assert.equal(consumeHttpsSocket({ LISTEN_PID:"100", LISTEN_FDS:"1", LISTEN_FDNAMES:"wms-https" }, 100), 3);
});
test("잘못된 개수 및 누락·중복 소켓은 거부한다", () => {
  for (const [count, names] of [["0", ""], ["1.5", "wms-https"], ["65", "wms-https"], ["1", "other"], ["2", "wms-https"], ["2", "wms-https:wms-https"]]) {
    assert.throws(() => consumeHttpsSocket({ LISTEN_PID:"100", LISTEN_FDS:count, LISTEN_FDNAMES:names }, 100));
  }
});
