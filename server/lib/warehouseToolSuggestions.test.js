import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WMS_DB_PATH=':memory:';
const {db,run,all}=await import('../db.js');
const {lexicalToolScore,suggestWarehouseTools}=await import('./warehouseToolSuggestions.js');
test('일반 이름·키워드·한영 유사어 검색 점수 유지',()=>{
  assert.equal(lexicalToolScore('hammer',{name:'Hammer'}),3);
  assert.ok(lexicalToolScore('망치',{name:'Hammer'})>0);
  assert.equal(lexicalToolScore('알수없는물품',{name:'Hammer'}),0);
  assert.ok(lexicalToolScore('절단',{name:'Nipper',keywords:'절단'})>0);
});
test('후보는 모델 호출 없이 생성하고 위치·보관 물품·외부 이미지 제외',()=>{
  run("INSERT INTO warehouse_items (location,name,stock,consumable,image_path,archived) VALUES ('A-01','Hammer','3','N','/uploads/hammer.webp','N'),('A-02','Hammer Archived','2','N','','Y'),('A-03','Hammer spare',NULL,'N','https://example.org/photo','N')");
  const before=JSON.stringify(all('SELECT * FROM warehouse_items'));
  const previous=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('일반 검색은 네트워크를 사용하면 안 됨');};
  try{
    const result=suggestWarehouseTools('망치');
    assert.equal(result.length,2);assert.equal(result[0].name,'Hammer');
    assert.equal(result[0].stock,3);assert.equal(result[1].stock,null);
    assert.equal(result[0].image,'/uploads/hammer.webp');assert.equal(result[1].image,'');
    assert.ok(result.every(item=>!('location'in item)));
    assert.equal(JSON.stringify(all('SELECT * FROM warehouse_items')),before);
  }finally{globalThis.fetch=previous;}
});
test.after(()=>db.close());
