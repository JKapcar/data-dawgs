// Synthetic-only browser regression. Install Playwright outside the repository.
// DD_NODE_MODULES points to node_modules; DD_CHROMIUM optionally selects Chromium.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.DD_NODE_MODULES?path.join(process.env.DD_NODE_MODULES,'playwright'):'playwright');
const root=path.resolve(__dirname,'..'),screenshots=process.env.DDFS_SCREENSHOTS||path.join(require('node:os').tmpdir(),'dfs-labs-qa');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));
});
const classic=()=>['QB','QB','RB','RB','RB','RB','WR','WR','WR','WR','WR','WR','TE','TE','TE','TE','DST','DST'].map((pos,i)=>({name:'Synthetic Player '+i,pos,team:i%2?'AAA':'BBB',opp:i%2?'BBB':'AAA',gid:i<9?'AAA@BBB':'CCC@DDD',sal:5400,proj:10+i/3,ceil:20+i,own:10,dkId:'D'+i}));
const showdown=()=>Array.from({length:12},(_,i)=>({name:'Synthetic Showdown '+i,pos:['QB','WR','RB','TE','K','DST'][i%6],team:i<6?'AAA':'BBB',opp:i<6?'BBB':'AAA',gid:'AAA@BBB',sal:6000+i*100,proj:10+i/2,ceil:25+i,own:50,cptOwn:100/12,flexOwn:500/12,dkId:'D'+i,cptId:'C'+i}));
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.DD_CHROMIUM||undefined});fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [360,390,412,1440])for(const theme of ['light','dark']){
  const name=`${width}-${theme}`,reducedMotion=width!==390,context=await browser.newContext({viewport:{width,height:width<500?844:1000},serviceWorkers:'block',reducedMotion:reducedMotion?'reduce':'no-preference'});
  await context.addInitScript(theme=>{localStorage.setItem('dd-theme3-dfs',theme);localStorage.setItem('dd-theme3',theme);window.demoProgress=[];new MutationObserver(()=>{const n=document.getElementById('labsRunStatus');if(n&&window.demoProgress.at(-1)!==n.textContent)window.demoProgress.push(n.textContent);}).observe(document,{childList:true,subtree:true,characterData:true});},theme);
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.fulfill({status:403,contentType:'application/json',body:'{"error":"Synthetic QA: live provider unavailable"}'}));
  await page.goto(base+'/dfs.html');await page.waitForFunction(()=>localStorage.getItem('dd-dfs-v1'));
  await page.evaluate(players=>{const s=JSON.parse(localStorage.getItem('dd-dfs-v1'));s.players=players;s.slate.source='csv';s.slate.label='Synthetic saved workspace';s.sheet='week';localStorage.setItem('dd-dfs-v1',JSON.stringify(s));},classic());
  await page.reload();await page.waitForTimeout(500);assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  await page.screenshot({path:path.join(screenshots,name+'-welcome.png')});assert.equal(await page.locator('#scrTab').isVisible(),false);
  const before=await page.evaluate(()=>localStorage.getItem('dd-dfs-v1'));
  await page.locator('#labsDemo').focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.searchParams.get('demo')==='1');
  await page.waitForSelector('#labsSimChart .labs-bar',{timeout:30000});
  assert.equal(await page.locator('#luList .lu').count(),3);assert.equal(await page.locator('#labsSimChart .labs-bar').count(),3);
  assert.match(await page.locator('#labsRunStatus').innerText(),/Nothing was saved/);assert.equal(await page.evaluate(()=>localStorage.getItem('dd-dfs-v1')),before);assert.equal(await page.locator('#dfsCloudSave').isDisabled(),true);
  const progress=await page.evaluate(()=>window.demoProgress);assert.ok(progress.some(x=>/Building/.test(x)));assert.ok(progress.some(x=>/modelled worlds/.test(x)));
  // Independently recompute Wilson bounds from the 1,000-world cash rate.
  for(const row of await page.locator('.labs-bar').all()){
   const text=await row.innerText(),p=Number(text.match(/([\d.]+)%/)[1])/100,n=1000,z=1.96,d=1+z*z/n,m=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
   assert.ok(text.includes(`${(100*(m-h)).toFixed(1)}%–${(100*(m+h)).toFixed(1)}%`),text);
  }
  await page.locator('#labsSimChart').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(screenshots,name+'-simulation.png')});
  // Cancel a real worker before a completion callback can run on the page.
  await page.evaluate(()=>{document.getElementById('labsRestart').click();document.getElementById('labsCancel').click();});await page.waitForTimeout(300);
  assert.match(await page.locator('#labsRunStatus').innerText(),/cancelled/);assert.equal(await page.locator('#labsCancel').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('dd-dfs-v1')),before);
  // Cancel the simulation phase too, using real workers and a queued button click.
  await page.evaluate(()=>{const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){const result=post.call(this,message,...args);if(message.op==='sim')queueMicrotask(()=>document.getElementById('labsCancel').click());return result;};document.getElementById('labsRestart').click();});
  await page.waitForFunction(()=>document.getElementById('labsRunStatus').textContent.includes('cancelled'));
  assert.equal(await page.locator('#simCard').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('dd-dfs-v1')),before);
  await page.locator('#labsExit').focus();await page.keyboard.press('Enter');await page.waitForURL(url=>url.searchParams.get('resume')==='1');await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dd-dfs-v1')).players),classic());
  for(const tab of ['week','slate','solver','sim','exposure','bankroll','screener','standings','method']){
   await page.goto(base+'/dfs.html?resume=1#'+tab);assert.equal(await page.locator('.sheet:visible').count(),1);assert.equal(await page.locator('#sh-'+tab).isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow on ${tab}`);
  }
  for(const anchor of ['dfsPlaybook','dfsGuide','dfsCloudCard','csvUploadCard']){await page.goto(base+'/dfs.html?resume=1#'+anchor);assert.equal(await page.locator('#'+anchor).isVisible(),true);assert.equal(new URL(page.url()).hash,'#'+anchor);}
  await page.locator('#fsTabs button[data-s="screener"]').click();const summary=page.locator('#sh-screener details.gear>summary');await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(e=>e.parentElement.open),true);assert.equal(await summary.evaluate(e=>getComputedStyle(e,'::before').content),'""');
  await page.locator('#fsTabs button[data-s="solver"]').click();await page.selectOption('#cfObjective','projection');await page.reload();assert.equal(await page.locator('#cfObjective').inputValue(),'projection');
  await page.selectOption('#cfObjective','gpp');await page.reload();assert.equal(await page.locator('#cfObjective').inputValue(),'gpp');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('dd-dfs-v1'));s.players[0].ceil=null;localStorage.setItem('dd-dfs-v1',JSON.stringify(s));});await page.reload();await page.locator('#solveGo').click();assert.match(await page.locator('#solveWarn').innerText(),/players need ceilings/);
  await page.evaluate(players=>{const s=JSON.parse(localStorage.getItem('dd-dfs-v1'));s.players=players;s.site='dk_showdown';s.lineups=[];Object.assign(s.cfg,{count:3,minSal:0,maxSal:50000,uniq:1,maxExp:100,team:5,game:6,time:5,qbMin:0,bring:0,noRbDst:false,noQbDst:false,noOppDst:false});Object.assign(s.sim,{field:50,sample:200,sims:500,fieldSal:0,payout:'cash',paid:20,fee:1});localStorage.setItem('dd-dfs-v1',JSON.stringify(s));},showdown());
  await page.reload();await page.locator('#solveGo').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dd-dfs-v1')).lineups.length===3);
  await page.locator('#fsTabs button[data-s="sim"]').click();await page.locator('#simGo').click();await page.waitForSelector('#labsSimChart .labs-bar');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({viewport:width,theme,reducedMotion,classicDemo:'PASS',cancel:'PASS',workspaceUnchanged:'PASS',showdown:'PASS',deepLinks:9,errors}));await context.close();
 }
 // Recoverable live-provider failure and refusal to leave unsaved work behind.
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 await page.route('**/*',r=>{
  const url=r.request().url();if(url.startsWith(base+'/'))return r.continue();
  if(url.includes('/dk/lobby'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({DraftGroups:[{DraftGroupId:99001,ContestTypeId:21,GameCount:12,StartDate:'2099-09-13T17:00:00Z',Sport:'NFL'}]})});
  return r.fulfill({status:403,contentType:'application/json',body:'{"error":"Synthetic provider denied access (HTTP 403)"}'});
 });
 await page.goto(base+'/dfs.html#slate');await page.waitForFunction(()=>document.getElementById('slateWarn').textContent.includes('Live salaries are unavailable'));
 assert.match(await page.locator('#slateWarn').getAttribute('class'),/warn/);assert.equal(await page.locator('#slateWarn details').getAttribute('open'),null);
 assert.ok(!(await page.locator('#totoHealthChip').innerText()).includes('idle'));
 await page.locator('#fsTabs button[data-s="week"]').click();
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,...args){if(key==='dd-dfs-v1')throw Error('Synthetic storage failure');return original.call(this,key,...args);};});
 await page.locator('#labsDemo').click();assert.match(await page.locator('#labsDemoStatus').innerText(),/could not preserve/);assert.equal(new URL(page.url()).searchParams.has('demo'),false);
 console.log('PASS: provider 403 recovery, non-idle badge, and blocked-storage demo safety');await context.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
