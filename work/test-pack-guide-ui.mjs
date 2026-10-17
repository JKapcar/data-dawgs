import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import http from 'node:http';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const {chromium}=loadPlaywright(),base=path.resolve(import.meta.dirname,'..');
const req=createRequire(path.join(process.env.DD_NODE_MODULES||path.join(base,'node_modules'),'pack-resolver.cjs'));
const AxeBuilder=req('@axe-core/playwright').default;
const server=http.createServer((request,response)=>{const name=new URL(request.url,'http://localhost').pathname;const file=path.join(base,name==='/'?'ai.html':name);if(!file.startsWith(base)||!existsSync(file)){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
 const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 // No external services are exercised by UI verification, including the pre-existing board.
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.fulfill({status:200,contentType:'application/json',body:'{"data":[],"surfaces":[]}'}));
 await page.addInitScript(()=>{localStorage.setItem('pack-private-canary','SYNTHETIC_PRIVATE_CANARY');});
 const out=process.env.PACK_SCREENSHOTS||path.join(base,'..','pack-qa');mkdirSync(out,{recursive:true});
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:'+server.address().port+'/ai.html#pack-guide');
  await page.locator('.pk-card').first().waitFor();
  assert.equal(await page.locator('.pk-card').count(),7);
  await page.screenshot({path:path.join(out,`pack-${width}.png`),fullPage:false});
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed';}).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,70)})).slice(0,12)}));
  assert.equal(overflow.scroll>overflow.width,false,'page overflow at '+width+': '+JSON.stringify(overflow));
  const axe=await new AxeBuilder({page}).include('#pack-guide').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  await page.screenshot({path:path.join(out,`pack-${width}.png`),fullPage:false});
 }
 await page.locator('#pk-search').fill('no-such-profile');assert.equal(await page.locator('.pk-card').count(),0);
 await page.locator('#pk-search').fill('');await page.locator('#pk-state').selectOption('all');assert.equal(await page.locator('.pk-card').count(),12);await page.locator('#pk-category').selectOption('transcription');assert.equal(await page.locator('.pk-card').count(),1);
 await page.locator('#pk-category').selectOption('all');await page.locator('#pk-state').selectOption('version-changed');assert.equal(await page.locator('.pk-card').count(),1);await page.locator('#pk-state').selectOption('all');
 await page.locator('[data-compare="gpt6astra"]').check();await page.locator('[data-compare="opus55"]').check();assert.equal(await page.locator('#pk-comparison thead th').count(),3);
 await page.locator('[data-evidence="gpt6astra"]').focus();await page.keyboard.press('Enter');assert(await page.locator('#pk-drawer').isVisible());
 assert.deepEqual((await new AxeBuilder({page}).include('#pk-drawer').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.evidence),'gpt6astra');
 await page.locator('#pk-execution').check();assert((await page.locator('#pk-advice').innerText()).includes('BLOCKED'));
 assert.equal(await page.locator('.pk-unknown').count(),18);assert(!(await page.locator('#pack-guide').innerText()).includes('SYNTHETIC_PRIVATE_CANARY'));
 assert(!requests.some(u=>/\/api\/pound|\/privatePounds|SYNTHETIC_PRIVATE_CANARY/.test(u)));assert.deepEqual(errors,[]);
 await page.locator('#pk-state').selectOption('provider-listed');await page.locator('#pack-library').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'pack-library-1440.png')});
 await page.locator('#pack-team').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'pack-team-1440.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('[data-evidence="sunburst25"]').click();await page.screenshot({path:path.join(out,'pack-evidence-390.png')});
 console.log('PASS 320/390/1440 layout, axe WCAG A/AA, keyboard dialog return, search/filters/comparison, blocked capabilities, unknown heatmaps, private canary isolation. Screenshots: '+out);
}finally{await browser?.close();server.close();}
