import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect, run } from '../tools/worker-inspect.mjs';

const account = 'a'.repeat(32), token = 'synthetic_TOKEN_only';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const leak = 'INJECTED_PRIVATE_VALUE_do_not_emit';
const deployment = () => ({ deployments: [{ id: other, created_on: '2026-10-19T12:00:00Z', versions: [{ version_id: id, percentage: 100 }], author_email: leak, annotations: { message: leak } }] });
const version = () => ({ id, resources: { bindings: [
  { name: 'PASSWORD', type: 'secret_text', text: leak },
  { name: 'OWNER', type: 'plain_text', text: leak },
  { name: 'DB', type: 'd1', id: leak },
  { name: 'CONFIG', type: 'json', json: { private: leak } },
], script: { source: leak } }, metadata: { author_email: leak } });
const response = result => new Response(JSON.stringify({ success: true, result, messages: [leak] }));
function fixture(results = [deployment(), version(), deployment()]) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
    assert.match(url, new RegExp(`^https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/toto/(deployments|versions/${id}|versions/${other})$`));
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : response(next);
  };
  return { account, token, fetcher, calls };
}
async function failed(options) {
  let out = '', err = '';
  assert.equal(await run(options, { write: s => out += s }, { write: s => err += s }), 1);
  assert.equal(out, '');
  assert.equal(err, 'Worker inspection failed; no metadata emitted. Check authorization or API compatibility privately.\n');
  assert.ok(!err.includes(leak) && !err.includes(token) && !err.includes(account));
}

test('only GET metadata; exact output allowlist discards injected private fields', async () => {
  const f = fixture();
  const safe = await inspect(f);
  assert.deepEqual(safe, { worker: 'toto', deployment: { created_on: '2026-10-19T12:00:00.000Z', versions: [{ version_id: id, percentage: 100 }] }, versions: [{ version_id: id, bindings: version().resources.bindings.map(({ name, type }) => ({ name, type })) }] });
  assert.equal(f.calls.length, 3);
  assert.ok(!JSON.stringify(safe).includes(leak));
});

test('split traffic inspects both active versions, ignores historical deployments', async () => {
  const d = deployment();
  d.deployments[0].versions = [{ version_id: id, percentage: 25 }, { version_id: other, percentage: 75 }];
  d.deployments.push({ versions: [{ version_id: leak }] });
  const f = fixture([d, version(), { ...version(), id: other }, d]);
  assert.equal((await inspect(f)).versions.length, 2);
  assert.equal(f.calls.length, 4);
});

test('zero traffic versions are not fetched', async () => {
  const d = deployment(); d.deployments[0].versions.push({ version_id: other, percentage: 0 });
  const f = fixture([d, version(), d]);
  assert.equal((await inspect(f)).versions.length, 1);
});

test('failed requests, parsing, redirects and API errors never leak or emit partial output', async () => {
  for (const bad of [new Error(leak + token), new Response(leak, { status: 403 }), new Response(leak, { status: 302, headers: { location: 'https://example.invalid/' } }), new Response(leak), new Response(JSON.stringify({ success: false, errors: [leak] }))]) {
    await failed(fixture([deployment(), bad]));
  }
});

test('invalid targets fail before network access', async () => {
  for (const bad of ['', '../other', leak]) {
    const f = fixture(); await failed({ ...f, account: bad }); assert.equal(f.calls.length, 0);
  }
});

test('untrusted version ids, percentages and names fail closed', async () => {
  for (const bad of ['../../settings', leak, '', id + '\n']) {
    const d = deployment(); d.deployments[0].versions[0].version_id = bad;
    const f = fixture([d]); await failed(f); assert.equal(f.calls.length, 1);
  }
  for (const percentage of [-1, 101, '100', 50]) {
    const d = deployment(); d.deployments[0].versions[0].percentage = percentage;
    await failed(fixture([d]));
  }
  for (const binding of [{ name: 'X\n::warning::' + leak, type: 'plain_text' }, { name: 'X', type: leak }]) {
    const v = version(); v.resources.bindings = [binding]; await failed(fixture([deployment(), v]));
  }
});

test('bounded response size, deployment/version/binding counts and concurrent changes fail closed', async () => {
  await failed(fixture([new Response('x'.repeat(1024 * 1024 + 1))]));
  await failed(fixture([{ deployments: Array(101).fill(deployment().deployments[0]) }]));
  const d = deployment(); d.deployments[0].versions = Array(11).fill({ version_id: id, percentage: 100 });
  await failed(fixture([d]));
  const v = version(); v.resources.bindings = Array(257).fill({ name: 'X', type: 'plain_text' });
  await failed(fixture([deployment(), v]));
  const changed = deployment(); changed.deployments[0].id = id;
  await failed(fixture([deployment(), version(), changed]));
  await failed(fixture([deployment(), { ...version(), id: other }]));
});

test('workflow remains manual, main-only, minimally permissioned, without artifacts/build/install', () => {
  const workflow = readFileSync(new URL('../.github/workflows/worker-inspect.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\n  workflow_dispatch:\n\npermissions:\n  contents: read/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.equal((workflow.match(/secrets\./g) || []).length, 2);
  assert.doesNotMatch(workflow, /pull_request:|push:|schedule:|upload-artifact|npx |npm |wrangler |deploy --|versions upload/);
  assert.equal((workflow.match(/run:/g) || []).length, 2);
});
