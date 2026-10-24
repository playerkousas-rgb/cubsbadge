// Credential displays must never suggest a guessed deployment URL.
// The user explicitly chose API-key-only displays: no URL discovery or new paste/configuration step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBackend } from './mock-gas.mjs';

const FALSE_URLS = [
  'https://script.google.com/macros/s/WRONG_INITIALIZER_NODE/exec',
  'https://script.google.com/a/example.org/macros/s/WRONG_MENU_NODE/exec',
  'https://script.google.com/macros/s/WRONG_CACHED_NODE/exec'
];
const KEY = 'sc_display_test_0123456789abcdef';

function setup() {
  const backend = buildBackend();
  const alerts = [], logs = [], items = [], prompts = [];
  const calls = { getUrl: 0, fetch: 0 };
  const props = backend.PropertiesService.getScriptProperties();
  props.setProperty('API_KEY', KEY);
  props.setProperty('WEBAPP_URL', FALSE_URLS[2]);
  backend.setTroopId('0082');
  backend.setTroopName('第 82 旅');
  backend.ScriptApp.getService = () => ({
    getUrl() {
      const value = FALSE_URLS[calls.getUrl % FALSE_URLS.length];
      calls.getUrl++;
      return value;
    }
  });
  backend.UrlFetchApp = {
    fetch() { calls.fetch++; throw new Error('Displays must not probe any URL'); }
  };
  backend.Logger.log = message => logs.push(String(message));
  const ui = {
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    alert(...args) { alerts.push(args); return 'OK'; },
    prompt(...args) {
      prompts.push(args);
      return { getSelectedButton: () => 'CANCEL', getResponseText: () => '' };
    },
    createMenu(title) {
      const menu = {
        addItem(label, handler) { items.push({ title, label, handler }); return menu; },
        addSeparator() { return menu; },
        addSubMenu() { return menu; },
        addToUi() { return menu; }
      };
      return menu;
    }
  };
  backend.SpreadsheetApp.getUi = () => ui;
  return { backend, alerts, logs, items, prompts, props, calls };
}

function json(response) { return JSON.parse(response.getContent()); }
function assertNoDeploymentUrl(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const url of FALSE_URLS) assert.ok(!text.includes(url), `must not suggest ${url}`);
  assert.doesNotMatch(text, /https?:\/\//, 'credential displays must not contain a URL value');
  assert.doesNotMatch(text, /_BACKEND\s*=|已核實|ID 長度|56 字元|74 字元/);
}

test('initializeSheets alert and execution result show the existing key, never a third /exec', () => {
  const { backend, alerts, logs, calls, props } = setup();
  const result = backend.initializeSheets();
  assert.equal(result.success, true);
  assert.equal(result.apiKey, KEY);
  assert.equal(result.troopId, '0082');
  assert.equal(Object.hasOwn(result, 'scriptUrl'), false, 'do not return a guessed URL to the editor');
  assert.equal(Object.hasOwn(result, 'backend'), false);
  assert.ok(alerts.length > 0, 'test the real initialization popup, not just a helper');
  assert.match(JSON.stringify(alerts), /初始化完成/);
  assert.ok(JSON.stringify(alerts).includes(KEY), 'the leader can read the API key immediately');
  assertNoDeploymentUrl(alerts);
  assertNoDeploymentUrl(result);
  assertNoDeploymentUrl(logs);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
  assert.equal(props.getProperty('WEBAPP_URL'), FALSE_URLS[2], 'ignore old cache without rewriting user settings');
});

test('all credential displays show the same plain API key without troop-specific env names', () => {
  const { backend, alerts, logs, calls, prompts } = setup();
  const lines = backend.vercelEnvLines();
  assert.deepEqual(Array.from(lines), [
    'API Key = ' + KEY
  ]);
  const shown = backend.showVercelEnv();
  assert.deepEqual(Array.from(shown), Array.from(lines));
  assert.equal(backend.showApiKey(), KEY, 'keep the existing API-key return contract');
  const menuText = backend.menuShowLinkCredentials();
  assert.ok(menuText.includes(KEY));
  assert.ok(menuText.includes('Google「部署 → 管理部署」'));
  for (const value of [lines, shown, menuText, alerts, logs]) assertNoDeploymentUrl(value);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
  assert.equal(prompts.length, 0, 'never ask the leader to paste or configure a backend URL');
});

test('displays work even if Google URL lookup and network access fail', () => {
  const { backend, alerts, calls } = setup();
  backend.ScriptApp.getService = () => { calls.getUrl++; throw new Error('No service context'); };
  assert.doesNotThrow(() => backend.initializeSheets());
  assert.equal(backend.showApiKey(), KEY);
  assert.doesNotThrow(() => backend.showVercelEnv());
  assert.doesNotThrow(() => backend.menuShowLinkCredentials());
  assertNoDeploymentUrl(alerts);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});

test('legacy and untrusted URL settings never become displayed deployment information', () => {
  const { backend, props, alerts, calls } = setup();
  props.setProperty('BACKEND_EXEC_URL', FALSE_URLS[0]);
  props.setProperty('WEBAPP_URL_VERIFIED', 'true');
  backend.initializeSheets();
  backend.showApiKey();
  backend.showVercelEnv();
  backend.menuShowLinkCredentials();
  assertNoDeploymentUrl(alerts);
  assert.equal(typeof backend.getScriptUrl, 'undefined');
  assert.equal(typeof backend.resolveBackendUrl, 'undefined');
  assert.equal(typeof backend.rememberWebAppUrlFromRequest, 'undefined');
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});

test('ordinary HTTP requests no longer discover, store or return a self-reported backend URL', () => {
  const { backend, props, calls } = setup();
  const before = { ...props.getProperties() };
  const get = json(backend.doGet({ parameter: { action: 'getLoginMode', backend: FALSE_URLS[0] } }));
  assert.equal(get.success, true);
  const post = json(backend.doPost({ parameter: {}, postData: {
    contents: JSON.stringify({ action: 'getDownstreamAccess', backend: FALSE_URLS[1] })
  } }));
  assert.equal(post.success, true);
  for (const apikey of ['', 'wrong', KEY]) {
    const self = json(backend.doGet({ parameter: { action: 'selfUrl', apikey } }));
    assert.equal(self.success, false, 'remove the circular selfUrl verification endpoint');
    assert.equal(Object.hasOwn(self, 'scriptUrl'), false);
    assertNoDeploymentUrl(self);
  }
  assert.deepEqual({ ...props.getProperties() }, before);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});

test('new Sheet menu says API KEY, has no auto-verify or manual backend-setting action', () => {
  const { backend, items } = setup();
  backend.onOpen();
  const credentials = items.find(item => item.handler === 'menuShowLinkCredentials');
  assert.ok(credentials, 'retain the existing handler so old menu bindings remain valid');
  assert.equal(credentials.label, '🔑 顯示 API KEY（交 ADMIN）');
  assert.ok(!items.some(item => /顯示 BACKEND|驗證 BACKEND|設定 BACKEND/.test(item.label)));
  assert.ok(!items.some(item => /SetBackend|VerifyBackend/.test(item.handler)));
  assert.ok(!items.some(item => /設定旅團編號/.test(item.label)), 'troop ID belongs in the ADMIN FORM, not a new Sheet setup menu');
});

test('an already-open old URL-verification menu cannot show or probe an unreliable URL', () => {
  const { backend, alerts, logs, calls } = setup();
  const result = backend.verifyBackendUrl(FALSE_URLS[0]);
  assert.equal(result.success, false);
  assert.equal(result.code, 'AUTO_BACKEND_URL_DISABLED');
  assert.equal(Object.hasOwn(result, 'url'), false);
  const text = backend.menuVerifyBackendUrl();
  assert.match(text, /不顯示自動取得或推算/);
  for (const value of [result, text, alerts, logs]) assertNoDeploymentUrl(value);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});

test('reinitialization preserves existing key, business data and legacy properties', () => {
  const { backend, props, alerts } = setup();
  backend.initializeSheets();
  backend.__ss.sheets['成員名單'].rows.push(['1234567890', '陳大文', '2025-01-01', 'b4', '', '紅隊']);
  backend.__ss.sheets['進度追蹤'].rows.push(['1234567890', 'OLD-01', '2025-01-01', '2025-01-02', '舊領袖', '保留備註']);
  const snapshot = JSON.stringify(Object.fromEntries(Object.entries(backend.__ss.sheets).map(([name, sheet]) => [name, sheet.rows])));
  const originalProps = { ...props.getProperties() };
  backend.initializeSheets();
  backend.initializeSheets();
  backend.showApiKey();
  backend.showVercelEnv();
  backend.menuShowLinkCredentials();
  assert.equal(backend.getApiKey(), KEY);
  assert.deepEqual({ ...props.getProperties() }, originalProps);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(backend.__ss.sheets).map(([name, sheet]) => [name, sheet.rows]))), snapshot);
  assertNoDeploymentUrl(alerts);
});

test('no-sheet showApiKey still returns the API key without probing a URL', () => {
  const { backend, logs, calls } = setup();
  backend.SpreadsheetApp.getActiveSpreadsheet = () => null;
  assert.equal(backend.showApiKey(), KEY);
  assertNoDeploymentUrl(logs);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});

test('frontend instructions no longer promise automatic URL verification or require a new URL setting step', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /GS 彈窗及選單只提供 API Key/);
  assert.match(html, /dialogs and menus provide only the API Key/);
  assert.match(html, /旅團編號直接在 ADMIN FORM 填寫/);
  assert.match(html, /Enter the troop ID directly in the ADMIN FORM/);
  assert.doesNotMatch(html, /GS 會自動記低正確網址|script then remembers the correct URL|only submit when it says “✅ verified”/);
  const gas = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.doesNotMatch(gas, /function (?:setBackendUrl|menuSetBackendUrl|rememberWebAppUrlFromRequest|selfUrlPayload|looksLikeHeadDeployment)\s*\(/);
  assert.doesNotMatch(gas, /WEBAPP_URL_PROP|URL_MISMATCH_WARNING/);
});


test('fresh initialization generates an API key without any troop ID or configuration prompt', () => {
  const { backend, props, alerts, prompts, calls } = setup();
  props.deleteProperty('TROOP_ID');
  props.deleteProperty('TROOP_NAME');
  props.deleteProperty('API_KEY');
  const result = backend.initializeSheets();
  assert.equal(result.success, true);
  assert.match(result.apiKey, /^sc_[0-9a-f]{24}$/);
  assert.equal(result.troopId, '');
  assert.equal(result.troopName, '');
  assert.equal(props.getProperty('TROOP_ID'), null, 'do not infer or create a local troop ID');
  assert.equal(props.getProperty('TROOP_NAME'), null);
  assert.equal(prompts.length, 0, 'initialization must not ask for an ID, name, or URL');
  assert.ok(JSON.stringify(alerts).includes('API Key = ' + result.apiKey));
  assert.match(JSON.stringify(alerts), /ADMIN FORM/);
  assert.doesNotMatch(JSON.stringify(alerts), /TROOP_<|（未設定）|TROOP_.*_APIKEY/);
  assertNoDeploymentUrl(alerts);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });

  const initializedKey = result.apiKey;
  backend.showApiKey();
  backend.showVercelEnv();
  backend.menuShowLinkCredentials();
  backend.initializeSheets();
  assert.equal(backend.getApiKey(), initializedKey, 'subsequent views and initialization preserve the generated key');
  assert.equal(prompts.length, 0);
  assert.equal(props.getProperty('TROOP_ID'), null);
});

test('API-key menu works before initialization without requiring a troop ID', () => {
  const { backend, props, prompts, calls } = setup();
  props.deleteProperty('TROOP_ID');
  props.deleteProperty('API_KEY');
  const text = backend.menuShowLinkCredentials();
  const key = props.getProperty('API_KEY');
  assert.match(key, /^sc_[0-9a-f]{24}$/);
  assert.ok(text.includes('API Key = ' + key));
  assert.match(text, /ADMIN FORM/);
  assert.doesNotMatch(text, /TROOP_<|（未設定）/);
  assertNoDeploymentUrl(text);
  assert.equal(prompts.length, 0);
  assert.equal(props.getProperty('TROOP_ID'), null);
  assert.deepEqual(calls, { getUrl: 0, fetch: 0 });
});
