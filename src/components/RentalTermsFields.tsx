import { useId } from 'react';
import { Clock, FileText, CalendarDays } from 'lucide-react';
export type RentalMode = 'general' | 'reason' | 'long_term';
export type RentalTerms = {mode:RentalMode;reason:string;dueDate:string};
const OPTIONS = [
  {value:'general',title:'일반 대여',tag:'4시간 내 반납',Icon:Clock,description:'사유 없이 대여합니다. 수령 확인 후 4시간 내 반드시 반납해야 합니다. (점심시간 12:00~13:00은 시간에서 제외)'},
  {value:'reason',title:'사유 대여',tag:'시간 제한 없음',Icon:FileText,description:'사유를 입력하면 4시간 반납 제한에서 면제됩니다.'},
  {value:'long_term',title:'장기대여',tag:'날짜 지정',Icon:CalendarDays,description:'사유와 반납 예정일을 입력합니다. 선택한 날짜까지 반납해주세요.'},
] as const;
export default function RentalTermsFields({C,mode,reason,dueDate,onMode,onReason,onDueDate,disabled=false}: {
  C:any;mode:RentalMode|null;reason:string;dueDate:string;onMode:(mode:RentalMode)=>void;onReason:(value:string)=>void;onDueDate:(value:string)=>void;disabled?:boolean;
}) {
  const id=useId();
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const soft=C.accentSoft || 'rgba(37,99,235,0.09)';
  const input={width:'100%',boxSizing:'border-box' as const,marginTop:6,padding:'10px 12px',borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:14,fontFamily:'inherit'};
  const fieldLabel={display:'block',marginTop:14,fontSize:12.5,fontWeight:700,color:C.label};
  return <fieldset disabled={disabled} aria-label="대여 방식 선택" style={{margin:0,padding:0,border:0,minWidth:0}}>
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {OPTIONS.map(({value,title,tag,Icon,description})=>{
        const on=mode===value;
        return <label key={value} style={{position:'relative',display:'flex',alignItems:'flex-start',gap:12,padding:'12px 14px',border:`1.5px solid ${on ? C.accent : C.border}`,borderRadius:12,background:on ? soft : 'transparent',cursor:disabled ? 'default' : 'pointer',transition:'border-color .15s, background .15s'}}>
          <input type="radio" name={`rental-mode-${id}`} checked={on} onChange={()=>onMode(value)} style={{position:'absolute',opacity:0,pointerEvents:'none'}}/>
          <span aria-hidden style={{flexShrink:0,width:34,height:34,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',background:on ? C.accent : (C.cardSub || C.bg),color:on ? '#fff' : C.label}}><Icon size={17}/></span>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <strong style={{fontSize:15,color:C.text}}>{title}</strong>
              <span style={{fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:999,color:on ? (C.accentText || C.accent) : C.label,background:on ? 'transparent' : (C.cardSub || C.bg),border:`1px solid ${on ? C.accent + '55' : C.border}`}}>{tag}</span>
            </span>
            <span style={{display:'block',marginTop:4,fontSize:12.5,color:C.label,lineHeight:1.5}}>{description}</span>
          </span>
          <span aria-hidden style={{flexShrink:0,marginTop:8,width:18,height:18,borderRadius:'50%',boxSizing:'border-box',border:`2px solid ${on ? C.accent : C.border}`,display:'flex',alignItems:'center',justifyContent:'center'}}>
            {on ? <span style={{width:8,height:8,borderRadius:'50%',background:C.accent}}/> : null}
          </span>
        </label>;
      })}
    </div>
    {mode && mode!=='general' ? <label style={fieldLabel}>대여 사유 (필수)
      <textarea required maxLength={2000} value={reason} onChange={e=>onReason(e.target.value)} rows={3} placeholder="사용 목적과 대여 사유를 입력해주세요" style={{...input,resize:'vertical'}}/>
    </label>:null}
    {mode==='long_term' ? <label style={fieldLabel}>반납 예정일 (필수 · 한국 날짜)
      <input type="date" required min={today} value={dueDate} onChange={e=>onDueDate(e.target.value)} style={input}/>
    </label>:null}
    {mode==='general' ? <p style={{margin:'12px 0 0',padding:'9px 12px',borderRadius:10,fontSize:12,color:C.warn,background:C.warnSoft || 'transparent',lineHeight:1.55}}>4시간 내 반납하지 않으면 신청 1건당 한 번 대여 가능 종류 5종이 48시간 동안 차감됩니다.</p>:null}
  </fieldset>;
}
