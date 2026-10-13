/* Results ledger panel (WO-1) on the Standings sheet. Engine: dfs-ledger.js.
   Standings CSVs are parsed in this browser and never uploaded. The pre-lock snapshot is
   read from the signed-in account's saved workspace exactly as saved; nothing is re-run.
   Built ledgers are kept on this device (localStorage) and can be downloaded. */
(function(){
'use strict';
const L=window.DDFSLedger,$=id=>document.getElementById(id);if(!L||!$('lgBuild'))return;
const preview=new URLSearchParams(location.search).get('dfs_preview');
const origin=preview&&/^[a-f0-9]{8}$/.test(preview)?'https://'+preview+'-toto.jkapcar4.workers.dev':'https://toto.jkapcar4.workers.dev';
const KEY='dd-dfs-ledger-v1:';
let ledger=null,snapshot=null;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say=(msg,bad)=>{const b=$('lgWarn');b.hidden=!msg;b.textContent=msg||'';b.style.borderColor=bad?'var(--bad,#c33)':'';};
async function call(op,args){
 const token=window.DDAuth&&DDAuth.token();if(!token)throw new Error('Sign in to read your saved workspaces.');
 const r=await fetch(origin+'/api/dfs/'+op,{method:'POST',headers:{'Content-Type':'application/json','X-Bozo-Session':token},body:JSON.stringify(args)});
 let out;try{out=await r.json();}catch{throw new Error('Workspace service is unavailable.');}
 if(!r.ok||out.error)throw new Error(out.error||'Workspace request failed');return out;
}
async function list(){
 const r=await call('list',{});$('lgWs').replaceChildren(...r.workspaces.sort((a,b)=>String(b.updated_at).localeCompare(a.updated_at)).map(w=>{const o=document.createElement('option');o.value=w.workspace_id;o.textContent=w.workspace_id+' · r'+w.revision+' · '+w.lineups+' lineups · saved '+w.updated_at;return o;}));
}
async function load(id){
 const first=await call('get',{workspace_id:id,limit:500,include_results:true}),all=first.lineups.slice();
 while(all.length<first.total_lineups){const p=await call('get',{workspace_id:id,offset:all.length,limit:500});if(p.revision!==first.revision)throw new Error('Workspace changed while loading; try again.');all.push(...p.lineups);}
 return {...first,lineups:all};
}
async function contestMeta(id){
 if(!$('lgDk').checked||!/^\d{6,12}$/.test(id||''))return {contest_id:id};
 try{const r=await fetch('https://toto.jkapcar4.workers.dev/dk/contest?id='+id);const d=await r.json();if(!r.ok||d.error)throw 0;
  return {contest_id:id,name:d.name||null,start_time:d.startTime||null,entry_fee:d.entryFee||null,max_entries:d.maxEntries||null,max_entries_per_user:d.maxEntriesPerUser||null,payout:d.payout&&d.payout.length?d.payout:null};}
 catch{return {contest_id:id,meta_error:'DraftKings contest details unavailable'};}
}
function save(f,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=f;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);}
const fmt=(v,k)=>v==null?'—':typeof v==='boolean'?(v?'yes':'no'):k==='roi'?(v*100).toFixed(0)+'%':k==='pred_top1pct'||k==='pred_cash'?(v*100).toFixed(2)+'%':k==='actual_percentile'?v.toFixed(1):k==='pred_dupes_scaled'?v.toFixed(2):k==='payout'?'$'+(+v).toFixed(2):v;
function render(){
 const t=$('lgTab');if(!ledger){t.querySelector('tbody').innerHTML='';$('lgNote').textContent='No ledger built yet.';return;}
 t.querySelector('thead').innerHTML='<tr>'+L.AUDIT_COLUMNS.map(c=>'<th>'+esc(c[1])+'</th>').join('')+'<th>Join</th><th>Calibration</th></tr>';
 t.querySelector('tbody').innerHTML=ledger.entries.map(r=>'<tr>'+L.AUDIT_COLUMNS.map(([k])=>'<td>'+esc(fmt(r[k],k))+'</td>').join('')+'<td>'+esc(r.join_status)+'</td><td>'+esc(r.calibration_eligible?'Compatible inputs':r.calibration_reason||(ledger.schema===L.SCHEMA?'No compatible saved prediction':'Legacy basis unverified'))+'</td></tr>').join('');
 const s=L.summarize(ledger),sl=ledger.slate;
 const objective=ledger.decision_objective?.value||'unrecorded',currentProvenance=ledger.schema===L.SCHEMA&&sl.prediction_timestamp_basis==='server-prediction-save',verified=currentProvenance?sl.prelock_verified:null;
 $('lgNote').textContent=s.entries+' entries in '+ledger.contests.length+' contests · '+s.joined+' joined to the simulation · prediction snapshot '+(currentProvenance&&sl.prediction_saved_at||'time unverified')+
  (verified===true?' (before lock)':verified===false?' (AFTER lock)':' (pre-lock provenance unverified)')+'; workspace last saved '+sl.workspace_updated_at+
  ' · Objective: '+objective+' (stated at audit time). '+s.first_place_finishes+' observed first-place finishes; inspect ties and prize splits. '+s.calibration.eligible+' compatible calibration rows; '+s.calibration.excluded+' excluded. Cash predicted '+s.cash.predicted.toFixed(2)+' vs observed '+s.cash.observed+' (n='+s.cash.n+'); top-1% predicted '+s.top1pct.predicted.toFixed(2)+' vs observed '+s.top1pct.observed+' (n='+s.top1pct.n+'). Top-1% is not first place; top1Share is a ranking proxy, never first-place probability. One slate is not calibration.'+
  (ledger.schema!==L.SCHEMA?' Legacy ledger retained unchanged. Rebuild a new audit from original standings and archived prediction evidence; old calibration is excluded.':'');
 $('lgContext').innerHTML=ledger.contests.map(c=>'<p><b>'+esc(c.name||c.contest_id)+'</b>: field '+esc(c.field_size??'unknown')+'; paid fraction '+(c.paid_fraction==null?'unknown':(100*c.paid_fraction).toFixed(2)+'%')+'; first prize / pool '+(c.first_prize_pool_share==null?'unknown':(100*c.first_prize_pool_share).toFixed(2)+'%')+'. Equal-entry first-place reference '+(c.equal_entry_first_place_reference==null?'unknown':(100*c.equal_entry_first_place_reference).toFixed(3)+'%')+' (no-tie reference only, not your lineup or portfolio win probability).</p>').join('');
 ['lgCsv','lgCsvFull','lgJson','lgKeep'].forEach(id=>$(id).disabled=false);
}
function stored(){
 const keys=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(KEY))keys.push(k.slice(KEY.length));}}catch{}
 $('lgSaved').replaceChildren(...keys.sort().map(k=>{const o=document.createElement('option');o.value=k;o.textContent=k;return o;}));$('lgOpen').disabled=!keys.length;
}
async function build(){
 const users=$('lgUser').value.split(',').map(s=>s.trim()).filter(Boolean),files=[...$('lgFiles').files];
 if(!users.length)throw new Error('Enter your DraftKings username.');if(!files.length)throw new Error('Choose the contest-standings CSVs.');
 const id=$('lgWs').value;if(!id)throw new Error('List and choose the saved pre-lock workspace.');
 say('Reading workspace '+id+'…');snapshot=await load(id);
 const contests=[];for(const f of files){const cid=L.contestIdFromFilename(f.name);say('Parsing '+f.name+'…');contests.push({csv:await f.text(),meta:await contestMeta(cid||f.name)});}
 const starts=contests.map(c=>Date.parse(c.meta.start_time)).filter(Number.isFinite);
 // Showdown locks at the contest's start; the earliest start among the contests is the binding lock.
 const lock=$('lgLock').value?new Date($('lgLock').value).toISOString():starts.length?new Date(Math.min(...starts)).toISOString():null;
 ledger=L.buildLedger(snapshot,contests,{users,lockTime:lock,allowPostLock:$('lgPost').checked,objective:$('lgObjective').value});
 const missing=contests.filter(c=>c.meta.entry_fee==null).map(c=>c.meta.contest_id);
 say(missing.length?'No entry fee/payout for '+missing.join(', ')+': payout and ROI stay blank for those contests.':'');render();
}
$('lgList').onclick=()=>list().then(()=>say('')).catch(e=>say(e.message,true));
$('lgBuild').onclick=()=>build().catch(e=>say(e.message,true));
$('lgCsv').onclick=()=>save(ledger.slate.slate_id+'-audit.csv',L.auditCSV(ledger,false),'text/csv');
$('lgCsvFull').onclick=()=>save(ledger.slate.slate_id+'-audit-full.csv',L.auditCSV(ledger,true),'text/csv');
$('lgJson').onclick=()=>save(ledger.slate.slate_id+'-ledger.json',JSON.stringify(ledger,null,1),'application/json');
$('lgKeep').onclick=()=>{try{const key=KEY+ledger.slate.slate_id;if(localStorage.getItem(key)&&localStorage.getItem(key)!==JSON.stringify(ledger))throw Error('A ledger already exists for this slate. Export the new JSON; the original archive was retained.');localStorage.setItem(key,JSON.stringify(ledger));stored();say('Kept on this device as '+ledger.slate.slate_id+'.');}catch(e){say('Not saved: '+e.message+' Download the JSON to retain the new audit.',true);}};
$('lgOpen').onclick=()=>{try{ledger=JSON.parse(localStorage.getItem(KEY+$('lgSaved').value));render();say('');}catch{say('Could not read that saved ledger.',true);}};
stored();render();
})();
