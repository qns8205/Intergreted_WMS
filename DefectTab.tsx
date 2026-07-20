const STORAGE_KEY = "wms_integrated_script_url";

export function getSavedUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function saveUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // localStorage 접근 불가 환경이면 조용히 무시 (연동 자체는 세션 동안 동작)
  }
}

export function clearSavedUrl(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * doPost({action, payload}) 호출. Content-Type을 text/plain으로 지정해
 * 브라우저의 CORS 프리플라이트(OPTIONS)를 피한다 (GAS 웹앱의 표준 우회 패턴).
 */
export async function callGas(scriptUrl: string, action: string, payload: unknown = {}): Promise<any> {
  if (!scriptUrl) throw new Error("연동 URL이 설정되지 않았습니다.");
  let res: Response;
  try {
    res = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload }),
    });
  } catch (e: any) {
    throw new Error(
      "서버에 연결하지 못했습니다. 배포 URL이 '.../exec'로 끝나는지, 액세스 권한이 '모든 사용자'로 설정됐는지 확인해주세요."
    );
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (text.includes("Google Accounts") || text.includes("Sign in")) {
      throw new Error("웹앱 배포 시 액세스 권한을 '모든 사용자'로 설정해야 합니다.");
    }
    throw new Error("서버 응답을 해석할 수 없습니다 (JSON 아님). 배포 버전을 확인해주세요.");
  }
  if (!data.success) throw new Error(data.error || data.message || "요청이 실패했습니다.");
  return data;
}

/** doGet?action=getAll 호출 (GET, 인증 프롬프트 없이 조회) */
export async function fetchAll(scriptUrl: string): Promise<any> {
  if (!scriptUrl) throw new Error("연동 URL이 설정되지 않았습니다.");
  let res: Response;
  try {
    res = await fetch(`${scriptUrl}?action=getAll`);
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 배포 URL을 확인해주세요.");
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("서버 응답을 해석할 수 없습니다 (JSON 아님).");
  }
  if (!data.success) throw new Error(data.error || "조회에 실패했습니다.");
  return data;
}

/** 이미지 파일을 base64 data URL로 변환 (업로드용) */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}
