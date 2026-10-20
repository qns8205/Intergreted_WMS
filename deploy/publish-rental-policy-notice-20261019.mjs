import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root='/home/configds/wms';
const notice=JSON.parse(fs.readFileSync('/tmp/wms-rental-policy-20261019/deploy/rental-policy-notice-20261019.json','utf8'));
const db=new DatabaseSync(root+'/server/data/db.sqlite3');
db.exec('PRAGMA busy_timeout=10000');
const createdAt=new Date(Date.now()+9*3600000).toISOString().slice(0,19).replace('T',' ');
const asset=fs.readFileSync(root+'/dist/index.html','utf8').match(/assets\/index-[^"']+\.js/)[0];
const releaseHash=crypto.createHash('sha256').update(fs.readFileSync(root+'/dist/'+asset)).digest('hex');
let id,added=false,version;
db.exec('BEGIN IMMEDIATE');
try {
  const previous=db.prepare('SELECT id FROM notices WHERE title=? AND content=? ORDER BY id DESC LIMIT 1').get(notice.title,notice.text);
  const before=db.prepare('SELECT COUNT(*) n FROM notices').get().n;
  if (previous) id=previous.id;
  else {id=Number(db.prepare('INSERT INTO notices(created_at,author,content,title) VALUES (?,?,?,?)').run(createdAt,notice.author,notice.text,notice.title).lastInsertRowid);added=true;}
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,before+(added?1:0));
  const previousRelease=db.prepare("SELECT value FROM settings WHERE key='rental_policy_release_hash'").get()?.value;
  version=db.prepare("SELECT value FROM settings WHERE key='app_version'").get()?.value;
  if(previousRelease!==releaseHash || !version){
    version=`v${Date.now()}`;
    const set=db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    set.run('app_version',version);set.run('rental_policy_release_hash',releaseHash);
  }
  db.exec('COMMIT');
} catch(error){db.exec('ROLLBACK');throw error;}
db.close();
const base='https://cos-management.duckdns.org/api/gas';
for(const action of ['getNotices','getNoticePopup']){
  const response=await fetch(base+'?action='+action,{signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.success,true);
  assert.ok(data.items.some(item=>item.title===notice.title && item.text===notice.text));
}
console.log(JSON.stringify({noticeId:id,title:notice.title,added,published:true,loginPopupVerified:true,appVersion:version}));
