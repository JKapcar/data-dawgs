/* Bozo league access UI: authenticated search + shared password.
   Real pages in a real browser; only the Worker is faked.

   Run: cd work && node test-league-join-ui.mjs
*/
import { chromiumExecutable, loadPlaywright } from "./playwright-loader.mjs";
import http from "http"; import fs from "fs"; import path from "path";
import { fileURLToPath } from "url";
const { chromium } = loadPlaywright();

let pass=0, fail=0;
const ok=(n,c,x)=>{if(c){pass++;console.log("  ok   "+n);}else{fail++;console.log("  FAIL "+n+(x?" — "+x:""));}};
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const server=http.createServer((req,res)=>{
  const f=path.join(ROOT,decodeURIComponent(req.url.split("?")[0]));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("no");}
  res.writeHead(200,{"Content-Type":f.endsWith(".js")?"text/javascript":f.endsWith(".json")?"application/json":"text/html"});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(8921,r));
const b=await chromium.launch({executablePath:chromiumExecutable(chromium),args:["--no-sandbox"]});
const b64url=s=>Buffer.from(s,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const SESSION=b64url(JSON.stringify({n:"Sam",e:Date.now()+864e5,p:0}))+".sig";
let joined=false, lastPassword="";

async function pageAt(file,viewport={width:1280,height:900}){
  const ctx=await b.newContext({viewport});
  const p=await ctx.newPage(), errs=[];
  p.on("pageerror",e=>errs.push(e.message));
  await p.addInitScript(sess=>{localStorage.setItem("dd-bozo-sess",sess);localStorage.setItem("dd-auth-profile-v1",JSON.stringify({name:"Sam",email:"sam@example.com",emailVerified:true}));},SESSION);
  await p.route("https://toto.jkapcar4.workers.dev/**",route=>{
    const u=new URL(route.request().url()), method=route.request().method();
    const body=route.request().postDataJSON?.()||{};
    const j=(o,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(o)});
    if(u.pathname==="/auth/roster")return j({players:[{name:"Sam",claimed:true}]});
    if(u.pathname==="/league/mine")return j({leagues:[]});
    if(u.pathname==="/league/search"&&method==="POST"){
      const all=[{id:"main",name:"Bozo Boyz",manager:"Kap",size:8,already:true,visibility:"public"},{id:"preseason-bozo-boyz",name:"Preseason Bozo Boyz",manager:"Kap",size:8,already:false,visibility:"private"}];
      const q=String(body.query||"").toLowerCase(),results=q?all.filter(x=>x.name.toLowerCase().includes(q)):all;
      return j({results,total:results.length,limit:20});
    }
    if(u.pathname==="/league/join"&&method==="POST"){
      lastPassword=body.password;
      if(body.password!=="Correct Horse")return j({error:"That league password is not valid."},403);
      joined=true;return j({ok:true,league:"preseason-bozo-boyz",name:"Preseason Bozo Boyz",size:9});
    }
    if(u.pathname==="/league/list")return j({leagues:[],defaultLeague:"main",signedIn:true});
    if(u.pathname==="/league/access")return j({ok:true,passwordEnabled:true,cap:20,size:8,visibility:"private",visibilityLocked:false});
    return j({error:"unexpected "+u.pathname},500);
  });
  await p.goto("http://127.0.0.1:8921/"+file,{waitUntil:"load"});
  await p.waitForTimeout(800);
  return {p,ctx,errs};
}

{
  joined=false;lastPassword="";
  const {p,ctx,errs}=await pageAt("signon.html#dawgs");
  await p.waitForTimeout(200);
  ok("signed-in page fills the league dropdown",await p.locator("#leagueDirectory option").count()===3);
  await p.fill("#leagueSearch","Preseason Bozo Boyz");await p.click("#leagueSearchGo");await p.waitForTimeout(200);
  ok("exact search selects the private league",await p.isVisible("#leaguePasswordWrap")&&(await p.textContent("#leagueSelectedName"))==="Preseason Bozo Boyz");
  await p.fill("#leaguePassword","Correct Horse");await p.click("#leagueJoinGo");await p.waitForTimeout(250);
  ok("shared password joins the selected league",joined&&lastPassword==="Correct Horse");
  ok("success exposes the league, not the password",(await p.getAttribute("#leagueOpen","href"))==="bozo.html?l=preseason-bozo-boyz"&&!(await p.textContent("body")).includes("Correct Horse"));
  ok("sign-on flow has no page errors",errs.length===0,errs[0]);
  await ctx.close();
}

{
  const {p,ctx}=await pageAt("signon.html#dawgs");
  await p.fill("#leagueSearch","unknown");await p.click("#leagueSearchGo");await p.waitForTimeout(150);
  ok("no match leaves a clear empty dropdown",/no leagues match/i.test(await p.textContent("#leagueSearchResults")));
  await ctx.close();
}

{
  const {p,ctx}=await pageAt("signon.html#dawgs",{width:390,height:844});
  await p.fill("#leagueSearch","Preseason Bozo Boyz");await p.click("#leagueSearchGo");await p.waitForTimeout(150);
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  ok("search and password controls fit a phone viewport",!overflow);
  await ctx.close();
}

{
  const {p,ctx,errs}=await pageAt("bozo.html");
  const ids=await p.evaluate(()=>["lpPass","lpSet","lpOff","lpState","lpCap","lpCapGo","lpVis","lpVisGo"].map(id=>!!document.getElementById(id)));
  ok("League Settings exposes password, cap and visibility controls",ids.every(Boolean),JSON.stringify(ids));
  const retired=await p.evaluate(()=>["invGo","jlGet","jlRot","jcSet","addPick","addGo"].some(id=>!!document.getElementById(id)));
  ok("pre-add, per-person and reusable-link controls are absent",!retired);
  const wired=await p.evaluate(()=>!!document.getElementById("lpSet").onclick&&!!document.getElementById("lpVisGo").onclick);
  ok("new manager controls are wired",wired);
  ok("Bozo page has no page errors",errs.length===0,errs[0]);
  await ctx.close();
}

await b.close();server.close();
console.log("\nleague-access-ui: "+pass+" passed, "+fail+" failed");
if(fail)process.exit(1);
