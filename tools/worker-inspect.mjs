import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['plain_text', 'secret_text', 'json', 'kv_namespace', 'd1', 'r2_bucket', 'service', 'durable_object_namespace', 'queue', 'analytics_engine', 'ai', 'assets', 'version_metadata', 'hyperdrive', 'send_email', 'browser', 'mtls_certificate', 'dispatch_namespace', 'secret_key']);
const fail = () => { throw new Error('Inspection failed; no metadata emitted.'); };
const check = (ok) => { if (!ok) fail(); };

// Only these two metadata endpoints are reachable. Never invoke Wrangler: its
// diagnostics/log files can retain raw API responses and plaintext bindings.
async function get(account, token, suffix, fetcher) {
  check(suffix === 'deployments' || /^versions\/[0-9a-f-]{36}$/i.test(suffix));
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/toto/${suffix}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) { await response.body?.cancel(); fail(); }
  check(response.body);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= 1024 * 1024);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  check(body.success === true && body.result && typeof body.result === 'object');
  return body.result;
}

function active(result) {
  check(Array.isArray(result.deployments) && result.deployments.length > 0 && result.deployments.length <= 100);
  // Cloudflare documents the first deployment as the one actively serving traffic.
  const d = result.deployments[0];
  check(UUID.test(d.id) && typeof d.created_on === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(d.created_on) && Number.isFinite(Date.parse(d.created_on)));
  check(Array.isArray(d.versions) && d.versions.length > 0 && d.versions.length <= 10);
  const versions = d.versions.map(v => {
    check(typeof v.version_id === 'string' && UUID.test(v.version_id));
    check(typeof v.percentage === 'number' && Number.isFinite(v.percentage) && v.percentage >= 0 && v.percentage <= 100);
    return { version_id: v.version_id, percentage: v.percentage };
  });
  check(new Set(versions.map(v => v.version_id.toLowerCase())).size === versions.length);
  check(Math.abs(versions.reduce((n, v) => n + v.percentage, 0) - 100) < 0.000001);
  return { id: d.id, created_on: new Date(d.created_on).toISOString(), versions };
}

export async function inspect({ account, token, fetcher = fetch }) {
  try {
    check(typeof account === 'string' && /^[0-9a-f]{32}$/i.test(account));
    check(typeof token === 'string' && /^[A-Za-z0-9_-]{10,256}$/.test(token));
    const deployment = active(await get(account, token, 'deployments', fetcher));
    const versions = [];
    for (const v of deployment.versions.filter(v => v.percentage > 0)) {
      const result = await get(account, token, `versions/${v.version_id}`, fetcher);
      check(result.id === v.version_id && Array.isArray(result.resources?.bindings) && result.resources.bindings.length <= 256);
      const bindings = result.resources.bindings.map(b => {
        check(typeof b.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(b.name) && TYPES.has(b.type));
        return { name: b.name, type: b.type };
      });
      versions.push({ version_id: v.version_id, bindings });
    }
    // Detect concurrent deployment changes. No partial result is ever emitted.
    const after = active(await get(account, token, 'deployments', fetcher));
    check(JSON.stringify(after) === JSON.stringify(deployment));
    return { worker: 'toto', deployment: { created_on: deployment.created_on, versions: deployment.versions }, versions };
  } catch { fail(); } // Never propagate HTTP bodies, URLs, credentials or exception text.
}

export async function run(options, stdout = process.stdout, stderr = process.stderr) {
  try {
    const safe = await inspect(options);
    stdout.write(JSON.stringify(safe, null, 2) + '\n');
    return 0;
  } catch {
    stderr.write('Worker inspection failed; no metadata emitted. Check authorization or API compatibility privately.\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = process.argv.length === 2
    ? await run({ account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN })
    : 1;
}
