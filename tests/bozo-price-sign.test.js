/* Android's numeric keypad has no minus key. Every legal Bozo price is a favourite, so
   a type="number" price box made the form unusable on the device most members submit
   from — they could type 238 and nothing else. These pin the fix: the boxes hold text,
   the Price box reads a bare number as the favourite it can only have meant, and the
   other side keeps whatever sign was actually given it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bozo = fs.readFileSync(path.join(__dirname, '..', 'bozo.html'), 'utf8');

// The real functions, lifted out of the page rather than retyped — a second copy of
// this parsing would be exactly as wrong as the first and agree with it perfectly.
function lift(name) {
  const decl = new RegExp(
    `(function ${name}\\([\\s\\S]*?\\n\\}|const ${name} = [\\s\\S]*?;\\n)`);
  const m = bozo.match(decl);
  assert.ok(m, `${name} is defined in bozo.html`);
  return m[1];
}
const ctx = vm.createContext({});
vm.runInContext(lift('priceNum') + '\n' + lift('favPrice') + '\n' + lift('fmtPrice')
  + '\nthis.priceNum = priceNum; this.favPrice = favPrice; this.fmtPrice = fmtPrice;', ctx);
const { priceNum, favPrice, fmtPrice } = ctx;

test('the Price box wears its minus — the sign is never typed', () => {
  // The keypad most Android phones ship shares "." and "-" on one key: a double-tap for
  // a character that carries no information, because the band is favourites-only. So the
  // minus is painted beside the box and the box takes digits alone.
  const field = bozo.match(/<span class="pxfix">[\s\S]*?<\/span><\/div>/)[0];
  assert.match(field, /<span class="sgnfix" aria-hidden="true">−<\/span>/, 'the minus is painted on');
  assert.match(field, /id="fPrice"/);
  assert.match(field, /pattern="\[0-9\]\*"/, 'no sign is accepted in the value');
  assert.match(field, /aria-label="Price[^"]*minus/, 'the prefix is announced, not just drawn');
  // and something has to keep it that way as characters arrive
  assert.match(bozo, /el\.value\.replace\(\/\[\^0-9\]\/g, ''\)/, 'input is stripped to digits');
  assert.doesNotMatch(bozo, /placeholder="-175"/, 'the placeholder no longer shows a sign to copy');
});

test('the price boxes are text with a numeric inputmode, never type="number"', () => {
  const price = bozo.match(/<input id="fPrice"[^>]*>/)[0];
  const opp = bozo.match(/<input id="fPriceOpp"[^>]*/)[0];
  for (const [what, tag] of [['Price', price], ['Other side', opp]]) {
    assert.doesNotMatch(tag, /type="number"/, `${what} is not a number input`);
    assert.match(tag, /type="text"/, `${what} is a text input`);
    assert.match(tag, /inputmode="numeric"/, `${what} still raises a digit keypad`);
  }
  // The closing-price boxes have the same problem and the same fix.
  assert.doesNotMatch(bozo, /<input type="number"[^>]*data-c=/);
  assert.doesNotMatch(bozo, /<input type="number"[^>]*class="g[co]"/);
});

test('nothing reads a price box with unary plus any more', () => {
  for (const bad of [/\+fPrice\.value/, /\+px\.value/, /Number\(oppRaw\)/]) {
    assert.doesNotMatch(bozo, bad, `${bad} would misread "238" or "-"`);
  }
});

test('priceNum takes signed whole numbers and refuses everything else', () => {
  assert.equal(priceNum('-175'), -175);
  assert.equal(priceNum('+145'), 145);
  assert.equal(priceNum('238'), 238);
  assert.equal(priceNum('  -110 '), -110);
  assert.equal(priceNum('-1,200'), -1200);
  for (const junk of ['', ' ', '-', '+', 'abc', '1-2', '-11.5', null, undefined]) {
    assert.ok(Number.isNaN(priceNum(junk)), `${JSON.stringify(junk)} is not a price`);
  }
});

test('the Price box reads a bare number as the favourite — the band leaves no other reading', () => {
  assert.equal(favPrice('238'), -238);   // what the box now holds: digits, no sign
  assert.equal(favPrice('-238'), -238);
  assert.equal(favPrice('+238'), -238);
  assert.ok(Number.isNaN(favPrice('-')));
});

test('the other side keeps its sign — a pick’em prices both sides negative', () => {
  assert.equal(priceNum('-110'), -110);
  assert.equal(fmtPrice(145), '+145');
  assert.equal(fmtPrice(-110), '-110');
});

test('a submitted price is checked for being a number before it is checked against the band', () => {
  const sub = bozo.slice(bozo.indexOf('async function submitLeg()'));
  const finite = sub.indexOf('Number.isFinite(price)');
  const band = sub.indexOf('outside the ${bd.ceil}');
  assert.ok(finite > 0 && band > finite, 'NaN never reaches the band message');
});
