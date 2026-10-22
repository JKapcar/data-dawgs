// Local synthetic browser evidence. Every non-GET is blocked, all external reads mocked.
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const base=cp.execFileSync('git',['show','b03169b2:bozo.html'],{cwd:root,encoding:'utf8',maxBuffer:4e6});
const league={id:'main',name:'Synthetic board',manager:'Fixture',members:['Fixture','Other'],size:2,week:1,status:'open',settings:{stake:50,format:'standard',synthetic:true}};
const state={name:'Synthetic board',week:1,season:2026,status:'open',members:{Fixture:true,Other:true},settings:league.settings,picks:{},results:{}};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const results=[];
 for(const version of ['baseline','patched'])for(const route of ['hub','main','royale','hub-slow-directory'])for(const signedIn of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.addInitScript(({signedIn})=>{window.EventSource=undefined;if(signedIn)localStorage.setItem('dd-bozo-sess',btoa(JSON.stringify({n:'Fixture',e:Date.now()+3600000}))+'.synthetic');},{signedIn});
  let boardAt=null,directoryAt=null;const errors=[];
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const started=Date.now();
  await context.route('**/*',async r=>{
   const req=r.request(),u=new URL(req.url());if(req.method()!=='GET')return r.fulfill({status:403,json:{error:'Synthetic fixture blocks all writes'}});
   if(u.hostname==='toto.jkapcar4.workers.dev'){
    if(u.pathname==='/auth/roster'){await new Promise(resolve=>setTimeout(resolve,1800));return r.fulfill({json:{players:[]}});}
    if(u.pathname==='/league/list'){directoryAt=Date.now()-started;if(route==='hub-slow-directory')await new Promise(resolve=>setTimeout(resolve,1800));return r.fulfill({json:{defaultLeague:'main',leagues:[league,{...league,id:'royale',name:'Synthetic Royale',settings:{...league.settings,format:'royale'}}]}});}
    return r.fulfill({json:{legs:[],players:[],games:[],events:[],data:[]}});
   }
   if(u.hostname.includes('firebaseio.com')){boardAt=Date.now()-started;return r.fulfill({json:{...state,settings:{...state.settings,format:u.pathname.includes('royale')?'royale':'standard'}}});}
   if(u.origin!=='http://preview.local')return r.fulfill({json:{events:[],data:[]}});
   const p=path.join(root,u.pathname);if(!fs.existsSync(p))return r.fulfill({status:404,body:''});
   if(u.pathname==='/bozo.html')return r.fulfill({contentType:'text/html',body:version==='baseline'?base:fs.readFileSync(p,'utf8')});
   return r.fulfill({path:p});
  });
  await page.goto('http://preview.local/bozo.html'+(route.startsWith('hub')?'':'?l='+route),{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(700);
  const early=await page.evaluate(()=>({hasMembers:!!S.members,directory:LEAGUES.length,ticket:document.getElementById('houseSlip').textContent,view:document.documentElement.dataset.ddView}));
  if(version==='patched'){assert.equal(early.hasMembers,true,route);assert.equal(early.directory,route==='hub-slow-directory'?0:2,route);assert.doesNotMatch(early.ticket,/not reachable|no board loaded/);}
  await page.waitForTimeout(1500);
  const final=await page.evaluate(()=>({hasMembers:!!S.members,directory:LEAGUES.length}));assert.equal(final.hasMembers,true);
  results.push({version,route,signedIn,boardRequestMs:boardAt,directoryRequestMs:directoryAt,at700ms:early,errors});
  assert.deepEqual(errors,[]);
  await context.close();
 }
 fs.mkdirSync(path.join(root,'work/artifacts/bozo-loading'),{recursive:true});fs.writeFileSync(path.join(root,'work/artifacts/bozo-loading/timings.json'),JSON.stringify({scope:'Synthetic 390px Chromium, local assets, roster delayed 1800ms, SW blocked. Not real mobile or production latency.',results},null,2));
 await browser.close();console.log(JSON.stringify(results.map(({version,route,signedIn,boardRequestMs,at700ms})=>({version,route,signedIn,boardRequestMs,readyAt700ms:at700ms.hasMembers})),null,2));
})().catch(e=>{console.error(e);process.exit(1)});
