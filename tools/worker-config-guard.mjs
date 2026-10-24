import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const check = ok => { if (!ok) throw new Error('Worker configuration guard refused; inspect configuration privately.'); };
const stable = x => JSON.stringify(x, (_, v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = x => createHash('sha256').update(stable(x)).digest('hex');

// One-time owner-approved restoration, bound to the exact regressed version.
// Future configuration changes require a reviewed migration, never a broad bypass.
const REPAIR_FROM = 'c531aa77-fae9-4f43-8bd6-dd052537dc50';
const repaired = Object.fromEntries(['ROBOKAP_ENABLED', 'DISCORD_MENTIONS_ENABLED', 'DISCORD_GROK_WAKE_ENABLED', 'DISCORD_GROK_INCLUDED_USAGE_CONFIRMED', 'DISCORD_PACK_ENABLED', 'DISCORD_RETRIEVAL_ENABLED', 'DISCORD_DFS_SHARE_ENABLED', 'DISCORD_PACK_DELIVERY_ENABLED'].map(name => [name, ['false', 'true']]));
repaired.DISCORD_PACK_SEATS = ['{}', '{"grok":{"key_label":"pack-grok"}}'];
const bindingHash = (name, text) => hash({ name, type: 'plain_text', text });

export function fingerprint(version) {
  check(UUID.test(version?.id) && Array.isArray(version.resources?.bindings));
  const bindings = {};
  for (const b of version.resources.bindings) {
    check(typeof b.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(b.name) && typeof b.type === 'string' && !Object.hasOwn(bindings, b.name));
    bindings[b.name] = hash(b);
  }
  check(version.resources.script_runtime && Array.isArray(version.resources.script?.handlers));
  return { version_id: version.id, bindings, runtime: hash(version.resources.script_runtime), handlers: hash({ handlers: version.resources.script.handlers, named_handlers: version.resources.script.named_handlers ?? [] }) };
}

export function compare(before, after) {
  check(before.runtime === after.runtime && before.handlers === after.handlers);
  const names = new Set([...Object.keys(before.bindings), ...Object.keys(after.bindings)]);
  const changes = [];
  for (const name of names) {
    if (before.bindings[name] === after.bindings[name]) continue;
    const pair = repaired[name];
    check(before.version_id === REPAIR_FROM && pair && before.bindings[name] === bindingHash(name, pair[0]) && after.bindings[name] === bindingHash(name, pair[1]));
    changes.push(name);
  }
  // The approved restoration must be atomic: never restore only some seats/flags.
  if (changes.length) check(changes.length === Object.keys(repaired).length);
  return changes.sort();
}

async function get(options, suffix) {
  check(/^[a-f0-9]{32}$/i.test(options.account) && typeof options.token === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(options.token));
  check(suffix === 'deployments' || /^versions\/[a-f0-9-]{36}$/i.test(suffix));
  const r = await (options.fetcher ?? fetch)(`https://api.cloudflare.com/client/v4/accounts/${options.account}/workers/scripts/toto/${suffix}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${options.token}` } });
  check(r.ok && r.body);
  const reader = r.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= 1024 * 1024); chunks.push(value); } } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(chunks).toString());
  check(data.success === true && data.result);
  return data.result;
}

async function active(options) {
  const result = await get(options, 'deployments');
  const d = result.deployments?.[0];
  check(UUID.test(d?.id) && d.versions?.length === 1 && UUID.test(d.versions[0].version_id) && d.versions[0].percentage === 100);
  return { deployment_id: d.id, version_id: d.versions[0].version_id };
}
async function version(options, id) {
  check(UUID.test(id));
  const v = await get(options, `versions/${id}`);
  check(v.id === id);
  return fingerprint(v);
}

export async function snapshot(options) {
  const current = await active(options), before = await version(options, current.version_id);
  check(stable(current) === stable(await active(options)));
  return { ...current, ...before };
}

export async function verify(options, before, candidateId) {
  const current = await snapshot(options);
  check(stable(current) === stable(before)); // Concurrent deploy or binding change: stop.
  const candidate = await version(options, candidateId);
  const changes = compare(before, candidate);
  check(stable(await active(options)) === stable({ deployment_id: before.deployment_id, version_id: before.version_id }));
  return { baseline_version: before.version_id, candidate_version: candidateId, changed_bindings: changes, preserved_runtime: true };
}

export function preflight(before, manifest) {
  check(manifest.name === 'toto' && manifest.keep_vars === true);
  const proposed = structuredClone(before);
  for (const [name, value] of Object.entries(manifest.vars ?? {})) proposed.bindings[name] = bindingHash(name, value);
  return compare(before, proposed);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN };
    const [mode, file, candidate] = process.argv.slice(2);
    if (mode === 'snapshot' && file && !candidate) {
      const state = await snapshot(options);
      preflight(state, JSON.parse(readFileSync('wrangler.jsonc', 'utf8')));
      writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
      console.log(JSON.stringify({ baseline_version: state.version_id, preflight: 'passed' }));
    } else {
      check(mode === 'verify' && file && candidate);
      console.log(JSON.stringify(await verify(options, JSON.parse(readFileSync(file, 'utf8')), candidate)));
    }
  } catch { console.error('Worker configuration guard refused; no private configuration emitted.'); process.exitCode = 1; }
}
