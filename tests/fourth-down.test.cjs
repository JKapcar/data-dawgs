const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const E=require('../fourth-down-engine.js'),root=path.join(__dirname,'..');
const m=JSON.parse(fs.readFileSync(path.join(root,'assets/fourth-down/manifest.json'))),gz=fs.readFileSync(path.join(root,'assets/fourth-down',m.file));
const b=zlib.gunzipSync(gz),engine=E.createEngine(m,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
const browns={qtr:4,seconds:65,yardline:15,toGo:1,diff:3,offTO:3,defTO:0,home:1,homeKickoff:0,spread:-2.5,total:41.5,roof:'outdoors'};
test('artifact integrity',()=>assert.equal(crypto.createHash('sha256').update(gz).digest('hex'),m.sha256));
test('Browns 2026-09-27: published 94.0 vs 89.6, a 4.4 pp go advantage',()=>{const r=engine.calculate(browns);assert.equal((r.goWP*100).toFixed(1),'94.0');assert.equal((r.fgWP*100).toFixed(1),'89.6');assert.equal(r.edge.toFixed(1),'4.4');assert.equal(r.best,'go');assert.ok(Math.abs(r.breakEven-.3559)<.0001);});
// Ground truth: rbsdm.com/stats/fourth_weekly/, observed 2026-09-28.
// BAL @ DAL: home spread +3 (nflverse spread_line -3), total 53.5, retractable.
for(const [state,expected] of [
  [[1,817,0,4,71,0,3,3],[57.1,null,55.1]],
  [[1,490,0,10,10,1,3,3],[48.1,48.0,null]],
  [[2,564,-4,1,56,1,2,3],[30.5,null,28.0]],
  [[2,284,4,6,9,0,3,2],[76.6,76.4,null]],
  [[2,18,-7,6,20,1,1,2],[26.3,27.7,null]],
  [[3,367,-4,6,41,1,3,3],[28.6,25.7,24.9]],
  [[4,787,3,1,1,0,2,3],[83.1,79.4,null]]
])test(`published BAL-DAL state ${state.join('/')}`,()=>{const [qtr,seconds,diff,toGo,yardline,home,offTO,defTO]=state;const r=engine.calculate({qtr,seconds,diff,toGo,yardline,home,offTO,defTO,homeKickoff:0,spread:-3,total:53.5,roof:'retractable'});assert.deepEqual(r.choices.map(c=>c.wp===null?null:+(100*c.wp).toFixed(1)),expected);});
test('scenario arithmetic intersects best kick at break-even',()=>{const r=engine.calculate(browns);assert.ok(Math.abs(r.breakEven*r.successWP+(1-r.breakEven)*r.failWP-r.fgWP)<1e-10);});
test('kickoff position is a real model input',()=>assert.notEqual(engine.calculate({...browns,touchback:35}).fgWP,engine.calculate(browns).fgWP));
test('malformed or overtime inputs cannot silently produce numbers',()=>{for(const s of [{qtr:5},{seconds:0},{seconds:901},{defTO:-1},{yardline:0},{toGo:16},{diff:''},{roof:'unknown'},{total:NaN}])assert.throws(()=>engine.calculate({...browns,...s}));});
test('all published decisions are finite probabilities and costs cannot be negative',()=>{const env=JSON.parse(fs.readFileSync(path.join(root,'data/fourth-down.json')));let n=0;for(const g of env.data.games)for(const p of g.decisions){if(!p.result)continue;n++;for(const c of p.result.choices)if(c.wp!==null)assert.ok(Number.isFinite(c.wp)&&c.wp>=0&&c.wp<=1);assert.ok(p.result.edge>=0);}assert.ok(Array.isArray(env.data.games)); /* Pre-game snapshots may legitimately contain zero scored decisions. */ });
const A=require('../fourth-down-analysis.js');
test('sensitivity switches at the exact FG threshold and keeps unavailable punts null',()=>{const r=engine.calculate(browns),t=A.comparisons(r,'go')[0].p;assert.ok(Math.abs(t-r.breakEven)<1e-12);assert.equal(A.scenario(r,t-.01).best,'fg');assert.equal(A.scenario(r,t+.01).best,'go');assert.equal(A.scenario(r,0).goWP,r.failWP);assert.equal(A.scenario(r,1).goWP,r.successWP);assert.equal(A.scenario(r,0,0).choices[1].wp,r.missWP);assert.equal(A.scenario(r,1,1).choices[2].wp,null);});
test('unattainable and reversed break-even values remain visible, not clamped',()=>{assert.ok(A.threshold(.5,.3,.8).p>1);assert.equal(A.threshold(.3,.5,.4).direction,-1);assert.equal(A.threshold(.4,.4,.5).always,'below');assert.equal(A.threshold(.4,.4,.4).always,'tie');});
test('historical median is across observed teams; shrinking uses other-team rates',()=>{const env={as_of:'2026-09-28',data:{current_season:2026,prior_attempts:20,seasons:{2026:{through:'2026-09-27',go:{'1|red':{CLE:[1,1],CAR:[3,9]}}}}}};const h=A.historical(env,{home:1,homeTeam:'CLE',awayTeam:'CAR',yardline:15,toGo:1},'go');assert.equal(h.n,10);assert.ok(Math.abs(h.selected.estimate-(1+20/3)/21)<1e-12);assert.equal(h.median,A.median(h.rows.map(r=>r.estimate)));assert.equal(h.selected.currentN,1);assert.equal(A.historical(env,{home:0,homeTeam:'CLE',awayTeam:'NO',yardline:15,toGo:1},'go').selected,null);assert.equal(A.historical(null,{},'go'),null);});
test('historical snapshot counts and samples are coherent',()=>{const env=require('../data/fourth-down-rates.json');for(const season of Object.values(env.data.seasons)){assert.equal(season.games,season.game_ids.length);for(const kind of ['go','fg'])for(const cohort of Object.values(season[kind]))for(const [s,n] of Object.values(cohort)){assert.ok(s>=0&&s<=n&&n>0);}}const h=A.historical(env,{home:1,homeTeam:'CLE',yardline:15,toGo:1,roof:'outdoors'},'go');assert.ok(h.rows.length>20);assert.ok(h.selected.low<=h.selected.raw&&h.selected.high>=h.selected.raw);});

test('empirical percentiles include ties and flag unresolved tails',()=>{assert.deepEqual(A.percentile([.4,.5,.5,.8],.5),{below:1,atOrBelow:3,n:4,percentile:75,min:.4,max:.8,belowSample:false,aboveSample:false});assert.equal(A.percentile([.4,.6],.3559).percentile,0);assert.equal(A.percentile([.4,.6],.3559).belowSample,true);assert.equal(A.percentile([.4,.6],.8).aboveSample,true);assert.equal(A.percentile([], .5),null);});

test('published fourth-and-1 slice reproduces released fitted-model reference values',()=>{
 for(const [z,p] of [[-2,.6062301882432214],[0,.6673233955601306],[2,.7232648531411295]])assert.ok(Math.abs(A.publishedConversion(1,z)-p)<1e-12);
 assert.equal(A.publishedConversion(2,0),null);
 for(const z of [-3,3,NaN])assert.throws(()=>A.publishedConversion(1,z));
 const r=engine.calculate(browns);
 for(const z of [-2,0,2])assert.equal(A.scenario(r,A.publishedConversion(1,z)).best,'go');
});
