const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.DD_NODE_MODULES,'playwright'));
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.DD_CHROMIUM?{executablePath:process.env.DD_CHROMIUM}:{})});const out=process.env.VAULT_SCREENSHOTS||'artifacts/owner-vault';fs.mkdirSync(out,{recursive:true});try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('dd-bozo-sess','synthetic-session'));
  await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='toto.jkapcar4.workers.dev'){
   assert.equal(route.request().headers()['x-dawg-session'],undefined);assert.equal(route.request().headers().authorization,'Bearer synthetic-session');const {op}=route.request().postDataJSON();
   const body=op==='status'?{is_owner:true,sharing_enabled:false,owner_uid:'u_synthetic'}:{files:[{file_id:'a'.repeat(64),head:'b'.repeat(64),versions:[{version_id:'b'.repeat(64),name:'Synthetic resume — prior version retained.txt',sha256:'c'.repeat(64),size:2048,committed_at:'2026-10-18T00:00:00Z'}]}],next_after:null};
   return route.fulfill({json:body,headers:{'Access-Control-Allow-Origin':'https://datadawgs216.com','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  }if(u.pathname==='/vault.html')return route.fulfill({contentType:'text/html',body:fs.readFileSync('vault.html')});if(u.pathname==='/vault-owner.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('vault-owner.js')});return route.abort();});
  await page.goto('https://datadawgs216.com/vault.html');await page.getByText('1 private files.',{exact:false}).waitFor();assert.equal(await page.locator('article').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');for(const id of ['refresh','save','target','fileInput']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.height>=44,id+' touch height');}
  await page.screenshot({path:path.join(out,'synthetic-'+width+'.png'),fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Owner vault synthetic browser checks passed at 320/390/1440px');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
