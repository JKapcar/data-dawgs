// One Pack Sled call with a scoped seat credential, for sessions and routines that drive the board
// from a shell. The credential is read from a file (or PACK_SLED_CREDENTIAL) and sent only as a
// Bearer header; it is never printed, logged or written anywhere.
//
//   node pack-sled-call.mjs <endpoint> <credential file|-> read  [session_ref] [work|team|alerts]
//   node pack-sled-call.mjs <endpoint> <credential file|-> write <op> <request_id> '<data json>'
//
// Prints the JSON result. A refusal prints {"error","status","detail","retry","paused"} and exits 2,
// so a caller can tell "send the same call again later" from "this was refused".
import { readFileSync, statSync } from 'node:fs';
import { sledTransport, isRetryable, isPaused } from './pack-sled-runner.mjs';

const [endpoint, file, cmd, ...rest] = process.argv.slice(2);
const out = x => process.stdout.write(JSON.stringify(x, null, 1) + '\n');
try {
  if (!endpoint || !file || !['read', 'write'].includes(cmd)) throw new Error('usage: <endpoint> <credential file|-> read|write ...');
  let credential;
  if (file === '-') credential = process.env.PACK_SLED_CREDENTIAL || '';
  else {
    if ((statSync(file).mode & 0o077) !== 0) throw new Error('credential file must not be readable by others (chmod 600)');
    credential = readFileSync(file, 'utf8').trim().replace(/^Bearer\s+/, '');
  }
  const tx = sledTransport({ endpoint, credential });
  try {
    if (cmd === 'read') {
      const [session_ref, view] = rest;
      out(await tx.call('sled_read', { ...(session_ref ? { session_ref } : {}), ...(view ? { view } : {}) }));
    } else {
      const [op, request_id, data] = rest;
      out(await tx.write(op, request_id, JSON.parse(data || '{}')));
    }
  } catch (e) {
    out({ error: e.code || 'error', status: e.status ?? null, ...(e.detail !== undefined ? { detail: e.detail } : {}), retry: isRetryable(e), paused: isPaused(e) });
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(String(e.message || e).replaceAll(/da1_[a-f0-9]{32}_[A-Za-z0-9_-]{43}/g, '[credential]') + '\n');
  process.exit(1);
}
