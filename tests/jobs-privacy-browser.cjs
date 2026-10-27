const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const origin='https://job-privacy.test',api='https://toto.jkapcar4.workers.dev/api/jobs/v1';
const marker='SYNTHETIC_PRIVATE_CONTACT_RESUME_EVIDENCE',auth='SYNTHETIC_SESSION_ONLY';
const record={id:'synthetic',employer:marker,employer_key:'synthetic',role:'Analyst',requisition:'SYN-PRIVACY',url:'https://example.com/'+marker,url_verified_at:'2026-01-01T00:00:00.000Z',resume_version:marker,next_action:marker,blocker:'',created_at:'2026-01-01T00:00:00.000Z',events:[]};
(async()=>{const browser=await chromium.launch({headless:true});try{const context=await browser.newContext(),page=await context.newPage(),logs=[],requests=[];let mode='ok',release,started;
 context.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.message));context.on('request',r=>requests.push(r));
 await context.route('**/*',async route=>{const url=route.request().url();if(url===api){if(mode==='delay'){started();await new Promise(r=>release=r);}if(mode==='invalid')return route.fulfill({body:marker,contentType:'application/json'});if(mode==='error')return route.fulfill({status:400,json:{error:marker}});return route.fulfill({json:{workspace:{revision:1,records:[record]}}});}if(url.startsWith(origin+'/')){const name=new URL(url).pathname.slice(1);if(['jobs.html','jobs.js','jobs-core.js','jobs-import.js','jobs.css'].includes(name))return route.fulfill({body:fs.readFileSync(name),contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'});}return route.abort();});
 await page.goto(origin+'/jobs.html');
 const load=async()=>{mode='ok';await page.evaluate(t=>localStorage.setItem('dd-bozo-sess',t),auth);await page.locator('#refresh').click();await page.locator('.job').waitFor();};
 const clean=async()=>{await page.waitForFunction(()=>!document.querySelector('.job'));assert.ok(!(await page.locator('body').textContent()).includes(marker));assert.equal(await page.locator('#editor').evaluate(e=>e.open),false);assert.equal(await page.locator('#fields input').count(),0);};
 await load();await page.locator('.job').click();await page.getByRole('button',{name:'Record verified update'}).click();await page.locator('[name="reason"]').fill(marker);await page.keyboard.press('Escape');await page.locator('#lock').click();await clean();
 await load();await page.evaluate(()=>localStorage.removeItem('dd-bozo-sess'));await clean(); // same-tab logout, without another request
 await load();const other=await context.newPage();await other.goto(origin+'/jobs.html');await other.evaluate(()=>localStorage.clear());await clean();await other.close(); // null-key storage event
 await load();await page.evaluate(()=>localStorage.setItem('dd-bozo-sess','SYNTHETIC_OTHER_SESSION'));await clean();
 await load();await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await clean();await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await clean();
 await load();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await clean();await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
 for(const failure of ['invalid','error']){mode=failure;await page.evaluate(t=>localStorage.setItem('dd-bozo-sess',t),auth);await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('status').textContent.includes('Checking'));await clean();assert.ok(!(await page.locator('#status').textContent()).includes(marker));}
 mode='delay';const began=new Promise(r=>started=r);await page.locator('#refresh').click();await began;await page.locator('#demo').click();release();await page.waitForFunction(()=>document.querySelectorAll('.job').length===8);assert.ok(!(await page.locator('body').textContent()).includes(marker));
 assert.ok(logs.every(s=>!s.includes(marker)&&!s.includes(auth)),JSON.stringify(logs));
 assert.ok(requests.every(r=>!r.url().includes(marker)&&!r.url().includes(auth)));
 assert.ok(requests.every(r=>r.url()===api||r.url().startsWith(origin+'/')));
 for(const r of requests.filter(r=>r.url()===api)){assert.equal(r.headers()['referer'],undefined);assert.equal(r.headers()['authorization'],'Bearer '+auth);}
 const persistence=await page.evaluate(async()=>({storage:Object.keys(localStorage),session:Object.keys(sessionStorage),caches:await caches.keys()}));assert.deepEqual(persistence,{storage:['dd-bozo-sess'],session:[],caches:[]});
 assert.ok(!(await page.evaluate(()=>window.DD_BOTCTX.ctx())).includes(marker));
 console.log('PASS: synthetic payload never reaches console, raw errors, URL/referrer, extra destinations, browser storage/cache or assistant context; lock, same-tab logout/change, cross-tab clear, hide and page restoration clear private DOM; aborted stale response cannot restore records.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
