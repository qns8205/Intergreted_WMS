// Run over stdin on the server. SQLite is opened read-only; no app modules/migrations.
import { DatabaseSync } from 'node:sqlite';
const normalizedName = value => String(value || '').trim().replace(/\s+/g,'');
const employee = value => /^\d{4}$/.test(String(value || '').trim()) ? String(value).trim() : '';
const median = values => {const sorted=[...values].sort((a,b)=>a-b), n=sorted.length; return n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2;};

export function filterHumanAuditDates(rows, {from='',toExclusive=''}={}) {
  if(!from && !toExclusive) return rows;
  for(const value of [from,toExclusive]) if(value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Date bounds must be YYYY-MM-DD');
  return rows.filter(row=>{
    const raw=String(row.applied_at || row.borrow_date || '').trim();
    const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw), slash=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
    const day=iso ? `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`
      : slash ? `${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}` : '';
    return !!day && (!from || day>=from) && (!toExclusive || day<toExclusive);
  });
}

export function aggregateHumanRequests(rows, users=[], requests=[]) {
  const usersById = new Map(users.map(user=>[user.employee_id,user]));
  const requestsById = new Map(requests.map(request=>[request.id,request]));
  const groups = new Map();
  const excluded = {cancel:0,swap:0,unconfirmed:0,invalidItem:0};
  for (const row of rows) {
    if(row.return_source==='cancel'){excluded.cancel++;continue;}
    if(row.return_source==='swap'){excluded.swap++;continue;}
    if(!row.picked_up_at && row.returned!=='O'){excluded.unconfirmed++;continue;}
    const byName=users.filter(user=>normalizedName(user.name)===normalizedName(row.borrower_name));
    const emailId=employee(String(row.email || '').split('@')[0]);
    const emailUser=usersById.get(emailId);
    const id=employee(row.employee_id) || employee(requestsById.get(row.request_no)?.employee_id)
      || (emailUser && normalizedName(emailUser.name)===normalizedName(row.borrower_name) ? emailId : '')
      || (byName.length===1 ? byName[0].employee_id : '');
    const name=usersById.get(id)?.name || row.borrower_name || '(이름 없음)';
    const person=id || `legacy:${normalizedName(name)}:${String(row.email||'').toLowerCase()}`;
    const when=String(row.applied_at || row.borrow_date || '').trim();
    // Old SID and additional-item batches share an application timestamp but not a batch ID.
    const key=JSON.stringify(row.request_no ? [person,`request:${row.request_no}`]
      : [person,row.floor,row.unit,/\d{1,2}:\d{2}/.test(when) ? `time:${when}` : `batch:${row.batch_id || `${row.source}:${row.id}`}`]);
    let itemId='',nameKey='',quantity=0;
    if(row.source==='sid_rentals'){
      const raw=String(row.item_label||'').trim(), match=/^\[(\d+)\]\s*(.*)$/.exec(raw);
      itemId=match?.[1] || ''; const rest=match?.[2] || raw;
      const qty=/\s*[x×]\s*(\d+)\s*$/i.exec(rest);
      quantity=qty ? Number(qty[1]) : 1;
      nameKey=(qty ? rest.slice(0,qty.index) : rest).trim();
    }else{itemId=String(row.item_id||'').trim();nameKey=String(row.item_label||'').trim();quantity=Number(row.qty ?? 1);}
    if((!itemId && !nameKey) || !Number.isFinite(quantity) || quantity<=0){excluded.invalidItem++;continue;}
    if(Number(itemId)>900000) continue; // Tablecloths aren't scenario objects.
    if(!groups.has(key))groups.set(key,{person,name,identityKnown:!!id,when,units:new Set(),types:new Set(),quantity:0,numbered:!!row.request_no});
    const group=groups.get(key);
    group.units.add(`${row.floor} / ${row.unit}`);
    group.types.add(itemId ? `id:${/^\d+$/.test(itemId)?itemId.padStart(6,'0'):itemId}` : `name:${nameKey}`);
    group.quantity+=quantity;
  }
  const stats=groups=>{
    const types=groups.map(group=>group.types.size), quantities=groups.map(group=>group.quantity), n=groups.length;
    return {requests:n,avgTypes:n?types.reduce((a,b)=>a+b,0)/n:0,medianTypes:n?median(types):0,maxTypes:n?Math.max(...types):0,
      avgQuantity:n?quantities.reduce((a,b)=>a+b,0)/n:0,medianQuantity:n?median(quantities):0,maxQuantity:n?Math.max(...quantities):0};
  };
  const list=[...groups.values()];
  const people=new Map();
  for(const group of list){if(!people.has(group.person))people.set(group.person,[]);people.get(group.person).push(group);}
  return {excluded,overall:stats(list),numberedRequests:stats(list.filter(group=>group.numbered)),
    period:{earliest:list.map(group=>group.when).sort()[0],latest:list.map(group=>group.when).sort().at(-1)},
    people:[...people.values()].map(groups=>({name:groups[0].name,identityKnown:groups[0].identityKnown,
      units:[...new Set(groups.flatMap(group=>[...group.units]))],...stats(groups)})).sort((a,b)=>b.requests-a.requests||a.name.localeCompare(b.name))};
}

if(process.argv[1]==='-'){
const db = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  db.exec('BEGIN');
  const range={from:process.argv[3] || '',toExclusive:process.argv[4] || ''};
  const rows = filterHumanAuditDates(['sid_rentals','general_rentals'].flatMap(table => db.prepare(`SELECT *, '${table}' AS source FROM ${table} WHERE LOWER(unit) LIKE '%human%'`).all()),range);
  const counts = key => Object.fromEntries([...new Set(rows.map(key))].map(value => [value,rows.filter(row=>key(row)===value).length]));
  const dates = rows.map(row => row.applied_at || row.borrow_date).filter(Boolean).sort();
  const users=db.prepare('SELECT employee_id,name FROM registered_users').all();
  const requests=db.prepare('SELECT id,employee_id FROM rental_requests').all();
  console.log(JSON.stringify({range,rows:rows.length,units:counts(row=>`${row.floor || ''} / ${row.unit || ''}`),
    earliest:dates[0],latest:dates.at(-1),withRequestNo:rows.filter(row=>row.request_no).length,
    withBatchId:rows.filter(row=>row.batch_id).length,returnSources:counts(row=>row.return_source || '(empty)'),
    statuses:counts(row=>row.status || '(empty)'),pickedUp:rows.filter(row=>row.picked_up_at).length,
    returned:rows.filter(row=>row.returned==='O').length,
    analysis:aggregateHumanRequests(rows,users,requests)},null,2));
} finally { db.close(); }
}
