// DOM-only coverage; real browser layout/keyboard QA is still a separate check.
// DDFS_JSDOM=/path/to/jsdom node --test tests/bozo-disclosures.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require(process.env.DDFS_JSDOM || 'jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');
const paint = html.slice(html.indexOf('function paintDiag('), html.indexOf('/* ---------------- where the levers stand'));

function fixture(measured = 1) {
  // No page scripts or network run. Exercise the actual renderer with fixed model output.
  const dom = new JSDOM(html);
  const live = [0,1].map(i => ({p:'Player '+i, label:'Example pick', price:-150, entryPriceOpp:130,
    mkt:'ml', eventId:'event-'+i, game:'Fixture game '+i, ts:i+1, clv:i<measured?.02:null}));
  const context = {
    document:dom.window.document, ME:null, S:{order:[3,1,2,0]},
    LEVERS:['Shortest Odds','Worst Beat','Last In','Worst CLV'].map(name=>({name})),
    settings:()=>({levers:[0,1,2,3]}), simKey:'fixture', simKeyFor:()=> 'fixture',
    simOut:{sims:20000,n:2,cash:.36,win:[.6,.6],bozo:[.4,.4],solo:[.24,.24],by:[null,null]},
    dec:()=>1.67, fairParlay:()=>2.78, pct:x=>Math.round(x*100)+'%', amer:()=>'+178',
    devigP:()=>.6, leverStandings:()=>({rank:[[1,2],[0,0],[1,2],[1,2]],
      holds:[[true,false],[false,false],[false,true],[true,false]],
      d:live.map(x=>({beat:null,clv:x.clv,ts:x.ts}))}),
    esc:x=>String(x), teamOf:x=>x, flaggedRows:()=>[], clvDeltaOf:x=>x.clv,
    legRow:()=>({}), clvMissingReason:()=> 'awaiting close', ordinal:x=>x+'th',
    when:()=> '12:00', priceSourceBadge:()=>'', proxyBadge:()=>'', meter:()=>''
  };
  vm.createContext(context);
  vm.runInContext(paint,context);
  const render = (rows=live)=>context.paintDiag(rows,live.map(x=>x.p),'placed');
  render();
  return {document:dom.window.document, render, live, context};
}

test('long chart and dashboard guides are native, closed disclosures',()=>{
  const {document:d}=fixture();
  for(const id of ['hierHistoryCard','diagExploreCard','clvCard','survCard']){
    const details=d.querySelector('#'+id+' details.bz-help');
    assert.ok(details,id);
    assert.equal(details.open,false);
    assert.equal(details.firstElementChild.tagName,'SUMMARY');
    assert.ok(details.firstElementChild.textContent.trim());
  }
  assert.ok(d.getElementById('clvSub').closest('details'));
  assert.ok(d.querySelector('.clv-legnote').closest('details'));
  assert.ok(!d.getElementById('clvSim').closest('details'),'demo warning stays outside');
  assert.match(html,/\.bz-help>summary:focus-visible\{outline:2px solid/);
  assert.match(html,/\.bz-help>summary\{[^}]*min-height:44px/);
});

test('diagnostic values and important caveats stay outside the closed methodology',()=>{
  const {document:d}=fixture();
  assert.equal(d.getElementById('dgHelp').open,false);
  assert.match(d.getElementById('dgHelp').textContent,/The four lever columns are standings, not a forecast/);
  assert.match(d.querySelector('.diag-caption').textContent,/conditional on a loss/);
  assert.equal(d.querySelectorAll('#dgTiles .big').length,6);
  assert.equal(d.querySelectorAll('#dgTable tbody tr').length,3);
  assert.ok(!d.getElementById('dgTable').closest('details'));
  const flags=d.getElementById('dgFlags').cloneNode(true);
  flags.querySelectorAll('details').forEach(x=>x.remove());
  assert.match(flags.textContent,/Worst CLV is measured on 1 of 2 legs/);
  assert.match(flags.textContent,/Missing sides stay unmeasured/);
  assert.doesNotMatch(flags.textContent,/A leg whose market can be captured draws/);
  assert.match(d.getElementById('dgClvHelp').textContent,/that player's own past legs/);
});

test('click disclosures repeatedly and keep their open state after repaint',()=>{
  const {document:d,render}=fixture();
  for(const id of ['dgHelp','dgClvHelp']){
    for(let i=0;i<3;i++){
      d.querySelector('#'+id+' summary').click();
      assert.equal(d.getElementById(id).open,true);
      d.querySelector('#'+id+' summary').focus();
      render();
      assert.equal(d.activeElement,d.querySelector('#'+id+' summary'),'repaint preserves keyboard focus');
      assert.equal(d.getElementById(id).open,true,'repaint preserves open '+id);
      d.querySelector('#'+id+' summary').click();
      assert.equal(d.getElementById(id).open,false);
      render();
      assert.equal(d.getElementById(id).open,false,'repaint preserves closed '+id);
    }
  }
});

test('pending, partial, fully measured and empty boards keep honest visible states',()=>{
  const {document:d,render,live}=fixture(0);
  assert.match(d.getElementById('dgFlags').textContent,/can't be measured on this board yet/);
  assert.equal(d.getElementById('dgClvHelp').open,false);
  live[0].clv=.02;render();
  assert.match(d.getElementById('dgFlags').textContent,/measured on 1 of 2/);
  live[1].clv=.01;render();
  assert.equal(d.getElementById('dgClvHelp'),null);
  render([]);
  assert.ok(d.getElementById('diagCard').classList.contains('empty'));
  assert.match(d.getElementById('dgNote').textContent,/Nothing to measure yet/);
  assert.equal(d.getElementById('dgHelp'),null);
  render();
  assert.equal(d.getElementById('dgHelp').open,false);
});

test('drawn and undrawn methodology both retain their original explanations',()=>{
  const {document:d,render,context}=fixture();
  assert.match(d.getElementById('dgHelp').textContent,/this week's drawn hierarchy/);
  context.S.order=null;render();
  assert.match(d.getElementById('dgHelp').textContent,/each run drawing a fresh hierarchy/);
  for(const text of ['Killed it alone','Review flags','no close','Shortest odds','Last in','Worst beat','Worst CLV'])
    assert.ok(d.getElementById('dgHelp').textContent.includes(text),text);
});


test('when a focused disclosure disappears, focus moves to the stable Diagnostics heading',()=>{
  const {document:d,render,live}=fixture();
  d.querySelector('#dgClvHelp > summary').focus();
  live[1].clv=.01;render();
  assert.equal(d.getElementById('dgClvHelp'),null);
  assert.equal(d.activeElement,d.getElementById('dgTitle'));
  d.querySelector('#dgHelp > summary').focus();
  render([]);
  assert.equal(d.getElementById('dgHelp'),null);
  assert.equal(d.activeElement,d.getElementById('dgTitle'));
});
