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

// ---- Goal lens: outcome lots, the measured path clock, and the objective registry ----
const G=require('../fourth-down-objectives.js'),pathEnv=require('../data/fourth-down-paths.json'),clock=G.createClock(pathEnv);
const mid={qtr:3,seconds:367,diff:-4,toGo:6,yardline:41,home:1,offTO:3,defTO:3,homeKickoff:0,spread:-3,total:53.5,roof:'retractable'};
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);
test('outcome lots are the same terms as the published win probabilities',()=>{
 for(const input of [browns,mid,{...mid,yardline:1,toGo:1},{...browns,qtr:2,seconds:20,yardline:30}]){
  const r=engine.calculate(input);
  for(const c of r.choices){
   if(c.wp===null){assert.equal(r.lots[c.id],null);continue;}
   near(r.lots[c.id].reduce((a,l)=>a+l.p,0),1,1e-9);near(r.lots[c.id].reduce((a,l)=>a+l.p*l.wp,0),c.wp,1e-12);
   for(const l of r.lots[c.id])assert.ok(l.p>=0&&l.wp>=0&&l.wp<=1&&l.t>=0&&l.t<=3600&&typeof l.ok==='boolean');
  }
  near(r.lots.go.filter(l=>l.ok).reduce((a,l)=>a+l.p,0),r.conversion,1e-12);
 }
});
test('lots never leak into snapshots, spreads or Toto state',()=>{const r=engine.calculate(browns);assert.ok(!JSON.stringify(r).includes('lots'));assert.equal({...r}.lots,undefined);assert.equal(r.secondsLeft,65);assert.ok(!JSON.stringify(r).includes('secondsLeft'));});
test('path clock surface is a dated, increasing clock tested on seasons it was not fitted on',()=>{
 const d=pathEnv.data;assert.ok(pathEnv.as_of&&pathEnv.source);
 assert.equal(clock.V(0),0);assert.equal(clock.V(3600),1);near(clock.V(450),(d.information_remaining[5]+d.information_remaining[6])/2,1e-12);
 for(let t=1;t<=3600;t+=7)assert.ok(clock.V(t)>clock.V(t-1));
 assert.ok(d.fit.seasons[1]<d.test.seasons[0]);
 assert.ok(d.test.rmse_outside_abstain_window<d.alternatives_on_test.plain_brownian_rmse);
 assert.equal(d.test.by_clock[0].seconds_to,d.abstain_below_seconds);assert.ok(d.test.by_clock[0].rmse>3*d.test.rmse_outside_abstain_window);
 assert.equal(clock.error,d.test.rmse_outside_abstain_window);assert.equal(d.sources.length,d.test.seasons[1]-d.fit.seasons[0]+1);
 for(const row of d.calibration_test_seasons)assert.equal(row.observed.length,d.thresholds.length);
});
test('malformed path clocks are refused, not guessed',()=>{
 const d=pathEnv.data,bad=x=>assert.throws(()=>G.createClock(x));
 bad(null);bad({...pathEnv,as_of:''});bad({...pathEnv,source:undefined});bad({...pathEnv,data:{...d,information_remaining:d.information_remaining.slice(1)}});
 bad({...pathEnv,data:{...d,information_remaining:d.information_remaining.map((v,i)=>i===3?d.information_remaining[2]:v)}});
 bad({...pathEnv,data:{...d,information_remaining:d.information_remaining.map(v=>v*.9)}});
});
test('normal CDF and quantile are accurate inverses',()=>{near(G.cdf(1.959963984540054),.975,1e-12);near(G.quantile(.975),1.959963984540054,1e-9);near(G.cdf(0),.5,1e-15);for(const p of [1e-6,.01,.3,.5,.8,.999])near(G.cdf(G.quantile(p)),p,1e-12);});
test('share() matches the Python reference integrals from the builder',()=>{assert.ok(pathEnv.data.reference_values.length>=8);for(const r of pathEnv.data.reference_values)near(G.share(clock,r.p,r.x,r.seconds,r.horizon),r.share,1e-4);});
test('the path is a martingale: integrating share over every line returns the starting WP',()=>{
 for(const [p,T,H] of [[.3,2000,2000],[.8,400,400],[.55,3000,600],[.94,59,59]]){let s=0;const n=1000;for(let i=0;i<n;i++)s+=G.share(clock,p,(i+.5)/n,T,H)/n;near(s,p,5e-4);}
});
test('share() is symmetric, monotone and bounded',()=>{
 for(const [p,x,T,H] of [[.3,.2,900,900],[.62,.5,1800,600],[.9,.8,420,420]]){
  near(G.share(clock,p,x,T,H)+G.share(clock,1-p,1-x,T,H),1,1e-9);
  assert.ok(G.share(clock,p+.05,x,T,H)>G.share(clock,p,x,T,H));assert.ok(G.share(clock,p,x+.05,T,H)<G.share(clock,p,x,T,H));
 }
 assert.equal(G.share(clock,1,.5,600),1);assert.equal(G.share(clock,0,.5,600),0);assert.equal(G.share(clock,.7,.5,0),1);assert.equal(G.share(clock,.3,.5,0),0);
 near(G.share(clock,.5,.5,3600),.5,1e-9);assert.equal(G.share(clock,.4,0,600),1);assert.equal(G.share(clock,.4,1,600),0);
});
test('Win the game and Average win probability reproduce the bot exactly',()=>{
 for(const input of [browns,mid]){const r=engine.calculate(input);
  for(const goal of ['win','avg']){const v=G.evaluate(r,null,{goal},null);assert.equal(v.available,true);assert.equal(v.best,r.best);assert.equal(v.agrees,true);near(v.edge,r.edge,1e-9);assert.equal(v.wpCost,0);
   for(const c of v.choices)c.value===null?assert.equal(r.choices.find(x=>x.id===c.id).wp,null):near(c.value,c.wp,1e-12);}
  assert.equal(G.evaluate(r,null,{goal:'avg'},null).identity,true);assert.equal(G.evaluate(r,null,{goal:'win'},null).identity,false);}
});
test('lens follows the conversion and field-goal sliders',()=>{
 const r=engine.calculate(mid),s=A.scenario(r,.2,.9),v=G.evaluate(r,s,{goal:'win'},clock);
 for(const c of v.choices)near(c.value,s.choices.find(x=>x.id===c.id).wp,1e-12);assert.equal(v.best,s.best);
 const lots=G.lotsFor(r,s);near(lots.go.filter(l=>l.ok).reduce((a,l)=>a+l.p,0),.2,1e-12);near(lots.fg[0].p,.9,1e-12);assert.equal(lots.punt,r.lots.punt);
 assert.equal(G.lotsFor(r,r).go,r.lots.go);
 const moved=G.evaluate(r,s,{goal:'above',params:{x:50}},clock),model=G.evaluate(r,null,{goal:'above',params:{x:50}},clock);
 assert.ok(moved.choices[0].value<model.choices[0].value);near(moved.choices[2].value,model.choices[2].value,1e-12);
});
test('time above a line: horizon zero is the chance the play itself clears the line',()=>{
 const r=engine.calculate(mid),v=G.evaluate(r,null,{goal:'above',params:{x:30},horizon:0},clock);
 assert.equal(v.instant,true);assert.equal(v.tooClose,false);
 for(const c of v.choices)near(c.value,r.lots[c.id].reduce((a,l)=>a+(l.wp>.3?l.p:0),0),1e-12);
});
test('time above a line is time-weighted share of the horizon and reports clock seconds',()=>{
 const r=engine.calculate(mid),v=G.evaluate(r,null,{goal:'above',params:{x:50}},clock);
 assert.equal(v.horizonSeconds,Math.max(...r.lots.go.map(l=>l.t)));
 const go=v.choices[0];near(go.value,r.lots.go.reduce((a,l)=>a+l.p*G.share(clock,l.wp,.5,l.t)*l.t/v.horizonSeconds,0),1e-12);near(go.seconds,go.value*v.horizonSeconds,1e-9);
 const short=G.evaluate(r,null,{goal:'above',params:{x:50},horizon:300},clock);assert.equal(short.horizonSeconds,300);assert.notEqual(short.choices[0].value,go.value);
 assert.equal(G.evaluate(r,null,{goal:'above',params:{x:50},horizon:99999},clock).horizonSeconds,v.horizonSeconds);
 assert.ok(G.evaluate(r,null,{goal:'above',params:{x:20}},clock).choices[0].value>go.value);
});
test('keep it a game is the share between two lines',()=>{
 const r=engine.calculate(mid),band=G.evaluate(r,null,{goal:'band',params:{w:30}},clock),lo=G.evaluate(r,null,{goal:'above',params:{x:20}},clock),hi=G.evaluate(r,null,{goal:'above',params:{x:80}},clock);
 for(let i=0;i<3;i++)near(band.choices[i].value,lo.choices[i].value-hi.choices[i].value,1e-9);assert.equal(band.range,'between 20% and 80%');
});
test('loss aversion: multiplier 1 is plain win probability; a higher one only subtracts',()=>{
 const r=engine.calculate(mid);
 for(const horizon of [0,null,600]){const flat=G.evaluate(r,null,{goal:'loss',params:{k:1},horizon},clock),hurt=G.evaluate(r,null,{goal:'loss',params:{k:3},horizon},clock);
  assert.equal(flat.best,r.best);near(flat.reference,r.goWP,1e-12);
  for(const c of flat.choices)near(c.value,c.wp-r.goWP,1e-9);
  for(let i=0;i<3;i++)assert.ok(hurt.choices[i].value<flat.choices[i].value);}
 const now=G.evaluate(r,null,{goal:'loss',params:{k:3}},clock);assert.equal(now.instant,true);
 near(now.choices[1].value,r.fgWP-r.goWP-2*r.lots.fg.reduce((a,l)=>a+l.p*Math.max(0,r.goWP-l.wp),0),1e-12);
});
test('lens abstains instead of answering where the path model fails or is missing',()=>{
 const late=engine.calculate({...browns,seconds:20});assert.equal(late.secondsLeft,20);
 for(const goal of ['above','band','loss']){const v=G.evaluate(late,null,{goal},clock);assert.equal(v.available,false);assert.match(v.reason,/final 30 seconds/);assert.equal(v.best,undefined);}
 assert.equal(G.evaluate(late,null,{goal:'win'},clock).available,true);
 const r=engine.calculate(mid);assert.equal(G.evaluate(r,null,{goal:'above'},null).available,false);assert.equal(G.evaluate(r,null,{goal:'avg'},null).available,true);
 assert.throws(()=>G.evaluate(r,null,{goal:'margin'},clock));assert.throws(()=>G.evaluate({...r},null,{goal:'win'},clock));
});
test('an edge inside the path model error is flagged, and ties go to win probability',()=>{
 const r=engine.calculate({qtr:2,seconds:284,diff:4,toGo:6,yardline:9,home:0,offTO:3,defTO:2,homeKickoff:0,spread:-3,total:53.5,roof:'retractable'});
 const v=G.evaluate(r,null,{goal:'above',params:{x:50}},clock);assert.ok(v.edge<100*clock.error);assert.equal(v.tooClose,true);
 assert.equal(G.evaluate(engine.calculate(mid),null,{goal:'above',params:{x:50}},clock).tooClose,false);
 const b=engine.calculate(browns),t=G.evaluate(b,null,{goal:'above',params:{x:50},horizon:0},clock);
 assert.equal(t.tie,true);assert.equal(t.best,b.best);assert.equal(t.edge,0);assert.equal(t.tooClose,false);
});
test('a different call reports the win probability it gives up',()=>{
 const r=engine.calculate({qtr:2,seconds:284,diff:4,toGo:6,yardline:9,home:0,offTO:3,defTO:2,homeKickoff:0,spread:-3,total:53.5,roof:'retractable'});
 const v=G.evaluate(r,null,{goal:'loss',params:{k:3}},clock);assert.equal(r.best,'go');assert.equal(v.best,'fg');assert.equal(v.agrees,false);near(v.wpCost,100*(r.goWP-r.fgWP),1e-9);assert.ok(v.wpCost>0);
});
test('goal parameters clamp to their published ranges and sweeps cover every setting',()=>{
 assert.deepEqual(G.params('above',{x:500}),{x:95});assert.deepEqual(G.params('above',{x:'nope'}),{x:50});assert.deepEqual(G.params('loss',{k:0}),{k:1});assert.deepEqual(G.params('win',{x:3}),{});
 const r=engine.calculate(mid),s=G.sweep(r,null,{goal:'above',params:{x:50}},clock,[{params:{x:20}},{params:{x:80}},{horizon:0}]);
 assert.equal(s.length,3);near(s[0].choices[0].value,G.evaluate(r,null,{goal:'above',params:{x:20}},clock).choices[0].value,1e-12);
 assert.equal(G.sweep(engine.calculate({...browns,seconds:20}),null,{goal:'above'},clock,[{}])[0].best,null);
 for(const g of Object.values(G.GOALS)){assert.ok(g.label&&g.blurb&&typeof g.score==='function'&&typeof g.describe==='function');if(g.path)assert.ok(['time','outcome'].includes(g.weigh));}
});
