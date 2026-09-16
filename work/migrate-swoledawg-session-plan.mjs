// Explicit remote execution only: node work/migrate-swoledawg-session-plan.mjs --remote
// Schema probes make retries safe, including a partially completed migration.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export async function migrateSessionPlan(query){
  const info=await query('PRAGMA table_info(sessions)');
  const names=new Set(info.map(r=>r.name));
  if(!names.has('day_key'))throw Error('Unexpected schema: sessions.day_key is missing.');
  const sql=readFileSync(new URL('./migrations/2026-09-16-session-plan.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
    const column=statement.match(/ADD COLUMN (\w+)/)[1];
    if(!names.has(column)){await query(statement);names.add(column);}
  }
  await query(readFileSync(new URL('./migrations/2026-09-16-session-plan-backfill.sql',import.meta.url),'utf8'));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='--remote')throw Error('Pass --remote to migrate the swoledawg D1 database.');
  await migrateSessionPlan(async sql=>{
    const result=JSON.parse(execFileSync('npx',['--no-install','wrangler','d1','execute','swoledawg','--remote','--command',sql,'--json'],{encoding:'utf8'}));
    if(result.some(r=>r.success===false))throw Error('D1 migration query failed.');
    return result.flatMap(r=>r.results||[]);
  });
  console.log('Session plan schema and backfill applied.');
}
