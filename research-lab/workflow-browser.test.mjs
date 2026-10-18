import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {createLab} from './server.mjs';
const {chromium}=loadPlaywright(),directory=mkdtempSync(path.join(os.tmpdir(),'dd-workflow-synthetic-'));
const server=createLab({directory});await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const out=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-workflow-shots');mkdirSync(out,{recursive:true});let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByText('Local runner ready.',{exact:false}).waitFor();
 const open=async()=>{await page.getByRole('tab',{name:'Research',exact:true}).click();await page.getByRole('button',{name:'Open research record'}).first().click();await page.getByRole('button',{name:'Open dependency and evidence graph'}).click();};
 await open();assert.equal(await page.locator('.workflow-graph li').count(),6);assert.equal(await page.locator('#stage-1').getAttribute('data-status'),'blocked');
 await page.getByRole('button',{name:'Check current synthetic input'}).click();await page.waitForFunction(()=>document.querySelector('#stage-1')?.dataset.status==='recorded');
 await page.getByRole('button',{name:'Queue bounded synthetic audit'}).click();await page.waitForFunction(()=>document.querySelector('#stage-2')?.dataset.status==='pending');
 await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Queue'}).click();await page.getByRole('button',{name:'Claim & run locally'}).last().click();await page.getByText('Receipt recorded: success.',{exact:false}).waitFor();
 await open();assert.equal(await page.locator('#stage-2').getAttribute('data-status'),'recorded');assert.equal(await page.locator('#stage-3').getAttribute('data-status'),'blocked');
 for(const width of [1200,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.workflow-graph').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.screenshot({path:path.join(out,`workflow-${width}.png`),fullPage:true});}
 await page.getByRole('button',{name:'Submit separate review'}).click();await page.locator('[name=body]').fill('Synthetic self review must fail');await page.locator('[name=disposition]').fill('ready');await page.getByRole('button',{name:'Record review',exact:true}).click();await page.locator('[role=alert]').getByText('Separate verified subject required',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Record owner decision',exact:true}).count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#drawer').evaluate(e=>e.open),false);assert.deepEqual(errors,[]);
 console.log('PASS synthetic workflow UI: linked records, 1200/390/320px, self-review refused, owner gate blocked, no page errors');
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
