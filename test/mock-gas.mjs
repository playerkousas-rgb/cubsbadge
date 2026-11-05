// mock-gas.mjs
// 輕量 Google Apps Script 環境 mock：在 Node 中載入 apps-script/Code.gs，
// 用記憶體內的試算表執行後端邏輯（單元級 e2e），方便驗證 v5.3.1 的新規則。
// 用於 tests：npm run test:e2e
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import vm from 'vm';
import crypto from 'crypto';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------- 記憶體試算表 ----------
function makeCellRange(sheet, r, c, nr, nc) {
  const rows = () => sheet.rows;
  return {
    getValue() {
      const row = rows()[r - 1];
      return row ? (row[c - 1] ?? '') : '';
    },
    setValue(v) {
      const rr = r - 1, cc = c - 1;
      while (rows().length < rr + 1) rows().push([]);
      const row = rows()[rr];
      while (row.length < cc + 1) row.push('');
      row[cc] = v;
      return this;
    },
    getValues() {
      const out = [];
      const R = nr || 1, C = nc || 1;
      for (let i = 0; i < R; i++) {
        const line = [];
        for (let j = 0; j < C; j++) {
          const rr = (r - 1) + i, cc = (c - 1) + j;
          const row = rows()[rr];
          line.push(row ? (row[cc] ?? '') : '');
        }
        out.push(line);
      }
      return out;
    },
    // 格式化 API 在 mock 中為可鏈結的 no-op（Code.gs 建表時會呼叫）
    setFontWeight() { return this; },
    setBackground() { return this; },
    setFontColor() { return this; },
    setValues(vals) {
      vals.forEach((line, i) => {
        line.forEach((v, j) => {
          const rr = (r - 1) + i, cc = (c - 1) + j;
          while (rows().length < rr + 1) rows().push([]);
          const row = rows()[rr];
          while (row.length < cc + 1) row.push('');
          row[cc] = v;
        });
      });
      return this;
    },
  };
}

function makeSheet(name, header) {
  const rows = header ? [header.slice()] : [[]];
  const sheet = {
    name,
    getName() { return sheet.name; },
    rows,
    appendRow(vals) {
      // 真 GAS 的 appendRow 會原樣寫入所有欄；即使超出表頭欄數亦不會截斷
      // （例如「待批完成」新增 col14 級別）。以 header 與傳入長度兩者較大者為準。
      const values = Array.isArray(vals) ? vals : [vals];
      const target = Math.max(header.length || 0, values.length);
      const row = [];
      for (let i = 0; i < target; i++) row.push(values[i] ?? '');
      rows.push(row);
      return sheet;
    },
    deleteRow(index) { rows.splice(index - 1, 1); return sheet; },
    setFrozenRows() { return sheet; },
    getLastRow() { return rows.length; },
    getLastColumn() {
      let m = 0;
      rows.forEach(r => { if (r.length > m) m = r.length; });
      return Math.max(m, header.length);
    },
    getDataRange() {
      const lastCol = sheet.getLastColumn();
      const norm = rows.map(r => {
        const row = [];
        for (let i = 0; i < lastCol; i++) row.push(r[i] ?? '');
        return row;
      });
      return {
        getValues() { return norm.map(r => r.slice()); },
        getLastRow() { return rows.length; },
        getLastColumn() { return lastCol; },
      };
    },
    getRange(r, c, nr, nc) { return makeCellRange(sheet, r, c, nr, nc); },
  };
  return sheet;
}

const USERS_HEADER = ['ymis','name','email','role','password_hash','branch','can_tick','auth_by','auth_date','created_at','last_login','status','allowed_badges','squad','squad_role','force_change_password'];

function newSpreadsheet() {
  const sheets = {};
  function add(name, header) { const s = makeSheet(name, header); sheets[name] = s; return s; }
  add('Users', USERS_HEADER);
  add('Applications', ['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note']);
  add('成員名單', ['YMIS','姓名','加入日期','支部','聯絡','小隊']);
  add('Tokens', ['token','ymis','created_at','expires_at']);
  add('SystemConfig', ['key','value','updated_at','updated_by']);
  add('進度追蹤', ['YMIS','項目 ID','完成日期','更新時間','確認者','備註']);
  add('待批完成', ['request_id','ymis','name','item_id','item_name','requested_date','evidence','status','created_at','reviewed_by','reviewed_at','review_note','confirmed_date']);
  add('其他獎章', ['YMIS','獎章 ID','獎章名稱','完成日期','證書編號','備註','更新時間']);
  add('服務紀錄', ['record_id','YMIS','姓名','活動名稱','日期','時數','機構／地點','內容','核實領袖','狀態','備註']);
  add('操作紀錄', ['時間','操作者','操作','對象','詳情']);
  add('活動履歷', ['record_id','type','ymis','name','date','title','role','hours','cert_no','detail','recorder','recorded_at','updated_at']);
  add('待批履歷', ['request_id','kind','target_record_id','type','ymis','name','date','title','role','hours','cert_no','detail','status','created_at','reviewed_by','reviewed_at','review_note']);
  return {
    // Spreadsheet 層 API（diagnoseSheets / getSpreadsheetInfo 會用）
    name: 'CubBadgePreview',
    getName() { return this.name; },
    getId() { return 'mock-spreadsheet-id'; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/mock-spreadsheet-id'; },
    sheets,
    add,
    getSheetByName(n) { return sheets[n] || null; },
    getSheets() { return Object.values(sheets); },
    insertSheet(n) {
      // 真 GAS insertSheet() 回傳一張完全空白嘅表；表頭由呼叫者 appendRow() 寫入。
      // 以前呢度預填表頭，會令 ensureTable() 再 appendRow 一次（重複表頭）。
      const sh = add(n, []);
      sh.rows.length = 0;
      return sh;
    },
  };
}

// ---------- hashPassword 兼容（SHA-256 hex） ----------
function sha256Hex(p) { return crypto.createHash('sha256').update(String(p), 'utf8').digest('hex'); }

function buildBackend() {
  const ss = newSpreadsheet();
  const mailOutbox = [];

  // -------- GAS 全域 stub --------
  const textOutputFactory = () => ({
    _text: '',
    createTextOutput(s) { this._text = s; return this; },
    setMimeType() { return this; },
    getContent() { return this._text; },
  });
  const service = Object.assign({
    createTextOutput(s) { const o = textOutputFactory(); o._text = s; return o; },
    MimeType: { JSON: 'application/json' },
  });

  const globals = {
    console,
    Utilities: {
      computeDigest(algo, text, charset) {
        // 簡化：回傳 sha256 bytes（apps-script 回傳每 byte 0..255）
        return [...crypto.createHash('sha256').update(String(text), 'utf8').digest()];
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid: () => crypto.randomUUID().replace(/-/g, ''),
      newBlob: text => ({getBytes: () => [...Buffer.from(String(text),'utf8')]}),
      formatDate(d, tz, fmt) { return String(fmt || ''); },
      // EC_SIG：HMAC-SHA256 + base64（回傳 signed byte array，同 Apps Script 一致）
      computeHmacSha256Signature(msg, key) {
        return [...crypto.createHmac('sha256', Array.isArray(key) ? Buffer.from(key.map(x=>x&255)) : String(key)).update(Array.isArray(msg) ? Buffer.from(msg.map(x=>x&255)) : String(msg)).digest()]
          .map(b => (b > 127 ? b - 256 : b));
      },
      base64Encode(bytes) {
        const buf = Buffer.from((bytes || []).map(b => (b < 0 ? b + 256 : b)));
        return buf.toString('base64');
      },
    },
    Logger: { log: () => {}, },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => null,
    },
    PropertiesService: (() => {
      // 同一個 backend 實例內必須持久：舊版每次 getScriptProperties() 都新建
      // 一個 store，令 API_KEY / 超管密碼雜湊寫完即失，EC_SIG 驗簽永遠失敗。
      const store = {};
      const props = {
        getProperty: k => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); return props; },
        deleteProperty: k => { delete store[k]; return props; },
        getProperties: () => ({ ...store }),
      };
      return { getScriptProperties: () => props, getUserProperties: () => props, __store: store };
    })(),
    ContentService: service,
    ScriptApp: { getService: () => ({ getUrl: () => 'https://mock.example/exec' }) },
    // 領袖忘記密碼：記錄 Apps Script 應該寄出嘅電郵，方便測試重設碼／不洩漏密碼
    MailApp: {
      sendEmail(message) {
        if (message && typeof message === 'object') mailOutbox.push({ ...message });
        else mailOutbox.push({ to: arguments[0], subject: arguments[1], body: arguments[2] });
        return this;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => true, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {}, getAll: () => ({}) }) },
    // 讓 doPost/handleLogin 等用到時不致中斷
    Date,
    JSON,
    Math,
    String,
    Number,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
  };
  globals.globalThis = globals;

  const code = readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const sandbox = vm.createContext(globals);
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });
  sandbox.__ss = ss;
  sandbox.__service = service;
  sandbox.__mail = mailOutbox;
  return sandbox;
}

// 便捷：hash 密碼放入 Users 某一列
export { buildBackend, sha256Hex, newSpreadsheet, USERS_HEADER };
