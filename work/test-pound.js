const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const P = require('./pound-core.js');

let pass = 0;
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const test = (name, fn) => { fn(); pass++; console.log('ok  ' + name); };

test('American -110 conversion', () => {
  near(P.americanToDecimal(-110), 1.9090909090909092);
  near(P.impliedFromAmerican(-110), 0.5238095238095238);
});
test('American +150 conversion', () => near(P.americanToDecimal(150), 2.5));
test('decimal round trip', () => near(P.decimalToAmerican(P.americanToDecimal(-125)), -125));
test('two-leg parlay', () => {
  const r = P.parlay([-110, 150]);
  near(r.decimal, 4.772727272727273);
  near(r.implied_probability, 1 / r.decimal);
});
test('two-way vig normalizes to one', () => {
  const r = P.holdVig(-110, -110);
  near(r.hold, 0.04761904761904767);
  near(r.devig_probability[0] + r.devig_probability[1], 1);
});
test('EV at break even is zero', () => near(P.betEV(P.impliedFromAmerican(-110), -110).roi, 0));
test('hedge equalizes outcomes', () => {
  const r = P.hedge(100, 200, -150);
  const first = 100 * (3 - 1) - r.hedge_stake;
  const second = r.hedge_stake * (P.americanToDecimal(-150) - 1) - 100;
  near(first, second);
  near(first, r.locked_profit);
});
test('perfect NFL passer rating', () => near(P.passerRating(20, 20, 400, 4, 0).rating, 158.33333333333334));
test('negative passing yards remain a valid line', () => near(P.passerRating(1, 0, -5, 0, 0).rating, 39.583333333333336));
test('fractional passing statistics fail closed', () => assert.throws(() => P.passerRating(1.5, 1, 10, 0, 0)));
test('538 baseline equal ratings +65 HFA', () => near(P.eloGame(1500, 1500, 65).home_win_probability, 0.5924662305843318));
test('normal inverse round trip', () => near(P.normalCdf(P.normalInv(0.75)), 0.75, 2e-7));
test('normal translation preserves the published 0.5-point win threshold', () => near(P.normalTranslation(0.5, 13.18).expected_margin_home, 0.5));
test('a line at the expected margin has 50% cover probability', () => {
  const margin = P.normalTranslation(0.6, 13.18).expected_margin_home;
  const r = P.normalTranslation(0.6, 13.18, -margin);
  near(r.home_cover_probability, 0.5, 1e-7);
  near(r.cover_threshold_home_margin, margin);
});
test('Brier and log loss', () => {
  const r = P.forecastGrade(0.8, 1);
  near(r.brier, 0.04);
  near(r.log_loss, -Math.log(0.8));
});
test('belief summary statistics', () => {
  const r = P.beliefSummary([0.4, 0.6, 0.8]);
  near(r.mean, 0.6); near(r.median, 0.6); near(r.range, 0.4);
  assert.equal(r.crosses_50, true);
});
test('bad odds fail closed', () => assert.throws(() => P.americanToDecimal(-50)));
test('bad probability fails closed', () => assert.throws(() => P.beliefSummary([1.2])));
test('every DawgHouse inline script parses', () => {
  const html = fs.readFileSync('dawghouse.html', 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length >= 3);
  scripts.forEach((source, i) => assert.doesNotThrow(() => new vm.Script(source, { filename: `pound-inline-${i}.js` })));
});
test('every calculators.html inline script parses', () => {
  const html = fs.readFileSync('calculators.html', 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length >= 3);
  scripts.forEach((source, i) => assert.doesNotThrow(() => new vm.Script(source, { filename: `calculators-inline-${i}.js` })));
});
test('calculators.html carries the DDPound core verbatim, dawghouse.html no longer does', () => {
  /* CEP-5A Stage 2. The inlined copy must BE work/pound-core.js (the testable source
     this whole file grades), not a paraphrase of it — byte drift between the two is
     exactly how a page starts disagreeing with its own contracts. fs paths are
     cwd-relative and this suite runs from the REPO ROOT (require() above is
     file-relative, which is why './pound-core.js' works there and not here). */
  const core = fs.readFileSync('work/pound-core.js', 'utf8').trim();
  const calc = fs.readFileSync('calculators.html', 'utf8');
  assert.ok(calc.includes(core), 'calculators.html inline DDPound differs from work/pound-core.js');
  const dawg = fs.readFileSync('dawghouse.html', 'utf8');
  assert.ok(!dawg.includes('DDPound'), 'dawghouse.html still carries DDPound');
});

console.log(`\n${pass} passed / 0 failed`);
