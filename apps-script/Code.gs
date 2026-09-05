// ============================================================
// 童軍支部進度及行政平台 - Apps Script 後端 v5.2
// 完全兼容舊版 + 新增待批申請、批量寫入優化、日誌
// v5.2 新增（對齊 VSBADGE v8.4/v8.5，中英文對照）：
//   活動履歷「團員自行申報 → 領袖審批」/ Activity-log claims: members self-declare, leaders approve
//   - 新工作表「待批履歷」（執行 initializeSheets() 自動補建，不影響既有資料）
//     New sheet "待批履歷" (pending log claims); auto-created by initializeSheets(), existing data untouched
//   - 新 action：requestLogRecord（團員申報新增／修改）/ getLogRequests / reviewLogRequest / cancelLogRequest
//   - 團員只可為自己申報；「修改申報」只限自己的紀錄，批准後以同一 record_id 更新（需領袖重批）
//     Members can only claim for themselves; edit-claims target own records only and, once approved,
//     update in place with the SAME record_id (leader re-approval required).
//   - 同一紀錄同時只可有一個待批修改申報；批准前可取消；全部寫入操作紀錄
//   - 進度待批（待批完成）及其他獎章流程不變：批准後只有領袖可改
//     Progress claims & other badges are unchanged: after approval only leaders may edit.
//   - handleLoad 回應新增 logRequests + logRequestsSupported
//   - 修復 handleSaveLogRecord setValues 欄數不符（13→12）的既有 bug / fix setValues column-count bug
// 超管 SHEEP（v5.2 確認與 VSBADGE v8.5 一致）/ Super-admin SHEEP:
//   - 登入 sheep / 0728 照樣有效（後門寫死在 handleLogin，本來就不靠 Sheet）
//     Login as sheep / 0728 still works (hardcoded backdoor in handleLogin; never relies on the Users sheet)
//   - Users 表／用戶管理／成員名單不會出現 sheep（getUser 虛擬帳號；getAllUsers/getMembers 排除）
//     sheep never appears in the Users sheet / user management / member list
//   - 防護保留：sheep 不能被停用／重設密碼／改角色／申請／批量開戶佔用保留帳號
//     Protected: sheep cannot be deactivated / password-reset / role-changed; reserved id/email blocked everywhere
// v5.2.1 新增（對齊 VSBADGE v8.2：帳戶自助申請支援領袖）:
//   - apply 只接受 requested_role = member / branch_leader（童軍無執委；團長／管理員須由現任管理層直接開立）
// v5.3.0：團長全團只可一位（addUser／updateUserRole 強制執行；審批只可開出 member／branch_leader）＋領袖免 YMIS（用電郵登入，留空自動編配內部 L 編號）＋開戶權限收緊（只可開立自己可管理的角色）
//   - 成員申請：YMIS 10 位必填；領袖申請：Email 必填，YMIS 選填（留空則批准時自動編配 L 開頭臨時編號）
//   - reviewApplication 按申請角色開戶（審批者權限不足時退回 member），回應加 final_role + temp_password
//   - 無新工作表、無新欄位（force_change_password 欄若缺會自動補）：覆蓋 Code.gs 並重新部署即可，毋須 initializeSheets()
// v5.3.2（修復 SCOUTBADGE 用戶回報的同類問題）：
//   1) YMIS／Email 全表唯一（包括已停用帳號）：apply／addUser／bulkAddUsers／reviewApplication／addMember
//      全面改為掃描 Users 全部列（不限 active），同一 YMIS／Email 不可再開第二個帳號；
//      舊帳號已停用時提示改用「重新啟用」，不再產生重複列（重複列曾導致重設密碼寫錯列）。
//   2) 用戶管理不再漏成員：
//      a. Users 讀取改為「按表頭名稱」解析（防止人手調動欄位後讀錯欄），status 空白視為 active（舊資料相容）；
//      b. 只在「成員名單」而無帳號的純成員，會合併顯示在 getAllUsers（member_only 標記），可修改／刪除；
//      c. 已停用帳號可傳 include_inactive:true 一併列出，供「重新啟用」。
//   3) 領袖可直接在用戶管理設定成員密碼：resetPassword 支援 new_password（留空＝預設 1234），
//      首次登入仍強制改密；並加入權限檢查（只可為自己可管理角色的用戶重設）。
//      純成員（無帳號）設定密碼時會即場開通帳號。
//   4) 新 action：reactivateUser（重新啟用已停用帳號，密碼重設為預設並強制改密）、
//      updateMemberEntry（改名／小隊，同步 Users＋成員名單）、deleteMemberEntry（移出成員名單，有帳號則一併停用）。
//   5) 修復 getUser(null) 在空值上呼叫 toString 的潛在崩潰。
//   無新工作表、無新欄位：覆蓋 Code.gs 並重新部署即可。
// ============================================================

const ADMIN_YMIS = '1111111111';
// SHEEP 是隱藏維護帳戶，只能由後端以固定憑證登入，永不列入用戶清單
// SHEEP is the hidden maintenance account: it exists only in code (hardcoded backdoor in handleLogin),
// is never written to the Users sheet, and never appears in user management / member lists.
const SUPER_ADMIN_LOGIN = 'sheep';
const SUPER_ADMIN_EMAIL = 'sheep@cubbadge.local';
const SUPER_ADMIN_PASSWORD = '0728';
// 保留帳號檢查：任何申請／開戶／改角色都不可佔用 sheep / sheep@cubbadge.local
// Reserved-account guard: no apply / addUser / bulk / role-edit may take over sheep or its email.
function isSuperAdminId(id){
  const v=String(id||'').trim().toLowerCase();
  return v===SUPER_ADMIN_LOGIN || v===SUPER_ADMIN_EMAIL;
}
function isSuperAdminReserved(ymis,email){
  return String(ymis||'').trim().toLowerCase()===SUPER_ADMIN_LOGIN ||
         (String(email||'').trim()!=='' && String(email).trim().toLowerCase()===SUPER_ADMIN_EMAIL);
}
const ADMIN_NAME = '管理員';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'changeme';
// v5.3.1（對齊 SCOUTBADGE／VSBADGE）：申請批核後初始臨時密碼統一預設 1234；
// 首次登入強制改密（最少 MIN_PASSWORD_LEN 位）後才可使用。
const MIN_PASSWORD_LEN = 4;
const MAX_PASSWORD_LEN = 128;
const DEFAULT_TEMP_PASSWORD = '1234';

// ===== 工具 =====
function getSheet() { return SpreadsheetApp.getActiveSpreadsheet(); }
function getApiKey() {
  const props = PropertiesService.getScriptProperties();
  let apiKey = props.getProperty('API_KEY');
  if (!apiKey) {
    apiKey = 'sc_' + Utilities.getUuid().replace(/-/g, '').substring(0, 24);
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
  let sh=ss.getSheetByName('服務紀錄'); if(!sh){ sh=ss.insertSheet('服務紀錄'); sh.appendRow(['record_id','YMIS','姓名','活動名稱','日期','時數','機構／地點','內容','核實領袖','狀態','備註']); sh.getRange(1,1,1,11).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF'); sh.setFrozenRows(1); }
  let ah=ss.getSheetByName('操作紀錄'); if(!ah){ ah=ss.insertSheet('操作紀錄'); ah.appendRow(['時間','操作者','操作','對象','詳情']); ah.getRange(1,1,1,5).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF'); ah.setFrozenRows(1); }

  // v5.1：活動履歷（服務／活動／訓練班紀錄，統一用 type 欄位區分）
  let lSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if(!lSheet){
    lSheet = ss.insertSheet(LOG_SHEET_NAME);
    lSheet.appendRow(LOG_HEADERS);
    lSheet.getRange(1,1,1,LOG_HEADERS.length).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    lSheet.setFrozenRows(1);
  }
  // v5.2：待批履歷（團員自行申報 → 領袖審批）
  let lrSheet0 = ss.getSheetByName(LOG_REQ_SHEET_NAME);
  if(!lrSheet0){
    lrSheet0 = ss.insertSheet(LOG_REQ_SHEET_NAME);
    lrSheet0.appendRow(LOG_REQ_HEADERS);
    lrSheet0.getRange(1,1,1,LOG_REQ_HEADERS.length).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    lrSheet0.setFrozenRows(1);
  }

  // 確保系統設定包含 allow_member_requests（默認 true）
  let cfgSheet = ss.getSheetByName('SystemConfig');
  if(cfgSheet){
    const cfgData=cfgSheet.getDataRange().getValues();
    let hasRequests=false;
    for(let i=1;i<cfgData.length;i++){ if(cfgData[i][0]==='allow_member_requests'){ hasRequests=true; break; } }
    if(!hasRequests){ cfgSheet.appendRow(['allow_member_requests','true',now(),'system']); }
  }

  const apiKey = getApiKey();
  const ui = SpreadsheetApp.getUi();
  if (ui) ui.alert('API Key', '你的 API Key：\n\n' + apiKey, ui.ButtonSet.OK);
  Logger.log('API Key: ' + apiKey);
  return apiKey;
}

// v5.1 活動履歷（服務／活動／訓練班紀錄）—— 參考 VSBADGE 設計
const LOG_SHEET_NAME = '活動履歷';
const LOG_HEADERS = ['record_id','type','ymis','name','date','title','role','hours','cert_no','detail','recorder','recorded_at','updated_at'];
const LOG_TYPES = ['service','activity','training'];
// v5.2 待批履歷（團員自行申報 → 領袖審批）/ Pending log claims (member self-declare → leader approves)
const LOG_REQ_SHEET_NAME = '待批履歷';
const LOG_REQ_HEADERS = ['request_id','kind','target_record_id','type','ymis','name','date','title','role','hours','cert_no','detail','status','created_at','reviewed_by','reviewed_at','review_note'];

// ===== 新增：診斷 82 旅 SHEET 健康狀態 v5.1.1 =====
const REQUIRED_SHEETS = [
  {name:'進度追蹤', headers:['YMIS','項目 ID','完成日期','更新時間','確認者','備註']},
  {name:'成員名單', headers:['YMIS','姓名','加入日期','支部','聯絡','小隊']},
  {name:'Users', headers:['ymis','name','email','role','password_hash','branch','can_tick','auth_by','auth_date','created_at','last_login','status','allowed_badges','squad','squad_role','force_change_password']},
  {name:'Applications', headers:['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note']},
  {name:'Tokens', headers:['token','ymis','created_at','expires_at']},
  {name:'SystemConfig', headers:['key','value','updated_at','updated_by']},
  {name:'待批完成', headers:['request_id','ymis','name','item_id','item_name','requested_date','evidence','status','created_at','reviewed_by','reviewed_at','review_note','confirmed_date']},
  {name:'其他獎章', headers:['YMIS','獎章 ID','獎章名稱','完成日期','證書編號','備註','更新時間']},
  {name:'服務紀錄', headers:['record_id','YMIS','姓名','活動名稱','日期','時數','機構／地點','內容','核實領袖','狀態','備註']},
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
    try{
      counts[s.getName()] = {rows: s.getLastRow(), cols: s.getLastColumn()};
    }catch(e){
      counts[s.getName()] = {error: e.toString()};
    }
  });
  REQUIRED_SHEETS.forEach(req=>{
    if(existing.indexOf(req.name)>=0) present.push(req.name);
    else missing.push(req.name);
  });
  // 特別檢查 Users 成員數量
  let usersCount = 0;
  let membersCount = 0;
  try{
    const u = ss.getSheetByName('Users');
    if(u) usersCount = Math.max(0, u.getLastRow()-1);
  }catch(e){}
  try{
    const m = ss.getSheetByName('成員名單');
    if(m) membersCount = Math.max(0, m.getLastRow()-1);
  }catch(e){}
  return {
    success: true,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    existing,
    missing,
    present,
    counts,
    usersCount,
    membersCount,
    allOk: missing.length===0,
    isEmpty: usersCount<=1 && membersCount<=1,
    message: missing.length===0 ? ( (usersCount<=1 ? '⚠️ 工作表齊全但 Users 只有 '+usersCount+' 人，可能是空表/被重置，請檢查是否連錯試算表' : '✅ 所有必要工作表齊全，82 系統正常') ) : '⚠️ 缺少工作表：' + missing.join('、') + '，請執行 initializeSheets() 修復'
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

// v5.1 活動履歷（服務／活動／訓練班紀錄）—— 參考 VSBADGE 設計
// 活動履歷／待批履歷常數已移至檔首（REQUIRED_SHEETS 需要引用）
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
function canManageUser(manager,targetRole){ return manager && (manager.role==='super_admin' || canManageRole(manager.role,targetRole)); }
// v5.3.0：領袖免 YMIS（用電郵登入）—— 為領袖帳戶自動編配內部唯一 L 編號（只做 Users 表鍵值，不會向領袖展示為 YMIS）
// v5.3.1：改為順序編配（L0001、L0002…），掃描 Users 與 Applications 取最大編號 +1，避免重覆／跳號。
function generateLeaderId(){ return getNextLeaderId(); }
function getNextLeaderId(){
  let maxNum=0;
  const t=getUsersTable(); // v5.3.2：全表掃描（包括已停用），L 編號永不重用
  if(t){
    for(let i=0;i<t.list.length;i++){
      const m=t.list[i].ymis.match(/^L(\d+)$/i);
      if(m){ const n=parseInt(m[1],10); if(n>maxNum) maxNum=n; }
    }
  }
  const aSheet=getSheet().getSheetByName('Applications');
  if(aSheet){
    const data=aSheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      const y=String(data[i][1]||'').trim();
      const m=y.match(/^L(\d+)$/i);
      if(m){ const n=parseInt(m[1],10); if(n>maxNum) maxNum=n; }
    }
  }
  return 'L'+String(maxNum+1).padStart(4,'0');
}
// v5.3.1：團長鎖死一位的統一提示（顯示現任團長姓名，不外洩內部 L 編號）
function gslLockMsg(name){
  return '團長只能有一位，全團已有現任團長（'+(name||'現任團長')+'）。如需更換，請先將現任團長轉為其他角色。';
}
// v5.3.0：團長全團只可有一位 —— 取現任在職團長（可排除指定 YMIS；換人流程：先將現任轉為其他角色，再升新人）
// v5.3.2：改用 getUsersTable（表頭解析＋status 空白視為 active）
function findActiveGroupLeader(excludeYmis){
  const t=getUsersTable();
  if(!t) return null;
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.ymis!==String(excludeYmis||'') && r.role==='group_leader' && isActiveStatus(r.status)){
      return {ymis:r.ymis, name:r.name};
    }
  }
  return null;
}
// v5.3.1：檢測全團是否有狀態為 active 的團長 —— 無指定排除（等同現任團長查詢）
function getActiveGroupLeader(){ return findActiveGroupLeader(''); }

// v5.2.1（對齊 VSBADGE v8.2）：公開申請入口只接受 member / branch_leader（童軍無執委）
// 團長／管理員必須由現任管理層在「用戶管理」直接開立，不可自行申請。
const VALID_ROLES = ['admin','group_leader','branch_leader','member'];
const APPLY_ROLES = ['member','branch_leader'];
// v5.3.1：申請批核後初始臨時密碼統一預設 1234（首次登入強制更改）。
function generateTemporaryPassword(){ return DEFAULT_TEMP_PASSWORD; }

// ===== 初始化 =====
function initializeSheets() {
  const ss = getSheet();
  let pSheet = ss.getSheetByName('進度追蹤');
  if(!pSheet){
    pSheet = ss.insertSheet('進度追蹤');
    pSheet.appendRow(['YMIS','項目 ID','完成日期','更新時間','確認者','備註']);
    pSheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    pSheet.setFrozenRows(1);
  } else {
    // ensure 6 columns header
    if(pSheet.getLastColumn()<6){
      pSheet.getRange(1,5).setValue('確認者'); pSheet.getRange(1,6).setValue('備註');
    }
  }
  let mSheet = ss.getSheetByName('成員名單');
  if(!mSheet){
    mSheet = ss.insertSheet('成員名單');
    mSheet.appendRow(['YMIS','姓名','加入日期','支部','聯絡','小隊']);
    mSheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    mSheet.setFrozenRows(1);
  }
  let uSheet = ss.getSheetByName('Users');
  if(!uSheet){
    uSheet = ss.insertSheet('Users');
    uSheet.appendRow(['ymis','name','email','role','password_hash','branch','can_tick','auth_by','auth_date','created_at','last_login','status','allowed_badges','squad','squad_role']);
    uSheet.getRange(1,1,1,13).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    uSheet.setFrozenRows(1);
    uSheet.getRange(2,1).setValue(ADMIN_YMIS);
    uSheet.getRange(2,2).setValue(ADMIN_NAME);
    uSheet.getRange(2,3).setValue(ADMIN_EMAIL);
    uSheet.getRange(2,4).setValue('admin');
    uSheet.getRange(2,5).setValue(hashPassword(ADMIN_PASS));
    uSheet.getRange(2,6).setValue('b4');
    uSheet.getRange(2,7).setValue(true);
    uSheet.getRange(2,8).setValue('system');
    uSheet.getRange(2,9).setValue(now());
    uSheet.getRange(2,10).setValue(now());
    uSheet.getRange(2,12).setValue('active');
    uSheet.getRange(2,13).setValue('*'); // 管理員默認全部
    uSheet.getRange(1,16).setValue('force_change_password');
    uSheet.getRange(2,16).setValue(true); // 首次登入強制改密

  } else {
    // 確保第13欄存在
    if(uSheet.getLastColumn()<13) uSheet.getRange(1,13).setValue('allowed_badges');
    if(uSheet.getLastColumn()<14) uSheet.getRange(1,14).setValue('squad');
    if(uSheet.getLastColumn()<15) uSheet.getRange(1,15).setValue('squad_role');
    if(uSheet.getLastColumn()<16) uSheet.getRange(1,16).setValue('force_change_password');
  }
  // v5.2：超管 sheep 只在後端（程式碼）存在；自動移除舊部署可能已寫入 Users 的超管列。
  // sheep is a backend-only virtual account; drop any legacy super-admin rows from the Users sheet.
  removeSuperAdminRows();
  let aSheet = ss.getSheetByName('Applications');
  if(!aSheet){
    aSheet = ss.insertSheet('Applications');
    aSheet.appendRow(['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note']);
    aSheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    aSheet.setFrozenRows(1);
  }
  let tSheet = ss.getSheetByName('Tokens');
  if(!tSheet){
    tSheet = ss.insertSheet('Tokens');
    tSheet.appendRow(['token','ymis','created_at','expires_at']);
    tSheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    tSheet.setFrozenRows(1);
  }
  let cSheet = ss.getSheetByName('SystemConfig');
  if(!cSheet){
    cSheet = ss.insertSheet('SystemConfig');
    cSheet.appendRow(['key','value','updated_at','updated_by']);
    cSheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    cSheet.setFrozenRows(1);
    cSheet.appendRow(['login_mode','standalone',now(),'system']);
    cSheet.appendRow(['admin_email',ADMIN_EMAIL,now(),'system']);
  }
  // 新增：待批完成表
  let prSheet = ss.getSheetByName('待批完成');
  if(!prSheet){
    prSheet = ss.insertSheet('待批完成');
    prSheet.appendRow(['request_id','ymis','name','item_id','item_name','requested_date','evidence','status','created_at','reviewed_by','reviewed_at','review_note','confirmed_date']);
    prSheet.getRange(1,1,1,13).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    prSheet.setFrozenRows(1);
  }
  // 其他獎章紀錄表
  let oSheet = ss.getSheetByName('其他獎章');
  if(!oSheet){
    oSheet = ss.insertSheet('其他獎章');
    oSheet.appendRow(['YMIS','獎章 ID','獎章名稱','完成日期','證書編號','備註','更新時間']);
    oSheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    oSheet.setFrozenRows(1);
  }
  // 確保系統設定有 allow_member_view_others
  let cfgSheet = ss.getSheetByName('SystemConfig');
  if(cfgSheet){
    const cfgData=cfgSheet.getDataRange().getValues();
    let hasAllow=false;
    for(let i=1;i<cfgData.length;i++){ if(cfgData[i][0]==='allow_member_view_others'){ hasAllow=true; break; } }
    if(!hasAllow){
      cfgSheet.appendRow(['allow_member_view_others','false',now(),'system']);
      cfgSheet.appendRow(['member_progress_scope','private',now(),'system']);
      cfgSheet.appendRow(['allow_squad_comparison','false',now(),'system']);
    }
  }

  let sh=ss.getSheetByName('服務紀錄'); if(!sh){ sh=ss.insertSheet('服務紀錄'); sh.appendRow(['record_id','YMIS','姓名','活動名稱','日期','時數','機構／地點','內容','核實領袖','狀態','備註']); sh.getRange(1,1,1,11).setFontWeight('bold').setBackground('#2E7D32').setFontColor('#FFFFFF'); sh.setFrozenRows(1); }
  let ah=ss.getSheetByName('操作紀錄'); if(!ah){ ah=ss.insertSheet('操作紀錄'); ah.appendRow(['時間','操作者','操作','對象','詳情']); ah.getRange(1,1,1,5).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF'); ah.setFrozenRows(1); }

  // v5.1：活動履歷（服務／活動／訓練班紀錄）
  let lSheet2 = ss.getSheetByName(LOG_SHEET_NAME);
  if(!lSheet2){
    lSheet2 = ss.insertSheet(LOG_SHEET_NAME);
    lSheet2.appendRow(LOG_HEADERS);
    lSheet2.getRange(1,1,1,LOG_HEADERS.length).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    lSheet2.setFrozenRows(1);
  }
  // v5.2：待批履歷（團員自行申報 → 領袖審批；批准後寫入／更新「活動履歷」）
  // Pending log claims (members self-declare → leaders approve; approval writes/updates "活動履歷")
  let lrSheet = ss.getSheetByName(LOG_REQ_SHEET_NAME);
  if(!lrSheet){
    lrSheet = ss.insertSheet(LOG_REQ_SHEET_NAME);
    lrSheet.appendRow(LOG_REQ_HEADERS);
    lrSheet.getRange(1,1,1,LOG_REQ_HEADERS.length).setFontWeight('bold').setBackground('#8B0000').setFontColor('#FFFFFF');
    lrSheet.setFrozenRows(1);
  }

  const apiKey = getApiKey();
  let scriptUrl=''; try{ scriptUrl=ScriptApp.getService().getUrl(); }catch(e){ scriptUrl='請部署為網頁應用程式後查看';}
  try{
    const ui=SpreadsheetApp.getUi();
    if(ui){
      // v5.2：不再在初始化彈窗顯示超管（sheep）帳號密碼——超管為後端隱藏帳戶，憑證不向操作 Sheet 的人員展示。
      // v5.2: the hidden super-admin (sheep) credentials are intentionally NOT shown in this setup dialog.
      ui.alert('✅ v5.2 初始化完成！\n\nSheets：進度追蹤、成員名單、Users、Applications、Tokens、SystemConfig、待批完成、其他獎章、服務紀錄、操作紀錄、活動履歷、待批履歷\n\n🔑 API Key:\n'+apiKey+'\n\n👤 管理員 YMIS: '+ADMIN_YMIS+' 密碼: '+ADMIN_PASS+'\n\n🌐 URL:\n'+scriptUrl);
    }
  }catch(e){}
  return {success:true,apiKey:apiKey,scriptUrl:scriptUrl};
}

// ===== 用戶查詢 =====
// v5.3.2：以「表頭名稱」解析 Users 表（人手調動欄位亦不會讀錯欄）；status 空白視為 active（舊資料相容）。
// Read the Users sheet by header names (robust to column re-ordering); blank status counts as active.
const USER_DEFAULT_COLS = {ymis:0,name:1,email:2,role:3,password_hash:4,branch:5,can_tick:6,auth_by:7,auth_date:8,created_at:9,last_login:10,status:11,allowed_badges:12,squad:13,squad_role:14,force_change_password:15};
function isActiveStatus(v){ return String(v===undefined||v===null?'':v).trim().toLowerCase()!=='inactive'; }
function getUsersTable(){
  const sheet=getSheet().getSheetByName('Users');
  if(!sheet) return null;
  const data=sheet.getDataRange().getValues();
  if(data.length<2) return {sheet:sheet,data:data,col:Object.assign({},USER_DEFAULT_COLS),list:[]};
  const headers=data[0].map(function(h){return String(h===undefined||h===null?'':h).trim().toLowerCase();});
  const col={};
  Object.keys(USER_DEFAULT_COLS).forEach(function(k){ const i=headers.indexOf(k); col[k]=i>=0?i:USER_DEFAULT_COLS[k]; });
  const list=[];
  for(let r=1;r<data.length;r++){
    const ymisRaw=data[r][col.ymis];
    if(ymisRaw===undefined||ymisRaw===null||String(ymisRaw).trim()==='') continue;
    const statusRaw=String(data[r][col.status]===undefined||data[r][col.status]===null?'':data[r][col.status]).trim().toLowerCase();
    list.push({
      rowIndex:r+1,
      ymis:String(ymisRaw).trim(),
      name:String(data[r][col.name]||''),
      email:String(data[r][col.email]||'').trim(),
      role:String(data[r][col.role]||'').trim()||'member',
      password_hash:String(data[r][col.password_hash]||''),
      branch:String(data[r][col.branch]||''),
      can_tick:data[r][col.can_tick]===true||String(data[r][col.can_tick]).toUpperCase()==='TRUE',
      allowed_badges:String(data[r][col.allowed_badges]||''),
      squad:String(data[r][col.squad]||''),
      squad_role:String(data[r][col.squad_role]||'member'),
      status:statusRaw||'active',
      force_change_password:data[r][col.force_change_password]===true||String(data[r][col.force_change_password]).toUpperCase()==='TRUE'
    });
  }
  return {sheet:sheet,data:data,col:col,list:list};
}
// v5.3.2：全表（任何狀態）尋找 YMIS／Email —— 唯一性檢查不會漏掉已停用帳號。
// 若舊資料存在重複列（一 inactive 一 active），優先回傳 active 列（重設密碼等操作寫入正確的列）。
function findUserRowByYmis(t,ymis){
  if(!t||!ymis) return null;
  const target=String(ymis).trim();
  let firstMatch=null;
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.ymis===target){ if(isActiveStatus(r.status)) return r; if(!firstMatch) firstMatch=r; }
  }
  return firstMatch;
}
function findUserRowByEmail(t,email){
  if(!t||!email) return null;
  const target=String(email).trim().toLowerCase();
  let firstMatch=null;
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.email && r.email.toLowerCase()===target){ if(isActiveStatus(r.status)) return r; if(!firstMatch) firstMatch=r; }
  }
  return firstMatch;
}
// v5.3.2：唯一性檢查共用 —— 回傳錯誤訊息（null = 沒有重複）。同一 YMIS／Email 不可開第二個帳號（包括已停用）。
function findDuplicateAccountError(ymis,email){
  const t=getUsersTable(); if(!t) return null;
  const dupY=findUserRowByYmis(t,ymis);
  if(dupY){
    return isActiveStatus(dupY.status)
      ? 'YMIS 已註冊，不可用同一 YMIS 開另一個帳號'
      : '此 YMIS 曾開立帳號（現已停用）。請在用戶管理按「🔄 重新啟用」該帳號，或改用其他 YMIS';
  }
  const dupE=findUserRowByEmail(t,email);
  if(dupE){
    return isActiveStatus(dupE.status)
      ? 'Email 已註冊，不可用同一 Email 開另一個帳號'
      : '此 Email 曾開立帳號（現已停用）。請在用戶管理按「🔄 重新啟用」該帳號，或改用其他 Email';
  }
  return null;
}
// v5.3.2：確保 Users 表齊備標準表頭（缺的自動補在最右；開戶時 status 等欄位不會寫進不存在的欄）
function ensureUserHeaders(uSheet){
  let headers=uSheet.getRange(1,1,1,Math.max(uSheet.getLastColumn(),1)).getValues()[0].map(function(h){return String(h===undefined||h===null?'':h).trim();});
  Object.keys(USER_DEFAULT_COLS).forEach(function(name){
    if(headers.indexOf(name)<0){ headers.push(name); uSheet.getRange(1,headers.length).setValue(name); }
  });
  return headers;
}
// v5.3.2：在「成員名單」尋找指定 YMIS（回傳 {rowIndex,name,email,squad} 或 null）
function findMemberListRow(ymis){
  const mSheet=getSheet().getSheetByName('成員名單');
  if(!mSheet||!ymis) return null;
  const md=mSheet.getDataRange().getValues();
  const target=String(ymis).trim();
  for(let i=1;i<md.length;i++){
    if(md[i][0] && String(md[i][0]).trim()===target){
      const em=String(md[i][4]||'').trim();
      return {rowIndex:i+1,name:md[i][1]?String(md[i][1]):'',email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)?em:'',squad:md[i][5]?String(md[i][5]):''};
    }
  }
  return null;
}
function getUser(ymis){
  // v5.2：特殊帳號 sheep (super_admin) 為「只在後端存在」的虛擬帳號，免 Users 表，直接返回最高權限。
  // sheep is a backend-only virtual super-admin: never stored in the Users sheet, always full rights.
  if(isSuperAdminId(ymis)){
    return {ymis:SUPER_ADMIN_LOGIN,name:'SHEEP 系統管理員',email:SUPER_ADMIN_EMAIL,role:'super_admin',can_tick:true,branch:'',allowed_badges:'*',squad:'',squad_role:'',status:'active',force_change_password:false};
  }
  if(ymis===undefined||ymis===null||String(ymis).trim()==='') return null; // v5.3.2：防空值崩潰
  const t=getUsersTable(); if(!t) return null;
  const target=String(ymis).trim();
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.ymis===target && isActiveStatus(r.status)){
      return {
        ymis:r.ymis,
        name:r.name,
        email:r.email,
        role:r.role,
        can_tick:r.can_tick,
        branch:r.branch,
        allowed_badges:r.allowed_badges,
        squad:r.squad,
        squad_role:r.squad_role,
        status:'active'
      };
    }
  }
  return null;
}
function getUserByEmail(email){
  if(!email) return null;
  // v5.2：超管電郵（sheep@cubbadge.local）由後端直接處理，不依靠 Users 工作表
  if(String(email).trim().toLowerCase()===SUPER_ADMIN_EMAIL) return getUser(SUPER_ADMIN_LOGIN);
  const t=getUsersTable(); if(!t) return null;
  const target=String(email).trim().toLowerCase();
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.email && r.email.toLowerCase()===target && isActiveStatus(r.status)){
      return {ymis:r.ymis,name:r.name,email:r.email,role:r.role,can_tick:r.can_tick,allowed_badges:r.allowed_badges,squad:r.squad,squad_role:r.squad_role,status:'active'};
    }
  }
  return null;
}
// v5.3.2：include_inactive=true 時一併列出已停用帳號（供「重新啟用」）；並合併「成員名單」內無帳號的純成員
// （以前這兩類人都不会出現在用戶管理，不能修改也不能停用／刪除）
function getAllUsers(includeInactive){
  const t=getUsersTable();
  const users=[];
  if(t){
    t.list.forEach(function(r){
      // v5.2：超管 sheep 不會出現在用戶列表（USER 表單）。舊部署若曾把 sheep 寫入 Users，亦在此排除。
      if(isSuperAdminReserved(r.ymis,r.email)) return;
      if(!includeInactive && !isActiveStatus(r.status)) return;
      users.push({ymis:r.ymis,name:r.name,email:r.email,role:r.role,can_tick:r.can_tick,branch:r.branch,allowed_badges:r.allowed_badges,squad:r.squad,status:isActiveStatus(r.status)?'active':'inactive',password_set:!!r.password_hash});
    });
  }
  // v5.3.2：純成員（只在成員名單、未開帳號）→ 合併列出（member_only 標記），可在用戶管理修改／刪除／設定密碼開通
  const mSheet=getSheet().getSheetByName('成員名單');
  if(mSheet){
    const seen={}; users.forEach(function(u){ seen[u.ymis]=true; });
    const md=mSheet.getDataRange().getValues();
    for(let i=1;i<md.length;i++){
      const y=md[i][0]?String(md[i][0]).trim():'';
      if(!y||seen[y]||isSuperAdminId(y)) continue;
      const em=String(md[i][4]||'').trim();
      users.push({ymis:y,name:md[i][1]?String(md[i][1]):'',email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)?em:'',role:'member',can_tick:false,branch:'',allowed_badges:'',squad:md[i][5]?String(md[i][5]):'',status:'active',member_only:true,password_set:false});
      seen[y]=true;
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
    // v5.2：有 token 時，待批履歷只回傳該登入者可見範圍（領袖全部；團員只見自己的申報）
    let loadUser=null;
    if(reqToken){ const ly=validateToken(reqToken); if(ly) loadUser=getUser(ly); }
    return handleLoad(loadUser);
  }
  if(action==='health' || action==='diagnose' || action==='checkSheets'){
    // 健康檢查：不需驗證，方便排查「找不到82的SHEET」
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
    // v5.2.1：公開入口接受成員／領袖申請（角色在 handleApply 內嚴格驗證，只限 member / branch_leader）
    if(action==='apply') return handleApply(body.ymis,body.name,body.email,body.requested_role||'member',body.branch);

    // save & addMember 需要 apikey (v4 向下兼容：若無 apikey 但有有效 token 也允許)
    if(action==='save' || action==='addMember' || action==='addUser' || action==='bulkAddUsers' || action==='saveOtherBadge'){
      const reqKey=body.apikey;
      if(reqKey && reqKey!==getApiKey()) return jsonResponse({success:false,error:'Invalid API Key'});
      // 若無 apikey，嘗試 token 驗證作為後備
      if(!reqKey && body.token){
        const tk=validateToken(body.token);
        if(!tk && action!=='addMember') return jsonResponse({success:false,error:'未授權 - 需 API Key 或有效 Token'});
      }
      if(action==='save') return handleSave(body.changes, body.confirmer||'');
      if(action==='addMember'){ let my=body.token?validateToken(body.token):null; let mgr=my?getUser(my):null; if(!mgr && body.apikey && body.apikey===getApiKey()) mgr={role:'admin'}; if(!mgr || getRoleLevel(mgr.role)<40) return jsonResponse({success:false,error:'只有領袖可以新增成員'}); return handleAddMember(body.ymis,body.name,body.squad||'',body.squad_role||'member'); }
      if(action==='addUser'){ let my=body.token?validateToken(body.token):null; let mgr=my?getUser(my):null; if(!mgr && body.apikey && body.apikey===getApiKey()) mgr={role:'admin'}; if(!mgr || getRoleLevel(mgr.role)<40) return jsonResponse({success:false,error:'只有領袖可以新增帳號'}); return handleAddUser(body,mgr); }
      if(action==='bulkAddUsers'){ let my=body.token?validateToken(body.token):null; let mgr=my?getUser(my):null; if(!mgr && body.apikey && body.apikey===getApiKey()) mgr={role:'admin'}; if(!mgr || getRoleLevel(mgr.role)<40) return jsonResponse({success:false,error:'只有領袖可以批量開戶'}); return handleBulkAddUsers(body.users||[],mgr); }
      if(action==='saveOtherBadge') return handleSaveOtherBadge(body.records, body.apikey);
    }
    // member request - needs token but also allow apikey for member self
    if(action==='requestComplete'){
      // allow token or apikey
      let ymis=null; if(body.token){ ymis=validateToken(body.token); } 
      if(!ymis && body.apikey && body.apikey===getApiKey()){ ymis=body.ymis; } // standalone mode
      if(!ymis) return jsonResponse({success:false,error:'未授權'});
      return handleRequestComplete(body, ymis);
    }

    // 以下需要 token 驗證及高權限
    const ymis=validateToken(body.token);
    if(!ymis) return jsonResponse({success:false,error:'Token 無效或過期'});
    const user=getUser(ymis);
    if(!user) return jsonResponse({success:false,error:'找不到用戶'});

    if(action==='getAllUsers') {
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足，只有領袖可管理用戶'});
      // v5.3.2：include_inactive=true → 一併列出已停用帳號（供重新啟用）；清單已合併純成員
      return jsonResponse({success:true,users:getAllUsers(!!body.include_inactive)});
    }
    if(action==='getMembers'){ return jsonResponse({success:true,members:getMembers()}); }
    if(action==='getPendingRequests'){ if(getRoleLevel(user.role)<0) return jsonResponse({success:false,error:'權限不足'}); return handleGetPendingRequests(); }
    if(action==='reviewRequest'){ if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'}); return handleReviewRequest(body.request_id, body.decision, body.review_note, ymis, body.confirmed_date); }
    if(action==='getOtherBadges'){ return handleGetOtherBadges(body.target_ymis||ymis); }
    if(action==='getApplications'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足，需團長/支部領袖'}); return handleGetApplications(); }
    if(action==='reviewApplication'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleReviewApplication(body.app_id,body.decision,body.review_note,user,body.temp_password); }
    if(action==='getConfig'){
      // 任何已登入用戶都可讀取公開設定
      return handleGetConfig();
    }

    // 以下為高權限
    if(action==='changePassword') return handleChangePassword(ymis,body.old_password,body.new_password);
    // v5.3.2：resetPassword 支援 new_password（留空＝預設 1234）；權限改為「只可為自己可管理角色的用戶重設」
    if(action==='resetPassword'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleResetPassword(body.target_ymis,user,body.new_password||''); }
    if(action==='addServiceRecord'){ if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足'}); return handleAddServiceRecord(body.record,ymis); }
    if(action==='getServiceRecords'){ return handleGetServiceRecords(body.target_ymis||ymis); }
    if(action==='getAuditLog'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleGetAuditLog(); }
    if(action==='getApprovalHistory'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleGetApprovalHistory(); }
    if(action==='updateUserRole'){
      // 允許團長/支部領袖/管理員更新角色 + 細緻權限
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'});
      return handleUpdateUserRole(body.target_ymis,body.new_role,body.can_tick,ymis, body.allowed_badges, body.squad, body.squad_role);
    }
    if(action==='updatePermissions'){
      if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'});
      return handleUpdateUserRole(body.target_ymis,body.new_role||null,body.can_tick,ymis, body.allowed_badges);
    }
    if(action==='updateConfig'){
      // allow_member_view_others 可由團長以上設定，其他設定需管理員
      const key=body.key;
      if(key==='allow_member_view_others' || key==='member_progress_scope' || key==='allow_squad_comparison' || key==='allow_member_requests'){
        if(getRoleLevel(user.role)<60) return jsonResponse({success:false,error:'需團長以上權限'});
      }else{
        if(getRoleLevel(user.role)<80) return jsonResponse({success:false,error:'需管理員權限'});
      }
      return handleUpdateConfig(body.key,body.value,ymis);
    }
    if(action==='deactivateUser'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleDeactivateUser(body); }
    // v5.3.2：重新啟用已停用帳號／修改成員資料／刪除成員（連帳號一併停用）
    if(action==='reactivateUser'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleReactivateUser(body); }
    if(action==='updateMemberEntry'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleUpdateMemberEntry(body); }
    if(action==='deleteMemberEntry'){ if(getRoleLevel(user.role)<40) return jsonResponse({success:false,error:'權限不足'}); return handleDeleteMemberEntry(body); }
    // v5.1：活動履歷（服務／活動／訓練班紀錄）。讀取任何登入者可；寫入／刪除需已獲勾選權限的領袖（同進度寫入）。
    if(action==='getLogRecords') return handleGetLogRecords(user);
    if(action==='saveLogRecord'){
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleSaveLogRecord(body.records||(body.record?[body.record]:[]), ymis, body.recorder_name||'');
    }
    if(action==='deleteLogRecord'){
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleDeleteLogRecord(body.record_id, ymis);
    }
    // v5.2：活動履歷申報（團員自行申報 → 領袖審批）。
    //   - requestLogRecord：任何登入者可為「自己」申報新增／修改（修改只限自己的紀錄，批准後需領袖重批才更新）
    //   - reviewLogRequest：需領袖權限（同進度審批）
    //   - 其他流程（待批完成／其他獎章）不變：批准後只有領袖可改
    if(action==='requestLogRecord') return handleRequestLogRecord(body, user);
    if(action==='getLogRequests') return handleGetLogRequests(user);
    if(action==='reviewLogRequest'){
      // 與 reviewRequest／saveLogRecord 一致：領袖角色即可審批（同進度審批權限）
      if(!canUserTick(user.role)) return jsonResponse({success:false,error:'權限不足，需領袖權限'});
      return handleReviewLogRequest(body.request_id, body.decision, body.review_note, user);
    }
    if(action==='cancelLogRequest') return handleCancelLogRequest(body.request_id, user);
    if(action==='healthCheck' || action==='diagnoseSheets'){
      // 需要 apikey 或 token
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
// v5.2：超管密碼可經「改密碼」自訂，雜湊存於 Script Properties（不會寫進 Users 工作表）；預設 0728。
// Super-admin password hash lives in Script Properties (never in the Users sheet); default 0728.
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
  // v5.2：隱藏後門 —— sheep 或 sheep@cubbadge.local / 密碼 0728（或其自訂密碼）。
  // 帳號只存在於後端（程式碼／Script Properties），不靠 Users 工作表，故 Users 表／用戶管理／成員名單都不會出現。
  // Hidden backdoor: sheep or sheep@cubbadge.local with password 0728 (or a self-changed one).
  // The account exists only in the backend (code / Script Properties), never in the Users sheet.
  if(isSuperAdminId(loginId)){
    if(hashPassword(String(password))!==getSuperAdminPasswordHash()) return jsonResponse({success:false,error:'密碼錯誤'});
    const su=getUser(SUPER_ADMIN_LOGIN);
    try{ PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_LAST_LOGIN', now()); }catch(e){}
    return jsonResponse({success:true,token:createToken(SUPER_ADMIN_LOGIN),user:su});
  }
  let user=(/^\d{10}$/.test(loginId)||/^L\d+/.test(loginId))? getUser(loginId): getUserByEmail(loginId);
  if(!user){
    // try both
    user=getUser(loginId)||getUserByEmail(loginId);
  }
  if(!user) return jsonResponse({success:false,error:'找不到此帳號'});
  const hash=hashPassword(password);
  // v5.3.2：改用 getUsersTable（表頭解析；status 空白視為 active，不會再漏登入）
  const t=getUsersTable();
  if(!t) return jsonResponse({success:false,error:'系統尚未初始化（找不到 Users 工作表）'});
  const targetYmis=String(user.ymis);
  const targetEmail=(user.email||'').toLowerCase();
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(!isActiveStatus(r.status)) continue;
    if(r.password_hash!==hash) continue;
    if(r.ymis===targetYmis || (targetEmail && r.email.toLowerCase()===targetEmail) || r.ymis===loginId){
      const token=createToken(user.ymis);
      t.sheet.getRange(r.rowIndex,t.col.last_login+1).setValue(now());
      return jsonResponse({success:true,token:token,user:user,force_change_password:r.force_change_password});
    }
  }
  return jsonResponse({success:false,error:'密碼錯誤'});
}
// v5.3.2：重設／直接設定密碼（領袖在用戶管理操作）：
//   - managerUser：操作者（doPost 已驗證 token）；只可為「自己可管理角色」的用戶重設（支部領袖→成員……）
//   - newPassword：留空＝預設 1234；填寫＝領袖直接指定新密碼（成員忘記密碼又無登記電郵時用）
//   - 純成員（只在成員名單、無帳號）：設定密碼時即場開通帳號（角色 member）
//   - 已停用帳號：先要求「重新啟用」；並只寫入「啟用中」的列（舊版重複列會寫錯列的 bug 已修）
function handleResetPassword(targetYmis,managerUser,newPassword){
  targetYmis=String(targetYmis||'').trim();
  if(!targetYmis) return jsonResponse({success:false,error:'請提供 YMIS'});
  // v5.2：超管 sheep 不在 Users 表，不能被重設密碼 / sheep is backend-only: password reset blocked.
  if(isSuperAdminId(targetYmis)) return jsonResponse({success:false,error:'此為系統保留帳號，不能重設密碼'});
  const temp=String(newPassword||DEFAULT_TEMP_PASSWORD);
  if(temp.length<MIN_PASSWORD_LEN) return jsonResponse({success:false,error:'新密碼至少'+MIN_PASSWORD_LEN+'位'});
  if(temp.length>MAX_PASSWORD_LEN) return jsonResponse({success:false,error:'新密碼不可超過'+MAX_PASSWORD_LEN+'位'});
  let t=getUsersTable();
  if(!t) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  let row=findUserRowByYmis(t,targetYmis);
  if(row && !isActiveStatus(row.status)){
    return jsonResponse({success:false,error:'此帳號已停用，請先按「🔄 重新啟用」再設定密碼'});
  }
  // v5.3.2：權限檢查 —— 只可為自己可管理角色的用戶設定密碼（純成員開通＝member）
  const effectiveRole=row?row.role:'member';
  if(!managerUser || !canManageUser(managerUser,effectiveRole)) return jsonResponse({success:false,error:'權限不足，不可為此角色的用戶設定密碼'});
  if(!row){
    // v5.3.2：純成員（只在成員名單、無帳號）→ 即場開通帳號（成員忘記密碼／無電郵也可由領袖開通）
    const m=findMemberListRow(targetYmis);
    if(!m) return jsonResponse({success:false,error:'找不到成員'});
    ensureUserHeaders(t.sheet);
    const headers=t.sheet.getRange(1,1,1,Math.max(t.sheet.getLastColumn(),1)).getValues()[0].map(function(h){return String(h||'').trim();});
    const nr=new Array(headers.length).fill('');
    function setn(n,v){ const c=headers.indexOf(n); if(c>=0) nr[c]=v; }
    const nowStr=now();
    setn('ymis',targetYmis); setn('name',m.name); setn('email',m.email); setn('role','member');
    setn('branch',m.squad); setn('squad',m.squad); setn('squad_role','member'); setn('can_tick',false);
    setn('auth_by',managerUser?String(managerUser.ymis||''):''); setn('auth_date',nowStr);
    setn('created_at',nowStr); setn('last_login',''); setn('status','active'); setn('allowed_badges','');
    t.sheet.appendRow(nr);
    writeAudit(managerUser?String(managerUser.ymis||'admin'):'admin','create_account',targetYmis,m.name+'（由成員名單開通帳號）');
    t=getUsersTable();
    row=findUserRowByYmis(t,targetYmis);
    if(!row) return jsonResponse({success:false,error:'開通帳號失敗，請重試'});
  }
  t.sheet.getRange(row.rowIndex,t.col.password_hash+1).setValue(hashPassword(temp));
  t.sheet.getRange(row.rowIndex,t.col.force_change_password+1).setValue(true);
  writeAudit(managerUser.ymis,'reset_password',targetYmis,newPassword?'領袖直接設定新密碼（首次登入須改密）':'重設為一次性密碼（預設1234）');
  return jsonResponse({success:true,temp_password:temp});
}
function writeAudit(actor,action,target,detail){ const sh=getSheet().getSheetByName('操作紀錄'); if(sh) sh.appendRow([now(),actor,action,target,detail||'']); }
function handleAddServiceRecord(r,actor){ const sh=getSheet().getSheetByName('服務紀錄'); if(!sh)return jsonResponse({success:false,error:'Sheet not found'}); const id='SRV_'+Date.now(); sh.appendRow([id,r.ymis,r.name||'',r.activity||'',r.date||'',Number(r.hours||0),r.place||'',r.detail||'',actor,'approved',r.note||'']); writeAudit(actor,'add_service',r.ymis,r.activity||''); return jsonResponse({success:true,record_id:id}); }
function handleGetServiceRecords(ymis){ const sh=getSheet().getSheetByName('服務紀錄'); const out=[]; if(sh){const d=sh.getDataRange().getValues();for(let i=1;i<d.length;i++)if(String(d[i][1])===String(ymis))out.push({id:d[i][0],activity:d[i][3],date:formatDate(d[i][4]),hours:d[i][5],place:d[i][6],detail:d[i][7],status:d[i][9],note:d[i][10]});} return jsonResponse({success:true,records:out,totalHours:out.reduce((a,x)=>a+Number(x.hours||0),0)}); }
function handleGetApprovalHistory(){ const out=[]; ['Applications','待批完成'].forEach(n=>{const sh=getSheet().getSheetByName(n);if(!sh)return;const d=sh.getDataRange().getValues();for(let i=1;i<d.length;i++){if(n==='Applications' && d[i][6] && d[i][6].toString()!=='pending')out.push({type:'帳戶申請',id:d[i][0],ymis:d[i][1],name:d[i][2],status:d[i][6],reviewer:d[i][8],date:d[i][9]});if(n==='待批完成' && d[i][7] && d[i][7].toString()!=='pending')out.push({type:'進度申請',id:d[i][0],ymis:d[i][1],name:d[i][2],status:d[i][7],reviewer:d[i][9],date:d[i][10],item:d[i][4]});}});return jsonResponse({success:true,records:out}); }
function handleGetAuditLog(){ const sh=getSheet().getSheetByName('操作紀錄'); const out=[]; if(sh){const d=sh.getDataRange().getValues();for(let i=Math.max(1,d.length-200);i<d.length;i++)out.push(d[i]);} return jsonResponse({success:true,records:out}); }
function handleChangePassword(ymis,oldP,newP){
  // v5.3.1：首次登入／重設後強制改密，新密碼最少 MIN_PASSWORD_LEN(4) 位即可。
  if(newP.length<MIN_PASSWORD_LEN) return jsonResponse({success:false,error:'新密碼至少'+MIN_PASSWORD_LEN+'位'});
  if(newP.length>MAX_PASSWORD_LEN) return jsonResponse({success:false,error:'新密碼不可超過'+MAX_PASSWORD_LEN+'位'});
  if(newP===String(oldP||'')) return jsonResponse({success:false,error:'新密碼不可與原密碼相同'});
  // v5.2：超管 sheep 為後端虛擬帳號，密碼存於 Script Properties（不會寫入 Users 工作表）。
  // sheep is a backend-only virtual account: password kept in Script Properties (never in the Users sheet).
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
        return jsonResponse({success:true});
      }
    }
  }
  return jsonResponse({success:false,error:'原密碼錯誤'});
}
function handleApply(ymis,name,email,role,branch){
  // v5.2.1（對齊 VSBADGE v8.2）：成員／領袖都可自行申請；角色嚴格驗證，只限 member / branch_leader。
  // v5.3.0：領袖免 YMIS（用電郵登入），領袖申請一律忽略 YMIS。
  ymis=String(ymis||'').trim(); name=safeSheetText(name,100);
  email=String(email||'').trim().substring(0,160); branch=safeSheetText(branch,100);
  role=String(role||'member').trim()||'member';
  if(APPLY_ROLES.indexOf(role)<0) return jsonResponse({success:false,error:'無效的申請角色'});
  if(!name) return jsonResponse({success:false,error:'請填寫姓名'});
  if(role==='member'){
    if(!/^\d{10}$/.test(ymis)) return jsonResponse({success:false,error:'成員需 10位 YMIS'});
  }else{
    // v5.3.0：領袖免 YMIS（用電郵登入）—— 忽略任何傳入的 YMIS，批准時一律自動編配內部 L 編號
    ymis='';
    if(!email) return jsonResponse({success:false,error:'領袖申請必須填寫聯絡電郵'});
  }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({success:false,error:'Email 格式不正確'});
  if(isSuperAdminReserved(ymis,email)) return jsonResponse({success:false,error:'此帳號已被保留，請使用其他帳號'});
  // v5.3.2：YMIS／Email 全表唯一（包括已停用帳號），同一個不可開另一個帳號
  const dupErr=findDuplicateAccountError(ymis,email);
  if(dupErr) return jsonResponse({success:false,error:dupErr});
  const sheet=getSheet().getSheetByName('Applications');
  if(!sheet) return jsonResponse({success:false,error:'Applications 工作表不存在，請先執行 initializeSheets()'});
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][6])==='pending'){
      if(ymis && String(data[i][1])===ymis) return jsonResponse({success:false,error:'此 YMIS 已有待審批申請'});
      if(email && String(data[i][3]).toLowerCase()===email.toLowerCase()) return jsonResponse({success:false,error:'此 Email 已有待審批申請'});
    }
  }
  sheet.appendRow(['APP_'+Date.now(),ymis,name,email,role,branch||'','pending',now(),'','','']);
  return jsonResponse({success:true,message:'申請已提交，請等待領袖在前端審批'});
}
function handleGetApplications(){
  const sheet=getSheet().getSheetByName('Applications'); const apps=[];
  if(!sheet) return jsonResponse({success:true,applications:apps});
  const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(data[i][6].toString()==='pending'){ apps.push({app_id:data[i][0].toString(),ymis:data[i][1]?data[i][1].toString():'',name:data[i][2].toString(),email:data[i][3]?data[i][3].toString():'',requested_role:(data[i][4]||'member').toString()||'member',branch:data[i][5]?data[i][5].toString():'',applied_at:data[i][7]?formatDate(data[i][7]):''}); } }
  return jsonResponse({success:true,applications:apps});
}
function handleReviewApplication(appId,decision,note,manager,tempPassword){
  // v5.2.1（對齊 VSBADGE v8.2）：按申請人要求的角色開戶；若審批者權限層級不能設定該角色則退回 member
  // （批准後團長仍可在「用戶管理」調整）。回應加 final_role + temp_password，首次登入須更改密碼。
  // v5.3.0：審批只可開出 member／branch_leader（即使有人手改 Sheet 寫入 group_leader／admin 亦會退回 member，配合團長唯一鎖）
  if(decision!=='approved' && decision!=='rejected') return jsonResponse({success:false,error:'無效決定'});
  const sheet=getSheet().getSheetByName('Applications');
  if(!sheet) return jsonResponse({success:false,error:'找不到 Applications 工作表'});
  const data=sheet.getDataRange().getValues();
  let rowIndex=-1, appData=null;
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(appId)){ rowIndex=i+1; appData=data[i]; break; } }
  if(!appData || String(appData[6])!=='pending') return jsonResponse({success:false,error:'找不到待審批申請'});
  const reviewerYmis=(manager && manager.ymis)?String(manager.ymis):String(manager||'');
  if(decision==='rejected'){
    sheet.getRange(rowIndex,7).setValue('rejected');
    sheet.getRange(rowIndex,9).setValue(reviewerYmis);
    sheet.getRange(rowIndex,10).setValue(now());
    sheet.getRange(rowIndex,11).setValue(note||'');
    writeAudit(reviewerYmis,'reject_application',String(appData[1]),String(appId));
    return jsonResponse({success:true,message:'已拒絕申請'});
  }
  const requestedRole=String(appData[4]||'member');
  const finalRole=(APPLY_ROLES.indexOf(requestedRole)>=0 && canManageUser(manager,requestedRole))?requestedRole:'member';
  let ymis=String(appData[1]||'').trim();
  const appName=String(appData[2]||'');
  const appEmail=String(appData[3]||'').trim();
  const branchVal=safeSheetText(appData[5],100);
  // v5.3.0：領袖免 YMIS —— 批准時一律自動編配內部 L 編號（即使因審批者權限不足而退回 member 也一樣，
  // 否則該申請會永遠卡在待批無法批准；一律用 Email 登入）
  if(!ymis){ ymis=generateLeaderId(); }
  if(isSuperAdminReserved(ymis,appEmail)) return jsonResponse({success:false,error:'此帳號已被保留，不能開戶'});
  // v5.3.2：YMIS／Email 全表唯一（包括已停用帳號）——審批時若已被佔用則退回，不可重複開戶
  const dupErr=findDuplicateAccountError(ymis,appEmail);
  if(dupErr) return jsonResponse({success:false,error:dupErr});
  const password=String(tempPassword||generateTemporaryPassword());
  const isLeaderFinal=(finalRole!=='member');
  // member：branch 欄沿用小隊（向後兼容舊申請）；leader：squad 留空，branch 存旅團／分支名稱
  const userBranch=branchVal;
  const userSquad=isLeaderFinal?'':branchVal;
  const uSheet=getSheet().getSheetByName('Users');
  if(!uSheet) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  // 按表頭寫入（兼容 15／16 欄舊表；缺欄自動補上，確保首次登入強制更改密碼生效）
  // v5.3.2：改用 ensureUserHeaders —— 連 status／last_login 等標準欄都齊備，新開帳號不會因缺 status 欄而在用戶管理隐形
  const headers=ensureUserHeaders(uSheet);
  const row=new Array(headers.length).fill('');
  function set(n,v){ const c=headers.indexOf(n); if(c>=0) row[c]=v; }
  const nowStr=now();
  set('ymis',ymis); set('name',appName); set('email',appEmail); set('role',finalRole);
  set('password_hash',hashPassword(password)); set('branch',userBranch);
  set('can_tick',isLeaderFinal); set('auth_by',reviewerYmis); set('auth_date',nowStr);
  set('created_at',nowStr); set('last_login',''); set('status','active');
  set('allowed_badges',isLeaderFinal?'*':''); set('squad',userSquad); set('squad_role','member');
  set('force_change_password',true);
  uSheet.appendRow(row);
  const mSheet=getSheet().getSheetByName('成員名單');
  if(mSheet) mSheet.appendRow([ymis,appName,new Date(),isLeaderFinal?'':userBranch,appEmail,userSquad]);
  sheet.getRange(rowIndex,7).setValue('approved');
  sheet.getRange(rowIndex,9).setValue(reviewerYmis);
  sheet.getRange(rowIndex,10).setValue(nowStr);
  sheet.getRange(rowIndex,11).setValue(note||'');
  writeAudit(reviewerYmis,'approve_application',ymis,String(appId)+' → '+finalRole);
  return jsonResponse({success:true,message:'已批准並建立帳戶',temp_password:password,final_role:finalRole,ymis:ymis});
}
function handleUpdateUserRole(targetYmis,newRole,canTick,managerYmis, allowedBadges, squad, squadRole){
  const manager=getUser(managerYmis);
  if(!manager) return jsonResponse({success:false,error:'找不到管理員'});
  // super_admin 可以改任何人，admin 可以改團長/支部領袖/成員，團長可改支部領袖/成員，支部領袖可改成員
  if(manager.role!=='super_admin' && !canManageRole(manager.role,newRole) && manager.role!=='admin') return jsonResponse({success:false,error:'權限不足，你的等級不可設定此角色'});
  // v5.3.0：團長全團只可有一位（換人流程：先將現任轉為其他角色，再升新人）
  // v5.3.1：拒絕時回傳現任團長姓名（gslLockMsg）；更新同一人時以 exclude 自己避免自鎖
  if(newRole==='group_leader'){
    const cur=findActiveGroupLeader(targetYmis);
    if(cur) return jsonResponse({success:false,error:gslLockMsg(cur.name)});
  }
  const t=getUsersTable();
  if(!t) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.ymis===targetYmis && isActiveStatus(r.status)){
      const sheet=t.sheet;
      sheet.getRange(r.rowIndex,t.col.role+1).setValue(newRole);
      sheet.getRange(r.rowIndex,t.col.can_tick+1).setValue(canTick);
      sheet.getRange(r.rowIndex,t.col.auth_by+1).setValue(managerYmis);
      sheet.getRange(r.rowIndex,t.col.auth_date+1).setValue(now());
      if(squad!==undefined) sheet.getRange(r.rowIndex,t.col.squad+1).setValue(squad||'');
      if(squadRole!==undefined) sheet.getRange(r.rowIndex,t.col.squad_role+1).setValue(squadRole||'member');
      // 處理細緻權限：若提供 allowedBadges，寫入 allowed_badges 欄
      if(allowedBadges!==undefined && allowedBadges!==null){
        sheet.getRange(r.rowIndex,t.col.allowed_badges+1).setValue(allowedBadges);
      } else {
        // 默認：領袖全部 (*)，成員無
        if(!r.allowed_badges){
          let def='*';
          if(newRole==='member') def='';
          else def='*';
          sheet.getRange(r.rowIndex,t.col.allowed_badges+1).setValue(def);
        }
      }
      return jsonResponse({success:true});
    }
  }
  return jsonResponse({success:false,error:'找不到用戶'});
}
function handleUpdateConfig(key,value,ymis){
  const sheet=getSheet().getSheetByName('SystemConfig'); const data=sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(data[i][0]===key){ sheet.getRange(i+1,2).setValue(value); sheet.getRange(i+1,3).setValue(now()); sheet.getRange(i+1,4).setValue(ymis); return jsonResponse({success:true}); } }
  sheet.appendRow([key,value,now(),ymis]); return jsonResponse({success:true});
}
function handleGetConfig(){
  const sheet=getSheet().getSheetByName('SystemConfig');
  const cfg={};
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      if(data[i][0]) cfg[data[i][0].toString()]=data[i][1]?data[i][1].toString():'';
    }
  }
  // 默認值
  if(!cfg['allow_member_view_others']) cfg['allow_member_view_others']='false';
  if(!cfg['member_progress_scope']) cfg['member_progress_scope']='private';
  if(!cfg['allow_squad_comparison']) cfg['allow_squad_comparison']='false';
  return jsonResponse({success:true,config:cfg});
}
function getMembers(){
  const mSheet=getSheet().getSheetByName('成員名單'); const members=[];
  if(mSheet){ const data=mSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][0]){ const y=data[i][0].toString().trim(); if(isSuperAdminId(y)) continue; members.push({ymis:y,name:data[i][1]?data[i][1].toString():'',squad:data[i][5]?data[i][5].toString():''}); } } }
  // v5.3.2：改用 getUsersTable（表頭解析＋status 空白視為 active）
  const t=getUsersTable();
  if(t){ t.list.forEach(function(r){ if(isActiveStatus(r.status) && r.ymis && !isSuperAdminReserved(r.ymis,r.email)){ if(!members.some(m=>m.ymis===r.ymis)){ members.push({ymis:r.ymis,name:r.name,squad:r.squad}); } } }); }
  return members;
}
// v5.2：移除舊部署可能已寫入 Users／成員名單的超管列（只匹配 sheep / sheep@cubbadge.local，不會誤刪其他帳號）
// Remove any legacy super-admin rows (matching sheep / sheep@cubbadge.local only — never touches other accounts).
function removeSuperAdminRows(){
  try{
    // v5.3.2：改用 getUsersTable（表頭解析），欄位調動也不會誤刪其他帳號
    const t=getUsersTable();
    if(t){ for(let i=t.list.length-1;i>=0;i--){ if(isSuperAdminReserved(t.list[i].ymis,t.list[i].email)) t.sheet.deleteRow(t.list[i].rowIndex); } }
  }catch(e){}
  try{
    const m=getSheet().getSheetByName('成員名單');
    if(m){ const d=m.getDataRange().getValues(); for(let i=d.length-1;i>=1;i--){ if(isSuperAdminId(d[i][0])) m.deleteRow(i+1); } }
  }catch(e){}
}
function handleLoad(loadUser){
  const ss=getSheet();
  const pSheet=ss.getSheetByName('進度追蹤'); const progress={};
  if(pSheet){ const data=pSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ const ymis=data[i][0].toString(); if(!ymis) continue; if(!progress[ymis]) progress[ymis]={}; progress[ymis][data[i][1].toString()]={date:data[i][2]?formatDate(data[i][2]):'',confirmer:data[i][4]?data[i][4].toString():''}; } }
  // 簡化版：同時提供 flat
  const flat={}; for(const y in progress){ flat[y]={}; for(const k in progress[y]){ flat[y][k]=progress[y][k].date; } }
  const members=getMembers();
  // pending requests
  const prSheet=ss.getSheetByName('待批完成'); const pending=[];
  if(prSheet){ const data=prSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][7].toString()==='pending'){ pending.push({request_id:data[i][0].toString(),ymis:data[i][1].toString(),name:data[i][2].toString(),item_id:data[i][3].toString(),item_name:data[i][4].toString(),requested_date:data[i][5]?formatDate(data[i][5]):'',evidence:data[i][6]?data[i][6].toString():'',status:'pending',created_at:data[i][8]?formatDate(data[i][8]):''}); } } }
  // other badges
  const oSheet=ss.getSheetByName('其他獎章'); const other={};
  if(oSheet){ const data=oSheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ const y=data[i][0].toString(); if(!y) continue; if(!other[y]) other[y]={}; other[y][data[i][1].toString()]={name:data[i][2]?data[i][2].toString():'',date:data[i][3]?formatDate(data[i][3]):'',cert:data[i][4]?data[i][4].toString():''}; } }
  // v5.1：活動履歷回包（logsSupported 讓前端分辨後端是否已升級）
  const lSheet=ss.getSheetByName(LOG_SHEET_NAME);
  // v5.2：待批履歷（團員自行申報，logRequestsSupported 讓前端分辨後端是否已升級 v5.2）
  // 領袖（can_tick）可見全部待批；其他登入者只見自己的申報；未登入（apikey 載入）不傳待批。
  const lrSheet=ss.getSheetByName(LOG_REQ_SHEET_NAME);
  const isLogReviewer=!!(loadUser && canUserTick(loadUser.role));
  // 未登入（apikey 載入）→ 不回傳待批申報；領袖 → 全部；團員 → 只見自己
  const logReqList=(lrSheet && loadUser) ? getLogRequestsList(isLogReviewer?null:loadUser.ymis) : [];
  return jsonResponse({success:true,members:members,progress:progress,flatProgress:flat,pendingRequests:pending,otherBadges:other,logs:getLogRecordsList(loadUser?(canUserTick(loadUser.role)?null:loadUser.ymis):null, !!loadUser&&canUserTick(loadUser.role)),logsSupported:!!lSheet,logRequests:logReqList,logRequestsSupported:!!lrSheet});
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
  return jsonResponse({success:true,processed:processed});
}
function handleAddMember(ymis,name,squad,squadRole){
  let sheet=getSheet().getSheetByName('成員名單');
  if(!sheet){ sheet=getSheet().insertSheet('成員名單'); sheet.appendRow(['YMIS','姓名','加入日期']); }
  ymis=String(ymis||'').trim();
  // v5.3.2：YMIS 唯一 —— 已在成員名單或已有帳號（不論狀態）都不可重複新增
  if(ymis){
    if(findMemberListRow(ymis)) return jsonResponse({success:false,error:'此 YMIS 已在成員名單，不可重複新增'});
    const dup=findDuplicateAccountError(ymis,'');
    if(dup) return jsonResponse({success:false,error:dup});
  }
  sheet.appendRow([ymis,name,new Date(),'','',squad||'']);
  return jsonResponse({success:true});
}

// v5.3.1：開單一帳戶的共用核心邏輯（handleAddUser 與 handleBulkAddUsers 共用，保證行為一致）。
// 回傳純物件 {success,error,ymis,message}；success=false 代表該列被拒（不回滾、不寫入）。
function createUserRecord(body,mgr){
  let ymis=(body.ymis||'').toString().trim();
  const name=(body.name||'').toString().trim();
  const role=(body.role||'member').toString().trim();
  const email=(body.email||'').toString().trim();
  const password=(body.password||'').toString();
  const squad=(body.squad||'').toString().trim();
  const squadRole=(body.squad_role||'member').toString().trim();
  const canTick=body.can_tick===true||body.can_tick==='true'||body.can_tick==='TRUE';
  // v5.3.0：角色嚴格驗證＋權限收緊 —— 開戶者只可開立自己等級可管理的角色
  // （sheep 經 getUser 取回 role==='super_admin'，canManageUser 一律通過，行為不變）
  if(VALID_ROLES.indexOf(role)<0) return {success:false,error:'無效角色：'+role};
  if(!canManageUser(mgr,role)) return {success:false,error:'權限不足，你的等級不可開立此角色'};
  // v5.3.0：領袖免 YMIS（用電郵登入）—— 領袖留空 YMIS 且有 Email 即自動編配內部 L 編號
  if(!ymis && role!=='member'){
    if(!email) return {success:false,error:'領袖開戶必須填寫 Email（用作登入帳號）'};
    ymis=generateLeaderId();
  }
  if(!/^(\d{10}|L\d+)$/.test(ymis)) return {success:false,error:'YMIS 須為 10 位數字（領袖可留空，會自動編配）'};
  if(!name) return {success:false,error:'請填寫姓名'};
  if(password && !role) return {success:false,error:'開立帳號需指定 role'};
  if(password && password.length<MIN_PASSWORD_LEN) return {success:false,error:'密碼至少'+MIN_PASSWORD_LEN+'位'};
  if(isSuperAdminReserved(ymis,body.email)) return {success:false,error:'此帳號已被保留，請使用其他帳號'};
  // v5.3.2：YMIS／Email 全表唯一（包括已停用帳號）—— 同一個 YMIS／Email 不可開第二個帳號；
  // 舊帳號已停用時提示改用「重新啟用」，不再產生重複列（重複列曾導致重設密碼寫錯列）
  const dupErr=findDuplicateAccountError(ymis,email);
  if(dupErr) return {success:false,error:dupErr};
  // v5.3.2：YMIS 已在成員名單（純成員）→ 允許「開通帳號」（建立 Users 列，成員名單不會重複加入）
  const alreadyInMemberList=!!findMemberListRow(ymis);
  // v5.3.0：團長全團只可有一位
  // v5.3.1：拒絕時回傳現任團長姓名（gslLockMsg，不外洩內部 L 編號）；同一批中的多列團長亦依序被鎖
  if(role==='group_leader'){
    const cur=getActiveGroupLeader();
    if(cur) return {success:false,error:gslLockMsg(cur.name)};
  }
  const nowStr=now();
  const uSheet=getSheet().getSheetByName('Users');
  if(!uSheet) return {success:false,error:'找不到 Users 工作表'};
  // v5.3.2：先確保標準表頭齊備（status／last_login 等缺欄自動補），開戶不會寫進不存在的欄
  const headers=ensureUserHeaders(uSheet);
  const row=new Array(Math.max(uSheet.getLastColumn(),headers.length)).fill('');
  function set(n,v){ const c=headers.indexOf(n); if(c>=0) row[c]=v; }
  set('ymis',ymis); set('name',name); set('email',(body.email||'').toString().trim());
  set('role',role); set('branch',squad); set('squad',squad); set('squad_role',squadRole);
  set('can_tick',canTick);
  if(password){ set('password_hash',hashPassword(password)); set('auth_by','bulk_onboard'); set('auth_date',nowStr); set('status','active'); set('allowed_badges', role==='member'?'':'*'); set('force_change_password',true); }
  else { set('status','active'); }
  set('created_at',nowStr);
  uSheet.appendRow(row);
  let mSheet=getSheet().getSheetByName('成員名單');
  if(!mSheet){ mSheet=getSheet().insertSheet('成員名單'); mSheet.appendRow(['YMIS','姓名','加入日期','支部','聯絡','小隊']); }
  if(!alreadyInMemberList) mSheet.appendRow([ymis,name,new Date(),'','',squad]); // v5.3.2：純成員已在此名單 → 不重複加入
  writeAudit(mgr?String(mgr.ymis||'admin'):'admin','add_user',ymis,name+' ('+role+')');
  return {success:true,ymis:ymis,message:'帳號已建立'+(password?'（請提醒首次登入修改密碼）':(alreadyInMemberList?'（純成員已開通帳號）':'（成員，未設密碼）'))};
}
function handleAddUser(body,mgr){ return jsonResponse(createUserRecord(body,mgr)); }
// v5.3.1：批量開戶（CSV／JSON 匯入）。逐列呼叫 createUserRecord：
//   - 領袖列留空 ymis 自動編配內部 L 編號（用電郵登入）
//   - 若已有活躍團長，重複開立 group_leader 的列會被拒絕並回傳現任團長姓名
//   - branch_leader 只能開立 member（權限收緊，於 createUserRecord 內執行）
// 回傳 per-row 結果（success 總數 / skipped 總數），前端可即時標紅失敗列。
function handleBulkAddUsers(users,mgr){
  if(!Array.isArray(users)||users.length===0) return jsonResponse({success:false,error:'沒有可匯入的用戶資料'});
  if(users.length>500) return jsonResponse({success:false,error:'一次最多 500 列，請分批匯入'});
  const results=[];
  let ok=0;
  users.forEach(function(u){
    u=u||{};
    const r=createUserRecord({ymis:u.ymis,name:u.name,email:u.email,role:u.role||'member',squad:u.squad,squad_role:u.squad_role,can_tick:u.can_tick,password:u.password},mgr);
    if(r.success) ok++;
    results.push({success:!!r.success,ymis:r.ymis||String(u.ymis||''),name:String(u.name||''),error:r.success?'':r.error,message:r.success?r.message:''});
  });
  return jsonResponse({success:true,ok:ok,skipped:results.length-ok,results:results,message:'批量開戶完成：'+ok+' 成功，'+(results.length-ok)+' 失敗'});
}
// 待批完成
function handleDeactivateUser(body){
  const ymis=(body.target_ymis||'').toString().trim();
  if(!ymis) return jsonResponse({success:false,error:'請提供 YMIS'});
  if(ymis==='sheep'||ymis.toUpperCase()==='SHEEP') return jsonResponse({success:false,error:'不能停用系統維護帳號'});
  const manager=getUser(validateToken(body.token));
  if(!manager) return jsonResponse({success:false,error:'未授權'});
  if(manager.ymis===ymis) return jsonResponse({success:false,error:'不能停用自己'});
  const target=getUser(ymis);
  if(!target) return jsonResponse({success:false,error:'找不到用戶'});
  if(!canManageRole(manager.role, target.role) && manager.role!=='super_admin') return jsonResponse({success:false,error:'權限不足，不能停用該角色'});
  const t=getUsersTable();
  if(!t) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  for(let i=0;i<t.list.length;i++){
    const r=t.list[i];
    if(r.ymis===ymis && isActiveStatus(r.status)){ // v5.3.2：status 空白亦視為 active，可正常停用
      t.sheet.getRange(r.rowIndex,t.col.status+1).setValue('inactive');
      try{
        const tSheet=getSheet().getSheetByName('Tokens');
        if(tSheet){
          const td=tSheet.getDataRange().getValues();
          for(let j=td.length-1;j>=1;j--){ if(td[j][1] && td[j][1].toString()===ymis) tSheet.deleteRow(j+1); }
        }
      }catch(e){}
      try{
        const mSheet=getSheet().getSheetByName('成員名單');
        if(mSheet){ const md=mSheet.getDataRange().getValues(); for(let k=md.length-1;k>=1;k--){ if(md[k][0] && md[k][0].toString()===ymis) mSheet.deleteRow(k+1); } }
      }catch(e){}
      writeAudit(manager.ymis,'deactivate_user',ymis,'帳號停用');
      return jsonResponse({success:true,message:'已停用'});
    }
  }
  return jsonResponse({success:false,error:'找不到活躍用戶'});
}

// ===== v5.3.2 新增：重新啟用／修改成員資料／刪除成員 =====
// 重新啟用已停用帳號：status 回 active、密碼重設為預設（1234）並強制首次登入改密、
// 成員名單若在停用時被移除則補回。團長唯一鎖同樣適用（不可啟用第二位團長）。
function handleReactivateUser(body){
  const targetYmis=String(body.target_ymis||'').trim();
  if(!targetYmis) return jsonResponse({success:false,error:'請提供 YMIS'});
  if(isSuperAdminId(targetYmis)) return jsonResponse({success:false,error:'系統保留帳號，無需啟用'});
  const manager=getUser(validateToken(body.token));
  if(!manager) return jsonResponse({success:false,error:'未授權'});
  const t=getUsersTable();
  if(!t) return jsonResponse({success:false,error:'找不到 Users 工作表'});
  const row=findUserRowByYmis(t,targetYmis);
  if(!row) return jsonResponse({success:false,error:'找不到帳號'});
  if(isActiveStatus(row.status)) return jsonResponse({success:false,error:'此帳號已是啟用狀態'});
  if(manager.ymis===targetYmis) return jsonResponse({success:false,error:'不能對自己操作'});
  if(!canManageUser(manager,row.role)) return jsonResponse({success:false,error:'權限不足，不可啟用此角色的帳號'});
  // v5.3.0：團長全團只可有一位 —— 重新啟用團長亦受鎖
  if(row.role==='group_leader'){
    const cur=findActiveGroupLeader(targetYmis);
    if(cur) return jsonResponse({success:false,error:gslLockMsg(cur.name)});
  }
  t.sheet.getRange(row.rowIndex,t.col.status+1).setValue('active');
  // 密碼一併重設（舊密碼多數已無人記得）；首次登入強制改密
  t.sheet.getRange(row.rowIndex,t.col.password_hash+1).setValue(hashPassword(DEFAULT_TEMP_PASSWORD));
  t.sheet.getRange(row.rowIndex,t.col.force_change_password+1).setValue(true);
  // 成員名單在停用時被移除 → 補回
  try{
    if(!findMemberListRow(targetYmis)){
      const mSheet=getSheet().getSheetByName('成員名單');
      if(mSheet) mSheet.appendRow([targetYmis,row.name,new Date(),row.role==='member'?(row.branch||''):'',row.email,row.squad||'']);
    }
  }catch(e){}
  // 舊 token 全部失效以外的處理不需要（停用時已清）；保險起見再清一次
  try{
    const tSheet=getSheet().getSheetByName('Tokens');
    if(tSheet){ const td=tSheet.getDataRange().getValues(); for(let j=td.length-1;j>=1;j--){ if(td[j][1] && td[j][1].toString()===targetYmis) tSheet.deleteRow(j+1); } }
  }catch(e){}
  writeAudit(manager.ymis,'reactivate_user',targetYmis,'帳號重新啟用（密碼重設為預設，首次登入須改密）');
  return jsonResponse({success:true,message:'已重新啟用，臨時密碼：'+DEFAULT_TEMP_PASSWORD,temp_password:DEFAULT_TEMP_PASSWORD});
}
// 修改成員資料（姓名／小隊）：同步 Users 及 成員名單。純成員（無帳號）也可改。
function handleUpdateMemberEntry(body){
  const targetYmis=String(body.target_ymis||'').trim();
  const name=safeSheetText(body.name,100);
  const squad=body.squad===undefined?undefined:safeSheetText(body.squad,20);
  if(!targetYmis) return jsonResponse({success:false,error:'請提供 YMIS'});
  if(!name) return jsonResponse({success:false,error:'請填寫姓名'});
  const manager=getUser(validateToken(body.token));
  if(!manager) return jsonResponse({success:false,error:'未授權'});
  if(getRoleLevel(manager.role)<40) return jsonResponse({success:false,error:'權限不足'});
  let updatedMember=false, updatedUser=false;
  // 成員名單
  const mSheet=getSheet().getSheetByName('成員名單');
  if(mSheet){
    const md=mSheet.getDataRange().getValues();
    for(let i=1;i<md.length;i++){
      if(md[i][0] && String(md[i][0]).trim()===targetYmis){
        mSheet.getRange(i+1,2).setValue(name);
        if(squad!==undefined) mSheet.getRange(i+1,6).setValue(squad||'');
        updatedMember=true;
        break;
      }
    }
  }
  // Users（如有帳號）
  const t=getUsersTable();
  if(t){
    const row=findUserRowByYmis(t,targetYmis);
    if(row){
      if(!canManageUser(manager,row.role)) return jsonResponse({success:false,error:'權限不足，不可修改此用戶'});
      t.sheet.getRange(row.rowIndex,t.col.name+1).setValue(name);
      if(squad!==undefined) t.sheet.getRange(row.rowIndex,t.col.squad+1).setValue(squad||'');
      updatedUser=true;
    }
  }
  if(!updatedMember&&!updatedUser) return jsonResponse({success:false,error:'找不到成員'});
  writeAudit(manager.ymis,'update_member',targetYmis,name+(squad!==undefined?(' / 小隊:'+squad):''));
  return jsonResponse({success:true,message:'已更新'});
}
// 刪除成員：移出成員名單；如有帳號則一併停用（Users 保留列作紀錄，YMIS 亦不會被重用）。
function handleDeleteMemberEntry(body){
  const targetYmis=String(body.target_ymis||'').trim();
  if(!targetYmis) return jsonResponse({success:false,error:'請提供 YMIS'});
  const manager=getUser(validateToken(body.token));
  if(!manager) return jsonResponse({success:false,error:'未授權'});
  if(getRoleLevel(manager.role)<40) return jsonResponse({success:false,error:'權限不足'});
  if(manager.ymis===targetYmis) return jsonResponse({success:false,error:'不能刪除自己'});
  const t=getUsersTable();
  const row=t?findUserRowByYmis(t,targetYmis):null;
  if(row && !canManageUser(manager,row.role)) return jsonResponse({success:false,error:'權限不足，不可刪除此用戶'});
  let removed=false;
  const mSheet=getSheet().getSheetByName('成員名單');
  if(mSheet){
    const md=mSheet.getDataRange().getValues();
    for(let i=md.length-1;i>=1;i--){
      if(md[i][0] && String(md[i][0]).trim()===targetYmis){ mSheet.deleteRow(i+1); removed=true; }
    }
  }
  let deactivated=false;
  if(row && isActiveStatus(row.status)){
    t.sheet.getRange(row.rowIndex,t.col.status+1).setValue('inactive');
    deactivated=true;
    try{
      const tSheet=getSheet().getSheetByName('Tokens');
      if(tSheet){ const td=tSheet.getDataRange().getValues(); for(let j=td.length-1;j>=1;j--){ if(td[j][1] && td[j][1].toString()===targetYmis) tSheet.deleteRow(j+1); } }
    }catch(e){}
  }
  if(!removed&&!deactivated) return jsonResponse({success:false,error:'找不到成員'});
  writeAudit(manager.ymis,'delete_member',targetYmis,removed&&deactivated?'移出成員名單並停用帳號':(removed?'移出成員名單':'停用帳號'));
  return jsonResponse({success:true,message:removed&&deactivated?'已移出成員名單並停用帳號':(removed?'已移出成員名單':'已停用帳號')});
}

function handleRequestComplete(body, requesterYmis){
  const sheet=getSheet().getSheetByName('待批完成'); if(!sheet) return jsonResponse({success:false,error:'Sheet not found'});
  const reqId='REQ_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
  const user=getUser(requesterYmis)||{name:body.name||requesterYmis};
  sheet.appendRow([reqId,requesterYmis,user.name||body.name,body.itemId,body.itemName||body.itemId,body.requested_date||formatDate(new Date()),body.evidence||'','pending',now(),'','','', '']);
  return jsonResponse({success:true,request_id:reqId});
}
function handleGetPendingRequests(){
  const sheet=getSheet().getSheetByName('待批完成'); const list=[];
  if(sheet){ const data=sheet.getDataRange().getValues(); for(let i=1;i<data.length;i++){ if(data[i][7].toString()==='pending'){ list.push({request_id:data[i][0].toString(),ymis:data[i][1].toString(),name:data[i][2].toString(),item_id:data[i][3].toString(),item_name:data[i][4].toString(),requested_date:data[i][5]?formatDate(data[i][5]):'',evidence:data[i][6]?data[i][6].toString():'',status:'pending',created_at:data[i][8]?formatDate(data[i][8]):''}); } } }
  return jsonResponse({success:true,requests:list});
}
function handleReviewRequest(reqId,decision,note,reviewer,confirmed_date){
  const sheet=getSheet().getSheetByName('待批完成'); if(!sheet) return jsonResponse({success:false,error:'Sheet not found'});
  const data=sheet.getDataRange().getValues(); let row=null;
  for(let i=1;i<data.length;i++){ if(data[i][0].toString()===reqId){ row=data[i]; sheet.getRange(i+1,8).setValue(decision); sheet.getRange(i+1,10).setValue(reviewer); sheet.getRange(i+1,11).setValue(now()); sheet.getRange(i+1,12).setValue(note||''); sheet.getRange(i+1,13).setValue(confirmed_date||formatDate(new Date())); break; } }
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
// ===== v5.1：活動履歷（服務／活動／訓練班紀錄） =====
function getLogRecordsList(viewerYmis,isReviewer){
  const sheet=getSheet().getSheetByName(LOG_SHEET_NAME); const logs=[];
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      if(!data[i][0]) continue;
      // 非領袖（團員）只可讀自己的履歷；領袖／無登入（apikey 載入）讀全部
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
  // 未升級/未初始化時明確報錯，讓前端顯示升級提示
  if(!getSheet().getSheetByName(LOG_SHEET_NAME)) return jsonResponse({success:false,error:'\u300c'+LOG_SHEET_NAME+'\u300d工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  // v5.2：領袖（或無登入的 apikey 載入）可讀全部；團員只讀自己的履歷（私隱與進度一致）
  // reviewers (or no-user apikey loads) see all; members see only their own log records
  const isReviewer=!user || canUserTick(user.role);
  return jsonResponse({success:true,logs:getLogRecordsList(user&&!isReviewer?user.ymis:null, isReviewer)});
}
function sanitizeLogRecord(r){
  r=r||{};
  return {
    type: LOG_TYPES.indexOf(r.type)>=0 ? r.type : 'activity',
    ymis: String(r.ymis||'').trim().substring(0,20),
    name: safeSheetText(r.name,60),
    date: String(r.date||'').substring(0,20),
    title: safeSheetText(r.title,120),
    role: safeSheetText(r.role,60),
    hours: String(r.hours==null?'':r.hours).substring(0,20),
    cert_no: safeSheetText(r.cert_no,60),
    detail: safeSheetText(r.detail,500)
  };
}
function handleSaveLogRecord(records, recorderYmis, recorderName){
  const sheet=getSheet().getSheetByName(LOG_SHEET_NAME);
  if(!sheet) return jsonResponse({success:false,error:'\u300c'+LOG_SHEET_NAME+'\u300d工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
  if(!Array.isArray(records)||records.length===0) return jsonResponse({success:false,error:'沒有可儲存的紀錄'});
  if(records.length>200) return jsonResponse({success:false,error:'一次最多 200 筆，請分批'});
  const results=[]; let processed=0;
  records.forEach(function(r){
    const rec=sanitizeLogRecord(r);
    if(!rec.ymis||!rec.title||!rec.date){ results.push({success:false,ymis:rec.ymis,title:rec.title,error:'YMIS、名稱及日期必填'}); return; }
    const rid=String((r&&r.record_id)||'');
    if(rid){
      // 更新既有紀錄（record_id 不變）
      const data=sheet.getDataRange().getValues();
      for(let i=1;i<data.length;i++){
        if(String(data[i][0])===rid){
          // v5.2 修復：範圍應為 12 欄（第 2~13 欄），與 setValues 內容欄數相符（原 13 欄會報錯）
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
  if(!sheet) return jsonResponse({success:false,error:'\u300c'+LOG_SHEET_NAME+'\u300d工作表不存在：請在 Apps Script 執行 initializeSheets() 補建'});
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

function handleSaveOtherBadge(records){
  const sheet=getSheet().getSheetByName('其他獎章'); if(!sheet) return jsonResponse({success:false,error:'Sheet missing'});
  let c=0;
  records.forEach(function(r){
    const data=sheet.getDataRange().getValues(); let found=false;
    for(let i=1;i<data.length;i++){ if(data[i][0].toString()===r.ymis && data[i][1].toString()===r.badgeId){ sheet.getRange(i+1,3).setValue(r.date); sheet.getRange(i+1,4).setValue(r.cert||''); sheet.getRange(i+1,5).setValue(r.note||''); sheet.getRange(i+1,6).setValue(new Date()); found=true; c++; break; } }
    if(!found){ sheet.appendRow([r.ymis,r.badgeId,r.name||r.badgeId,r.date,r.cert||'',r.note||'',new Date()]); c++; }
  });
  return jsonResponse({success:true,processed:c});
}

// ===== v5.2：活動履歷申報（團員自行申報 → 領袖審批）=====
// Activity-log claims: members self-declare → leaders approve.
// 流程：requestLogRecord（kind=new/edit）→ 待批履歷 sheet → reviewLogRequest 批准後寫入／更新「活動履歷」。
// 修改申報（kind=edit）只限申報人自己的紀錄；批准後以同一 record_id 更新，即「批了要改 → 再申報 → 領袖重批」。
// Flow: requestLogRecord (kind=new/edit) → "待批履歷" sheet → on approval, reviewLogRequest writes/updates "活動履歷".
// Edit-claims target the claimant's OWN records only; approval updates in place with the SAME record_id
// (approved → change needed → claim again → leader re-approves).
function getLogRequestsList(onlyYmis){
  const sheet=getSheet().getSheetByName(LOG_REQ_SHEET_NAME); const list=[];
  if(sheet){
    const data=sheet.getDataRange().getValues();
    for(let i=1;i<data.length;i++){
      if(!data[i][0] || String(data[i][12])!=='pending') continue;
      // onlyYmis===null：領袖看全部；''：不傳回；否則只看該成員
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
  // 只能為自己申報：ymis／姓名一律以登入者為準，不接受偽冒他人
  // Claim for yourself only: ymis / name are forced from the logged-in user — no impersonation.
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
    if(String(found[2])!==String(user.ymis)) return jsonResponse({success:false,error:'只可申請修改自己的紀錄'});
    // 類型跟隨原紀錄，不可經修改申報變更 / Type follows the original record and cannot change via an edit-claim.
    if(LOG_TYPES.indexOf(String(found[1]))>=0) rec.type=String(found[1]);
    // 同一紀錄同時只可有一個待批修改申報 / Only one pending edit-claim per record at a time.
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
  // 領袖（can_tick）看全部待批；其他人只看自己的申報 / Reviewers (leaders) see all; others see only their own claims.
  const isReviewer=canUserTick(user.role); // 與進度審批一致：領袖角色即可
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
    // 批准修改：以同一 record_id 更新原位（需領袖重批才生效）/ Approve edit: update in place, SAME record_id.
    const targetId=String(row[2]||'');
    const ld=lSheet.getDataRange().getValues(); let li=-1;
    for(let i=1;i<ld.length;i++){ if(String(ld[i][0])===targetId){ li=i; break; } }
    if(li<0) return jsonResponse({success:false,error:'找不到原紀錄（可能已被刪除），無法批准修改'});
    recorder=String(ld[li][10]||'');
    lSheet.getRange(li+1,2,1,12).setValues([[rec.type,rec.ymis,rec.name,rec.date,rec.title,rec.role,rec.hours,rec.cert_no,rec.detail,recorder,String(ld[li][11]||''),now()]]);
    recordId=targetId;
  }else{
    recordId='LOG_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
    recorder=rec.name+'（自行申報 / self-reported）';
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
      const isReviewer=canUserTick(user.role); // 與進度審批一致：領袖角色即可
      if(!isReviewer && String(data[i][4])!==String(user.ymis)) return jsonResponse({success:false,error:'只可取消自己的申報'});
      const label=String(data[i][3]||'')+': '+String(data[i][7]||'')+' '+String(data[i][6]||'');
      sheet.deleteRow(i+1);
      writeAudit(user.ymis,'cancel_log_request',String(data[i][4]||''),label);
      return jsonResponse({success:true,message:'已取消申報'});
    }
  }
  return jsonResponse({success:false,error:'找不到申報'});
}
