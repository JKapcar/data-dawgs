/* Playoff leverage — engine rules, simulation invariants and the published file's contract.
 *
 *   node work/test-playoff-leverage.mjs [--published]   (from the repo root or work/)
 *   --published also checks data/nfl-playoff-leverage.json against the current inputs.
 *
 * What this suite defends:
 *   1. THE TIE-BREAKERS, step by step, on hand-built records — including the rules that
 *      real seasons rarely exercise and that work/validate-playoff-history.mjs therefore
 *      cannot prove: the two-club revert inside a multi-club tie, the wild-card sweep (both
 *      halves), the four-game minimum for common games, and division reduction before a
 *      wild-card comparison. Each fixture is built so the common implementation mistake
 *      returns a DIFFERENT club, so a pass is evidence rather than coincidence.
 *   2. SIMULATION ARITHMETIC: seven clubs per conference in every season, one division
 *      winner per division, one bye per conference, the paired branches recombine to the
 *      unforced estimate, and the same seed reproduces the same numbers.
 *   3. THE FILE: envelope, ordering, rounding, determinism (identical inputs → identical
 *      bytes, so the daily job commits nothing on a quiet day), and fail-closed inputs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = require(path.join(ROOT, "work/playoff-leverage-engine.js"));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  — " + extra : "")); }
};

const L = E.createLeague();
const T = code => { const i = L.index.get(code); if (i === undefined) throw new Error(code); return i; };
const name = i => L.teams[i];
const fresh = () => E.createRecords(L.n);
/* r from the HOME club's side: 1 win, 0 loss, 0.5 tie */
const play = (rec, home, away, r, times = 1) => { for (let k = 0; k < times; k++) E.addResult(rec, T(home), T(away), r); };
const breakers = (rec, first = []) => {
  /* lottery: listed clubs win the coin toss in that order, everyone else after */
  const lot = new Int32Array(L.n).fill(1000);
  first.forEach((c, k) => { lot[T(c)] = k; });
  for (let i = 0; i < L.n; i++) if (lot[i] === 1000) lot[i] = 100 + i;
  return E.createTiebreakers(L, rec, lot);
};
const pick = (tb, kind, clubs, extra) => name(tb[kind](clubs.map(T), extra));

/* ------------------------------------------------------------ 1. rules ---- */
{ // the division table matches the schedule's own divisional flag
  const sched = JSON.parse(fs.readFileSync(path.join(ROOT, "data/nfl-schedule.json"), "utf8"));
  const games = sched.data.games;
  const bad = games.filter(g => (L.div[T(g.home_team)] === L.div[T(g.away_team)]) !== Boolean(g.divisional));
  ok("division table agrees with every scheduled game's divisional flag", bad.length === 0, bad.map(g => g.game_id).join(","));
  ok("32 clubs, 8 divisions of 4, 16 per conference", L.n === 32 && L.divTeams.every(d => d.length === 4) && L.confTeams.every(c => c.length === 16));
  const stadiums = JSON.parse(fs.readFileSync(path.join(ROOT, "data/nfl-stadiums.json"), "utf8")).data.teams;
  const badName = L.teams.filter(t => !E.NICKNAMES[t] || !stadiums[t] || !stadiums[t].team.endsWith(" " + E.NICKNAMES[t]));
  ok("every nickname matches the full team name in nfl-stadiums.json", badName.length === 0, badName.join(","));
}
{ // ties count half a win
  const rec = fresh();
  play(rec, "NYG", "WAS", 0.5); play(rec, "NYG", "DAL", 1); play(rec, "PHI", "WAS", 1); play(rec, "WAS", "DAL", 1);
  ok("1-0-1 is .750", Math.abs(E.pct(rec, T("NYG")) - 0.75) < 1e-12, E.pct(rec, T("NYG")));
  ok("1-1-1 is .500", Math.abs(E.pct(rec, T("WAS")) - 0.5) < 1e-12, E.pct(rec, T("WAS")));
}
{ /* a tie is half a win inside the tie-breakers too: BAL's division record is .500 with
     two ties (W1 L1 T2) against CIN's .417 (W2 L3 T1). Count ties as nothing and the order
     flips (.250 vs .333). */
  const rec = fresh();
  play(rec, "BAL", "CIN", 0.5); play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "BAL", "CLE", 0.5);
  play(rec, "CIN", "PIT", 1); play(rec, "PIT", "CIN", 1, 2);
  ok("div 2-club: ties count half a win in division record", pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "BAL");
}
{ // division, two clubs: head-to-head
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "MIA", "BAL", 1); play(rec, "CIN", "NYJ", 1);
  ok("div 2-club: head-to-head winner advances", pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "BAL");
  const rec2 = fresh();
  play(rec2, "CIN", "BAL", 1); play(rec2, "MIA", "CIN", 1); play(rec2, "BAL", "NYJ", 1);
  ok("div 2-club: head-to-head, mirrored", pick(breakers(rec2, ["BAL"]), "divPick", ["BAL", "CIN"]) === "CIN");
}
{ // split head-to-head -> division record
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "BAL", "CLE", 1); play(rec, "CIN", "CLE", 0);
  ok("div 2-club: split head-to-head goes to division record", pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "BAL");
}
{ // -> common games
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "BAL", "HOU", 1); play(rec, "IND", "BAL", 0);
  play(rec, "CIN", "HOU", 0); play(rec, "CIN", "IND", 1);
  ok("div 2-club: equal division record goes to common games", pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "BAL");
}
{ // -> conference record (no common opponents)
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "BAL", "HOU", 1); play(rec, "CIN", "SEA", 1);
  const tb = breakers(rec, ["CIN"]);
  ok("div 2-club: no common opponents goes to conference record", pick(tb, "divPick", ["BAL", "CIN"]) === "BAL");
}
{ // -> strength of victory
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "BAL", "DET", 1); play(rec, "CIN", "SEA", 1);
  for (const o of ["GB", "CHI", "MIN"]) play(rec, "DET", o, 1);
  for (const o of ["SF", "ARI", "LAR"]) play(rec, o, "SEA", 1);
  ok("div 2-club: equal conference record goes to strength of victory",
    pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "BAL" && E.sov(rec, T("BAL")) > E.sov(rec, T("CIN")));
}
{ // -> strength of schedule
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  play(rec, "DET", "BAL", 1); play(rec, "SEA", "CIN", 1);
  for (const o of ["GB", "CHI", "MIN"]) play(rec, "DET", o, 1);
  for (const o of ["SF", "ARI", "LAR"]) play(rec, o, "SEA", 1);
  const tb = breakers(rec, ["CIN"]);
  ok("div 2-club: SOV level, strength of schedule decides",
    Math.abs(E.sov(rec, T("BAL")) - E.sov(rec, T("CIN"))) < 1e-12 && pick(tb, "divPick", ["BAL", "CIN"]) === "BAL");
}
{ // nothing separates them -> coin toss
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  ok("div 2-club: dead level goes to the coin toss (BAL wins it)", pick(breakers(rec, ["BAL"]), "divPick", ["BAL", "CIN"]) === "BAL");
  ok("div 2-club: dead level goes to the coin toss (CIN wins it)", pick(breakers(rec, ["CIN"]), "divPick", ["BAL", "CIN"]) === "CIN");
}
{ /* division, three clubs: head-to-head eliminates PIT and leaves BAL and CIN level among
     the three. The rule sends the last two back to step 1 of the TWO-club format, where
     BAL beat CIN. An implementation that walks on to division record picks CIN (3-1 vs 2-3). */
  const rec = fresh();
  play(rec, "BAL", "CIN", 1);
  play(rec, "CIN", "PIT", 1, 2);
  play(rec, "BAL", "PIT", 1); play(rec, "PIT", "BAL", 1);
  play(rec, "CLE", "BAL", 1, 2);
  play(rec, "CIN", "CLE", 1);
  play(rec, "PIT", "CLE", 1, 2);
  ok("div 3-club: two left after a multi-club step revert to two-club head-to-head",
    pick(breakers(rec, ["CIN", "PIT"]), "divPick", ["BAL", "CIN", "PIT"]) === "BAL");
}
{ /* wild card, three clubs: BUF beat both others, so the sweep applies before conference
     record — where BAL (4-1) would beat BUF (2-3). */
  const rec = fresh();
  play(rec, "BUF", "BAL", 1); play(rec, "BUF", "HOU", 1); play(rec, "BAL", "HOU", 1);
  for (const o of ["MIA", "NE", "NYJ"]) play(rec, o, "BUF", 1);
  for (const o of ["CLE", "PIT", "CIN"]) play(rec, "BAL", o, 1);
  ok("wc 3-club: a club that beat each of the others wins on the sweep",
    pick(breakers(rec, ["HOU", "BAL"]), "wcPickReduced", ["BUF", "BAL", "HOU"]) === "BUF");
}
{ /* wild card, three clubs: HOU lost to each of the others and is eliminated even though
     its conference record is best; BUF and BAL never met, so the two-club format goes to
     conference record, BUF .667 over BAL .500. */
  const rec = fresh();
  play(rec, "BUF", "HOU", 1); play(rec, "BAL", "HOU", 1);
  for (const o of ["TEN", "IND", "JAX", "LV", "LAC"]) play(rec, "HOU", o, 1);
  play(rec, "BUF", "MIA", 1); play(rec, "NE", "BUF", 1);
  play(rec, "CLE", "BAL", 1);
  ok("wc 3-club: a club that lost to each of the others is eliminated first",
    pick(breakers(rec, ["HOU", "BAL"]), "wcPickReduced", ["BUF", "BAL", "HOU"]) === "BUF");
}
{ /* wild card, two clubs, no meeting, equal conference records. Common opponents HOU, IND,
     JAX: three games each, under the minimum of four, so strength of victory decides (BAL
     beat strong clubs). Add a fourth common game and common games decides for BUF. */
  const build = withFourth => {
    const rec = fresh();
    for (const o of ["HOU", "IND", "JAX"]) { play(rec, "BUF", o, 1); play(rec, o, "BAL", 1); }
    for (const o of ["MIA", "NE", "NYJ"]) play(rec, o, "BUF", 1);
    for (const o of ["CLE", "PIT", "CIN"]) play(rec, "BAL", o, 1);
    for (const o of ["CLE", "PIT", "CIN"]) for (const n of ["DAL", "NYG", "PHI", "WAS"]) play(rec, o, n, 1);
    if (withFourth) { play(rec, "BUF", "SEA", 1); play(rec, "SEA", "BAL", 1); }
    return rec;
  };
  const three = build(false), four = build(true);
  ok("wc 2-club: equal conference records (fixture sanity)",
    Math.abs(E.pctVs(three, T("BUF"), L.confTeams[0]) - E.pctVs(three, T("BAL"), L.confTeams[0])) < 1e-12);
  ok("wc 2-club: three common games is under the minimum, so SOV decides",
    pick(breakers(three, ["BUF"]), "wcPickReduced", ["BUF", "BAL"]) === "BAL");
  ok("wc 2-club: four common games and common games decides",
    pick(breakers(four, ["BAL"]), "wcPickReduced", ["BUF", "BAL"]) === "BUF");
}
{ /* the division procedure has NO minimum: CIN is 3-0 against three common opponents and
     takes it there; with a (wrong) four-game minimum the step is skipped and BAL's better
     conference record (.500 vs .444) would decide instead. */
  const rec = fresh();
  play(rec, "BAL", "CIN", 1); play(rec, "CIN", "BAL", 1);
  for (const o of ["HOU", "IND", "JAX"]) { play(rec, "CIN", o, 1); play(rec, o, "BAL", 1); }
  for (const o of ["MIA", "NE", "NYJ"]) play(rec, "BAL", o, 1);
  for (const o of ["DEN", "LV", "LAC", "TEN"]) play(rec, o, "CIN", 1);
  const conf = i => E.pctVs(rec, T(i), L.confTeams[0]);
  ok("div fixture sanity: BAL has the better conference record", conf("BAL") > conf("CIN"), `${conf("BAL")} ${conf("CIN")}`);
  ok("div 2-club: common games applies with fewer than four", pick(breakers(rec, ["BAL"]), "divPick", ["BAL", "CIN"]) === "CIN");
}
{ /* wild card, step 1: PIT is ranked above CIN in the AFC North, so CIN may not be
     compared with HOU at all. PIT then loses to HOU on conference record. Without the
     reduction CIN (3-0 in conference) would take the spot. */
  const rec = fresh();
  for (const o of ["MIA", "NE", "NYJ"]) play(rec, "CIN", o, 1);
  play(rec, "DEN", "PIT", 1); play(rec, "KC", "PIT", 1);
  play(rec, "HOU", "LV", 1); play(rec, "LAC", "HOU", 1);
  const divRank = new Map([[T("PIT"), 1], [T("CIN"), 2], [T("HOU"), 1]]);
  ok("wc: only the highest-ranked tied club of a division is compared",
    pick(breakers(rec, ["CIN"]), "wcPick", ["CIN", "PIT", "HOU"], divRank) === "HOU");
}

/* ------------------------------------------------------ 2. simulation ---- */
const schedule = JSON.parse(fs.readFileSync(path.join(ROOT, "data/nfl-schedule.json"), "utf8"));
const survivor = JSON.parse(fs.readFileSync(path.join(ROOT, "data/survivor.json"), "utf8"));
const pOf = new Map(survivor.data.games.map(g => [`${g.wk}|${g.a}|${g.h}`, g.p]));
const simGames = schedule.data.games.map(g => {
  const h = T(g.home_team), a = T(g.away_team);
  if (g.status === "final") return { h, a, final: true, r: g.home_score > g.away_score ? 1 : g.home_score < g.away_score ? 0 : 0.5 };
  return { h, a, final: false, p: pOf.get(`${g.week}|${g.away_team}|${g.home_team}`) };
});
const open = simGames.map((g, k) => (g.final ? -1 : k)).filter(k => k >= 0);
const week = Math.min(...open.map(k => schedule.data.games[k].week));
const leverage = open.filter(k => schedule.data.games[k].week === week);
const run = seedHex => E.simulate({ league: L, games: simGames, sims: 3000, seedHex, leverage });
const A = run("0123456789abcdef0123456789abcdef");
const B = run("0123456789abcdef0123456789abcdef");
const C = run("fedcba9876543210fedcba9876543210");
ok("every unplayed game has a probability in (0,1)", open.every(k => simGames[k].p > 0 && simGames[k].p < 1));
for (let c = 0; c < 2; c++) {
  const confSum = key => L.confTeams[c].reduce((s, i) => s + A.teams[i][key], 0);
  ok(`${E.CONFERENCES[c]}: exactly seven playoff clubs per season`, Math.abs(confSum("playoffs") - 7) < 1e-9, confSum("playoffs"));
  ok(`${E.CONFERENCES[c]}: exactly one bye per season`, Math.abs(confSum("bye") - 1) < 1e-9, confSum("bye"));
  for (const lv of A.leverage) {
    const s0 = L.confTeams[c].reduce((s, i) => s + lv.ifHomeWin[i], 0), s1 = L.confTeams[c].reduce((s, i) => s + lv.ifAwayWin[i], 0);
    if (Math.abs(s0 - 7) > 1e-9 || Math.abs(s1 - 7) > 1e-9) { ok(`${E.CONFERENCES[c]}: seven per season in flipped branches`, false, `${s0} ${s1}`); break; }
  }
}
ok("one division winner per division per season",
  L.divTeams.every(d => Math.abs(d.reduce((s, i) => s + A.teams[i].division, 0) - 1) < 1e-9));
ok("seed distribution sums to the playoff probability",
  A.teams.every(t => Math.abs(t.seeds.reduce((s, v) => s + v, 0) - t.playoffs) < 1e-9));
ok("same seed, same numbers", JSON.stringify(A) === JSON.stringify(B));
ok("different seed, different draw", JSON.stringify(A.teams) !== JSON.stringify(C.teams));
ok("leverage covers every unplayed game of the target week", A.leverage.length === leverage.length && leverage.length > 0);
{
  /* The paired branches must recombine: p*P(made|win) + (1-p)*P(made|loss) is the same
     quantity as the unforced estimate, up to Monte Carlo noise. 5 SE of the unforced
     binomial, at 3000 seasons. */
  let worst = 0;
  for (const lv of A.leverage) {
    const g = simGames[lv.game];
    for (const i of [g.h, g.a]) {
      const mix = g.p * lv.ifHomeWin[i] + (1 - g.p) * lv.ifAwayWin[i];
      const p0 = A.teams[i].playoffs, se = Math.sqrt(Math.max(p0 * (1 - p0), 1e-4) / 3000);
      worst = Math.max(worst, Math.abs(mix - p0) / se);
    }
  }
  ok("paired branches recombine to the unforced estimate (within 5 SE)", worst < 5, worst.toFixed(2));
  const neg = A.leverage.flatMap(lv => { const g = simGames[lv.game]; return [lv.ifHomeWin[g.h] - lv.ifAwayWin[g.h], lv.ifAwayWin[g.a] - lv.ifHomeWin[g.a]]; });
  ok("winning never costs a club more than noise", neg.every(d => d > -0.01), Math.min(...neg));
}
{
  /* A finished season resolves without draws: replaying the current finals only (unplayed
     games forced to home wins) must give exactly one seeding, every time. */
  const forced = simGames.map(g => (g.final ? g : { h: g.h, a: g.a, final: true, r: 1 }));
  const S = E.simulate({ league: L, games: forced, sims: 200, seedHex: "00000000000000000000000000000001" });
  const rec = E.createRecords(L.n);
  for (const g of forced) E.addResult(rec, g.h, g.a, g.r);
  const field = new Set(E.seedLeague(L, rec).seeds.flat());
  const certain = S.teams.filter(t => t.playoffs === 0 || t.playoffs === 1);
  ok("a complete season has nothing left to simulate", S.remaining === 0);
  ok("a complete season agrees with the one-shot seeding wherever no coin toss is involved",
    certain.length >= 28 && certain.every(t => (t.playoffs === 1) === field.has(t.code)), certain.length);
}
{
  let threw = false;
  try { E.simulate({ league: L, games: simGames, sims: 10, seedHex: "0123456789abcdef0123456789abcdef", leverage: [simGames.findIndex(g => g.final)] }); }
  catch { threw = true; }
  ok("a finished game cannot be a leverage game", threw);
}

/* ---------------------------------------------------------- 3. the file ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dd-leverage-"));
const build = (...extra) => spawnSync(process.execPath, [path.join(ROOT, "tools/build-playoff-leverage.js"), "--sims", "1000", ...extra], { encoding: "utf8" });
const out1 = path.join(tmp, "a.json"), out2 = path.join(tmp, "b.json");
const r1 = build("--out", out1), r2 = build("--out", out2);
ok("builder runs", r1.status === 0 && r2.status === 0, (r1.stderr || "") + (r2.stderr || ""));
if (r1.status === 0 && r2.status === 0) {
  const txt = fs.readFileSync(out1, "utf8");
  ok("identical inputs produce identical bytes", txt === fs.readFileSync(out2, "utf8"));
  const env = JSON.parse(txt), d = env.data;
  ok("envelope: as_of, source, tier labs, ungraded, tier_meaning, canonical url",
    /^\d{4}-\d{2}-\d{2}$/.test(env.as_of) && env.source && env.tier === "labs" && env.graded === false && env.tier_meaning &&
    env.canonical_url === "https://datadawgs216.com/data/nfl-playoff-leverage.json");
  ok("as_of is the newest input date, never the clock",
    env.as_of === [new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(schedule.provenance.captured_at)), survivor.as_of].sort().pop());
  ok("note says simulation, ungraded and overconfident at the extremes",
    /SIMULATION OUTPUT/.test(env.note) && /ungraded/.test(env.note) && /overconfident/.test(env.note) && /coin toss/.test(env.note));
  ok("inputs name both files with their identifiers",
    env.inputs.schedule.snapshot_id === schedule.integrity.snapshot_id && env.inputs.probabilities.nfelo_sha === survivor.data.meta.nfelo_sha);
  ok("32 teams and a 32-long team order", d.teams.length === 32 && d.team_order.length === 32);
  ok("target week is the earliest week with an unplayed game", d.week === week);
  ok("every game of the target week not yet final is listed", d.games.length === leverage.length && d.week_games.remaining === leverage.length);
  ok("no listed game is final", d.games.every(g => schedule.data.games.find(s => s.game_id === g.game_id).status !== "final"));
  ok("byes are the clubs without a game this week",
    d.byes.length + 2 * d.week_games.total === 32 && d.byes.every(t => !schedule.data.games.some(g => g.week === week && (g.home_team === t || g.away_team === t))));
  ok("games ordered by combined swing, largest first", d.games.every((g, k) => k === 0 || d.games[k - 1].leverage >= g.leverage));
  ok("within a game, larger swing first", d.games.every(g => g.teams[0].swing >= g.teams[1].swing));
  ok("swing = if_win - if_loss (to rounding)", d.games.every(g => g.teams.every(t => Math.abs(t.if_win - t.if_loss - t.swing) <= 2e-4)));
  ok("leverage = sum of the two swings (to rounding)", d.games.every(g => Math.abs(g.teams[0].swing + g.teams[1].swing - g.leverage) <= 2e-4));
  ok("both branches carry all 32 clubs", d.games.every(g => g.if_home_win.length === 32 && g.if_away_win.length === 32));
  ok("each team's branch values agree with the 32-club arrays", d.games.every(g => g.teams.every(t => {
    const i = d.team_order.indexOf(t.team), home = t.side === "home";
    return t.if_win === (home ? g.if_home_win[i] : g.if_away_win[i]) && t.if_loss === (home ? g.if_away_win[i] : g.if_home_win[i]);
  })));
  ok("probabilities stay in [0,1] with four decimals", d.teams.every(t => [t.playoffs, t.division_title, t.bye].every(v => v >= 0 && v <= 1 && Math.abs(Math.round(v * 1e4) - v * 1e4) < 1e-6)));
  ok("records are observed finals only", d.teams.reduce((s, t) => s + t.w + t.l + t.t, 0) === 2 * schedule.data.games.filter(g => g.status === "final").length);
  ok("p_win of the two sides sums to 1", d.games.every(g => Math.abs(g.teams[0].p_win + g.teams[1].p_win - 1) < 2e-4));
  ok("precision is reported from the run, not assumed",
    d.precision && d.precision.swing_se_max === Math.max(...d.games.flatMap(g => g.teams.map(t => t.swing_se))) && d.precision.shift_se_max >= d.precision.swing_se_max &&
    env.method.precision.includes(String(d.precision.shift_se_max)));
}
{ /* fail closed */
  const probs = JSON.parse(JSON.stringify(survivor));
  const gone = probs.data.games.findIndex(g => g.wk === week + 1);
  probs.data.games.splice(gone, 1);
  const pfile = path.join(tmp, "probs-missing.json"); fs.writeFileSync(pfile, JSON.stringify(probs));
  const r = build("--out", path.join(tmp, "x.json"), "--probabilities", pfile);
  ok("an unplayed game without a probability fails the build", r.status !== 0 && /no probability row/.test(r.stderr), r.stderr.slice(0, 200));
  const probs2 = JSON.parse(JSON.stringify(survivor));
  probs2.data.games.find(g => g.wk === week + 1).p = 1;
  const pfile2 = path.join(tmp, "probs-certain.json"); fs.writeFileSync(pfile2, JSON.stringify(probs2));
  const r2b = build("--out", path.join(tmp, "y.json"), "--probabilities", pfile2);
  ok("a probability of exactly 1 fails the build", r2b.status !== 0 && /outside \(0,1\)/.test(r2b.stderr), r2b.stderr.slice(0, 200));
  const sched = JSON.parse(JSON.stringify(schedule));
  const g = sched.data.games.find(x => x.divisional);
  g.divisional = false;
  const sfile = path.join(tmp, "sched-realigned.json"); fs.writeFileSync(sfile, JSON.stringify(sched));
  const r3 = build("--out", path.join(tmp, "z.json"), "--schedule", sfile);
  ok("a division table that disagrees with the schedule fails the build", r3.status !== 0 && /division table disagrees/.test(r3.stderr), r3.stderr.slice(0, 200));
}
fs.rmSync(tmp, { recursive: true, force: true });

/* ------------------------------------------------- 4. the published file ----
   Only with --published: the refresh job runs it AFTER rebuilding. Run unflagged before a
   rebuild, a freshness check would fail on exactly the day the inputs moved and block the
   job that fixes it. */
if (process.argv.includes("--published")) {
  const pub = path.join(ROOT, "data/nfl-playoff-leverage.json");
  if (fs.existsSync(pub)) {
    const env = JSON.parse(fs.readFileSync(pub, "utf8"));
    ok("published file names the schedule snapshot it was built from",
      env.inputs.schedule.snapshot_id === schedule.integrity.snapshot_id, "rebuild: node tools/build-playoff-leverage.js");
    ok("published file names the probability snapshot it was built from",
      env.inputs.probabilities.as_of === survivor.as_of && env.inputs.probabilities.nfelo_sha === survivor.data.meta.nfelo_sha,
      "rebuild: node tools/build-playoff-leverage.js");
    ok("published file uses at least 50,000 seasons", env.data.sims >= 50000, env.data.sims);
  } else ok("published file exists", false, "run node tools/build-playoff-leverage.js");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
