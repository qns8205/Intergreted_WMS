import React, { useEffect, useState } from "react";
import { MonitorCheck, Power } from "lucide-react";
import { adminHeaders as tokenHeaders } from "../utils/adminAuth";

const TOKEN_KEY = "wms_unattended_device";
function adminHeaders() {
  return tokenHeaders({ "Content-Type": "application/json" });
}

export default function UnattendedModeSettings({ onOpen, showToast, onModeChanged }: { onOpen: () => void; showToast: (m: string, t?: "info" | "ok" | "warn" | "error") => void; onModeChanged?: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<any[]>([]);
  const [damageExemptions, setDamageExemptions] = useState<Record<number,{exempt:boolean;reason:string}>>({});
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
      // 이 토글은 이 패널만의 상태다 — 앱 전체(열람 화면 위치 숨김 등)가 쓰는 상태는
      // 따로 있으므로, 바뀐 걸 알려줘야 새로고침 없이도 즉시 반영된다.
      onModeChanged?.();
      if (!d.enabled) { showToast("무인 모드를 껐습니다.", "ok"); return; }
      // 켜는 PC가 등록된 무인 PC면 바로 무인 화면으로 넘어간다. 등록 안 된 PC에서는
      // 무인 API가 거부되므로 화면을 열지 않는다(자동 등록은 기존 무인 PC 등록을 끊으므로 하지 않는다).
      if (registered) { showToast("무인 모드를 켰습니다. 무인 화면으로 전환합니다.", "ok"); onOpen(); }
      else showToast("무인 모드를 켰습니다. 이 PC는 무인 PC로 등록되지 않아 무인 화면을 열 수 없습니다.", "warn");
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
    try { const r=await fetch(`/api/unattended/damage-pending/${id}/resolve`,{method:"POST",headers:adminHeaders(),body:JSON.stringify({action,penaltyExempt:damageExemptions[id]?.exempt || false,exemptionReason:damageExemptions[id]?.reason || ''})}); const d=await r.json(); if(!r.ok)throw new Error(d.error); await refreshPending(); if(action==="confirm")window.dispatchEvent(new Event("wms-notifications-changed")); showToast(action==="confirm"?"파손을 확인했습니다. 사전 미신고 수량은 면제하지 않으면 5종 차감 14일이 적용됩니다.":"파손 판정을 취소하고 대여 상태로 복구했습니다.","ok"); }
    catch(e:any){showToast(e.message||"처리에 실패했습니다.","error");} finally{setBusy(false);}
  };
  return <div style={{ background: "var(--panel-bg,#151d30)", border: "1px solid var(--panel-border,#26324a)", borderRadius: 14, padding: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15 }}><MonitorCheck size={18}/> 무인 모드</div>
    <p style={{ fontSize: 12, color: "var(--text-dim,#94a3b8)", lineHeight: 1.65, margin: "8px 0 14px" }}>등록된 관리자 PC에서 사번으로 대여·반납 물품을 조회하고, 사진·파손 여부·위치 확인 QR까지 처리합니다. 개인 PC에서는 무인 반납 API가 거부됩니다.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button disabled={busy} onClick={toggle} style={{ border: 0, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", background: enabled ? "#dc2626" : "#2563eb", color: "#fff" }}><Power size={14} style={{ verticalAlign: -2, marginRight: 6 }}/>{enabled ? "무인 모드 끄기" : "무인 모드 켜기"}</button>
      <button disabled={busy} onClick={register} style={{ border: "1px solid #2563eb", borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", background: "transparent", color: "#2563eb" }}>{registered ? "이 PC 재등록" : "이 PC 등록"}</button>
      {enabled && registered ? <button onClick={onOpen} style={{ border: 0, borderRadius: 9, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", background: "#059669", color: "#fff" }}>무인 화면 열기 →</button> : null}
    </div>
    {pending.length ? <section aria-label="무인 파손 확인 대기" style={{ marginTop: 18, borderTop: '1px solid var(--panel-border,#334155)', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, marginBottom: 8 }}>파손 확인 대기<span style={{ padding: '2px 7px', borderRadius: 999, background: 'rgba(220,38,38,.1)', color: '#dc2626', fontSize: 11 }}>{pending.length}건</span></div>
      <p style={{ fontSize: 12, color: 'var(--text-dim,#94a3b8)', lineHeight: 1.7, margin: '0 0 12px' }}>사전 미신고 파손은 대여 건당 5종 차감이 14일간 적용됩니다. 페널티를 면제하려면 사유를 남겨주세요.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{pending.map(p => <article key={p.id} style={{ border: '1px solid var(--panel-border,#334155)', borderRadius: 10, padding: 12, background: 'var(--input-bg,#0f172a)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}><strong style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: 'anywhere' }}>{p.item_name}</strong><span style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{p.qty}개</span></div>
        <div style={{ color: 'var(--text-dim,#94a3b8)', fontSize: 11, marginBottom: 12 }}>{p.created_at}</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.6, cursor: 'pointer' }}><input type="checkbox" checked={damageExemptions[p.id]?.exempt || false} onChange={e=>setDamageExemptions(prev=>({...prev,[p.id]:{exempt:e.target.checked,reason:prev[p.id]?.reason || ''}}))} style={{ width: 16, height: 16, flexShrink: 0, margin: '2px 0 0', accentColor: '#2563eb' }}/><span>이 물품의 자동 페널티 면제</span></label>
        {damageExemptions[p.id]?.exempt && <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginTop: 10 }}>면제 사유 <span style={{ color: '#dc2626' }}>(필수)</span><input maxLength={500} placeholder="예: 반복 사용에 따른 정상 마모" value={damageExemptions[p.id]?.reason || ''} onChange={e=>setDamageExemptions(prev=>({...prev,[p.id]:{exempt:true,reason:e.target.value}}))} style={{ display: 'block', width: '100%', padding: '9px 10px', marginTop: 6, background: 'var(--panel-bg)', color: 'inherit', border: '1px solid var(--panel-border)', borderRadius: 8, fontSize: 12, fontWeight: 400 }}/></label>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12, borderTop: '1px solid var(--panel-border)', paddingTop: 12 }}>
          {p.image_path && <a href={p.image_path} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent,#2563eb)', marginRight: 'auto', fontWeight: 700 }}>접수 사진 보기 ↗</a>}
          <button disabled={busy} onClick={()=>resolveDamage(p.id,'reject')} style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)', color: 'inherit', borderRadius: 8, padding: '8px 11px', fontSize: 12, cursor: 'pointer' }}>오신고</button>
          <button disabled={busy} onClick={()=>resolveDamage(p.id,'confirm')} style={{ border: 0, background: '#dc2626', color: '#fff', borderRadius: 8, padding: '8px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>파손 확인</button>
        </div>
      </article>)}</div>
    </section> : null}
  </div>;
}
