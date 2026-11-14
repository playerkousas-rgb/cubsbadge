/* YMIS progressive badge export. No checklist-completion/award-date inference. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.YmisExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const headers=Object.freeze(['Scout ID','Badge-Section','Badge-Badge','Badge-award date (YYYYMMDD)']);
  const badges=Object.freeze([
    ['團員章／會員章','Membership Badge'],
    ['幼童軍獎章','Cub Scout Award'],
    ['幼童軍歷奇章','Cub Scout Adventure Award'],
    ['幼童軍高級歷奇章','Cub Scout Adventure Crest Award'],
    ['金紫荊獎章','The Golden Bauhinia Award']
  ].map(Object.freeze));
  function normalizeDate(value){
    const s=String(value||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期必須為 YYYY-MM-DD / Date must be YYYY-MM-DD');
    const d=new Date(s+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s) throw new Error('無效日期 / Invalid date');
    return s.replace(/-/g,'');
  }
  function buildRows(records){
    if(!records.length) throw new Error('請先選擇成員 / Select members first');
    const seen=new Set();
    return records.map(r=>{
      const id=String(r.ymis||'').trim();
      if(!/^\d{10}$/.test(id)) throw new Error('YMIS 必須為10位數字 / YMIS must be 10 digits: '+id);
      if(!badges.some(b=>b[1]===r.badge)) throw new Error('不支援的獎章 / Unsupported badge');
      const date=normalizeDate(r.date);
      const key=id+'|'+r.badge;
      if(seen.has(key)) throw new Error('同一成員獎章重複 / Duplicate member badge: '+id);
      seen.add(key);
      return [id,'Cub Scout',r.badge,date];
    });
  }
  function workbook(XLSX,rows){
    const ws=XLSX.utils.aoa_to_sheet([headers.slice(),...rows]);
    ws['!cols']=[{wch:16},{wch:18},{wch:40},{wch:34}];
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Sheet1');
    return wb;
  }
  return {headers,badges,normalizeDate,buildRows,workbook};
});
