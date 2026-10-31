// Pack Sled rehearsal environment: the real packaged Worker in Miniflare on 127.0.0.1, with an
// in-memory database standing in for Firebase. Nothing here reaches the live site, the live
// database or any credential. Every account, session and pepper is invented for the run.
//
//   DD_NODE_MODULES=<miniflare node_modules> node pack-sled-rehearsal.mjs serve <dir> [port]
//
// Writes into <dir> (created 0700): owner.session (0600, a signed owner session for this fake
// pepper only), endpoint.txt, and db.json (the database after every write, with credential hashes
// replaced by "[hash]"). Prints the base URL. Stop it with Ctrl-C or SIGTERM.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { buildWorker } from './build-worker.mjs';
import { initialState } from './worker-core.mjs';
import { encodeEnvelope } from './exact-store.mjs';

const UID = 'u_rehearsal_owner';
export const REHEARSAL = Object.freeze({
  owner: UID,
  task: 'p_7e000001-0000-4000-8000-000000000001',
  brief: 'p_7e000002-0000-4000-8000-000000000002',
  project: 'tr-sourcing-rehearsal',
  briefText: 'Rehearsal brief v1. Goal: a sourcing map for a Total Rewards search in Dallas (Uptown and nearby). Public, read-only sources only. Name employers and public professional groups, never individuals. Contact nobody. Every claim cites a public source with when it was seen; list what is unknown instead of guessing. Deliver one PDF.',
});

export async function serve(dir, port = 8799) {
  const require = createRequire(path.join(process.env.DD_NODE_MODULES, 'resolver.cjs'));
  const { Miniflare } = require('miniflare');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const build = mkdtempSync(path.join(os.tmpdir(), 'dd-sled-rehearsal-'));
  buildWorker(build);
  const pepper = randomBytes(24).toString('base64url');
  const mac = text => createHmac('sha256', pepper).update(text).digest('base64url');
  const now = new Date().toISOString();
  const pound = {
    revision: 1, updated_at: now, agents: [], messages: [], activity: [], receipts: [],
    tasks: [{ id: REHEARSAL.task, title: 'Rehearsal: Dallas Total Rewards sourcing map', body: 'Standing recruiting task for the rehearsal. Public research only; nobody is contacted.', agent_id: '', status: 'queued', archived: false, project_id: REHEARSAL.project, created_at: now, updated_at: now, revision: 1 }],
    contexts: [{ id: REHEARSAL.brief, title: 'Rehearsal Total Rewards brief', archived: false, active_version: 1, versions: [{ version: 1, title: 'Rehearsal Total Rewards brief', text: REHEARSAL.briefText, sha256: createHash('sha256').update(REHEARSAL.briefText).digest('hex'), created_at: now }] }],
  };
  const db = new Map([
    ['/privatePounds/' + UID, { owner_uid: UID, payload: JSON.stringify(pound) }],
    ['/researchLab/v1/tenants/rehearsal', encodeEnvelope({ version: 1, access: { users: { [UID]: { owner: true, enabled: true, capabilities: ['research:read'] } } }, state: initialState(), inputs: {} })],
    ['/users', { [UID]: { name: 'Rehearsal Owner', passwordSetAt: 0 } }],
    ['/users/' + UID, { name: 'Rehearsal Owner', passwordSetAt: 0 }],
  ]);
  const versions = new Map();
  const snapshot = () => writeFileSync(path.join(dir, 'db.json'), JSON.stringify(Object.fromEntries(db), (k, v) => k === 'credentialHash' ? '[hash]' : v, 1), { mode: 0o600 });
  const mf = new Miniflare({
    modules: true, modulesRoot: build, scriptPath: path.join(build, 'worker.mjs'), compatibilityDate: '2026-07-30', r2Buckets: ['RESEARCH_UPLOADS'], host: '127.0.0.1', port,
    bindings: { RESEARCH_OWNER_UID: UID, RESEARCH_UPLOAD_TENANT: 'rehearsal', DAWG_POUND_ENABLED: 'true', ROBOKAP_ENABLED: 'true', AGENT_SETUP_ENABLED: 'true', DELEGATED_AGENTS_ENABLED: 'true', SLED_AGENTS_ENABLED: 'true', BOZO_PEPPER: pepper, FB_SECRET: 'rehearsal' },
    outboundService: async req => {
      const p = new URL(req.url).pathname.replace(/\.json$/, '');
      const v = versions.get(p) || 0;
      if (req.method === 'PUT') {
        if (!db.has(p)) return new Response('', { status: 403 });
        if (req.headers.get('if-match') !== '"' + v + '"') return new Response('', { status: 412 });
        db.set(p, await req.json()); versions.set(p, v + 1); snapshot();
        return Response.json(db.get(p));
      }
      if (req.method !== 'GET') return new Response('', { status: 405 });
      return Response.json(db.get(p) ?? null, { headers: { ETag: '"' + v + '"' } });
    },
  });
  const url = String(await mf.ready).replace(/\/$/, '');
  const payload = Buffer.from(JSON.stringify({ u: UID, n: 'Rehearsal Owner', i: Date.now(), e: Date.now() + 86400000, p: 0 })).toString('base64url');
  writeFileSync(path.join(dir, 'owner.session'), payload + '.' + mac(payload), { mode: 0o600 }); chmodSync(path.join(dir, 'owner.session'), 0o600);
  writeFileSync(path.join(dir, 'endpoint.txt'), url + '/agents/v1/owners/' + UID + '/sled/mcp\n');
  snapshot();
  const stop = async () => { await mf.dispose(); rmSync(build, { recursive: true, force: true }); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdout.write(url + '\n');
  return { mf, url, db };
}

const isMain = process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href;
if (isMain) {
  const [cmd, dir, port] = process.argv.slice(2);
  if (cmd !== 'serve' || !dir) { process.stderr.write('usage: serve <dir> [port]\n'); process.exit(1); }
  serve(path.resolve(dir), Number(port) || 8799).catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
}
