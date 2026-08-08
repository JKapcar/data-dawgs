/* The 🙃-to-the-footer move plus the new brown page field.
   Catches: a 🙃 still stuck in the nav, two of them, one that never renders because a
   page has no <footer>, one that lands under Ask Toto's fixed launcher, and a page whose
   background token did not get replaced. */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
let pass=0, fail=0;
const ok=(n,c,x)=>{c?(pass++):(fail++,console.log("  FAIL "+n+(x?"  — "+x:"")));};
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const server=http.createServer((req,res)=>{
  const f=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("no");}
  res.writeHead(200,{"Content-Type":f.endsWith(".js")?"text/javascript":f.endsWith(".json")?"application/json":"text/html"});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(8917,r));
const b=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]});
const PAGES=["auction.html","bigboard.html","board.html","bozo.html","connect.html","dashboard.html",
 "dataviz.html","dawgs.html","dfs.html","guillotine.html","index.html","master.html","nfelo.html",
 "pound.html","receipts.html","report.html","signon.html","stats.html","strategy.html","survivor.html"];
const errs=[];
for(const W of [1280,390,320]){
 for(const f of PAGES){
  const ctx=await b.newContext({viewport:{width:W,height:900}});
  const p=await ctx.newPage();
  p.on("pageerror",e=>errs.push(`${f}@${W}: ${e.message}`));
  await p.goto(`http://127.0.0.1:8917/${f}`,{waitUntil:"load"});
  /* Exercise the same persistent controller as the real theme button. board.html and
     bigboard.html intentionally re-render live draft state and re-apply the stored
     preference, so mutating data-theme directly is not a stable/user-reachable state. */
  await p.evaluate(()=>{
    if(window.DDTheme && window.DDTheme.current() !== "dark") window.DDTheme.toggle();
    else if(!window.DDTheme) document.documentElement.setAttribute("data-theme","dark");
  });
  await p.waitForTimeout(250);
  const r=await p.evaluate(async()=>{
    /* ⚠️ SCROLL FIRST. Ask Toto's launcher is position:fixed, so at scroll 0 a bottom-of-
       document 🙃 is nowhere near it and the overlap check passes vacuously. The real
       collision only exists at the FOOT of the scroll. The first version of this suite
       measured at scroll 0, passed 659/659, and missed a 14px overlap on 18 of 20 pages
       that was live in 52af998. Do not simplify this scroll away. */
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r=>setTimeout(r,300));
    const bs=document.querySelectorAll("#udBtn"), btn=bs[0];
    const nav=document.querySelector(".sitenav");
    const row=document.querySelector(".udfoot");
    const toto=document.querySelector("#ddbLaunch,.ddb-launch,[class*=ddb-launch]");
    const rb=btn?btn.getBoundingClientRect():null;
    const rt=toto?toto.getBoundingClientRect():null;
    const de=document.documentElement;
    return {
      count:bs.length,
      inNav: btn && nav ? nav.contains(btn) : null,
      inRow: btn && row ? row.contains(btn) : false,
      rowAfterFooter: (()=>{const ft=document.querySelector("footer");
        if(!ft||!row) return "nofooter";
        return ft.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING ? "after":"before";})(),
      w: rb?rb.width:0, h: rb?rb.height:0,
      visible: btn?getComputedStyle(btn).display!=="none":false,
      docTop: rb ? rb.top + window.scrollY : -1,
      bodyH: document.body.scrollHeight,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      pageTok: getComputedStyle(de).getPropertyValue("--page").trim(),
      surfTok: getComputedStyle(de).getPropertyValue("--surface-1").trim(),
      overlapToto: rb&&rt ? !(rb.right<rt.left||rb.left>rt.right||rb.bottom<rt.top||rb.top>rt.bottom) : false,
      hoverflow: de.scrollWidth > de.clientWidth + 1,
    };
  });
  const tag=`${f}@${W}`;
  ok(tag+" exactly one 🙃",r.count===1,"count="+r.count);
  ok(tag+" 🙃 not in the nav",r.inNav===false);
  ok(tag+" 🙃 sits in .udfoot",r.inRow===true);
  ok(tag+" .udfoot follows <footer>",r.rowAfterFooter!=="before",r.rowAfterFooter);
  ok(tag+" 🙃 has a box",r.w>10&&r.h>10,`${r.w}x${r.h}`);
  ok(tag+" 🙃 is in the bottom fifth of the page",r.docTop > r.bodyH*0.8,`${Math.round(r.docTop)} of ${r.bodyH}`);
  ok(tag+" 🙃 clear of Ask Toto",r.overlapToto===false);
  ok(tag+" page token is the new brown",r.pageTok==="#0b0802",r.pageTok);
  ok(tag+" boxes untouched",r.surfTok==="#16120d",r.surfTok);
  ok(tag+" body paints the brown",r.bodyBg==="rgb(11, 8, 2)",r.bodyBg);
  /* Five combos overflow sideways on origin/main already — measured identical before and
     after this change on 2026-08-08: bigboard 390 (+45) and 320 (+80), dataviz 320 (+21),
     dfs 320 (+9), guillotine 320 (+47). They are real bugs, they are not this one. */
  const KNOWN=new Set(["bigboard.html@390","bigboard.html@320","dataviz.html@320","dfs.html@320","guillotine.html@320"]);
  if(!KNOWN.has(tag)) ok(tag+" no sideways scroll",r.hoverflow===false);
  await ctx.close();
 }
}
/* the overlay still opens and closes from its new home */
{
 const ctx=await b.newContext({viewport:{width:1280,height:900}});
 const p=await ctx.newPage(); p.on("pageerror",e=>errs.push("toggle: "+e.message));
 await p.goto("http://127.0.0.1:8917/pound.html",{waitUntil:"load"});
 await p.waitForTimeout(300);
 await p.locator("#udBtn").scrollIntoViewIfNeeded();
 await p.locator("#udBtn").click();
 await p.waitForTimeout(400);
 ok("overlay opens from the footer button", await p.evaluate(()=>!!document.querySelector(".ud-ov.on")));
 ok("overlay field matches the new brown", (await p.evaluate(()=>getComputedStyle(document.querySelector(".ud-ov")).backgroundColor))==="rgb(11, 8, 2)");
 await p.keyboard.press("Escape"); await p.waitForTimeout(300);
 ok("Escape still closes it", await p.evaluate(()=>!document.querySelector(".ud-ov.on")));
 await ctx.close();
}
ok("no script errors anywhere",errs.length===0,errs.slice(0,4).join(" | "));
await b.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
