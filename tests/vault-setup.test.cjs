const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('sharing and MCP remain closed; conflicting credentials cannot reach owner storage',async()=>{
 const worker=(await import('../dawg-bot-worker.js')).default;let touched=0;const env={VAULT_ENABLED:'true',VAULT_SHARING_ENABLED:'true',VAULT_OWNER_UID:'u_owner',VAULT_BUCKET:new Proxy({},{get(){touched++;throw Error('must not touch storage');}})};
 for(const path of ['/api/vault','/api/vault/access','/mcp/vault'])for(const op of ['list','read','stage_upload','stage_delete','commit','invite','accept','create_ai','set_permissions','revoke']){
  const r=await worker.fetch(new Request('https://worker.test'+path,{method:'POST',headers:{'X-Dawg-Session':'fixture',Authorization:'Bearer fixture'},body:JSON.stringify({op,args:{}})}),env);assert.equal(r.status,503);assert.match(r.headers.get('cache-control'),/private, no-store/);
 }assert.equal(touched,0);
});
test('phone setup copies only server-verified UID; no file or sharing requests are made',async()=>{
 const elements=new Map(),events={},el=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',focus(){},select(){}});return elements.get(id);};let copied,calls=0;
 const c={document:{getElementById:el,addEventListener(){}},window:{addEventListener:(e,f)=>events[e]=f},localStorage:{getItem:()=> 'fixture'},navigator:{clipboard:{writeText:async v=>copied=v}},fetch:async(url,o)=>{calls++;assert.equal(url,'https://toto.jkapcar4.workers.dev/auth/self');assert.equal(o.cache,'no-store');return new Response(JSON.stringify({uid:'u_verified'}));}};vm.createContext(c);vm.runInContext(fs.readFileSync('vault-setup.js','utf8').replace(/start\(\);\s*$/,'this.ready=start();'),c);await c.ready;assert.equal(el('accountId').value,'u_verified');await el('copyAccountId').onclick();assert.equal(copied,'u_verified');assert.equal(calls,1);events.pagehide();assert.equal(el('accountId').value,'');
});
