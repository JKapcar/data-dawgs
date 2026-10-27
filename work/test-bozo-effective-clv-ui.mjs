// Fixture-only browser QA. No production reads or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'work/artifacts/bozo-effective');
fs.mkdirSync(output,{recursive:true});
// Capture-only styling: keep the real interactive/overflow checks untouched.
const screenshotStyle='body::after,.pb-stub-bar,#ddbLaunch,#ddmeChip,.playbill .snav{visibility:hidden!important}';
const players=['Fixture One','Fixture Two'];
const picks=Object.fromEntries(players.map((name,i)=>[encodeURIComponent(name),{
  selectionKey:'synthetic-'+i,price:-150,entryPriceOpp:130,sport:'nfl',mkt:'spread',line:-3.5,side:'KC',label:'KC -3.5',
  game:'Fixture game '+i,eventId:'fixture-'+i,ts:1791640000000+i*1000
}]));
const state={season:2026,week:1,status:'placed',order:[3,1,2,0],closeTs:1791640000000,picks,
  results:{[encodeURIComponent(players[0])]:{result:'won',actual:2,resultSource:'manual'}}};
// Fulfill local assets directly: no local listening socket and no production fetches.
const origin='https://diagnostics.fixture.invalid';
const leg=(extra={})=>({selectionKey:'synthetic-0',eventId:'fixture-0',label:'Synthetic team moneyline',player:players[0],sport:'nfl',mkt:'ml',week:1,result:'win',entryPrice:100,entryPriceOpp:100,closePrice:-150,closePriceOpp:150,...extra});
const legs=[leg({closePrice:null,closePriceOpp:null,clvEstimate:{kind:'estimated',stale:false,point:2.102895,entryPrice:100,scenarios:[.05],settlementWarning:'Legacy estimate: actual was not recorded in its basis; score/stat changes cannot be checked until reviewed.',closeQuote:{evidence:'untimed_quote_proxy',sourceUrl:'https://example.com/quote'}}}),leg({player:players[1],result:'loss',week:2,closePrice:150,closePriceOpp:-150}),leg({result:'win',week:2,closePrice:null}),leg({result:'pending',week:3,sport:'nba'}),leg({result:'push',week:3}),leg({result:'win',week:4,clvPts:90})];
const {chromium}=loadPlaywright();
let browser;
try{
  browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
  for(const width of [320,390,1280])for(const theme of ['light','dark'])for(const manager of [false,true]){
    const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce',serviceWorkers:'block'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let step='page setup';
    const waitDisclosure=async(selector,open,label)=>{
      step=label;
      // Native summary activation completes asynchronously after keyup. Observe its
      // final state without retrying the input or replacing the native interaction.
      try{
        await page.locator(selector+(open?'[open]':':not([open])')).waitFor({state:'attached',timeout:5000});
      }catch(error){
        throw new Error(`${width}px ${theme}: ${label}; expected disclosure ${open?'open':'closed'}`,{cause:error});
      }
    };
    try{
    await context.addInitScript(t=>{localStorage.setItem('dd-theme3',t);localStorage.setItem('dd-theme3-bozo',t);},theme);
    // Deny all non-local network by default. More specific fixture routes win below.
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      const contentType=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream';
      return route.fulfill({body:fs.readFileSync(file),contentType});
    });
    await page.route('**toto.jkapcar4.workers.dev**',route=>route.fulfill({json:{}}));
    await page.route('**/auth/roster*',route=>route.fulfill({json:{players:players.map(name=>({name,claimed:true}))}}));
    await page.route('**/league/list*',route=>route.fulfill({json:{defaultLeague:'main',leagues:[{
      id:'main',name:'Fixture league',manager:players[0],size:2,members:players,week:1,status:'placed',
      settings:{stake:50,allowEdit:true,lockRule:'all',lockCount:0,levers:[0,1,2,3],format:'standard',buyback:0,formatLocked:false,synthetic:false}
    }]}}));
    await page.route('**/bozo/leagues/main.json*',route=>route.fulfill({json:state}));
    await page.route('**/bozo/clv?*',route=>route.fulfill({json:{players,legs,weeks:[1,2,3,4].map(week=>({week,label:'Week '+week,phase:'regular'})),coverage:{legs:legs.length},synthetic:true,season:2026}}));
    await page.goto(origin+'/bozo.html?l=main#diagnostics',{waitUntil:'domcontentloaded'});
    await page.goto(origin+'/bozo.html?l=main#overview',{waitUntil:'domcontentloaded'});
    await page.locator('#clvSvg circle').first().waitFor({state:'attached'});
    assert.equal(await page.locator('html').getAttribute('data-dd-view'),'tldr');
    await page.evaluate(manager=>DDClvEstimateManager.mount(document.getElementById('clvEstimateManager'),{isManager:()=>manager,league:()=> 'synthetic',identity:()=> 'synthetic-owner',read:async()=>({value:{}}),write:async()=>{throw Error('No writes allowed')},who:x=>x,refresh:async()=>{}}),manager);
    assert.equal(await page.locator('#clvAllBets table').count(),0,'human accounting table removed');
    assert.equal(await page.locator('#clvCard > details.bz-help').count(),0,'methodology clutter removed');
    assert.equal(await page.locator('#clvSvg').isVisible(),true);
    assert.equal(await page.locator('#clvEstimateManager').isVisible(),false);
    await page.locator('#clvCard').screenshot({path:path.join(output,`${width}-${theme}-${manager?'manager':'viewer'}-tldr.png`)});
    await page.getByRole('button',{name:'AI / technical details',exact:true,includeHidden:true}).evaluate(e=>e.click());
    assert.equal(await page.locator('#clvAllBets table').count(),0,'mode switch cannot restore accounting clutter');
    assert.equal(await page.locator('#clvEstimateManager summary').isVisible(),manager);
    assert.doesNotMatch(await page.locator('#clvCard').innerText(),/Every bet.*CLV accounting|Source \/ assumptions|Methodology/);
    assert.match(await page.locator('#clvCard').innerText(),/estimated/i);
    assert.equal(await page.locator('#bozoRecovered').isVisible(),false);
    assert.match(await page.locator('#diagCard').innerText(),/2.10 estimated/);
    assert.ok(await page.locator('#clvSvg').evaluate(e=>e.__pts.some(p=>Math.abs(p.x-2.102895)<.000001)));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).filter(e=>e.clientWidth>innerWidth-24).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right,width:e.clientWidth,overflow:getComputedStyle(e).overflowX})).slice(-20))));
    assert.deepEqual(errors,[]);
    await page.locator('#clv-season').click();
    assert.ok(await page.locator('#clvSvg').evaluate(e=>e.__pts.length>0));
    await page.locator('#clv-week').click();
    assert.equal(await page.locator('#clvAllBets table').count(),0);
    await page.locator('#clvCard').screenshot({path:path.join(output,`${width}-${theme}-chart.png`)});
    await page.screenshot({path:path.join(output,`${width}-${theme}-effective.png`),fullPage:true});
    }finally{await context.close();}
  }
  console.log('PASS: full-page effective CLV, estimated bet plotted, unresolved statuses retained without audit clutter, season toggle, Overview cleanup, mobile/desktop');
}finally{await browser?.close();}
