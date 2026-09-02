// work/test-yahoo.mjs — run: node work/test-yahoo.mjs (from repo root, or cd work)
// The generated block is the test source: a green local parser file cannot mask drift in
// the Worker that actually deploys.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const src=fs.readFileSync(path.join(ROOT,"dawg-bot-worker.js"),"utf8");
const START="/* ===== DD-YAHOO-BLOCK START — generated from work/yahoo-parse.js + work/yahoo-worker.js; edit THERE ===== */";
const END="/* ===== DD-YAHOO-BLOCK END ===== */";
const a=src.indexOf(START),b=src.indexOf(END,a+START.length);
if(a<0||b<a)throw new Error("Yahoo generated block not found in the Worker");
const block=src.slice(a+START.length,b);
const Y=new Function(block+`\nreturn {ydecode,yahooParseDraft,yahooParseRoster,yahooParseWeek,
  yahooWeekIsSane,yahooParseTeams,yahooParseSettings,yahooProjectionValue,yahooReconcileSettings};`)();
let n=0; const ok=(c,m)=>{n++; if(!c){console.error("FAIL",m);process.exit(1)}};
const P=(id,nm)=>`<a href="https://sports.yahoo.com/nfl/players/${id}">${nm}</a>`;
// draft: bare class="player" (trap 1), empty $0 row, defense keyed dst:
const draft=`<table><tr><th>Pick</th></tr>
<tr><td class="pick">1</td><td class="player">${P(101,"Zed Quill")} (SEA - RB)</td><td class="cost">$61</td><td class="team-name">Team A</td></tr>
<tr><td class="pick">2</td><td class="player">Ravens (Bal - DEF)</td><td class="cost">$3</td><td class="team-name">Team B</td></tr>
<tr><td class="pick">3</td><td class="player">--empty-- ( - )</td><td class="cost">$0</td><td class="team-name">Team C</td></tr></table>`;
const d=Y.yahooParseDraft(draft);
ok(d.found===2&&d.empty===1&&d.rows===3,"draft counts "+JSON.stringify(d));
ok(d.picks[0].key==="y:101"&&d.picks[0].cost===61,"draft key/cost");
ok(d.picks[1].key==="dst:BAL"&&d.picks[1].pos==="DST","dst key");
// roster: multi-token class, empty slot recorded in shape, unknown slot reported
const roster=`<title>Lg - Team A | Fantasy Football | Yahoo! Sports</title><table>
<tr><th class="pos">Pos</th></tr>
<tr><td class="Alt Ta-start pos">QB</td><td class="Alt Ta-start player">${P(7,"Ora Vex")} (LAR - QB)</td></tr>
<tr><td class="pos">W/R/T</td><td class="player">--empty-- ( - )</td></tr>
<tr><td class="pos">BN</td><td class="player">${P(8,"Ike Pell")} (KC - WR)</td></tr>
<tr><td class="pos">ZZ</td><td class="player">${P(9,"Ned Orr")} (DEN - TE)</td></tr></table>`;
const ro=Y.yahooParseRoster(roster,"3");
ok(ro.found===2&&ro.emptySlots===1&&ro.slotCount===3,"roster counts "+JSON.stringify(ro));
ok(ro.shape.FLEX===1&&ro.shape.QB===1&&ro.shape.BN===1,"shape");
ok(ro.players[0].starter===true&&ro.players[1].starter===false,"starter by slot");
ok(ro.unknownSlots[0]==="ZZ","unknown slot reported");
ok(ro.teamName==="Team A"&&ro.leagueName==="Lg","title parse");
const liveCell=`<a class="Nowrap name F-link playernote" href="https://sports.yahoo.com/nfl/players/7">Ora Vex</a><span>Player Note</span><span>Lar - QB</span><a href="/game">Sun vs Sea</a>`;
const liveRoster=`<title>Lg - Team A | Fantasy Football | Yahoo! Sports</title><table><tr><td class="pos">QB</td><td class="player">${liveCell}</td></tr></table>`;
const lr=Y.yahooParseRoster(liveRoster,"3");
ok(lr.players[0].name==="Ora Vex"&&lr.players[0].team==="LAR"&&lr.players[0].pos==="QB","nested live roster cell");
// week: header echo mismatch (trap 2), sane pairs
const wk=(n)=>`<div class="Tst-matchups-body"><h3>Week ${n} Matchups</h3>`+[1,2,3,4].map(i=>`<a href="/f1/555/${i}">T${i}</a>`).join("")+`<div class="Tst-standings"><a href="/f1/555/9">x</a>`;
const w=Y.yahooParseWeek(wk(3),555,3); ok(w.ok&&w.pairs.length===2&&Y.yahooWeekIsSane(w,4),"week ok");
const wm=Y.yahooParseWeek(wk(3),555,4); ok(!wm.ok&&wm.reason==="week-mismatch"&&wm.saw===3,"week mismatch");
ok(!Y.yahooWeekIsSane(w,5),"sane rejects wrong team count");
// teams: My Team ignored, dedupe
const t=Y.yahooParseTeams(`<a href="/f1/555/2">My Team</a><a href="/f1/555/2">Bravo</a><a href="/f1/555/1">Alpha</a><a href="/f1/555/1">Alpha</a>`,555);
ok(t.found===2&&t.teams[0].name==="Alpha"&&t.teams[1].name==="Bravo","teams");
// settings: <tr> attrs (trap 3)
const st=`<table><tr class="First"><td class="label">Max Teams:</td><td>14</td></tr><tr class="x"><td>Playoffs:</td><td>6 teams - Week 15, 16 and 17</td></tr><tr><td>Receptions</td><td>0.5</td></tr><tr><td>Fractional Points:</td><td>Yes</td></tr></table>`;
const s=Y.yahooParseSettings(st);
ok(s.teams===14&&s.playoffTeams===6&&s.playoffStart===15&&s.rec===0.5&&s.fractional===true,"settings "+JSON.stringify(s));
ok(Y.ydecode("A &amp; B&#39;s&nbsp; ")==="A & B's","decode");
ok(Y.yahooProjectionValue({stats:{pts_half_ppr:210}},0.5,14)===15,"half-PPR season projection per week");
ok(Y.yahooProjectionValue({stats:{}},0.5,14)===null,"missing projection stays null");
const canon={settings:{team_count:14,playoff_teams:6,playoff_start_week:15,scoring:{ppr:0.5}}};
ok(Y.yahooReconcileSettings(s,canon).ok,"canonical settings reconcile");
ok(!Y.yahooReconcileSettings({...s,teams:12},canon).ok,"canonical disagreement refuses");
console.log(n+" assertions green");
