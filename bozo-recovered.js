/* Supplemental public evidence only. Never writes a capture, ledger or scoring state. */
(function(root){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)>=100;
const number=x=>typeof x==='number'&&Number.isFinite(x);
const fmt=x=>price(x)?(x>0?'+':'')+x:'unknown';
const signed=x=>number(x)?(x>0?'+':'')+x:'unknown';
const safeURL=x=>{try{const u=new URL(x);return u.protocol==='https:'&&u.hostname==='theoddsgap.com'&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null;}catch{return null;}};
function validate(doc){
 const rows=doc?.data?.records;if(doc?.data?.schema_version!==1||!Array.isArray(rows))throw Error('Invalid recovery document');
 const allowed='id revision supersedes event_id sport kickoff away home book source_url page_quote_timestamp quote_timestamp retrieved_at evidence_status orientation period markets'.split(' ');
 const seen=new Map();
 for(const r of rows){
  if(Object.keys(r).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in r)))throw Error('Unexpected or missing recovery field');
  if(!/^recovery-\d+$/.test(r.id)||!/^\d+$/.test(r.event_id)||r.id!=='recovery-'+r.event_id||!['nfl','cfb'].includes(r.sport)||r.book!=='draftkings'||!safeURL(r.source_url)||r.evidence_status!=='third_party_reported_closing_uncorroborated'||r.orientation!=='scheduled_home_away'||r.period!=='full_game')throw Error('Unsupported recovery identity/provenance');
  if(![r.kickoff,r.page_quote_timestamp,r.retrieved_at].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)))||(r.quote_timestamp!==null&&!Number.isFinite(Date.parse(r.quote_timestamp))))throw Error('Invalid timestamp');
  if(![r.away,r.home].every(x=>typeof x==='string'&&x.length>0&&x.length<=80))throw Error('Invalid team');
  const prior=seen.get(r.id);
  if(!Number.isInteger(r.revision)||r.revision!==(prior?prior.revision+1:1)||r.supersedes!==(prior?`${r.id}@${prior.revision}`:null))throw Error('Broken revision history');
  if(prior&&['event_id','sport','kickoff','home','away','orientation','period'].some(k=>r[k]!==prior[k]))throw Error('Revision changed game identity');
  if(!r.markets||Object.keys(r.markets).sort().join()!=='moneyline,spread,total')throw Error('Invalid markets');
  for(const [name,m] of Object.entries(r.markets)){
   if(m===null)continue;
   const keys=name==='moneyline'?['home_price','away_price']:name==='spread'?['home_line','home_price','away_price']:['line','over_price','under_price'];
   if(Object.keys(m).sort().join()!==keys.sort().join()||keys.some(k=>m[k]!==null&&!(k.endsWith('price')?price(m[k]):number(m[k]))))throw Error('Invalid market value');
  }
  seen.set(r.id,r);
 }
 return [...seen.values()];
}
// Exact identity/period/line only. There is no alt-line or team-fuzzy fallback.
function select(record,game,market,line=null,period='full_game'){
 if(String(game?.id)!==record.event_id||Date.parse(game?.start)!==Date.parse(record.kickoff)||period!==record.period||!['moneyline','spread','total'].includes(market))return null;
 const original=game.close;
 if(original!=null){const m=original[market];if(!m||(market!=='moneyline'&&line!==(market==='spread'?m.home_line:m.line)))return null;return {kind:'original',market:m};}
 const m=record.markets[market];
 if(!m||(market!=='moneyline'&&line!==(market==='spread'?m.home_line:m.line)))return null;
 return {kind:'recovered',market:m};
}
function render(record,game,readOK){
 const matched=game&&String(game.id)===record.event_id&&Date.parse(game.start)===Date.parse(record.kickoff);
 const original=matched?game.close:null;
 const hasOriginal=original!=null;
 const markets=hasOriginal?original:record.markets;
 const status=hasOriginal?'Original near-close capture':readOK&&matched?'Original capture not returned (missing or unavailable)':'Original capture status unavailable';
 const label=hasOriginal?'Original capture takes precedence':'Recovered source-reported closing · uncorroborated';
 const m=markets.moneyline,s=markets.spread,t=markets.total;
 return `<article class="br-game"><h3>${esc(record.away)} at ${esc(record.home)}</h3><p>${esc(record.kickoff)} · ${esc(record.book)}</p><strong>${label}</strong><p>${status}</p><dl><dt>Moneyline</dt><dd>${esc(record.away)} ${fmt(m?.away_price)} / ${esc(record.home)} ${fmt(m?.home_price)}</dd><dt>Spread</dt><dd>${esc(record.away)} ${signed(s?.home_line==null?null:-s.home_line)} (${fmt(s?.away_price)}) / ${esc(record.home)} ${signed(s?.home_line)} (${fmt(s?.home_price)})</dd><dt>Total</dt><dd>${number(t?.line)?t.line:'unknown'} · Over ${fmt(t?.over_price)} / Under ${fmt(t?.under_price)}</dd></dl>${hasOriginal?`<p>Captured ${esc(original.captured_at??'unknown')} · ${esc(original.source??'unknown source')}</p>`:`<p><a href="${esc(safeURL(record.source_url))}" target="_blank" rel="noopener noreferrer">Source-claimed closing table</a> · revision ${record.revision}</p><p>Page quote timestamp: ${esc(record.page_quote_timestamp)}<br>Exact per-book quote time: ${esc(record.quote_timestamp??'unknown')}<br>Retrieved: ${esc(record.retrieved_at)}</p><p>Page timestamp is not proof of the book’s final pre-kickoff quote. No independent corroboration.</p>`}</article>`;
}
async function mount(document,fetcher){
 const panel=document.getElementById('bozoRecovered');if(!panel)return;
 let loaded=false;
 panel.addEventListener('toggle',async()=>{
  if(!panel.open||loaded)return;loaded=true;
  const host=document.getElementById('bozoRecoveredRows');host.textContent='Loading public closing evidence…';
  try{
   const get=async url=>{const r=await fetcher(url,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok)throw Error('Read failed');return r.json();};
   const records=validate(await get('data/bozo-recovered-closes.json'));
   const scores={};await Promise.all(['nfl','cfb'].map(async sport=>{try{const d=await get(`https://toto.jkapcar4.workers.dev/scores?sport=${sport}&dates=20261022-20261023&closes=1`);if(!Array.isArray(d.games))throw Error('Invalid scores');scores[sport]=d.games;}catch{scores[sport]=null;}}));
   host.innerHTML=records.map(r=>render(r,scores[r.sport]?.find(g=>String(g.id)===r.event_id),scores[r.sport]!==null)).join('');
  }catch{host.textContent='Recovered evidence could not be loaded. Original captures and official results are unchanged.';loaded=false;}
 });
}
const api={validate,select,render,mount};if(typeof module!=='undefined'&&module.exports)module.exports=api;else {root.BozoRecovered=api;mount(root.document,root.fetch.bind(root));}
})(typeof window==='undefined'?globalThis:window);
