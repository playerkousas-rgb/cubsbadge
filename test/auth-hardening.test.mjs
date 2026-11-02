import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {buildBackend, sha256Hex, USERS_HEADER} from './mock-gas.mjs';
const result = r => JSON.parse(r.getContent());
function seed(b,id,role='member',pw='old1') { const r=new Array(USERS_HEADER.length).fill(''); r[0]=id;r[1]='Name';r[2]=id+'@example.org';r[3]=role;r[4]=sha256Hex(pw);r[11]='active';b.__ss.sheets.Users.rows.push(r);return r; }
const login=(b,id,pw)=>result(b.handleLogin(id,pw));
test('PBKDF2 matches Node reference, uses per-user 16 byte salt and accepts imported formats',()=>{
 const b=buildBackend(); const a=b.hashPasswordV2('測試pass'), c=b.hashPasswordV2('測試pass');
 assert.notEqual(a,c); const parts=a.split('$'); assert.equal(parts[1],'120000'); assert.equal(parts[2].length,32);
 assert.equal(parts[3],pbkdf2Sync('測試pass',Buffer.from(parts[2],'hex'),120000,32,'sha256').toString('hex'));
 assert.equal(b.verifyPassword('測試pass',a),true);assert.equal(b.verifyPassword('wrong',a),false);
 for(const [id,hash] of [['1234567801',sha256Hex('abcd')],['1234567802',a]]) {
   assert.equal(b.upsertUser({ymis:id,name:'test',password_hash:hash},'admin').success,true);
   assert.equal(b.findUserRowByYmis(b.getUsersTable(),id).password_hash,hash);
 }
});
test('legacy login upgrades, failed login lock expires, and unknown and wrong credentials match',()=>{
 const b=buildBackend(); const row=seed(b,'1234567890');
 const wrong=login(b,'1234567890','wrong'), missing=login(b,'9999999999','wrong'); assert.deepEqual(wrong,missing);
 for(let i=0;i<4;i++) assert.equal(login(b,'1234567890','wrong').success,false);
 const prop=b.PropertiesService.getScriptProperties(); const rec=JSON.parse(prop.getProperty('LOGIN_FAIL:1234567890'));
 assert.equal(rec.count,5); assert.ok(rec.until>Date.now()+14*60*1000);
 assert.equal(login(b,'1234567890','old1').success,false);
 assert.ok(b.__ss.sheets['操作紀錄'].rows.some(r=>r[2]==='login_locked'));
 rec.until=Date.now()-1; prop.setProperty('LOGIN_FAIL:1234567890',JSON.stringify(rec));
 assert.equal(login(b,'1234567890','old1').success,true); assert.match(row[4],/^pbkdf2\$/);
 assert.equal(prop.getProperty('LOGIN_FAIL:1234567890'),null);
});
test('change password keeps current session and invalidates other sessions',()=>{
 const b=buildBackend(); const row=seed(b,'1234567891');
 b.__ss.sheets.Tokens.rows.push(['keep','1234567891','','2099-01-01'],['other','1234567891','','2099-01-01']);
 assert.equal(result(b.handleChangePassword('1234567891','old1','new1','keep')).success,true);
 assert.match(row[4],/^pbkdf2\$/); assert.equal(b.verifyPassword('new1',row[4]),true);
 assert.ok(b.__ss.sheets.Tokens.rows.some(r=>r[0]==='keep')); assert.ok(!b.__ss.sheets.Tokens.rows.some(r=>r[0]==='other'));
});

test('an unset or malformed stored hash never authenticates with the dummy KDF password',()=>{
 const b=buildBackend(); const row=seed(b,'1234567892'); row[4]='';
 assert.equal(login(b,'1234567892','timing-equalizer').success,false);
});
test('account creation and manager reset use PBKDF2 and reset unlocks immediately',()=>{
 const b=buildBackend(), mgr={ymis:'manager',role:'branch_leader'};
 assert.equal(result(b.handleAddUser({ymis:'1234567888',name:'Test',role:'member',password:'old1'},mgr)).success,true);
 const row=b.__ss.sheets.Users.rows.find(r=>r[0]==='1234567888'); assert.match(row[4],/^pbkdf2\$/);
 const props=b.PropertiesService.getScriptProperties(); props.setProperty('LOGIN_FAIL:1234567888',JSON.stringify({count:5,until:Date.now()+900000}));
 b.__ss.sheets.Tokens.rows.push(['stale','1234567888','','2099-01-01']);
 const reset=result(b.handleResetPassword('1234567888',mgr,'new1'));
 assert.equal(reset.success,true); assert.ok(!JSON.stringify(reset).includes('new1'));
 assert.equal(props.getProperty('LOGIN_FAIL:1234567888'),null); assert.ok(!b.__ss.sheets.Tokens.rows.some(r=>r[0]==='stale'));
 assert.equal(row[15],true); const logged=login(b,'1234567888','new1'); assert.equal(logged.success,true);
 const guarded=result(b.doPost({postData:{contents:JSON.stringify({action:'getMembers',token:logged.token})},parameter:{}}));
 assert.equal(guarded.code,'CHANGE_PASSWORD_REQUIRED');
});

test('injected key cannot override an invalid or unprivileged session',()=>{
 const b=buildBackend(); seed(b,'1234567893');
 const key=b.getApiKey(); b.__ss.sheets.Tokens.rows.push(['member-session','1234567893','','2099-01-01']);
 const call=payload=>result(b.doPost({postData:{contents:JSON.stringify({...payload,apikey:key})},parameter:{}}));
 assert.equal(call({action:'addUser',token:'invalid',ymis:'1234567880',name:'X',role:'member',password:'abcd'}).success,false);
 assert.equal(call({action:'upsertUser',token:'member-session',user:{ymis:'1234567880',name:'X',password_hash:sha256Hex('abcd')}}).success,false);
 assert.equal(call({action:'save',token:'member-session',changes:[]}).success,false);
});
