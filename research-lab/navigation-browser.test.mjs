import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {loadPlaywright,chromiumExecutable} from '../work/playwright-loader.mjs';
const root=path.resolve(import.meta.dirname,'..'),output=process.env.LAB_SCREENSHOTS||path.join(os.tmpdir(),'dd-navigation-preview');mkdirSync(output,{recursive:true});
const pages=[['/dawg-pound.html','RoboKap'],['/research-lab/','Lab'],['/research-lab/private.html','My Lab'],['/research-lab/upload.html','Uploads'],['/research-lab/agent-setup.html','Connections']];
const {chromium}=loadPlaywright(),browser=await chromium.launch({headless:true,executablePath:chromiumExecutable(chromium)});
let checkedLinks=0;
try{
 for(const [url,label] of pages){
  const page=await browser.newPage(),errors=[],failed=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname!=='datadawgs216.com')return route.fulfill({status:401,contentType:'application/json',body:'{"error":"synthetic_signed_out"}'});
   const file=path.join(root,u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname);
   if(!existsSync(file)){failed.push(u.pathname);return route.fulfill({status:404,body:'missing'});}
   const ext=path.extname(file),contentType=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'})[ext]||'text/plain';
   return route.fulfill({contentType,body:readFileSync(file)});
  });
  await page.goto('https://datadawgs216.com'+url);
  await page.locator('.dd-shell').waitFor();
  assert.equal(await page.locator('.dd-peers [aria-current=page]').textContent(),label);
  assert.equal(await page.locator('.dd-global details').count(),7);
  for(const href of await page.locator('.dd-shell a').evaluateAll(nodes=>nodes.map(n=>n.href))){const u=new URL(href);assert.equal(u.hostname,'datadawgs216.com');assert(existsSync(path.join(root,u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname)),href);checkedLinks++;}
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} overflow ${width}`);
   const summary=page.locator('.dd-apps > summary');
   await summary.focus();await page.keyboard.press('Enter');await page.locator('.dd-apps[open]').waitFor();
   const menu=await page.locator('.dd-app-menu').boundingBox();assert(menu.x>=0&&menu.x+menu.width<=width+1,`${label} dropdown ${width}`);
   await page.keyboard.press('Escape');assert.equal(await page.locator('.dd-apps[open]').count(),0);assert(await summary.evaluate(n=>n===document.activeElement));
   assert((await page.locator('.dd-shell').boundingBox()).height<=140,`${label} compact header ${width}`);
   await page.screenshot({path:path.join(output,`${label.replaceAll(' ','-')}-${width}.png`),fullPage:true});
  }
  if(label==='Lab'||label==='My Lab'){await page.locator('.dd-apps > summary').click();await page.locator('#methods').click();await page.locator('#drawer[open]').waitFor();await page.locator('#drawer .close').click();await page.waitForFunction(()=>document.activeElement===document.querySelector('.dd-apps > summary'));}
  await page.locator('.dd-skip').focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main-content');
  assert.deepEqual(failed,[]);assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({passed:true,pages:5,widths:[1440,768,390,320],checkedLinks,keyboard:true,syntheticSignedOut:true,screenshots:output}));
}finally{await browser.close();}
