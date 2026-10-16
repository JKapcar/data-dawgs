// My Lab (private.html) against the real loopback runner: family groups, status chips,
// SYNTHETIC receipt badges, and a Real data tab that renders only a manifest summary.
// Synthetic state in a temp directory; the summary below is invented and holds no names.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
import {createLab} from './server.mjs';
const {chromium}=loadPlaywright(),directory=mkdtempSync(path.join(os.tmpdir(),'dd-lab-private-')),summaryFile=path.join(directory,'manifest-summary.json');
const output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-lab-screenshots');mkdirSync(output,{recursive:true});
const server=createLab({directory,manifestSummary:summaryFile});await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
const command=async c=>{const r=await fetch(base+'/api/command',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(c)});const j=await r.json();assert.ok(r.ok,j.error);return j;};
try{
 await command({type:'hypothesis',key:'pb-1',payload:{title:'Registered synthetic T1',method:'Synthetic registered method',status:'registered',family:'speed-retention',target:'T1'}});
 await command({type:'hypothesis',key:'pb-2',payload:{title:'Withdrawn synthetic idea',method:'Synthetic',status:'withdrawn',family:'missingness'}});
 browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/private.html');await page.getByText('Local runner ready.',{exact:false}).waitFor();
 const groups=await page.locator('#hypothesis-grid .family-group > h3').allTextContents();assert.deepEqual(groups,['Speed retention · 1','Missingness · 1','Other · 3']);
 assert.equal(await page.locator('#hypothesis-grid article').count(),5);assert.equal(await page.locator('#hypothesis-grid .status-registered').first().textContent(),'REGISTERED');assert.equal(await page.locator('#hypothesis-grid .status-withdrawn').count(),1);assert.equal(await page.locator('#hypothesis-grid .status-exploratory').count(),3);
 assert.ok(await page.getByText('NOT A FITTED BASELINE',{exact:true}).isVisible());
 await page.getByRole('tab',{name:/Queue/}).click();await page.getByRole('button',{name:'Claim & run locally'}).first().click();await page.getByText('Receipt recorded',{exact:false}).waitFor();
 await page.locator('#receipts').evaluate(n=>n.closest('details').open=true);const badges=await page.locator('#receipts summary .synthetic-badge').allTextContents();assert.ok(badges.length>=1&&badges.every(b=>b==='SYNTHETIC'));assert.equal(await page.locator('#receipts summary').count(),badges.length);
 await page.getByRole('tab',{name:'Real data'}).click();await page.getByText('No manifest summary is published here yet.',{exact:false}).waitFor();assert.equal(await page.locator('#real-data table').count(),0);
 writeFileSync(summaryFile,JSON.stringify({generated_at:'2026-10-16T00:00:00Z',note:'synthetic test summary',archive:{sha256:'0'.repeat(64)},files:[{file:'synthetic_a.csv',bytes:1234,rows:10,columns:4,key_unique:true,max_null_share:0.1,sha256:'a'.repeat(64)},{file:'synthetic_b.csv',bytes:99,rows:2,columns:3,key_unique:false,max_null_share:0,sha256:'b'.repeat(64)}]}));
 await page.reload();await page.getByText('Local runner ready.',{exact:false}).waitFor();await page.getByRole('tab',{name:'Real data'}).click();await page.locator('#real-data table').waitFor();
 assert.equal(await page.locator('#real-data tr').count(),3);assert.match(await page.locator('#real-data').textContent(),/synthetic_a\.csv[\s\S]*1,234[\s\S]*Not a finding, not a fitted baseline/);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px no page overflow');await page.screenshot({path:path.join(output,`my-lab-real-data-${width}.png`),fullPage:true});}
 await page.getByRole('tab',{name:'Research',exact:true}).click();await page.screenshot({path:path.join(output,'my-lab-families-320.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,syntheticOnly:true,checks:['family groups','status chips','SYNTHETIC receipt badges','NOT A FITTED BASELINE kept','Real data absent','Real data summary only','390/320 no overflow'],screenshots:output}));
}finally{await browser?.close();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
