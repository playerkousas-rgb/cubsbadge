import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createGuard = require('../assets/frontend-freshness.js');
const manifest = require('../data/frontend-release.json');
const versionHandler = require('../api/frontend-version.js');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = require('../vercel.json');
const nextBuild = '2026.10.25.2';

function setup({ current = manifest.build, latest = current, url = 'https://cubsbadge.vercel.app/', store = new Map() } = {}) {
  const events = new Map(), documentEvents = new Map();
  const redirects = [], requests = [], messages = [];
  let safe = true;
  const business = new Map([
    ['cubbadge_session', '{"token":"LOCAL_ONLY"}'],
    ['cubbadge_pending_0082', '[{"itemId":"OLD-01","date":"2025-01-01"}]']
  ]);
  const env = {
    location: { href: url, replace(value) { redirects.push(value); } },
    document: {
      documentElement: { lang: 'zh-Hant' }, visibilityState: 'visible',
      querySelector: selector => selector === 'meta[name="cubsbadge-build"]' ? { getAttribute: () => current } : null,
      addEventListener: (name, fn) => documentEvents.set(name, fn),
      removeEventListener: name => documentEvents.delete(name)
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ app: 'cubsbadge', build: latest }) };
    },
    sessionStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    localStorage: { getItem: key => business.get(key) || null, setItem() { throw new Error('must not write business storage'); }, clear() { throw new Error('must not clear business storage'); } },
    canReloadFrontend: () => safe,
    showToast: value => messages.push(value),
    setTimeout, clearTimeout, AbortController,
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name)
  };
  return { env, events, documentEvents, redirects, requests, messages, store, business,
    setSafe: value => { safe = value; }, guard: createGuard(env) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('HTML, owned script URLs and public version endpoint agree on one frontend build', () => {
  assert.equal(manifest.app, 'cubsbadge');
  assert.match(html, new RegExp(`<meta name="cubsbadge-build" content="${manifest.build.replaceAll('.', '\\.')}"`));
  for (const filename of ['frontend-freshness.js', 'cub-progress.js', 'form-generator.js', 'ymis-parse.js']) {
    assert.ok(html.includes(`src="assets/${filename}?build=${manifest.build}"`), `${filename} must have a new cache key for this build`);
  }
  const headers = {}, res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  versionHandler({ method: 'GET', query: { troopId: '0082', apikey: 'DO_NOT_ECHO' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { app: manifest.app, build: manifest.build });
  assert.match(headers['Cache-Control'], /no-store/);
  assert.equal(headers['CDN-Cache-Control'], 'no-store');
  assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(res.body), /0082|DO_NOT_ECHO|apikey|backend|token/i);
});

test('both HTML entry paths are no-store at the browser and edge; unversioned assets cannot serve stale-while-revalidate', () => {
  for (const source of ['/', '/index.html']) {
    const rule = config.headers.find(rule => rule.source === source);
    assert.ok(rule, source);
    const headers = Object.fromEntries(rule.headers.map(header => [header.key, header.value]));
    assert.match(headers['Cache-Control'], /no-store/);
    assert.match(headers['Cache-Control'], /max-age=0/);
    assert.equal(headers['CDN-Cache-Control'], 'no-store');
    assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store');
    assert.equal(headers['Clear-Site-Data'], undefined, 'do not clear any origin storage/caches');
  }
  const assets = config.headers.find(rule => rule.source === '/assets/(.*)');
  const policy = assets.headers.find(header => header.key === 'Cache-Control').value;
  assert.match(policy, /max-age=0/);
  assert.match(policy, /must-revalidate/);
  assert.doesNotMatch(policy, /stale-while-revalidate/);
});

test('matching build performs an uncached same-origin check without reload', async () => {
  const { guard, requests, redirects } = setup();
  guard.start();
  await guard.check();
  assert.equal(requests.length, 1, 'startup and concurrent callers share the same check');
  assert.match(requests[0].url, /^\/api\/frontend-version\?_=/);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.deepEqual(redirects, []);
});

test('outdated shell automatically replaces its URL once, retaining portal parameters and fragment', async () => {
  const { guard, redirects, store, business } = setup({ latest: nextBuild,
    url: 'https://cubsbadge.vercel.app/?u=0082&from=portal&embed=1#progress' });
  const before = [...business];
  assert.equal(await guard.check(), true);
  assert.equal(redirects.length, 1);
  const url = new URL(redirects[0]);
  assert.equal(url.origin, 'https://cubsbadge.vercel.app');
  assert.equal(url.searchParams.get('_frontend'), nextBuild);
  assert.equal(url.searchParams.get('u'), '0082');
  assert.equal(url.searchParams.get('from'), 'portal');
  assert.equal(url.searchParams.get('embed'), '1');
  assert.equal(url.hash, '#progress');
  assert.deepEqual([...business], before, 'session, pending records and caches stay untouched');
  assert.equal(store.size, 1, 'only a namespaced loop-prevention marker is added');
  assert.equal(await guard.check(), false);
  assert.equal(redirects.length, 1);
});

test('reload marker survives a second document and prevents a loop if the origin still returns the old shell', async () => {
  const first = setup({ latest: nextBuild });
  await first.guard.check();
  const retry = setup({ latest: nextBuild, url: first.redirects[0], store: first.store });
  assert.equal(await retry.guard.check(), false);
  assert.deepEqual(retry.redirects, []);
  const bookmark = setup({ latest: nextBuild, store: first.store });
  assert.equal(await bookmark.guard.check(), false, 'one auto-reload per target build per browser tab session');
});

test('URL loop prevention still works when browser sessionStorage is blocked', async () => {
  const first = setup({ latest: nextBuild });
  first.env.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(await first.guard.check(), true);
  const retry = setup({ latest: nextBuild, url: first.redirects[0] });
  retry.env.sessionStorage = first.env.sessionStorage;
  assert.equal(await retry.guard.check(), false);
  assert.deepEqual(retry.redirects, []);
});

test('editing/pending writes defer reload, preserve data, and recheck when the user returns', async () => {
  const state = setup({ latest: nextBuild });
  const before = [...state.business];
  state.setSafe(false);
  state.guard.start();
  assert.equal(await state.guard.check(), false);
  assert.equal(state.guard.getPendingBuild(), nextBuild);
  assert.equal(state.store.size, 0, 'a deferred reload does not consume the loop-prevention attempt');
  assert.equal(state.redirects.length, 0);
  assert.match(state.messages[0], /先儲存/);
  state.setSafe(true);
  state.documentEvents.get('visibilitychange')();
  await flush();
  assert.equal(state.redirects.length, 1);
  assert.deepEqual([...state.business], before);
});

test('restoring a bfcache snapshot checks its build without reloading when unchanged', async () => {
  const state = setup();
  state.guard.start();
  await state.guard.check();
  state.events.get('pageshow')({ persisted: false });
  await flush();
  assert.equal(state.requests.length, 1);
  state.events.get('pageshow')({ persisted: true });
  await flush();
  assert.equal(state.requests.length, 2);
  assert.deepEqual(state.redirects, []);
});

test('offline, malformed, unsuccessful, foreign and invalid version responses never force a reload', async () => {
  for (const fetch of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error('not json'); } }),
    async () => ({ ok: true, json: async () => ({ app: 'other-app', build: nextBuild }) }),
    async () => ({ ok: true, json: async () => ({ app: 'cubsbadge', build: 'https://evil.example/' }) })
  ]) {
    const state = setup();
    state.env.fetch = fetch;
    assert.equal(await state.guard.check(), false);
    assert.deepEqual(state.redirects, []);
  }
});

test('a stalled version endpoint times out without blocking or refreshing the app', async () => {
  const state = setup();
  state.env.fetch = () => new Promise(() => {});
  state.env.setTimeout = fn => setTimeout(fn, 1);
  assert.equal(await state.guard.check(), false);
  assert.deepEqual(state.redirects, []);
});

test('concurrent checks use one network request; stopping the guard prevents a late reload', async () => {
  const state = setup({ latest: nextBuild });
  let resolve;
  state.env.fetch = () => { state.requests.push({}); return new Promise(done => { resolve = done; }); };
  const first = state.guard.check(), second = state.guard.check();
  assert.equal(first, second);
  await flush();
  assert.equal(state.requests.length, 1);
  state.guard.stop();
  resolve({ ok: true, json: async () => ({ app: 'cubsbadge', build: nextBuild }) });
  assert.equal(await first, false);
  assert.deepEqual(state.redirects, []);
});

test('missing frontend marker does not invent a version or launch requests', async () => {
  const state = setup({ current: '' });
  state.guard.start();
  assert.equal(await state.guard.check(), false);
  assert.equal(state.requests.length, 0);
});

test('version endpoint accepts HEAD and rejects writes without touching the backend', () => {
  for (const method of ['HEAD', 'POST']) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, end() { this.ended = true; }, json(value) { this.body = value; } };
    versionHandler({ method }, res);
    assert.equal(res.statusCode, method === 'HEAD' ? 200 : 405);
    if (method === 'HEAD') assert.equal(res.body, undefined);
    else assert.equal(res.headers.Allow, 'GET, HEAD');
  }
});
