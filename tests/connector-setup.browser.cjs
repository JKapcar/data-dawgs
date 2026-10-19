// All accounts, sessions and credentials below are synthetic; external requests are intercepted.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.CONNECTOR_PREVIEW;
const endpoint='https://toto.jkapcar4.workers.dev/mcp/full';
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const origin='http://127.0.0.1:'+server.address().port;
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
 const errors=[],logs=[],sent=[],actions=[];let primary=false,keys=[],denyMint=false,legacyResponse=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>logs.push(m.text()));
 await page.addInitScript(()=>{window.testClipboard=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.testClipboard.push(value)}});});
 await page.route('**/*',async route=>{const req=route.request(),url=req.url();sent.push({url,data:req.postData()||''});if(url.startsWith(origin+'/'))return route.continue();
  if(url.startsWith('https://toto.jkapcar4.workers.dev/')){let body={};try{body=req.postDataJSON()||{};}catch{}
   let result={},status=200;
   if(url.endsWith('/auth/mcp-token')){actions.push(body);if(body.action==='list')result={primary,keys};
    if(body.action==='mint'){if(denyMint){status=403;result={error:'Confirm email',verificationRequired:true};}else{primary=true;result=legacyResponse?{url:endpoint+'/u_fixture_primary'}:{token:'u_fixture_primary'};}}
    if(body.action==='add'){keys=[{label:body.label}];result={token:'u_fixture_additional',endpoint:'https://toto.jkapcar4.workers.dev/mcp/core',url:endpoint+'/u_fixture_additional'};}
    if(body.action==='revoke')primary=false;
    if(body.action==='remove')keys=[];
   }else if(url.includes('/league/search'))result={results:[],total:0};else if(url.includes('/league/mine'))result={leagues:[]};
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  }return route.abort();
 });
 await page.goto(origin+'/connect.html');await page.waitForURL('**/signon.html#connect');
 assert(await page.locator('#connectionGuide').isVisible());assert(await page.locator('#sEmail').isVisible());
 const choose=async value=>{await page.selectOption('#providerChoice',value);assert((await page.locator('#providerGuide').innerText()).length>50);};
 for(const value of ['chatgpt','claude','grok','gemini','muse','other'])await choose(value);
 assert.equal(actions.length,0,'public provider choice must not call credential endpoints');
 await choose('chatgpt');await page.locator('#providerChoice').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await page.locator('#providerChoice').inputValue(),'grok');
 if(out){fs.mkdirSync(out,{recursive:true});await page.locator('#connectionGuide').screenshot({path:path.join(out,'guide-desktop.png')});}
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(out)await page.locator('#connectionGuide').screenshot({path:path.join(out,'guide-mobile.png')});
 await page.evaluate(()=>{localStorage.setItem('dd-bozo-sess',btoa(JSON.stringify({u:'fixture-user',n:'Test User',e:Date.now()+3600000}))+'.fixture');localStorage.setItem('dd-auth-profile-v1',JSON.stringify({name:'Test User',email:'test@example.invalid',emailVerified:true}));});
 await page.reload();await page.locator('#cMint:not([disabled])').waitFor();
 denyMint=true;await page.click('#cMint');await page.locator('#cMintMsg').filter({hasText:'Confirm your email first'}).waitFor();assert.equal(await page.locator('#cUrlBox').isVisible(),false);
 denyMint=false;legacyResponse=true;await page.click('#cMint');await page.locator('#cUrlBox').waitFor();assert.equal(await page.locator('#cEndpoint').isVisible(),false);
 await page.click('#cCopy');assert.equal(await page.evaluate(()=>testClipboard.at(-1)),endpoint+'/u_fixture_primary');
 const count=actions.length;for(const value of ['claude','chatgpt','grok','gemini','muse','other'])await choose(value);assert.equal(actions.length,count);assert.equal(await page.locator('#cUrl').inputValue(),endpoint+'/u_fixture_primary');
 assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('u_fixture_')),false);
 assert.equal(await page.evaluate(()=>window.DD_BOTCTX.ctx().includes('u_fixture_')),false);
 assert.equal(await page.evaluate(()=>window.DDBotScan?.(20000)?.includes('u_fixture_')||false),false);
 await page.locator('#cUrlBox summary').click();assert.equal(await page.locator('#cHeader').inputValue(),'Authorization: Bearer u_fixture_primary');await page.locator('[data-copy="cHeader"]').click();assert.equal(await page.evaluate(()=>testClipboard.at(-1)),'Authorization: Bearer u_fixture_primary');await page.locator('#cUrlBox summary').click();
 await page.fill('#kLabel','Grok');await page.click('#kAdd');await page.locator('#kOut').waitFor();await page.click('[data-copy="kUrl"]');assert.equal(await page.evaluate(()=>testClipboard.at(-1)),endpoint+'/u_fixture_additional');assert.equal(await page.locator('#kToken').isVisible(),false);
 await page.locator('#kList').filter({hasText:'Grok'}).waitFor();page.once('dialog',d=>d.dismiss());const mutations=()=>actions.filter(a=>a.action!=='list').length;const before=mutations();await page.click('#kAdd');assert.equal(mutations(),before,'duplicate key replacement must require confirmation');
 page.once('dialog',d=>d.dismiss());await page.click('#cRotate');assert.equal(mutations(),before,'cancel rotation must preserve credentials');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Screenshots contain no credential values, including synthetic credentials.
 await page.evaluate(()=>{for(const id of ['cUrl','cHeader','kUrl','kToken'])document.getElementById(id).value='[private value hidden]';});
 if(out)await page.locator('#pConnect').screenshot({path:path.join(out,'connection-mobile-redacted.png')});
 await page.reload();await page.locator('#cRotate').waitFor();assert.equal(await page.locator('#cMint').isVisible(),false,'existing primary must not look like a new creation');assert.equal(await page.locator('#cUrlBox').isVisible(),false);
 page.once('dialog',d=>d.accept());legacyResponse=false;await page.click('#cRotate');await page.locator('#cUrlBox').waitFor();assert.equal(await page.locator('#cUrl').inputValue(),endpoint+'/u_fixture_primary');
 await page.click('#cRevoke');await page.locator('#cMint').waitFor();assert.equal(await page.locator('#cUrl').inputValue(),'');assert.equal(await page.locator('#cHeader').inputValue(),'');
 await page.click('#meOut');assert.equal(await page.locator('#kToken').inputValue(),'');assert.equal(await page.locator('#kUrl').inputValue(),'');assert(await page.locator('#connectionGuide').isVisible());
 assert.equal(sent.some(r=>(r.url+r.data).includes('u_fixture_')),false,'credentials must not leave via telemetry or requests');assert.equal(logs.some(x=>x.includes('u_fixture_')),false);assert.deepEqual(errors,[]);
 console.log('PASS: signed-out guide, keyboard/provider changes, phone layout, email gate, both mint responses, exact clipboard values, collapsed alternatives, independent keys, rotation confirmation, revoke, sign-out cleanup and no secret leakage.');
}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
