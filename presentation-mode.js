/* Sitewide presentation only. No model, account, permissions or network operations. */
(() => {
  'use strict';
  if (document.querySelector('meta[http-equiv="refresh" i]')) return;
  const page = location.pathname.replace(/\/$/, '/index.html');
  const name = page.split('/').pop();
  const key = 'dd:presentation:v1:' + page;
  let mode = 'tldr';
  try { if (localStorage.getItem(key) === 'agent') mode = 'agent'; } catch (_) {}
  // This script runs in the head. Restore the choice before the page can paint.
  document.documentElement.setAttribute('data-dd-view',mode);
  document.documentElement.setAttribute('data-dd-page',name);
  function mount(){
  const sections = { 'arena.html':['machines'], 'calculators.html':['machines'],
    'data.html':['machines'], 'dawghouse.html':['machines'], 'nfl.html':['machines'],
    'teamdraft.html':['machines'], 'weather.html':['machines'],
    'ai.html':['surfaces'], 'markets.html':['surfaces'] };
  // Explicitly reviewed introductory copy; selected warnings use separate human disclosures. Forms and consent are excluded.
  const compact = new Set(['arena.html','calculators.html','data.html','nfl.html','ai.html','markets.html','teamdraft.html']);
  const caveats = {'arena.html':'Unproven tools \u00b7 dated inputs', 'nfl.html':'Dated, descriptive data \u00b7 no proven returns', 'data.html':'Listed does not mean current or verified', 'calculators.html':'Input assumptions apply \u00b7 no proven returns', 'ai.html':'No model grades here \u00b7 limits', 'markets.html':'No proven returns \u00b7 not advice'};
  const guides = {'arena.html':'#games > header .dek', 'nfl.html':'#live > header .dek', 'data.html':'#shelves > header .dek', 'calculators.html':'#calculators > header .dek'};
  const targets = (sections[name] || []).map(id => document.getElementById(id)).filter(Boolean);
  targets.forEach(el => el.setAttribute('data-dd-agent-only',''));

  const style = document.createElement('style'); style.id = 'dd-presentation-style';
  style.textContent = `
[data-dd-view="tldr"][data-dd-page="arena.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="calculators.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="data.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="dawghouse.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="nfl.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="teamdraft.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="weather.html"] #machines{display:none!important}
[data-dd-view="tldr"][data-dd-page="ai.html"] #surfaces{display:none!important}
[data-dd-view="tldr"][data-dd-page="markets.html"] #surfaces{display:none!important}
    [data-dd-view="tldr"] [data-dd-agent-only]{display:none!important}
    .dd-presentation{position:relative;flex:0 0 auto;margin-left:auto;color:var(--ink-1,#2a1a06);font:14px/1.35 system-ui,sans-serif}
    .dd-presentation>summary{list-style:none;cursor:pointer;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;padding:0 6px;box-sizing:border-box;font-weight:650}
    .dd-presentation>summary::-webkit-details-marker{display:none}
    .dd-view-menu{position:absolute;right:0;top:100%;z-index:10000;box-sizing:border-box;width:300px;max-width:calc(100vw - 24px);padding:12px;border:1px solid var(--border,#a9957e);border-radius:12px;background:var(--surface-1,#fff7ed);box-shadow:0 8px 30px #0003;color:var(--ink-1,#2a1a06)}
    .dd-presentation button{display:block;width:100%;text-align:left;box-sizing:border-box;font:inherit;min-height:44px;padding:8px 12px;border:1px solid var(--border,#a9957e);border-radius:8px;background:var(--surface-1,#fff7ed);color:var(--ink-1,#2a1a06);cursor:pointer;margin:4px 0}
    .dd-presentation button[aria-pressed="true"]{background:var(--accent,#ff6a03);color:var(--accent-ink,#211305);font-weight:750;border-color:currentColor}
    .dd-presentation :focus-visible,.dd-human-help summary:focus-visible{outline:3px solid var(--accent,#ff6a03);outline-offset:2px}
    .dd-agent-summary{font-size:14px;overflow-wrap:anywhere;padding:8px 0;max-height:45vh;overflow:auto}
    .dd-agent-summary[hidden]{display:none}.dd-agent-summary p{margin:4px 0}.dd-agent-summary a{display:block;min-height:44px;padding:8px 10px;box-sizing:border-box;color:inherit}
    .dd-presentation-fallback{display:flex;justify-content:flex-end;padding:0 12px}
    @media(max-width:760px){.dd-view-menu{position:fixed;top:70px;right:12px}.dd-presentation>summary{font-size:12px}}
    .dd-human-help{margin:4px 0 8px}.dd-human-help>summary{cursor:pointer;min-height:44px;box-sizing:border-box;padding:10px 0;font:600 14px/1.5 system-ui,sans-serif;color:var(--ink-2,inherit)}
    .dd-human-warning{border-left:3px solid var(--warn,#ab6600);padding-left:10px}.dd-human-warning>summary{font-weight:750}.dd-human-warning .p-disclosure{margin:4px 0}
    .dd-human-help>.p-lead{font-size:16px!important;margin:8px 0!important}
    [data-dd-compact] .p-jump{margin:8px 0 12px;gap:6px}
    [data-dd-compact] .p-section{margin:16px 0}
    [data-dd-compact] .p-section>header{margin-bottom:8px;padding-bottom:6px}
    [data-dd-compact] .dd-human-help{margin:2px 0}
    [data-dd-compact] .p-hero{padding-top:4px;max-width:none}
    [data-dd-compact] .p-hero h1{font-size:clamp(24px,4vw,36px);margin:6px 0;line-height:1.15}
    [data-dd-compact][data-dd-view="tldr"] .p-hero .p-kicker{display:none}
    [data-dd-compact] .p-hero .p-kicker{font-size:10px;letter-spacing:.04em}
    @media(max-width:600px){.dd-presentation{padding:4px 12px}[data-dd-compact] main{padding-top:6px}}
    @media print{.dd-presentation{display:none}[data-dd-view="tldr"] [data-dd-agent-only]{display:block!important}}
`;
  const policy=document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content || '';
  const styles=policy.match(/style-src\s+([^;]+)/)?.[1];
  if(styles && !styles.includes("'unsafe-inline'")){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/presentation-mode.css';document.head.append(link);
  }else document.head.append(style);
  if (compact.has(name)) {
    document.documentElement.setAttribute('data-dd-compact','');
    document.querySelectorAll('main .p-hero > .p-lead').forEach(p => {
      if (p.querySelector('input,button,select,textarea,[role="status"],[role="alert"]')) return;
      const help = document.createElement('details'); help.className = 'dd-human-help';
      const summary = document.createElement('summary'); summary.textContent = 'About this page';
      p.before(help); help.append(summary,p);
    });
  }
  function humanDetails(el,label,warning=false){
    if(!el || el.querySelector('input,button,select,textarea,[role="alert"],[role="status"]'))return;
    const detail=document.createElement('details');detail.className='dd-human-help'+(warning?' dd-human-warning':'');
    const summary=document.createElement('summary');summary.textContent=label;
    el.before(detail);detail.append(summary,el);return detail;
  }
  // Essential warnings remain visible in both modes; only explanatory help collapses.
  if(guides[name]){const intro=document.querySelector(guides[name]),section=intro?.closest('section');const help=humanDetails(intro,'How to read this section');if(help && section)section.append(help);}
  const bar = document.createElement('details'); bar.className = 'dd-presentation';
  const summary=document.createElement('summary');summary.textContent='View';
  summary.setAttribute('aria-label','View options');
  const menu=document.createElement('div');menu.className='dd-view-menu';
  menu.setAttribute('role','group');menu.setAttribute('aria-label','Page presentation');
  const simple = document.createElement('button'); simple.type='button'; simple.textContent='TL;DR';
  const agent = document.createElement('button'); agent.type='button';
  agent.textContent='AI / technical details';
  const panel = document.createElement('div'); panel.id='dd-agent-summary';panel.className='dd-agent-summary';
  const note = document.createElement('p'); note.textContent=targets.length ? 'Technical sections are shown. Human help and warnings stay available in both views.' : 'No separate agent instructions on this page. Human help and controls stay in the page.';
  panel.append(note);
  targets.forEach(el => {const a=document.createElement('a');a.href='#'+el.id;a.textContent=(el.querySelector('h2')?.textContent || 'Technical section').trim();panel.append(a);});
  // Use existing explicit machine links only; never invent a capability or endpoint.
  const seen = new Set();
  document.querySelectorAll('a.udmach[href],footer a[href="/llms.txt"],footer a[href="llms.txt"]').forEach(link=>{
    if(seen.has(link.href))return;seen.add(link.href);
    const a=link.cloneNode(true);a.removeAttribute('id');a.textContent=link.getAttribute('href');panel.append(a);
  });
  const controlled = ['dd-agent-summary',...targets.map(el=>el.id)].join(' ');
  agent.setAttribute('aria-controls',controlled);
  menu.append(simple,agent,panel);bar.append(summary,menu);
  const nav = document.querySelector('.sitenav,header.dd-header');
  const main = document.querySelector('main');
  if(nav){
    const links=nav.querySelector('.links') || nav;
    const overflow=[...links.querySelectorAll('.grpmenu')].at(-1);
    const narrow=matchMedia('(max-width:760px)');
    const place=()=>{bar.open=false;(narrow.matches && overflow ? overflow : links).append(bar);};
    place();narrow.addEventListener('change',place);
  }
  else {const fallback=document.createElement('div');fallback.className='dd-presentation-fallback';fallback.append(bar);if(main)main.before(fallback);else document.body.prepend(fallback);}
  bar.addEventListener('click',event=>event.stopPropagation());
  bar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();bar.open=false;summary.focus();}});
  document.addEventListener('click',event=>{if(!bar.contains(event.target))bar.open=false;});
  function render(){
    document.documentElement.setAttribute('data-dd-view',mode);
    simple.setAttribute('aria-pressed',String(mode==='tldr'));
    agent.setAttribute('aria-pressed',String(mode==='agent'));
    agent.setAttribute('aria-expanded',String(mode==='agent'));panel.hidden=mode!=='agent';
  }
  function choose(next){mode=next;try{localStorage.setItem(key,mode);}catch(_){}render();}
  simple.addEventListener('click',()=>choose('tldr'));
  agent.addEventListener('click',()=>choose('agent'));
  function revealHash(){
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
    const target=document.getElementById(id);
    if(target && targets.some(el=>el===target || el.contains(target))){mode='agent';render();requestAnimationFrame(()=>target.scrollIntoView());}
    if(target){for(let p=target.parentElement;p;p=p.parentElement)if(p.matches('details.dd-human-help'))p.open=true;}
  }
  render();revealHash();addEventListener('hashchange',revealHash);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
