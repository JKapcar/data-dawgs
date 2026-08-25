import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const server=http.createServer((req,res)=>{
  const file=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));
  if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end("no")}
  res.writeHead(200,{"Content-Type":file.endsWith(".js")?"text/javascript":file.endsWith(".json")?"application/json":"text/html"});
  res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(8916,resolve));
const {chromium}=loadPlaywright();
const browser=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]});
let pass=0;
const ok=(condition,message)=>{if(!condition)throw new Error(message);pass++};

try{
  const fresh=await browser.newContext();
  const page=await fresh.newPage();
  await page.goto("http://127.0.0.1:8916/dashboard.html#live");
  await page.waitForURL(/draft-leagues\.html\?return=/);
  ok(decodeURIComponent(new URL(page.url()).searchParams.get("return"))==="/dashboard.html#live","fresh return target was not preserved");
  await page.locator("#leagueList").getByText("JohnMaddenPepperoniNipplesXV",{exact:true}).waitFor();
  const card=page.locator('.league[data-id="pepperoninipples"]');
  ok(await card.count()===1,"seeded league card missing");
  await Promise.all([page.waitForURL(/dashboard\.html\?league=pepperoninipples#live/),card.getByText("Open",{exact:true}).click()]);
  await page.locator("#ddLeagueIndicator").getByText("JohnMaddenPepperoniNipplesXV",{exact:true}).waitFor();
  ok(/14 teams · yahoo/i.test(await page.locator("#ddLeagueIndicator").innerText()),"named league indicator missing");
  await fresh.close();

  const existing=await browser.newContext();
  await existing.addInitScript(()=>localStorage.setItem("dd-auction-v1",JSON.stringify({settings:{teams:[],budget:200,spots:17,scoring:"half"},picks:[]})));
  const oldLink=await existing.newPage();
  await oldLink.goto("http://127.0.0.1:8916/dashboard.html#live");
  await oldLink.waitForTimeout(800);
  ok(new URL(oldLink.url()).pathname.endsWith("dashboard.html"),"existing draft state was redirected");
  ok(new URL(oldLink.url()).hash==="#live","old live hash was lost");
  await existing.close();

  const warroom=await browser.newContext();
  const warPage=await warroom.newPage();
  await warPage.goto("http://127.0.0.1:8916/fantasy-warroom.html");
  await warPage.locator("#seededLeague").getByText("JohnMaddenPepperoniNipplesXV",{exact:true}).waitFor();
  ok(/Yahoo · 773763 · settings captured 8\/25 · rosters: not connected/.test(await warPage.locator("#seededLeague").innerText()),"war-room seeded league status missing");
  await warroom.close();
  console.log(`${pass} passed, 0 failed`);
} finally {
  await browser.close();
  server.close();
}
