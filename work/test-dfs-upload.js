const assert = require('node:assert/strict');
const fs = require('node:fs');
const I = require('./dfs-slate-ingest.js');
const header = 'Player,Pos,Team,Salary,Proj,Ceiling,Total Own,CPT Own,CPT Salary,CPT Proj,Site,Slate';
const csv = header + '\n' + [
 'Alex Quill,QB,AAA,10000,20,30,80,25,15000,30,DK,AAA-BBB',
 'Chris Vale,RB,AAA,9000,18,28,70,20,13500,27,DK,AAA-BBB',
 'Jess Marlow,K,AAA,4000,8,14,0.5,0.2,6000,12,DK,AAA-BBB',
 'Blair Reed,WR,AAA,7000,15,25,60,15,10500,22.5,DK,AAA-BBB',
 'Sam Birch,QB,BBB,10000,20,30,75,20,15000,30,DK,AAA-BBB',
 'Robin Cole,RB,BBB,8000,16,26,65,10,12000,24,DK,AAA-BBB',
 'Morgan Pine,WR,BBB,6000,12,22,55,8,9000,18,DK,AAA-BBB',
 'Taylor West,K,BBB,4000,8,14,40,1.8,6000,12,DK,AAA-BBB'
].join('\n');
const r = I.readUpload(csv, []);
assert.equal(r.error, undefined);assert.equal(r.showdown,true);assert.equal(r.players.length,8);assert.equal(r.projected,8);
assert.equal(r.players[2].own,0.5);assert.equal(r.players[2].cptOwn,0.2);assert.equal(r.players[0].cptSal,15000);assert.equal(r.players[0].cptProj,30);
assert.equal(r.players[0].opp,'BBB');assert.equal(r.games,1);assert.equal(r.players[0].dkId,'');
assert.ok(I.readUpload('Player,Proj\nNobody,20',[]).error);
const before=JSON.stringify(r.players);assert.ok(I.readUpload('Player,Proj\nNobody,20',r.players).error);assert.equal(JSON.stringify(r.players),before);
const updated=I.readUpload('Player,Team,Proj,Own%\nAlex Quill,AAA,22,0.5',r.players);assert.equal(updated.players[0].proj,22);assert.equal(updated.players[0].own,0.5);
assert.equal(JSON.stringify(r.players),before);
const classic=I.readUpload('Player,Pos,Team,Salary,Proj,Large Field\nAlex Quill,QB,AAA,7000,20,0.2\nChris Vale,RB,BBB,6000,15,0.1',[]);
assert.equal(classic.showdown,false);assert.equal(classic.players[0].own,20);
if (process.argv[2]) fs.writeFileSync(process.argv[2],csv);
console.log('Unified upload: Showdown, Classic, captain fields, ownership units, and non-destructive errors pass');
