// 관리자 로그인 세션 토큰. 서버는 이 토큰으로만 관리자를 알아본다.
const TOKEN_KEY = "wms_admin_token";

export function getAdminToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAdminToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* 저장소 접근 불가 */ }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("wms_admin_id"); // 예전 방식의 흔적
  } catch { /* 저장소 접근 불가 */ }
}

export function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getAdminToken();
  return token ? { ...extra, "x-admin-token": token } : { ...extra };
}

/** 서버 세션을 끊고 브라우저의 토큰도 지운다. 네트워크가 안 돼도 토큰은 지운다. */
export async function logoutAdmin(): Promise<void> {
  const headers = adminHeaders();
  clearAdminToken();
  if (!headers["x-admin-token"]) return;
  try { await fetch("/api/admin/logout", { method: "POST", headers }); } catch { /* 세션은 30일 뒤 자동 만료 */ }
}
