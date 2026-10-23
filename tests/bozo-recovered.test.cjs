const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const api=require('../bozo-recovered.js');
const seed=JSON.parse(fs.readFileSync('data/bozo-recovered-closes.json','utf8'));
const fixture=()=>structuredClone(seed);
const game=r=>({id:r.event_id,start:r.kickoff,close:null});
test('seed preserves four attributed claims, page-level timestamps and unknown NFL markets',()=>{
 const rows=api.validate(seed);assert.equal(rows.length,4);assert.equal(rows[3].markets.spread,null);assert.equal(rows[3].markets.total,null);
 for(const r of rows){assert.equal(r.quote_timestamp,null);assert.equal(r.evidence_status,'third_party_reported_closing_uncorroborated');}
 assert.equal(rows[0].markets.moneyline.away_price,-485);assert.equal(rows[2].markets.spread.home_line,-10.5);
});
test('original capture wins unchanged, including partial original records',()=>{
 const r=api.validate(fixture())[0],g=game(r);g.close={moneyline:{home_price:200,away_price:-220},total:null};
 const before=JSON.stringify(g);assert.equal(api.select(r,g,'moneyline').kind,'original');assert.equal(api.select(r,g,'total',56.5),null);
 const html=api.render(r,g,true);assert.match(html,/Original capture takes precedence/);assert.doesNotMatch(html,/-485/);assert.equal(JSON.stringify(g),before);
});
test('nulls and partial recovery remain unknown; no zero or assumed opposing price',()=>{
 const d=fixture();d.data.records[0].markets.moneyline.home_price=null;const r=api.validate(d)[0];
 assert.equal(api.select(r,game(r),'moneyline').market.home_price,null);
 assert.match(api.render(r,game(r),true),/App State unknown/);
 d.data.records[0].markets.moneyline.home_price='370';assert.throws(()=>api.validate(d));
});
test('game, kickoff, period, market and exact line must match; no alternate-line substitution',()=>{
 const r=api.validate(fixture())[0],g=game(r);
 assert.equal(api.select(r,{...g,id:'different'},'moneyline'),null);assert.equal(api.select(r,{...g,start:'2026-10-23T23:00:00Z'},'moneyline'),null);
 assert.equal(api.select(r,g,'spread',3.5),null);assert.equal(api.select(r,g,'total',56.5,'first_half'),null);assert.equal(api.select(r,g,'prop'),null);
 assert.equal(api.select(r,g,'spread',12.5).kind,'recovered');
});
test('annotations distinguish source claim, page time, retrieval and failed original read',()=>{
 const r=api.validate(fixture())[0],html=api.render(r,null,false);
 for(const text of ['uncorroborated','Page quote timestamp','Exact per-book quote time: unknown','Retrieved:','Original capture status unavailable',r.source_url])assert.ok(html.includes(text));
});
test('append-only revisions preserve history and cannot move a claim to another game',()=>{
 const d=fixture(),r=structuredClone(d.data.records[0]);r.revision=2;r.supersedes=r.id+'@1';r.markets.moneyline.away_price=-480;d.data.records.push(r);
 assert.equal(api.validate(d)[0].revision,2);assert.equal(d.data.records[0].markets.moneyline.away_price,-485);
 r.kickoff='2026-10-25T23:00:00Z';assert.throws(()=>api.validate(d));r.kickoff=d.data.records[0].kickoff;r.supersedes=null;assert.throws(()=>api.validate(d));
});
test('privacy: reject credential URLs and unrelated fields, escape displayed text',()=>{
 for(const url of ['https://user:pass@theoddsgap.com/a','https://theoddsgap.com/a?token=secret','javascript:alert(1)']){const d=fixture();d.data.records[0].source_url=url;assert.throws(()=>api.validate(d));}
 const d=fixture();d.data.records[0].client_data='private';assert.throws(()=>api.validate(d));
 const r=fixture().data.records[0];r.home='<img src=x onerror=alert(1)>';assert.doesNotMatch(api.render(r,null,false),/<img/);
});
test('page integration is separate from grading and exposes the caveat to Toto',()=>{
 const s=fs.readFileSync('bozo.html','utf8'),js=fs.readFileSync('bozo-recovered.js','utf8');assert.match(s,/id="bozoRecovered"/);assert.match(s,/sys: BOZO_SYS \+.*Recovered closing evidence/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization|method:\s*['"]POST|clvPts|closeEntered/);
 assert.match(js,/credentials:'omit'/);assert.match(js,/referrerPolicy:'no-referrer'/);
});
