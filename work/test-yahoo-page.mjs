import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const html=fs.readFileSync(path.join(ROOT,"fantasy-warroom.html"),"utf8");
const providers=fs.readFileSync(path.join(ROOT,"draft-providers.js"),"utf8");
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++};

function liftFunction(src,name){
  const at=src.indexOf("async function "+name+"(");
  if(at<0)throw new Error(name+" not found");
  let i=src.indexOf("{",at),depth=0,quote=null,line=false,block=false,escape=false;
  for(;i<src.length;i++){
    const c=src[i],next=src[i+1];
    if(line){if(c==="\n")line=false;continue}
    if(block){if(c==="*"&&next==="/"){block=false;i++}continue}
    if(quote){if(escape){escape=false;continue}if(c==="\\"){escape=true;continue}if(c===quote)quote=null;continue}
    if(c==="/"&&next==="/"){line=true;i++;continue}
    if(c==="/"&&next==="*"){block=true;i++;continue}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue}
    if(c==="{")depth++;
    else if(c==="}"&&--depth===0){i++;break}
  }
  if(depth!==0)throw new Error(name+" braces did not balance");
  return src.slice(at,i);
}

const calls=[];
const feed={
  league:{id:"555",name:"Invented League",season:2026,playoffTeams:6,playoffStart:15,
    scoring:{mode:"half",ppr:0.5,superflex:false},slots:[{slot:"QB",count:1},{slot:"BENCH",count:1}]},
  pool:[{id:"y:7",name:"Ora Vex",pos:"QB",team:"LAR",p:null,paid:11,dd:{v:20}}],
  teams:[{id:"3",name:"Team A",owner:null,players:["y:7"],starters:["y:7"]}],
  schedule:[[["3","4"]]],diagnostics:{weeksOk:14},dd:{as_of:"2026-09-02"}
};
const yahoo={
  connect:async input=>{calls.push(["connect",input]);return {ok:true}},
  warroom:async input=>{calls.push(["warroom",input]);return feed}
};
const fn=new Function("window","DDProviders","readShelf","slots",
  liftFunction(html,"fetchLeagueYahoo")+";return fetchLeagueYahoo;")(
    {DDProviders:{yahoo}}, {yahoo}, ()=>[], raw=>Object.fromEntries(raw.map(x=>[x,(raw.filter(y=>y===x).length)])));

const state=await fn("555");
ok(calls[0][0]==="connect"&&calls[0][1].leagueId==="555","owner read stores the public Yahoo connection");
ok(state.ref.provider==="yahoo"&&state.ref.id==="555","Yahoo ref survives");
ok(state.league.scoring_settings.rec===0.5,"scoring_settings is built from league.scoring even when fixture omits it");
ok(state.pool[0].p===null,"missing projection remains null");
ok(state.pool[0].paid===11,"auction cost survives");
ok(state.teams[0].players[0]===state.pool[0],"team player ids join to pool rows");
ok(state.teams[0].starters.has("y:7"),"starter ids become a Set");

calls.length=0;
const shared=await fn(null,"share-token");
ok(calls.length===1&&calls[0][0]==="warroom"&&calls[0][1].share==="share-token","shared read never calls authenticated connect");
ok(shared.ref.id==="555","shared read takes league id from the feed");

const publicAt=providers.indexOf("async function yahooPublicCall");
const publicEnd=providers.indexOf("function fetchYahooWarroom",publicAt);
const publicBody=providers.slice(publicAt,publicEnd);
ok(publicAt>=0&&!publicBody.includes("X-Bozo-Session"),"Yahoo share read sends no session header");
ok(html.includes("function provName(){return state&&state.ref&&state.ref.provider==='espn'?'ESPN':'Sleeper'}"),
  "Yahoo disagreement labels Sleeper as the projection source");
ok(html.includes("On a Yahoo disagreement chart the far side is therefore SLEEPER"),
  "Toto carries the same projection-source warning");
ok(html.includes('id="seededLeague"')&&html.includes('data-provider="yahoo"'),"measured Yahoo league row is restored");
ok(html.includes("openShared(share,deepProv)"),"share deep link preserves its provider");

console.log(n+" Yahoo page assertions passed");
