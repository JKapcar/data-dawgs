import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import http from 'node:http';import path from 'node:path';
import {loadPlaywright,chromiumExecutable} from './playwright-loader.mjs';
const root=path.resolve(import.meta.dirname,'..'),live=process.env.NAV_LIVE_URL;
const pages=readdirSync(root).filter(f=>f.endsWith('.html')&&readFileSync(path.join(root,f),'utf8').includes('const NAV = ['));
for(const f of pages){const s=readFileSync(path.join(root,f),'utf8');for(const link of ['["dawg-pound.html","Dispatch","dawg-pound"]','["research-lab/","Big Data Bowl research lab"'])assert.equal(s.split(link).length-1,1,f);}
const server=http.createServer((req,res)=>{let name=new URL(req.url,'http://local').pathname;if(name.endsWith('/'))name+='index.html';const file=path.join(root,name);if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));});
if(!live)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=live||`http://127.0.0.1:${server.address().port}`,{chromium}=loadPlaywright(),browser=await chromium.launch({executablePath:chromiumExecutable(chromium)});
try{for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600});await page.goto(base+'/index.html');await page.locator('.navgrp').first().waitFor();
 for(const [group,label,href] of [['Dawgs','Dispatch','dawg-pound.html'],['NFL','Big Data Bowl research lab','research-lab/']]){
  const trigger=page.locator('.grpbtn').filter({hasText:new RegExp('^'+group+'\\s')});
  if(width===1440)await trigger.hover();
  await trigger.focus();await page.keyboard.press('ArrowDown');const link=page.getByRole('link',{name:label,exact:true});assert(await link.isVisible());assert.equal(await link.getAttribute('href'),href);
  const box=await link.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,`${width} ${label} bounds`);
  await page.keyboard.press('Escape');assert(await trigger.evaluate(e=>document.activeElement===e));assert(!(await link.isVisible()),'Escape must suppress hover');
  if(width<600){await trigger.tap();assert(await link.isVisible());await page.touchscreen.tap(10,850);}
 }
 await page.goto(base+'/research-lab/');assert.equal(await page.getByRole('link',{name:'My private lab',exact:true}).getAttribute('href'),'private.html');assert.equal(await page.getByRole('link',{name:'Private ZIP uploader',exact:true}).getAttribute('href'),'upload.html');
 await page.goto(base+'/research-lab/upload.html');assert.equal(await page.getByRole('link',{name:'My private lab',exact:true}).getAttribute('href'),'private.html');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();
}console.log(JSON.stringify({passed:true,sharedPages:pages.length,widths:[1440,390,320],keyboard:'ArrowDown/Escape/focus',touch:true,live:!!live}));}finally{await browser.close();if(!live)await new Promise(r=>server.close(r));}

