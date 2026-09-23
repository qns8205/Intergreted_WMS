import React, { useEffect, useState } from "react";
import { MonitorCheck, Power } from "lucide-react";

const TOKEN_KEY = "wms_unattended_device";
function adminHeaders() {
  return { "Content-Type": "application/json", "x-admin-id": localStorage.getItem("wms_admin_id") || "" };
}

export default function UnattendedModeSettings({ onOpen, showToast, onModeChanged }: { onOpen: () => void; showToast: (m: string, t?: "info" | "ok" | "warn" | "error") => void; onModeChanged?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<any[]>([]);
  const refresh = async () => {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const r = await fetch("/api/unattended/status", { headers: { "x-unattended-device": token }, cache: "no-store" });
    const d = await r.json(); setEnabled(!!d.enabled); setRegistered(!!d.deviceRegistered);
  };
  const refreshPending = () => fetch("/api/unattended/damage-pending", { headers: adminHeaders(), cache:"no-store" }).then(r=>r.json()).then(d=>setPending(d.items||[])).catch(()=>{});
  useEffect(() => { refresh().catch(() => {}); refreshPending(); }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/unattended/mode", { method: "PUT", headers: adminHeaders(), body: JSON.stringify({ enabled: !enabled }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error); setEnabled(!!d.enabled);
      showToast(d.enabled ? "무인 모드를 켰습니다." : "무인 모드를 껐습니다.", "ok");
      // 이 토글은 이 패널만의 상태다 — 앱 전체(열람 화면 위치 숨김 등)가 쓰는 상태는
      // 따로 있으므로, 바뀐 걸 알려줘야 새로고침 없이도 즉시 반영된다.
      onModeChanged?.();
    } catch (e: any) { showToast(e.message || "설정에 실패했습니다.", "error"); } finally { setBusy(false); }
  };
  const register = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/unattended/device/register", { method: "POST", headers: adminHeaders() });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      localStorage.setItem(TOKEN_KEY, d.token); setRegistered(true); showToast("이 PC를 무인 반납 PC로 등록했습니다.", "ok");
    } catch (e: any) { showToast(e.message || "PC 등록에 실패했습니다.", "error"); } finally { setBusy(false); }
  };
  const resolveDamage = async (id:number, action:"confirm"|"reject") => {
    setBusy(true);
    try { const r=await fetch(`/api/unattended/damage-pending/${id}/resolve`,{method:"POST",headers:adminHeaders(),body:JSON.stringify({action})}); const d=await r.json(); if(!r.ok)throw new Error(d.error); await refreshPending(); showToast(action==="confirm"?"파손을 확인하고 불량 로그에 기록했습니다.":"파손 판정을 취소하고 대여 상태로 복구했습니다.","ok"); }
    catch(e:any){showToast(e.message||"처리에 실패했습니다.","error");} finally{setBusy(false);}
  };
  return <div style={{ background: "var(--panel-bg,#151d30)", border: "1px solid var(--panel-border,#26324a)", borderRadius: 14, padding: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15 }}><MonitorCheck size={18}/> 무인 모드</div>
    <p style={{ fontSize: 12, color: "var(--text-dim,#94a3b8)", lineHeight: 1.65 }}>등록된 관리자 PC에서 사번으로 대여·반납 물품을 조회하고, 사진·파손 여부·위치 확인 QR까지 처리합니다. 개인 PC에서는 무인 반납 API가 거부됩니다.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button disabled={busy} onClick={toggle} style={{ border: 0, borderRadius: 9, padding: "9px 14px", fontWeight: 800, cursor: "pointer", background: enabled ? "#dc2626" : "#2563eb", color: "#fff" }}><Power size={14} style={{ verticalAlign: -2, marginRight: 6 }}/>{enabled ? "무인 모드 끄기" : "무인 모드 켜기"}</button>
      <button disabled={busy} onClick={register} style={{ border: "1px solid #2563eb", borderRadius: 9, padding: "9px 14px", fontWeight: 800, cursor: "pointer", background: "transparent", color: "#2563eb" }}>{registered ? "이 PC 재등록" : "이 PC 등록"}</button>
      {enabled && registered ? <button onClick={onOpen} style={{ border: 0, borderRadius: 9, padding: "9px 14px", fontWeight: 800, cursor: "pointer", background: "#059669", color: "#fff" }}>무인 화면 열기 →</button> : null}
    </div>
    {pending.length ? <div style={{marginTop:16,borderTop:"1px solid var(--panel-border,#334155)",paddingTop:14}}><div style={{fontWeight:850,marginBottom:8,color:"#dc2626"}}>파손 확인 대기 {pending.length}건</div>{pending.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",fontSize:12}}><span style={{flex:1}}><b>{p.item_name}</b> × {p.qty}<br/><span style={{opacity:.7}}>{p.created_at}</span></span>{p.image_path?<a href={p.image_path} target="_blank" rel="noreferrer" style={{color:"#2563eb"}}>사진</a>:null}<button disabled={busy} onClick={()=>resolveDamage(p.id,"reject")} style={{border:"1px solid #64748b",background:"transparent",color:"inherit",borderRadius:7,padding:"6px 8px",cursor:"pointer"}}>오신고</button><button disabled={busy} onClick={()=>resolveDamage(p.id,"confirm")} style={{border:0,background:"#dc2626",color:"#fff",borderRadius:7,padding:"6px 8px",cursor:"pointer"}}>파손 확인</button></div>)}</div>:null}
  </div>;
}
