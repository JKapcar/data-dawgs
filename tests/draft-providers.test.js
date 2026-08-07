const assert=require("assert");
const leagueCore=require("../draft-league.js");

if(!global.crypto){
  global.crypto={getRandomValues(array){ for(let i=0;i<array.length;i++) array[i]=(i*17)%256; return array; }};
}
global.DDLeague={normalize:leagueCore.normalizeLeague,stateFromLeague:leagueCore.stateFromLeague};
const providers=require("../draft-providers.js");

assert.deepStrictEqual(providers.parseSleeper("https://sleeper.com/leagues/123456789012345678"),{
  provider:"sleeper",kind:"league",id:"123456789012345678",sourceUrl:"https://sleeper.com/leagues/123456789012345678"
});
assert.strictEqual(providers.parseSleeper("https://sleeper.com/draft/nfl/987654321098765432").kind,"draft");
assert.strictEqual(providers.parseSleeper("123456789012345678").kind,"league");
assert.strictEqual(providers.parseYahoo("https://football.fantasysports.yahoo.com/f1/123456").id,"123456");
assert.strictEqual(providers.parseEspn("https://fantasy.espn.com/football/league?leagueId=24680").id,"24680");
assert.strictEqual(providers.parseProvider("https://example.com/league/123"),null);
assert.strictEqual(providers.parseProvider("not even a URL"),null);

assert.deepStrictEqual(providers.rosterSlots(["QB","RB","RB","WR","W/R/T","SUPER_FLEX","BN","BN"]),[
  {slot:"QB",count:1},{slot:"RB",count:2},{slot:"WR",count:1},{slot:"FLEX",count:1},{slot:"SUPERFLEX",count:1},{slot:"BN",count:2}
]);
assert.strictEqual(providers.scoringConfig({rec:.5},["QB"]).mode,"half");
assert.strictEqual(providers.scoringConfig({rec:1,bonus_rec_te:1},["QB"]).mode,"custom");

const pool=[
  {id:"dd_player_1",name:"Jahmyr Gibbs",pos:"RB",team:"DET",half:81},
  {id:"dd_player_2",name:"Josh Allen",pos:"QB",team:"BUF",half:30}
];
const payload={
  ref:{provider:"sleeper",kind:"league",id:"123456789012345678",sourceUrl:"https://sleeper.com/leagues/123456789012345678"},
  league:{league_id:"123456789012345678",name:"Fixture League",season:"2026",total_rosters:2,roster_positions:["QB","RB","WR","W/R/T","BN"],scoring_settings:{rec:.5}},
  users:[
    {user_id:"u1",display_name:"Kap",metadata:{team_name:"Data Dawgs"}},
    {user_id:"u2",display_name:"Taylor",metadata:{}}
  ],
  rosters:[{roster_id:1,owner_id:"u1"},{roster_id:2,owner_id:"u2"}],
  draft:{draft_id:"draft123456",league_id:"123456789012345678",type:"snake",status:"drafting",draft_order:{u1:1,u2:2}},
  picks:[
    {pick_no:1,round:1,draft_slot:1,roster_id:1,player_id:"s1",metadata:{first_name:"Jahmyr",last_name:"Gibbs",position:"RB",team:"DET"}},
    {pick_no:2,round:1,draft_slot:2,roster_id:2,player_id:"s2",metadata:{first_name:"Unknown",last_name:"Rookie",position:"WR",team:"FA"}}
  ]
};
const imported=providers.normalizeImport(payload,{pool});
assert.strictEqual(imported.league.name,"Fixture League");
assert.strictEqual(imported.league.config.teamCount,2);
assert.strictEqual(imported.league.config.teams[0].name,"Data Dawgs");
assert.strictEqual(imported.league.config.teams[0].draftSlot,1);
assert.strictEqual(imported.league.config.scoring.mode,"half");
assert.strictEqual(imported.league.provider.draftId,"draft123456");
assert.strictEqual(imported.state.picks.length,2);
assert.strictEqual(imported.state.picks[0].playerId,"dd_player_1");
assert.strictEqual(imported.state.picks[0].price,null);
assert.strictEqual(imported.diagnostics.unresolvedMappings.length,1);

const {reconcilePicks}=require("../draft-live-sync.js");
const first=reconcilePicks([],imported.state.picks);
const second=reconcilePicks(first,imported.state.picks.concat(imported.state.picks[0]));
assert.strictEqual(first.length,2);
assert.strictEqual(second.length,2,"repeated Sleeper responses must not duplicate picks");
assert.strictEqual(new Set(second.map(p=>p.providerPickId)).size,2);

console.log("draft provider tests: ok");
