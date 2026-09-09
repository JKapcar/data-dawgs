import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPlaywright, chromiumExecutable } from './playwright-loader.mjs';
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium),headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.request().url()==='http://warroom.test/'
    ?route.fulfill({contentType:'text/html',body:fs.readFileSync(new URL('../fantasy-warroom.html',import.meta.url),'utf8')})
    :route.fulfill({contentType:'application/json',body:'{}'}));
  await page.goto('http://warroom.test/');
  await page.evaluate(()=>{
    state={ref:{provider:'sleeper',id:'fixture'},league:{settings:{type:3},scoring_settings:{rec:1}},
      slots:{QB:1},rep:{QB:{pts:0}},pool:[],teams:Array.from({length:18},(_,i)=>({id:String(i),name:'Fixture '+i,total:20,
        players:[{name:'Fixture Player '+i,pos:'QB',p:20,team:'CLE'}]}))};
    MV={by:new Map(),asOf:'2026-09-02'};
    DD={season:null,dynasty:null};
    $('teamPicker').innerHTML='<option value="0">Fixture 0</option>';
    renderMoney();
  });
  assert.match(await page.locator('#mnDynasty').textContent(),/18-team format/);
  assert.equal(await page.locator('#mnTiles').textContent(),'');
  assert.equal(await page.locator('#mnTable').evaluate(el=>el.closest('.wr-grid').classList.contains('wr-hide')),true);
  await page.evaluate(()=>{
    DD.season={by:new Map(state.teams.map(t=>[ddKey(t.players[0]),100])),meta:{as_of:'2026-09-02'}};
    renderMoney();
  });
  assert.equal(await page.locator('#mnTable').evaluate(el=>el.closest('.wr-grid').classList.contains('wr-hide')),false);
  assert.match(await page.locator('#mnTiles').textContent(),/\$100/);
  assert.doesNotMatch(await page.locator('#mnTable').textContent(),/NaN|Infinity/);
  await page.evaluate(()=>{DD.season.by.forEach((_,key)=>DD.season.by.set(key,0));renderMoney()});
  assert.doesNotMatch(await page.locator('#mnTable').textContent(),/NaN|Infinity/);
  assert.match(await page.locator('#mnTable').textContent(),/\$0/);
  console.log('PASS: missing 18-team pricing, board recovery, and real zero-price shares');
} finally {await browser.close()}
