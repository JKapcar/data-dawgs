const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'stats.html'),'utf8');
const DATA=JSON.parse(html.match(/^const DATA = (.*);$/m)[1]),SEASONS=DATA.seasons;
const env=JSON.parse(fs.readFileSync(path.join(root,'data/epa-teams.json')));
const context=vm.createContext({DATA,SEASONS});
vm.runInContext(html.slice(html.indexOf('function seasonMinimum('),html.indexOf('let manualMinimum=')),context);
test('newest available season is the default; season minimum is prorated and bounded',()=>{
 assert.match(html,/seasons:new Set\(\[SEASONS.length-1\]\)/);
 const latest=SEASONS.at(-1),c=DATA.coverage[latest];
 const expected=c.weeks==='all'?200:Math.min(200,Math.ceil(200*(c.regular_games??c.games)/272));
 assert.equal(context.seasonMinimum(SEASONS.length-1),expected);
 assert.equal(context.seasonMinimum(SEASONS.indexOf(2025)),200);
 assert.ok(env.data.by_season[latest].qbs.length>0);
 assert.equal(env.data.qb_minimums.partial_season[latest],expected);
});
test('page and machine mirrors carry identical dated game coverage',()=>{
 assert.deepEqual(env.data.coverage,DATA.coverage);
 const players=JSON.parse(fs.readFileSync(path.join(root,'data/epa-players.json')));
 assert.deepEqual(players.data.coverage,DATA.coverage);
 const c=DATA.coverage[SEASONS.at(-1)];assert.equal(c.games,c.game_ids.length);
 assert.equal(new Set(c.game_ids).size,c.games);assert.match(c.refreshed_at,/Z$/);
});
test('a current-season team EPA reproduces directly from encoded plays',()=>{
 const row=env.data.by_season[SEASONS.at(-1)].teams[0];
 const cols=Object.fromEntries(Object.entries(DATA.cols).map(([k,v])=>[k,Buffer.from(v,'base64')]));
 let n=0,sum=0;for(let i=0;i<DATA.n;i++)if(cols.season[i]===SEASONS.length-1&&DATA.teams[cols.pos[i]]===row.team&&cols.down[i]&&!(cols.flags[i]&8)){n++;sum+=cols.epa.readInt16LE(i*2)/100;}
 assert.equal(row.plays,n);assert.equal(row.off_epa_play,+(sum/n).toFixed(4));
});
test('page context and labels no longer claim a frozen two-week current season',()=>{
 assert.doesNotMatch(html,/2026 covers REGULAR-SEASON WEEKS 1-2 ONLY|Static snapshot — ask Claude/);
 assert.match(html,/Daily check at 11:43 UTC/);assert.match(html,/DATED COVERAGE:/);
});
