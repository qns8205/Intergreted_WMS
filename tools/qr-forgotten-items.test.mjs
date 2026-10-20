import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../request-lookup/public/index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(){
  const nodes=new Map(),storage=new Map();
  function node(id){
    if(!nodes.has(id)){
      let markup='';const n={id,value:'',dataset:{},hidden:false,disabled:false,textContent:'',style:{},offsetTop:100,offsetHeight:200,scrollHeight:200,listeners:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(selector){
        if(id==='items'){
          if(selector.startsWith('#'))return markup.includes(`id="${selector.slice(1)}"`)?node(selector.slice(1)):null;
          return markup.includes(selector.slice(1))?node(selector):null;
        }
        return node(id+':'+selector);
      }};
      Object.defineProperty(n,'innerHTML',{get:()=>markup,set:v=>{markup=v;if(id==='items'&&v.includes('id="forgotten-form"')){node('forgotten-form').dataset.employeeId=v.match(/data-employee-id="(.*?)"/)[1];node('forgotten-results').innerHTML='';}}});
      nodes.set(id,n);
    }
    return nodes.get(id);
  }
  const ctx=vm.createContext({console,URLSearchParams,AbortSignal,Date,Set,Map,Event,
    document:{getElementById:node,querySelector:s=>node(s),querySelectorAll:()=>[]},
    window:{scrollTo(){},scrollY:0,setInterval(){},clearInterval(){}},navigator:{},location:{search:''},requestAnimationFrame:fn=>fn(),setTimeout(){},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async()=>{throw Error('Unexpected network request');}});
  vm.runInContext(script,ctx);const run=s=>vm.runInContext(s,ctx);
  return {run,node,ctx};
}
const data={employeeId:'1234',borrowerName:'Test',items:[{key:'b1',id:'000001',name:'컵',quantity:1,location:'000100',returned:false,pickedUp:false,eventType:'borrow',eventTime:'2026-10-19 10:00:00'}]};

test('finishing the last item asks about missed items, then preserves the search form during polling',()=>{
  const f=fixture();f.run(`applyLookupData(${JSON.stringify(data)},false)`);
  f.node('items').querySelector('.route-notice-confirm').listeners.click();
  assert.ok(!f.node('items').innerHTML.includes('혹시 놓친'));
  f.node('items').querySelector('.flow-confirm').listeners.click();
  assert.match(f.node('items').innerHTML,/혹시 놓친 것이 있나요/);
  const before=f.node('items').innerHTML;f.node('forgotten-name').value='컵';
  f.run(`applyLookupData(${JSON.stringify(data)},true)`);
  assert.equal(f.node('items').innerHTML,before);assert.equal(f.node('forgotten-name').value,'컵');
});
test('search displays escaped names and locations without changing the completed rental flow',async()=>{
  const f=fixture();f.run("currentEmployeeId='1234';activeTab='empty';renderItems()");f.node('forgotten-name').value='컵';
  f.ctx.fetch=async url=>{assert.ok(url.includes('employeeId=1234'));return {ok:true,json:async()=>({success:true,items:[{name:'컵 <script>',location:'000120',kind:'scenario'}]})};};
  await f.node('forgotten-form').listeners.submit({preventDefault(){}});
  assert.match(f.node('forgotten-results').innerHTML,/컵 &lt;script&gt;/);assert.match(f.node('forgotten-results').innerHTML,/000120/);
  assert.equal(f.run('activeTab'),'empty');assert.equal(f.node('forgotten-form:button').disabled,false);
});
test('the missed-item question appears after both return and pickup routes are finished',()=>{
  const f=fixture();
  const combined={...data,items:[...data.items,{key:'r1',id:'000002',name:'접시',quantity:1,returned:true,returnSource:'admin',returnStepAutoDone:false,eventType:'return',eventTime:'2026-10-19 10:00:00'}]};
  f.run(`applyLookupData(${JSON.stringify(combined)},false)`);
  f.node('items').querySelector('.route-notice-confirm').listeners.click();
  assert.equal(f.run('activeTab'),'return');
  f.node('items').querySelector('.flow-confirm').listeners.click();
  assert.equal(f.run('activeTab'),'borrow');assert.doesNotMatch(f.node('items').innerHTML,/혹시 놓친/);
  f.node('items').querySelector('.flow-confirm').listeners.click();
  assert.equal(f.run('activeTab'),'empty');assert.match(f.node('items').innerHTML,/혹시 놓친/);
});
test('empty results and network failures allow another search',async()=>{
  const f=fixture();f.run("currentEmployeeId='1234';activeTab='empty';renderItems()");f.node('forgotten-name').value='컵';
  f.ctx.fetch=async()=>({ok:true,json:async()=>({success:true,items:[]})});
  await f.node('forgotten-form').listeners.submit({preventDefault(){}});
  assert.match(f.node('forgotten-results').innerHTML,/일치하는 물품이 없어요/);
  f.ctx.fetch=async()=>{throw Error('연결 오류');};await f.node('forgotten-form').listeners.submit({preventDefault(){}});
  assert.match(f.node('forgotten-results').innerHTML,/연결 오류/);assert.equal(f.node('forgotten-form:button').disabled,false);
});
test('a delayed search never writes results into the next employee lookup',async()=>{
  const f=fixture();f.run("currentEmployeeId='1234';activeTab='empty';renderItems()");f.node('forgotten-name').value='컵';
  let resolve;f.ctx.fetch=()=>new Promise(r=>resolve=r);
  const search=f.node('forgotten-form').listeners.submit({preventDefault(){}});
  f.run("currentEmployeeId='5678';renderItems()");
  resolve({ok:true,json:async()=>({success:true,items:[{name:'old result',location:'000120'}]})});await search;
  assert.doesNotMatch(f.node('forgotten-results').innerHTML,/old result/);
});
