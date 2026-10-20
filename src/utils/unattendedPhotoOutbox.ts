export type PendingKioskPhoto = {
  clientId: string; employeeId: string; kind: 'pickup'|'return'; capturedAt: string;
  labels: string[]; body: {clientId: string; items: any[]; photo: string; damagePhoto?: string};
};
const DB_NAME='wms-kiosk-photo-outbox-v1', STORE='pending';
const memoryPending=new Map<string,PendingKioskPhoto>();
const unpersisted=new Set<string>();
export const unpersistedKioskPhotoCount=()=>unpersisted.size;
export function memoryPendingKioskPhotos(employeeId:string) {
  return [...memoryPending.values()].filter(row=>row.employeeId===employeeId).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>{settled=true;reject(Error('사진 임시 보관함 응답이 지연됩니다. 현재 창을 유지해주세요.'));},5000);
    const request=indexedDB.open(DB_NAME,2);
    request.onupgradeneeded=()=>{
      const store=request.result.objectStoreNames.contains(STORE) ? request.transaction!.objectStore(STORE) : request.result.createObjectStore(STORE,{keyPath:'clientId'});
      if(!store.indexNames.contains('employeeId'))store.createIndex('employeeId','employeeId',{unique:false});
    };
    request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}settled=true;resolve(request.result);};
    request.onerror=()=>{clearTimeout(timer);settled=true;reject(request.error || Error('사진 임시 보관함을 열지 못했습니다.'));};
    request.onblocked=()=>{clearTimeout(timer);settled=true;reject(Error('사진 임시 보관함이 사용 중입니다.'));};
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore)=>IDBRequest<T>): Promise<T> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode), request=action(tx.objectStore(STORE));
    const timer=setTimeout(()=>{try{tx.abort();}catch{}db.close();reject(Error('사진 임시 저장 응답이 지연됩니다. 현재 창을 유지해주세요.'));},10000);
    tx.oncomplete=()=>{clearTimeout(timer);db.close();resolve(request.result);};
    tx.onerror=tx.onabort=()=>{clearTimeout(timer);db.close();reject(tx.error || Error('사진 임시 보관에 실패했습니다.'));};
  });
}
/** 공용 PC이므로 본인 로그인 후에만 해당 사번의 사진을 복구한다. 비밀번호·로그인 표는 저장하지 않는다. */
export async function loadPendingKioskPhotos(employeeId: string): Promise<PendingKioskPhoto[]> {
  const stored=(await transact('readonly',store=>store.index('employeeId').getAll(employeeId))) as PendingKioskPhoto[];
  return [...new Map([...stored,...memoryPendingKioskPhotos(employeeId)].map(row=>[row.clientId,row])).values()]
    .filter(row=>row.employeeId===employeeId).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
}
export async function savePendingKioskPhoto(photo: PendingKioskPhoto) {
  memoryPending.set(photo.clientId,structuredClone(photo));
  unpersisted.add(photo.clientId);
  await transact('readwrite',store=>store.put(photo));
  unpersisted.delete(photo.clientId);
}
export async function removePendingKioskPhoto(clientId: string) {
  // 서버 완료/관리자 검토를 확인한 뒤에만 호출한다. 디스크 정리 실패가 완료 건을 다시 잠그지 않게 한다.
  memoryPending.delete(clientId);
  unpersisted.delete(clientId);
  await transact('readwrite',store=>store.delete(clientId));
}
