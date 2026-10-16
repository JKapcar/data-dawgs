// Disclosure navigation only; no identity or network operations.
(() => {
 const shell=document.querySelector('.dd-shell');if(!shell)return;
 const menus=[...shell.querySelectorAll('details')];
 shell.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const open=event.target.closest('details[open]')||menus.find(m=>m.open);if(open){open.open=false;open.querySelector('summary').focus();event.preventDefault();event.stopPropagation();}});
 shell.addEventListener('click',event=>{if(event.target.closest('#methods'))menus.forEach(m=>{m.open=false;});});
 document.addEventListener('click',event=>{if(!shell.contains(event.target))menus.forEach(m=>{m.open=false;});});
})();
