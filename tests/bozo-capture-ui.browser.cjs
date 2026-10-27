// Synthetic local browser QA: every request is fulfilled locally; writes are rejected.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../validation/browser');fs.mkdirSync(out,{recursive:true});
const leg={player:'Fixture',week:1,sport:'nfl',label:'Synthetic selected line',result:'win',entryPrice:-150,entryPriceOpp:130,closePrice:-170,closePriceOpp:145};
const legs=[leg,{...leg,label:'Synthetic exchange estimate',closePrice:null,closePriceOpp:null,clvEstimate:{kind:'estimated',stale:false,point:1.5,entryProbability:.58,method:'historical_exchange_probability_v1',provenance:'historical_exchange',closeQuote:{evidence:'historical_exchange'}}},{...leg,label:'Synthetic unresolved',closePrice:null,closePriceOpp:null},{...leg,label:'Synthetic push',result:'push',closePrice:null,closePriceOpp:null,clvEstimate:{kind:'convention',method:'owner_push_zero_v1',point:0}},{...leg,label:'Synthetic pending',result:null,closePrice:null,closePriceOpp:null}];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const results=[];
 for(const league of ['main','royale'])for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];let writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.EventSource=undefined;});
  const state={name:'Synthetic '+league,season:2026,week:1,status:'open',members:{Fixture:true},settings:{format:league==='royale'?'royale':'standard',stake:50,synthetic:true},picks:{},results:{}};
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){writes++;return route.fulfill({status:403,json:{error:'Fixture: writes forbidden'}});}
   if(url.origin==='http://preview.local'){const file=path.join(root,url.pathname);if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':undefined});}
   if(url.hostname.includes('firebaseio.com'))return route.fulfill({json:state});
   if(url.pathname==='/league/list')return route.fulfill({json:{defaultLeague:'main',leagues:[{id:league,name:'Synthetic '+league,settings:state.settings}]}});
   if(url.pathname==='/bozo/clv')return route.fulfill({json:{legs,players:['Fixture'],weeks:[{week:1,label:'Week 1',phase:'regular'}],format:state.settings.format,synthetic:true}});
   return route.fulfill({json:{players:[],legs:[],events:[],games:[],data:[]}});
  });
  await page.goto('http://preview.local/bozo.html?l='+league,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof CLV!=='undefined'&&CLV.data?.legs?.length===5);
  await page.evaluate(()=>{document.getElementById('clvCard').style.display='';CLV.state.mode='week';clvRender();});
  const card=page.locator('#clvCard');await card.scrollIntoViewIfNeeded();
  const text=await card.innerText();assert.doesNotMatch(text,/Every bet.*CLV accounting|Source \/ assumptions|CLV methodology|Overround scenarios/i);assert.match(text,/estimated/);assert.match(text,/CLV unresolved/);assert.match(text,/push convention/);assert.match(text,/pending/);
  assert.equal(await card.locator('#clvAllBets table, #clvAllBets details').count(),0);
  const metrics=await card.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,points:document.getElementById('clvSvg').__pts?.length,head:document.getElementById('clvHead').textContent}));assert.equal(metrics.points,2);assert.ok(metrics.scrollWidth<=metrics.width+2,JSON.stringify(metrics));
  await card.screenshot({path:path.join(out,league+'-'+width+'.png')});assert.deepEqual(errors,[]);assert.equal(writes,0);
  results.push({league,width,...metrics,errors,writes});await context.close();
 }
 await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
