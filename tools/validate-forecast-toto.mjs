import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n+'.json',import.meta.url),'utf8'));
const doc=read('forecast-toto'),games=read('nfl-schedule').data.games;
assert(doc.as_of&&doc.source&&doc.tier==='labs'&&doc.graded===false);
assert.equal(doc.data.entrant,'Toto');assert(doc.data.model_version&&doc.data.method);
assert(Array.isArray(doc.data.forecasts));
const seen=new Set();
for(const p of doc.data.forecasts){
  assert(!seen.has(p.game_id),'Duplicate Toto game');seen.add(p.game_id);
  const g=games.find(g=>g.game_id===p.game_id);assert(g,'Unknown canonical game');
  assert.equal(p.home_team,g.home_team);assert.equal(p.away_team,g.away_team);
  assert(typeof p.home_win_probability==='number'&&Number.isFinite(p.home_win_probability)&&p.home_win_probability>=0&&p.home_win_probability<=1);
  assert(Date.parse(p.captured_at)>0&&Date.parse(p.captured_at)<Date.parse(g.kickoff_at),'Forecast timestamp must precede kickoff');
  assert(Date.parse(p.captured_at)<=Date.now()+60000,'No future-dated authored receipts');
  assert(/^[a-f0-9]{64}$/.test(p.input_snapshot_id),'Exact input SHA-256 required');
  assert(typeof p.rationale==='string'&&p.rationale.length>20,'Written rationale required');
}
console.log('Toto: '+seen.size+' canonical, prospective, attributed forecasts validated. Import/lock status must be checked in /forecast/board.');
