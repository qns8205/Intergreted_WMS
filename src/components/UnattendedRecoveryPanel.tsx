import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { adminHeaders } from '../utils/adminAuth';

export default function UnattendedRecoveryPanel({onChanged}: {onChanged?:()=>void}) {
  const [items,setItems]=useState<any[]>([]), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const mounted=useRef(false), loading=useRef(false);
  const load=useCallback(async()=>{
    if (loading.current || document.hidden) return;
    loading.current=true;
    try{
      const response=await fetch('/api/unattended/operation-reviews',{headers:adminHeaders(),cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json(); if(!response.ok || data.success!==true)throw Error(data.error || '무인 처리 오류 조회 실패');
      if(mounted.current){setItems(data.items);setError('');}
    }catch(e:any){if(mounted.current)setError(e.message);}finally{loading.current=false;}
  },[]);
  useEffect(()=>{mounted.current=true;void load();const timer=setInterval(load,30000);window.addEventListener('focus',load);return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',load);};},[load]);
  async function close(item:any){
    const note=window.prompt('먼저 실물·사진을 확인하고, 필요한 대여 확인/반납을 기존 화면에서 처리해주세요.\n검토를 종료하면 남은 건에 자동 취소·페널티 판정이 재개됩니다. 조치 내용을 적어주세요.');
    if(!note?.trim())return;
    if(!window.confirm('검토를 종료할까요? 미처리 대여가 남아 있으면 원래 기한에 따라 자동 판정이 재개됩니다.'))return;
    setBusy(true);
    try{
      const response=await fetch(`/api/unattended/operation-reviews/${item.id}/close`,{method:'POST',headers:adminHeaders({'Content-Type':'application/json'}),body:JSON.stringify({note}),signal:AbortSignal.timeout(15000)});
      const data=await response.json();if(!response.ok||data.success!==true)throw Error(data.error || '검토 종료 실패');
      await load();onChanged?.();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  if(!items.length && !error)return null;
  const button:React.CSSProperties={display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,textDecoration:'none',border:'1px solid var(--panel-border,#94a3b8)',borderRadius:8,padding:'7px 10px',background:'var(--panel-bg)',color:'inherit',cursor:'pointer',fontWeight:700,fontSize:12};
  return <section aria-label="무인 사진 처리 오류 확인" style={{border:'1px solid #f59e0b',borderRadius:12,padding:14,marginBottom:14,background:'rgba(245,158,11,.08)'}}>
    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}><AlertTriangle size={18} style={{flexShrink:0,color:'#d97706'}}/><b style={{flex:1}}>무인 촬영 처리 확인 필요 {items.length}건</b><button style={button} onClick={()=>void load()} aria-label="무인 오류 새로고침"><RefreshCw size={13}/></button></div>
    <p style={{fontSize:12,lineHeight:1.7,color:'var(--text-dim)',margin:'10px 0 0'}}>완료된 대여·반납이 아닙니다. 검증된 사진이 기한 전에 도착한 기술 오류 건은 자동 판정을 보류합니다. 실물과 기록을 확인해 기존 대여 확인/반납 화면에서 처리한 뒤 검토를 종료해주세요.</p>
    {error && <p role="alert" style={{fontSize:12,color:'#dc2626'}}>{error}</p>}
    {items.map(item=><div key={item.id} style={{borderTop:'1px solid rgba(245,158,11,.3)',paddingTop:10,marginTop:10,fontSize:12,lineHeight:1.7}}>
      <strong>#{item.id} · {item.borrower_name} ({item.employee_id}) · {item.operation==='pickup'?'대여 확인':'반납'}</strong>
      <div>{item.received_at} · {item.items.map((line:any)=>`${line.itemName} × ${line.quantity}`).join(', ')}</div>
      <div style={{opacity:.8}}>{item.last_error || '처리 중이거나 서버 재시작 후 결과 확인이 필요합니다.'}</div>
      <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>{item.image_path?<a href={item.image_path} target="_blank" rel="noreferrer" style={button}>도착한 사진 보기</a>:<span>사진 수신 검증됨 · 파일 저장 실패</span>}{item.damage_image_path&&<a href={item.damage_image_path} target="_blank" rel="noreferrer" style={button}>파손 사진</a>}<button disabled={busy} style={button} onClick={()=>void close(item)}>조치 후 검토 종료</button></div>
    </div>)}
  </section>;
}
