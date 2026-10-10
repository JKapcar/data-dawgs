// Fixture-only browser QA. No production reads or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'work/artifacts/bozo-diagnostics');
fs.mkdirSync(output,{recursive:true});
// Capture-only styling: keep the real interactive/overflow checks untouched.
const screenshotStyle='body::after,.pb-stub-bar,#ddbLaunch,#ddmeChip,.playbill .snav{visibility:hidden!important}';
const players=['Fixture One','Fixture Two'];
const picks=Object.fromEntries(players.map((name,i)=>[encodeURIComponent(name),{
  price:-150,entryPriceOpp:130,sport:'nfl',mkt:'spread',line:-3.5,side:'KC',label:'KC -3.5',
  game:'Fixture game '+i,eventId:'fixture-'+i,ts:1791640000000+i*1000
}]));
const state={season:2026,week:1,status:'placed',order:[3,1,2,0],closeTs:1791640000000,picks,
  results:{[encodeURIComponent(players[0])]:{clvPts:1.2}}};
// Fulfill local assets directly: no local listening socket and no production fetches.
const origin='https://diagnostics.fixture.invalid';
const leg=(extra={})=>({player:players[0],sport:'nfl',mkt:'ml',week:1,result:'win',entryPrice:100,entryPriceOpp:100,closePrice:-150,closePriceOpp:150,...extra});
const legs=[leg(),leg({player:players[1],result:'loss',week:2,closePrice:150,closePriceOpp:-150}),leg({result:'win',week:2,closePrice:null}),leg({result:'pending',week:3,sport:'nba'}),leg({result:'push',week:3}),leg({result:'win',week:4,clvPts:90})];
const {chromium}=loadPlaywright();
let browser;
try{
  browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
  for(const width of [390,1280])for(const theme of ['light','dark']){
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
    await page.route('**/bozo/clv?*',route=>route.fulfill({json:{players,legs,synthetic:true,season:2026}}));
    await page.goto(origin+'/bozo.html?l=main#diagnostics',{waitUntil:'domcontentloaded'});
    const card=page.locator('#diagExploreCard');
    await card.locator('section.dx-viz').first().waitFor({state:'visible'});
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    assert.equal(await card.locator('section.dx-viz').count(),6);
    assert.deepEqual(errors,[],'no page errors');
    const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page-level overflow');
    await overflow();
    await card.screenshot({style:screenshotStyle,path:path.join(output,`${width}-${theme}-primary.png`)});
    await page.locator('#dxMore > summary').click();
    await waitDisclosure('#dxMore',true,'additional charts after click');
    for(const chart of ['outcomes','trend','comparison','clv','calibration','coverage']){
      const section=card.locator(`[data-chart="${chart}"]`);
      if(chart!=='coverage'){assert.ok(await section.locator('[role="img"]').count()>=1);assert.ok(await section.locator('[role="img"]').first().getAttribute('aria-label'));}
      const selector=`#dxChart [data-chart="${chart}"] details.bz-help`;
      const detail=section.locator('details.bz-help'), summary=detail.locator(':scope > summary');
      await waitDisclosure(selector,false,`${chart}: initially closed`);
      const box=await summary.boundingBox();assert.ok(box.height>=44,'44px disclosure target');
      if(width===390)await summary.tap();else await summary.click();
      await waitDisclosure(selector,true,`${chart}: opened by ${width===390?'touch':'click'}`);
      await detail.locator('table').waitFor({state:'visible'});
      await summary.press('Space');
      await waitDisclosure(selector,false,`${chart}: closed by Space`);
      assert.ok(await summary.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'),'visible keyboard focus');
      await summary.press('Enter');
      await waitDisclosure(selector,true,`${chart}: reopened by Enter`);
      await summary.press('Enter');
      await waitDisclosure(selector,false,`${chart}: closed again by Enter`);
    }
    step='chart data and filter checks';
    await overflow();
    await card.screenshot({style:screenshotStyle,path:path.join(output,`${width}-${theme}-all-charts.png`)});
    const tiles=await page.locator('#dxTiles').innerText();
    assert.match(tiles,/6 total picks/);assert.match(tiles,/3–1/);assert.match(tiles,/2 matched decisions/);
    assert.match(await card.locator('[data-chart="trend"]').innerText(),/1 wins vs 1\.0 expected/);
    assert.match(await card.locator('[data-chart="coverage"]').innerText(),/2 of 6 picks/);
    await page.locator('#dxMetric').selectOption('clv');
    assert.match(await card.locator('[data-chart="comparison"]').innerText(),/CLV/i);
    for(const group of ['sport','market','week','player'])await page.locator('#dxGroup').selectOption(group);
    await page.locator('#dxPlayer').selectOption(players[0]);
    await page.locator('#dxSport').selectOption('nba');
    assert.match(await page.locator('#dxMeta').innerText(),/1 pick/);
    assert.doesNotMatch(await card.innerHTML(),/NaN|Infinity/);
    await card.screenshot({style:screenshotStyle,path:path.join(output,`${width}-${theme}-pending.png`)});
    await page.locator('#dxPlayer').selectOption(players[1]);
    assert.match(await page.locator('#dxChart').innerText(),/No picks match/);
    await card.screenshot({style:screenshotStyle,path:path.join(output,`${width}-${theme}-empty.png`)});
    await page.locator('#dxSport').selectOption('all');
    assert.match(await page.locator('#dxMeta').innerText(),/1 pick/);
    await card.screenshot({style:screenshotStyle,path:path.join(output,`${width}-${theme}-small-sample.png`)});
    await page.locator('#dxPlayer').selectOption('all');
    await page.locator('#dxFrom').selectOption('3');
    await page.locator('#dxTo').selectOption('4');
    assert.equal(await page.locator('#dxWindow').inputValue(),'custom');
    assert.match(await page.locator('#dxMeta').innerText(),/3 picks/);
    await overflow();assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px ${theme}: six charts, labels, disclosures, exact sample, filters, missing/pending/empty/small states, no overflow`);
    }catch(error){
      await page.screenshot({path:path.join(output,`${width}-${theme}-failure.png`),fullPage:true}).catch(()=>{});
      console.error(`FAIL ${width}px ${theme} at ${step}; page errors: ${JSON.stringify(errors)}`);
      throw error;
    }finally{
      await context.close();
    }
  }
}finally{
  await browser?.close();
}
