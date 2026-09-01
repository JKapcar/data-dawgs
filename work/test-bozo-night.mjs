/* Midnight Midway contract: static invariants, live panel states, responsive nav and shots.
   Run from the repo root: node work/test-bozo-night.mjs */
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import {chromiumExecutable} from "./playwright-loader.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "bozo.html"), "utf8");
const origin = execFileSync("git", ["show", "origin/main:bozo.html"], {
  encoding:"utf8", maxBuffer:64*1024*1024
});
let pass=0, fail=0;
const ok=(name,cond,detail="")=>cond?(pass++,console.log("  ok   "+name)):
  (fail++,console.log("  FAIL "+name+(detail?" - "+detail:"")));

const style = (html.match(/<style>([\s\S]*?)<\/style>/)||[])[1] || "";
const cssCode = style.replace(/\/\*[\s\S]*?\*\//g, "");
ok("theme has no :root[data-theme=dark] selector", !/:root\[data-theme=["']dark["']\]/.test(style));
ok("theme has no prefers-color-scheme CSS block", !/@media\s*\(prefers-color-scheme/.test(cssCode));
for(const token of [
  "--pb-stock:#0d100c", "--pb-ink:#cfd3bd", "--pb-ink2:#8b9179",
  "--pb-ink3:#5d6251", /* nearest same-hue lift that clears the stated 3:1 floor */
  "--pb-red:#b6421a", "--pb-rule:rgba(207,211,189,.10)",
  "--pb-edge:#241a0d", "--pb-shadow:rgba(0,0,0,.46)"
]) ok("base playbill carries "+token, html.includes(token));

const slipBlock=s=>(s.match(/\/\* the slip stays paper in both themes[^\n]*\*\/\s*([^}]+?)\n}/)||[])[1];
ok("dark slip tokens are byte-identical to origin/main", slipBlock(html)===slipBlock(origin));
const lum=h=>{
  const a=h.match(/../g).map(x=>parseInt(x,16)/255)
    .map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return .2126*a[0]+.7152*a[1]+.0722*a[2];
};
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
ok("pb-ink2 contrast is at least 4.5:1", contrast("8b9179","0d100c")>=4.5);
ok("pb-ink3 contrast is at least 3:1", contrast("5d6251","0d100c")>=3);
ok("dark theme-color matches page ground",
  html.includes('<meta name="theme-color" content="#070a08" media="(prefers-color-scheme: dark)">') &&
  html.includes("--surface-1:#241c12; --page:#070a08;"));
ok("exactly one off-bulb rail recipe exists",
  (html.match(/radial-gradient\(circle at 13px 8px/g)||[]).length===1);
ok("fog is one pointer-events-none overlay with two corner gradients",
  /body::after\{[^}]*pointer-events:none[^}]*radial-gradient\([^)]*bottom left[^}]*radial-gradient\([^)]*bottom right/s.test(style));

const server=http.createServer((req,res)=>{
  const rel=decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"");
  const f=path.resolve(ROOT,rel||"index.html");
  if(!f.startsWith(ROOT+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){
    res.writeHead(404); return res.end("no");
  }
  res.writeHead(200,{"Content-Type":f.endsWith(".js")?"text/javascript":f.endsWith(".json")?"application/json":"text/html"});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(8931,"127.0.0.1",r));
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]});

async function localContext(options={}){
  const ctx=await browser.newContext(options);
  await ctx.route("**/*",route=>route.request().url().startsWith("http://127.0.0.1:8931/")?route.continue():route.abort());
  return ctx;
}
async function navMeasure(file){
  const ctx=await localContext({viewport:{width:390,height:844}}), p=await ctx.newPage();
  await p.goto(`http://127.0.0.1:8931/${file}`,{waitUntil:"load"});
  await p.waitForTimeout(120);
  const m=await p.evaluate(()=>{
    const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON()||null;
    return {sw:document.documentElement.scrollWidth,iw:innerWidth,auth:rect(".navauth .authbtn"),theme:rect(".theme-btn")};
  });
  await ctx.close(); return m;
}
for(const file of ["bozo.html","index.html","signon.html","challenge.html","stats.html"]){
  const m=await navMeasure(file);
  ok(`${file} fits the 390px viewport`,m.sw===390,`${m.sw}`);
  if(file==="bozo.html"){
    ok("phone sign-in chip is within viewport",m.auth&&m.auth.left>=0&&m.auth.right<=390,JSON.stringify(m.auth));
    ok("phone theme button is within viewport",m.theme&&m.theme.left>=0&&m.theme.right<=390,JSON.stringify(m.theme));
  }
}

const ctx=await localContext({viewport:{width:1440,height:900}}), page=await ctx.newPage();
const pageErrors=[]; page.on("pageerror",e=>pageErrors.push(e.message));
await page.goto("http://127.0.0.1:8931/bozo.html",{waitUntil:"load"});
await page.waitForTimeout(250);

const models=await page.evaluate(()=>{
  const M=window.DDBozoTonightModel;
  const picks={Kap:{price:-245,ts:100},Butts:{price:-118,ts:200},JWhite:{price:-135,ts:300}};
  return {
    zero:M([],{},"open",null,{}),
    one:M(["Kap"],{Kap:picks.Kap},"open",null,{}),
    open:M(["Kap","Butts","JWhite"],picks,"open",null,{}),
    tie:M(["Kap","Butts"],{Kap:{price:-245,ts:100},Butts:{price:-245,ts:100}},"open",null,{}),
    placedOdds:M(["Kap","Butts","JWhite"],picks,"placed",[1,3,0,2],{}),
    placedLast:M(["Kap","Butts","JWhite"],picks,"placed",[1,3,2,0],{}),
    graded:M(["Kap","Butts"],picks,"graded",[0,2],{Kap:{won:false}}),
    partial:M(["Kap","Butts"],picks,"placed",[0,2],{Kap:{won:false}})
  };
});
ok("panel is absent with zero filed legs",models.zero===null);
ok("panel is absent with one filed leg",models.one===null);
ok("open card returns independent standings",models.open?.state==="open"&&models.open.standings.length===2);
ok("Shortest odds names the minimum-price leg",models.open?.standings[0].leaders[0].p==="Kap");
ok("Last in names the latest timestamp",models.open?.standings[1].leaders[0].p==="JWhite");
ok("equal prices and timestamps remain ties",models.tie?.standings.every(x=>x.leaders.length===2));
ok("locked order skips uncomputable levers to Shortest odds",models.placedOdds?.first.key==="odds");
ok("locked order can resolve first to Last in",models.placedLast?.first.key==="last");
ok("graded or partially graded cards suppress the hypothetical",models.graded===null&&models.partial===null);

async function installFixture(p,{status="open",order=null,tie=false}={}){
  await p.evaluate(({status,order,tie})=>{
    LEAGUES=[{id:"main",name:"Bozo Boyz",manager:"Kap",size:3,members:["Kap","Butts","JWhite"],week:1,status,settings:{stake:16,format:"standard"}}];
    LID="main"; ME=null;
    S={week:1,status,order,config:{bandCeil:-100,bandFloor:-500},picks:{
      Kap:{price:-245,ts:100,label:"Tennessee ML",sport:"nfl",game:"TEN at DEN",mkt:"ml"},
      Butts:{price:tie?-245:-118,ts:tie?100:200,label:"Ravens -6.5",sport:"nfl",game:"BAL at CLE",mkt:"spread"},
      JWhite:{price:-135,ts:300,label:"Georgia -13.5",sport:"cfb",game:"UGA at UK",mkt:"spread"}
    },results:{}};
    paintHub();
  },{status,order,tie});
}
await installFixture(page);
const openPanel=await page.locator("#bozoTonight").textContent();
ok("open DOM contains the visible all-legs-lose assumption",/assumes every currently filed leg loses/i.test(openPanel||""));
ok("open DOM says there is no running order before lock",/No running order exists before the card locks/i.test(openPanel||""));
ok("open DOM does not present Worst Beat or Worst CLV as live",!/(Worst Beat|Worst CLV)/i.test(openPanel||""));

const rmCtx=await localContext({viewport:{width:390,height:844},reducedMotion:"reduce"}), rm=await rmCtx.newPage();
await rm.goto("http://127.0.0.1:8931/bozo.html",{waitUntil:"load"});
const animations=await rm.evaluate(()=>{
  const hub=document.querySelector("#hubCard"), machine=document.querySelector(".machine");
  return [getComputedStyle(hub,"::before").animationName,getComputedStyle(hub,"::after").animationName,
    getComputedStyle(document.body,"::after").animationName,machine?getComputedStyle(machine,"::before").animationName:"none"];
});
ok("no night ornament or machine animation runs under reduced motion",animations.every(x=>x==="none"),animations.join(","));
await rmCtx.close();

// Required review frames. work/*.png is ignored; these are for visual QA and PR upload.
await page.evaluate(()=>{document.documentElement.dataset.theme="dark";localStorage.setItem("dd-theme","dark");});
await page.setViewportSize({width:1440,height:900});
await installFixture(page);
await page.screenshot({path:path.join(ROOT,"work","bozo-night-1440.png"),fullPage:true});
ok("desktop night screenshot written",fs.statSync(path.join(ROOT,"work","bozo-night-1440.png")).size>10000);
await page.setViewportSize({width:390,height:844});
await installFixture(page);
await page.screenshot({path:path.join(ROOT,"work","bozo-night-390.png"),fullPage:true});
ok("phone night screenshot written",fs.statSync(path.join(ROOT,"work","bozo-night-390.png")).size>10000);
await page.setViewportSize({width:1440,height:900});
await page.evaluate(()=>{document.documentElement.dataset.theme="light";localStorage.setItem("dd-theme","light");});
await installFixture(page);
await page.screenshot({path:path.join(ROOT,"work","bozo-light-1440.png"),fullPage:true});
ok("desktop light screenshot written",fs.statSync(path.join(ROOT,"work","bozo-light-1440.png")).size>10000);
ok("no page script errors",pageErrors.length===0,pageErrors.join(" | "));

await ctx.close(); await browser.close(); server.close();
console.log(`\n${pass} assertions passed, ${fail} failed`);
process.exit(fail?1:0);
