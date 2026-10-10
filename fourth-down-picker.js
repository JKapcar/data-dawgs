/* Game and play picker for the Fourth Down Lab.
 * A stranger lands on a real fourth down from the delayed weekly snapshot, sees the
 * other games and plays, and taps through them. The hand-entry form is the fallback.
 * Pure helpers are exported for node tests; create() wires the DOM. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DDFourthPicker=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LABEL={go:'Go for it',fg:'Field goal',punt:'Punt'},SHORT={go:'Go',fg:'FG',punt:'Punt'};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- pure helpers ---------- */
  function phase(g){
    const s=String(g?.status||'');
    if(/final/i.test(s))return 'final';
    if(/scheduled/i.test(s))return 'scheduled';
    if(g?.refresh_error&&!(g.decisions||[]).length)return 'error';
    return (g?.decisions||[]).length||g?.captured_at?'live':'scheduled';
  }
  const defense=(g,d)=>d.offense===g.home?g.away:g.home;
  function spot(input,off,def){const y=Number(input.yardline);return y===50?'midfield':y>50?`${off} ${100-y}`:`${def} ${y}`;}
  function score(diff,off){return diff>0?`${off} up ${diff}`:diff<0?`${off} down ${-diff}`:'tied';}
  function down(input){return `4th & ${Number(input.toGo)>=Number(input.yardline)?'goal':input.toGo}`;}
  /* Win probability the coach's choice gave up versus the best available one, in pp. */
  function cost(d){
    const r=d?.result;if(!r||!d.actual)return null;
    const a=r.choices.find(c=>c.id===d.actual);if(a?.wp==null)return null;
    return Math.max(0,100*(Math.max(...r.choices.filter(c=>c.wp!==null).map(c=>c.wp))-a.wp));
  }
  function verdict(d){
    const r=d?.result;
    if(!r)return {kind:'none',bot:null,coach:d?.actual||null,cost:null,edge:null};
    const c=cost(d),edge=r.edge;
    const kind=!d.actual?'unknown':d.actual===r.best?'agree':c==null?'unknown':c<1?'close':'miss';
    return {kind,bot:r.best,coach:d.actual||null,cost:c,edge};
  }
  const chrono=(a,b)=>a.d.input.qtr-b.d.input.qtr||b.d.input.seconds-a.d.input.seconds;
  function rows(env,gameId){
    const out=[];(env?.data?.games||[]).forEach((g,gi)=>{if(gameId!=='all'&&g.id!==gameId)return;(g.decisions||[]).forEach(d=>out.push({g,d,gi}));});
    return out;
  }
  function order(list,sort){
    const a=[...list];
    if(sort==='miss')return a.sort((x,y)=>(cost(y.d)??-1)-(cost(x.d)??-1)||(y.d.result?.edge??-1)-(x.d.result?.edge??-1)||x.gi-y.gi||chrono(x,y));
    return a.sort((x,y)=>x.gi-y.gi||chrono(x,y));
  }
  /* Captured games first (live, then most recent finals), uncaptured last. */
  function games(env){
    const rank={live:0,final:1,error:2,scheduled:3};
    return (env?.data?.games||[]).map((g,i)=>({g,i,p:phase(g)})).sort((a,b)=>{
      const ha=+!(a.g.decisions||[]).length,hb=+!(b.g.decisions||[]).length;
      return ha-hb||rank[a.p]-rank[b.p]||(a.p==='scheduled'?String(a.g.date).localeCompare(String(b.g.date)):String(b.g.date).localeCompare(String(a.g.date)))||a.i-b.i;
    }).map(x=>x.g);
  }
  /* The play a game opens on: the latest one while it is live, otherwise the biggest
     coach-versus-model disagreement (then the strongest call). */
  function featured(list){
    if(!list.length)return null;
    const live=list.filter(x=>phase(x.g)==='live');
    if(live.length)return [...live].sort((a,b)=>-chrono(a,b))[0];
    return order(list,'miss')[0];
  }
  /* Which week, game and play the page opens on. feeds: [[key, env], ...] in priority order. */
  function defaultPick(feeds){
    for(const [key,env] of feeds){
      const all=rows(env,'all');if(!all.length)continue;
      const live=all.filter(x=>phase(x.g)==='live');
      const pick=featured(live.length?live:all);
      return {week:key,gameId:pick.g.id,playId:pick.d.id};
    }
    return null;
  }
  function find(feeds,playId){
    for(const [key,env] of feeds)for(const g of env?.data?.games||[])for(const d of g.decisions||[])if(String(d.id)===String(playId))return {week:key,gameId:g.id,playId:d.id};
    return null;
  }
  function dayLabel(date){
    const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(String(date||''));if(!m)return '';
    return new Date(+m[1],m[2]-1,+m[3]).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  }
  /* A 100-yard strip, offense always driving right: ball and line to gain. */
  function field(input){
    const ball=10+(100-Number(input.yardline)),line=Math.min(110,ball+Number(input.toGo));
    let s='<svg class="fd-mini-field" viewBox="0 0 120 12" aria-hidden="true" focusable="false" preserveAspectRatio="none"><rect x="0" y="0" width="120" height="12" rx="2" class="fd-mf-turf"/><rect x="0" y="0" width="10" height="12" class="fd-mf-end"/><rect x="110" y="0" width="10" height="12" class="fd-mf-end fd-mf-goal"/>';
    for(let x=20;x<110;x+=10)s+=`<line x1="${x}" y1="0" x2="${x}" y2="12" class="fd-mf-yard"/>`;
    return s+`<line x1="${line}" y1="0" x2="${line}" y2="12" class="fd-mf-gain"/><circle cx="${ball}" cy="6" r="3.4" class="fd-mf-ball"/></svg>`;
  }

  /* ---------- DOM ---------- */
  function create({onPick,onBrowse}={}){
    const $=id=>document.getElementById(id);
    const feeds={current:null,previous:null};
    let week=null,game=null,sort='game',sel=null,edited=false,last=null,upcoming=false;
    const envOf=k=>feeds[k];
    const ordered=()=>feeds[week]?order(rows(feeds[week],game),sort):[];
    const list=()=>[['current',feeds.current],['previous',feeds.previous]].filter(([,e])=>e);
    function lookup(s){
      const env=s&&envOf(s.week);if(!env)return null;
      const g=env.data.games.find(x=>x.id===s.gameId),d=g?.decisions.find(x=>String(x.id)===String(s.playId));
      return g&&d?{g,d,env}:null;
    }
    function info(){
      const hit=lookup(sel);if(!hit)return null;
      const seq=ordered(),i=seq.findIndex(x=>x.d===hit.d);
      return {week:sel.week,season:hit.env.data.season,weekNumber:hit.env.data.week,game:hit.g,decision:hit.d,
        matchup:`${hit.g.away} @ ${hit.g.home}`,index:i,count:seq.length,view:game==='all'?'all':'game',sort,
        captured:hit.g.captured_at||hit.env.data.refreshed_at,frozen:sel.week==='previous'};
    }
    function pick(s,{silent=false,scroll=true,source='code'}={}){
      if(!lookup(s))return false;
      sel={...s};last={...s};edited=false;
      if(week!==s.week){week=s.week;game=s.gameId;sort='game';upcoming=false;}
      else if(game!=='all'&&game!==s.gameId){game=s.gameId;}
      render(scroll);
      if(!silent)onPick?.(info(),source);
      return true;
    }
    function openGame(id){
      game=id;sort=id==='all'?'miss':'game';
      const f=featured(rows(feeds[week],id));
      if(f)pick({week,gameId:f.g.id,playId:f.d.id},{source:'game'});else{render();onBrowse?.();}
    }
    function openWeek(k){
      if(!feeds[k])return;week=k;upcoming=false;
      const d=defaultPick([[k,feeds[k]]]);
      if(d){game=d.gameId;sort='game';pick(d,{source:'game'});}else{game=games(feeds[k])[0]?.id??'all';render();}
    }
    function status(){
      const el=$('fd-feed-status');if(!el)return;
      const env=feeds[week];
      if(!env){el.textContent=feeds.current===null&&feeds.previous===null?'Loading this week’s games…':'';el.classList.remove('fd-stale');return;}
      const when=new Date(env.data.refreshed_at),age=Date.now()-when;
      if(week==='previous'){el.textContent=`Week ${env.data.week} · frozen capture from ${when.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ESPN play-by-play`;el.classList.remove('fd-stale');return;}
      const active=env.data.games.some(g=>phase(g)==='live');
      const stale=!Number.isFinite(age)||age>24*3600e3||(active&&age>30*60e3);
      el.textContent=`${stale?'Stale snapshot · ':''}Week ${env.data.week} · captured ${when.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})} · delayed ESPN play-by-play, not a live feed`;
      el.classList.toggle('fd-stale',stale);el.setAttribute('role',stale?'alert':'status');
    }
    function renderWeeks(){
      const el=$('fd-weeks');if(!el)return;
      const ks=list().filter(([,e])=>e.data.games.length);
      el.hidden=ks.length<2;
      el.innerHTML=ks.map(([k,e])=>{const n=rows(e,'all').length;return `<button type="button" data-week="${k}" aria-pressed="${k===week}">Week ${e.data.week}<small>${n?n+' fourth down'+(n===1?'':'s'):'no plays yet'}</small></button>`;}).join('');
    }
    function renderGames(){
      const el=$('fd-games');if(!el)return;const env=feeds[week];
      if(!env){el.innerHTML='';return;}
      const all=rows(env,'all').length,list=games(env);
      // Games with nothing captured yet fold into one chip once anything has been played.
      const waiting=list.filter(g=>!(g.decisions||[]).length&&phase(g)==='scheduled');
      const fold=!upcoming&&all>0&&waiting.length>=3&&!waiting.some(g=>g.id===game);
      const chips=(fold?list.filter(g=>!waiting.includes(g)):list).map(g=>{
        const p=phase(g),n=(g.decisions||[]).length,sc=g.homeScore!=null&&p!=='scheduled';
        const meta=p==='scheduled'?(week==='previous'?'Not captured':dayLabel(g.date)||'Scheduled'):p==='error'?'Feed delayed':`${p==='live'?'Live':'Final'} · ${n} fourth down${n===1?'':'s'}`;
        return `<button type="button" class="fd-game fd-game-${p}" data-game="${esc(g.id)}" aria-pressed="${game===g.id}"${!n?' data-empty="1"':''}><span class="fd-game-teams"><b>${esc(g.away)}</b>${sc?`<em>${esc(g.awayScore)}</em>`:''}<i>@</i><b>${esc(g.home)}</b>${sc?`<em>${esc(g.homeScore)}</em>`:''}</span><span class="fd-game-meta">${p==='live'?'<span class="fd-live-dot"></span>':''}${esc(meta)}</span></button>`;
      });
      if(all)chips.unshift(`<button type="button" class="fd-game fd-game-all" data-game="all" aria-pressed="${game==='all'}"><span class="fd-game-teams"><b>All games</b></span><span class="fd-game-meta">${all} fourth downs</span></button>`);
      if(fold){const days=[...new Set(waiting.map(g=>dayLabel(g.date).split(/[ ,]/)[0]).filter(Boolean))].join('–');chips.push(`<button type="button" class="fd-game fd-game-more" data-more="1" aria-expanded="false"><span class="fd-game-teams"><b>+${waiting.length} upcoming</b></span><span class="fd-game-meta">${esc(days?'kick off '+days:'not started')}</span></button>`);}
      el.innerHTML=chips.join('');
    }
    function renderPlays(scroll){
      const el=$('fd-plays');if(!el)return;const env=feeds[week];
      const sortEl=$('fd-plays-sort'),title=$('fd-plays-title');
      if(!env){el.innerHTML='<p class="fd-plays-empty">Loading fourth downs…</p>';if(sortEl)sortEl.hidden=true;return;}
      const g=game==='all'?null:env.data.games.find(x=>x.id===game),seq=ordered();
      if(title)title.textContent=g?`${g.away} @ ${g.home}`:game==='all'?`All week ${env.data.week} games`:'';
      if(sortEl){sortEl.hidden=seq.length<2;sortEl.querySelectorAll('[data-sort]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.sort===sort));}
      if(!seq.length){
        const p=g?phase(g):'scheduled';
        el.innerHTML=`<p class="fd-plays-empty">${p==='error'?`The play-by-play feed for this game is delayed. ${esc(g?.refresh_error?'Its last capture had no fourth downs.':'')}`:week==='previous'?'This game was not captured.':`No fourth downs yet${g?.date?` · kickoff ${esc(dayLabel(g.date))}`:''}. They appear here during the game: the snapshot refreshes about every 15 minutes on game days, when GitHub’s scheduler runs on time.`}</p>`;
        return;
      }
      el.innerHTML=seq.map(({g,d})=>{
        const v=verdict(d),on=sel&&String(sel.playId)===String(d.id)&&sel.week===week,def=defense(g,d);
        const bot=v.kind==='none'?'<span class="fd-bot fd-bot-none">Model unavailable</span>':v.kind==='agree'?`<span class="fd-bot fd-bot-agree">✓ Model agrees</span>`:v.kind==='unknown'?`<span class="fd-bot">Model: ${SHORT[v.bot]}</span>`:v.kind==='close'?`<span class="fd-bot fd-bot-close">Model: ${SHORT[v.bot]} · close call</span>`:`<span class="fd-bot fd-bot-miss">Model: ${SHORT[v.bot]} · −${v.cost.toFixed(1)} pp</span>`;
        return `<button type="button" class="fd-play${on?' is-on':''}${on&&edited?' is-edited':''} fd-play-${v.kind}" data-play="${esc(d.id)}" data-game="${esc(g.id)}"${on?' aria-current="true"':''}>
          <span class="fd-play-top">${game==='all'?`<b>${esc(g.away)} @ ${esc(g.home)}</b> · `:''}Q${d.input.qtr} ${esc(d.clock)} · ${esc(d.offense)} ball</span>
          <span class="fd-play-down">${down(d.input)} at ${esc(spot(d.input,d.offense,def))}</span>
          ${field(d.input)}
          <span class="fd-play-score">${esc(score(d.input.diff,d.offense))}</span>
          <span class="fd-play-calls"><span class="fd-coach">Coach: ${d.actual?SHORT[d.actual]:'unclear'}</span>${bot}</span>
        </button>`;
      }).join('');
      if(scroll){const on=el.querySelector('.is-on');if(on){const box=el.getBoundingClientRect(),r=on.getBoundingClientRect();if(r.left<box.left||r.right>box.right||r.top<box.top||r.bottom>box.bottom){const horizontal=el.scrollWidth>el.clientWidth+4;if(horizontal)el.scrollTo({left:on.offsetLeft-el.offsetLeft-12,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});else el.scrollTo({top:on.offsetTop-el.offsetTop-8,behavior:'auto'});}}}
    }
    function render(scroll=false){renderWeeks();renderGames();renderPlays(scroll);status();}
    // Delegated listeners: the lists re-render on every refresh.
    $('fd-weeks')?.addEventListener('click',e=>{const b=e.target.closest('[data-week]');if(b)openWeek(b.dataset.week);});
    $('fd-games')?.addEventListener('click',e=>{if(e.target.closest('[data-more]')){upcoming=true;renderGames();return;}const b=e.target.closest('[data-game]');if(b)openGame(b.dataset.game);});
    $('fd-plays')?.addEventListener('click',e=>{const b=e.target.closest('[data-play]');if(b)pick({week,gameId:b.dataset.game,playId:b.dataset.play},{scroll:false,source:'play'});});
    $('fd-plays-sort')?.addEventListener('click',e=>{const b=e.target.closest('[data-sort]');if(!b)return;sort=b.dataset.sort;render(true);});
    return {
      setFeed(key,env){
        feeds[key]=env;if(week===null&&env)week=key;
        // Something to browse before anything is picked (a shared hand-built link).
        if(game===null&&week===key&&env){const d=defaultPick([[key,env]]);game=d?d.gameId:(games(env)[0]?.id??'all');}
        if(sel&&!lookup(sel)){sel=null;}render();
      },
      hasFeed:()=>!!(feeds.current||feeds.previous),
      selectDefault(opts){const d=defaultPick(list());return d?pick(d,opts):false;},
      select(playId,opts){const d=find(list(),playId);return d?pick(d,opts):false;},
      reselect(){return last?pick(last):false;},
      hasLast:()=>!!last&&!!lookup(last),
      step(delta){
        const seq=ordered(),i=seq.findIndex(x=>sel&&String(x.d.id)===String(sel.playId));
        const next=seq[i+delta];if(i<0||!next)return false;
        return pick({week,gameId:next.g.id,playId:next.d.id},{source:'step'});
      },
      markEdited(){if(sel&&!edited){edited=true;renderPlays(false);}},
      clear(){sel=null;edited=false;renderPlays(false);},
      current:()=>sel&&!edited?info():null,
      feeds:()=>({current:feeds.current?.data?.refreshed_at??null,previous:feeds.previous?{week:feeds.previous.data.week,refreshed_at:feeds.previous.data.refreshed_at}:null}),
      render
    };
  }
  return {LABEL,SHORT,phase,spot,score,down,cost,verdict,rows,order,games,featured,defaultPick,find,field,dayLabel,create};
});
