/* How the MCP endpoint says "no". The connector URL IS the credential; there is no OAuth
   server behind the Worker. Before this, a dead personal token (re-minted, revoked, or
   minted before the uid migration) got a 401 with a Bearer challenge, which tells Claude's
   connector client to start an OAuth flow that dies at discovery: the user sees "Failed to
   start MCP authorization" and nothing about the token. Now a credential that fails is a
   403 that names the fix; the 401 challenge remains only for a request that carried no
   credential at all. A GET with the credential in the URL, from a browser, returns a
   verdict a human can read. handleMcp is lifted out of the Worker and driven with real
   Request objects; only the token lookup and the dispatcher are stubbed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '..', 'dawg-bot-worker.js'), 'utf8');

function between(start, end) {
  const a = worker.indexOf(start);
  const b = worker.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source markers exist: ${start} … ${end}`);
  return worker.slice(a, b);
}

const dispatched = [];
const sandbox = {
  MCP_CORS: { 'Access-Control-Allow-Origin': '*' },
  SITE: 'https://datadawgs216.com',
  MCP_TOOLS: [{ catalog: 'core' }, { catalog: 'core' }, { catalog: 'full' }],
  // The only two things stubbed: who a token resolves to, and what a valid call does.
  mcpAuth: async (request, url) => {
    const seg = url.pathname.split('/').filter(Boolean);
    const cred = seg[seg.length - 1];
    if (cred === 'u_live') return { kind: 'user', name: 'Kap', uid: 'u_live' };
    if (cred === 'shared-pass') return { kind: 'shared' };
    return null;
  },
  mcpDispatch: async m => { dispatched.push(m); return { jsonrpc: '2.0', id: m.id, result: { ok: true } }; },
  Response, Request, Headers, URL, JSON, Object, Array, String, Number, Promise, Error,
  decodeURIComponent, console,
};
vm.createContext(sandbox);
vm.runInContext([
  between('const MCP_CATALOGS = [', 'async function mcpDispatch('),
  'this.handleMcp = handleMcp;',
].join('\n'), sandbox);
const handleMcp = sandbox.handleMcp;

const env = { BOZO_PEPPER: 'pepper', DAWG_PASS: 'shared-pass' };
const ORIGIN = 'https://toto.example.workers.dev';
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

async function call(pathname, opts = {}) {
  const url = new URL(ORIGIN + pathname);
  const req = new Request(url, opts);
  const res = await handleMcp(req, url, env);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

test('a dead personal token is 403 with the fix in the body — and no Bearer challenge', async () => {
  const r = await call('/mcp/u_dead', { method: 'POST', body: init, headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('WWW-Authenticate'), null, 'a challenge would make Claude start an OAuth flow that cannot succeed');
  assert.equal(r.body.error.code, -32003);
  assert.match(r.body.error.message, /credential not recognised/);
  assert.match(r.body.error.message, /connect\.html/, 'says where to mint a new one');
  assert.match(r.body.error.message, /remove this connector in Claude and add the new one/, 'says what to do in Claude');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
});

test('a wrong shared passphrase is the same 403', async () => {
  const r = await call('/mcp/wrong-pass', { method: 'POST', body: init });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('WWW-Authenticate'), null);
});

test('no credential at all keeps the 401 challenge — the one case a header could still resolve', async () => {
  const r = await call('/mcp', { method: 'POST', body: init });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('WWW-Authenticate'), 'Bearer realm="data-dawgs"');
  assert.equal(r.body.error.code, -32001);
});

test('a live token still dispatches', async () => {
  dispatched.length = 0;
  const r = await call('/mcp/u_live', { method: 'POST', body: init, headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 200);
  assert.equal(dispatched.length, 1);
  assert.equal(r.body.result.ok, true);
});

test('GET with a live credential from a browser is a verdict, uncached', async () => {
  const r = await call('/mcp/u_live', { method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.valid, true);
  assert.equal(r.body.player, 'Kap');
  assert.equal(r.body.kind, 'user');
  assert.equal(r.body.catalog, 'full');
  assert.equal(r.body.tools, 3);
  assert.match(r.body.note, /authenticates as Kap/);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('GET with a dead credential is a 403 verdict that names the fix', async () => {
  const r = await call('/mcp/u_dead', { method: 'GET', headers: { Accept: 'text/html' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.valid, false);
  assert.equal(r.body.reason, 'credential-not-recognised');
  assert.match(r.body.fix, /connect\.html/);
  assert.equal(r.headers.get('WWW-Authenticate'), null);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('GET with the shared passphrase says read-only and names nobody', async () => {
  const r = await call('/mcp/shared-pass', { method: 'GET', headers: { Accept: 'text/html' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, 'shared');
  assert.equal(r.body.player, null);
  assert.match(r.body.note, /read-only/);
});

test('the catalog segment is honoured on the GET verdict', async () => {
  const r = await call('/mcp/core/u_live', { method: 'GET', headers: { Accept: 'text/html' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.catalog, 'core');
  assert.equal(r.body.tools, 2);
});

test('an MCP client asking for an SSE stream still gets 405 — the verdict never impersonates a stream', async () => {
  const r = await call('/mcp/u_live', { method: 'GET', headers: { Accept: 'text/event-stream' } });
  assert.equal(r.status, 405);
  assert.equal(r.body.transport, 'streamable-http');
  const r2 = await call('/mcp/u_live', { method: 'GET', headers: { Accept: 'application/json, text/event-stream' } });
  assert.equal(r2.status, 405);
});

test('a bare GET /mcp is the same 405 as before, with the self-check mentioned', async () => {
  const r = await call('/mcp', { method: 'GET' });
  assert.equal(r.status, 405);
  assert.match(r.body.hint, /GET with your credential/);
});

test('the Bearer challenge exists in exactly one place in the Worker', () => {
  assert.equal(worker.split('"WWW-Authenticate"').length - 1, 1);
});
