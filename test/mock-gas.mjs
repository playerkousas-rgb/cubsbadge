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
    rows,
    appendRow(vals) {
      const target = header.length;
      const row = [];
      for (let i = 0; i < target; i++) row.push(vals[i] ?? '');
      rows.push(row);
      return sheet;
    },
    deleteRow(index) { rows.splice(index - 1, 1); return sheet; },
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
    sheets,
    add,
    getSheetByName(n) { return sheets[n] || null; },
    getSheets() { return Object.values(sheets); },
    insertSheet(n) {
      const h = {
        'Users': USERS_HEADER,
        'Applications': ['app_id','ymis','name','email','role','branch','status','applied_at','reviewed_by','reviewed_at','note'],
        '成員名單': ['YMIS','姓名','加入日期','支部','聯絡','小隊'],
        'Tokens': ['token','ymis','created_at','expires_at'],
      }[n] || [];
      return add(n, h);
    },
  };
}

// ---------- hashPassword 兼容（SHA-256 hex） ----------
function sha256Hex(p) { return crypto.createHash('sha256').update(String(p), 'utf8').digest('hex'); }

function buildBackend() {
  const ss = newSpreadsheet();

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
      formatDate(d, tz, fmt) { return String(fmt || ''); },
    },
    Logger: { log: () => {}, },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => null,
    },
    PropertiesService: {
      getScriptProperties: () => {
        const store = {};
        return {
          getProperty: k => store[k] ?? null,
          setProperty: (k, v) => { store[k] = String(v); },
        };
      },
    },
    ContentService: service,
    ScriptApp: { getService: () => ({ getUrl: () => 'https://mock.example/exec' }) },
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
  return sandbox;
}

// 便捷：hash 密碼放入 Users 某一列
export { buildBackend, sha256Hex, newSpreadsheet, USERS_HEADER };
