// The prompt is generated into the page from the canonical public playbook.
document.addEventListener('DOMContentLoaded',()=>{
  const button=document.getElementById('dfsCopyStarter');
  if(!button)return;
  button.addEventListener('click',async()=>{
    const text=document.getElementById('dfsStarterText');
    const status=document.getElementById('dfsStarterStatus');
    try{
      await navigator.clipboard.writeText(text.value);
      status.textContent='Copied. Paste into your AI with your workspace name and contest screenshots.';
      document.getElementById('dfsStarterFallback').hidden=true;
    }catch{
      document.getElementById('dfsStarterFallback').hidden=false;
      text.focus();text.select();
      status.textContent='Copy is unavailable in this browser. Select and copy the instruction below.';
    }
  });
});
