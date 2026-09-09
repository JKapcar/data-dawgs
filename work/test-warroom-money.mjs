import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadPlaywright, chromiumExecutable } from './playwright-loader.mjs';
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium),headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.request().url()==='http://warroom.test/'
    ?route.fulfill({contentType:'text/html',body:fs.readFileSync(new URL('../fantasy-warroom.html',import.meta.url),'utf8')})
    :route.request().url()==='http://warroom.test/warroom-weekly.js'
    ?route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('../warroom-weekly.js',import.meta.url),'utf8')})
    :route.fulfill({contentType:'application/json',body:'{}'}));
  await page.goto('http://warroom.test/');
  await page.evaluate(()=>{
    state={ref:{provider:'sleeper',id:'fixture'},league:{settings:{type:3},scoring_settings:{rec:1},roster_positions:['QB']},
      slots:{QB:1},rep:{QB:{pts:0}},pool:[],teams:Array.from({length:18},(_,i)=>({id:String(i),name:'Fixture '+i,total:20,
        players:[{id:String(i),name:'Fixture Player '+i,pos:'QB',p:20,team:'CLE'}]}))};
    state.weekly={ready:true,season:'2026',week:1,capturedAt:'2026-09-09T02:00:00Z',
      byId:new Map(state.teams.map((t,i)=>[String(i),20+i]))};
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
  assert.match(await page.locator('#mnWeeklyTiles').textContent(),/20.00 pts/);
  assert.match(await page.locator('#mnWeeklyTiles').textContent(),/18 of 18/);
  assert.doesNotMatch(await page.locator('#mnTable').textContent(),/NaN|Infinity/);
  await page.evaluate(()=>{DD.season.by.forEach((_,key)=>DD.season.by.set(key,0));renderMoney()});
  assert.doesNotMatch(await page.locator('#mnTable').textContent(),/NaN|Infinity/);
  assert.match(await page.locator('#mnTable').textContent(),/\$0/);
  await page.evaluate(()=>{state.weekly={ready:false,error:'Fixture feed unavailable'};renderMoney()});
  assert.match(await page.locator('#mnWeeklyNote').textContent(),/Fixture feed unavailable/);
  assert.equal(await page.locator('#mnWeeklyTiles').textContent(),'');
  assert.equal(await page.locator('#mnTable').evaluate(el=>el.closest('.wr-grid').classList.contains('wr-hide')),true);
  await page.evaluate(()=>{state.ref.provider='espn';renderMoney()});
  assert.equal(await page.locator('#mnWeeklyCard').evaluate(el=>el.classList.contains('wr-hide')),true);
  assert.equal(await page.locator('#mnTable').evaluate(el=>el.closest('.wr-grid').classList.contains('wr-hide')),false);
  console.log('PASS: missing prices, board recovery, weekly ranks, unavailable weekly feed, provider switching, and real zero-price shares');
} finally {await browser.close()}
