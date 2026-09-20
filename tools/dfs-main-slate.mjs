#!/usr/bin/env node
// Prepare a private player upload. Never commit the generated JSON or paid CSV.
// node tools/dfs-main-slate.mjs input.csv /private/path/players.json
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), ingest=require('../work/dfs-slate-ingest.js');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node tools/dfs-main-slate.mjs INPUT.csv PRIVATE_OUTPUT.json');
const csv=fs.readFileSync(input,'utf8'),parsed=ingest.readSalaries(csv,{combined:true});
if(parsed.error)throw Error(parsed.error);
const merged=ingest.applyProjections(csv,parsed.players,null,{ownTier:'large'});
if(merged.error)throw Error(merged.error);
const players=parsed.players.filter(p=>p.proj>=6).map(p=>({id:p.dkId,dkId:p.dkId,name:p.name,pos:p.pos,team:p.team,opp:p.opp,gid:[p.team,p.opp].sort().join('@'),sal:p.sal,proj:p.proj,ceil:p.ceil,own:p.own}));
if(!players.length||players.length>220)throw Error('Filtered pool must contain 1–220 players.');
for(const p of players)if(!/^\d+$/.test(p.id)||!p.opp||![p.sal,p.proj,p.ceil,p.own].every(Number.isFinite))throw Error('Missing input for '+p.name);
if(new Set(players.map(p=>p.id)).size!==players.length)throw Error('Duplicate player ID.');
fs.writeFileSync(output,JSON.stringify(players,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({players:players.length,missing_projections:players.filter(p=>p.proj==null).map(p=>p.id),source:input}));
