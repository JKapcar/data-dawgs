/* DFS results ledger (WO-1). Joins DraftKings contest-standings CSVs to the
   saved pre-lock workspace snapshot and grades every entry we submitted.

   Pure functions; runs in the browser (dfs.html) and in Node (tools/dfs-ledger.mjs).
   Inputs never leave the caller: the standings CSV is parsed here and only our own
   entries, per-player field ownership and duplicate counts are kept (Bible I3).

   Rules the code enforces, because they are the point of the ledger:
   - Predictions come from the snapshot as saved, never from a re-run. A snapshot
     saved after lock is refused unless the caller explicitly allows it, and then
     every prediction carries prelock_verified=false.
   - A value the model never produced stays null. The simulator reports top-1% and
     places 1–10; it does not report top-10% or top-0.1%, so those are null.
   - Predictions are conditional on the simulated contest (field size, payout). Each
     row carries that basis so a 250-entry contest is not graded as if it were Milly. */
(function(root){
'use strict';
const SCHEMA='dfs-ledger/1';
const CSV_COLUMNS=['contest','contest_id','entry_id','cpt','flex','salary','salary_remaining','tags',
 'proj','ceil_sum','own_product','pred_mean','pred_sd','pred_cash','pred_top10pct','pred_top1pct','pred_top0_1pct','pred_top10_places','pred_percentile','pred_dupes','pred_dupes_prior','pred_dupes_scaled','pred_objective','pred_basis_field','pred_basis_match',
 'actual_points','actual_rank','field_size','actual_percentile','cash','top10pct','top1pct','top0_1pct','copies','dupes_observed','obs_own_product','entry_fee','payout','roi',
 'own_product_error','dupe_error','percentile_error','cash_residual','top10pct_residual','top1pct_residual','top0_1pct_residual','join_status','model_version','prelock_verified'];
const AUDIT_COLUMNS=[['contest','Contest'],['cpt','CPT'],['flex','FLEX'],['salary','Salary'],['pred_top1pct','Pred Top1%'],['pred_cash','Pred Cash'],['pred_dupes_scaled','Pred Dupes'],['actual_rank','Actual Finish'],['actual_percentile','Actual Percentile'],['copies','Copies'],['payout','Payout'],['roi','ROI']];

/* ---------- CSV ---------- */
function parseCSV(text){
 text=String(text||'').replace(/^﻿/,'');const rows=[];let row=[],cur='',q=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;continue;}
  if(ch==='"')q=true;else if(ch===','){row.push(cur);cur='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur='';}
  else cur+=ch;}
 if(cur!==''||row.length){row.push(cur);rows.push(row);}
 return rows;
}
function csvCell(v){if(v==null)return '';const s=typeof v==='number'?String(+v.toFixed(6)):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function toCSV(rows,cols){return [cols.map(c=>csvCell(Array.isArray(c)?c[1]:c)).join(',')].concat(rows.map(r=>cols.map(c=>csvCell(r[Array.isArray(c)?c[0]:c])).join(','))).join('\r\n')+'\r\n';}

/* ---------- names ---------- */
function normName(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[.'’`]/g,'').replace(/-/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,'').replace(/\s+/g,' ').trim();}
function baseUser(entryName){return String(entryName||'').replace(/\s*\(\d+\/\d+\)\s*$/,'').trim().toLowerCase();}
const SLOT_RE=/(?:^|\s)(CPT|FLEX|QB|RB|WR|TE|DST)\s+/g;
// DK standings lineup string: "CPT A FLEX B FLEX C ..." (Showdown) or "QB A RB B ... DST X" (Classic).
function parseLineup(s){
 s=String(s||'').trim();if(!s||/^locked$/i.test(s))return null;
 const marks=[];let m;SLOT_RE.lastIndex=0;while((m=SLOT_RE.exec(s)))marks.push({slot:m[1],start:m.index,body:m.index+m[0].length});
 if(!marks.length)return null;
 return marks.map((k,i)=>({slot:k.slot,name:s.slice(k.body,i+1<marks.length?marks[i+1].start:s.length).trim()})).filter(x=>x.name);
}
function rosterKey(slots,showdown){
 if(!slots)return null;
 if(showdown){const c=slots.find(x=>x.slot==='CPT');return (c?normName(c.name):'')+'|'+slots.filter(x=>x.slot!=='CPT').map(x=>normName(x.name)).sort().join(',');}
 return slots.map(x=>normName(x.name)).sort().join(',');
}
function r4(v){return v==null?null:Math.round(v*1e4)/1e4;}
function pct(s){if(s==null||s==='')return null;const v=parseFloat(String(s).replace('%',''));return Number.isFinite(v)?v:null;}

/* ---------- standings ---------- */
function contestIdFromFilename(name){const m=String(name||'').match(/(\d{6,12})/);return m?m[1]:null;}
function parseStandings(text,opts={}){
 const rows=parseCSV(text);if(rows.length<2)throw new Error('Standings CSV needs a header and at least one row.');
 const head=rows[0].map(h=>String(h).trim().toLowerCase());
 const at=(...names)=>{for(const n of names){const j=head.indexOf(n);if(j>=0)return j;}return -1;};
 const c={rank:at('rank'),id:at('entryid','entry id'),name:at('entryname','entry name'),pts:at('points'),lineup:at('lineup'),player:at('player'),pos:at('roster position'),drafted:at('%drafted'),fpts:at('fpts')};
 if(c.rank<0||c.pts<0||c.lineup<0||c.name<0)throw new Error('Not a DraftKings contest-standings CSV: need Rank, EntryName, Points and Lineup columns.');
 const entries=[],ownership=[];
 for(let r=1;r<rows.length;r++){const row=rows[r];if(!row||!row.some(x=>String(x).trim()))continue;
  const rank=parseInt(row[c.rank],10);
  if(Number.isFinite(rank)&&String(row[c.name]||'').trim())entries.push({rank,entry_id:c.id>=0?String(row[c.id]||'').trim()||null:null,entry_name:String(row[c.name]).trim(),points:parseFloat(row[c.pts]),lineup:parseLineup(row[c.lineup])});
  if(c.player>=0&&String(row[c.player]||'').trim())ownership.push({player:String(row[c.player]).trim(),slot:String(row[c.pos]||'').trim().toUpperCase()||null,drafted:pct(row[c.drafted]),fpts:c.fpts>=0?parseFloat(row[c.fpts]):null});
 }
 if(!entries.length)throw new Error('No entry rows found.');
 const showdown=opts.showdown!=null?opts.showdown:entries.some(e=>e.lineup&&e.lineup.some(x=>x.slot==='CPT'));
 const copies=new Map();
 for(const e of entries){e.key=rosterKey(e.lineup,showdown);if(e.key)copies.set(e.key,(copies.get(e.key)||0)+1);}
 const tied=new Map();for(const e of entries)if(Number.isFinite(e.points))tied.set(e.points,(tied.get(e.points)||0)+1);
 for(const e of entries){e.copies=e.key?copies.get(e.key):null;e.tied=Number.isFinite(e.points)?tied.get(e.points):1;}
 return {contest_id:opts.contestId||null,showdown,field_size:entries.length,entries,ownership,hidden_lineups:entries.filter(e=>!e.lineup).length};
}

/* ---------- contest metadata ---------- */
function payoutRows(meta){
 const src=meta&&(meta.payout||meta.payouts||meta.payoutSummary);if(!Array.isArray(src))return null;
 const out=[];for(const t of src){
  const from=Number(t.from??t.fromPlace??t.minPosition),to=Number(t.to??t.toPlace??t.maxPosition);
  let prize=t.prize!=null?Number(t.prize):t.payoutDescriptions&&t.payoutDescriptions[0]?Number(t.payoutDescriptions[0].value):NaN;
  if(Number.isFinite(from)&&Number.isFinite(to)&&Number.isFinite(prize))out.push({from,to,prize});}
 return out.length?out.sort((a,b)=>a.from-b.from):null;
}
function prizeAt(rows,place){for(const r of rows)if(place>=r.from&&place<=r.to)return r.prize;return 0;}
// DK splits tied places evenly: a tie at rank r over k entries shares places r..r+k-1.
function tiePayout(rows,rank,tied){if(!rows)return null;let s=0;for(let p=rank;p<rank+tied;p++)s+=prizeAt(rows,p);return s/tied;}
function contestTier(c){
 if(c.type)return c.type;if(c.max_entries_per_user===1)return 'single_entry';
 if(c.payout&&c.payout.length===1&&c.payout[0].from===1&&c.payout[0].to>1)return 'multiplier';
 const n=c.field_size;return n>=50000?'large_gpp':n>=5000?'mid_gpp':n>=500?'small_gpp':'micro_gpp';
}

/* ---------- snapshot ---------- */
function slotOwn(p,captain,showdown){
 if(!p)return null;if(!showdown)return Number.isFinite(p.own)?p.own:null;
 if(captain)return Number.isFinite(p.cptOwn)?p.cptOwn:null;
 if(Number.isFinite(p.flexOwn))return p.flexOwn;
 return Number.isFinite(p.own)&&Number.isFinite(p.cptOwn)?p.own-p.cptOwn:null;
}
function snapshotInfo(ws,lockTime){
 const sim=ws.simulation||null,meta=sim&&sim.meta||{};
 const updated=Date.parse(ws.updated_at),lock=lockTime?Date.parse(lockTime):NaN;
 return {workspace_id:ws.id||ws.workspace_id||null,workspace_revision:ws.revision??null,workspace_updated_at:ws.updated_at||null,source:ws.source||null,as_of:ws.as_of||null,site:ws.site||null,
  lock_time:Number.isFinite(lock)?new Date(lock).toISOString():null,
  prelock_verified:Number.isFinite(updated)&&Number.isFinite(lock)?updated<lock:null,
  model:sim?{engine_version:meta.engineVersion??null,sims:meta.sims??null,seed:meta.seed??null,field_size:meta.fieldSize??null,entry_fee:meta.entryFee??null,paid_places:meta.paidPlaces??null,payout:meta.payout||null,field_sample:meta.fieldSample??null,rank_method:meta.rankMethod||null,sim_input_revision:sim.input_revision??null,dupe_prior:!!sim.dupe_prior,field_ownership_error:meta.fieldOwnershipError??null}:null};
}
function modelVersion(info){const m=info.model;return m?'engine'+m.engine_version+'/ws'+info.workspace_id+'@r'+info.workspace_revision+'/seed'+m.seed+'/sims'+m.sims:'no-simulation/ws'+info.workspace_id+'@r'+info.workspace_revision;}
function resolveLineup(slots,players,showdown){
 const byName=new Map();players.forEach((p,i)=>{const k=normName(p.name);if(!byName.has(k))byName.set(k,i);if(p.pos==='DST'&&p.team)byName.set(normName(p.team),i);});
 const ids=[],missing=[];let cpt=null;
 for(const s of slots){const i=byName.get(normName(s.name));if(i==null){missing.push(s.name);continue;}ids.push(i);if(showdown&&s.slot==='CPT')cpt=i;}
 return {ids,cpt,missing};
}
function tags(ids,cpt,P,showdown){
 const t=[],teams={};for(const i of ids)teams[P[i].team]=(teams[P[i].team]||0)+1;
 t.push('split:'+Object.values(teams).sort((a,b)=>b-a).join('-'));
 if(showdown&&cpt!=null){const c=P[cpt];t.push('cpt:'+c.pos+':'+c.team);
  const pass=p=>p.pos==='WR'||p.pos==='TE';
  const ownQB=ids.some(i=>i!==cpt&&P[i].team===c.team&&P[i].pos==='QB'),catchers=ids.filter(i=>i!==cpt&&P[i].team===c.team&&pass(P[i])).length;
  if((c.pos==='QB'&&catchers)||(pass(c)&&ownQB))t.push('script:pass_stack');
  if(ids.some(i=>P[i].team!==c.team&&['QB','RB','WR','TE'].includes(P[i].pos)))t.push('script:bring_back');}
 if(ids.some(i=>P[i].pos==='RB'&&ids.some(j=>P[j].team===P[i].team&&P[j].pos==='DST')))t.push('script:rb_dst');
 if(ids.some(i=>P[i].pos==='QB'&&ids.some(j=>P[j].pos==='DST'&&P[j].team!==P[i].team)))t.push('script:qb_vs_dst');
 return t;
}
function sameLineup(a,ids,cpt){return a.ids.length===ids.length&&(a.cpt??null)===(cpt??null)&&a.ids.every(i=>ids.includes(i));}

/* ---------- build ---------- */
// contests: [{csv|parsed, meta:{contest_id,name,entry_fee,payout,max_entries,max_entries_per_user,type}}]
function buildLedger(ws,contests,opts={}){
 if(!ws||!Array.isArray(ws.players))throw new Error('Supply the saved workspace snapshot (dd_dfs_get with include_results).');
 const users=[].concat(opts.users||opts.user||[]).map(u=>String(u).trim().toLowerCase()).filter(Boolean);
 if(!users.length)throw new Error('Supply the DraftKings username(s) that identify our entries.');
 const info=snapshotInfo(ws,opts.lockTime);
 if(info.prelock_verified===false&&!opts.allowPostLock)throw new Error('Snapshot was saved at '+info.workspace_updated_at+', after lock '+info.lock_time+'. Its predictions are not pre-lock. Refusing (allowPostLock overrides and labels every row).');
 const P=ws.players,showdown=ws.site==='dk_showdown',sim=ws.simulation||null,mv=modelVersion(info),simField=info.model&&info.model.field_size;
 const simIdx=new Map();if(sim&&sim.perLineup)sim.perLineup.forEach(r=>simIdx.set(sim.workspace_indices?sim.workspace_indices[r.i]:r.i,r));
 const lineups=ws.lineups||[];
 const outContests=[],entries=[],ownership=[];
 for(const item of contests){
  const meta=item.meta||{},st=item.parsed||parseStandings(item.csv,{contestId:meta.contest_id,showdown});
  const cid=String(meta.contest_id||st.contest_id||'unknown');const pay=payoutRows(meta);
  const ours=st.entries.filter(e=>users.includes(baseUser(e.entry_name)));
  const fee=Number.isFinite(+meta.entry_fee)&&meta.entry_fee!==''&&meta.entry_fee!=null?+meta.entry_fee:null;
  const total=pay?pay.reduce((s,r)=>s+(r.to-r.from+1)*r.prize,0):null;
  const contest={contest_id:cid,name:meta.name||null,entry_fee:fee,field_size:st.field_size,max_entries:meta.max_entries??null,max_entries_per_user:meta.max_entries_per_user??null,our_entries:ours.length,
   payout:pay,total_prizes:total,paid_places:pay?pay.filter(r=>r.prize>0).reduce((m,r)=>Math.max(m,r.to),0):null,
   rake:fee&&total!=null?1-total/(fee*st.field_size):null,rake_at_capacity:fee&&total!=null&&meta.max_entries?1-total/(fee*meta.max_entries):null,hidden_lineups:st.hidden_lineups};
  contest.tier=contestTier({...contest,type:meta.type});outContests.push(contest);
  const obs=new Map();for(const o of st.ownership)obs.set(normName(o.player)+'|'+(showdown?o.slot:'ALL'),o);
  P.forEach(p=>{for(const cap of showdown?[true,false]:[false]){const o=obs.get(normName(p.name)+'|'+(showdown?(cap?'CPT':'FLEX'):'ALL'))||(p.pos==='DST'?obs.get(normName(p.team)+'|'+(showdown?(cap?'CPT':'FLEX'):'ALL')):null);
   const proj=slotOwn(p,cap,showdown),seen=o?o.drafted:null;if(proj==null&&seen==null)continue;
   ownership.push({contest_id:cid,tier:contest.tier,field_size:st.field_size,entry_fee:fee,player:p.name,team:p.team,pos:p.pos,slot:showdown?(cap?'CPT':'FLEX'):'ALL',proj_own:r4(proj),obs_own:seen,error:proj!=null&&seen!=null?r4(seen-proj):null});}});
  for(const e of ours){
   const row={contest:contest.name||cid,contest_id:cid,tier:contest.tier,entry_id:e.entry_id,model_version:mv,prelock_verified:info.prelock_verified,
    actual_points:Number.isFinite(e.points)?e.points:null,actual_rank:e.rank,field_size:st.field_size,entry_fee:fee};
   row.actual_percentile=100*(1-(e.rank-1)/st.field_size);
   row.top10pct=e.rank<=Math.max(1,Math.floor(st.field_size*.10));row.top1pct=e.rank-1<Math.max(1,Math.floor(st.field_size*.01));row.top0_1pct=e.rank-1<Math.max(1,Math.floor(st.field_size*.001));
   row.payout=tiePayout(pay,e.rank,e.tied);row.cash=row.payout==null?null:row.payout>0;row.roi=row.payout!=null&&fee?(row.payout-fee)/fee:null;
   row.copies=e.copies;const oursSame=ours.filter(x=>x.key===e.key).length;row.dupes_observed=e.copies!=null?e.copies-oursSame:null;
   if(!e.lineup){row.join_status='lineup_hidden';entries.push(row);continue;}
   const r=resolveLineup(e.lineup,P,showdown);
   row.cpt=showdown?(e.lineup.find(x=>x.slot==='CPT')||{}).name||null:null;row.flex=e.lineup.filter(x=>x.slot!=='CPT').map(x=>x.name).join(' / ');
   if(r.missing.length){row.join_status='player_not_in_snapshot:'+r.missing.join('|');entries.push(row);continue;}
   const mult=i=>showdown&&i===r.cpt?1.5:1;
   row.salary=r.ids.reduce((s,i)=>s+(showdown&&i===r.cpt?(P[i].cptSal||Math.round(P[i].sal*1.5)):P[i].sal),0);row.salary_remaining=50000-row.salary;
   row.proj=r.ids.every(i=>Number.isFinite(P[i].proj))?r.ids.reduce((s,i)=>s+P[i].proj*mult(i),0):null;
   row.ceil_sum=r.ids.every(i=>Number.isFinite(P[i].ceil))?r.ids.reduce((s,i)=>s+P[i].ceil*mult(i),0):null;
   const own=r.ids.map(i=>slotOwn(P[i],i===r.cpt,showdown));row.own_product=own.every(v=>v!=null)?own.reduce((s,v)=>s*Math.max(v,.25)/100,1):null;
   const seen=r.ids.map(i=>{const o=obs.get(normName(P[i].name)+'|'+(showdown?(i===r.cpt?'CPT':'FLEX'):'ALL'));return o?o.drafted:null;});
   row.obs_own_product=seen.every(v=>v!=null)?seen.reduce((s,v)=>s*Math.max(v,.25)/100,1):null;
   row.own_product_error=row.own_product!=null&&row.obs_own_product!=null?Math.log10(row.obs_own_product/row.own_product):null;
   row.tags=tags(r.ids,r.cpt,P,showdown).join(' ');
   row.players=r.ids.map(i=>({name:P[i].name,team:P[i].team,pos:P[i].pos,slot:showdown&&i===r.cpt?'CPT':'FLEX',sal:P[i].sal,proj:P[i].proj??null,ceil:P[i].ceil??null,cptProj:P[i].cptProj??null,own:slotOwn(P[i],i===r.cpt,showdown)}));
   const wi=lineups.findIndex(l=>sameLineup(l,r.ids,showdown?r.cpt:(l.cpt??null)));
   row.workspace_index=wi>=0?wi:null;const s=wi>=0?simIdx.get(wi):null;
   row.join_status=wi<0?'not_in_snapshot_lineups':s?'joined':'not_simulated';
   // Model outputs: only what the simulator actually reported.
   const scale=simField&&st.field_size?(st.field_size-1)/(simField-1):null;
   Object.assign(row,{pred_mean:s?s.mean:null,pred_sd:s?s.sd:null,pred_cash:s?s.cash:null,pred_top10pct:null,pred_top1pct:s?s.top1:null,pred_top0_1pct:null,pred_top10_places:s?s.top10:null,
    pred_percentile:s&&Number.isFinite(s.meanRank)&&simField?100*(1-(s.meanRank-1)/simField):null,
    pred_dupes:s?s.dupes:null,pred_dupes_prior:s&&Number.isFinite(s.eDupes)?s.eDupes:null,pred_dupes_scaled:s&&scale!=null?s.dupes*scale:null,
    pred_objective:s&&Number.isFinite(s.top1Share)?s.top1Share:null,pred_basis_field:simField||null,
    pred_basis_match:s&&simField?Math.abs(st.field_size-simField)/simField<=.15:null});
   row.dupe_error=row.pred_dupes_scaled!=null&&row.dupes_observed!=null?row.dupes_observed-row.pred_dupes_scaled:null;
   row.percentile_error=row.pred_percentile!=null?row.actual_percentile-row.pred_percentile:null;
   const res=(p,a)=>p==null||a==null?null:(a?1:0)-p;
   row.cash_residual=res(row.pred_cash,row.cash);row.top10pct_residual=null;row.top1pct_residual=res(row.pred_top1pct,row.top1pct);row.top0_1pct_residual=null;
   entries.push(row);
  }
 }
 const ledger={schema:SCHEMA,built_at:opts.builtAt||new Date().toISOString(),slate:{slate_id:opts.slateId||info.workspace_id,date:opts.date||(info.lock_time||info.as_of||'').slice(0,10)||null,site:info.site,game:opts.game||[...new Set(P.map(p=>p.gid).filter(Boolean))].join(' ')||null,...info,snapshot_sha256:opts.snapshotSha256||null},
  contests:outContests,entries,ownership,
  notes:['Predictions are the saved pre-lock snapshot as-is; nothing is re-simulated.',
   'Simulator predictions are conditional on its own contest ('+(simField||'n/a')+' entries, modelled payout). pred_basis_match flags contests within 15% of that field size; pred_dupes_scaled rescales expected copies linearly to each contest.',
   'pred_top10pct and pred_top0_1pct are null: the simulator does not report them. pred_top10_places is places 1–10.',
   'own_product uses a 0.25% floor per slot. own_product_error is log10(observed/projected).',
   'Standings rows for other entrants are not retained; only our entries, field ownership and duplicate counts.']};
 ledger.summary=summarize(ledger);
 return ledger;
}

/* ---------- summary ---------- */
function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;}
function summarize(L){
 const E=L.entries,num=k=>E.map(r=>r[k]).filter(v=>v!=null&&Number.isFinite(v));
 const fees=E.filter(r=>r.entry_fee!=null),paid=fees.filter(r=>r.payout!=null);
 const own=L.ownership.filter(o=>o.error!=null),bySlot={};
 for(const o of own)(bySlot[o.slot]=bySlot[o.slot]||[]).push(o.error);
 const ownStats=a=>({n:a.length,bias:mean(a),mae:mean(a.map(Math.abs)),rmse:a.length?Math.sqrt(mean(a.map(v=>v*v))):null});
 const cal=(p,a)=>{const rows=E.filter(r=>r[p]!=null&&r[a]!=null);return {n:rows.length,predicted:rows.reduce((s,r)=>s+r[p],0),observed:rows.filter(r=>r[a]).length};};
 return {entries:E.length,joined:E.filter(r=>r.join_status==='joined').length,join_status:E.reduce((m,r)=>(m[r.join_status]=(m[r.join_status]||0)+1,m),{}),
  unpriced_entries:E.length-fees.length,fees:fees.reduce((s,r)=>s+r.entry_fee,0),payout:paid.length===fees.length&&fees.length?paid.reduce((s,r)=>s+r.payout,0):null,
  roi:paid.length===fees.length&&fees.length?paid.reduce((s,r)=>s+r.payout,0)/fees.reduce((s,r)=>s+r.entry_fee,0)-1:null,
  cash:cal('pred_cash','cash'),top1pct:cal('pred_top1pct','top1pct'),
  mean_percentile_error:mean(num('percentile_error')),dupe_mae:mean(num('dupe_error').map(Math.abs)),dupe_bias:mean(num('dupe_error')),
  ownership:{all:ownStats(own.map(o=>o.error)),...Object.fromEntries(Object.entries(bySlot).map(([k,v])=>[k,ownStats(v)]))},
  note:'One slate is an observation, not a calibration. Read these against repeated slates.'};
}
function auditCSV(L,full){return toCSV(L.entries,full?CSV_COLUMNS:AUDIT_COLUMNS);}

const api={SCHEMA,CSV_COLUMNS,AUDIT_COLUMNS,parseCSV,toCSV,parseLineup,rosterKey,normName,baseUser,parseStandings,contestIdFromFilename,payoutRows,tiePayout,contestTier,slotOwn,snapshotInfo,buildLedger,summarize,auditCSV};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root)root.DDFSLedger=api;
})(typeof globalThis!=='undefined'?globalThis:this);
