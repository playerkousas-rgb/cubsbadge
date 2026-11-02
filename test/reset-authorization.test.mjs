import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBackend, USERS_HEADER, sha256Hex} from './mock-gas.mjs';
const result = r => JSON.parse(r.getContent());
function seed(b,id,role){ const r=new Array(USERS_HEADER.length).fill(''); r[0]=id; r[3]=role; r[4]=sha256Hex('old1'); r[11]='active'; b.__ss.sheets.Users.rows.push(r); return r; }
test('密碼重設依角色授權，拒絕時不改 hash；成功清鎖及踢走目標 session',()=>{
 const b=buildBackend();
 for(const [manager, target] of [['branch_leader','group_leader'],['group_leader','admin'],['admin','admin'],['member','member'],['super_admin','super_admin']]){
   const row=seed(b,'T'+b.__ss.sheets.Users.rows.length,target); const old=row[4];
   assert.equal(result(b.handleResetPassword(row[0],{ymis:'actor',role:manager},'new1')).success,false);
   assert.equal(row[4],old);
 }
 const row=seed(b,'TARGET','member');
 b.PropertiesService.getScriptProperties().setProperty('LOGIN_FAIL:TARGET','locked');
 b.__ss.sheets.Tokens.rows.push(['old','TARGET','','2099-01-01'],['manager','actor','','2099-01-01']);
 assert.equal(result(b.handleResetPassword('TARGET',{ymis:'actor',role:'branch_leader'},'new1')).success,true);
 assert.match(row[4],/^pbkdf2\$/); assert.equal(b.verifyPassword('new1',row[4]),true); assert.equal(row[15],true);
 assert.equal(b.PropertiesService.getScriptProperties().getProperty('LOGIN_FAIL:TARGET'),null);
 assert.equal(b.__ss.sheets.Tokens.rows.some(r=>r[0]==='old'),false);
 assert.equal(b.__ss.sheets.Tokens.rows.some(r=>r[0]==='manager'),true);
});
test('簽章路由傳入已驗證角色物件而不是密碼字串',()=>{
 const b=buildBackend(); const row=seed(b,'TARGET','member');
 assert.equal(result(b.handleSignedRequest('resetPassword',{target_ymis:'TARGET',new_password:'new1',on_behalf:'label',on_behalf_role:'branch_leader'})).success,true);
 assert.match(row[4],/^pbkdf2\$/); assert.equal(b.verifyPassword('new1',row[4]),true);
});
