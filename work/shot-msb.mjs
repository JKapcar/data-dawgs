/* Stage MS-B. Renders receipts.html#models in both themes, prints the counts that matter,
   and writes a full-page screenshot per theme. Run from the REPO ROOT:
     node work/shot-msb.mjs        (writes /tmp/msb-<theme>.png; override with DD_SHOT_DIR)
   Needs playwright: npm install playwright --no-save (Chromium is already on disk).
   ⚠️ KEEP LOOKING AT THE OUTPUT. Both real defects in this stage -- a literal "&times;"
   printed into the prose, and the Ask Toto chip covering the withheld-line disclosure --
   were found in a screenshot and by nothing else. document.scrollWidth read clean for both,
   and every numeric assertion passed. */
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();
const SHOTS = process.env.DD_SHOT_DIR || "/tmp";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME={".html":"text/html",".js":"text/javascript",".json":"application/json",".css":"text/css",".md":"text/markdown",".xml":"application/xml",".txt":"text/plain",".jpg":"image/jpeg",".png":"image/png",".mp4":"video/mp4",".webm":"video/webm",".m4a":"audio/mp4"};
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split("?")[0]);
  const f=path.join(ROOT,u==="/"?"index.html":u);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("nf")}
  res.writeHead(200,{"content-type":MIME[path.extname(f)]||"application/octet-stream"});res.end(fs.readFileSync(f))});
await new Promise(r=>server.listen(8933,r));
const b=await chromium.launch({executablePath:chromiumExecutable(chromium)});
for(const theme of ["dark","light"]){
  const ctx=await b.newContext({viewport:{width:1280,height:1000}});await ctx.addInitScript(t=>{localStorage.setItem("dd-theme2",t);localStorage.setItem("dd-theme",t)},theme);const p=await ctx.newPage();
  await p.goto("http://127.0.0.1:8933/receipts.html#models",{waitUntil:"networkidle"});
  
  const diag=await p.evaluate(()=>{
    const t=id=>document.getElementById(id);
    return {
      boardRows:t("boardTable")?.querySelectorAll("tbody tr").length,
      boardCols:t("boardTable")?.querySelectorAll("thead th").length,
      boardHidden:t("boardTable")?.hidden,
      corrRows:t("corrTable")?.querySelectorAll("tbody tr").length,
      scoreRows:t("scoreTable")?.querySelectorAll("tbody tr").length,
      scoreCols:t("scoreTable")?.querySelectorAll("thead th").length,
      heads:[...(t("scoreTable")?.querySelectorAll("thead th")||[])].map(x=>x.textContent),
      summary:[...document.querySelectorAll("#scoreSummary .p-stat")].map(x=>x.textContent.trim()),
      err:t("boardLoad")?.className,
      linearAnywhere:document.getElementById("sheetModels").innerText.includes("linear"),
      linearId:document.getElementById("sheetModels").innerHTML.includes("ddpr-nfl-linear"),
      docScrollW:document.documentElement.scrollWidth,
      wrapScroll:[...document.querySelectorAll("#sheetModels .p-table-wrap")].map(w=>w.scrollWidth-w.clientWidth),
    };
  });
  console.log(theme, JSON.stringify(diag,null,1));
  await p.screenshot({path:`${SHOTS}/msb-${theme}.png`,fullPage:true});
  await p.close();await ctx.close();
}
await b.close();server.close();
