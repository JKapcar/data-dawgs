/* Toto's surface, guarded.
 *
 * The bug this file exists to prevent: the shared assistant block is COPY-PASTED into
 * every flattened page, so "update the shared block" is really "update it 31 times".
 * The league work updated six rig pages and missed master.html — which sets
 * window.DD_POOL and therefore takes the DRAFT surface, not the page reader — leaving
 * that page reading unscoped localStorage keys, listing zero teams in the "Who are
 * you?" picker, and refusing every question behind a chip that could not be answered.
 * Nothing caught it, because nothing compared the copies.
 *
 * So: the copies are compared. If you change the block, change it everywhere in the
 * same commit and this passes. If you change it on one page, this fails and names it.
 *
 *   node work/test-toto-surface.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url);
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const read = f => fs.readFileSync(new URL(f, ROOT), "utf8");

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

const TOTO = "/* ---------- Toto: shared draft assistant";
const DDME = "/* ---------- DDMe: who is looking at THIS device";
const md5 = s => createHash("md5").update(s).digest("hex").slice(0, 10);

function slice(html, from, to){
  const i = html.indexOf(from);
  if(i < 0) return null;
  const j = to ? html.indexOf(to, i) : -1;
  return html.slice(i, j > 0 ? j : html.indexOf("\n</script>", i));
}

/* ---- 1. one block, byte for byte, on every page that carries it ---------- */
const totos = new Map(), ddmes = new Map();
const withPool = [];
for(const f of pages){
  const html = read(f);
  const toto = slice(html, TOTO, DDME);
  if(toto){
    totos.set(f, md5(toto));
    const ddme = slice(html, DDME, null);
    ok(ddme, `${f}: carries the Toto block, so it must carry the DDMe block too`);
    ddmes.set(f, md5(ddme));
  }
  if(/\bwindow\.DD_POOL\s*=\s*(?!window)/.test(html)) withPool.push(f);
}

ok(totos.size >= 30, `every page should carry the assistant (found ${totos.size})`);
for(const [label, map] of [["Toto", totos], ["DDMe", ddmes]]){
  const variants = new Map();
  for(const [f, h] of map) (variants.get(h) || variants.set(h, []).get(h)).push(f);
  const sorted = [...variants.entries()].sort((a, b) => b[1].length - a[1].length);
  ok(sorted.length === 1,
    `the ${label} block has drifted into ${sorted.length} variants — the odd pages out are ` +
    sorted.slice(1).map(([, fs_]) => fs_.join(", ")).join(" | "));
}

/* ---- 2. a DD_POOL page is a league page ---------------------------------- */
ok(withPool.length >= 7, `expected the draft rig to set DD_POOL (found ${withPool.length})`);
for(const f of withPool){
  ok(read(f).includes('src="draft-league.js"'),
    `${f} sets DD_POOL, so Toto and the "Who are you?" chip take the draft surface there — ` +
    `without draft-league.js they resolve against unscoped keys and a league instance sees nothing`);
}
const lib = fs.readFileSync(new URL("draft-league.js", ROOT), "utf8");
const linkPages = lib.match(/decorateDraftLinks\(\)\{[\s\S]*?const pages=new Set\(\[([^\]]*)\]\)/);
ok(linkPages, "draft-league.js still declares the decorated-link page set");
for(const f of withPool){
  ok(linkPages[1].includes(`"${f}"`),
    `${f} sets DD_POOL, so links to it must carry ?league= or the id never arrives`);
}

/* ---- 3. no invented dollars in a snake league ---------------------------- */
const rig = read("board.html");
ok(!/t\.left=\(st\.budget\|\|200\)-t\.spent/.test(rig),
  "ctx() must not turn a snake league's budget:null into a $200 auction");
ok(rig.includes('const draftType = st.draftType === "snake" ? "snake" : "auction";'),
  "ctx() decides auction-vs-snake before it prices anything");
ok(rig.includes("const auction = draftType === \"auction\";"), "ctx() carries an auction flag");
ok(/A snake draft has no budget and no bidding/.test(rig),
  "the state block tells the model outright that snake has no money");
ok(/SNAKE LEAGUES HAVE NO MONEY/.test(rig),
  "the draft system block carries the snake caveat — a limit stated only in the state is a limit he is talked past");

/* ---- 4. the PPN room is priced in the column it shows -------------------- */
ok(rig.includes('const scoring = (lgRoom && POOL.some(p => p.dd !== undefined)) ? "dd" : (st.scoring || "half");'),
  "ctx() prices from DataDawg$ in the room that renders DataDawg$/ESPN/PFF");
ok(rig.includes('const MV = scoring === "dd" ? "DataDawg$" : "MV";'),
  "the money column is named for the model, so it cannot call a DataDawg$ figure a market value");
ok(rig.includes("const pickVal = pk => scoring === \"dd\""),
  "a sold pick's value is re-read from this page's pool — pick.etr comes from the operator's generic column");
/* The three-column cheat sheet the branch above exists for, plus the guarantee that a
   board which simply did not price a player renders a dash rather than "$0" — "$0" is a
   claim that he is worthless, a dash is the truth, which is that the board is silent. */
{
  const board = read("board.html");
  ok(board.includes('{key:"dd",label:"DataDawg$",sortable:true}')
     && board.includes('{key:"espn",label:"ESPN",sortable:true}')
     && board.includes('{key:"pff",label:"PFF",sortable:true}')
     && board.includes('{key:"fp",label:"FantasyPros",sortable:true}'),
    "board.html renders all four sources");
  ok(!board.includes('label:"$ PPN'), "the $ PPN column is gone");
  ok(board.includes('const dollar = v => [(+v ? "$"+(+v) : "\u2014"), false, true];'),
    "an unpriced player renders a dash, not $0");
  /* A column of dollars that is really a ranking is exactly what a reader will quote as a
     price, so the page must say what these numbers are before it shows them. */
  ok(/one price curve/.test(board) && /not that vendor&rsquo;s own bid/.test(board),
    "the intro says the columns share one curve and are not vendor bids");
  /* The intent is unchanged: the page must state where each source's adjustment comes
     from rather than leaving it implicit. Only the answer moved — PFF's synced status
     was a recollection when this shipped and is now confirmed, so the hedge is gone and
     the claim is asserted. A hedge kept past the question being settled reads as live
     doubt and quietly discounts a column that should carry full weight. */
  ok(/its export is synced to the\s+league, confirmed by the commissioner/.test(board),
    "the intro states PFF needs no format adjustment, and why");
  ok(/format-delta adjustment into this room/.test(board),
    "the intro still says ESPN and FantasyPros are the ones carrying a format delta");
}

/* ---- 5. the manual knows leagues exist ----------------------------------- */
for(const f of totos.keys()){
  const html = read(f);
  ok(html.includes("LEAGUES (draft-leagues.html) — the front door."),
    `${f}: HELP is the only source Toto may answer how-to from, so it has to cover leagues`);
  ok(html.includes("CONNECT LEAGUE: paste a Sleeper league URL"),
    `${f}: HELP covers the Sleeper import`);
  ok(html.includes("under its own key per league"), `${f}: HELP describes per-league storage`);
  ok(html.includes("VOICE BOARD: radio-style dials"), `${f}: HELP covers the voice board`);
}

/* ---- 6. the page reader belongs in ctx(), never in sys ------------------- */
for(const f of pages){
  const html = read(f);
  const m = /window\.DD_BOTCTX\s*=\s*\{/.exec(html);
  if(!m) continue;
  const end = html.indexOf("\n};", m.index);
  const block = html.slice(m.index, end > 0 ? end : m.index + 40000);
  const scan = block.indexOf("DDBotScan(");
  if(scan < 0) continue;
  const ctx = /^\s{0,2}ctx\s*[:(]/m.exec(block);
  ok(ctx && scan > ctx.index,
    `${f}: the page reader is folded into sys, which is a string literal evaluated once at load — ` +
    `it freezes the page as it was before any data arrived and sends that snapshot forever. Put it in ctx().`);
}
const wr = read("fantasy-warroom.html");
ok(/ctx\(\)\{\n\s+return window\.DDBotScan/.test(wr),
  "fantasy-warroom.html regenerates the reader per question");
ok(!/\n` \+ \(window\.DDBotScan/.test(wr),
  "fantasy-warroom.html no longer concatenates the reader onto sys");

/* ---- 6b. the assistant must be REACHABLE, not just wired ----------------- */
/* Reported from a phone: #ddLeagueIndicator (right/bottom 12px, up to full width on a
   long league name) sat at z-index 9998 over #ddbLaunch and #ddmeChip at 58, so in a
   league, on a phone, Toto and the team picker could not be tapped at all. Auditing that
   he is wired in says nothing about whether anyone can reach him. */
{
  const css = (lib.match(/#ddLeagueIndicator\{[^}]*\}/) || [""])[0];
  const z = (css.match(/z-index:(\d+)/) || [])[1];
  ok(z && Number(z) < 58,
    `league bar z-index is ${z} — it must sit under #ddbLaunch/#ddmeChip (58), the team panel (59) and the dock (60)`);
  ok(/body #ddbLaunch,body #ddmeChip\{bottom:\d+px\}/.test(lib),
    "the chips lift clear of the league bar's strip, and do it with `body #id` so page-injected mobile rules cannot win on document order");
}

/* ---- 6c. every draft surface prices in the same currency ----------------- */
/* The cheat sheet moved to DataDawg$ and nothing else did: five rig files carried 613
   pool rows and ZERO `dd` values, and charted p[S.settings.scoring] — the generic
   12-team column. Gibbs read $76.4 on the charts and $90 on the sheet, same room, same
   moment. The operator's inflation was computed against a $2,400 price list in a $2,800
   room. Two surfaces disagreeing about what a dollar is, is the bug. */
{
  const RIG = ["board.html","dashboard.html","dataviz.html","report.html","bigboard.html",
               "auction.html","master.html"];
  for(const f of RIG){
    const html = read(f);
    const m = /(SEED|POOL|window\.DD_POOL) ?= ?\[\{"name"/.exec(html);
    ok(m, `${f}: has an inline player pool`);
    const arr = JSON.parse(html.slice(html.indexOf('[{"name"', m.index)).match(/^\[[\s\S]*?\}\]/)[0]);
    const priced = arr.filter(r => r.dd !== undefined).length;
    ok(priced === 121,
      `${f}: pool carries the DataDawg$ column (${priced} priced, expected 121) — without it the page cannot chart what the sheet shows`);
  }
  for(const f of ["dataviz.html","bigboard.html","auction.html","report.html"]){
    const html = read(f);
    ok(html.includes("const MONEYK = () => DD_ROOM ?"),
      `${f}: resolves the money key from the room, not from settings.scoring`);
    ok(!/\+p\[S\.settings\.scoring\]/.test(html),
      `${f}: no accessor still reads the generic column directly`);
  }
  ok(read("dashboard.html").includes('const scoring = ddRoom ? "dd" : (st.scoring || "half");'),
    "dashboard.html strip prices in DataDawg$ in the room");
}

/* ---- 6d. every money column on the phone card carries its own label ------- */
/* The bug this catches: the card hides money cells by default and gives each one an
   ::after suffix naming its currency. The four-source columns were added to MONEY_KEYS
   but to neither rule, so three prices fell through as visible with no label — "$85 $90
   $90" on a phone, nothing saying which board each came from. A number that does not
   say what it is, is worse on a cheat sheet than no number. */
{
  const board = read("board.html");
  const keys = /MONEY_KEYS.push\(([^)]*)\)/.exec(board);
  ok(keys, "board.html declares the league's money keys");
  for(const k of keys[1].split(",").map(s => s.trim().replace(/"/g, ""))){
    ok(new RegExp(`#board td\\[data-c=${k}\\]::after\\{content:`).test(board),
      `phone card labels the ${k} column — an unlabelled price is worse than no price`);
  }
}

/* ---- 6e. every position in the pool has a colour, in both themes --------- */
/* The bug this catches: the colour is the only thing telling RB from WR at a glance in
   the All view, and it is keyed off the player's own pos string. A position that exists
   in the pool but has no rule falls back to plain ink — indistinguishable from every
   other uncoloured row, so the reader learns to trust a signal that is quietly absent
   for one position. Both palettes are checked because the light one is a separate set
   of values: shipping only the dark set leaves the light theme uncoloured. */
{
  const board = read("board.html");
  const seed = board.slice(board.indexOf("const SEED = ["));
  const pool = JSON.parse(seed.slice(12, seed.indexOf("];") + 1));
  const positions = [...new Set(pool.map(p => p.pos))].sort();
  ok(positions.length >= 5, "board.html pool carries the positions to colour");
  for(const pos of positions){
    ok(new RegExp(`#board tr\\[data-pos=${pos}\\]\\{--posc:var\\(--pos-`).test(board),
      `${pos} rows get a colour — an uncoloured position is a signal the reader cannot see is missing`);
    const tok = `--pos-${pos.toLowerCase()}:`;
    ok(board.split(tok).length - 1 === 2,
      `--pos-${pos.toLowerCase()} is defined in BOTH themes, not just the dark one`);
  }
  ok(/tr\.dataset\.pos = r\.pos/.test(board),
    "the row carries its position, or every --posc rule matches nothing");
  ok(/#board tr\{[^}]*border-left:3px solid var\(--posc/.test(board),
    "the phone card's edge bar reads --posc — the bar IS the scan aid, not the text colour");
}

/* ---- 7. the service worker was re-keyed --------------------------------- */
const files = [...fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort(),
               ...fs.readdirSync(ROOT).filter(f => f.endsWith(".js") && f !== "sw.js").sort()];
const h = createHash("md5");
for(const f of files) h.update(fs.readFileSync(new URL(f, ROOT)));
const want = h.digest("hex").slice(0, 10);
const got = /const VERSION = "([^"]+)"/.exec(read("sw.js"))[1];
ok(got === want, `sw.js VERSION is ${got}, should be ${want} — run work/stamp-sw-version.py`);

console.log(`Toto surface: ${checks} assertions passed across ${totos.size} pages`);
