/* Real Chromium QA with synthetic inputs; no external traffic allowed. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.QA_OUTPUT||path.join(root,'work/artifacts/dfs-builder');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()+(r.postData()||'')));
 const origin='http://127.0.0.1:'+server.address().port;await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/dfs-diagnostics.html#builder');await page.locator('#bTools > summary').click();await page.locator('#bDemo').click();
 // Add a complete legal synthetic roster using real buttons.
 for(const name of ['Ash','Birch','Cedar','Dune','Elm','Heath','Grove','Moss','Iris'])await page.getByRole('button',{name:'Add Synthetic '+name,exact:true}).click();

 // Demo has no ownership source. Supply explicit synthetic fixture inputs locally.
 await page.evaluate(()=>{const d=structuredClone(DDFSBuilderSession.draft());for(const p of d.pool.players)p.generalOwn=50;DDFSBuilderSession.install(d);});
 await page.locator('#bSimulation > summary').click();
 await page.locator('[data-preset="cash"]').click();
 await page.locator('#bSimSettings > summary').click();
 await page.locator('[data-sim="fieldSize"]').fill('100');await page.locator('[data-sim="fieldSize"]').dispatchEvent('change');
 await page.locator('[data-sim="iterations"]').fill('200');await page.locator('[data-sim="iterations"]').dispatchEvent('change');
 await page.locator('[data-sim="ownershipSource"]').selectOption('general');
 await page.locator('#bSimAck').check();await page.locator('#bSimRun').click();
 await page.waitForFunction(()=>document.getElementById('bSimStatus').textContent.includes('Conditional estimates complete'),null,{timeout:15000}).catch(async e=>{throw Error(await page.locator('#bSimStatus').innerText()+'; '+errors.join('; '));});
 assert.equal(await page.locator('#bSimRelationships').evaluate(e=>e.open),false);
 await page.locator('#bSimRelationships > summary').click();
 assert.equal(await page.locator('#bSimRelationshipRows > p').count(),36);
 assert.match(await page.locator('#bSimRelationshipSource').innerText(),/2019-2025/);
 assert.match(await page.locator('#bSimRelationshipRows').innerText(),/Applied:/);
 await page.locator('#bSimRelationships details > summary').click();
 assert.match(await page.locator('#bSimRelationships').innerText(),/expected scores fixed/);
 fs.mkdirSync(out,{recursive:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#bSimRelationships').screenshot({path:path.join(out,'relationships-phone.png')});
 await page.locator('[data-sim="correlation"]').selectOption('independent');
 assert.equal(await page.locator('#bSimRelationshipRows > p').count(),0);
 assert.match(await page.locator('#bSimRelationshipSource').innerText(),/Run this lineup/);
 assert.deepEqual(errors,[]);console.log('PASS: selected lineup relationships, collapsed help, source context, phone width, and stale receipt cleared.');
}finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
