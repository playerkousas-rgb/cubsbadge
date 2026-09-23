// test/devserver.mjs — 本機開發伺服器（唔會部署，淨係用嚟喺沙盒睇實際效果）
// 跑法：node test/devserver.mjs   (npm run dev)
// 行為同 Vercel 對齊：靜態檔直出，/api/* 交返俾對應嘅 serverless handler。
//
// Preview 旅團：若 TROOP_0082_BACKEND 未設定（沙盒／本地冇 Vercel 功能變數），
// 自動啟用「內置 0082 預覽旅團」——用 mock-gas 喺記憶體執行 apps-script/Code.gs，
// 令 /api/troops 照常列出 0082，登入／載入資料全走真實 proxy 流程。
// 設定咗 TROOP_0082_BACKEND（指向真實後端）就完全唔會啟動呢個 mock。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(pathToFileURL(path.join(ROOT, 'package.json')));
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.csv': 'text/csv', '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

// ---------- Preview 0082 預覽旅團（mock GAS 後端，只喺冇真實功能變數時啟用） ----------
async function ensurePreviewTroop() {
  if (process.env.TROOP_0082_BACKEND) {
    console.log('[dev] 已設定 TROOP_0082_BACKEND — 使用真實後端，唔啟動預覽 mock。');
    return;
  }
  const { buildBackend, sha256Hex } = await import('./mock-gas.mjs');
  const sandbox = buildBackend();
  sandbox.initializeSheets();   // 建齊全部工作表＋生成 API_KEY（同旅團實際跑 initializeSheets 一樣）
  const apiKey = sandbox.getApiKey();

  // 預覽帳號（全部密碼 1234，唔強制改密，方便直接試）：
  //   管理員：admin@example.com      旅長：leader@troop82.hk（陳大文）
  //   成員：1234560001 王小一 / 1234560002 李小二 / 1234560003 張小三 / 1234560004 王小明
  const seedUser = (ymis, name, email, role, canTick, allowed, squad, squadRole) => {
    const rows = sandbox.__ss.sheets.Users.rows;
    const row = new Array(16).fill('');
    row[0] = ymis; row[1] = name; row[2] = email || ''; row[3] = role;
    row[4] = sha256Hex('1234'); row[5] = 'b4'; row[6] = !!canTick;
    row[11] = 'active'; row[12] = allowed; row[13] = squad || ''; row[14] = squadRole || 'member'; row[15] = false;
    rows.push(row);
    const mrows = sandbox.__ss.sheets['成員名單'].rows;
    mrows.push([ymis, name, '2026-09-01', '幼童軍', '', squad || '']);
  };
  // initializeSheets 已建預設管理員（1111111111 / admin@example.com / changeme / 強制改密）——預覽改成 1234 免改密
  const adminRow = sandbox.__ss.sheets.Users.rows[1];
  if (adminRow) { adminRow[4] = sha256Hex('1234'); adminRow[15] = false; }
  seedUser('L0001', '陳大文', 'leader@troop82.hk', 'group_leader', true, '*', '', 'leader');
  seedUser('1234560001', '王小一', '', 'member', false, '', '紅隊', 'member');
  seedUser('1234560002', '李小二', '', 'member', false, '', '紅隊', 'member');
  seedUser('1234560003', '張小三', '', 'member', false, '', '藍隊', 'member');
  seedUser('1234560004', '王小明', '', 'member', false, '', '藍隊', 'member');

  // mock GAS HTTP 入口：GET → doGet(e)、POST → doPost(e)（跟 Apps Script 網應用同形）
  const mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const url = new URL(req.url, 'http://127.0.0.1');
        const e = req.method === 'GET'
          ? { parameter: Object.fromEntries(url.searchParams.entries()) }
          : { postData: { contents: raw }, parameter: Object.fromEntries(url.searchParams.entries()) };
        const out = req.method === 'GET' ? sandbox.doGet(e) : sandbox.doPost(e);
        const text = (out && typeof out.getContent === 'function') ? out.getContent() : String(out ?? '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(text);
      } catch (err) {
        console.error('[mock-gas] error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: String(err && err.message || err) }));
        }
      }
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  // 功能變數契約（同 Vercel 一樣 4 樣）——預覽環境由 devserver 代為設定
  process.env.TROOP_0082_BACKEND = `http://127.0.0.1:${mockPort}/mock`;
  process.env.TROOP_0082_APIKEY = apiKey;
  process.env.TROOP_0082_NAME = process.env.TROOP_0082_NAME || '82旅';
  if (!process.env.SUPER_KEY) process.env.SUPER_KEY = 'cubpreview2026';
  console.log(`[dev] 預覽旅團 0082 已啟用（mock 後端 127.0.0.1:${mockPort}）— 旅團列表會出現「82旅」`);
  console.log('[dev] 預覽帳號（密碼一律 1234）：admin@example.com（管理員）/ leader@troop82.hk（旅長）/ 1234560001-4（成員）');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // ---- /api/* → serverless handler ----
  if (pathname.startsWith('/api/')) {
    const name = pathname.slice(5).replace(/\/+$/, '');
    const file = path.join(ROOT, 'api', name + '.js');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: `No API route /api/${name}` }));
    }
    const raw = await readBody(req);
    const query = Object.fromEntries(url.searchParams.entries());
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
    const vReq = { method: req.method, url: req.url, headers: req.headers, query, body };
    const vRes = {
      statusCode: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(d) {
        res.writeHead(this.statusCode, { ...this._headers, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(d)); return this;
      },
      end(d) { res.writeHead(this.statusCode, this._headers); res.end(d); return this; }
    };
    try {
      delete require.cache[require.resolve(file)];          // 改咗即生效
      Object.keys(require.cache).filter(k => k.includes('/api/_lib/')).forEach(k => delete require.cache[k]);
      await require(file)(vReq, vRes);
    } catch (e) {
      console.error(`[dev] /api/${name} threw:`, e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: e.message })); }
    }
    return;
  }

  // ---- vercel.json rewrites：SPA 入口 ----
  if (pathname === '/') pathname = '/index.html';

  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 ' + pathname);
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (pathname === '/sw.js') headers['Service-Worker-Allowed'] = '/';
  headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  res.end(fs.readFileSync(file));
});

await ensurePreviewTroop();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev] CubBadge on http://0.0.0.0:${PORT}`);
  console.log(`[dev] 靜態檔 + /api/* serverless handler（同 Vercel 對齊）`);
});
