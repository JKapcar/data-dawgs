const assert=require("assert");
const core=require("../draft-league.js");

assert.strictEqual(core.activeLeagueId("?league=dd_"+"a".repeat(32)),"dd_"+"a".repeat(32));
assert.strictEqual(core.activeLeagueId("?league=pepperoninipples"),"pepperoninipples");
assert.strictEqual(core.activeLeagueId("?league=short"),null);
assert.strictEqual(core.activeLeagueId("?sync=legacy-token"),null);

const ids=["dd_"+"a".repeat(32),"dd_"+"b".repeat(32)];
assert.notStrictEqual(core.storageKey("dd-auction-v1",ids[0]),core.storageKey("dd-auction-v1",ids[1]));
assert.strictEqual(core.storageKey("dd-auction-v1",null),"dd-auction-v1");

const seeded=core.leagueFromCanonical(require("../data/leagues/pepperoninipples.json"));
assert.strictEqual(seeded.id,"pepperoninipples");
assert.strictEqual(seeded.name,"JohnMaddenPepperoniNipplesXV");
assert.strictEqual(seeded.config.teamCount,14);
assert.strictEqual(seeded.config.teams.length,14);
assert.strictEqual(seeded.provider.name,"yahoo");

for(const teamCount of [10,12,14,16]){
  const league=core.normalizeLeague({
    id:"dd_"+String(teamCount).padStart(32,"0"),name:`League ${teamCount}`,season:2026,
    config:{draftType:"auction",teamCount,budget:250,rosterSlots:[{slot:"QB",count:1},{slot:"RB",count:2},{slot:"BN",count:5}],scoring:{mode:"half",ppr:.5},teams:[]}
  });
  const state=core.stateFromLeague(league);
  assert.strictEqual(state.settings.teams.length,teamCount);
  assert.strictEqual(state.settings.budget,250);
  assert.strictEqual(state.settings.spots,8);
}

for(const mode of ["half14","sfhalf12"]){
  const league=core.normalizeLeague({id:"dd_"+mode.padEnd(32,"0"),name:mode,season:2026,
    config:{draftType:"auction",teamCount:12,budget:200,rosterSlots:[{slot:"QB",count:1}],scoring:{mode},teams:[]}});
  assert.strictEqual(league.config.scoring.mode,mode,`${mode} survives league normalization`);
  assert.strictEqual(core.stateFromLeague(league).settings.scoring,mode,`${mode} reaches the draft state`);
}

const custom=core.stateFromLeague(core.normalizeLeague({
  id:"dd_"+"c".repeat(32),name:"Custom Scoring",season:2026,
  config:{draftType:"auction",teamCount:10,budget:200,rosterSlots:[{slot:"QB",count:1}],
    scoring:{mode:"custom",ppr:.75,raw:{bonus_rec_te:1}},teams:[]}
}));
assert.strictEqual(custom.settings.scoring,"half","auction math keeps the safe half-PPR fallback");
assert.strictEqual(custom.settings.scoringConfig.mode,"custom","the UI must retain the honest custom-scoring signal");

const firebaseEmpty=core.normalizeDraftState({
  settings:{scoring:"half",scoringConfig:{mode:"custom"}},ts:1
});
assert.deepStrictEqual(firebaseEmpty.picks,[],"Firebase-omitted empty picks are restored during hydration");
assert.strictEqual(firebaseEmpty.settings.scoringConfig.mode,"custom","normalization preserves scoring context");

const drafted=core.normalizeDraftState({settings:{scoring:"full"},picks:[{id:"p1"}]});
assert.deepStrictEqual(drafted.picks,[{id:"p1"}],"existing picks are preserved");

/* The 2026 auction is committed to the canonical record, so every leaguemate can rebuild
   the board from the repo instead of from whatever the Firebase room happens to hold. */
const canonical=require("../data/leagues/pepperoninipples.json");
assert.strictEqual(canonical.draft.status,"complete");
assert.strictEqual(canonical.draft.picks.length,canonical.draft.pick_count);

const final=core.stateFromCanonical(canonical);
assert.strictEqual(final.picks.length,157,"every recorded sale reaches the draft state");
assert.ok(final.ts>0 && final.ts===Date.parse(canonical.draft.completed_at),
  "the state is stamped at the final sale, so a later live push always wins");
assert.strictEqual(final.settings.teams.length,14);
assert.deepStrictEqual(final.settings.teams.map(t=>t.name).slice(0,3),
  ["Data Dawgs","Dirty Mike","Butts"]);

const spend=new Array(14).fill(0);
for(const pick of final.picks){
  assert.ok(Number.isInteger(pick.ti) && pick.ti>=0 && pick.ti<14,`${pick.player} lands on a real team`);
  assert.ok(pick.player && pick.pos,`${pick.player} carries a name and a position`);
  spend[pick.ti]+=pick.price;
}
for(const [i,total] of spend.entries())
  assert.ok(total<=final.settings.budget,`${final.settings.teams[i].name} spent $${total} of $${final.settings.budget}`);
assert.strictEqual(spend.reduce((a,b)=>a+b,0),2786,"the board's own money total");
assert.strictEqual(new Set(final.picks.map(p=>p.player)).size,157,"nobody was sold twice");

console.log("draft league tests: ok");
