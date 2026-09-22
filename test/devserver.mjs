// test/devserver.mjs — 本機開發伺服器（唔會部署，淨係用嚟喺沙盒睇實際效果）
// 跑法：node test/devserver.mjs   (npm run dev)
// 行為同 Vercel 對齊：靜態檔直出，/api/* 交返俾對應嘅 serverless handler。
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
  '.jpg': 'image/jpeg', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev] CubBadge on http://0.0.0.0:${PORT}`);
  console.log(`[dev] 靜態檔 + /api/* serverless handler（同 Vercel 對齊）`);
});
