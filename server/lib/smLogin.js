// 사용자 비밀번호와 SM 세션은 인증 요청 중에만 사용한다. 저장하거나 동기화 계정으로 재사용하지 않는다.
export async function verifySmLogin(loginId, password, { origin = process.env.SM_URL || "http://100.92.161.29", fetchImpl = fetch } = {}) {
  try {
    const signal = AbortSignal.timeout(15000);
    const response = await fetchImpl(`${origin}/login`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Host: "scenario-manager" },
      body: new URLSearchParams({ username: loginId, password }).toString(), redirect: "manual", signal,
    });
    if (response.status >= 500 || response.status === 429) return { ok: false, unavailable: true };
    // 실패 페이지에서 새 쿠키를 발급할 수도 있으므로 Set-Cookie만으로 통과시키지 않는다.
    if (![302, 303].includes(response.status)) return { ok: false };
    const location = new URL(response.headers.get("location") || "/login", origin);
    if (location.origin !== new URL(origin).origin || /\/login\/?$/.test(location.pathname)) return { ok: false };
    const cookie = (response.headers.getSetCookie?.() || []).map((value) => value.split(";")[0]).join("; ");
    if (!cookie) return { ok: false };
    const verified = await fetchImpl(`${origin}/`, {
      headers: { Cookie: cookie, Host: "scenario-manager" }, redirect: "manual", signal,
    });
    if (verified.status >= 500 || verified.status === 429) return { ok: false, unavailable: true };
    if (verified.status !== 200) return { ok: false };
    const html = await verified.text();
    if (/<input\b[^>]*name=["']password["']/i.test(html)) return { ok: false };
    return { ok: true };
  } catch { return { ok: false, unavailable: true }; }
}
