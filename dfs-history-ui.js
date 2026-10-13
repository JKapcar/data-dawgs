/* Private history is fetched only on explicit actions and remains in memory.
   This viewer never writes a loaded archive into the current draft or device log. */
(function(){'use strict';
const $=id=>document.getElementById(id),L=window.DDFSLedger;if(!$('hiRefresh')||!L)return;
const preview=new URLSearchParams(location.search).get('dfs_preview');
const origin=preview&&/^[a-f0-9]{8}$/.test(preview)?'https://'+preview+'-toto.jkapcar4.workers.dev':'https://toto.jkapcar4.workers.dev';
const token=()=>window.DDAuth?.token?.()||null,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number.isFinite(v)?v.toLocaleString():'unknown',money=v=>Number.isFinite(v)?'$'+v.toFixed(2):'unknown';
let account=token(),epoch=0,busy=false,abort=null,cursor=null,selected=null,rows=[],columns=[],visibleRows=25,workspaces=new Map();
const say=text=>{$('hiStatus').textContent=text;};
function buttons(){for(const id of ['hiRefresh','hiKind','hiWorkspaces'])$(id).disabled=busy;$('hiMore').disabled=busy||!cursor;$('hiArchive').disabled=busy||!workspaces.has($('hiWorkspace').value);}
function show(){const legacy=$('legacyTools');if(legacy)legacy.open=true;location.hash='history';$('historyCard').scrollIntoView({block:'start'});}
async function call(op,args){
 const auth=token(),generation=epoch;if(!auth)throw Error('Sign in on this page to use private history. Your device log is unchanged.');
 const response=await fetch(origin+'/api/dfs/'+op,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Bozo-Session':auth},body:JSON.stringify(args),signal:abort?.signal});
 let out;try{out=await response.json();}catch{throw Error('History service returned an unreadable response. Retry the same save if its outcome is uncertain.');}
 if(generation!==epoch||auth!==token())throw Error('Account changed; the previous request may have completed. List history for the current account.');
 if(!response.ok||out.error)throw Error(out.error||'Private history request failed');return out;
}
async function action(fn){
 if(busy){say('A history request is still running.');return;}
 busy=true;abort=new AbortController();const generation=epoch;buttons();
 try{await fn();}catch(e){if(generation===epoch)say(e.name==='AbortError'?'History request interrupted. Retry the same save to check its outcome.':e.message);}
 finally{if(generation===epoch){busy=false;abort=null;buttons();}}
}
function clear(){
 epoch++;abort?.abort();abort=null;busy=false;cursor=null;selected=null;rows=[];workspaces.clear();
 for(const id of ['hiList','hiTable','hiSummary','hiWorkspace'])$(id).replaceChildren();
 $('hiViewer').hidden=true;$('hiTitle').textContent='';$('hiMeta').textContent='';$('hiCaveat').textContent='';buttons();
 say(token()?'Account connected. List history to open its saved archives.':'Sign in to list private history. No history is loaded automatically.');
}
window.addEventListener('dd-auth',()=>{if(account!==token()){account=token();clear();}});
window.addEventListener('pagehide',()=>{epoch++;abort?.abort();});
function table(){
 $('hiTable').innerHTML='<thead><tr>'+columns.map(c=>'<th>'+esc(c[1])+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(0,visibleRows).map(row=>'<tr>'+columns.map(([key,,format])=>'<td>'+esc(format?format(row[key]):row[key]??'unknown')+'</td>').join('')+'</tr>').join('')+'</tbody>';
 $('hiRows').hidden=visibleRows>=rows.length;$('hiRows').textContent='Show more rows ('+Math.min(visibleRows,rows.length)+' of '+rows.length+')';
}
function render(record){
 selected=record;const {history:h,payload:p}=record;let stats=[];visibleRows=25;
 const kindLabel={account_history:'Results log',results_ledger:'Post-lock audit',workspace:'Prediction workspace'}[h.kind];
 $('hiTitle').textContent=h.title;$('hiMeta').textContent='Saved to this account '+h.saved_at+' · '+kindLabel+' · '+(h.bytes/1000).toFixed(1)+' KB. '+h.origin;
 $('hiOpenAudit').hidden=h.kind!=='results_ledger';
 if(h.kind==='account_history'){
  const s=L.historySummary(p.records);stats=[['Entries',s.entries],['Contest IDs',s.contests??'unknown'],['Cash won',money(s.won)],['Ticket face value',money(s.tickets)],['Cash net',money(s.net)],['Cash ROI',s.roi==null?'unknown':(s.roi*100).toFixed(1)+'%']];
  rows=p.records.map(r=>({...r,cash_display:r.k&&r.history_version!==2?null:r.win}));columns=[['date','Date'],['name','Contest'],['entry_id','Entry ID'],['place','Finish',number],['size','Field',number],['points','Points',number],['fee','Fee',money],['cash_display','Cash',money],['ticket_winnings','Tickets',money]];
  $('hiCaveat').textContent=s.missing_cash+(s.missing_cash===1?' entry has':' entries have')+' unknown cash winnings. '+p.legacy_archives.length+' legacy archives retained in the original JSON. Missing is not zero. These descriptive results do not grade first-place upside or establish an edge. Opening this archive leaves the device log unchanged.';
 }else if(h.kind==='results_ledger'){
  const s=L.summarize(p);stats=[['Entries',s.entries],['Actual first-place finishes',s.first_place_finishes],['Payout',money(s.payout)],['Cash ROI',s.roi==null?'unknown':(s.roi*100).toFixed(1)+'%'],['Compatible calibration rows',s.calibration.eligible]];
  rows=p.entries;columns=[['contest','Contest'],['entry_id','Entry ID'],['actual_rank','Finish',number],['field_size','Field',number],['actual_points','Points',number],['payout','Payout',money],['calibration_reason','Calibration exclusion']];
  $('hiCaveat').textContent='Stated objective: '+(p.decision_objective?.value||'unrecorded')+'. Original audit evidence is preserved. Saving this archive does not verify its prediction timing. Top-1% and top1Share are not first-place probability. Open audit details for the full saved comparison.';
 }else{
  const w=p.workspace,portfolio=w.portfolio_json?JSON.parse(w.portfolio_json):null;stats=[['Players',w.players.length],['Candidate lineups',w.lineups.length],['Workspace revision',w.revision],['Portfolio entries',portfolio?.entries?.length??'not saved']];
  rows=w.lineups.map(l=>({...l,roster:(l.ids||[]).map(i=>(i===l.cpt?'CPT ':'')+(w.players[i]?.name||'unknown')).join(' / ')}));columns=[['roster','Saved roster'],['sal','Salary',money],['proj','Projection',number]];
  $('hiCaveat').textContent='Source: '+(w.source||'unknown')+'; source time: '+(w.as_of||'unknown')+'. Prediction save: '+(w.prediction_provenance?.basis==='server-prediction-save'?w.prediction_provenance.saved_at:'unverified legacy timing')+'. This is an unchanged copy of the server workspace; its archive time is separate. Download includes inputs, settings, results, notes and portfolio evidence as saved.';
 }
 $('hiSummary').innerHTML=stats.map(([label,value])=>'<div class="s"><div class="sv">'+esc(value)+'</div><div class="sl">'+esc(label)+'</div></div>').join('');
 table();$('hiViewer').hidden=false;
}
async function list(more=false){
 const args={limit:25};if($('hiKind').value)args.kind=$('hiKind').value;if(more&&cursor)args.cursor=cursor;
 say('Reading your saved history…');const out=await call('history_list',args);if(!more)$('hiList').replaceChildren();cursor=out.next_cursor;
 for(const h of out.history){const button=document.createElement('button');button.className='btn ghost';button.type='button';button.dataset.historyId=h.id;button.textContent=h.title+' · '+h.entries+' records · saved '+h.saved_at;button.onclick=()=>action(async()=>{say('Opening saved history…');render(await call('history_get',{history_id:h.id}));say('Opened the original account archive. Current draft and device log are unchanged.');$('hiTitle').scrollIntoView({block:'start'});});$('hiList').appendChild(button);}
 say(out.total?out.total+' saved archives in this account/filter. Choose one to inspect.':'No saved archives in this account/filter. Importing or opening a file does not save history; use an explicit account-save button.');
}
$('hiRefresh').onclick=()=>action(()=>list());$('hiKind').onchange=()=>action(()=>list());$('hiMore').onclick=()=>action(()=>list(true));
$('hiRows').onclick=()=>{visibleRows+=100;table();};
$('hiWorkspace').onchange=buttons;
$('hiWorkspaces').onclick=()=>action(async()=>{say('Reading saved workspaces…');const out=await call('list',{});workspaces=new Map(out.workspaces.map(w=>[w.workspace_id,w]));$('hiWorkspace').replaceChildren(...out.workspaces.map(w=>{const option=document.createElement('option');option.value=w.workspace_id;option.textContent=w.workspace_id+' · revision '+w.revision;return option;}));say(out.workspaces.length?'Choose the exact workspace revision to archive.':'No account workspaces saved yet.');});
$('hiArchive').onclick=()=>action(async()=>{const w=workspaces.get($('hiWorkspace').value);if(!w)throw Error('List and choose a saved workspace first.');say('Archiving the selected server revision…');const out=await call('history_archive',{workspace_id:w.workspace_id,expected_revision:w.revision,title:w.workspace_id+' · revision '+w.revision});render(await call('history_get',{history_id:out.history.id}));say((out.existing?'Already archived':'Archived privately')+' at '+out.history.saved_at+'. Original workspace unchanged.');});
$('hiDownload').onclick=()=>{if(!selected)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(selected.payload,null,2)],{type:'application/json'}));a.download=selected.history.id+'-private-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('hiOpenAudit').onclick=()=>{if(selected?.history.kind==='results_ledger')window.DDFSLedgerUI.openHistory(selected.payload);};
window.DDFSHistoryUI={save:(kind,title,payload)=>{show();let copy;try{copy=JSON.parse(JSON.stringify(payload));}catch{say('Could not prepare a complete history copy. Nothing was sent.');return;}return action(async()=>{say('Saving this complete history copy to your private account…');const out=await call('history_save',{kind,title,payload:copy});render({history:out.history,payload:copy});say((out.existing?'This exact history was already saved':'Saved privately')+' at '+out.history.saved_at+'. Open Saved history on another signed-in device to retrieve it.');});}};
buttons();
})();
