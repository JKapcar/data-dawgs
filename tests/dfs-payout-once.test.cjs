const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../work/dfs-engine.js').DDFS;
const players=['QB','WR','RB','TE','K','DST'].map((pos,i)=>({name:'Synthetic '+i,pos,team:i<3?'AAA':'BBB',opp:i<3?'BBB':'AAA',gid:'AAA@BBB',sal:5000,proj:10+i,own:30,flexOwn:30,cptOwn:10}));
const lineup={ids:[0,1,2,3,4,5],cpt:0};
const cfg={site:'dk_showdown',sims:200,seed:216,fieldSize:10,fieldSample:9,entryFee:10,payout:{kind:'table',rows:[{from:1,to:1,prize:80}]},opponentLineups:Array.from({length:9},()=>lineup)};
test('occupied ranks: first, flat mincash and cash-boundary ties',()=>{
 const pay=E.payoutFn({kind:'table',rows:[{from:1,to:1,prize:100},{from:2,to:2,prize:60},{from:3,to:4,prize:20}]},6,10);
 assert.equal(pay.shared(0,1),80);assert.equal(pay.shared(2,1),20);assert.equal(pay.shared(3,1),10);
 // Settlement depends on tied scores, not roster identity (distinct rosters may tie).
 assert.equal(E.tieOutcome([0,0,5,5,10],5,6,pay).prize,100/3);
});
test('standard positive prior and Lab absent prior settle identical rosters once',()=>{
 for(const prior of [undefined,0,9,735]){
  const row=E.simulate(players,[{...lineup,eDupes:prior}],cfg).perLineup[0];
  assert.equal(row.ev,8);assert.equal(row.evAdj,8);assert.equal(row.dupes,9);
  assert.equal(row.eDupes,prior||0);
  for(const split of ['train','validation'])assert.equal(row[split].evAdj,8);
 }
});
test('sampled top-heavy aliases cannot bypass payout availability; flat samples retain settlement',()=>{
 const partial={...cfg,fieldSize:10000};
 const r=E.simulate(players,[{...lineup,eDupes:9}],partial).perLineup[0];
 for(const row of [r,r.train,r.validation]){assert.equal(row.ev,null);assert.equal(row.evAdj,null);assert.equal(row.roi,null);assert.equal(row.approxEvAdj,null);}
 const flat=E.simulate(players,[{...lineup,eDupes:9}],{...partial,payout:{kind:'flat',paidFrac:.2,rake:.15}}).perLineup[0];
 assert.equal(typeof flat.ev,'number');assert.equal(flat.evAdj,flat.ev);
});
test('page and private Worker carry the tested engine; standard renderers gate EV',()=>{
 const html=fs.readFileSync('dfs.html','utf8'),source=fs.readFileSync('work/dfs-engine.js','utf8');
 assert.equal(html.split('<script type="text/plain" id="ddfsEngine">')[1].split('</script>')[0].trim(),source.trim());
 const worker=fs.readFileSync('dawg-bot-worker.js','utf8');
 const core=source.slice(source.indexOf('(function (root)'),source.lastIndexOf('})(typeof module'));
 assert.ok(worker.includes(core));
 assert.ok(!html.includes('b.evAdj || 0'));assert.match(html,/EV unavailable; Top-10 proxy rank/);assert.match(html,/r.ev == null \? "Unavailable"/);
 const lab=html.slice(html.indexOf('function runLabCompare'),html.indexOf('function runLabCompare')+12000);
 assert.ok(!lab.includes('eDupes:'));
});
