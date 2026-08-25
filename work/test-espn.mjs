/* ESPN adapter fixtures. The Worker cannot be reached from CI and nobody's real
   espn_s2 belongs in a test, so this exercises the pure normalisers against the
   shapes ESPN actually returns. Extracted from dawg-bot-worker.js by name so the
   test cannot drift from the shipped implementation. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "dawg-bot-worker.js"), "utf8");
function lift(name, kind = "function") {
  const marker = `${kind} ${name}(`;
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`${name} not found in the Worker`);
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
}
const consts = ['const ESPN_SLOT = { 0:"QB",2:"RB",4:"WR",6:"TE",16:"DST",17:"K",23:"FLEX",20:"BE",21:"IR",7:"OP" };',
                'const ESPN_POS  = { 1:"QB",2:"RB",3:"WR",4:"TE",5:"K",16:"DST" };'].join("\n");
const mod = new Function(`${consts}
${lift("espnRosterSlots")}
${lift("espnScoring")}
${lift("espnNormalizeLeague")}
${lift("espnPlayerNames")}
${lift("espnNormalizePicks")}
return {espnRosterSlots,espnScoring,espnNormalizeLeague,espnNormalizePicks};`)();

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log("  FAIL " + n + (x ? "  — " + x : ""))); };

const slotCounts = { 0:1, 2:2, 4:2, 6:1, 23:2, 16:1, 17:1, 20:6, 21:2 };
const league = (over = {}) => ({
  id: 123456, seasonId: 2026,
  settings: { name: "Test League", size: 12,
    draftSettings: { type: "AUCTION", auctionBudget: 200 },
    rosterSettings: { lineupSlotCounts: slotCounts },
    scoringSettings: { scoringItems: [{ statId: 53, points: 0.5 }] }, ...over },
  teams: [
    { id: 1, location: "Data", nickname: "Dawgs", owners: ["{OWNER-1}"],
      roster: { entries: [{ playerPoolEntry: { player: { id: 4262921, fullName: "Jahmyr Gibbs", defaultPositionId: 2, proTeamId: 8 } } }] } },
    { id: 2, location: "Dirty", nickname: "Mike", owners: ["{OWNER-2}"], roster: { entries: [] } },
  ],
  draftDetail: { drafted: false, inProgress: true, picks: [
    { id: 1, playerId: 4262921, teamId: 1, roundId: 1, roundPickNumber: 1, overallPickNumber: 1, bidAmount: 70, keeper: false },
    { id: 2, playerId: 999999, teamId: 2, roundId: 1, roundPickNumber: 2, overallPickNumber: 2, bidAmount: 55, keeper: false },
  ] },
});

console.log("\nleague settings");
{
  const L = mod.espnNormalizeLeague(league());
  ok("auction is recognised and carries its budget", L.draftType === "auction" && L.budget === 200, `${L.draftType}/${L.budget}`);
  ok("team count and name survive", L.teamCount === 12 && L.name === "Test League");
  ok("team names join location and nickname", L.teams[0].name === "Data Dawgs", L.teams[0].name);
  ok("half PPR is detected from statId 53", L.scoring.mode === "half", L.scoring.mode);
  const slots = Object.fromEntries(L.rosterSlots.map(s => [s.slot, s.count]));
  ok("starters map to site slot names", slots.QB === 1 && slots.RB === 2 && slots.WR === 2 && slots.TE === 1 && slots.FLEX === 2 && slots.DST === 1, JSON.stringify(slots));
  ok("bench is kept, IR is not drafted", slots.BENCH === 6 && slots.IR === undefined, JSON.stringify(slots));
}

console.log("\nscoring variants");
{
  const full = mod.espnNormalizeLeague(league({ scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] } }));
  ok("full PPR", full.scoring.mode === "full", full.scoring.mode);
  const std = mod.espnNormalizeLeague(league({ scoringSettings: { scoringItems: [{ statId: 53, points: 0 }] } }));
  ok("standard", std.scoring.mode === "std", std.scoring.mode);
  const sfCounts = { ...slotCounts, 7: 1 };
  const sf = mod.espnNormalizeLeague(league({ rosterSettings: { lineupSlotCounts: sfCounts } }));
  ok("an OP slot makes it superflex", sf.scoring.mode === "sf" && sf.scoring.superflex, sf.scoring.mode);
  ok("OP is exposed as SUPERFLEX", sf.rosterSlots.some(s => s.slot === "SUPERFLEX"), JSON.stringify(sf.rosterSlots));
  const odd = mod.espnNormalizeLeague(league({ scoringSettings: { scoringItems: [{ statId: 53, points: 0.75 }] } }));
  ok("an unfamiliar reception value is custom, not guessed", odd.scoring.mode === "custom" && odd.scoring.ppr === 0.75, odd.scoring.mode);
  const snake = mod.espnNormalizeLeague(league({ draftSettings: { type: "SNAKE" } }));
  ok("snake carries no budget", snake.draftType === "snake" && snake.budget === null, `${snake.draftType}/${snake.budget}`);
}

console.log("\ndraft picks");
{
  const d = mod.espnNormalizePicks(league());
  ok("both picks come through", d.picks.length === 2, String(d.picks.length));
  ok("a rostered player resolves to a name", d.picks[0].player === "Jahmyr Gibbs", d.picks[0].player);
  ok("position and pro team come with it", d.picks[0].pos === "RB" && d.picks[0].nfl === "8", `${d.picks[0].pos}/${d.picks[0].nfl}`);
  ok("auction price is carried", d.picks[0].price === 70, String(d.picks[0].price));
  ok("provider team id maps to a row index", d.picks[0].ti === 0 && d.picks[1].ti === 1, `${d.picks[0].ti}/${d.picks[1].ti}`);
  ok("an unrostered pick is reported, not invented", d.picks[1].player === "" && d.diagnostics.unnamed === 1, JSON.stringify(d.diagnostics));
  ok("the unnamed case explains itself", /resolve on the next poll/.test(d.diagnostics.note), d.diagnostics.note);
  ok("in-progress state is surfaced", d.inProgress === true && d.complete === false);
}

console.log("\nan undrafted league");
{
  const empty = league();
  empty.draftDetail = { drafted:false, inProgress:false, picks:
    Array.from({length:204},(_,i)=>({ id:i+1, playerId:-1, teamId:0, roundId:1+Math.floor(i/12), roundPickNumber:(i%12)+1, overallPickNumber:i+1, bidAmount:0, keeper:false })) };
  const d = mod.espnNormalizePicks(empty);
  ok("ESPN's pre-made empty slots are not counted as pending picks", d.diagnostics.unnamed === 0, JSON.stringify(d.diagnostics));
  ok("they are reported as empty slots instead", d.diagnostics.empty === 204 && d.diagnostics.made === 0, JSON.stringify(d.diagnostics));
  ok("and the note says the draft has not started", /No picks yet/.test(d.diagnostics.note), d.diagnostics.note);
  ok("none of them can reach the board", d.picks.filter(p=>p.player && Number.isInteger(p.ti)).length === 0);
}

console.log("\nempty and hostile shapes");
{
  ok("a league with no draft yet returns no picks", mod.espnNormalizePicks({ teams: [], draftDetail: { picks: [] } }).picks.length === 0);
  ok("a missing draftDetail does not throw", mod.espnNormalizePicks({ teams: [] }).picks.length === 0);
  ok("a missing settings block does not throw", mod.espnNormalizeLeague({ id: 1, teams: [] }).teamCount === null);
  const noRec = mod.espnNormalizeLeague(league({ scoringSettings: { scoringItems: [] } }));
  ok("no reception item means standard, and says ppr 0", noRec.scoring.mode === "std" && noRec.scoring.ppr === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
