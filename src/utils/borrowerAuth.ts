export interface SmBorrower { name: string; employeeId: string; affiliation: "cfgw" }
export interface BorrowerAuthConfig { required: boolean; httpsOrigin: string; qrOrigin: string }
export async function borrowerAuthConfig(): Promise<BorrowerAuthConfig> {
  const response = await fetch("/api/borrower-auth/config", { cache: "no-store" });
  if (!response.ok) throw Error("인증 설정을 불러올 수 없습니다.");
  return response.json();
}
export async function loginBorrower(employeeId: string, password: string): Promise<SmBorrower> {
  if (!window.isSecureContext || location.protocol !== "https:") throw Error("HTTPS 주소에서 로그인해주세요.");
  const response = await fetch("/api/borrower-auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId, password }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  // unregistered: SM 비밀번호는 맞았지만 WMS 명부에 없는 신규 사원 — 화면이 가입하기를 안내한다.
  if (!response.ok || !data.success) throw Object.assign(Error(data.error || "SM 인증에 실패했습니다."), { unregistered: !!data.unregistered });
  return data.user;
}
/** 신규 사원 가입. 사번·SM 비밀번호가 SM에 로그인되면 바로 등록된다(비밀번호는 저장하지 않는다). */
export async function signupWithSm(employeeId: string, password: string, name: string): Promise<{ employeeId: string; name: string }> {
  if (!window.isSecureContext || location.protocol !== "https:") throw Error("HTTPS 주소에서 가입해주세요.");
  const response = await fetch("/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId, password, name }), signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw Error(data.error || "가입하지 못했습니다.");
  return { employeeId: data.employeeId, name: data.name };
}
export async function borrowerAuthSession(): Promise<{ required: boolean; user: SmBorrower | null }> {
  const response = await fetch("/api/borrower-auth/session", { cache: "no-store" });
  if (!response.ok) throw Error("로그인 상태를 확인할 수 없습니다.");
  return response.json();
}
export async function logoutBorrower(): Promise<void> {
  await fetch("/api/borrower-auth/logout", { method: "POST" }).catch(() => {});
}
export function qrLookupUrl(path: string): string {
  const port = location.protocol === "https:" ? "3445" : "3002";
  return `${location.protocol}//${location.hostname}:${port}${path}`;
}
