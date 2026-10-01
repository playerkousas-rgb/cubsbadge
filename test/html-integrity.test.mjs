// 部署面一致性守護測試（v6.0 對齊 roverbadge 改動）
// 掃描「會公開出去嘅檔案」：index.html（前端）、apps-script/Code.gs（前端提供下載俾旅團部署）、
// api/health.js、api/ecosystem.js、api/proxy.js、api/troops.js（Vercel 公開回應）。
// 驗證：
//   1. 版號統一：index.html 全部版本字樣 = v6.0（無殘留 v5.2/v5.8），package.json = 6.0.0
//   2. 超管零痕跡：前端／分發後端／公開回應搜不到帳號名、代號、SUPER_KEY、維護帳戶字眼
//   3. 關門制唔顯示下游：index.html 無 ALLOW_LOCAL_LOGIN
//   4. 非官方聲明：footer 第 4 行（中英），並移除 scout.org.hk 官方連結
//   5. Scout Admin 回報入口：script 標簽（data-app）＋ 3 個入口按鈕 + 本機回報 modal / deliveryStatus UX
//   6. Code.gs 分發衛生：'sheep' 只可出現喺 2 行身份常量；用戶可見字串全部中性
import fs from 'node:fs';
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✘ ${name}\n     → ${String(e.message).split('\n').slice(0, 4).join('\n     → ')}`);
  }
}

const html = fs.readFileSync('index.html', 'utf8');
const gas = fs.readFileSync('apps-script/Code.gs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const health = fs.readFileSync('api/health.js', 'utf8');
const eco = fs.readFileSync('api/ecosystem.js', 'utf8');
const proxy = fs.readFileSync('api/proxy.js', 'utf8');
const troops = fs.readFileSync('api/troops.js', 'utf8');

console.log('=== 1. 版號統一（v6.0） ===');
check('index.html 無殘留舊版號 v5.2 / v5.8', () => {
  assert.equal(/v5\.(2|8)\b/.test(html), false, '仍有舊版號字樣');
});
check('index.html 所有版本字樣都係 v6.0', () => {
  const versions = [...html.matchAll(/v6\.\d+/g)].map(m => m[0]);
  assert.ok(versions.length >= 10, `版本字樣太少（${versions.length}），唔該檢查`);
  assert.ok(versions.every(v => v === 'v6.0'), `發現非 v6.0：${[...new Set(versions)].join(', ')}`);
});
check('package.json version = 6.0.0', () => {
  assert.equal(pkg.version, '6.0.0');
});

console.log('=== 2. 超管零痕跡（公開面） ===');
const noTrace = (src, label, patterns) => {
  for (const [re, why] of patterns) {
    const m = src.match(re);
    assert.equal(m, null, `${label}：${why}${m ? '（命中：' + String(m[0]).slice(0, 40) + '）' : ''}`);
  }
};
const TRACE_PATTERNS = [
  [/sheep/i, '帳號名 sheep'],
  [/SUPER_KEY/, 'SUPER_KEY'],
  [/APP_ADMIN/, '舊中性代號 APP_ADMIN'],
  [/cubbadge\.local/i, '內部電郵'],
  [/維護帳戶/, '「維護帳戶」字眼'],
  [/超管/, '「超管」字眼'],
];
check('index.html（部署前端）零超管痕跡', () => noTrace(html, 'index.html', TRACE_PATTERNS));
check('api/health.js 零超管痕跡', () => noTrace(health, 'api/health.js', TRACE_PATTERNS));
check('api/ecosystem.js 零超管痕跡', () => noTrace(eco, 'api/ecosystem.js', TRACE_PATTERNS));
check('api/troops.js 零超管痕跡', () => noTrace(troops, 'api/troops.js', TRACE_PATTERNS));
check('api/proxy.js 無帳號名（sheep）', () => noTrace(proxy, 'api/proxy.js', [[/sheep/i, '帳號名 sheep']]));
check('data/ 公開靜態檔（troops.json／units.json）零超管痕跡', () => {
  const troopsJson = fs.readFileSync('data/troops.json', 'utf8');
  const unitsJson = fs.readFileSync('data/units.json', 'utf8');
  noTrace(troopsJson, 'data/troops.json', TRACE_PATTERNS);
  noTrace(unitsJson, 'data/units.json', TRACE_PATTERNS);
});
check('Code.gs（分發俾旅團）：sheep 只可喺 2 行身份常量', () => {
  const lines = gas.split('\n');
  const hits = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /sheep/i.test(line));
  assert.equal(hits.length, 2, `sheep 出現在 ${hits.length} 行：` + hits.map(h => `L${h.n}`).join(', '));
  assert.ok(hits.every(h => /const\s+SUPER_ADMIN_LOGIN|const\s+LEGACY_SUPER_ADMIN_LABEL/.test(h.line)),
    'sheep 只可以喺 SUPER_ADMIN_LOGIN／LEGACY_SUPER_ADMIN_LABEL 常量');
});
check('Code.gs：「超管／維護帳戶」字眼零命中', () => noTrace(gas, 'Code.gs', [[/超管/, '「超管」字眼'], [/維護帳戶/, '「維護帳戶」字眼']]));
check('Code.gs：「SHEEP 系統管理員」只可喺舊標籤常量（一處）', () => {
  assert.equal(gas.split('SHEEP 系統管理員').length - 1, 1, '舊標籤應該只出現一次（LEGACY_SUPER_ADMIN_LABEL）');
  assert.match(gas, /const\s+LEGACY_SUPER_ADMIN_LABEL\s*=\s*'SHEEP 系統管理員'/);
});
check('Code.gs：改密碼錯誤回應已中性化', () => {
  assert.equal(/SUPER_KEY_AT_APP_ADMIN/.test(gas), false, '舊錯誤代號 SUPER_KEY_AT_APP_ADMIN 仍存在');
  assert.ok(/PASSWORD_MANAGED_CENTRALLY/.test(gas));
  assert.ok(/此帳號密碼由中央管理/.test(gas));
});
check('Code.gs：showApiKey 彈窗唔再提 SUPER_KEY／超管', () => {
  assert.equal(gas.includes('⚠️ 超管（維護帳戶）密碼'), false);
  assert.ok(gas.includes('Vercel 功能變數全部由 APP ADMIN 設定，旅團毋須設定任何功能變數'), '中立彈窗文字要存在');
});
check('Code.gs：保留帳號虛擬用戶用中性代號（ymis=APP_ADMIN、email 空白、顯示名無 SHEEP）', () => {
  assert.match(gas, /ymis:SUPER_STORAGE_ID,name:SUPER_ADMIN_NAME,email:''/);
  assert.match(gas, /const SUPER_ADMIN_NAME = '系統管理員'/);
});

console.log('=== 3. 關門制唔顯示下游 ===');
check('index.html 無 ALLOW_LOCAL_LOGIN（關門狀態唔對下游顯示）', () => {
  assert.equal(/ALLOW_LOCAL_LOGIN/.test(html), false);
});

console.log('=== 4. 非官方聲明（footer） ===');
check('footer 有第 4 行非官方聲明（HTML + 中文字典 + 英文字典）', () => {
  assert.ok(/data-i18n="footer_line4"/.test(html), 'HTML 缺 footer_line4 元素');
  assert.ok(/footer_line4:'⚠️ 非官方聲明：本系統為獨立開發的非官方工具，並非香港童軍總會官方產品，與總會並無隸屬或贊助關係。'/.test(html), '中文字典缺非官方聲明');
  assert.ok(/footer_line4:'⚠️ Unofficial notice: This is an independently developed unofficial tool[^']*Scout Association of Hong Kong[^']*'/.test(html), '英文字典缺 Unofficial notice');
});
check('footer 已移除「與總會隸屬」官方連結（只餘功能性官方表格下載）', () => {
  // footer 三行（HTML 預設 + 中／英文字典 footer_line1..3）唔可以再出現 scout.org.hk
  const footerBlock = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.equal(/scout\.org\.hk/.test(footerBlock), false, 'footer 仍帶官方連結（應只留功能性表格下載喺表單區）');
  const zhFooter = (html.match(/footer_line3:'[^']*'/) || [''])[0];
  const enFooter = (html.match(/footer_line3:'[^']*'/g) || ['',''])[1];
  assert.equal(/scout\.org\.hk/.test(zhFooter), false, '中文 footer_line3 仍帶官方連結');
  assert.equal(/scout\.org\.hk/.test(enFooter), false, '英文 footer_line3 仍帶官方連結');
});

console.log('=== 5. Scout Admin 回報入口（問題回報／意見回饋） ===');
check('widget script 標簽仍保留 data-app=幼童軍進度追蹤（向下兼容），但入口使用本機 modal', () => {
  assert.match(html, /<script src="https:\/\/scout-admin-blue\.vercel\.app\/widget\.js" data-app="幼童軍進度追蹤"><\/script>/);
  assert.ok(/id="feedbackModal"/.test(html), '缺 feedbackModal');
});
check('openScoutReport() 已定義，開啟本機 feedbackModal，proxy 有 deliveryStatus 協定', () => {
  assert.ok(/function openScoutReport\(\)\{ showFeedbackModal\(\); \}/.test(html));
  assert.ok(/function showFeedbackModal\(\)/.test(html));
  assert.ok(/deliveryStatus/.test(proxy), 'proxy 缺 deliveryStatus 回報協定');
});
check('3 個入口：welcome-nav 按鈕 + 登入頁連結 + header 常駐按鈕', () => {
  const entries = html.split('openScoutReport()').length - 1;
  assert.ok(entries >= 4, `openScoutReport 調用點太少（${entries}）：要 3 個按鈕 + function`);
  assert.ok(/class="welcome-feedback" onclick="openScoutReport\(\)"/.test(html), 'welcome-nav 入口缺失');
  assert.ok(/btn-feedback-top" onclick="openScoutReport\(\)"/.test(html), 'header 入口缺失');
});
check('i18n：btn_report_feedback 中英都有', () => {
  assert.ok(/btn_report_feedback:'🐛💬 回報 · 意見'/.test(html));
  assert.ok(/btn_report_feedback:'🐛💬 Report · Feedback'/.test(html));
});
check('FAB 隱藏（用常駐按鈕代替）', () => {
  assert.ok(/#scoutw-fab\{display:none/.test(html));
});

console.log('=== 6. i18n 完整性（中英字典同步，英文模式全英文） ===');
function extractI18N() {
  const s = html.indexOf('const I18N={');
  const e = html.indexOf('\n};', s);
  return new Function(html.slice(s, e + 2) + '; return I18N;')();
}
check('I18N 可解析，且非空 zh key 全部有 en（英文模式唔會 fallback 顯示中文）', () => {
  const I18N = extractI18N();
  const miss = Object.keys(I18N.zh).filter(k => String(I18N.zh[k]).length > 0 && !(k in I18N.en));
  assert.deepEqual(miss, [], `en 缺 key：${miss.join(', ')}`);
});
check('所有 t()/tf() 用到嘅 key 中英字典都有（唔會顯示 raw key）', () => {
  const I18N = extractI18N();
  const used = [...new Set([...html.matchAll(/\bt(?:f)?\(\s*['"]([A-Za-z0-9_]+)['"]\s*[,)]/g)].map(m => m[1]))];
  assert.ok(used.length > 300, `t()/tf() key 樣本太少（${used.length}），唔該檢查`);
  const missZh = used.filter(k => !(k in I18N.zh));
  const missEn = used.filter(k => !(k in I18N.en));
  assert.deepEqual(missZh, [], `zh 缺：${missZh.join(', ')}`);
  assert.deepEqual(missEn, [], `en 缺：${missEn.join(', ')}`);
});
check('data-i18n／-html／-ph／-aria／-alt 屬性 key 中英字典都有', () => {
  const I18N = extractI18N();
  const keys = [];
  for (const m of html.matchAll(/data-i18n(?:-html|-ph|-aria|-alt)?="([^"]+)"/g)) keys.push(m[1]);
  assert.ok(keys.length > 150, `data-i18n 屬性太少（${keys.length}），唔該檢查`);
  const miss = [...new Set(keys)].filter(k => !(k in I18N.zh) || !(k in I18N.en));
  assert.deepEqual(miss, [], `缺：${miss.join(', ')}`);
});

console.log(`\n== integrity 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
