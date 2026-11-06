import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {decodeBackup} from '../tools/verify-backup.mjs';
const source = readFileSync(new URL('../dawg-bot-worker.js',import.meta.url),'utf8');
const helpers = source.slice(source.indexOf('const BACKUP_VALUE_LIMIT ='),source.indexOf('async function runBackup(env, nowMs)'));
let calls=0, fail=false;
const {encode,retry}=new Function('runBackup','opsTrack',helpers+'; return {encode:encodeGeneralBackup,retry:backupIncidentRetry};')(
  async()=>{calls++;if(fail)throw Error('synthetic');return {bytes:123};},()=>{});
const small='{"taken":"synthetic","db":{}}';
assert.equal(await encode(small,'synthetic'),small);
const unicode='Ã©'.repeat(14*1024*1024);
assert.equal(JSON.parse(await encode(unicode,'synthetic')).format,'dd-backup-gzip-v1');
// Incompressible input must fail during preparation, before any KV replacement.
await assert.rejects(encode(randomBytes(27*1024*1024).toString('base64'),'synthetic'),/previous copies preserved/);
let state=null;
const kv={get:async()=>state,put:async(k,v)=>{if(k==='backup-retry:2026-11-06')state=JSON.parse(v);}};
const now=Date.parse('2026-11-06T14:00:00Z');
await retry({RL:kv},{},now); assert.equal(calls,0);
state={status:'pending',incident:'wrong'};await retry({RL:kv},{},now);assert.equal(calls,0);
state={status:'pending',incident:'kv-size-20261106'};
await retry({RL:kv},{},Date.parse('2026-11-07T00:00:00Z'));assert.equal(calls,0);
await retry({RL:kv},{},now);assert.equal(calls,1);assert.equal(state.status,'complete');
await retry({RL:kv},{},now);assert.equal(calls,1);
state={status:'pending',incident:'kv-size-20261106'};fail=true;
await assert.rejects(retry({RL:kv},{},now));assert.equal(state.status,'failed');
await retry({RL:kv},{},now);assert.equal(calls,2);
console.log('Backup format boundaries and incident retry gates passed');

const original=JSON.stringify({taken:'2026-11-06T14:00:00Z',db:{synthetic:'é'.repeat(14*1024*1024)}});
const packed=await encode(original,'2026-11-06T14:00:00Z');
assert.equal(JSON.stringify(decodeBackup(Buffer.from(packed))),original);
for(const field of ['sha256','uncompressedBytes','taken']){
 const damaged=JSON.parse(packed);damaged[field]=field==='uncompressedBytes'?1:'invalid';
 assert.throws(()=>decodeBackup(Buffer.from(JSON.stringify(damaged))));
}
assert.deepEqual(decodeBackup(Buffer.from(small.replace('synthetic','2026-11-06T14:00:00Z'))).db,{});
console.log('Readback decoder round-trip and corruption rejection passed');
