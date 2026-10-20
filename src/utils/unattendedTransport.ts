export class KioskRequestError extends Error {
  status: number; relogin: boolean; uncertain: boolean;
  constructor(message: string, status = 0, relogin = false, uncertain = false) {
    super(message); this.status=status; this.relogin=relogin; this.uncertain=uncertain;
  }
}
export async function kioskRequest(path: string, body: unknown, credentials: {device: string; session: string}, timeoutMs = 45000, fetcher: typeof fetch = fetch) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetcher(`/api/unattended/${path}`,{method:body ? 'POST' : 'GET',
      headers:{'Content-Type':'application/json','x-unattended-device':credentials.device,...(credentials.session ? {'x-unattended-session':credentials.session} : {})},
      body:body ? JSON.stringify(body) : undefined,cache:'no-store',signal:controller.signal});
    let data: any;
    try { data=await response.json(); } catch { throw new KioskRequestError('서버의 완료 응답을 확인하지 못했습니다. 촬영본을 유지하고 다시 확인해주세요.',response.status,false,true); }
    if (!response.ok || data?.success!==true) throw new KioskRequestError(data?.error || '서버에서 처리 완료를 확인하지 못했습니다.',response.status,!!data?.relogin,response.ok || response.status>=500);
    return data;
  } catch(error: any) {
    if (error instanceof KioskRequestError) throw error;
    throw new KioskRequestError(error?.name==='AbortError' ? '응답 시간이 초과되었습니다. 촬영본은 유지됩니다. 처리 결과를 다시 확인해주세요.' : '연결이 끊겼습니다. 촬영본은 유지됩니다. 연결 후 다시 확인해주세요.',0,false,true);
  } finally { clearTimeout(timer); }
}

export function assertPhotoReceipt(data: any, request: {clientId: string; kind: 'pickup'|'return'}) {
  if (data?.success!==true || data.completed!==true || data.photoSaved!==true || !Number.isSafeInteger(data.operationId) || data.operationId<=0
    || data.clientId!==request.clientId || data.operation!==request.kind
    || (request.kind==='return' && (!Number.isSafeInteger(data.batchId) || data.batchId<=0 || typeof data.lookupPath!=='string' || !data.lookupPath.startsWith('/pickup/')))) {
    throw new KioskRequestError('사진 저장과 장부 처리 완료를 확인하지 못했습니다. 같은 촬영 건으로 다시 확인해주세요.',0,false,true);
  }
  return data;
}
