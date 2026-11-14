const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../assets/ymis-export.js');
test('exact YMIS headers, section and five approved award names',()=>{
 assert.deepEqual(api.headers,['Scout ID','Badge-Section','Badge-Badge','Badge-award date (YYYYMMDD)']);
 assert.equal(api.badges.length,5);
 for(const [,badge] of api.badges){
  assert.deepEqual(api.buildRows([{ymis:'0123456789',badge,date:'2024-02-29'}]),[['0123456789','Cub Scout',badge,'20240229']]);
 }
});
test('reject missing/invalid IDs, dates, unsupported badges and duplicates',()=>{
 const r={ymis:'0123456789',badge:'Membership Badge',date:'2026-11-14'};
 for(const delta of [{ymis:''},{ymis:'123'},{badge:'Gold Arrow'},{date:''},{date:'2026-02-29'},{date:'2026-04-31'},{date:'20261114'}]) assert.throws(()=>api.buildRows([{...r,...delta}]));
 assert.throws(()=>api.buildRows([]));
 assert.throws(()=>api.buildRows([r,r]));
 assert.equal(api.buildRows([r,{...r,badge:'Cub Scout Award'}]).length,2);
});
test('workbook uses only headers and actual records, no examples or personal profile fields',()=>{
 let table;
 const fake={utils:{aoa_to_sheet(a){table=a;return {};},book_new(){return {};},book_append_sheet(w,s,n){w.sheet=s;w.name=n;}}};
 const rows=api.buildRows([{ymis:'0123456789',badge:'Membership Badge',date:'2026-11-14'}]);
 const wb=api.workbook(fake,rows);
 assert.equal(wb.name,'Sheet1');assert.equal(table.length,2);assert.equal(table[1][0],'0123456789');assert.equal(typeof table[1][0],'string');
});
