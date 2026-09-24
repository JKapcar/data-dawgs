// Regression for Will's TEN +7.5 becoming TEN -7.5. Runs real page functions,
// DOM controls, and submitLeg against an in-memory transport; never touches a league.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.DDFS_JSDOM || 'jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');
const between = (a, b) => {
  const start = html.indexOf(a), end = html.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `source markers: ${a}`);
  return html.slice(start, end);
};
function fixture() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/bozo.html' });
  const w = dom.window, d = w.document;
  const calls = [], echoes = [];
  const game = { id: 'test-ten', short: 'TEN @ TEST', start: '2026-09-27T17:00:00Z', teams: [
    {abbr:'TEN', name:'Tennessee Titans'}, {abbr:'TEST', name:'Test opponent'}] };
  Object.assign(w, { GAMES:{nfl:[game]}, S:{week:3,season:2026,picks:{}}, ME:{name:'Will'},
    SPORTS:{nfl:{n:'NFL'}}, esc:s=>String(s ?? ''), kEnc:s=>s, playerName:s=>s, teamOf:s=>s,
    isRoyale:()=>false, activeNames:()=>['Will','Other'], paintPriceWarn:()=>{},
    favPrice:s=>-Math.abs(Number(s)), fmtPrice:String, proxyTarget:()=>null,
    resetAsSelect:()=>{}, refresh:async()=>{},
    wPost:async (url, body)=> {
      calls.push({url,body});
      return body.pick ? { echo:body.pick.label, confirm_code:'fixture-only' } : {leg:{priceSource:'captured'}};
    }
  });
  w.confirm = s => { echoes.push(s); return true; };
  w.eval(between('const PERIOD_LABEL =', '/* ---------------- live state ---------------- */')
    + between('let formTouched = false, prefilledFor = null;', '/* Grade one leg')
    + between('async function submitLeg(){', '/* ---------------- Phase 2.7: commissioner actions')
    + between("document.getElementById('fMkt').onchange", '/* Signing in from the banner'));
  d.getElementById('fSport').innerHTML='<option value="nfl">NFL</option>';
  d.getElementById('fGame').innerHTML='<option value="test-ten">TEN @ TEST</option>';
  d.getElementById('fPrice').value='175';
  w.paintSides();
  const el = id => d.getElementById(id);
  const type = value => { el('fLine').value=value; el('fLine').dispatchEvent(new w.Event('input',{bubbles:true})); };
  return {dom,w,d,el,type,calls,echoes,game};
}

test('signed and unsigned spreads use slip signs, including Unicode minus and zero', () => {
  const {dom,w} = fixture();
  for(const [raw,stored] of [['+7.5',-7.5],['7.5',-7.5],['-7.5',7.5],['−7.5',7.5],['–7.5',7.5],['  +1.5  ',-1.5],['0',0]]) {
    assert.equal(w.formLine('spread',raw),stored,raw);
  }
  for(const raw of ['', ' ', '+', '-', '7..5','7.5abc','1e3','Infinity']) assert.ok(Number.isNaN(w.formLine('spread',raw)),raw);
  assert.equal(w.formLine('total','47.5'),47.5);
  assert.equal(w.formLine('prop','62.5'),62.5);
  dom.window.close();
});

test('Titans +7.5 stays +7.5 in preview, confirmation, payload, and duplicate key', async () => {
  const {dom,w,el,type,calls,echoes} = fixture();
  type('+7.5');
  assert.match(el('legPrev').textContent,/TEN \+7\.5/);
  assert.match(el('legPrev').textContent,/TEN gets 7\.5 points/);
  assert.equal(el('spreadGet').getAttribute('aria-pressed'),'true');
  assert.equal(el('spreadGive').getAttribute('aria-pressed'),'false');
  await w.submitLeg();
  assert.equal(calls.length,2);
  assert.equal(calls[0].body.pick.line,-7.5);
  assert.equal(calls[0].body.pick.label,'TEN +7.5');
  assert.match(echoes[0],/^TEN \+7\.5/);
  w.S.picks.Other={mkt:'spread',eventId:'test-ten',side:'TEN',line:-7.5,label:'TEN +7.5'};
  w.paintLegPreview();
  assert.match(el('legPrev').textContent,/Gone/);
  dom.window.close();
});

test('mobile buttons work before digits and switch a typed spread in both directions', async () => {
  const {dom,w,el,type,calls} = fixture();
  el('spreadGive').click();
  assert.equal(el('fLine').value,'-');
  assert.equal(el('legPrev').style.display,'none');
  type('-7.5');
  assert.match(el('legPrev').textContent,/TEN -7\.5.*TEN gives 7\.5 points/);
  await w.submitLeg();
  assert.equal(calls[0].body.pick.line,7.5);
  el('spreadGet').click();
  assert.equal(el('fLine').value,'+7.5');
  assert.match(el('legPrev').textContent,/TEN \+7\.5/);
  el('spreadGive').click();
  assert.equal(el('fLine').value,'-7.5');
  type('');
  el('spreadGet').click();
  assert.equal(el('fLine').value,'+');
  type('+7.5');
  assert.match(el('legPrev').textContent,/TEN \+7\.5/);
  dom.window.close();
});

test('bare digits show a positive spread and gain the explicit sign on blur', () => {
  const {dom,w,el,type} = fixture();
  type('7.5');
  assert.equal(el('spreadGet').getAttribute('aria-pressed'),'true');
  assert.match(el('legPrev').textContent,/TEN \+7\.5/);
  el('fLine').dispatchEvent(new w.Event('blur'));
  assert.equal(el('fLine').value,'+7.5');
  type('0');
  assert.match(el('legPrev').textContent,/Pick’em/);
  dom.window.close();
});

test('existing picks prefill with slip signs and round-trip without flipping the stored pick', async () => {
  for(const stored of [-7.5,7.5,0]) {
    const {dom,w,el,game,calls} = fixture();
    const mine={sport:'nfl',eventId:game.id,mkt:'spread',side:'TEN',line:stored,ts:42};
    w.prefillFromMyLeg(mine);
    assert.equal(el('fLine').value,w.formLineValue('spread',stored));
    await w.submitLeg();
    assert.equal(calls[0].body.pick.line,stored);
    assert.equal(mine.line,stored);
    dom.window.close();
  }
});

test('a sign-button touch prevents a poll from overwriting the entry', () => {
  const {dom,w,el} = fixture();
  el('spreadGet').click();
  w.prefillFromMyLeg({sport:'nfl',eventId:'test-ten',mkt:'spread',side:'TEN',line:7.5,ts:42});
  assert.equal(el('fLine').value,'+');
  dom.window.close();
});

test('market changes clear the old number; total and moneyline payloads keep their conventions', async () => {
  const {dom,w,el,type,calls} = fixture();
  type('-7.5');
  el('fMkt').value='total'; el('fMkt').dispatchEvent(new w.Event('change'));
  assert.equal(el('fLine').value,'');
  assert.equal(el('spreadDirection').hidden,true);
  type('47.5');
  await w.submitLeg();
  assert.equal(calls[0].body.pick.line,47.5);
  assert.match(calls[0].body.pick.label,/o47\.5/);
  el('fMkt').value='ml'; el('fMkt').dispatchEvent(new w.Event('change'));
  assert.equal(el('lineWrap').style.display,'none');
  await w.submitLeg();
  assert.equal(calls[2].body.pick.line,0);
  assert.equal(calls[2].body.pick.label,'TEN ML');
  dom.window.close();
});

test('invalid or unfinished numbers never reach the submission API', async () => {
  const {dom,w,el,type,calls} = fixture();
  for(const raw of ['','+','-','7..5','7.5abc']) {
    type(raw);
    await w.submitLeg();
    assert.equal(calls.length,0);
    assert.match(el('err').textContent,/Enter your spread/);
    assert.equal(el('legPrev').style.display,'none');
  }
  dom.window.close();
});
