import test from "node:test";
import assert from "node:assert/strict";
import { verifySmLogin } from "./smLogin.js";

test("SM 쿠키 발급만으로 통과하지 않고 인증된 홈페이지까지 확인한다", async () => {
  for (const status of [200, 401, 403]) {
    const result = await verifySmLogin('1234','fake', { fetchImpl: async () => new Response('<input name="password">', { status, headers: { 'set-cookie':'session=invalid' } }) });
    assert.equal(result.ok, false);
  }
  let count = 0;
  const valid = await verifySmLogin('1234','fake', { fetchImpl: async (_url, init) => {
    if (++count === 1) { assert.equal(new URLSearchParams(init.body).get('username'), '1234'); return new Response(null,{status:302,headers:{'set-cookie':'session=valid','location':'/'}}); }
    assert.equal(init.headers.Cookie, 'session=valid');
    return new Response('<main>authenticated home</main>');
  } });
  assert.equal(valid.ok, true);
  for (const final of [new Response(null,{status:302,headers:{location:'/login'}}), new Response('<input name="password">')]) {
    let calls=0;
    assert.equal((await verifySmLogin('1234','fake',{fetchImpl:async () => ++calls===1 ? new Response(null,{status:302,headers:{'set-cookie':'session=invalid',location:'/'}}) : final})).ok,false);
  }
});
test("SM 장애·외부 리다이렉트·타임아웃은 로그인 실패로 처리한다", async () => {
  assert.deepEqual(await verifySmLogin('1234','fake',{fetchImpl:async () => new Response(null,{status:503})}), {ok:false,unavailable:true});
  assert.deepEqual(await verifySmLogin('1234','fake',{fetchImpl:async () => {throw Error('timeout');}}), {ok:false,unavailable:true});
  assert.equal((await verifySmLogin('1234','fake',{fetchImpl:async () => new Response(null,{status:302,headers:{'set-cookie':'session=bad',location:'https://other.invalid/'}})})).ok,false);
});
