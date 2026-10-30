// Enhancement only: the full dated menu is readable without JavaScript or network.
(() => {
  window.DD_BOTCTX={label:'PUBLISHED BOZO MENU',sys:'This page is a dated static copy of saved research, not live odds or submitted picks. State its actual week, revision, source timestamps and copy-check time. Return all candidates when asked for the full menu; keep held and scratched candidates clearly labeled. A recent copy-check time does not make old research current. Never claim a bet is available without rechecking.'};
  const note=document.getElementById('snapshotNotice');
  if(note){const age=Date.now()-Date.parse(note.dataset.checkedAt);if(age>2*3600000)note.prepend('COPY MAY BE OUT OF DATE: last checked '+Math.floor(age/3600000)+' hours ago. ');}
  const week=new URLSearchParams(location.search).get('week');
  // Preserve old browser archive links, but navigate only to a published local archive.
  if(week && /^\d{4}-\d{2}-\d{2}$/.test(week)){
    const path='/bozo-menu/'+week+'.html';
    if(location.pathname!==path && [...document.querySelectorAll('nav[aria-label="Published weeks"] a')].some(a=>a.getAttribute('href')===path))location.replace(path);
  }
})();
