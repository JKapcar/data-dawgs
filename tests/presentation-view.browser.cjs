const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/*',r=>{
  const u=new URL(r.request().url());if(u.origin!=='http://preview.local')return r.fulfill({json:{events:[],data:[]}});
  const p=path.join(root,u.pathname);if(!fs.existsSync(p))return r.fulfill({status:404,body:''});
  // Keep the real shared nav and app scripts on Arena; mock only data providers.
  if(u.pathname==='/data/surfaces.json')return r.fulfill({json:{as_of:'2026-10-22',source:'Synthetic fixture',data:[]}});
  return r.fulfill({path:p});
 });
 const page=await context.newPage(),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:844});await page.goto('http://preview.local/arena.html');
  assert.equal(await page.locator('.sitenav .dd-presentation').count(),1);
  if(width<=760)await page.locator('.navgrp').last().locator('.grpbtn').click();
  const view=page.getByText('View',{exact:true});await view.click();
  const box=await page.locator('.dd-view-menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  await page.getByRole('button',{name:'AI / technical details',exact:true}).click();assert.equal(await page.locator('#machines').isVisible(),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.dd-presentation').getAttribute('open'),null);
  assert.equal(await view.evaluate(e=>e===document.activeElement),true);
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-dd-view'),'agent');
  if(width<=760)await page.locator('.navgrp').last().locator('.grpbtn').click();
  await view.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'TL;DR',exact:true}).click();
  assert.equal(await page.locator('#machines').isVisible(),false);
  assert.equal(await page.locator('main > .p-disclosure').isVisible(),true);
  await page.keyboard.press('Escape');
  results.push({width,menuBox:box,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)});
  fs.mkdirSync(path.join(root,'work/artifacts/bozo-loading'),{recursive:true});await page.screenshot({path:path.join(root,`work/artifacts/bozo-loading/view-${width}.png`)});
 }
 await page.goto('http://preview.local/arena.html#machines');assert.equal(await page.locator('#machines').isVisible(),true);
 await page.goto('http://preview.local/datedawg.html');assert.equal(await page.locator('.dd-presentation').count(),1);
 assert.deepEqual(errors,[]);console.log(JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
