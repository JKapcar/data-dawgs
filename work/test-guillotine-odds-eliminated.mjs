/* dd_guillotine_odds must drop chopped (empty-roster) teams. Lifts the tool's run()
   from ../dawg-bot-worker.js and runs it against a faked Sleeper. Invented names only.
   Run: cd work && node test-guillotine-odds-eliminated.mjs */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dawg-bot-worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (d ? " — " + d : "")); } };
const at = src.indexOf("async run(", src.indexOf('name: "dd_guillotine_odds"'));
let i = src.indexOf("{", at), d = 0;
for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
const body = src.slice(src.indexOf("{", at) + 1, i - 1);

const rosters = [1,2,3,4,5].map(n => ({ roster_id: n, owner_id: "u" + n, players: n <= 2 ? [] : ["a","b"] }));
const users = rosters.map(r => ({ user_id: r.owner_id, display_name: "Mgr" + r.roster_id }));
const wk = { 1: [20, 60, 100, 110, 120], 2: [0, 55, 105, 95, 125], 3: [0, 0, 98, 112, 118] };
const fetch = async (u) => {
  const p = u.replace("https://api.sleeper.app/v1", "");
  let j;
  if (p === "/state/nfl") j = { week: 4 };
  else if (/\/rosters$/.test(p)) j = rosters;
  else if (/\/users$/.test(p)) j = users;
  else if (/\/matchups\/(\d+)$/.test(p)) { const w = +p.match(/(\d+)$/)[1]; j = rosters.map((r, k) => ({ roster_id: r.roster_id, points: wk[w][k] })); }
  else j = { name: "Test League", season: "2026" };
  return { ok: true, json: async () => j };
};
const toolText = (o) => o, toolErr = (m) => ({ error: m });
const run = new Function("fetch", "toolText", "toolErr", "return async function(args, env, caller){" + body + "};")(fetch, toolText, toolErr);
const out = await run({ league_id: "123", sims: 5000 });
ok("survival computed", out.survivalAvailable === true, JSON.stringify(out).slice(0, 200));
ok("two chopped teams listed as eliminated", out.eliminated && out.eliminated.length === 2);
ok("chopped teams are not simulated", out.teams.every(t => t.rosterId > 2));
ok("chop risk sums to 1 over the alive field", Math.abs(out.teams.reduce((s, t) => s + t.chopRisk, 0) - 1) < 1e-3);
ok("chop line is a real score, not a dead team's zero", out.projectedChopLine > 40, "line=" + out.projectedChopLine);
console.log("\nodds-eliminated: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
