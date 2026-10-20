/* Sitewide presentation only. No model, account, permissions or network operations. */
(() => {
  'use strict';
  if (document.querySelector('meta[http-equiv="refresh" i]')) return;
  const page = location.pathname.replace(/\/$/, '/index.html');
  const name = page.split('/').pop();
  const key = 'dd:presentation:v1:' + page;
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
  let mode = 'tldr';
  try { if (localStorage.getItem(key) === 'agent') mode = 'agent'; } catch (_) {}
  const style = document.createElement('style'); style.id = 'dd-presentation-style';
  style.textContent = `
    [data-dd-view="tldr"] [data-dd-agent-only]{display:none!important}
    .dd-presentation{box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 12px;margin:0 auto;max-width:1400px;color:var(--ink-1,#2a1a06);font:14px/1.35 system-ui,sans-serif}
    .dd-presentation button{box-sizing:border-box;font:inherit;min-height:44px;padding:8px 12px;border:1px solid var(--border,#a9957e);border-radius:10px;background:var(--surface-1,#fff7ed);color:var(--ink-1,#2a1a06);cursor:pointer}
    .dd-presentation button[aria-pressed="true"]{background:var(--accent,#ff6a03);color:var(--accent-ink,#211305);font-weight:750;border-color:currentColor}
    .dd-presentation button:focus-visible,.dd-human-help summary:focus-visible{outline:3px solid var(--accent,#ff6a03);outline-offset:3px}
    .dd-agent-summary{flex:1 1 100%;font-size:14px;overflow-wrap:anywhere;border-left:3px solid var(--accent,#ff6a03);padding:8px 12px}
    .dd-agent-summary[hidden]{display:none}.dd-agent-summary p{margin:4px 0}.dd-agent-summary a{display:inline-block;min-height:44px;padding:8px 10px;box-sizing:border-box;color:inherit}
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
  if(caveats[name])humanDetails(document.querySelector('main > .p-disclosure'),caveats[name]+' \u00b7 details',true);
  if(guides[name]){const intro=document.querySelector(guides[name]),section=intro?.closest('section');const help=humanDetails(intro,'How to read this section');if(help && section)section.append(help);}
  const bar = document.createElement('nav'); bar.className = 'dd-presentation';
  bar.setAttribute('aria-label','Page presentation');
  const simple = document.createElement('button'); simple.type='button'; simple.textContent='TL;DR';
  const agent = document.createElement('button'); agent.type='button';
  const robot = document.createElement('span'); robot.setAttribute('aria-hidden','true'); robot.textContent='\u{1F916} ';
  agent.append(robot,document.createTextNode('Agent details'));
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
  bar.append(simple,agent,panel);
  const nav = document.querySelector('.sitenav,header.dd-header');
  const main = document.querySelector('main');
  if(nav)nav.after(bar);else if(main)main.before(bar);else document.body.prepend(bar);
  function render(){
    document.documentElement.setAttribute('data-dd-view',mode);
    simple.setAttribute('aria-pressed',String(mode==='tldr'));
    agent.setAttribute('aria-pressed',String(mode==='agent'));
    agent.setAttribute('aria-expanded',String(mode==='agent'));panel.hidden=mode!=='agent';
  }
  function choose(next){mode=next;try{localStorage.setItem(key,mode);}catch(_){}render();}
  simple.addEventListener('click',()=>choose('tldr'));
  agent.addEventListener('click',()=>choose(mode==='agent'?'tldr':'agent'));
  function revealHash(){
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
    const target=document.getElementById(id);
    if(target && targets.some(el=>el===target || el.contains(target))){mode='agent';render();requestAnimationFrame(()=>target.scrollIntoView());}
    if(target){for(let p=target.parentElement;p;p=p.parentElement)if(p.matches('details.dd-human-help'))p.open=true;}
  }
  render();revealHash();addEventListener('hashchange',revealHash);
})();
