// Install help only: no accounts, network calls, storage, or automatic prompts.
(() => {
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(standalone()||document.getElementById('dd-install-entry'))return;
 let installEvent=null;
 const entry=document.createElement('button');entry.id='dd-install-entry';entry.type='button';entry.className='dd-install-button';entry.textContent='Install Data Dawgs';
 const dialog=document.createElement('dialog');dialog.id='dd-install-help';dialog.setAttribute('aria-labelledby','dd-install-title');
 const title=document.createElement('h2');title.id='dd-install-title';title.textContent='Install Data Dawgs';
 const intro=document.createElement('p');intro.textContent='Keep Data Dawgs on your Home Screen. The website opens as an app.';
 const steps=document.createElement('ol'),note=document.createElement('p'),install=document.createElement('button'),close=document.createElement('button');install.type=close.type='button';install.className=close.className='dd-install-button';install.textContent='Open install prompt';close.textContent='Close';note.setAttribute('role','status');
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),android=/Android/.test(navigator.userAgent);
 const instructions=ios?['Open datadawgs216.com in Safari.','Tap Share. If it is inside the Page Menu, open that menu first.','Choose Add to Home Screen. If missing, scroll down and use Edit Actions to add it.','Turn on Open as Web App if shown, then tap Add.']:android?['Open datadawgs216.com in Chrome.','Use the install button here when available, or open Chrome’s menu.','Choose Install app or Add to Home screen, then follow the browser prompts.']:['Open this site in your browser.','Look for Install in the address bar or browser menu.','If installation is unavailable, bookmark the site instead.'];
 for(const text of instructions){const li=document.createElement('li');li.textContent=text;steps.append(li);}
 const actions=document.createElement('div');actions.className='dd-install-actions';actions.append(install,close);dialog.append(title,intro,steps,note,actions);document.body.append(dialog);
 const menu=document.querySelector('.dd-app-menu'),foot=document.querySelector('.udfoot');
 if(menu)menu.append(entry);else if(foot)foot.append(entry);else{const row=document.createElement('div');row.className='dd-install-footer';row.append(entry);document.body.append(row);}
 function refresh(){entry.hidden=standalone();install.hidden=!installEvent||ios;}
 window.addEventListener('beforeinstallprompt',event=>{if(standalone())return;event.preventDefault();installEvent=event;refresh();});
 window.addEventListener('appinstalled',()=>{installEvent=null;entry.hidden=true;if(dialog.open)dialog.close();});
 matchMedia('(display-mode: standalone)').addEventListener('change',refresh);
 entry.onclick=()=>{refresh();note.textContent='';dialog.showModal();close.focus();};close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(!entry.hidden){requestAnimationFrame(()=>{const menu=entry.closest('details');const target=menu&&!menu.open?menu.querySelector('summary'):entry;target?.focus();});}});
 install.onclick=async()=>{const event=installEvent;if(!event)return;installEvent=null;refresh();try{await event.prompt();const result=await event.userChoice;note.textContent=result.outcome==='accepted'?'Installation requested. Follow your browser to finish.':'You can install later from your browser menu.';}catch{note.textContent='Use your browser menu and the steps above.';}};
 refresh();
})();
