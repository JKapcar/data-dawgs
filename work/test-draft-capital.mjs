/* Draft capital: ownership, pricing, and what must never happen to it. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");
const lift = (n, kind = "function") => {
  const at = src.indexOf(kind + " " + n + "(");
  if (at < 0) throw new Error(n + " not found");
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
};
let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));

const PICKS = [ {season:2027,round:1,v:15},{season:2027,round:2,v:3},
                {season:2028,round:1,v:10},{season:2028,round:2,v:2} ];
const run = async ({ traded = [], provider = "sleeper", picks = PICKS, teams = 3, season = "2026", draftRounds = 2 }) => {
  const state = { ref: { provider, id: "L1" }, teams: Array.from({ length: teams }, (_, i) => ({ id: i + 1 })),
                  league: { season, settings: { draft_rounds: draftRounds } } };
  const DD = { season: null, dynasty: picks ? { by: new Map([["name:x", 1]]), meta: { as_of: "2026-09-02" }, picks } : null };
  const body = `let DDPICKS=null;
    ${lift("ddBoard")}
    ${lift("loadDraftCapital", "async function")}
    ${lift("ddCapital")}
    return (async()=>{const r=await loadDraftCapital(state);return {r,DDPICKS,ddCapital,state};})();`;
  return new Function("DD", "state", "API", "fetch", body)(DD, state, "https://api.sleeper.app/v1",
    async () => ({ ok: true, json: async () => traded }));
};

/* default ownership: every roster owns its own picks in every priced future season+round */
{
  const { r, state } = await run({});
  ok("each team owns its own picks by default", r.byTeam.get("1").n === 4);
  ok("valued by round from the board", r.byTeam.get("1").v === 15 + 3 + 10 + 2);
  ok("only future seasons count", r.seasons.join() === "2027,2028");
  ok("resolved capital is cached on its league state", state.ddPicks === r);
}
/* a trade moves the asset AND the value */
{
  const { r } = await run({ traded: [{ season: "2027", round: 1, roster_id: 1, owner_id: 2 }] });
  ok("traded pick leaves the original owner", r.byTeam.get("1").v === 3 + 10 + 2);
  ok("traded pick arrives at the new owner", r.byTeam.get("2").v === 15 + 15 + 3 + 10 + 2);
  ok("league-wide value is conserved by a trade",
     [...r.byTeam.values()].reduce((a, x) => a + x.v, 0) === 3 * 30);
}
/* unpriced is counted, never valued at zero */
{
  const { r } = await run({ traded: [{ season: "2029", round: 1, roster_id: 1, owner_id: 2 }] });
  ok("a traded future season creates owned picks for every team", r.seasons.join() === "2027,2028,2029");
  ok("all owned picks outside the priced seasons are counted", r.unpricedPicks === 3 * 2);
  ok("an unpriced pick adds no phantom value", r.byTeam.get("2").v === 30);
  const { r: r5 } = await run({ draftRounds: 5, traded: [{ season: "2027", round: 5, roster_id: 1, owner_id: 2 }] });
  ok("a round the source does not price is unpriced for every team and season", r5.unpricedPicks === 3 * 2 * 3);
  ok("per-team unpriced ownership moves with a trade", r5.byTeam.get("1").unpriced === 5 && r5.byTeam.get("2").unpriced === 7);
}
/* it must not run where it cannot be right */
{
  ok("no dynasty board -> no capital", (await run({ picks: null })).r === null);
  ok("non-Sleeper provider -> no capital", (await run({ provider: "espn" })).r === null);
}
/* structural guarantees */
ok("capital is never added to roster value",
   !/total\s*\+=?\s*ddCapital|roster[^\n]*\+\s*ddCapital/.test(src));
ok("card is hidden until there is capital to show", /wr-hide"\s+id="mnCapCard"|id="mnCapCard"[^>]*wr-hide/.test(src));
ok("both league-load paths resolve capital", (src.match(/await loadDraftCapital\(\)/g) || []).length === 2);
ok("the by-round limitation is stated to the reader", /Priced by ROUND, not by slot/.test(src));
ok("unpriced is explained, not silently dropped", /unpriced is not the same as worthless/.test(src));
ok("the table reports each team's unpriced picks", /r\.unpriced\?' · '\+r\.unpriced\+' unpriced'/.test(src));
ok("restoring a league restores its own draft capital", /DDPICKS=state\.ddPicks\|\|null/.test(src));
ok("portfolio loading resolves each league's draft capital", /await loadDraftCapital\(st\)/.test(src));
ok("cross-league calculations swap draft capital with state", /DDPICKS=st\.ddPicks\|\|null/.test(src));
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
