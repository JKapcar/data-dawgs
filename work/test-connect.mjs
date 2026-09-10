import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const { chromium }=loadPlaywright(); let pass=0,fail=0; const ok=(n,c,x)=>c?(pass++,console.log("  ok   "+n)):(fail++,console.log("  FAIL "+n+(x?" — "+x:"")));
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const server=http.createServer((req,res)=>{const f=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end("no");}res.writeHead(200,{"Content-Type":f.endsWith(".js")?"text/javascript":"text/html"});res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(8903,r)); const b=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]}); const p=await b.newPage();
await p.goto("http://127.0.0.1:8903/connect.html?next=bozo.html",{waitUntil:"load"});
await p.waitForURL("**/signon.html?next=bozo.html#connect",{timeout:4000}).catch(()=>{});
ok("connect.html redirects to the folded-in Connect sheet",/signon\.html/.test(p.url())&&p.url().includes("#connect"),p.url());
ok("query parameters survive the redirect",p.url().includes("next=bozo.html"),p.url());
const source=fs.readFileSync(path.join(ROOT,"connect.html"),"utf8");
ok("redirect has a canonical target",/rel="canonical"[^>]+signon\.html#connect/.test(source));
ok("redirect contains no identity or credential routes",!/auth\/|mcp-token|X-Dawg-Session/.test(source));
// ---- the connector honesty blocks -------------------------------------------------
// The mint/rotate controls live on signon.html's "Connect Your Dawg" sheet, not on the
// connect.html stub, so the disclosure has to be asserted where a member actually reads
// it. A personal /mcp/u_<token> URL can WRITE (dd_submit_bozo_leg, sd_*), and the page
// used to imply otherwise — that is the regression these four guard.
await p.goto("http://127.0.0.1:8903/signon.html",{waitUntil:"load"});
const seen = async () => p.$$eval(".honesty", ns => ns.filter(n => n.offsetParent !== null).map(n => n.textContent.replace(/\s+/g," ").trim()));

const out = await seen();
ok("both honesty blocks render signed-out", out.length===2, `saw ${out.length}`);

// #sMe is revealed by the auth flow against the live Worker, which a local file server
// cannot do. Un-hide the member section and its Connect panel the way sign-in would,
// then assert the same two blocks are in the sheet that carries the mint button.
await p.evaluate(()=>{document.getElementById("signedOut").hidden=true;document.getElementById("signedOut").style.display="none";document.getElementById("sMe").hidden=false;document.getElementById("pDawgs").hidden=true;document.getElementById("pConnect").hidden=false;});
const inn = await seen();
ok("both honesty blocks render signed-in on the Connect sheet", inn.length===2, `saw ${inn.length}`);
ok("the honesty block sits above the mint control",
   await p.evaluate(()=>{const h=document.querySelector("#pConnect .honesty"),m=document.getElementById("cMint");
     return !!h&&!!m&&(h.compareDocumentPosition(m)&Node.DOCUMENT_POSITION_FOLLOWING)>0;}));

// The specific words. "reads as you" was already implied; "submit your Bozo leg" is the
// capability nobody had written down.
ok("names the write capability in plain words", inn.some(t=>t.includes("submit your Bozo leg")), inn.join(" | "));
ok("points builders at the unauthenticated surface", inn.some(t=>t.includes("data/index.json")));

// Root-relative, not sheet-relative: signon.html is served from / but the link has to
// keep working from any page this markup is ever copied onto.
// $$eval, not $eval: a missing link is a FAIL line, not an uncaught throw that hides
// every assertion after it.
const hrefs = await p.$$eval(".honesty a", ns=>ns.map(a=>a.getAttribute("href")));
ok("the data/index.json link resolves relative to site root", hrefs.includes("/data/index.json"), hrefs.join(" | "));
ok("the data/ directory link is root-relative too", hrefs.includes("/data/"), hrefs.join(" | "));

await b.close();server.close();console.log(`\n${pass} passed, ${fail} failed\n`);if(fail)process.exit(1);
