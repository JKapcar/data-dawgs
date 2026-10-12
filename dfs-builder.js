/* Session-local manual construction. No storage, networking or tournament model. */
(function(root){
'use strict';
const D=typeof module!=='undefined'?require('./dfs-diagnostics.js'):root.DDFSDiagnostics;
const I=typeof module!=='undefined'?require('./work/dfs-slate-ingest.js'):root.DDFSIngest;
const finite=Number.isFinite;
const fields={
 name:['Player','Name','Player Name'],pos:['DK Pos','Position','Pos'],team:['Team','TeamAbbrev'],opp:['Opp','Opponent'],
 sal:['DK Salary','Salary','FLEX Salary'],proj:['DK Proj','Projection','Proj','Fpts','FLEX Projection'],
 own:['Large Field','Ownership','Own','Total Own','Small Field'],cptSal:['CPT Salary','Captain Salary'],
 cptProj:['CPT Projection','Captain Projection','CPT Proj'],cptOwn:['CPT Own','Captain Own','CPT Ownership'],
 flexOwn:['FLEX Own','FLEX Ownership'],status:['Injury Status','Status'],kickoff:['Kickoff','Start Time']
};
const labels={name:'Player name *',pos:'Position *',team:'Team *',opp:'Opponent',sal:'FLEX / base salary *',proj:'FLEX / base projection *',own:'Ownership (choose contest column)',cptSal:'CPT salary (already multiplied)',cptProj:'CPT projection (already multiplied)',cptOwn:'CPT ownership',flexOwn:'FLEX ownership',status:'Injury designation',kickoff:'Kickoff (ISO with timezone)'};
const norm=s=>String(s??'').trim().toLowerCase();
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&finite(Date.parse(s));
function inspect(text){
 if(typeof text!=='string'||text.length>2000000)throw Error('CSV must be text, at most 2 MB.');
 // The shared parser handles BOM, quoted commas/newlines and escaped quotes.
 // Reject malformed quoting before calling it, rather than silently swallowing rows.
 let quoted=false,start=true,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(i===0&&c==='\uFEFF')continue;
  if(quoted){if(c==='"'){if(text[i+1]==='"')i++;else{quoted=false;closed=true;}}continue;}
  if(c===','||c==='\n'||c==='\r'){start=true;closed=false;continue;}
  if(c==='"'){if(!start)throw Error('Malformed CSV quoting.');quoted=true;start=false;continue;}
  if(closed&&!/\s/.test(c))throw Error('Unexpected text after a quoted CSV cell.');start=false;
 }
 if(quoted)throw Error('Unclosed CSV quote.');
 const rows=I.parseCSV(text);if(rows.length<2||rows.length>221)throw Error('Expected a header and 1–220 player rows. Use one row per player with separate CPT columns.');
 const headers=rows.shift().map(s=>s.trim());
 if(headers.length>80||new Set(headers.map(norm)).size!==headers.length)throw Error('Headers must be unique (maximum 80 columns).');
 if(rows.some(r=>r.length!==headers.length))throw Error('Every row must have the same number of columns as the header.');
 const map={};for(const [key,aliases]of Object.entries(fields))map[key]=aliases.map(a=>headers.findIndex(h=>norm(h)===norm(a))).find(i=>i>=0)??-1;
 const detected=map.cptSal>=0||map.cptProj>=0||map.cptOwn>=0?'dk_showdown':headers.some(h=>/^dk /i.test(h))?'dk_classic':null;
 const siteColumn=headers.findIndex(h=>norm(h)==='site');
 const foreignSite=siteColumn>=0&&rows.some(row=>row[siteColumn].trim()&&!/^(?:dk|draftkings)$/i.test(row[siteColumn].trim()))||!headers.some(h=>/^dk /i.test(h))&&headers.some(h=>/^(?:fd |fanduel|yahoo)/i.test(h));
 return {headers,rows,map,detected,foreignSite};
}
function numeric(v,label,{ownership=false,units='pp',salary=false}={}){
 const raw=String(v??'').trim();if(!raw||/^(?:na|n\/a|null|--|-)$/i.test(raw))return null;
 const percent=raw.endsWith('%');
 if(percent&&!ownership)throw Error(label+': unexpected percent sign.');
 const cleaned=raw.replace(ownership?/%$/g:/[$,]/g,'');
 if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned))throw Error(label+': invalid number.');
 if(ownership&&units==='fraction'&&percent)throw Error(label+': percent-sign cells conflict with fraction units. Select percentage points.');
 const n=Number(cleaned)*(ownership&&units==='fraction'?100:1);
 if(!finite(n)||(ownership&&(n<0||n>100))||(salary&&(n<=0||!Number.isInteger(n))))throw Error(label+': value out of range.');
 return n;
}
function importPool(preview,opts){
 const {site,map=preview.map,units,convention,slate,source,asOf}=opts;
 if(preview.foreignSite)throw Error('This file explicitly names another site. Use its existing workspace importer; DK builder rules cannot validate it.');
 if(!D.rules[site])throw Error('Confirm DK NFL Classic or Showdown. Other formats stay in the existing workspace.');
 if(preview.detected==='dk_showdown'&&site!=='dk_showdown')throw Error('Captain columns indicate Showdown; Classic would discard that meaning.');
 if(!String(slate||'').trim())throw Error('Name the exact slate / game and date before importing.');
 if(asOf&&!stamp(asOf))throw Error('Source time must be ISO with a timezone; leave blank if unknown.');
 for(const key of ['name','pos','team','sal','proj'])if(!Number.isInteger(map[key])||map[key]<0)throw Error('Map '+labels[key]+'.');
 const chosen=Object.values(map).filter(i=>i>=0);
 if(chosen.some(i=>!Number.isInteger(i)||i>=preview.headers.length)||new Set(chosen).size!==chosen.length)throw Error('Map each column only once.');
 if(['own','cptOwn','flexOwn'].some(k=>map[k]>=0)&&!['pp','fraction'].includes(units))throw Error('Confirm ownership units for the whole file.');
 const sd=site==='dk_showdown';
 const matchup=String(opts.matchup||'').trim().toUpperCase().split(/\s*(?:@|\bVS\.?\b)\s*/);
 if(opts.matchup&&(!sd||matchup.length!==2||matchup[0]===matchup[1]||matchup.some(t=>!/^[A-Z0-9]{2,4}$/.test(t))))throw Error('Confirmed matchup must be two Showdown teams, for example AAA @ BBB.');
 if(sd&&map.own>=0&&!['total','flex','unknown'].includes(convention))throw Error('Confirm whether general ownership includes captain.');
 const seen=new Set(),warnings=[];
 const players=preview.rows.map((row,i)=>{
  const val=k=>map[k]>=0?row[map[k]]:'',label=k=>'Row '+(i+2)+' '+k;
  const p={name:val('name').trim(),pos:val('pos').trim().toUpperCase().replace(/D\/ST|DEF/g,'DST'),team:val('team').trim().toUpperCase(),opp:val('opp').trim().toUpperCase().replace(/^@|^VS\.?\s*/,'')};
  if(opts.matchup){if(!matchup.includes(p.team))throw Error(label('team')+': outside the confirmed matchup.');const opponent=matchup.find(t=>t!==p.team);if(p.opp&&p.opp!==opponent)throw Error(label('opponent')+': conflicts with confirmed matchup.');p.opp=opponent;}
  if(!p.name||p.name.length>160)throw Error(label('name')+': missing or too long.');
  if(!/^[A-Z0-9]{2,4}$/.test(p.team)||p.opp&&!/^[A-Z0-9]{2,4}$/.test(p.opp)||p.team===p.opp)throw Error(label('team / opponent')+': invalid mapping.');
  const positions=p.pos.split('/');if(!positions.every(x=>(sd?['QB','RB','WR','TE','K','DST']:['QB','RB','WR','TE','DST']).includes(x)))throw Error(label('position')+': not eligible in this format.');
  const identity=I.normName(p.name)+'|'+p.team;
  if(seen.has(identity))throw Error(label('player')+': duplicate name/team. Supply one base row per player; CPT belongs in separate columns.');seen.add(identity);p.uid=identity;
  for(const k of ['sal','proj','cptSal','cptProj'])p[k]=numeric(val(k),label(k),{salary:k.endsWith('Sal')||k==='sal'});
  for(const k of ['own','cptOwn','flexOwn'])p[k]=numeric(val(k),label(k),{ownership:true,units});
  if(sd){
   if(p.cptSal==null&&finite(p.sal))p.cptSal=p.sal*1.5;
   if(p.cptProj==null&&finite(p.proj))p.cptProj=p.proj*1.5;
   if(convention==='total'&&p.own!=null&&p.cptOwn!=null){const flex=p.own-p.cptOwn;if(flex<0||flex>100)throw Error(label('ownership')+': total minus CPT is outside 0–100.');if(p.flexOwn!=null&&Math.abs(p.flexOwn-flex)>0.01)throw Error(label('ownership')+': FLEX disagrees with total minus CPT.');p.flexOwn=flex;}
   if(convention==='flex'&&p.own!=null){if(p.flexOwn!=null&&Math.abs(p.flexOwn-p.own)>0.01)throw Error(label('ownership')+': FLEX columns disagree.');p.flexOwn=p.own;}
  }
  p.kickoff=val('kickoff').trim()||null;if(p.kickoff&&!stamp(p.kickoff))throw Error(label('kickoff')+': ISO timestamp with timezone required.');
  p.injury=val('status').trim()?{status:val('status').trim(),source:source||null,asOf:asOf||null}:null;
  return p;
 });
 if(!players.length)throw Error('No players found.');
 // Conflicting explicit pairings are rejected; missing opponents remain unknown.
 for(const p of players)if(p.opp&&players.some(q=>q.team===p.team&&q.opp&&q.opp!==p.opp||q.team===p.opp&&q.opp&&q.opp!==p.team))throw Error('Conflicting team/opponent mappings. Check the slate.');
 if(sd&&(new Set(players.map(p=>p.team)).size>2||new Set(players.map(D.game).filter(Boolean)).size>1))throw Error('Showdown must contain only one game and its two teams.');
 if(players.some(p=>!p.opp))warnings.push('Opponent missing: matchup legality and interactions remain unknown.');
 if(players.some(p=>p.sal==null||p.proj==null))warnings.push('Missing salary or projection stays unknown, never zero.');
 if(sd)warnings.push('CPT columns are used once; absent CPT salary / projection uses base × 1.5.');
 return {site,players,slate:String(slate).trim(),source:{name:source||null,asOf:asOf||null,version:'local-csv-v1'},importedAt:new Date().toISOString(),units:units||null,convention:convention||null,matchupEvidence:opts.matchup?'User confirmed '+matchup.join(' @ '):null,warnings,mapping:Object.fromEntries(Object.entries(map).map(([k,v])=>[k,v>=0?preview.headers[v]:null]))};
}
function empty(pool){return D.rules[pool.site].slots.map(()=>null);}
function eligible(p,slot,site){return !!p&&(site==='dk_showdown'||p.pos.split('/').some(pos=>slot==='FLEX'?['RB','WR','TE'].includes(pos):slot===pos));}
function assign(pool,roster,id,target){
 const slots=D.rules[pool.site].slots;
 if(!Number.isInteger(target)||target<0||target>=slots.length||!Number.isInteger(id)||!pool.players[id])throw Error('Choose a player and roster slot.');
 if(!eligible(pool.players[id],slots[target],pool.site))throw Error('Player is not eligible for '+slots[target]+'.');
 const next=roster.slice(),from=next.indexOf(id),other=next[target];
 if(from===target)return next;
 if(from>=0){if(other!=null&&!eligible(pool.players[other],slots[from],pool.site))throw Error('Both players must fit the swapped slots.');next[from]=other;}
 next[target]=id;return next;
}
function value(p,slot,key,site){if(!p)return null;const cpt=site==='dk_showdown'&&slot==='CPT';return key==='own'?(site==='dk_showdown'?(cpt?p.cptOwn:p.flexOwn):p.own):p[cpt?(key==='sal'?'cptSal':'cptProj'):key];}
function summary(pool,roster,now=new Date().toISOString()){
 const rule=D.rules[pool.site],slots=rule.slots,used=roster.map((id,i)=>({id,slot:slots[i],p:pool.players[id]})).filter(x=>x.p);
 const total=key=>used.every(x=>finite(value(x.p,x.slot,key,pool.site)))?used.reduce((s,x)=>s+value(x.p,x.slot,key,pool.site),0):null;
 const salary=total('sal'),projection=total('proj'),ownership=total('own'),remaining=salary==null?null:rule.cap-salary,open=slots.length-used.length;
 const e={ids:used.map(x=>x.id),slots:used.map(x=>x.slot),cpt:pool.site==='dk_showdown'?roster[0]:undefined};
 const checks=D.roster({site:pool.site,players:pool.players},e);
 const required=['Roster & eligibility','Salary','Showdown teams','Showdown matchup','Classic game count','Team / opponent mapping'];
 const canAudit=used.length===slots.length&&checks.filter(c=>required.includes(c.title)).every(c=>c.state==='pass');
 const age=stamp(pool.source.asOf)?(Date.parse(now)-Date.parse(pool.source.asOf))/3600000:null;
 checks.push({state:age==null?'unknown':age<0||age>6?'warning':'pass',title:'Source freshness',evidence:age==null?'Source timestamp unknown. Import time is not source time.':age<0?'Source time is in the future.':age.toFixed(1)+' hours since supplied source time (6-hour review threshold, not clearance).',action:'Refresh the provider snapshot and verify the official inactive report before lock.'});
 const missing=used.filter(x=>!x.p.injury||!x.p.injury.source||!stamp(x.p.injury.asOf)).length,flagged=used.filter(x=>x.p.injury&&!['active','healthy'].includes(norm(x.p.injury.status))).length;
 checks.push({state:flagged?'warning':missing||!used.length?'unknown':'pass',title:'Availability evidence',evidence:flagged+' non-active designations; '+missing+' missing sourced reports. Supplied status is not live clearance.',action:'Verify official availability and source time.'});
 return {salary,projection,ownership,remaining,open,used:used.length,perSlot:open&&remaining!=null?remaining/open:null,efficiency:salary>0&&projection!=null?projection/(salary/1000):null,knownOwnership:used.filter(x=>finite(value(x.p,x.slot,'own',pool.site))).length,checks,canAudit};
}
function auditRecord(pool,roster){const m=summary(pool,roster);if(!m.canAudit)throw Error('Resolve the full roster, salary and matchup checks first.');return {version:1,site:pool.site,synthetic:!!pool.synthetic,players:pool.players,source:pool.source,capturedAt:new Date().toISOString(),builder:{slate:pool.slate,matchupEvidence:pool.matchupEvidence||null,mapping:pool.mapping,units:pool.units,convention:pool.convention},entries:[{ids:roster.slice(),slots:D.rules[pool.site].slots.slice(),cpt:pool.site==='dk_showdown'?roster[0]:undefined,slotEvidence:'supplied',fee:null,lifecycle:'proposed'}]};}
const api={fields,labels,inspect,importPool,empty,eligible,assign,value,summary,auditRecord};
if(typeof module!=='undefined')module.exports=api;root.DDFSBuilder=api;
})(typeof self!=='undefined'?self:globalThis);
