// Fixture-only browser QA. No production reads or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'work/artifacts/bozo-disclosures');
fs.mkdirSync(output,{recursive:true});
const players=['Fixture One','Fixture Two'];
const picks=Object.fromEntries(players.map((name,i)=>[encodeURIComponent(name),{
  price:-150,entryPriceOpp:130,sport:'nfl',mkt:'spread',line:-3.5,side:'KC',label:'KC -3.5',
  game:'Fixture game '+i,eventId:'fixture-'+i,ts:1791640000000+i*1000
}]));
const state={season:2026,week:1,status:'placed',order:[3,1,2,0],closeTs:1791640000000,picks,
  results:{[encodeURIComponent(players[0])]:{clvPts:1.2}}};
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,bytes)=>{
    if(err){res.writeHead(404);res.end();return;}
    const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream';
    res.writeHead(200,{'content-type':type});res.end(bytes);
  });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const {chromium}=loadPlaywright();
let browser;
try{
  browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
  for(const width of [390,1280])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390,reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(t=>{localStorage.setItem('dd-theme3',t);localStorage.setItem('dd-theme3-bozo',t);},theme);
    // Deny all non-local network by default. More specific fixture routes win below.
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    await page.route('**toto.jkapcar4.workers.dev**',route=>route.fulfill({json:{}}));
    await page.route('**/auth/roster*',route=>route.fulfill({json:{players:players.map(name=>({name,claimed:true}))}}));
    await page.route('**/league/list*',route=>route.fulfill({json:{defaultLeague:'main',leagues:[{
      id:'main',name:'Fixture league',manager:players[0],size:2,members:players,week:1,status:'placed',
      settings:{stake:50,allowEdit:true,lockRule:'all',lockCount:0,levers:[0,1,2,3],format:'standard',buyback:0,formatLocked:false,synthetic:false}
    }]}}));
    await page.route('**/bozo/leagues/main.json*',route=>route.fulfill({json:state}));
    await page.goto(origin+'/bozo.html?l=main',{waitUntil:'domcontentloaded'});
    await page.locator('#dgHelp').waitFor({state:'visible'});
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme,'requested theme applied');
    assert.deepEqual(errors,[],'no page errors');
    const card=page.locator('#diagCard');
    assert.equal(await page.locator('#dgHelp').getAttribute('open'),null);
    assert.equal(await page.locator('#dgClvHelp').getAttribute('open'),null);
    assert.equal(await page.locator('#dgHelp > div').isVisible(),false);
    assert.equal(await page.locator('#dgClvHelp > div').isVisible(),false);
    assert.ok((await page.locator('#dgFlags').innerText()).includes('measured on 1 of 2'));
    assert.ok((await card.innerText()).includes('Simulation, not observation'));
    assert.ok(await page.locator('#dgTable').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page-level horizontal overflow');
    await card.screenshot({path:path.join(output,`${width}-${theme}-closed.png`)});
    for(const id of ['dgClvHelp','dgHelp']){
      const summary=page.locator('#'+id+' > summary');
      const box=await summary.boundingBox();
      assert.ok(box.height>=44,'touch target height');
      if(width===390)await summary.tap();else await summary.click();
      assert.equal(await page.locator('#'+id).getAttribute('open'),'');
      await summary.press('Space');
      assert.ok(await summary.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'),'visible keyboard focus');
      assert.equal(await page.locator('#'+id).getAttribute('open'),null);
      await summary.press('Enter');
      assert.equal(await page.locator('#'+id).getAttribute('open'),'');
      assert.equal(await page.locator('#'+id+' > div').isVisible(),true);
      await summary.press('Enter');
      assert.equal(await page.locator('#'+id).getAttribute('open'),null);
      await summary.click();
    }
    await card.screenshot({path:path.join(output,`${width}-${theme}-open.png`)});
    await page.locator('#dgHelp > summary').press('Enter');
    await page.locator('#dgClvHelp > summary').press('Enter');
    assert.equal(await page.locator('#dgHelp').getAttribute('open'),null);
    assert.equal(await page.locator('#dgClvHelp').getAttribute('open'),null);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px ${theme}: collapsed defaults, warning visibility, tap/click, Space/Enter, repeated close/reopen, 44px targets, no horizontal overflow`);
    await context.close();
  }
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
