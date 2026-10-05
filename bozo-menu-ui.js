import {quoteState} from './bozo-menu.mjs';
export function mountBozoMenu({getSession,worker}) {
 const root=document.getElementById('bozoMenu');
 const $=id=>root.querySelector('#'+id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const et=s=>s?new Date(s).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'Not supplied';
 const monday=()=>{const day=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'})+'T12:00:00Z');day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
 let session=null,week=null,seq=0,weeks=[],busy=false;
 root.innerHTML=`<div class="bz-hdr"><div><span class="bm-eyebrow">DATA DAWGS · RESEARCH LIBRARY</span><h2 class="bz">The Bozo Menu</h2></div><span class="bm-pill">−200 to −500</span></div>
 <p class="note">Find an edge. Check the news. Shop the alternate line. Your private weekly candidates live here; saving a menu never submits a pick.</p>
 <p id="bmMessage" role="status" aria-live="polite"></p>
 <div id="bmControls" hidden><div class="bm-toolbar"><label>Weekly library<select id="bmWeeks" aria-label="Saved menu week"></select></label><label>Week beginning (Monday)<input type="date" id="bmDate"></label><button type="button" class="btn ghost sm" id="bmOpen">Open week</button><button type="button" class="btn ghost sm" id="bmReload">Refresh</button></div>
 <div class="bm-toolbar"><label>Screening<select id="bmFilter"><option value="all">All candidates</option><option>keep</option><option>downgrade</option><option>hold</option><option>scratch</option></select></label><button type="button" class="btn ghost sm" id="bmExport">Download menu</button><span id="bmUpdated" class="note"></span></div>
 <div id="bmRows" class="bm-grid"></div>
 <details id="bmImport" data-ddb-skip><summary>Add or update candidates</summary><p class="note">Ask your Data Dawgs connector to “save these candidates to The Bozo Menu.” You can also paste or upload its candidate JSON here. Matching IDs update existing rows; other rows stay saved.</p>
 <label for="bmJson">Candidate array or menu object</label><textarea id="bmJson" rows="7" spellcheck="false" placeholder='[{"id":"stable-candidate-id", …}]'></textarea>
 <label>Import JSON file <input type="file" id="bmFile" accept=".json,application/json"></label><div class="bm-toolbar"><button type="button" class="btn ghost sm" id="bmPreview">Preview import</button><button type="button" class="btn ghost sm" id="bmTemplate">Download template</button><button type="button" class="btn" id="bmSave" disabled>Save to this week</button></div><p id="bmImportNote" role="status"></p><div id="bmPreviewRows"></div></details></div>`;
 function message(s){$('bmMessage').textContent=s;}
 async function api(op,args={}) {
  const active=getSession();if(!active)throw Error('Sign in to open your private menu.');
  const save=op==='save';const response=await fetch(worker+'/api/bozo-menu/'+op+(!save&&args.week?'?week='+encodeURIComponent(args.week):''),{method:save?'POST':'GET',headers:{'X-Bozo-Session':active.session,...(save?{'Content-Type':'application/json'}:{})},...(save?{body:JSON.stringify(args)}:{}),cache:'no-store'});
  const data=await response.json().catch(()=>({error:'Menu service unavailable. Refresh after the service is deployed.'}));
  if(!response.ok)throw Error(data.error||'Menu request failed');return data;
 }
 function quote(q){return q?`${q.line==null?'Moneyline':esc(q.line)} · ${q.odds>0?'+':''}${esc(q.odds)} · ${esc(q.book)}<small>Quoted ${esc(et(q.quoted_at))}</small>`:'Awaiting a verified quote';}
 function edge(e){return e?`${esc(e.value)} ${esc(e.unit.replaceAll('_',' '))}<small>${esc(e.definition)}</small>`:'Not supplied';}
 function draw(){
  if(!week)return;
  $('bmDate').value=week.week;$('bmUpdated').textContent=week.revision?`Saved ${et(week.updated_at)} · revision ${week.revision}`:'New menu';
  const options=new Map(weeks.map(w=>[w.week,w.title]));options.set(week.week,week.title);
  $('bmWeeks').innerHTML=[...options].sort((a,b)=>b[0].localeCompare(a[0])).map(([key,title])=>`<option value="${esc(key)}" ${key===week.week?'selected':''}>${esc(title)} · ${esc(key)}</option>`).join('');
  const rows=week.candidates.filter(c=>$('bmFilter').value==='all'||c.status===$('bmFilter').value);
  $('bmRows').innerHTML=rows.length?rows.map(c=>`<article class="bm-candidate bm-${esc(c.status)}"><div class="bm-top"><span class="bm-eyebrow">${c.rank?'#'+esc(c.rank)+' · ':''}${esc(c.sport)}</span><span class="bm-status">${esc(c.status)}</span></div><h3>${esc(c.selection)}</h3><p class="bm-event">${esc(c.event)} · ${esc(c.market)}<br>${esc(et(c.kickoff))}</p><dl><div><dt>Base bet</dt><dd>${quote(c.base)}</dd></div><div><dt>Raw model edge</dt><dd>${edge(c.edge)}</dd></div>${c.adjusted_edge?`<div><dt>Adjusted edge · judgment</dt><dd>${edge(c.adjusted_edge)}</dd></div>`:''}<div class="bm-alt"><dt>Alternate line</dt><dd>${quote(c.alternate)}</dd></div></dl><p class="bm-price-state">${esc(quoteState(c))}</p><p>${esc(c.reason)}</p><p class="note">Screened ${esc(et(c.screened_at))}</p>${c.probability?`<p>Estimated hit rate: ${(c.probability.value*100).toFixed(1)}%<small>${esc(c.probability.basis)}</small></p>`:''}${c.worst_acceptable?`<p class="note">Limit: ${esc(c.worst_acceptable)}</p>`:''}<details><summary>Evidence & notes</summary>${(c.sources||[]).map(s=>`<p><b>${esc(s.name)}</b>${s.weight!=null?' · '+Math.round(s.weight*100)+'% weight':''}<small>${esc(et(s.as_of))}</small>${esc(s.evidence)}</p>`).join('')||'<p>No sources supplied.</p>'}<p>${esc(c.notes||'')}</p><p>Result: ${esc(c.result||'pending')}</p></details><button type="button" class="btn ghost sm" data-bm-edit="${esc(c.id)}">Update candidate</button></article>`).join(''):`<div class="bm-empty"><h3>${week.candidates.length?'No matching candidates':'This week’s menu is open'}</h3><p>${week.candidates.length?'Choose another screening status.':'Send a candidate list through your Data Dawgs connector, or add one below. Hold and scratched candidates stay in the record.'}</p></div>`;
 }
 function clean(c){const {updated_at,quote_state,...row}=c;return row;}
 let pending=null;
 function resetImport(){pending=null;$('bmSave').disabled=true;$('bmPreviewRows').innerHTML='';$('bmImportNote').textContent='';}
 async function open(date){
  const ticket=++seq;week=null;resetImport();$('bmJson').value='';$('bmRows').innerHTML='';$('bmExport').disabled=true;message('Loading your menu…');
  try{const [list,menu]=await Promise.all([api('list'),api('get',{week:date})]);if(ticket!==seq)return;weeks=list.weeks;week=menu;draw();$('bmExport').disabled=false;message(`${menu.candidates.length} candidates · private to your account. Quotes are saved snapshots; recheck before using.`);}catch(e){if(ticket===seq)message(e.message);}
 }
 function sync(){const next=getSession()?.session||null;if(next===session)return;session=next;seq++;week=null;weeks=[];resetImport();$('bmJson').value='';$('bmRows').innerHTML='';$('bmControls').hidden=!next;if(next)open(monday());else message('Sign in to open your private weekly menu.');}
 function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('bmOpen').onclick=()=>open($('bmDate').value);$('bmReload').onclick=()=>open(week?.week||$('bmDate').value||monday());$('bmWeeks').onchange=()=>open($('bmWeeks').value);$('bmFilter').onchange=draw;
 $('bmExport').onclick=()=>week&&download({...week,candidates:week.candidates.map(clean)},'bozo-menu-'+week.week+'.json');
 $('bmJson').oninput=resetImport;
 $('bmFile').onchange=async()=>{const f=$('bmFile').files[0];if(!f)return;resetImport();if(f.size>250000){$('bmImportNote').textContent='Choose a JSON file under 250 KB.';return;}$('bmJson').value=await f.text();};
 $('bmTemplate').onclick=()=>download({week:week?.week||monday(),title:'My weekly menu',candidates:[{id:'example-replace-me',event:'Away team at Home team',sport:'cfb',market:'spread',selection:'Team +7',status:'hold',reason:'Example only: replace with your research; verify kickoff, injuries and prices.',sources:[]}]},'bozo-menu-template.json');
 $('bmPreview').onclick=()=>{
  resetImport();try{if(!week)throw Error('Open a week first.');const input=JSON.parse($('bmJson').value);if(input.week&&input.week!==week.week)throw Error('This file belongs to '+input.week+'. Open that week first.');const rows=Array.isArray(input)?input:input.candidates;if(!Array.isArray(rows)||!rows.length||rows.length>200)throw Error('Supply 1–200 candidates.');pending={week:week.week,expected_revision:week.revision,...(input.title?{title:input.title}:{}),candidates:rows.map(clean)};$('bmPreviewRows').innerHTML=rows.map(c=>`<p><b>${esc(c.selection)}</b> · ${esc(c.status)} · ${esc(c.event)}</p>`).join('');$('bmImportNote').textContent=`${rows.length} rows to save to ${week.week}. Existing matching IDs will be updated. Full fields are validated on save.`;$('bmSave').disabled=false;}catch(e){pending=null;$('bmImportNote').textContent=e.message;}
 };
 $('bmSave').onclick=async()=>{if(!pending||busy)return;busy=true;$('bmSave').disabled=true;const ticket=seq;const payload=pending;try{const saved=await api('save',payload);if(ticket!==seq)return;week=saved;draw();resetImport();$('bmJson').value='';$('bmImportNote').textContent='Saved. Your contest picks are unchanged.';message(`${saved.candidates.length} candidates saved to ${saved.week}.`);}catch(e){if(ticket===seq){$('bmImportNote').textContent=e.message;$('bmSave').disabled=false;}}finally{busy=false;}};
 $('bmRows').onclick=e=>{const button=e.target.closest('[data-bm-edit]');if(!button||!week)return;const c=week.candidates.find(c=>c.id===button.dataset.bmEdit);resetImport();$('bmJson').value=JSON.stringify([clean(c)],null,2);$('bmImport').open=true;$('bmJson').focus();};
 window.DDBozoMenu={sync};sync();if(!session)message('Sign in to open your private weekly menu.');
}
