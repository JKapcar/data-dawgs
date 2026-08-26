/* Guillotine Companion — end-to-end logic test for the page's sync IIFE and Toto surface.
   Extracts the live <script> blocks from ../guillotine.html and runs them against a
   stubbed DOM, stubbed localStorage, and a faked Sleeper API + Worker players-slim
   endpoint. No network, no browser.

   Run:  cd work && node test-guillotine.mjs
*/
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
};

/* ------------------------------- DOM stubs ------------------------------- */
const escapeHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function makeEl(id) {
  return {
    id, innerHTML: "", style: {}, value: "",
    _text: "", _cls: "",
    set textContent(v) { this._text = String(v); this.innerHTML = escapeHtml(v); },
    get textContent() { return this._text; },
    // ⚠️ className and classList are the same state in a browser. The stub used to
    // keep them separate, so `el.className = "a b"` left classList.contains() false
    // and a passing page looked broken to the test.
    set className(v) {
      this._cls = String(v);
      this.classList._s = new Set(this._cls.split(/\s+/).filter(Boolean));
    },
    get className() { return this._cls; },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    handlers: {},
    addEventListener(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
    querySelectorAll() { return []; },
    getContext() { return null; },   // canvas: no 2d ctx headless, so the wheel no-ops
    click() { (this.handlers.click || []).forEach(f => f({})); },
  };
}
const els = new Map();
const byId = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  getElementById: byId,
  createElement: () => makeEl(null),
  querySelectorAll: () => [],
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};

/* ----------------------------- Sleeper fixtures ---------------------------
   Six-team league, $100 FAAB, 3 completed weeks. Roster 6 was chopped after
   week 2: its roster is now empty and it scored 0 in week 3. Player p9 was
   dropped (on nobody's roster) after scoring in weeks 1-3; p6x1/p6x2 belonged
   to the chopped team. p1..p5 remain rostered. */
const WEEKS_DONE = 3;
const league = {
  name: "Test Guillotine", season: "2026",
  settings: { waiver_budget: 100 },
};
const users = [1, 2, 3, 4, 5, 6].map(i => ({
  user_id: "u" + i, display_name: "Mgr" + i, metadata: { team_name: "Team " + i },
}));
const rosters = [
  { roster_id: 1, owner_id: "u1", players: ["p1", "p2"], settings: { waiver_budget_used: 10 } },
  { roster_id: 2, owner_id: "u2", players: ["p3"], settings: { waiver_budget_used: 40 } },
  { roster_id: 3, owner_id: "u3", players: ["p4"], settings: { waiver_budget_used: 0 } },
  { roster_id: 4, owner_id: "u4", players: ["p5"], settings: { waiver_budget_used: 100 } },
  { roster_id: 5, owner_id: "u5", players: ["p6"], settings: { waiver_budget_used: 25 } },
  { roster_id: 6, owner_id: "u6", players: [], settings: { waiver_budget_used: 60 } }, // chopped
];
const base = { 1: 120, 2: 110, 3: 100, 4: 95, 5: 90, 6: 85 };
const jitter = { 1: [0, 6, -6], 2: [3, -3, 6], 3: [-4, 4, 8], 4: [5, -5, 2], 5: [-2, 2, -6], 6: [1, -1, 0] };
const matchups = (w) => rosters.map(r => {
  const dead = r.roster_id === 6 && w > 2;
  const pts = dead ? 0 : base[r.roster_id] + jitter[r.roster_id][w - 1];
  const pp = {};
  if (!dead) {
    // every live roster's players score; p9 scored on roster 3 in all completed weeks
    (r.roster_id === 6 ? ["p6x1", "p6x2"] : rosters[r.roster_id - 1].players).forEach((p, i) => { pp[p] = 10 + i + w; });
    if (r.roster_id === 3) pp["p9"] = 20 + w; // later dropped: on no current roster
  }
  return { roster_id: r.roster_id, points: pts, players_points: pp };
});

const PLAYERS_SLIM = {
  as_of: "2026-08-08",
  source: "Sleeper /players/nfl, slimmed by the Data Dawgs Worker",
  data: { players: { p9: ["Waiver Wonder", "RB", "CLE"], p6x1: ["Chopped One", "WR", "PIT"], p6x2: ["Chopped Two", "TE", null] } },
};

/* Draft War Room fixtures: 6-team, 3-round snake tied to league 12345. Pick 3's
   name matches nothing on the board on purpose — an unmatched name must not strike
   anything. */
const DRAFT = {
  draft_id: "d1", league_id: "12345", status: "drafting", type: "snake", start_time: 1,
  settings: { teams: 6, rounds: 3, reversal_round: 0 },
  draft_order: { u1: 1, u2: 2, u3: 3, u4: 4, u5: 5, u6: 6 },
};
const DRAFT_PICKS = [
  { round: 1, pick_no: 1, draft_slot: 1, picked_by: "u1", metadata: { first_name: "Jahmyr", last_name: "Gibbs", position: "RB", team: "DET" } },
  { round: 1, pick_no: 2, draft_slot: 2, picked_by: "u2", metadata: { first_name: "Bijan", last_name: "Robinson", position: "RB", team: "ATL" } },
  { round: 1, pick_no: 3, draft_slot: 3, picked_by: "u3", metadata: { first_name: "Zzz", last_name: "Nobody", position: "RB", team: "FA" } },
];

let slimMode = "up"; // "up" | "down"
globalThis.fetch = async (u) => {
  const url = String(u);
  const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("/sleeper/players-slim"))
    return slimMode === "up" ? j(PLAYERS_SLIM) : new Response("nope", { status: 404 });
  if (url.includes("/state/nfl")) return j({ week: WEEKS_DONE + 1, display_week: WEEKS_DONE + 1, season_type: "regular" });
  if (url.endsWith("/league/12345/drafts")) return j([{ draft_id: "d1", start_time: 1, status: "drafting" }]);
  if (url.endsWith("/draft/d1/picks")) return j(DRAFT_PICKS);
  if (url.endsWith("/draft/d1")) return j(DRAFT);
  if (url.endsWith("/league/12345")) return j(league);
  if (url.includes("/users")) return j(users);
  if (url.includes("/rosters")) return j(rosters);
  const m = url.match(/\/matchups\/(\d+)$/);
  if (m) return j(matchups(Number(m[1])));
  throw new Error("unexpected fetch " + url);
};

/* ------------------------- load the page's scripts ------------------------ */
const html = readFileSync(resolve(HERE, "../guillotine.html"), "utf8");
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const syncBlock = blocks.find(b => b.includes('"dd-guillotine-v1"'));
const botBlock = blocks.find(b => b.includes("GUILLOTINE LEAGUE"));
ok("page has the sync and bot-context script blocks", !!syncBlock && !!botBlock);

// Pre-seed a connected league with "me" = roster 2, so the IIFE auto-syncs on load.
store.set("dd-guillotine-v1", JSON.stringify({ id: "12345", me: 2 }));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(syncBlock)();
await new Promise(r => setTimeout(r, 50)); // let sync() + renderWaiver settle
new Function(botBlock)();

/* --------------------------------- checks -------------------------------- */
const G = globalThis.__GX;
ok("__GX exists after sync", !!G);
ok("chopped team detected via empty roster", G && G.chopped === 1, "chopped=" + (G && G.chopped));
ok("simulation excludes the chopped team", G && G.teams.length === 5, "teams=" + (G && G.teams.length));
ok("chop band ordered lo <= median <= hi", G && G.chopLo <= G.chop && G.chop <= G.chopHi,
  G && [G.chopLo, G.chop, G.chopHi].join("/"));
ok("band is a real spread, not a point", G && G.chopHi - G.chopLo > 1);

const F = G && G.faab;
ok("FAAB summary stashed", !!F);
// alive teams: used 10,40,0,100,25 -> left 90,60,100,0,75 = 325 (chopped 40 excluded)
ok("FAAB pool sums surviving teams only", F && F.pool === 325, "pool=" + (F && F.pool));
ok("FAAB per-team average is pool/alive", F && F.perTeam === 65, "perTeam=" + (F && F.perTeam));
ok("your dollars follow the saved team (roster 2: $60)", F && F.mine && F.mine.left === 60,
  "mine=" + JSON.stringify(F && F.mine));
ok("your share is dollars/pool", F && F.mine && Math.abs(F.mine.share - 18.5) < 0.11, "share=" + (F && F.mine && F.mine.share));

const faabHtml = byId("gxFaabTab").innerHTML;
ok("FAAB table renders every surviving team", faabHtml.split("<tr>").length - 1 >= 5);
ok("FAAB table does not list the chopped team", !faabHtml.includes("Team 6"));
ok("FAAB card is visible", byId("gxFaabCard").style.display === "");

const W = G && G.waiver;
ok("waiver board stashed on __GX", Array.isArray(W) && W.length > 0);
ok("waiver board excludes rostered players", W && !W.some(w => w.name.startsWith("id p1")) &&
  !JSON.stringify(W || []).includes('"p3"'));
const wonder = W && W.find(w => w.name === "Waiver Wonder");
ok("dropped player appears with observed avg (21,22,23 -> 22)", wonder && wonder.avg === 22,
  "wonder=" + JSON.stringify(wonder));
ok("chopped roster's players appear on the board", W && W.some(w => w.name === "Chopped One"));
const wvHtml = byId("gxWvTab").innerHTML;
ok("waiver table renders names, not raw ids", wvHtml.includes("Waiver Wonder") && !wvHtml.includes("id p9"));
ok("module 06 card is labeled observed when the backend answers", byId("gxM6").textContent === "Observed");

/* Toto context */
const BC = globalThis.DD_BOTCTX;
ok("DD_BOTCTX present", !!BC && typeof BC.ctx === "function");
const ctx = BC.ctx();
ok("ctx names the league", ctx.includes("Test Guillotine"));
ok("ctx carries the 80% band", /80% band/.test(ctx));
ok("ctx carries observed FAAB", ctx.includes("FAAB (all observed)") && ctx.includes("$325"));
ok("ctx carries the waiver board with names", ctx.includes("WAIVER BOARD") && ctx.includes("Waiver Wonder"));
ok("ctx flags the chopped team", ctx.includes("chopped"));
ok("ctx flags thin history under 4 weeks", ctx.includes("ONLY 3 COMPLETED WEEK"));
ok("sys prompt separates observed FAAB from framework", BC.sys.includes("OBSERVED league facts"));

/* ------------------ degraded path: players-slim endpoint down ------------- */
slimMode = "down";
els.clear();
globalThis.__GX = null;
store.set("dd-guillotine-v1", JSON.stringify({ id: "12345", me: 2 }));
await new AsyncFunction(syncBlock)();
await new Promise(r => setTimeout(r, 50));
const note2 = byId("gxWvNote").innerHTML;
// The route is deployed now, so a failure here is a transient outage, not a pending
// ship — the copy says "reload in a minute" and must not promise a future deploy.
ok("waiver board degrades honestly when the name lookup fails",
  /didn't answer just now/.test(note2) && /temporary/.test(note2), note2.slice(0, 120));
ok("degraded copy no longer promises an undeployed backend", !/not yet deployed/.test(note2));
ok("no raw ids leak into the degraded table", byId("gxWvTab").innerHTML === "");
ok("module 06 card downgrades to Degraded", byId("gxM6").textContent === "Degraded");
ok("module 06 loses its live styling when degraded", !byId("gxM6").classList.contains("on"));
ok("FAAB still renders without the backend", byId("gxFaabTab").innerHTML.includes("Team 1"));
ok("__GX still stashed without the backend", !!globalThis.__GX && !!globalThis.__GX.faab);

/* -------------------- pre-maths path: 0 completed weeks ------------------- */
els.clear();
globalThis.__GX = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.includes("/state/nfl"))
    return new Response(JSON.stringify({ week: 0, display_week: 0, season_type: "pre" }), { status: 200 });
  return realFetch(u);
};
store.set("dd-guillotine-v1", JSON.stringify({ id: "12345", me: 2 }));
await new AsyncFunction(syncBlock)();
await new Promise(r => setTimeout(r, 50));
const G0 = globalThis.__GX;
ok("pre-season: __GX minimal stash exists", !!G0 && G0.teams.length === 0);
ok("pre-season: FAAB still present for Toto", !!G0 && !!G0.faab && G0.faab.budget === 100);
ok("pre-season: no team reads as chopped when nothing is scored", byId("gxFaabTab").innerHTML.includes("Team 6"));
const ctx0 = globalThis.DD_BOTCTX.ctx();
ok("pre-season ctx says the maths is off, with FAAB", ctx0.includes("not on yet") && ctx0.includes("FAAB"));
globalThis.fetch = realFetch;

/* ----------------------------- Draft War Room ---------------------------- */
els.clear();
const draftBlock = blocks.find(b => b.includes('"dd-guillotine-draft-v1"'));
ok("page has the draft war-room script block", !!draftBlock);
// A saved draft + claimed slot reconnects on its own, exactly like the league shelf.
store.set("dd-guillotine-draft-v1", JSON.stringify({ draftId: "d1", slots: { d1: 2 } }));
await new AsyncFunction(draftBlock)();
await new Promise(r => setTimeout(r, 80));
const D = globalThis.__GXD;
ok("__GXD stashed after draft load", !!D);
ok("draft status and shape read", D && D.status === "drafting" && D.teams === 6 && D.rounds === 3);
ok("next pick is #4, slot 4", D && D.nextNo === 4 && D.nextSlot === 4, D && (D.nextNo + "/" + D.nextSlot));
ok("snake math: slot 2's next pick is 7 away (#11)", D && D.untilMe === 7, "until=" + (D && D.untilMe));
ok("my picks follow the claimed slot", D && D.myPicks.length === 1 && D.myPicks[0].name.includes("Bijan"));
ok("best available skips drafted board players", D && D.best.ALL === "Ja'Marr Chase", D && String(D.best.ALL));
ok("an unmatched pick name strikes nothing", D && D.drafted === 2, "drafted=" + (D && D.drafted));
ok("board labels are editorial with dates", D && D.boardBuilt === "2026-08-26" && D.mvAsOf === "2026-08-24");
const bd = byId("gxDBoard").innerHTML;
ok("board renders tier rows and strikes the drafted", bd.includes("gxd-tier") && bd.includes("gxd-gone"));
ok("the user's own pick is highlighted", bd.includes("gxd-mine"));
ok("on-the-clock team is named from draft order + users", D && D.onClock === "Team 4", D && String(D.onClock));
const SN = globalThis.__GXDT;
ok("snake: round 2 reverses", SN && SN.slotFor(7, 6, 0).slot === 6);
ok("snake: third-round reversal repeats the direction, then resumes",
  SN && SN.slotFor(13, 6, 3).slot === 6 && SN.slotFor(19, 6, 3).slot === 1);
const dctx = globalThis.DD_BOTCTX && globalThis.DD_BOTCTX.ctx();
ok("Toto ctx carries the draft room when a draft is live",
  dctx && dctx.includes("DRAFT WAR ROOM") && dctx.includes("EDITORIAL"));

/* ------------------- Prime Time hero: the danger ladder ------------------ */
const ldsBlock = blocks.find(b => b.includes('"dd-guillotine-leagues-v1"'));
ok("page has the Last Dawg Standing view block", !!ldsBlock);

const ALL6 = [{ rid: 1, name: "Team 1" }, { rid: 2, name: "Team 2" }, { rid: 6, name: "Chopped Six" }];

els.clear();
globalThis.__GX = { leagueId: "12345", league: "T", season: "2026", teamCount: 3, done: 0, teams: [], all: ALL6 };
new Function(ldsBlock)();
await new Promise(r => setTimeout(r, 20));
const lad0 = byId("gxLadder").innerHTML;
ok("preseason ladder names every team rather than rendering blank",
  lad0.includes("Team 1") && lad0.includes("Chopped Six"), lad0.slice(0, 90));
ok("preseason bars are flat, not risk-scaled", (lad0.match(/--h:96px/g) || []).length === 3);
ok("preseason ladder is tagged flat for the phone layout", byId("gxLadder").classList.contains("is-flat"));
ok("preseason cut line says it is not drawn yet",
  byId("gxCutLab").textContent.includes("once scores exist"));
ok("preseason copy reads not-started, not broken",
  /No games played/.test(byId("gxFlat").textContent), byId("gxFlat").textContent);

els.clear();
globalThis.__GX = {
  leagueId: "12345", league: "T", season: "2026", teamCount: 3, done: 3,
  chop: 96.42, chopped: 1, me: { rid: 2, name: "Team 2", surv: .9, mean: 110 }, all: ALL6,
  teams: [{ rid: 6, name: "Team 6", surv: .55, mean: 90, sd: 8, low: 80, last: 88 },
          { rid: 2, name: "Team 2", surv: .9, mean: 110, sd: 6, low: 100, last: 112 }],
};
new Function(ldsBlock)();
await new Promise(r => setTimeout(r, 20));
const lad1 = byId("gxLadder").innerHTML;
ok("live ladder prints modeled chop risk per team", lad1.includes("45%") && lad1.includes("10%"));
ok("live ladder flags the focus team", lad1.includes("pt-lane me"));
ok("riskiest team gets the tallest bar",
  (lad1.indexOf("--h:130px") > -1) && lad1.indexOf("--h:130px") < lad1.indexOf("Team 2"));
// ⚠️ --p is what the phone layout reads; a bar with only --h is invisible under 640px.
ok("every live bar carries the phone width too", (lad1.match(/--p:\d+%/g) || []).length === 2);
ok("live ladder is tagged live for the phone layout", byId("gxLadder").classList.contains("is-live"));
ok("hero stats carry alive / chopped / cut line",
  byId("gxHeroStats").innerHTML.includes("96.4") && byId("gxHeroStats").innerHTML.includes("Chopped"));

/* structure + the dark-panel legibility fix */
ok("the wheel moved to its own sheet", html.includes('data-gx-panel="wheel"'));
ok("the ladder is the hero — above the tab strip",
  html.indexOf('id="gxLadder"') < html.indexOf('data-gx-sheet="survival"'));
ok("tab labels are plain English",
  ["Am I Safe?", "Draft Room", "Full Board", "The Money", "Chop Wheel", "The Long Game", "Weak Spots"]
    .every(t => html.includes(">" + t + "</button>")));
ok("no internal jargon left on the tab strip",
  !html.includes(">Roster Fragility</button>") && !html.includes(">League Danger Board</button>"));
// ⚠️ Regression guard for a live bug: .dtab inherits var(--ink-1), a DARK ink, so
// inside the dark .gx-stage the team table rendered as blank rows.
ok("stage table ink is stated explicitly, not inherited from a light-theme token",
  html.includes(".gx-stage .dtab td,.gx-stage .dtab th{color:"));
ok("wheel labels are radial, the fix for 18 colliding names",
  html.includes("Labels are RADIAL on purpose"));
/* the machine room lives behind a door, not in the middle of the page */
ok("setup is a drawer, not a permanent block", html.includes('<details class="pt-setup"'));
ok("modules and the honesty card sit inside the back card",
  html.indexOf('<details class="pt-back"') < html.indexOf('<h2 class="secn">Modules</h2>') &&
  html.indexOf('<h2 class="secn">Modules</h2>') < html.indexOf("What this can't do"));
ok("the honesty card is still reachable, only collapsed",
  html.includes("What this can't do") && html.includes('class="honesty"'));
ok("the phone ladder has a row layout to switch into", html.includes(".pt-ladder.is-live .pt-lane{display:grid"));

/* -------------------- The Long Game: season Monte Carlo ------------------ */
els.clear();
const MC4 = [
  { rid: 1, name: "Alpha", owner: "a", surv: .99, mean: 125, sd: 8, low: 110, last: 126 },
  { rid: 2, name: "Beta",  owner: "b", surv: .90, mean: 112, sd: 8, low: 100, last: 113 },
  { rid: 3, name: "Gamma", owner: "c", surv: .70, mean: 101, sd: 8, low: 90,  last: 100 },
  { rid: 4, name: "Delta", owner: "d", surv: .40, mean: 90,  sd: 8, low: 78,  last: 88 },
];
globalThis.__GX = { leagueId: "12345", league: "T", season: "2026", teamCount: 4, done: 3,
  chop: 92, chopped: 0, me: { rid: 2, name: "Beta", surv: .9, mean: 112 },
  all: MC4.map(t => ({ rid: t.rid, name: t.name })), teams: MC4 };
new Function(ldsBlock)();
await new Promise(r => setTimeout(r, 30));
const MC = globalThis.__GX.mc;
ok("season Monte Carlo stashed under G.mc", !!MC && Array.isArray(MC.rows));
// ⚠️ regression: __GX.season is the NFL season STRING ("2026") — the cache must
// never live there, or `if(G.season)` is always true and Toto's ctx crashes.
ok("the season string survives untouched", globalThis.__GX.season === "2026");
ok("simulates min(alive-1, 17-done) chop weeks", MC && MC.weeks.length === 3 && MC.weeks[0] === 4);
ok("win odds sum to one across the field",
  MC && Math.abs(MC.rows.reduce((a, r) => a + r.win, 0) - 1) < 0.02,
  MC && String(MC.rows.reduce((a, r) => a + r.win, 0)));
ok("the strongest scorer has the best win odds", MC && MC.rows[0].name === "Alpha");
ok("the weakest scorer wins least",
  MC && MC.rows[MC.rows.length - 1].name === "Delta" && MC.rows[MC.rows.length - 1].win < MC.rows[0].win);
ok("every survival curve decays monotonically",
  MC && MC.rows.every(r => r.curve.every((v, i) => i === 0 || v <= r.curve[i - 1] + 1e-9)));
ok("curve end equals win odds when the field plays to one dawg",
  MC && MC.rows.every(r => Math.abs(r.curve[r.curve.length - 1] - r.win) < 1e-9));
ok("median finishes stay inside 1..teams",
  MC && MC.rows.every(r => r.med >= 1 && r.med <= 4));
const seasHtml = byId("gxSeasonTab").innerHTML;
ok("matrix renders one column per remaining week + win/finish",
  seasHtml.includes("Wk 4") && seasHtml.includes("Wk 6") && seasHtml.includes("Wins it all") && seasHtml.includes("Median finish"));
ok("matrix rows carry every simulated team", ["Alpha", "Beta", "Gamma", "Delta"].every(n => seasHtml.includes(n)));
ok("heat cells are painted", seasHtml.includes('class="hm"') && seasHtml.includes("rgba("));
ok("focus team is flagged in the matrix", /class="me">Beta/.test(seasHtml));
ok("survival chart drawn with the focus curve on top", byId("gxSeasonChart").innerHTML.includes("<svg") &&
  byId("gxSeasonChart").innerHTML.includes("Beta"));
ok("season note says frozen rosters, illustration not forecast",
  /frozen/i.test(byId("gxSeasonNote").innerHTML) && /not a forecast/.test(byId("gxSeasonNote").innerHTML));
const mcCtx = globalThis.DD_BOTCTX.ctx();
ok("Toto ctx carries the season table with its caveats",
  mcCtx.includes("SEASON MONTE CARLO") && mcCtx.includes("FROZEN") && mcCtx.includes("Alpha"));
ok("honesty card no longer lists the season MC as Planned",
  !html.includes("season championship Monte Carlo, Universal") && html.includes("compound with every simulated week"));

/* ----------------------- Last Dawg Standing V1 contract ------------------ */
ok("locked product name and descriptor ship together",
  html.includes("Last Dawg Standing") && html.includes("The Guillotine League Companion"));
ok("Chop Chamber has weighted-wheel and repeat-spin controls",
  html.includes('id="gxWheel"') && html.includes('id="gxSpinOne"') && html.includes('id="gxSpinTen"'));
ok("all six lower sheets are present",
  ["survival", "draft", "waivers", "danger", "season", "fragility"].every(k => html.includes(`data-gx-panel="${k}"`)));
ok("prediction receipt is explicitly local-device V1",
  html.includes("DEVICE RECEIPT") && html.includes("local only") && html.includes("not server-persisted"));
ok("Sunday model cannot be presented as live scoring",
  html.includes("THIS IS NOT A LIVE SUNDAY SCORE TRACKER") && html.includes("not live scores"));

console.log("\nguillotine: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
