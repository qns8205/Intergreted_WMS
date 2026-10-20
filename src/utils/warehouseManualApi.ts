import { adminHeaders } from "./adminAuth";

export interface ToolRequestReceipt {
  requestId: number;
  processed: number;
  pending: number;
  items: { name: string; qty: number; status: string; reason: string | null; type?: string }[];
}
export interface PendingToolRequest {
  id: number; request_id: number; entered_name: string; qty: number; reason: string;
  employee_id: string; borrower_name: string; floor: string; occurred_at: string; image_path: string;
}
// 무인 PC에서 사번·SM 비밀번호로 로그인한 동안의 표. 있으면 공구 요청에 무인 PC 표시와 함께 붙인다.
// 서버는 이 표의 사번으로만 처리한다(휴대폰은 SM 대여자 로그인 쿠키를 쓴다).
let kioskSession = "";
export function setKioskSession(token: string) { kioskSession = token; }
function kioskHeaders(): Record<string, string> {
  if (!kioskSession) return {};
  let device = "";
  try { device = localStorage.getItem("wms_unattended_device") || ""; } catch { /* 저장소 접근 불가 */ }
  return { "x-unattended-device": device, "x-unattended-session": kioskSession };
}
async function request(path: string, body?: unknown, admin = false) {
  if (body && (import.meta as any).env?.MODE === "remote-readonly") throw Error("읽기 전용 미리보기에서는 신청할 수 없습니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), body ? 45000 : 20000);
  try {
    const headers = { "Content-Type": "application/json", ...(admin ? {} : kioskHeaders()) };
    const response = await fetch(`/api/warehouse-requests${path}`, {
      method: body ? "POST" : "GET", headers: admin ? adminHeaders(headers) : headers,
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      const error = Object.assign(Error(data.error || "공구 신청을 처리하지 못했습니다."), { status: response.status });
      throw error;
    }
    return data;
  } catch (error: any) {
    if (error.name === "AbortError") throw Error("응답이 늦어지고 있습니다. 다시 신청해도 같은 신청은 중복 처리되지 않습니다.");
    throw error;
  } finally { clearTimeout(timeout); }
}
export const submitToolRequest = (body: { clientId: string; employeeId: string; floor: string; items: { name: string; qty: number; itemId?: number }[]; photo: string }): Promise<ToolRequestReceipt> => request("", body);
export interface ToolSuggestion { id: number; name: string; image: string; stock: number | null; consumable: boolean }
/** 이름을 적는 동안 띄우는 후보(AI 없음). 실패하면 빈 목록으로 두고 직접 입력을 막지 않는다. */
export async function suggestTools(employeeId: string, query: string, signal: AbortSignal): Promise<ToolSuggestion[]> {
  const response = await fetch(`/api/warehouse-requests/suggest?employeeId=${encodeURIComponent(employeeId)}&q=${encodeURIComponent(query)}`, { signal, cache: "no-store", headers: kioskHeaders() });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.success && Array.isArray(data.items) ? data.items : [];
}
export const fetchPendingToolRequests =async (): Promise<PendingToolRequest[]> => (await request("", undefined, true)).items;
export const resolveToolRequest = (id: number, itemId: number) => request(`/${id}/resolve`, { itemId }, true);
export interface BorrowedTool { key: string; name: string; qty: number; image: string; borrowedAt: string; pending: boolean }
export const fetchMyTools = async (employeeId: string): Promise<BorrowedTool[]> => (await request(`/mine?employeeId=${encodeURIComponent(employeeId)}`)).items;
export const returnTools = (body: { clientId: string; employeeId: string; items: { key: string; qty: number }[]; photo: string }): Promise<{ returnId: number; items: { name: string; qty: number; pending: boolean }[] }> => request("/return", body);
