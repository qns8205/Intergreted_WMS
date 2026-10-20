import React, { useId } from "react";

export default function RequestRentalFields({ C, mode, reason, disabled = false, showTitle = true, onMode, onReason }: {
  C: any; mode: "request" | "general" | null; reason: string; disabled?: boolean; showTitle?: boolean;
  onMode: (mode: "request" | "general") => void; onReason: (reason: string) => void;
}) {
  const groupId = useId();
  return <fieldset aria-label="Request 물품 대여 방식 선택" disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}>
    {showTitle ? <legend style={{fontSize:15,fontWeight:800,marginBottom:12}}>Request 물품 대여 방식 선택</legend> : null}
    {(["request", "general"] as const).map(value => <label key={value} style={{display:"block",padding:12,marginBottom:8,border:`1px solid ${C.border}`,borderRadius:10,cursor:disabled ? "default" : "pointer"}}>
      <input type="radio" name={`request-rental-${groupId}`} checked={mode===value} onChange={()=>onMode(value)} /> {value==="request" ? "Request 대여" : "일반 대여"}
      <div style={{fontSize:12,color:C.label,marginTop:6}}>{value==="request" ? "request 물품은 자동으로 한도에서 제외됩니다. 아래에 사유를 필수로 작성해주세요." : "기존 대여 한도를 적용합니다."}</div>
    </label>)}
    {mode==="request" ? <label style={{display:"block",marginTop:14,fontSize:13}}>Request 대여 사유 (필수)
      <textarea required value={reason} onChange={event=>onReason(event.target.value)} placeholder="Request 대여 사유를 입력해주세요" rows={4}
        style={{display:"block",width:"100%",boxSizing:"border-box",marginTop:8,padding:10,borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,resize:"vertical"}} />
    </label> : null}
  </fieldset>;
}
