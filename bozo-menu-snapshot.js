// Enhancement only: the full dated menu is readable without JavaScript or network.
(() => {
  window.DD_BOTCTX={label:'PUBLISHED BOZO MENU',sys:'This page shows published saved research with a dated static fallback, not live odds or submitted picks. State its actual displayed week, revision, source timestamps and publisher-check or copy-check time. Return all candidates when asked for the full menu; keep held and scratched candidates clearly labeled. A recent copy-check time does not make old research current. Never claim a bet is available without rechecking.'};
  const note=document.getElementById('snapshotNotice');
  if(note){const age=Date.now()-Date.parse(note.dataset.checkedAt);if(age>2*3600000)note.prepend('COPY MAY BE OUT OF DATE: last checked '+Math.floor(age/3600000)+' hours ago. ');}
  const week=new URLSearchParams(location.search).get('week');
  // Preserve old browser archive links, but navigate only to a published local archive.
  if(week && /^\d{4}-\d{2}-\d{2}$/.test(week)){
    const path='/bozo-menu/'+week+'.html';
    if(location.pathname!==path && [...document.querySelectorAll('nav[aria-label="Published weeks"] a')].some(a=>a.getAttribute('href')===path))location.replace(path);
  }
  // Read the publisher directly: GitHub cron is a backup copy, not a freshness guarantee.
  // Keep the complete static document if the public source or module is unavailable.
  const archive=location.pathname.match(/^\/bozo-menu\/(\d{4}-\d{2}-\d{2})\.html$/);
  const requested=archive?.[1] || (week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : '');
  const source='https://toto.jkapcar4.workers.dev/bozo/menu.json'+(requested?'?week='+requested:'');
  let busy=false;
  let lastNotice=note?.textContent || '';
  const initial=document.querySelector('h1')?.nextElementSibling?.textContent?.match(/Week beginning (\d{4}-\d{2}-\d{2}) · revision (\d+)/);
  let displayed=initial?{week:initial[1],revision:Number(initial[2])}:null;
  async function refresh(){
    if(busy)return;
    busy=true;
    try{
      const response=await fetch(source,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw Error('source unavailable');
      const menu=await response.json();
      if(menu.status!=='published' || !/^\d{4}-\d{2}-\d{2}$/.test(menu.week) || (requested && menu.week!==requested) || !Number.isInteger(menu.revision) || menu.revision<1 || !Array.isArray(menu.candidates) || menu.candidates.length>200 || !Array.isArray(menu.published_weeks))throw Error('invalid public menu');
      if(displayed && (menu.week<displayed.week && !requested || menu.week===displayed.week && menu.revision<displayed.revision))throw Error('publisher regressed');
      if(note.dataset.live!=='true' || menu.week!==displayed?.week || menu.revision!==displayed?.revision){
      const {renderPublicMenu}=await import('/bozo-menu.mjs');
      const fresh=new DOMParser().parseFromString(renderPublicMenu(menu),'text/html');
      // Replace only data-bearing content, preserving installed-page helpers and scripts.
      const currentHeading=document.querySelector('h1');
      const currentMain=document.querySelector('main');
      const oldParagraphs=[];
      for(let el=currentHeading.nextElementSibling;el?.tagName==='P';el=el.nextElementSibling)oldParagraphs.push(el);
      currentHeading.replaceWith(fresh.querySelector('h1'));
      oldParagraphs.forEach(el=>el.remove());
      let previous=document.querySelector('h1');
      for(const el of [...fresh.body.children].filter(el=>el.tagName==='P')){previous.after(el);previous=el;}
      currentMain.replaceWith(fresh.querySelector('main'));
      const formats=document.querySelector('nav[aria-label="Menu formats"]');
      formats.replaceChildren();
      for(const [label,url] of [['Readable HTML',location.pathname+location.search],['Current publisher text',source.replace('/menu.json','/menu.md')],['Current publisher JSON',source],['Latest menu','/bozo-menu.html']]){
        const a=document.createElement('a');a.textContent=label;a.href=url;formats.append(a);
      }
      const weeks=document.querySelector('nav[aria-label="Published weeks"]');weeks.replaceChildren();
      for(const w of menu.published_weeks){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(w.week))continue;
        const a=document.createElement('a');a.textContent=w.week;a.href='/bozo-menu.html?week='+w.week;weeks.append(a);
      }
      }
      note.textContent='Publisher checked '+new Date().toISOString()+'. Showing published week '+menu.week+', revision '+menu.revision+'. Saved research observations, not live odds or available bets. Holds and scratches are not active recommendations.';
      note.dataset.live='true';
      lastNotice=note.textContent;
      displayed={week:menu.week,revision:menu.revision};
      const link=note.parentElement.querySelector('a');if(link)link.href=source;
    }catch{
      if(note)note.textContent=(note.dataset.live==='true'?'Publisher recheck failed. Retaining the last verified display. ':'Publisher check failed. Showing the dated static copy, which may be behind the publisher. ')+lastNotice;
    }finally{busy=false;}
  }
  refresh();
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
