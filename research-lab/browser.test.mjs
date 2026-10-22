import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {createLab} from './server.mjs';
import {syntheticTracking} from './tracking.mjs';
import {replay} from './replay.mjs';
const {chromium}=loadPlaywright(),directory=mkdtempSync(path.join(os.tmpdir(),'dd-lab-browser-'));
const server=createLab({directory});await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`,output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-lab-screenshots');mkdirSync(output,{recursive:true});let browser;
try {
 browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByText('Local runner ready.',{exact:false}).waitFor();
 assert.equal(await page.locator('#hypothesis-grid article').count(),3);
 assert.equal(await page.locator('.dd-brand').textContent(),'DATA DAWGS');
 await page.getByRole('tab',{name:'Queue'}).click();
 assert.equal(await page.getByRole('button',{name:'Start approved tasks'}).isDisabled(),false);
 await page.getByRole('status').filter({hasText:'Server reserves experiment identities atomically'}).waitFor();
 await page.getByRole('button',{name:'Claim & run locally'}).first().click();await page.getByText('Receipt recorded: success.',{exact:false}).waitFor();
 const state=await(await fetch(base+'/api/state')).json();assert.equal(state.receipts.length,1);assert(replay(directory,state.receipts[0].id).reproduced);
 assert.equal(await page.locator('#receipt-count').innerText(),'1 receipt');
 await page.getByRole('tab',{name:'Research',exact:true}).click();
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:900});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 await page.locator('#new-hypothesis').click();assert(await page.locator('#drawer').evaluate(d=>d.contains(document.activeElement)));await page.keyboard.press('Escape');assert(await page.locator('#new-hypothesis').evaluate(b=>b===document.activeElement));
 await page.getByRole('button',{name:'Open research record'}).first().click();await page.getByRole('button',{name:'Revise hypothesis',exact:true}).click();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#drawer').open&&document.querySelector('#hypothesis-grid button')===document.activeElement);
 await page.locator('#new-hypothesis').click();await page.locator('[name=title]').fill('<img src=x onerror=alert(1)>');await page.locator('[name=method]').fill('Untrusted research text');await page.getByRole('button',{name:'Save hypothesis',exact:true}).click();await page.locator('#hypothesis-grid article').nth(3).waitFor();assert.equal(await page.locator('#hypothesis-grid img').count(),0);
 await page.locator('#load').click();await page.locator('input[type=file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":1}')});await page.getByText('Unsupported version or coordinate convention').waitFor();await page.keyboard.press('Escape');
 const empty=syntheticTracking();empty.frames[0].entities=[];await page.locator('#load').click();await page.locator('input[type=file]').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(empty))});await page.getByText('Empty frame — no entities supplied').waitFor();
 await page.locator('#next').click();assert((await page.locator('#frame-label').innerText()).includes('demo-102'));
 assert.equal(await page.locator('#audio').isChecked(),false);
 await page.locator('#jog').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#jog').getAttribute('aria-valuenow'),'2');
 await page.getByRole('tab',{name:'Research',exact:true}).focus();await page.keyboard.press('End');assert.equal(await page.locator('#tab-inspector').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#panel-research').isVisible(),false);assert.equal(await page.locator('#jog').getAttribute('aria-valuenow'),'2');await page.keyboard.press('Home');assert.equal(await page.locator('#tab-research').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#hypothesis-grid article').count(),4);
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);
  await page.waitForFunction(()=>{const c=document.querySelector('#field'),r=c.getBoundingClientRect();return Math.abs(c.width-r.width*devicePixelRatio)<=1&&Math.abs(c.height-r.height*devicePixelRatio)<=1;});
  const dimensions=await page.locator('#field').evaluate(c=>({width:c.width,height:c.height,rectWidth:c.getBoundingClientRect().width,rectHeight:c.getBoundingClientRect().height,dpr:devicePixelRatio,scale:Number(c.dataset.yardScale)}));
  assert(Math.abs(dimensions.width-dimensions.rectWidth*dimensions.dpr)<=1);assert(Math.abs(dimensions.height-dimensions.rectHeight*dimensions.dpr)<=1);
  assert.equal(dimensions.scale,Math.min((dimensions.rectWidth-20)/120,(dimensions.rectHeight-20)/(160/3)));
  const wheel=await page.locator('#jog').boundingBox();assert.equal(wheel.width,wheel.height);
  for(const name of ['Queue','Evidence','Inspector','Research']){await page.getByRole('tab',{name,exact:name!=='Queue'}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow ${width}`);assert.equal(await page.locator('[role=tabpanel]:visible').count(),1);}
  if(width===390)await page.screenshot({path:path.join(output,'mobile-security-test.png'),fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log(`PASS responsive 320/390/768/1440, DPR/isotropic field, dialogs/Escape/focus, injection inertness, malformed/empty upload, real local run + receipt replay. Screenshots: ${output}`);
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
