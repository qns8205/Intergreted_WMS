import { adminHeaders } from "./adminAuth";
export { filterScenarioAiResults } from "./scenarioAiResults";
export interface ScenarioAiResult { items: { id: string }[]; mode: "ai" | "keywords"; message: string }
export async function searchScenarioAi(employeeId: string, query: string, filters: { category: string; subcategory: string; request: "all" | "normal" }, signal: AbortSignal): Promise<ScenarioAiResult> {
  const params = new URLSearchParams({ employeeId, q: query, ...filters });
  const response = await fetch(`/api/scenario-search?${params}`, { headers: adminHeaders(), signal });
  const data = await response.json().catch(() => { throw Error("AI 검색 서버에 연결하지 못했습니다. 일반 검색은 계속 사용할 수 있습니다."); });
  if (!response.ok || !data.success) throw Error(data.error || "AI 검색에 실패했습니다. 일반 검색으로 찾아주세요.");
  return data;
}
