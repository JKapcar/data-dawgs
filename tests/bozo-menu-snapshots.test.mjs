import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectSnapshots,refreshSnapshots,snapshotFiles} from '../tools/bozo-menu-snapshots.mjs';
const at='2026-10-30T16:00:00.000Z';
const weeks=[{week:'2026-10-26',revision:4,published_at:'2026-10-29T14:50:00.000Z'},{week:'2026-10-19',revision:2,published_at:'2026-10-20T14:00:00.000Z'}];
const menu=(w=weeks[0])=>({...w,title:'Public menu <not executable>',retrieved_at:at,status:'published',scope:'Saved research, not live odds.',published_weeks:weeks,candidates:['keep','hold','scratch'].map((status,i)=>({id:'c'+i,selection:'Pick <'+i+'>',status,sport:'nfl',event:'A at B',market:'spread',reason:'check <script>alert(1)</script>',quote_state:'Saved',sources:[]}))});
const fetcher=async u=>Response.json(menu(weeks.find(w=>u.includes(w.week))||weeks[0]));
test('all formats and archive retain full public data, revision and truthful age notice without JS',async()=>{
 const {files}=await collectSnapshots({fetchImpl:fetcher,now:()=>at});
 for(const base of ['bozo-menu','bozo-menu/2026-10-26','bozo-menu/2026-10-19']){
  const json=JSON.parse(files.get(base+'.json')),html=files.get(base+'.html'),txt=files.get(base+'.txt');
  assert.equal(json.candidates.length,3);assert.deepEqual(json.candidates,menu().candidates);
  assert.equal((html.match(/<article>/g)||[]).length,3);assert.equal((txt.match(/^## /gm)||[]).length,3);
  assert.ok(html.includes('revision '+json.revision));assert.ok(txt.includes('revision '+json.revision));
  assert.match(html,/Static copy checked 2026-10-30/);assert.match(txt,/not live odds/);assert.match(html,/delays or failures/i);
  assert.ok(!html.includes('<script>alert'));assert.ok(!html.includes('Loading the published menu'));
  assert.ok(html.includes('href="/bozo-menu.txt"')||html.includes('href="/bozo-menu/2026-10-'));
  assert.ok(!html.includes('href="/bozo/menu'));assert.equal(json.snapshot.checked_at,at);
 }
});
test('source failure or concurrent publication does not replace good snapshots',async()=>{
 const root=mkdtempSync(join(tmpdir(),'bozo-snapshot-'));
 try{
  writeFileSync(join(root,'bozo-menu.html'),'previous complete snapshot');writeFileSync(join(root,'sitemap.xml'),'<urlset></urlset>');
  await assert.rejects(refreshSnapshots(root,{fetchImpl:async()=>new Response('unavailable',{status:503})}));
  let n=0;await assert.rejects(refreshSnapshots(root,{fetchImpl:async u=>{n++;return Response.json(n===3?{...menu(),revision:5}:menu(weeks.find(w=>u.includes(w.week))||weeks[0]));},now:()=>at}),/changed/);
  assert.equal(readFileSync(join(root,'bozo-menu.html'),'utf8'),'previous complete snapshot');assert.equal(readdirSync(root).length,2);
 }finally{rmSync(root,{recursive:true});}
});
test('sitemap links each archive once across repeated refreshes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'bozo-snapshot-'));
 try{writeFileSync(join(root,'sitemap.xml'),'<urlset><url><loc>https://datadawgs216.com/bozo.html</loc></url></urlset>');
  for(let i=0;i<2;i++)await refreshSnapshots(root,{fetchImpl:fetcher,now:()=>at});
  const xml=readFileSync(join(root,'sitemap.xml'),'utf8');assert.equal((xml.match(/bozo-menu\.html/g)||[]).length,1);assert.equal((xml.match(/bozo-menu\/2026-10-19\.html/g)||[]).length,1);assert.ok(xml.includes('/bozo.html'));
 }finally{rmSync(root,{recursive:true});}
});
