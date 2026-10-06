#!/usr/bin/env node
// Build a DFS results ledger from DraftKings contest-standings CSVs and the saved
// pre-lock workspace snapshot. Output is private: write it under private/ (gitignored),
// never into data/ — the snapshot holds paid projections and the standings are DK's.
//
// node tools/dfs-ledger.mjs --snapshot ws.json --user NAME --lock 2026-10-06T00:15:00Z \
//   [--contests meta.json] [--out private/dfs-ledger/SLATE] [--allow-postlock] contest-standings-*.csv
//
// ws.json   dd_dfs_get output with include_results=true (all lineups: limit ≥ total_lineups).
// meta.json {"<contest_id>": {name, start_time, entry_fee, payout:[{from,to,prize}], max_entries,
//           max_entries_per_user, type}} or an array of those objects with contest_id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const L=createRequire(import.meta.url)('../dfs-ledger.js');

const argv=process.argv.slice(2),opt={users:[],files:[]};
for(let i=0;i<argv.length;i++){const a=argv[i],v=()=>argv[++i];
 if(a==='--snapshot')opt.snapshot=v();else if(a==='--user')opt.users.push(v());else if(a==='--lock')opt.lock=v();
 else if(a==='--contests')opt.contests=v();else if(a==='--out')opt.out=v();else if(a==='--slate')opt.slate=v();
 else if(a==='--allow-postlock')opt.allowPostLock=true;else if(a==='--built-at')opt.builtAt=v();
 else if(a.startsWith('--'))throw Error('Unknown flag '+a);else opt.files.push(a);}
if(!opt.snapshot||!opt.users.length||!opt.files.length)throw Error('Usage: node tools/dfs-ledger.mjs --snapshot ws.json --user NAME [--lock ISO] [--contests meta.json] [--out DIR] standings.csv ...');

const raw=fs.readFileSync(opt.snapshot,'utf8');
const ws=JSON.parse(raw.slice(raw.indexOf('{')));
if(ws.total_lineups!=null&&ws.lineups.length<ws.total_lineups)throw Error('Snapshot is paginated ('+ws.lineups.length+'/'+ws.total_lineups+' lineups); re-read with a larger limit.');
let metas={};
if(opt.contests){const m=JSON.parse(fs.readFileSync(opt.contests,'utf8'));metas=Array.isArray(m)?Object.fromEntries(m.map(x=>[String(x.contest_id),x])):m;}
const contests=opt.files.map(f=>{const id=L.contestIdFromFilename(path.basename(f));const meta={...(metas[id]||{}),contest_id:id||path.basename(f)};
 if(!metas[id])console.warn('No metadata for contest '+meta.contest_id+': entry fee, payout and ROI stay null.');
 return {csv:fs.readFileSync(f,'utf8'),meta};});
const starts=contests.map(c=>Date.parse(c.meta.start_time)).filter(Number.isFinite);
const lock=opt.lock||(starts.length?new Date(Math.min(...starts)).toISOString():null);
if(!lock)console.warn('No --lock and no start_time in contest metadata: pre-lock status stays unverified (null).');
const ledger=L.buildLedger(ws,contests,{users:opt.users,lockTime:lock,allowPostLock:opt.allowPostLock,slateId:opt.slate,builtAt:opt.builtAt,
 snapshotSha256:crypto.createHash('sha256').update(raw).digest('hex')});
const out=opt.out||path.join('private','dfs-ledger',ledger.slate.slate_id);
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,1)+'\n',{mode:0o600});
fs.writeFileSync(path.join(out,'audit.csv'),L.auditCSV(ledger,false),{mode:0o600});
fs.writeFileSync(path.join(out,'audit-full.csv'),L.auditCSV(ledger,true),{mode:0o600});
console.log(JSON.stringify({out,contests:ledger.contests.map(c=>({id:c.contest_id,field:c.field_size,ours:c.our_entries,tier:c.tier})),summary:ledger.summary},null,1));
