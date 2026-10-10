// Synthetic, offline regression coverage for the Diagnostics dashboard.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require(process.env.DDFS_JSDOM||'jsdom');
const html=fs.readFileSync(path.join(__dirname,'../bozo.html'),'utf8');
const source=html.slice(html.indexOf('const DX='),html.indexOf('function paintDiag('));
const pairs=html.slice(html.indexOf('const clvImp ='),html.indexOf('const CLV_SHAPES'));
const row=(extra={})=>({player:'Fixture One',sport:'nfl',mkt:'ml',week:1,result:'win',entryPrice:100,entryPriceOpp:100,closePrice:-150,closePriceOpp:150,...extra});
function fixture(rows){
  const dom=new JSDOM(html);
  const context={document:dom.window.document,CLV:{data:{legs:rows,synthetic:true},players:[...new Set(rows.map(r=>r.player))],sports:[...new Set(rows.map(r=>r.sport))]},LID:'fixture',view:()=> 'diagnostics',teamOf:x=>x,esc:x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  vm.createContext(context);vm.runInContext(pairs+'\n'+source,context);
  const render=()=>context.paintDiagnosticsExplorer();render();
  return {context,document:dom.window.document,render};
}
const mixed=()=>[row(),row({result:'loss',week:2,closePrice:150,closePriceOpp:-150}),row({result:'win',closePrice:null}),row({result:'push'}),row({result:'pending'}),row({result:'win',clvPts:90})];
test('expected wins and delta use the identical valid matched sample',()=>{
  const {context}=fixture(mixed());const s=context.dxSummary(mixed());
  assert.equal(s.picks,6);assert.equal(s.graded.length,4);assert.equal(s.wins,3);assert.equal(s.losses,1);
  assert.equal(s.measurable.length,2);assert.equal(s.matchedWins,1);assert.equal(s.expected,1);assert.equal(s.delta,0);assert.ok(Math.abs(s.clv)<1e-12);
});
test('invalid probabilities, unverified and missing closes are never zero-valued measurements',()=>{
  const {context}=fixture([]);
  for(const extra of [{closePrice:null},{verificationStatus:'unverified'},{clvEligible:false},{closeOppSource:'assumed'},{clvPts:90},{clvPts:-90},{entryPrice:0}]){
    const s=context.dxSummary([row(extra)]);assert.equal(s.measurable.length,0,JSON.stringify(extra));assert.equal(s.clv,null);
  }
  const s=context.dxSummary([row({clvPts:5})]);assert.equal(s.overridden,1);assert.equal(s.matchedWins,1);assert.ok(Math.abs(s.expected-.55)<1e-12);assert.ok(Math.abs(s.delta-.45)<1e-12);
});
test('six accessible charts expose exact data through closed native disclosures',()=>{
  const {document:d}=fixture(mixed());
  assert.equal(d.querySelectorAll('#dxChart section.dx-viz').length,6);
  for(const name of ['outcomes','trend','comparison','clv','calibration','coverage']){
    const chart=d.querySelector(`[data-chart="${name}"]`);assert.ok(chart,name);
    if(name!=='coverage'){const graphic=chart.querySelector('[role="img"]');assert.ok(graphic,name+' labelled graphic');assert.ok(graphic.getAttribute('aria-label'));}
    const detail=chart.querySelector('details.bz-help');assert.ok(detail);assert.equal(detail.open,false);assert.equal(detail.firstElementChild.tagName,'SUMMARY');assert.ok(detail.querySelector('table'));
  }
  assert.doesNotMatch(d.getElementById('dxChart').innerHTML,/NaN|Infinity/);
  const cells=name=>[...d.querySelectorAll(`[data-chart="${name}"] details tbody tr`)].map(tr=>[...tr.children].map(td=>td.textContent));
  assert.deepEqual(cells('outcomes'),[['Wins','3'],['Losses','1'],['Push / void','1'],['Pending / other','1']]);
  assert.deepEqual(cells('trend'),[['Week 1','1','1','0.60'],['Week 2','1','1','1.00']]);
  assert.deepEqual(cells('clv'),[['Week 1','1','+10.00'],['Week 2','1','−10.00']]);
  assert.deepEqual(cells('coverage'),[['Captured pairs','2'],['Manager-set CLV','0'],['Graded, not measured','2'],['No win/loss decision','2']]);
});
test('empty, pending, one-row and zero-delta slices stay finite and honest',()=>{
  for(const rows of [[],[row({result:'pending'})],[row()],[row(),row({result:'loss',closePrice:150,closePriceOpp:-150})]]){
    const {document:d}=fixture(rows);assert.doesNotMatch(d.getElementById('dxChart').innerHTML,/NaN|Infinity/);
    if(!rows.length)assert.match(d.getElementById('dxChart').textContent,/No picks match/);
    else assert.ok(d.getElementById('dxChart').textContent.trim());
  }
});
test('filters and grouping operate on the shared ledger; repaint preserves disclosures',()=>{
  const rows=Array.from({length:30},(_,i)=>row({week:i+1,player:i%2?'Fixture Two':'Fixture One',sport:i%2?'nba':'nfl'}));
  const {document:d,context,render}=fixture(rows);
  d.getElementById('dxWindow').value='last24';render();assert.equal(context.dxRows().length,24);
  d.getElementById('dxWindow').value='last5';render();assert.equal(context.dxRows().length,5);
  d.getElementById('dxWindow').value='custom';d.getElementById('dxFrom').value='8';d.getElementById('dxTo').value='3';render();assert.equal(context.dxRows().length,6);
  d.getElementById('dxWindow').value='all';d.getElementById('dxPlayer').value='Fixture One';render();assert.equal(context.dxRows().length,15);
  d.getElementById('dxSport').value='nba';render();assert.equal(context.dxRows().length,0);
  d.getElementById('dxPlayer').value='all';d.getElementById('dxSport').value='all';render();
  const detail=d.querySelector('[data-chart="outcomes"] details');detail.open=true;
  if(d.getElementById('dxMore'))d.getElementById('dxMore').open=true;
  for(const group of ['sport','market','week','player']){d.getElementById('dxGroup').value=group;render();assert.equal(d.querySelector('[data-chart="outcomes"] details').open,true);}
  d.getElementById('dxMetric').value='clv';render();assert.match(d.querySelector('[data-chart="comparison"]').textContent,/CLV/i);
});

test('weekly gaps remain unmeasured and signed comparison bars share a true zero',()=>{
  const rows=[row(),row({week:2,result:'pending'}),row({week:3,player:'Fixture Two',result:'loss',closePrice:150,closePriceOpp:-150})];
  const {document:d}=fixture(rows);
  const trend=d.querySelector('[data-chart="trend"]');
  const gap=trend.querySelectorAll('details tbody tr')[1];
  assert.deepEqual([...gap.children].map(c=>c.textContent),['Week 2','0','Unmeasured','Unmeasured']);
  assert.equal(trend.querySelectorAll('polyline').length,0,'no line interpolates across missing week');
  const bars=[...d.querySelectorAll('[data-chart="comparison"] .dx-diverge > i')];
  assert.equal(bars.length,2);
  assert.ok(bars.some(b=>b.style.left==='50%'&&Number.parseFloat(b.style.width)>0),'positive extends right');
  assert.ok(bars.some(b=>Number.parseFloat(b.style.left)<50&&Number.parseFloat(b.style.width)>0),'negative extends left');
  const zero=fixture([row(),row({result:'loss',closePrice:150,closePriceOpp:-150})]).document;
  assert.equal(zero.querySelector('.dx-diverge > i').style.width,'0%','zero never gets a minimum-sized bar');
  assert.ok(zero.querySelector('.dx-zero-dot'));
});

test('entirely absent weeks retain calendar spacing without inventing measurements',()=>{
  const {document:d}=fixture([row(),row({week:3,result:'loss'}),row({week:4})]);
  for(const name of ['trend','clv']){
    const chart=d.querySelector(`[data-chart="${name}"]`);
    const rows=[...chart.querySelectorAll('details tbody tr')].map(tr=>[...tr.children].map(c=>c.textContent));
    assert.equal(rows.length,4);assert.equal(rows[1][0],'Week 2');assert.equal(rows[1][1],'0');assert.equal(rows[1][2],'Unmeasured');
    const x=[...chart.querySelectorAll('circle')].map(c=>Number(c.getAttribute('cx')));
    assert.ok(x.includes(48));assert.ok(x.includes(280));assert.ok(x.includes(396));assert.ok(!x.includes(164));
    for(const line of chart.querySelectorAll('polyline'))assert.ok(!line.getAttribute('points').startsWith('48,'),'no segment crosses the missing week');
  }
});

test('singleton zero CLV and endpoint closing probabilities have finite geometry',()=>{
  for(const rows of [[row({closePrice:100,closePriceOpp:100})],[row({clvPts:0}),row({clvPts:0,result:'loss'})],[row({clvPts:50})],[row({clvPts:-50,result:'loss'})]]){
    const {document:d,context}=fixture(rows);
    assert.doesNotMatch(d.getElementById('dxChart').innerHTML,/NaN|Infinity/);
    assert.equal(context.dxSummary(rows).measurable.length,rows.length);
    const calibration=d.querySelector('[data-chart="calibration"]');
    assert.ok(calibration.querySelector('circle'),'endpoint lands in a valid band');
    if(rows[0].clvPts===50)assert.match(calibration.querySelector('details tbody tr:last-child').textContent,/80–100%1100\.0%100\.0%/);
    if(rows[0].clvPts===-50)assert.match(calibration.querySelector('details tbody tr:first-child').textContent,/0–20%10\.0%0\.0%/);
  }
});

test('ledger loading clears the previous slice for missing or mismatched league data',()=>{
  const loading=html.slice(html.indexOf('  if(onDiagnostics && CLV.data && CLV.lid===LID)'),html.indexOf('  // grading — the Worker is the authority'));
  assert.ok(loading.includes('Loading the season ledger'),'actual loading branch found');
  for(const missing of [true,false]){
    const {document:d,context}=fixture(mixed());
    assert.ok(d.querySelector('#dxChart [data-chart]'),'previous slice initially visible');
    context.onDiagnostics=true;
    context.CLV.lid='previous-fixture-league';
    if(missing)context.CLV.data=null;
    vm.runInContext(loading,context);
    assert.match(d.getElementById('dxMeta').textContent,/loading ledger/);
    assert.match(d.getElementById('dxChart').textContent,/Loading the season ledger/);
    assert.equal(d.querySelectorAll('#dxChart [data-chart], #dxChart svg').length,0);
    for(const selector of ['#dxTiles','#dxScope','#dxTable tbody','#dxNote'])assert.equal(d.querySelector(selector).textContent,'',selector+' clears stale values');
  }
});

test('failed ledger request clears stale values, exposes error and releases loading state',async()=>{
  const {document:d,context}=fixture(mixed());
  const loadSource=html.slice(html.indexOf('async function clvLoad(force)'),html.indexOf('(function clvWireControls(){'));
  let rejectRequest;
  context.onHub=()=>false;
  context.wGet=url=>{
    assert.equal(url,'/bozo/clv?league=fixture');
    return new Promise((resolve,reject)=>{rejectRequest=reject;});
  };
  vm.runInContext(loadSource,context);
  const pending=context.clvLoad(true);
  assert.equal(context.CLV.loading,true,'request remains loading until it settles');
  rejectRequest(new Error('Synthetic offline ledger'));
  await pending;
  assert.equal(context.CLV.loading,false);
  assert.match(d.getElementById('dxMeta').textContent,/ledger unavailable/);
  assert.match(d.getElementById('dxChart').textContent,/could not be reached/);
  assert.equal(d.querySelectorAll('#dxChart [data-chart], #dxChart svg').length,0);
  for(const selector of ['#dxTiles','#dxScope','#dxTable tbody','#dxNote'])assert.equal(d.querySelector(selector).textContent,'',selector+' clears stale values');
});
