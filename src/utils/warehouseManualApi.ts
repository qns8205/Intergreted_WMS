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
async function request(path: string, body?: unknown, admin = false) {
  if (body && (import.meta as any).env?.MODE === "remote-readonly") throw Error("읽기 전용 미리보기에서는 신청할 수 없습니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), body ? 45000 : 20000);
  try {
    const headers = { "Content-Type": "application/json" };
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
export interface ToolSearchCandidate { id: number; name: string; image: string; stock: number | null; consumable: boolean }
export interface ToolSearchResult { items: ToolSearchCandidate[]; mode: "ai" | "keywords"; message: string }
export async function searchTools(employeeId: string, query: string, signal: AbortSignal): Promise<ToolSearchResult> {
  const response = await fetch(`/api/warehouse-requests/search?employeeId=${encodeURIComponent(employeeId)}&q=${encodeURIComponent(query)}`, { signal });
  const data = await response.json().catch(() => { throw Error("검색 서버에 연결하지 못했습니다. 직접 입력으로 신청하거나 잠시 후 다시 검색해주세요."); });
  if (!response.ok || !data.success) throw Error(data.error || "AI 검색을 완료하지 못했습니다. 직접 입력으로 신청해주세요.");
  return data;
}
export interface ToolSuggestion extends ToolSearchCandidate { location: string }
/** 이름을 적는 동안 띄우는 후보(AI 없음). 실패하면 빈 목록으로 두고 직접 입력을 막지 않는다. */
export async function suggestTools(employeeId: string, query: string, signal: AbortSignal): Promise<ToolSuggestion[]> {
  const response = await fetch(`/api/warehouse-requests/suggest?employeeId=${encodeURIComponent(employeeId)}&q=${encodeURIComponent(query)}`, { signal, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.success && Array.isArray(data.items) ? data.items : [];
}
export const fetchPendingToolRequests =async (): Promise<PendingToolRequest[]> => (await request("", undefined, true)).items;
export const resolveToolRequest = (id: number, itemId: number) => request(`/${id}/resolve`, { itemId }, true);
export interface BorrowedTool { key: string; name: string; qty: number; image: string; borrowedAt: string; pending: boolean }
export const fetchMyTools = async (employeeId: string): Promise<BorrowedTool[]> => (await request(`/mine?employeeId=${encodeURIComponent(employeeId)}`)).items;
export const returnTools = (body: { clientId: string; employeeId: string; items: { key: string; qty: number }[]; photo: string }): Promise<{ returnId: number; items: { name: string; qty: number; pending: boolean }[] }> => request("/return", body);
