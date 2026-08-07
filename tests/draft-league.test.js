const assert=require("assert");
const core=require("../draft-league.js");

assert.strictEqual(core.activeLeagueId("?league=dd_"+"a".repeat(32)),"dd_"+"a".repeat(32));
assert.strictEqual(core.activeLeagueId("?league=short"),null);
assert.strictEqual(core.activeLeagueId("?sync=legacy-token"),null);

const ids=["dd_"+"a".repeat(32),"dd_"+"b".repeat(32)];
assert.notStrictEqual(core.storageKey("dd-auction-v1",ids[0]),core.storageKey("dd-auction-v1",ids[1]));
assert.strictEqual(core.storageKey("dd-auction-v1",null),"dd-auction-v1");

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

console.log("draft league tests: ok");
