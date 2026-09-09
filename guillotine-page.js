/* Shared league controls and navigation for the complete guillotine companion. */
(function(){
'use strict';
const $=id=>document.getElementById(id),read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}},esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const descriptions={survival:'Chop wheel · season curves',danger:'All teams · chop risk',waivers:'FAAB · values · waiver plan',fragility:'Injuries · byes · depth',weekly:'Start/sit · pickups · forecasts'};
const hints={survival:'Spin the wheel, compare survival curves, or run a season.',danger:'Compare every team in the same league.',waivers:'Track remaining money, roster values, and your waiver plan.',fragility:'Find injury exposure, upcoming byes, and thin positions.',weekly:'Player-level weekly forecasts, legal lineups, and acquisition comparisons.'};
let current=null,loading=false,schedule=null,deadlineKey=null;
function option(value,label){return '<option value="'+esc(value)+'">'+esc(label)+'</option>';}
function choices(){
 const leagues=new Map([['1400972302392262656','DawgPound Royale'],['1389344040964599808','Case’s Guillotine League']]);
 for(const l of read('dd-guillotine-leagues-v1',[]))if(l.leagueId)leagues.set(String(l.leagueId),l.name||String(l.leagueId));
 if(current?.leagueId)leagues.set(String(current.leagueId),current.league);
 const old=$('gxLeagueSelect').value||read('dd-guillotine-v1',{}).id||'';
 $('gxLeagueSelect').innerHTML=option('','Select a league')+[...leagues].map(([id,name])=>option(id,name)).join('');
 $('gxLeagueSelect').value=current?.leagueId||old;
}
function deadline(){
 const g=current;if(!g||!schedule)return;
 const key=g.season+':'+(Number(g.done||0)+1);if(key===deadlineKey)return;deadlineKey=key;
 const times=schedule.filter(x=>Number(x.season)===Number(g.season)&&Number(x.week)===Number(g.done||0)+1&&x.season_type==='REG').map(x=>Date.parse(x.kickoff_at));
 window.GX_VOTE_DEADLINE=times.length&&times.every(Number.isFinite)?Math.min(...times):null;
 $('gxDeadline').textContent=Number.isFinite(window.GX_VOTE_DEADLINE)?'Votes close at the first kickoff: '+new Date(window.GX_VOTE_DEADLINE).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})+'.':'Kickoff time unavailable. Voting is paused until it can be verified.';
 window.dispatchEvent(new Event('gx-deadline'));
}
function route(key,id){const url=new URL(location.href);if(id)url.searchParams.set('league',id);url.searchParams.delete('view');if(key)url.hash=key;history.replaceState(null,'',url);}
function ready(g){
 if(!g)return;const wasLoading=loading;current=g;loading=false;
 choices();route(null,g.leagueId);$('gxTeamSelect').innerHTML=option('','Choose your team')+(g.all||g.teams||[]).filter(t=>!t.dead).map(t=>option(t.rid,t.name)).join('');
 $('gxTeamSelect').value=g.me?.rid??'';$('gxTeamSelect').disabled=false;$('gxRefresh').disabled=false;$('gxRefresh').textContent='Refresh league';
 if(wasLoading||!$('gxConnectionStatus').dataset.loaded){$('gxConnectionStatus').textContent=g.league+' · Week '+(Number(g.done||0)+1)+' · '+g.teamCount+' teams · Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});$('gxConnectionStatus').dataset.loaded='true';}
 $('gxValueStatus').textContent=window.GX_VALUE_STATUS||'';deadline();
}
function begin(e){
 loading=true;current=null;deadlineKey=null;window.GX_VOTE_DEADLINE=null;
 $('gxRefresh').disabled=true;$('gxRefresh').textContent='Loading…';$('gxTeamSelect').disabled=true;$('gxTeamSelect').innerHTML=option('','Loading teams…');
 $('gxConnectionStatus').textContent=e.detail?.leagueId?'Loading league, rosters, and budgets…':'Choose a league to get started.';
 $('gxConnectionStatus').dataset.loaded='';$('gxValueStatus').textContent='';
 // Hide previous results during a new league request; never label them as the next league.
 document.querySelectorAll('.gx-sheet,.gx-risk-summary').forEach(el=>el.classList.add('gx-loading'));
 if(!e.detail?.leagueId){$('gxRefresh').disabled=false;$('gxRefresh').textContent='Refresh league';}
}
window.addEventListener('gx-loading',begin);
window.addEventListener('gx-ready',e=>{document.querySelectorAll('.gx-sheet,.gx-risk-summary').forEach(el=>el.classList.remove('gx-loading'));ready(e.detail);});
window.addEventListener('gx-error',e=>{loading=false;$('gxRefresh').disabled=false;$('gxRefresh').textContent='Retry';$('gxConnectionStatus').textContent=e.detail.message;});
window.addEventListener('dd-auth',()=>{$('gxValueStatus').textContent='Refresh league to update private roster values for your sign-in.';});
$('gxLeagueSelect').onchange=()=>{const id=$('gxLeagueSelect').value;if(!id)return;const remembered=read('dd-guillotine-leagues-v1',[]).find(x=>String(x.leagueId)===id);try{localStorage.setItem('dd-guillotine-v1',JSON.stringify({id,me:remembered?.focusRosterId??null}));}catch{}$('gxId').value=id;$('gxGo').click();};
$('gxTeamSelect').onchange=()=>{if(!current)return;window.dispatchEvent(new CustomEvent('gx-focus',{detail:{leagueId:current.leagueId,rid:$('gxTeamSelect').value===''?null:Number($('gxTeamSelect').value)}}));};
$('gxRefresh').onclick=()=>{const id=$('gxLeagueSelect').value||$('gxId').value;if(id){$('gxId').value=id;$('gxGo').click();}else{$('gxSetup').open=true;$('gxId').focus();}};
const tabs=[...document.querySelectorAll('[data-gx-sheet]')];
for(const b of tabs){const key=b.dataset.gxSheet;b.innerHTML='<span>'+esc(b.textContent.replace(/\s*New\s*$/,''))+'</span><small>'+descriptions[key]+'</small>';b.setAttribute('aria-controls',document.querySelector('[data-gx-panel="'+key+'"]').id);b.tabIndex=key==='survival'?0:-1;b.addEventListener('keydown',e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].click();tabs[i].focus();});}
function nav(key){$('gxNavHint').textContent=hints[key];for(const b of tabs)b.tabIndex=b.dataset.gxSheet===key?0:-1;}
window.addEventListener('gx-sheet-change',e=>{nav(e.detail.key);route(e.detail.key,current?.leagueId);});
const initial=location.hash.slice(1).split('/')[0];if(descriptions[initial])document.querySelector('[data-gx-sheet="'+initial+'"]').click();
choices();if(window.__GX)ready(window.__GX);else if(read('dd-guillotine-v1',{}).id)begin({detail:{leagueId:read('dd-guillotine-v1',{}).id}});
fetch('/data/nfl-schedule.json',{cache:'no-store',signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(x=>{schedule=x.data.games;deadline();}).catch(()=>{$('gxDeadline').textContent='Kickoff time unavailable. Voting is paused until it can be verified.';});
setInterval(()=>{if(current&&Number.isFinite(window.GX_VOTE_DEADLINE))window.dispatchEvent(new Event('gx-deadline'));},30000);
})();
