// ============================================================
// 幼童軍進度追蹤系統 - Apps Script 後端 v5.2 - 全功能版 (對齊 ScoutBadge v5.2)
// 中英文對照 + 超管隱藏 + 活動履歷申報（家長=成員帳號 填寫，領袖審批）
// ============================================================
// 基於 ScoutBadge v5.2 修訂，保留 Cub 分支過濾及金紫荊邏輯
// v5.2 新增（對齊 ScoutBadge v5.2 / VSBADGE v8.5）：
//   活動履歷「家長/成員 申報 → 領袖審批」/ Activity-log claims: parents/members self-declare, leaders approve
//   - 新工作表「待批履歷」（執行 initializeSheets() 自動補建，不影響既有資料）
//   - 新 action：requestLogRecord（家長申報新增／修改）/ getLogRequests / reviewLogRequest / cancelLogRequest
//   - 家長/成員 只可為自己申報；「修改申報」只限自己的紀錄，批准後以同一 record_id 更新（需領袖重批）
//   - 同一紀錄同時只可有一個待批修改申報；批准前可取消；全部寫入操作紀錄
//   - 進度（會員章/獎章/歷奇/金紫荊）仍由領袖填寫，家長只看 / Progress still leader-only, parents view-only
//   - handleLoad 回應新增 logRequests + logRequestsSupported + logsSupported
//   - 修復 handleSaveLogRecord setValues 欄數不符（13→12）的 bug
// 超管 SHEEP（v5.2 與 ScoutBadge 一致）：
//   - 登入 sheep / 0728 有效（後門寫死在 handleLogin，不靠 Sheet）
//   - Users 表／用戶管理／成員名單不會出現 sheep（getUser 虛擬帳號；getAllUsers/getMembers 排除）
//   - 防護：sheep 不能被停用／重設密碼／改角色／申請／批量開戶佔用保留帳號
//   - SETUP 彈窗不顯示 sheep 帳號密碼，只寫在 GS / Setup dialog hides super-admin credentials
// ============================================================

const ADMIN_YMIS = '1111111111';
const ADMIN_NAME = '管理員';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'changeme';

// SHEEP 是隱藏維護帳戶，只能由後端以固定憑證登入，永不列入用戶清單
const SUPER_ADMIN_LOGIN = 'sheep';
const SUPER_ADMIN_EMAIL = 'sheep@cubbadge.local';
const SUPER_ADMIN_PASSWORD = '0728';
function isSuperAdminId(id){
  const v=String(id||'').trim().toLowerCase();
  return v===SUPER_ADMIN_LOGIN || v===SUPER_ADMIN_EMAIL;
}
function isSuperAdminReserved(ymis,email){
  return String(ymis||'').trim().toLowerCase()===SUPER_ADMIN_LOGIN ||
         (String(email||'').trim()!=='' && String(email).trim().toLowerCase()===SUPER_ADMIN_EMAIL);
}

const APP_SECTION = 'cub';
const CUB_BRANCH_VALUES = ['cub', 'b4', '幼童軍', 'cub_scout', ''];
function isSystemAccount(ymis, role) {
  return String(ymis || '').toLowerCase() === 'sheep' || String(role || '') === 'super_admin';
}
function isCubBranch(branch) {
  const value = String(branch || '').trim().toLowerCase();
  return !value || CUB_BRANCH_VALUES.indexOf(value) >= 0;
}

// ===== 工具 =====
function getSheet() { return SpreadsheetApp.getActiveSpreadsheet(); }
function getApiKey() {
  const props = PropertiesService.getScriptProperties();
  let apiKey = props.getProperty('API_KEY');
  if (!apiKey) {
    apiKey = 'cb_' + Utilities.getUuid().replace(/-/g, '').substring(0, 24);
    props.setProperty('API_KEY', apiKey);
  }
  return apiKey;
}
function showApiKey() {
  const ss = getSheet();
  if(!ss){
    const apiKey = getApiKey();
    Logger.log('API Key: ' + apiKey + ' (no sheet)');
    return apiKey;
  }
  let ah=ss.getSheetByName('操作紀錄'); if(!ah){ ah=ss.insertSheet('操作紀錄'); ah.appendRow(['時間','操作者','操作','對象','詳情']); ah.getRange(1,1,1,5).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000'); ah.setFrozenRows(1); }
  let lSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if(!lSheet){
    lSheet = ss.insertSheet(LOG_SHEET_NAME);
    lSheet.appendRow(LOG_HEADERS);
    lSheet.getRange(1,1,1,LOG_HEADERS.length).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    lSheet.setFrozenRows(1);
  }
  let lrSheet0 = ss.getSheetByName(LOG_REQ_SHEET_NAME);
  if(!lrSheet0){
    lrSheet0 = ss.insertSheet(LOG_REQ_SHEET_NAME);
    lrSheet0.appendRow(LOG_REQ_HEADERS);
    lrSheet0.getRange(1,1,1,LOG_REQ_HEADERS.length).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    lrSheet0.setFrozenRows(1);
  }
  let cfgSheet = ss.getSheetByName('SystemConfig');
  if(cfgSheet){
    const cfgData=cfgSheet.getDataRange().getValues();
    let hasAllow=false, hasScope=false, hasCompare=false, hasReq=false, hasSection=false;
    for(let i=1;i<cfgData.length;i++){
      if(cfgData[i][0]==='allow_member_view_others') hasAllow=true;
      if(cfgData[i][0]==='member_progress_scope') hasScope=true;
      if(cfgData[i][0]==='allow_squad_comparison') hasCompare=true;
      if(cfgData[i][0]==='allow_member_requests') hasReq=true;
      if(cfgData[i][0]==='app_section') hasSection=true;
    }
    if(!hasAllow) cfgSheet.appendRow(['allow_member_view_others','false',now(),'system']);
    if(!hasScope) cfgSheet.appendRow(['member_progress_scope','private',now(),'system']);
    if(!hasCompare) cfgSheet.appendRow(['allow_squad_comparison','false',now(),'system']);
    if(!hasReq) cfgSheet.appendRow(['allow_member_requests','false',now(),'system']); // CUBS: progress requests disabled by default, activity logs always allowed
    if(!hasSection) cfgSheet.appendRow(['app_section',APP_SECTION,now(),'system']);
  }
  const apiKey = getApiKey();
  const ui = SpreadsheetApp.getUi();
  if (ui) ui.alert('API Key', '你的 API Key：\n\n' + apiKey, ui.ButtonSet.OK);
  Logger.log('API Key: ' + apiKey);
  return apiKey;
}

const LOG_SHEET_NAME = '活動履歷';
const LOG_HEADERS = ['record_id','type','ymis','name','date','title','role','hours','cert_no','detail','recorder','recorded_at','updated_at'];
const LOG_TYPES = ['service','activity','training'];
const LOG_REQ_SHEET_NAME = '待批履歷';
const LOG_REQ_HEADERS = ['request_id','kind','target_record_id','type','ymis','name','date','title','role','hours','cert_no','detail','status','created_at','reviewed_by','reviewed_at','review_note'];

const REQUIRED_SHEETS = [
  {name:'進度追蹤', headers:['YMIS','項目 ID','完成日期','更新時間','確認者','備註']},
  {name:'成員名單', headers:['YMIS','姓名','加入日期','支部','聯絡','小隊']},
  {name:'Users', headers:['ymis','name','email','role','password_hash','branch','can_tick','auth_by','auth_date','created_at','last_login','status','allowed_badges','squad','squad_role','force_change_password']},
  {name:'Applications', headers:['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note']},
  {name:'Tokens', headers:['token','ymis','created_at','expires_at']},
  {name:'SystemConfig', headers:['key','value','updated_at','updated_by']},
  {name:'待批完成', headers:['request_id','ymis','name','item_id','item_name','requested_date','evidence','status','created_at','reviewed_by','reviewed_at','review_note','confirmed_date']},
  {name:'其他獎章', headers:['YMIS','獎章 ID','獎章名稱','完成日期','證書編號','備註','更新時間']},
  {name:'操作紀錄', headers:['時間','操作者','操作','對象','詳情']},
  {name:'活動履歷', headers: LOG_HEADERS},
  {name:'待批履歷', headers: LOG_REQ_HEADERS}
];

function diagnoseSheets() {
  const ss = getSheet();
  if(!ss) return {success:false, error:'找不到試算表，請在 Google Sheet 內開啟 Apps Script 再執行'};
  const sheets = ss.getSheets();
  const existing = sheets.map(s=>s.getName());
  const missing = [];
  const present = [];
  const counts = {};
  sheets.forEach(s=>{
    try{ counts[s.getName()] = {rows: s.getLastRow(), cols: s.getLastColumn()}; }catch(e){ counts[s.getName()] = {error: e.toString()}; }
  });
  REQUIRED_SHEETS.forEach(req=>{
    if(existing.indexOf(req.name)>=0) present.push(req.name);
    else missing.push(req.name);
  });
  let usersCount = 0, membersCount = 0;
  try{ const u = ss.getSheetByName('Users'); if(u) usersCount = Math.max(0, u.getLastRow()-1); }catch(e){}
  try{ const m = ss.getSheetByName('成員名單'); if(m) membersCount = Math.max(0, m.getLastRow()-1); }catch(e){}
  return {
    success: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    existing, missing, present, counts,
    usersCount, membersCount,
    allOk: missing.length===0,
    isEmpty: usersCount<=1 && membersCount<=1,
    message: missing.length===0 ? ( (usersCount<=1 ? '⚠️ 工作表齊全但 Users 只有 '+usersCount+' 人，可能是空表/被重置，請檢查是否連錯試算表' : '✅ 所有必要工作表齊全，CubBadge 系統正常') ) : '⚠️ 缺少工作表：' + missing.join('、') + '，請執行 initializeSheets() 修復'
  };
}

function getSpreadsheetInfo(){
  const ss = getSheet();
  if(!ss) return {error:'No spreadsheet'};
  return {
    name: ss.getName(),
    id: ss.getId(),
    url: ss.getUrl(),
    sheets: ss.getSheets().map(s=>({name:s.getName(), rows:s.getLastRow()}))
  };
}

function repairSheets() {
  const diag = diagnoseSheets();
  if(diag.allOk) return jsonResponse({success:true, message:'所有工作表已齊全，無需修復', diagnose:diag});
  const result = initializeSheets();
  const after = diagnoseSheets();
  return jsonResponse({success:true, before:diag, after:after, apiKey: result.apiKey, repaired: true});
}

function hashPassword(p) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, p, Utilities.Charset.UTF_8);
  return raw.map(function(b){return ('0' + (b & 0xFF).toString(16)).slice(-2);}).join('');
}
function generateToken(){ return Utilities.getUuid().replace(/-/g,'') + Date.now().toString(36); }
function now(){ return Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss'); }
function formatDate(d){ if(!d) return ''; if(d instanceof Date) return Utilities.formatDate(d,'Asia/Hong_Kong','yyyy-MM-dd'); return d.toString().split(' ')[0]; }
function jsonResponse(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function safeSheetText(v,maxLen){
  let text=String(v||'').trim().substring(0,maxLen||200);
  if(/^[=+\-@]/.test(text)) text="'"+text;
  return text;
}

const ROLE_HIERARCHY = { 'super_admin':100,'admin':80,'group_leader':60,'branch_leader':40,'member':0 };
const CAN_TICK_ROLES = ['admin','group_leader','branch_leader','super_admin'];
const CAN_MANAGE_ROLES = { 
  'super_admin': ['admin','group_leader','branch_leader','member'],
  'admin': ['group_leader','branch_leader','member'], 
  'group_leader': ['branch_leader','member'], 
  'branch_leader': ['member'] 
};
function canUserTick(r){ return CAN_TICK_ROLES.indexOf(r)>=0; }
function getRoleLevel(r){ return ROLE_HIERARCHY[r]||0; }
function canManageRole(m,t){ return (CAN_MANAGE_ROLES[m]||[]).indexOf(t)>=0; }

// ===== 初始化 =====
function initializeSheets() {
  const ss = getSheet();
  let pSheet = ss.getSheetByName('進度追蹤');
  if(!pSheet){
    pSheet = ss.insertSheet('進度追蹤');
    pSheet.appendRow(['YMIS','項目 ID','完成日期','更新時間','確認者','備註']);
    pSheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    pSheet.setFrozenRows(1);
  } else {
    if(pSheet.getLastColumn()<6){
      pSheet.getRange(1,5).setValue('確認者'); pSheet.getRange(1,6).setValue('備註');
    }
  }
  let mSheet = ss.getSheetByName('成員名單');
  if(!mSheet){
    mSheet = ss.insertSheet('成員名單');
    mSheet.appendRow(['YMIS','姓名','加入日期','支部','聯絡','小隊']);
    mSheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    mSheet.setFrozenRows(1);
  } else {
    if(mSheet.getLastColumn()<6){ mSheet.getRange(1,6).setValue('小隊'); }
  }
  let uSheet = ss.getSheetByName('Users');
  if(!uSheet){
    uSheet = ss.insertSheet('Users');
    uSheet.appendRow(['ymis','name','email','role','password_hash','branch','can_tick','auth_by','auth_date','created_at','last_login','status','allowed_badges','squad','squad_role','force_change_password']);
    uSheet.getRange(1,1,1,16).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    uSheet.setFrozenRows(1);
    uSheet.getRange(2,1).setValue(ADMIN_YMIS);
    uSheet.getRange(2,2).setValue(ADMIN_NAME);
    uSheet.getRange(2,3).setValue(ADMIN_EMAIL);
    uSheet.getRange(2,4).setValue('admin');
    uSheet.getRange(2,5).setValue(hashPassword(ADMIN_PASS));
    uSheet.getRange(2,6).setValue(APP_SECTION);
    uSheet.getRange(2,7).setValue(true);
    uSheet.getRange(2,8).setValue('system');
    uSheet.getRange(2,9).setValue(now());
    uSheet.getRange(2,10).setValue(now());
    uSheet.getRange(2,12).setValue('active');
    uSheet.getRange(2,13).setValue('*');
    uSheet.getRange(2,16).setValue(true);
  } else {
    if(uSheet.getLastColumn()<13){ uSheet.getRange(1,13).setValue('allowed_badges'); }
    if(uSheet.getLastColumn()<14){ uSheet.getRange(1,14).setValue('squad'); }
    if(uSheet.getLastColumn()<15){ uSheet.getRange(1,15).setValue('squad_role'); }
    if(uSheet.getLastColumn()<16){ uSheet.getRange(1,16).setValue('force_change_password'); }
  }
  removeSuperAdminRows();
  let aSheet = ss.getSheetByName('Applications');
  if(!aSheet){
    aSheet = ss.insertSheet('Applications');
    aSheet.appendRow(['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note']);
    aSheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    aSheet.setFrozenRows(1);
  }
  let tSheet = ss.getSheetByName('Tokens');
  if(!tSheet){
    tSheet = ss.insertSheet('Tokens');
    tSheet.appendRow(['token','ymis','created_at','expires_at']);
    tSheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    tSheet.setFrozenRows(1);
  }
  let cSheet = ss.getSheetByName('SystemConfig');
  if(!cSheet){
    cSheet = ss.insertSheet('SystemConfig');
    cSheet.appendRow(['key','value','updated_at','updated_by']);
    cSheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    cSheet.setFrozenRows(1);
    cSheet.appendRow(['login_mode','standalone',now(),'system']);
    cSheet.appendRow(['admin_email',ADMIN_EMAIL,now(),'system']);
    cSheet.appendRow(['app_section',APP_SECTION,now(),'system']);
    cSheet.appendRow(['allow_member_view_others','false',now(),'system']);
    cSheet.appendRow(['member_progress_scope','private',now(),'system']);
    cSheet.appendRow(['allow_squad_comparison','false',now(),'system']);
    cSheet.appendRow(['allow_member_requests','false',now(),'system']);
  } else {
    const cfgData=cSheet.getDataRange().getValues();
    let hasAllow=false, hasScope=false, hasCompare=false, hasReq=false, hasSection=false;
    for(let i=1;i<cfgData.length;i++){
      if(cfgData[i][0]==='allow_member_view_others') hasAllow=true;
      if(cfgData[i][0]==='member_progress_scope') hasScope=true;
      if(cfgData[i][0]==='allow_squad_comparison') hasCompare=true;
      if(cfgData[i][0]==='allow_member_requests') hasReq=true;
      if(cfgData[i][0]==='app_section') hasSection=true;
    }
    if(!hasAllow) cSheet.appendRow(['allow_member_view_others','false',now(),'system']);
    if(!hasScope) cSheet.appendRow(['member_progress_scope','private',now(),'system']);
    if(!hasCompare) cSheet.appendRow(['allow_squad_comparison','false',now(),'system']);
    if(!hasReq) cSheet.appendRow(['allow_member_requests','false',now(),'system']);
    if(!hasSection) cSheet.appendRow(['app_section',APP_SECTION,now(),'system']);
  }
  let prSheet = ss.getSheetByName('待批完成');
  if(!prSheet){
    prSheet = ss.insertSheet('待批完成');
    prSheet.appendRow(['request_id','ymis','name','item_id','item_name','requested_date','evidence','status','created_at','reviewed_by','reviewed_at','review_note','confirmed_date']);
    prSheet.getRange(1,1,1,13).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    prSheet.setFrozenRows(1);
  }
  let oSheet = ss.getSheetByName('其他獎章');
  if(!oSheet){
    oSheet = ss.insertSheet('其他獎章');
    oSheet.appendRow(['YMIS','獎章 ID','獎章名稱','完成日期','證書編號','備註','更新時間']);
    oSheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    oSheet.setFrozenRows(1);
  }
  let ahSheet = ss.getSheetByName('操作紀錄');
  if(!ahSheet){
    ahSheet = ss.insertSheet('操作紀錄');
    ahSheet.appendRow(['時間','操作者','操作','對象','詳情']);
    ahSheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    ahSheet.setFrozenRows(1);
  }
  let lSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if(!lSheet){
    lSheet = ss.insertSheet(LOG_SHEET_NAME);
    lSheet.appendRow(LOG_HEADERS);
    lSheet.getRange(1,1,1,LOG_HEADERS.length).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    lSheet.setFrozenRows(1);
  }
  let lrSheet = ss.getSheetByName(LOG_REQ_SHEET_NAME);
  if(!lrSheet){
    lrSheet = ss.insertSheet(LOG_REQ_SHEET_NAME);
    lrSheet.appendRow(LOG_REQ_HEADERS);
    lrSheet.getRange(1,1,1,LOG_REQ_HEADERS.length).setFontWeight('bold').setBackground('#FFC107').setFontColor('#000');
    lrSheet.setFrozenRows(1);
  }

  const apiKey = getApiKey();
  let scriptUrl=''; try{ scriptUrl=ScriptApp.getService().getUrl(); }catch(e){ scriptUrl='請部署為網頁應用程式後查看';}
  try{
    const ui=SpreadsheetApp.getUi();
    if(ui){
      // v5.2: 不在初始化彈窗顯示超管 sheep 帳號密碼 - 超管為後端隱藏帳戶
      ui.alert('✅ v5.2 初始化完成！\n\nSheets：進度追蹤、成員名單、Users、Applications、Tokens、SystemConfig、待批完成、其他獎章、操作紀錄、活動履歷、待批履歷\n\n🔑 API Key:\n'+apiKey+'\n\n👤 管理員 YMIS: '+ADMIN_YMIS+' 密碼: '+ADMIN_PASS+' (首次登入會要求改密)\n\n🌐 URL:\n'+scriptUrl+'\n\n超管 sheep 為後端隱藏帳戶，憑證不向操作 Sheet 的人員展示，請勿在 SETUP 彈窗顯示。');
    }
  }catch(e){}
  return {success:true,apiKey:apiKey,scriptUrl:scriptUrl};
}

// ===== 用戶查詢 =====
function getUser(ymis){
  if(isSuperAdminId(ymis)){
    return {ymis:SUPER_ADMIN_LOGIN,name:'SHEEP 系統管理員',email:SUPER_ADMIN_EMAIL,role:'super_admin',can_tick:true,branch:APP_SECTION,allowed_badges:'*',squad:'',squad_role:'',status:'active',force_change_password:false};
  }
  const sheet=getSheet().getSheetByName('Users'); if(!sheet) return null;
  const data=sheet.getDataRange().getValues();
  const lastCol = sheet.getLastColumn();
  const hasAllowedCol = lastCol>=13;
  const hasSquadCol = lastCol>=14;
  for(let i=1;i<data.length;i++){
    if(data[i][0].toString()===ymis.toString() && data[i][11].toString()==='active'){
      return {
        ymis:data[i][0].toString(),
        name:data[i][1]?data[i][1].toString():'',
        email:data[i][2]?data[i][2].toString():'',
        role:data[i][3]?data[i][3].toString():'member',
        can_tick:data[i][6]===true||data[i][6]==='TRUE',
        branch:data[i][5]?data[i][5].toString():'',
        allowed_badges: hasAllowedCol ? (data[i][12]?data[i][12].toString():'') : '',
        squad: hasSquadCol && data[i][13] ? data[i][13].toString() : '',
        squad_role: lastCol>=15 && data[i][14] ? data[i][14].toString() : 'member',
        status:'active'
      };
    }
  }
  return null;
}
function getUserByEmail(email){
  if(!email) return null;
  if(String(email).trim().toLowerCase()===SUPER_ADMIN_EMAIL) return getUser(SUPER_ADMIN_LOGIN);
  const sheet=getSheet().getSheetByName('Users'); if(!sheet) return null;
  const data=sheet.getDataRange().getValues(); const target=email.toLowerCase();
  const hasAllowed = sheet.getLastColumn()>=13;
  for(let i=1;i<data.length;i++){
    if(data[i][2].toString().toLowerCase()===target && data[i][11].toString()==='active'){
      return {ymis:data[i][0].toString(),name:data[i][1]?data[i][1].toString():'',email:data[i][2].toString(),role:data[i][3]?data[i][3].toString():'member',can_tick:data[i][6]===true||data[i][6]==='TRUE',allowed_badges: hasAllowed ? (data[i][12]?data[i][12].toString():'') : '',squad:data[i][13]?data[i][13].toString():'',squad_role:data[i][14]?data[i][14].toString():'member'};
    }
  }
  return null;
}
function getAllUsers(){
  const sheet=getSheet().getSheetByName('Users'); if(!sheet) return [];
  const users=[]; const data=sheet.getDataRange().getValues();
  const lastCol = sheet.getLastColumn();
  const hasAllowed = lastCol>=13;
  const hasSquad = lastCol>=14;
  for(let i=1;i<data.length;i++){
    const ymis=data[i][0].toString(); const role=data[i][3]?data[i][3].toString():'member';
    const branch=data[i][5]?data[i][5].toString():'';
    if(isSuperAdminReserved(ymis, data[i][2])) continue;
    if(data[i][11].toString()==='active' && !isSystemAccount(ymis, role) && isCubBranch(branch)){
      users.push({ymis:ymis,name:data[i][1]?data[i][1].toString():'',email:data[i][2]?data[i][2].toString():'',role:role,can_tick:data[i][6]===true||data[i][6]==='TRUE',branch:branch,allowed_badges: hasAllowed ? (data[i][12]?data[i][12].toString():'') : '',squad: hasSquad && data[i][13] ? data[i][13].toString() : '',squad_role: lastCol>=15 && data[i][14] ? data[i][14].toString() : 'member'});
    }
  }
  return users;
}

// Token
function validateToken(token){
  if(!token) return null;
  const sheet=getSheet().getSheetByName('Tokens'); if(!sheet) return null;
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0]===token){
      if(new Date()>new Date(data[i][3])){ sheet.deleteRow(i+1); return null; }
      return data[i][1].toString();
    }
  }
  return null;
}
function createToken(ymis){
  const sheet=getSheet().getSheetByName('Tokens'); if(!sheet) return null;
  const token=generateToken(); const exp=new Date(); exp.setHours(exp.getHours()+24*30);
  sheet.appendRow([token,ymis,now(),Utilities.formatDate(exp,'Asia/Hong_Kong','yyyy-MM-dd HH:mm:ss')]);
  return token;
}
function destroyToken(token){
  if(!token) return;
  const sheet=getSheet().getSheetByName('Tokens'); if(!sheet) return;
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(data[i][0]===token){ sheet.deleteRow(i+1); return; } }
}

// ===== API =====
function doGet(e){
  const action=e.parameter.action;
  if(action==='load'){
    const reqKey=e.parameter.apikey;
    const reqToken=e.parameter.token;
    if(reqKey && reqKey!==getApiKey()) return jsonResponse({success:false,error:'Invalid API Key'});
    if(reqToken && !validateToken(reqToken)) return jsonResponse({success:false,error:'Token 無效或過期'});
    let loadUser=null;
    if(reqToken){ const ly=validateToken(reqToken); if(ly) loadUser=getUser(ly); }
    return handleLoad(loadUser);
  }
  if(action==='health' || action==='diagnose' || action==='checkSheets'){
    const diag = diagnoseSheets();
    return jsonResponse({success:true, action: action, diagnose: diag, apiKeyConfigured: !!getApiKey(), timestamp: now()});
  }
  if(action==='getLoginMode') return jsonResponse({success:true,login_mode:'standalone'});
  return jsonResponse({success:false,error:'Unknown action: ' + action});
}
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents);
    const action=body.action;
    if(action==='login') return handleLogin(body.login_id,body.password);
    if(action==='logout'){ destroyToken(body.token); return jsonResponse({success:true}); }
    if(action==='apply') return handleApply(body.ymis,body.name,body.email,body.requested_role,body.branch);

    if(action==='save' || action==='addMember' || action==='addUser' || action==='saveOtherBadge'){
      const reqKey=body.apikey;
      if(reqKey && reqKey!==getApiKey()) return jsonResponse({success:false,error:'Invalid API Key'});
      if(!reqKey && body.token){
        const tk=validateToken(body.token);
        if(!tk && action!=='addMember' && action!=='addUser') return jsonResponse({success:false,error:'未授權 - 需 API Key 或有效 Token'});
      }
      if(action==='addMember' || action==='addUser'){
        const tkYmis=body.token?validateToken(body.token):null;
        let mgr=tkYmis?getUser(tkYmis):null;
        if(!mgr && body.apikey && body.apikey===getApiKey()) mgr={ymis:'apikey',role:'admin'};
        if(!mgr || getRoleLevel(mgr.role)<40) return jsonResponse({success:false,error:'只有領袖可以新增成員/帳號'});
        if(isSuperAdminReserved(body.ymis, body.email)) return jsonResponse({success:false,error:'此帳號已被保留，請使用其他帳號'});
        if(action==='addMember') return handleAddMember(body.ymis,body.name,body.squad||'',mgr.ymis, body.squad_role||'member');
        return handleAddUser(body, mgr.ymis);
      }
      if(action==='save') return handleSave(body.changes, body.confirmer||'');
      if(action==='saveOtherBadge') return handleSaveOtherBadge(body.records, body.apikey);
    }
    if(action==='requestComplete'){
      let ymis=null; if(body.token){ ymis=validateToken(body.token); } 
      if(!ymis && body.apikey && body.apikey===getApiKey()){ ymis=body.ymis; }
      if(!ymis) return jsonResponse({success:false,error:'未授權'});
      const user = getUser(ymis);
      // CUBS: progress requests disabled - only leaders can tick, members view only. Activity logs use requestLogRecord.
      // For cubs, we keep leader-only requestComplete to prevent misuse, but allow if config allows (default false)
      const cfg = getConfigMap();
      const allowReq = cfg['allow_member_requests']==='true';
      if(!user || !canUserTick(user.role)){
        if(!allowReq) return jsonResponse({success:false,error:'權限不足：幼童軍進度由領袖填寫，家長/成員只看（活動履歷可由家長申報）'});
      }
      return handleRequestComplete(body, ymis);
    }

    const ymis=validateToken(body.token);
    if(!ymis) return jsonResponse({success:false,error:'Token 無效或過期'});
    const user=getUser(ymis);
    if(!user) return jsonResponse({success:false,error:'找不到用戶'});

    if(action==='getAllUsers') {
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足，只有領袖可管理用戶'});
      return jsonResponse({success:true,users:getAllUsers()});
    }
    if(action==='getMembers'){ return jsonResponse({success:true,members:getMembers()}); }
    if(action==='getPendingRequests'){ if(getRoleLevel(user.role)<0) return jsonResponse({success:false,error:'權限不足'}); return handleGetPendingRequests(user); }
    if(action==='reviewRequest'){ if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'}); return handleReviewRequest(body.request_id, body.decision, body.review_note, ymis, body.confirmed_date); }
    if(action==='getOtherBadges'){ return handleGetOtherBadges(body.target_ymis||ymis); }
    if(action==='getApplications'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足，需團長/支部領袖'}); return handleGetApplications(); }
    if(action==='reviewApplication'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleReviewApplication(body.app_id,body.decision,body.review_note,ymis); }
    if(action==='getConfig'){ return handleGetConfig(); }

    if(action==='changePassword') return handleChangePassword(ymis,body.old_password,body.new_password);
    if(action==='resetPassword'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足，需領袖權限'}); if(isSuperAdminId(body.target_ymis)) return jsonResponse({success:false,error:'此為系統保留帳號，不能重設密碼'}); return handleResetPassword(body.target_ymis,ymis); }
    if(action==='getAuditLog'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleGetAuditLog(); }
    if(action==='getApprovalHistory'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleGetApprovalHistory(); }
    if(action==='deactivateUser'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleDeactivateUser(body,ymis); }
    if(action==='updateUserRole'){
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'});
      if(isSuperAdminReserved(body.target_ymis, '')) return jsonResponse({success:false,error:'不能修改系統保留帳號'});
      return handleUpdateUserRole(body.target_ymis,body.new_role,body.can_tick,ymis, body.allowed_badges, body.squad, body.squad_role);
    }
    if(action==='updatePermissions'){
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'});
      return handleUpdateUserRole(body.target_ymis,body.new_role||null,body.can_tick,ymis, body.allowed_badges);
    }
    if(action==='updateConfig'){
      const key=body.key;
      if(key==='allow_member_view_others' || key==='member_progress_scope' || key==='allow_squad_comparison' || key==='allow_member_requests'){
        if(getRoleLevel(user.role)<60) return jsonResponse({success:false,error:'需團長以上權限'});
      }else{
        if(getRoleLevel(user.role)<80) return jsonResponse({success:false,error:'需管理員權限'});
      }
      return handleUpdateConfig(body.key,body.value,ymis);
    }
    // 活動履歷 - 領袖直接寫入，成員可申報
    if(action==='getLogRecords') return handleGetLogRecords(user);
    if(action==='saveLogRecord'){
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleSaveLogRecord(body.records||(body.record?[body.record]:[]), ymis, body.recorder_name||'');
    }
    if(action==='deleteLogRecord'){
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleDeleteLogRecord(body.record_id, ymis);
    }
    // 活動履歷申報（家長=成員帳號 填寫，領袖審批）
    if(action==='requestLogRecord') return handleRequestLogRecord(body, user);
    if(action==='getLogRequests') return handleGetLogRequests(user);
    if(action==='reviewLogRequest'){
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleReviewLogRequest(body.request_id, body.decision, body.review_note, user);
    }
    if(action==='cancelLogRequest') return handleCancelLogRequest(body.request_id, user);
    if(action==='healthCheck' || action==='diagnoseSheets'){
      const reqKey=body.apikey;
      if(reqKey && reqKey!==getApiKey()) return jsonResponse({success:false,error:'Invalid API Key'});
      const diag = diagnoseSheets();
      return jsonResponse({success:true, diagnose:diag, timestamp: now()});
    }
    if(action==='repairSheets'){
      if(getRoleLevel(user.role)<80) return jsonResponse({success:false,error:'需管理員權限執行修復'});
      const before = diagnoseSheets();
      initializeSheets();
      const after = diagnoseSheets();
      return jsonResponse({success:true, before:before, after:after, repaired:true});
    }
    return jsonResponse({success:false,error:'Unknown action: ' + action});
  }catch(err){ return jsonResponse({success:false,error:err.toString()}); }
}

// ===== 邏輯 =====
const SUPER_PASS_HASH_PROP='SUPER_ADMIN_PASSWORD_HASH';
function getSuperAdminPasswordHash(){
  let h='';
  try{ h=PropertiesService.getScriptProperties().getProperty(SUPER_PASS_HASH_PROP)||''; }catch(e){}
  return h || hashPassword(SUPER_ADMIN_PASSWORD);
}
function setSuperAdminPasswordHash(plain){
  PropertiesService.getScriptProperties().setProperty(SUPER_PASS_HASH_PROP, hashPassword(plain));
}
function handleLogin(loginId,password){
  if(!loginId||!password) return jsonResponse({success:false,error:'請填寫帳號和密碼'});
  if(isSuperAdminId(loginId)){
    if(hashPassword(String(password))!==getSuperAdminPasswordHash()) return jsonResponse({success:false,error:'密碼錯誤'});
    const su=getUser(SUPER_ADMIN_LOGIN);
    try{ PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_LAST_LOGIN', now()); }catch(e){}
    return jsonResponse({success:true,token:createToken(SUPER_ADMIN_LOGIN),user:su});
  }
  let user=(/^\d{10}$/.test(loginId)||/^L\d+/.test(loginId))? getUser(loginId): getUserByEmail(loginId);
  if(!user){ user=getUser(loginId)||getUserByEmail(loginId); }
  if(!user) return jsonResponse({success:false,error:'找不到此帳號'});
  const hash=hashPassword(password);
  const sheet=getSheet().getSheetByName('Users'); const data=sheet.getDataRange().getValues();
  const hasFcpCol=sheet.getLastColumn()>=16;
  for(let i=1;i<data.length;i++){
    if(data[i][11].toString()==='active' && data[i][4].toString()===hash){
      const rowY=data[i][0].toString(); const rowE=data[i][2].toString().toLowerCase();
      if(rowY===user.ymis || rowE===user.email.toLowerCase() || rowY===loginId){
        const token=createToken(user.ymis);
        sheet.getRange(i+1,11).setValue(now());
        const fcp=hasFcpCol ? (data[i][15]===true || String(data[i][15]).toUpperCase()==='TRUE') : false;
        return jsonResponse({success:true,token:token,user:user,force_change_password:fcp});
      }
    }
  }
  return jsonResponse({success:false,error:'密碼錯誤'});
}
function handleChangePassword(ymis,oldP,newP){
  if(!newP || newP.length<6) return jsonResponse({success:false,error:'新密碼至少6位'});
  if(newP.length>32) return jsonResponse({success:false,error:'新密碼不可超過32位'});
  if(newP===String(oldP||'')) return jsonResponse({success:false,error:'新密碼不可與原密碼相同'});
  if(isSuperAdminId(ymis)){
    if(hashPassword(String(oldP||''))!==getSuperAdminPasswordHash()) return jsonResponse({success:false,error:'原密碼錯誤'});
    setSuperAdminPasswordHash(newP);
    writeAudit(ymis,'change_password',ymis,'用戶自行更改密碼（超管虛擬帳號）');
    return jsonResponse({success:true,message:'密碼已更新'});
  }
  const sheet=getSheet().getSheetByName('Users'); const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0].toString()===ymis && data[i][11].toString()==='active'){
      if(data[i][4].toString()===hashPassword(oldP)){
        sheet.getRange(i+1,5).setValue(hashPassword(newP));
        if(sheet.getLastColumn()>=16) sheet.getRange(i+1,16).setValue(false);
        writeAudit(ymis,'change_password',ymis,'自行修改密碼');
        return jsonResponse({success:true});
      }
    }
  }
  return jsonResponse({success:false,error:'原密碼錯誤'});
}
function handleApply(ymis,name,email,role,branch){
  if(!name) return jsonResponse({success:false,error:'請填寫姓名'});
  if(role==='member' && (!ymis||ymis.length!==10)) return jsonResponse({success:false,error:'成員需 10位 YMIS'});
  if(role!=='member' && !email) return jsonResponse({success:false,error:'領袖需 Email'});
  if(isSuperAdminReserved(ymis,email)) return jsonResponse({success:false,error:'此帳號已被保留，請使用其他帳號'});
  if(ymis && getUser(ymis)) return jsonResponse({success:false,error:'YMIS 已註冊'});
  if(email && getUserByEmail(email)) return jsonResponse({success:false,error:'Email 已註冊'});
  const sheet=getSheet().getSheetByName('Applications');
  sheet.appendRow(['APP_'+Date.now(),ymis||'',name,email||'',role||'member',branch||APP_SECTION,'pending',now(),'','', '']);
  return jsonResponse({success:true,message:'申請已提交'});
}
function handleGetApplications(){
  const sheet=getSheet().getSheetByName('Applications'); const apps=[]; const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(data[i][6].toString()==='pending'){ apps.push({app_id:data[i][0].toString(),ymis:data[i][1].toString(),name:data[i][2].toString(),email:data[i][3].toString(),requested_role:data[i][4].toString(),branch:data[i][5].toString(),applied_at:data[i][7]?formatDate(data[i][7]):''}); } }
  return jsonResponse({success:true,applications:apps});
}
function handleReviewApplication(appId,decision,note,reviewer){
  const sheet=getSheet().getSheetByName('Applications'); const data=sheet.getDataRange().getValues(); let appData=null;
  for(let i=1;i<data.length;i++){ if(data[i][0].toString()===appId){ appData=data[i]; sheet.getRange(i+1,7).setValue(decision); sheet.getRange(i+1,9).setValue(reviewer); sheet.getRange(i+1,10).setValue(now()); sheet.getRange(i+1,11).setValue(note||''); writeAudit(reviewer,'review_application',appId,decision+' '+String(appData[2]||'')); break; } }
  if(!appData) return jsonResponse({success:false,error:'找不到申請'});
  if(decision==='approved'){
    const uSheet=getSheet().getSheetByName('Users'); let ymis=appData[1].toString(); if(!ymis && (appData[4]==='group_leader'||appData[4]==='branch_leader')){ ymis='L'+Date.now().toString().substring(7); }
    if(isSuperAdminReserved(ymis,appData[3])) return jsonResponse({success:false,error:'此帳號已被保留，不能開戶'});
    uSheet.appendRow([ymis,appData[2],appData[3],appData[4],hashPassword(ADMIN_PASS),appData[5],true,reviewer,now(),now(),'', 'active','*','','member',true]);
    const mSheet=getSheet().getSheetByName('成員名單'); if(mSheet) mSheet.appendRow([ymis,appData[2],new Date(),appData[5],'','']);
    return jsonResponse({success:true,message:'已批准，預設密碼：'+ADMIN_PASS});
  }
  return jsonResponse({success:true,message:'已拒絕'});
}
function handleUpdateUserRole(targetYmis,newRole,canTick,managerYmis, allowedBadges, squad, squadRole){
  const manager=getUser(managerYmis);
  if(!manager) return jsonResponse({success:false,error:'找不到管理員'});
  if(manager.role!=='super_admin' && !canManageRole(manager.role,newRole) && manager.role!=='admin') return jsonResponse({success:false,error:'權限不足，你的等級不可設定此角色'});
  const sheet=getSheet().getSheetByName('Users'); const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0].toString()===targetYmis && data[i][11].toString()==='active'){
      if(newRole) sheet.getRange(i+1,4).setValue(newRole);
      if(canTick!==undefined && canTick!==null) sheet.getRange(i+1,7).setValue(canTick);
      sheet.getRange(i+1,8).setValue(managerYmis);
      sheet.getRange(i+1,9).setValue(now());
      if(sheet.getLastColumn()>=14 && squad!==undefined) sheet.getRange(i+1,14).setValue(squad||'');
      if(sheet.getLastColumn()>=15 && squadRole!==undefined) sheet.getRange(i+1,15).setValue(squadRole||'member');
      if(sheet.getLastColumn()>=13){
        if(allowedBadges!==undefined && allowedBadges!==null){
          sheet.getRange(i+1,13).setValue(allowedBadges);
        } else {
          if(!data[i][12]){
            let def='*';
            if(newRole==='member') def='';
            else def='*';
            sheet.getRange(i+1,13).setValue(def);
          }
        }
      }
      writeAudit(managerYmis,'update_role',targetYmis,'role='+newRole+' can_tick='+canTick);
      return jsonResponse({success:true});
    }
  }
  return jsonResponse({success:false,error:'找不到用戶'});
}
function getConfigMap(){
  const sheet=getSheet().getSheetByName('SystemConfig');
  const cfg={};
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){ if(data[i][0]) cfg[data[i][0].toString()]=data[i][1]?data[i][1].toString():''; }
  }
  if(!cfg['allow_member_view_others']) cfg['allow_member_view_others']='false';
  if(!cfg['member_progress_scope']) cfg['member_progress_scope']='private';
  if(!cfg['allow_squad_comparison']) cfg['allow_squad_comparison']='false';
  if(!cfg['allow_member_requests']) cfg['allow_member_requests']='false';
  return cfg;
}
function handleUpdateConfig(key,value,ymis){
  const sheet=getSheet().getSheetByName('SystemConfig'); const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(data[i][0]===key){ sheet.getRange(i+1,2).setValue(value); sheet.getRange(i+1,3).setValue(now()); sheet.getRange(i+1,4).setValue(ymis); writeAudit(ymis,'update_config',key,value); return jsonResponse({success:true}); } }
  sheet.appendRow([key,value,now(),ymis]); writeAudit(ymis,'update_config',key,value); return jsonResponse({success:true});
}
function handleGetConfig(){
  const cfg=getConfigMap();
  return jsonResponse({success:true,config:cfg});
}
function getMembers(){
  const mSheet=getSheet().getSheetByName('成員名單'); const members=[];
  if(mSheet){
    const data=mSheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      const y=data[i][0] ? data[i][0].toString() : '';
      const branch=data[i][3] ? data[i][3].toString() : '';
      if(y && !isSystemAccount(y, '') && isCubBranch(branch)) members.push({ymis:y,name:data[i][1]?data[i][1].toString():'',squad:data[i][5]?data[i][5].toString():''});
    }
  }
  const uSheet=getSheet().getSheetByName('Users');
  if(uSheet){
    const data=uSheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      const y=data[i][0] ? data[i][0].toString() : '';
      const role=data[i][3] ? data[i][3].toString() : 'member';
      const branch=data[i][5] ? data[i][5].toString() : '';
      if(isSuperAdminReserved(y, data[i][2])) continue;
      if(data[i][11].toString()==='active' && y && !isSystemAccount(y,role) && isCubBranch(branch) && !members.some(m=>m.ymis===y)){
        members.push({ymis:y,name:data[i][1]?data[i][1].toString():'',squad:data[i][13]?data[i][13].toString():''});
      }
    }
  }
  return members;
}
function removeSuperAdminRows(){
  try{
    const u=getSheet().getSheetByName('Users');
    if(u){ const d=u.getDataRange().getValues(); for(let i=d.length-1;i>=1;i--){ if(isSuperAdminReserved(d[i][0],d[i][2])) u.deleteRow(i+1); } }
  }catch(e){}
  try{
    const m=getSheet().getSheetByName('成員名單');
    if(m){ const d=m.getDataRange().getValues(); for(let i=d.length-1;i>=1;i--){ if(isSuperAdminId(d[i][0])) m.deleteRow(i+1); } }
  }catch(e){}
}
function handleLoad(loadUser){
  const ss=getSheet();
  const pSheet=ss.getSheetByName('進度追蹤'); const progress={};
  const members=getMembers();
  const memberIds={}; members.forEach(function(m){ memberIds[m.ymis]=true; });
  if(pSheet){ const data=pSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ const ymis=data[i][0].toString(); if(!ymis || !memberIds[ymis]) continue; if(!progress[ymis]) progress[ymis]={}; progress[ymis][data[i][1].toString()]={date:data[i][2]?formatDate(data[i][2]):'',confirmer:data[i][4]?data[i][4].toString():''}; } }
  const flat={}; for(const y in progress){ flat[y]={}; for(const k in progress[y]){ flat[y][k]=progress[y][k].date; } }
  const prSheet=ss.getSheetByName('待批完成'); const pending=[];
  if(prSheet){ const data=prSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][7].toString()==='pending' && memberIds[data[i][1].toString()]){ pending.push({request_id:data[i][0].toString(),ymis:data[i][1].toString(),name:data[i][2].toString(),item_id:data[i][3].toString(),item_name:data[i][4].toString(),requested_date:data[i][5]?formatDate(data[i][5]):'',evidence:data[i][6]?data[i][6].toString():'',status:'pending',created_at:data[i][8]?formatDate(data[i][8]):''}); } } }
  const oSheet=ss.getSheetByName('其他獎章'); const other={};
  if(oSheet){ const data=oSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ const y=data[i][0].toString(); if(!y || !memberIds[y]) continue; if(!other[y]) other[y]={}; other[y][data[i][1].toString()]={name:data[i][2]?data[i][2].toString():'',date:data[i][3]?formatDate(data[i][3]):'',cert:data[i][4]?data[i][4].toString():''}; } }
  const lSheet=ss.getSheetByName(LOG_SHEET_NAME);
  const lrSheet=ss.getSheetByName(LOG_REQ_SHEET_NAME);
  const isLogReviewer=!!(loadUser && canUserTick(loadUser.role));
  const logReqList=(lrSheet && loadUser) ? getLogRequestsList(isLogReviewer?null:loadUser.ymis) : [];
  const cfg=getConfigMap();
  const canMemberViewOthers = cfg['allow_member_view_others']==='true';
  // For non-leader and private mode, logs are filtered to own only inside getLogRecordsList
  return jsonResponse({success:true,section:APP_SECTION,members:members,progress:progress,flatProgress:flat,pendingRequests:pending,otherBadges:other,logs:getLogRecordsList(loadUser?(canUserTick(loadUser.role)?null:loadUser.ymis):null, !!loadUser&&canUserTick(loadUser.role)),logsSupported:!!lSheet,logRequests:logReqList,logRequestsSupported:!!lrSheet,config:cfg});
}
function handleSave(changes, confirmer){
  const sheet=getSheet().getSheetByName('進度追蹤'); if(!sheet) return jsonResponse({success:false,error:'Sheet not found'});
  let processed=0;
  changes.forEach(function(c){
    const data=sheet.getDataRange().getValues(); let found=false;
    for(let i=1;i<data.length;i++){
      if(data[i][0].toString()===c.ymis && data[i][1].toString()===c.itemId){
        if(c.uncomplete){ sheet.deleteRow(i+1); } else { sheet.getRange(i+1,3).setValue(c.date); sheet.getRange(i+1,4).setValue(new Date()); sheet.getRange(i+1,5).setValue(confirmer||c.confirmer||''); sheet.getRange(i+1,6).setValue(c.note||''); }
        found=true; processed++; break;
      }
    }
    if(!found && !c.uncomplete){
      sheet.appendRow([c.ymis,c.itemId,c.date,new Date(),confirmer||c.confirmer||'',c.note||'']);
      processed++;
    }
  });
  if(confirmer) writeAudit(confirmer,'save_progress','',processed+' items');
  return jsonResponse({success:true,processed:processed});
}
function handleAddMember(ymis,name,squad,managerYmis, squadRole){
  let sheet=getSheet().getSheetByName('成員名單');
  if(!sheet){ sheet=getSheet().insertSheet('成員名單'); sheet.appendRow(['YMIS','姓名','加入日期','支部','聯絡','小隊']); }
  sheet.appendRow([ymis,name,new Date(),APP_SECTION,'',squad||'']);
  if(managerYmis) writeAudit(managerYmis,'add_member',ymis,'新增成員 '+(name||'')+(squad?' ['+squad+']':''));
  return jsonResponse({success:true,message:'成員已新增'});
}
function handleAddUser(body, managerYmis){
  const ymis=(body.ymis||'').toString().trim();
  const name=(body.name||'').toString().trim();
  const role=(body.role||'member').toString().trim();
  const password=(body.password||'').toString();
  const squad=(body.squad||'').toString().trim();
  const squadRole=(body.squad_role||'member').toString().trim();
  const canTick=body.can_tick===true||body.can_tick==='true'||body.can_tick==='TRUE';
  if(!/^\d{10}$/.test(ymis)) return jsonResponse({success:false,error:'YMIS 須為 10 位數字'});
  if(!name) return jsonResponse({success:false,error:'請填寫姓名'});
  if(ROLE_HIERARCHY[role]===undefined) return jsonResponse({success:false,error:'角色無效'});
  if(getUser(ymis)) return jsonResponse({success:false,error:'YMIS 已註冊'});
  if(body.email && getUserByEmail(body.email)) return jsonResponse({success:false,error:'Email 已註冊'});
  const uSheet=getSheet().getSheetByName('Users');
  if(!uSheet) return jsonResponse({success:false,error:'找不到 Users 工作表，請先執行 initializeSheets'});
  const headers=uSheet.getRange(1,1,1,uSheet.getLastColumn()).getValues()[0].map(function(h){return String(h).trim();});
  const row=new Array(headers.length).fill('');
  function set(n,v){ const c=headers.indexOf(n); if(c>=0) row[c]=v; }
  const nowStr=now();
  set('ymis',ymis); set('name',name); set('email',(body.email||'').toString().trim());
  set('role',role); set('branch',APP_SECTION);
  set('squad',squad); set('squad_role',squadRole);
  set('can_tick',canTick);
  if(password){
    set('password_hash',hashPassword(password));
    set('auth_by','bulk_onboard'); set('auth_date',nowStr);
    set('status','active');
    set('allowed_badges', role==='member'?'':'*');
    set('force_change_password',true);
  } else {
    set('status','active');
  }
  set('created_at',nowStr);
  uSheet.appendRow(row);
  if(role==='member'){
    let mSheet=getSheet().getSheetByName('成員名單');
    if(!mSheet){ mSheet=getSheet().insertSheet('成員名單'); mSheet.appendRow(['YMIS','姓名','加入日期','支部','聯絡','小隊']); }
    mSheet.appendRow([ymis,name,new Date(),APP_SECTION,'',squad]);
  }
  if(managerYmis) writeAudit(managerYmis,'add_user',ymis,'開立帳號 '+(name||'')+' role='+role+(password?'':'（無密碼-純成員）'));
  return jsonResponse({success:true,message:'帳號已建立'+(password?'（首次登入會要求改密）':'（純成員，未設密碼）')});
}
function handleResetPassword(targetYmis, managerYmis){
  const sheet=getSheet().getSheetByName('Users'); if(!sheet) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===String(targetYmis) && data[i][11].toString()==='active'){
      const temp='Cub'+Math.floor(100000+Math.random()*900000);
      sheet.getRange(i+1,5).setValue(hashPassword(temp));
      if(sheet.getLastColumn()>=16) sheet.getRange(i+1,16).setValue(true);
      writeAudit(managerYmis,'reset_password',targetYmis,'重設為一次性密碼');
      return jsonResponse({success:true,temp_password:temp,message:'已重設，請將一次性密碼交給成員'});
    }
  }
  return jsonResponse({success:false,error:'找不到用戶'});
}
function handleDeactivateUser(body, managerYmis){
  const ymis=(body.target_ymis||'').toString().trim();
  if(!ymis) return jsonResponse({success:false,error:'請提供 YMIS'});
  if(isSystemAccount(ymis,'') || isSuperAdminId(ymis)) return jsonResponse({success:false,error:'不能停用系統維護帳號'});
  if(managerYmis===ymis) return jsonResponse({success:false,error:'不能停用自己'});
  const manager=getUser(managerYmis); if(!manager) return jsonResponse({success:false,error:'找不到管理員'});
  const target=getUser(ymis); if(!target) return jsonResponse({success:false,error:'找不到用戶'});
  if(manager.role!=='super_admin' && !canManageRole(manager.role,target.role)) return jsonResponse({success:false,error:'權限不足，不能停用該角色'});
  const sheet=getSheet().getSheetByName('Users'); const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(data[i][0].toString()===ymis && data[i][11].toString()==='active'){
      sheet.getRange(i+1,12).setValue('inactive');
      try{
        const tSheet=getSheet().getSheetByName('Tokens');
        if(tSheet){
          const td=tSheet.getDataRange().getValues();
          for(let j=td.length-1;j>=1;j--){ if(td[j][1] && td[j][1].toString()===ymis) tSheet.deleteRow(j+1); }
        }
      }catch(e){}
      writeAudit(managerYmis,'deactivate_user',ymis,'停用帳號 '+(target.name||''));
      return jsonResponse({success:true,message:'已停用'});
    }
  }
  return jsonResponse({success:false,error:'找不到用戶'});
}
function writeAudit(actor,action,target,detail){
  const sh=getSheet().getSheetByName('操作紀錄'); if(sh) sh.appendRow([now(),actor,action,target,detail||'']);
}
function handleGetAuditLog(){
  const sh=getSheet().getSheetByName('操作紀錄'); const out=[];
  if(sh){ const d=sh.getDataRange().getValues(); for(let i=Math.max(1,d.length-200);i<d.length;i++){ out.push(d[i]); } }
  return jsonResponse({success:true,records:out});
}
function handleGetApprovalHistory(){
  const out=[];
  ['Applications','待批完成','待批履歷'].forEach(function(n){
    const sh=getSheet().getSheetByName(n); if(!sh) return;
    const d=sh.getDataRange().getValues();
    for(let i=1;i<d.length;i++){
      if(n==='Applications' && d[i][6] && d[i][6].toString()!=='pending'){
        out.push({type:'帳戶申請',id:String(d[i][0]),ymis:String(d[i][1]),name:String(d[i][2]),item:String(d[i][4]||''),status:String(d[i][6]),reviewer:String(d[i][8]||''),date:d[i][9]?formatDate(d[i][9]):''});
      }
      if(n==='待批完成' && d[i][7] && d[i][7].toString()!=='pending'){
        out.push({type:'進度申請',id:String(d[i][0]),ymis:String(d[i][1]),name:String(d[i][2]),item:String(d[i][4]||''),status:String(d[i][7]),reviewer:String(d[i][9]||''),date:d[i][10]?formatDate(d[i][10]):''});
      }
      if(n==='待批履歷' && d[i][12] && d[i][12].toString()!=='pending'){
        out.push({type:'履歷申報',id:String(d[i][0]),ymis:String(d[i][4]),name:String(d[i][5]),item:String(d[i][7]||''),status:String(d[i][12]),reviewer:String(d[i][14]||''),date:d[i][15]?formatDate(d[i][15]):''});
      }
    }
  });
  return jsonResponse({success:true,records:out});
}
function handleRequestComplete(body, requesterYmis){
  const sheet=getSheet().getSheetByName('待批完成'); if(!sheet) return jsonResponse({success:false,error:'Sheet not found'});
  const reqId='REQ_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
  const user=getUser(requesterYmis)||{name:body.name||requesterYmis};
  sheet.appendRow([reqId,requesterYmis,user.name||body.name,body.itemId,body.itemName||body.itemId,body.requested_date||formatDate(new Date()),body.evidence||'','pending',now(),'','','', '']);
  writeAudit(requesterYmis,'request_complete',requesterYmis,body.itemId+': '+body.itemName);
  return jsonResponse({success:true,request_id:reqId});
}
function handleGetPendingRequests(user){
  const sheet=getSheet().getSheetByName('待批完成'); const list=[];
  if(sheet){ const data=sheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][7].toString()==='pending'){ 
    if(!canUserTick(user.role) && String(data[i][1])!==String(user.ymis)) continue;
    list.push({request_id:data[i][0].toString(),ymis:data[i][1].toString(),name:data[i][2].toString(),item_id:data[i][3].toString(),item_name:data[i][4].toString(),requested_date:data[i][5]?formatDate(data[i][5]):'',evidence:data[i][6]?data[i][6].toString():'',status:'pending',created_at:data[i][8]?formatDate(data[i][8]):''}); } } }
  return jsonResponse({success:true,requests:list});
}
function handleReviewRequest(reqId,decision,note,reviewer,confirmed_date){
  const sheet=getSheet().getSheetByName('待批完成'); if(!sheet) return jsonResponse({success:false,error:'Sheet not found'});
  const data=sheet.getDataRange().getValues(); let row=null;
  for(let i=1;i<data.length;i++){ if(data[i][0].toString()===reqId){ row=data[i]; sheet.getRange(i+1,8).setValue(decision); sheet.getRange(i+1,10).setValue(reviewer); sheet.getRange(i+1,11).setValue(now()); sheet.getRange(i+1,12).setValue(note||''); sheet.getRange(i+1,13).setValue(confirmed_date||formatDate(new Date())); writeAudit(reviewer,'review_request',String(row[1]),decision+' '+String(row[3])); break; } }
  if(!row) return jsonResponse({success:false,error:'找不到申請'});
  if(decision==='approved'){
    const pSheet=getSheet().getSheetByName('進度追蹤');
    pSheet.appendRow([row[1],row[3],confirmed_date||row[5],new Date(),reviewer, '由申請轉入：'+(note||'')]);
    return jsonResponse({success:true,message:'已批准並寫入進度'});
  }
  return jsonResponse({success:true,message:'已拒絕'});
}
function handleGetOtherBadges(ymis){
  const sheet=getSheet().getSheetByName('其他獎章'); const list=[];
  if(sheet){ const data=sheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][0].toString()===ymis){ list.push({id:data[i][1].toString(),name:data[i][2].toString(),date:data[i][3]?formatDate(data[i][3]):'',cert:data[i][4]?data[i][4].toString():''}); } } }
  return jsonResponse({success:true,other:list});
}
function handleSaveOtherBadge(records){
  const sheet=getSheet().getSheetByName('其他獎章'); if(!sheet) return jsonResponse({success:false,error:'Sheet missing'});
  let c=0;
  records.forEach(function(r){
    const data=sheet.getDataRange().getValues(); let found=false;
    for(let i=1;i<data.length;i++){ if(data[i][0].toString()===r.ymis && data[i][1].toString()===r.badgeId){ 
      if(r.date===''){ sheet.deleteRow(i+1); } else { sheet.getRange(i+1,3).setValue(r.name||r.badgeId); sheet.getRange(i+1,4).setValue(r.date); sheet.getRange(i+1,5).setValue(r.cert||''); sheet.getRange(i+1,7).setValue(new Date()); }
      found=true; c++; break; } }
    if(!found && r.date!==''){ sheet.appendRow([r.ymis,r.badgeId,r.name||r.badgeId,r.date,r.cert||'','',new Date()]); c++; }
  });
  return jsonResponse({success:true,processed:c});
}

// ===== 活動履歷 =====
function getLogRecordsList(viewerYmis,isReviewer){
  const sheet=getSheet().getSheetByName(LOG_SHEET_NAME); const logs=[];
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      if(!data[i][0]) continue;
      if(!isReviewer && viewerYmis && String(data[i][2]||'')!==String(viewerYmis)) continue;
      logs.push({
        record_id:String(data[i][0]), type:String(data[i][1]||'activity'),
        ymis:String(data[i][2]||''), name:String(data[i][3]||''),
        date:data[i][4]?formatDate(data[i][4]):'', title:String(data[i][5]||''),
        role:String(data[i][6]||''), hours:String(data[i][7]||''),
        cert_no:String(data[i][8]||''), detail:String(data[i][9]||''),
        recorder:String(data[i][10]||''),
        recorded_at:data[i][11]?String(data[i][11]):''
      });
    }
  }
  return logs;
}
function handleGetLogRecords(user){
  if(!getSheet().getSheetByName(LOG_SHEET_NAME)) return jsonResponse({success:false,error:'「'+LOG_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  const isReviewer=!user || canUserTick(user.role);
  return jsonResponse({success:true,logs:getLogRecordsList(user&&!isReviewer?user.ymis:null, isReviewer)});
}
function sanitizeLogRecord(r){
  r=r||{};
  const type = LOG_TYPES.indexOf(r.type)>=0 ? r.type : 'activity';
  return {
    type: type,
    ymis: String(r.ymis||'').trim().substring(0,20),
    name: safeSheetText(r.name,60),
    date: String(r.date||'').substring(0,20),
    title: safeSheetText(r.title,120),
    role: type==='training' ? '學員' : safeSheetText(r.role,60),
    hours: type==='training' ? '' : String(r.hours==null?'':r.hours).substring(0,20),
    cert_no: safeSheetText(r.cert_no,60),
    detail: safeSheetText(r.detail,500)
  };
}
function handleSaveLogRecord(records, recorderYmis, recorderName){
  const sheet=getSheet().getSheetByName(LOG_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'「'+LOG_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  if(!Array.isArray(records)||records.length===0) return jsonResponse({success:false,error:'沒有可儲存的紀錄'});
  if(records.length>200) return jsonResponse({success:false,error:'一次最多 200 筆，請分批'});
  const results=[]; let processed=0;
  records.forEach(function(r){
    const rec=sanitizeLogRecord(r);
    if(!rec.ymis||!rec.title||!rec.date){ results.push({success:false,ymis:rec.ymis,title:rec.title,error:'YMIS、名稱及日期必填'}); return; }
    const rid=String((r&&r.record_id)||'');
    if(rid){
      const data=sheet.getDataRange().getValues();
      for(let i=1;i<data.length;i++){
        if(String(data[i][0])===rid){
          sheet.getRange(i+1,2,1,12).setValues([[rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,sheet.getRange(i+1,11).getValue()||recorderName||recorderYmis,String(data[i][11]||''),now()]]);
          results.push({success:true,record_id:rid}); processed++;
          writeAudit(recorderYmis,'update_log',rec.ymis,rec.type+': '+rec.title+' '+rec.date);
          return;
        }
      }
      results.push({success:false,record_id:rid,error:'找不到紀錄'}); return;
    }
    const newId='LOG_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
    sheet.appendRow([newId,rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,recorderName||recorderYmis,now(),'']);
    results.push({success:true,record_id:newId}); processed++;
    writeAudit(recorderYmis,'add_log',rec.ymis,rec.type+': '+rec.title+' '+rec.date);
  });
  const failed=results.filter(function(x){return !x.success;}).length;
  return jsonResponse({success:(results.length>0&&failed===0),processed:processed,results:results,message:processed+' 筆已儲存'+(failed?'，'+failed+' 筆失敗':'')});
}
function handleDeleteLogRecord(recordId, recorderYmis){
  const sheet=getSheet().getSheetByName(LOG_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'「'+LOG_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  recordId=String(recordId||'');
  if(!recordId) return jsonResponse({success:false,error:'缺少 record_id'});
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===recordId){
      const label=String(data[i][1]||'')+': '+String(data[i][5]||'')+' '+String(data[i][4]||'');
      const target=String(data[i][2]||'');
      sheet.deleteRow(i+1);
      writeAudit(recorderYmis,'delete_log',target,label);
      return jsonResponse({success:true,message:'已刪除紀錄'});
    }
  }
  return jsonResponse({success:false,error:'找不到紀錄'});
}

// ===== v5.2 活動履歷申報（家長=成員帳號 填寫，領袖審批）=====
function getLogRequestsList(onlyYmis){
  const sheet=getSheet().getSheetByName(LOG_REQ_SHEET_NAME); const list=[];
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      if(!data[i][0] || String(data[i][12])!=='pending') continue;
      if(onlyYmis!==null && onlyYmis!==undefined && onlyYmis!=='' && String(data[i][4])!==String(onlyYmis)) continue;
      list.push({
        request_id:String(data[i][0]), kind:String(data[i][1]||'new'),
        target_record_id:String(data[i][2]||''), type:String(data[i][3]||'activity'),
        ymis:String(data[i][4]||''), name:String(data[i][5]||''),
        date:data[i][6]?formatDate(data[i][6]):'', title:String(data[i][7]||''),
        role:String(data[i][8]||''), hours:String(data[i][9]||''),
        cert_no:String(data[i][10]||''), detail:String(data[i][11]||''),
        status:'pending', created_at:data[i][13]?String(data[i][13]):''
      });
    }
  }
  return list;
}
function handleRequestLogRecord(body, user){
  const sheet=getSheet().getSheetByName(LOG_REQ_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'「'+LOG_REQ_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  const rec=sanitizeLogRecord(body.record||{});
  rec.ymis=String(user.ymis); rec.name=safeSheetText(user.name||rec.name,60);
  if(!rec.title||!rec.date) return jsonResponse({success:false,error:'名稱及日期必填'});
  const kind=body.kind==='edit'?'edit':'new';
  let targetId='';
  if(kind==='edit'){
    targetId=String(body.target_record_id||'');
    if(!targetId) return jsonResponse({success:false,error:'缺少 target_record_id'});
    const lSheet=getSheet().getSheetByName(LOG_SHEET_NAME);
    if(!lSheet) return jsonResponse({success:false,error:'「'+LOG_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
    const ld=lSheet.getDataRange().getValues(); let found=null;
    for(let i=1;i<ld.length;i++){ if(String(ld[i][0])===targetId){ found=ld[i]; break; } }
    if(!found) return jsonResponse({success:false,error:'找不到原紀錄，可能已被刪除，請重新載入'});
    if(String(found[2])!==String(user.ymis) && !canUserTick(user.role)) return jsonResponse({success:false,error:'只可申請修改自己的紀錄（領袖可直接編輯）'});
    if(LOG_TYPES.indexOf(String(found[1]))>=0) rec.type=String(found[1]);
    const rd=sheet.getDataRange().getValues();
    for(let i=1;i<rd.length;i++){ if(String(rd[i][2])===targetId && String(rd[i][12])==='pending') return jsonResponse({success:false,error:'此紀錄已有待批修改申報，請等待領袖審批或先取消'}); }
  }
  const reqId='LREQ_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
  sheet.appendRow([reqId,kind,targetId,rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,'pending',now(),'','','']);
  writeAudit(user.ymis, kind==='edit'?'request_log_edit':'request_log_new', rec.ymis, rec.type+': '+rec.title+' '+rec.date+(targetId?'（原紀錄 '+targetId+'）':''));
  return jsonResponse({success:true,request_id:reqId,message:'申報已提交，待領袖審批'});
}
function handleGetLogRequests(user){
  if(!getSheet().getSheetByName(LOG_REQ_SHEET_NAME)) return jsonResponse({success:false,error:'「'+LOG_REQ_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  const isReviewer=canUserTick(user.role);
  return jsonResponse({success:true,requests:getLogRequestsList(isReviewer?null:user.ymis)});
}
function handleReviewLogRequest(requestId, decision, note, reviewer){
  if(decision!=='approved' && decision!=='rejected') return jsonResponse({success:false,error:'無效決定'});
  const sheet=getSheet().getSheetByName(LOG_REQ_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'「'+LOG_REQ_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  const data=sheet.getDataRange().getValues(); let rowIndex=-1,row=null;
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(requestId)){ rowIndex=i+1; row=data[i]; break; } }
  if(!row || String(row[12])!=='pending') return jsonResponse({success:false,error:'找不到待批申報'});
  const kind=String(row[1]||'new');
  const rec={
    type:String(row[3]||'activity'), ymis:String(row[4]||''), name:String(row[5]||''),
    date:row[6]?formatDate(row[6]):'', title:String(row[7]||''), role:String(row[8]||''),
    hours:String(row[9]||''), cert_no:String(row[10]||''), detail:String(row[11]||'')
  };
  if(decision==='rejected'){
    sheet.getRange(rowIndex,13).setValue('rejected'); sheet.getRange(rowIndex,15).setValue(reviewer.ymis); sheet.getRange(rowIndex,16).setValue(now()); sheet.getRange(rowIndex,17).setValue(note||'');
    writeAudit(reviewer.ymis, kind==='edit'?'reject_log_edit':'reject_log_new', rec.ymis, rec.type+': '+rec.title+' '+rec.date);
    return jsonResponse({success:true,message:'已拒絕申報'});
  }
  const lSheet=getSheet().getSheetByName(LOG_SHEET_NAME);
  if(!lSheet) return jsonResponse({success:false,error:'「'+LOG_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  let recordId=''; let recorder='';
  if(kind==='edit'){
    const targetId=String(row[2]||'');
    const ld=lSheet.getDataRange().getValues(); let li=-1;
    for(let i=1;i<ld.length;i++){ if(String(ld[i][0])===targetId){ li=i; break; } }
    if(li<0) return jsonResponse({success:false,error:'找不到原紀錄（可能已被刪除），無法批准修改'});
    recorder=String(ld[li][10]||'');
    lSheet.getRange(li+1,2,1,12).setValues([[rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,recorder,String(ld[li][11]||''),now()]]);
    recordId=targetId;
  }else{
    recordId='LOG_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
    recorder=rec.name+'（自行申報 / 家長申報）';
    lSheet.appendRow([recordId,rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,recorder,now(),'']);
  }
  sheet.getRange(rowIndex,13).setValue('approved'); sheet.getRange(rowIndex,15).setValue(reviewer.ymis); sheet.getRange(rowIndex,16).setValue(now()); sheet.getRange(rowIndex,17).setValue(note||'');
  writeAudit(reviewer.ymis, kind==='edit'?'approve_log_edit':'approve_log_new', rec.ymis, rec.type+': '+rec.title+' '+rec.date+'（'+recordId+'）');
  return jsonResponse({success:true,message:kind==='edit'?'已批准修改並更新紀錄':'已批准並寫入活動履歷',record_id:recordId,record:{record_id:recordId,type:rec.type,ymis:rec.ymis,name:rec.name,date:rec.date,title:rec.title,role:rec.role,hours:rec.hours,cert_no:rec.cert_no,detail:rec.detail,recorder:recorder}});
}
function handleCancelLogRequest(requestId, user){
  const sheet=getSheet().getSheetByName(LOG_REQ_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'「'+LOG_REQ_SHEET_NAME+'」工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  requestId=String(requestId||'');
  if(!requestId) return jsonResponse({success:false,error:'缺少 request_id'});
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===requestId){
      if(String(data[i][12])!=='pending') return jsonResponse({success:false,error:'此申報已被審批，不能取消'});
      const isReviewer=canUserTick(user.role);
      if(!isReviewer && String(data[i][4])!==String(user.ymis)) return jsonResponse({success:false,error:'只可取消自己的申報'});
      const label=String(data[i][3]||'')+': '+String(data[i][7]||'')+' '+String(data[i][6]||'');
      sheet.deleteRow(i+1);
      writeAudit(user.ymis,'cancel_log_request',String(data[i][4]||''),label);
      return jsonResponse({success:true,message:'已取消申報'});
    }
  }
  return jsonResponse({success:false,error:'找不到申報'});
}
