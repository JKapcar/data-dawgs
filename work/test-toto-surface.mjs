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
     && board.includes('{key:"pff",label:"PFF",sortable:true}'),
    "board.html renders DataDawg$, ESPN and PFF");
  ok(!board.includes('label:"$ PPN'), "the $ PPN column is gone");
  ok(board.includes('const dollar = v => [(+v ? "$"+(+v) : "\u2014"), false, true];'),
    "an unpriced player renders a dash, not $0");
  ok(/budget-normalized only/.test(board),
    "the intro says ESPN and PFF are budget-only, so three columns cannot read as equal treatment");
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

/* ---- 7. the service worker was re-keyed --------------------------------- */
const files = [...fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort(),
               ...fs.readdirSync(ROOT).filter(f => f.endsWith(".js") && f !== "sw.js").sort()];
const h = createHash("md5");
for(const f of files) h.update(fs.readFileSync(new URL(f, ROOT)));
const want = h.digest("hex").slice(0, 10);
const got = /const VERSION = "([^"]+)"/.exec(read("sw.js"))[1];
ok(got === want, `sw.js VERSION is ${got}, should be ${want} — run work/stamp-sw-version.py`);

console.log(`Toto surface: ${checks} assertions passed across ${totos.size} pages`);
