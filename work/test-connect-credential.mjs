// Connect Your Dawg credential panel: private URL primary, optional header form, same token, rotate.
// Synthetic only — the Worker is mocked and the token is invented. Run: node test-connect-credential.mjs
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const { chromium }=loadPlaywright(); let pass=0,fail=0; const ok=(n,c,x)=>c?(pass++,console.log("  ok   "+n)):(fail++,console.log("  FAIL "+n+(x?" — "+x:"")));
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const server=http.createServer((req,res)=>{const f=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end("no");}res.writeHead(200,{"Content-Type":f.endsWith(".js")?"text/javascript":f.endsWith(".md")?"text/markdown":f.endsWith(".css")?"text/css":"text/html"});res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(8906,r));
const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url"),session=b64({u:"u_test",n:"Known",e:Date.now()+864e5,p:0})+".sig";
const TOKENS=["u_synthetic-first-not-real","u_synthetic-second-not-real"];let mints=0;const aiKeys={};
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]});const ctx=await browser.newContext({viewport:{width:1200,height:950}});
await ctx.route("**/toto.jkapcar4.workers.dev/**",route=>{const u=new URL(route.request().url()),body=route.request().postDataJSON?.()||{};const send=(j,s=200)=>route.fulfill({status:s,contentType:"application/json",body:JSON.stringify(j)});
  if(u.pathname==="/auth/lookup")return send({ok:true,known:true});if(u.pathname==="/auth/login")return send({ok:true,uid:"u_test",name:"Known",email:body.email,emailVerified:true,session});if(u.pathname==="/league/mine")return send({ok:true,leagues:[]});
  if(u.pathname==="/auth/mcp-token"&&body.action==="list")return send({ok:true,primary:mints>0,keys:Object.keys(aiKeys).map(label=>({label,ts:1760000000000}))});
  if(u.pathname==="/auth/mcp-token"&&body.action==="add"){const token="u_synthetic-"+body.label.toLowerCase()+"-key";aiKeys[body.label]=token;return send({ok:true,label:body.label,token,endpoint:"https://toto.jkapcar4.workers.dev/mcp/core",header:"Authorization: Bearer "+token});}
  if(u.pathname==="/auth/mcp-token"&&body.action==="remove"){delete aiKeys[body.label];return send({ok:true,label:body.label,removed:true});}
  if(u.pathname==="/auth/mcp-token"&&body.action==="mint"){const token=TOKENS[mints++];return send({ok:true,player:"Known",token,url:"https://toto.jkapcar4.workers.dev/mcp/"+token});}
  if(u.pathname==="/auth/mcp-token")return send({ok:true,revoked:true});return send({error:"unrouted "+u.pathname},404);});
const p=await ctx.newPage();const errors=[];p.on("pageerror",e=>errors.push(e.message));await p.goto("http://127.0.0.1:8906/signon.html",{waitUntil:"load"});await p.waitForTimeout(300);
await p.fill("#sEmail","known@example.com");await p.click("#lookupGo");await p.waitForTimeout(100);await p.fill("#sPw","password1");await p.click("#sGo");await p.waitForTimeout(250);await p.click('[data-sheet="connect"]');
ok("rotate is hidden until a credential exists",await p.locator("#cRotate").isHidden());
await p.click("#cMint");await p.waitForTimeout(150);
ok("endpoint is the full catalog without a credential",await p.locator("#cEndpoint").inputValue()==="https://toto.jkapcar4.workers.dev/mcp/full");
ok("header form carries the token",await p.locator("#cHeader").inputValue()==="Authorization: Bearer "+TOKENS[0]);
ok("private URL carries the same token under /mcp/full/",await p.locator("#cUrl").inputValue()==="https://toto.jkapcar4.workers.dev/mcp/full/"+TOKENS[0]);
const order=await p.evaluate(()=>{const a=document.getElementById("cHeader"),b=document.getElementById("cUrl");return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_PRECEDING);});ok("private URL is shown before advanced header form",order);
ok("rotate sits beside mint once a credential exists",await p.locator("#cRotate").isVisible()&&await p.locator("#cMint").isHidden());
for(const prov of ["claude","gemini","grok","muse"]){await p.selectOption("#providerChoice",prov);ok(prov+" setup note is available",(await p.locator("#stepAddP").innerText()).length>50);}
ok("public guide marks provider compatibility untested",/not yet tested end to end/.test(await p.locator("#connectionGuide").innerText()));
ok("the warning names issues, PRs, screenshots and shared docs",/issue, a pull request, a screenshot, a shared doc/.test(await p.locator("#pConnect").innerText()));
p.once("dialog",d=>d.dismiss());await p.click("#cRotate");await p.waitForTimeout(150);ok("dismissed rotate does not mint",mints===1&&await p.locator("#cHeader").inputValue().then(v=>v.endsWith(TOKENS[0])));
p.once("dialog",d=>d.accept());await p.click("#cRotate");await p.waitForTimeout(150);ok("confirmed rotate replaces both forms together",mints===2&&(await p.locator("#cHeader").inputValue()).endsWith(TOKENS[1])&&(await p.locator("#cUrl").inputValue()).endsWith("/mcp/full/"+TOKENS[1]));
for(const width of [390,320]){await p.setViewportSize({width,height:800});await p.waitForTimeout(100);const wide=await p.evaluate(w=>[...document.querySelectorAll("#pConnect *")].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>w+1).map(e=>e.id||e.className||e.tagName).slice(0,5),width);ok("connect panel fits "+width+"px",wide.length===0,wide.join(","));}
// Per-AI key: created without touching the primary credential, shown once, listed, removable alone.
await p.fill("#kLabel","Muse");await p.click("#kAdd");await p.waitForTimeout(150);
ok("per-AI key shows server URL and key",await p.locator("#kEndpoint").inputValue()==="https://toto.jkapcar4.workers.dev/mcp/core"&&await p.locator("#kToken").inputValue()==="u_synthetic-muse-key");
ok("primary credential untouched by a per-AI key",(await p.locator("#cHeader").inputValue()).endsWith(TOKENS[1])&&mints===2);
ok("per-AI key listed",/Muse/.test(await p.locator("#kList").innerText()));
await p.fill("#kLabel","bad label!");await p.click("#kAdd");await p.waitForTimeout(100);ok("bad label refused locally",/1-24 letters/.test(await p.locator("#kMsg").innerText()));
p.once("dialog",d=>d.accept());await p.locator("#kList button").first().click();await p.waitForTimeout(150);ok("removing a per-AI key leaves the list empty",!aiKeys.Muse&&!/Muse/.test(await p.locator("#kList").innerText()));
for(const width of [390,320]){await p.setViewportSize({width,height:800});await p.waitForTimeout(100);const wide=await p.evaluate(w=>[...document.querySelectorAll("#aiKeys *")].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().right>w+1).map(e=>e.id||e.tagName).slice(0,5),width);ok("per-AI keys card fits "+width+"px",wide.length===0,wide.join(","));}
await p.setViewportSize({width:1200,height:950});
await p.click("#cRevoke");await p.waitForTimeout(150);ok("turning it off clears both forms",await p.locator("#cUrlBox").isHidden()&&await p.locator("#cHeader").inputValue()===""&&await p.locator("#cUrl").inputValue()==="");
ok("no script errors",errors.length===0,errors.join(" | "));
await browser.close();server.close();console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
