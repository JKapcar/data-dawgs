/* Bozo CLV + Bozo Royale — the maths, tested against the handoff's sanity anchors.
 *
 * Run: node test-bozo-clv.mjs
 *
 * ⚠️ WHY THESE FUNCTIONS ARE PULLED OUT OF SOURCE RATHER THAN IMPORTED.
 * The chart's maths lives inside bozo.html (the page IS the source — there is no build
 * step) and the Royale maths lives in the Worker, which is one big module with no
 * exports. Both are pure functions of their arguments, so the honest way to test them is
 * to lift the exact source text and run it. If someone renames one, extraction fails
 * loudly rather than silently testing a stale copy — which is the failure mode a
 * hand-maintained second implementation would have.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const WORK = dirname(fileURLToPath(import.meta.url));
const worker = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const page = readFileSync(resolve(WORK, "..", "bozo.html"), "utf8");

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) pass++;
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;

/* ---- lift one top-level declaration out of a source file ----
   A `function` declaration ends at the closing brace of its body. A `const` ends at the
   first semicolon that is not nested inside anything. Strings, template literals and
   comments are skipped, because all three contain braces and semicolons that are not
   structure. */
function lift(src, name) {
  const fn = new RegExp(`\\n(?:async )?function ${name}\\s*\\(`).exec(src);
  const cn = new RegExp(`\\nconst ${name}\\s*=`).exec(src);
  const m = fn || cn;
  if (!m) throw new Error(`could not lift ${name} — it was renamed or restructured`);
  const start = m.index + 1;

  let depth = 0, inS = null, inC = null, bodyOpened = false, prev = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inC) {
      if (inC === "//" && c === "\n") inC = null;
      else if (inC === "/*" && c === "*" && n === "/") { inC = null; i++; }
      continue;
    }
    if (inS) {
      if (c === "\\") { i++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === "/" && n === "/") { inC = "//"; i++; continue; }
    if (c === "/" && n === "*") { inC = "/*"; i++; continue; }
    // ⚠️ Regex literals have to be skipped whole. A character class like [^A-Za-z'.-]
    // contains an apostrophe, which a naive scanner reads as the start of a string and
    // then swallows the rest of the file looking for its close. Distinguish a regex from
    // a division by what precedes it: after a value, `/` divides; after an operator,
    // comma, bracket or the start of a statement, it opens a pattern.
    if (c === "/" && (prev === "" || "([{,;=:!&|?+-*%~^<>".includes(prev))) {
      let j = i + 1, cls = false;
      for (; j < src.length; j++) {
        const d = src[j];
        if (d === "\\") { j++; continue; }
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) break;
        else if (d === "\n") { j = i; break; }        // not a regex after all
      }
      if (j > i) { i = j; prev = "/"; continue; }
    }
    if (c === '"' || c === "'" || c === "`") { inS = c; continue; }
    if (!/\s/.test(c)) prev = c;
    if (c === "{" || c === "(" || c === "[") { depth++; if (c === "{") bodyOpened = true; continue; }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (fn && bodyOpened && depth === 0) return src.slice(start, i + 1);
      continue;
    }
    if (cn && c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`could not lift ${name} — never found the end of it`);
}

const build = (src, names, prelude = "") =>
  new Function(prelude + "\n" + names.map(n => lift(src, n)).join("\n") + "\nreturn {" + names.join(",") + "};")();

/* ======================= 1. the chart's axis maths ========================= */
const chart = build(page, ["clvImp", "clvDevig", "clvGraded", "clvLuckBand"]);

/* handoff §3 sanity anchor: -200 raw implied is 66.7%; de-vigged against the +180 the
   other side was actually quoted at, it is 65.1%. The whole point of the de-vig is that
   these are different numbers, and the chart deliberately uses the second. */
ok(near(chart.clvImp(-200) * 100, 66.7), "raw implied of -200 is 66.7%", (chart.clvImp(-200) * 100).toFixed(2));
ok(near(chart.clvDevig(-200, 180) * 100, 65.1), "-200 de-vigged against +180 is 65.1%",
   (chart.clvDevig(-200, 180) * 100).toFixed(2));
ok(chart.clvDevig(-200, 180) < chart.clvImp(-200),
   "de-vigging always LOWERS a favourite's number — if this flips, the hold is being added not removed");

/* handoff §3 worked leg: bet -360/+270, closes -350/+295 → +1.11 points of CLV. */
{
  const pE = chart.clvDevig(-360, 270), pC = chart.clvDevig(-350, 295);
  ok(near(pE * 100, 74.33, 0.02), "worked leg: entry de-vigs to 74.33%", (pE * 100).toFixed(2));
  ok(near(pC * 100, 75.44, 0.02), "worked leg: close de-vigs to 75.44%", (pC * 100).toFixed(2));
  ok(near((pC - pE) * 100, 1.11, 0.02), "worked leg: CLV is +1.11 points", ((pC - pE) * 100).toFixed(2));
}

/* Sign check: you bet a side, the market moves TOWARD it, CLV is positive. */
ok(chart.clvDevig(-150, 130) - chart.clvDevig(-120, 100) > 0,
   "sign check: a line that shortened after you bet it is positive CLV");

/* ⚠️ No opposite side means no de-vig. Returning raw implied here would mix two
   different quantities — different by roughly the whole hold — inside one average. */
ok(chart.clvDevig(-200, null) === null, "a price with no opposite side cannot be de-vigged and returns null");
ok(chart.clvDevig(null, 180) === null, "a missing price returns null rather than 0");

/* The push-drop and no-close rules, at the gate every point passes through. */
const legBase = { result: "win", entryPrice: -150, entryPriceOpp: 130, closePrice: -160, closePriceOpp: 140 };
ok(chart.clvGraded(legBase) === true, "a fully-priced graded leg is chartable");
ok(chart.clvGraded({ ...legBase, result: "push" }) === false, "a push is dropped from the chart");
ok(chart.clvGraded({ ...legBase, result: null }) === false, "an ungraded leg is dropped");
ok(chart.clvGraded({ ...legBase, closePrice: null, closePriceOpp: null }) === false,
   "a leg with no capturable close is dropped — and there is no branch that substitutes the entry price");
ok(chart.clvGraded({ ...legBase, closePriceOpp: null }) === false,
   "a close with only one side captured is dropped: without the opposite side there is no de-vig");
ok(chart.clvGraded({ ...legBase, entryPriceOpp: null }) === false,
   "an entry with only one side is dropped for the same reason");

/* The luck band shrinks as n grows — that is the entire argument it exists to make. */
{
  const mk = n => [{ player: "A", week: n, n, expected: 63 }, { player: "B", week: n, n, expected: 63 }];
  const b1 = chart.clvLuckBand(mk(1)), b8 = chart.clvLuckBand(mk(8)), b22 = chart.clvLuckBand(mk(22));
  ok(b1.se > b8.se && b8.se > b22.se, "the luck band shrinks as the season runs");
  ok(near(b22.se, 10.3, 0.6), "after 22 legs the band is still about ±10 points", b22.se.toFixed(1));
  ok(b22.se > 9, "…which is wider than the whole spread of season deltas — the y-axis separates nobody at this sample size");
}

/* ================= 2. the DK rule, enforced at submission ================= */
const sub = build(worker, ["selectionKeyOf", "marketKeyOf"]);
const leg = (o) => ({ eventId: "401", mkt: "spread", side: "CLE", line: 3.5, prop: null, ...o });

ok(sub.selectionKeyOf(leg({})) === sub.selectionKeyOf(leg({})),
   "the same selection produces the same key");
ok(sub.selectionKeyOf(leg({})) !== sub.selectionKeyOf(leg({ side: "PIT", line: -3.5 })),
   "opposite sides are DIFFERENT selections — which is exactly why uniqueness alone can't catch a contradiction");
ok(sub.marketKeyOf(leg({})) === sub.marketKeyOf(leg({ side: "PIT", line: -3.5 })),
   "…but they are the same MARKET INSTANCE, so the contradiction check sees them");
ok(sub.marketKeyOf(leg({ line: 3.5 })) !== sub.marketKeyOf(leg({ line: 6.5 })),
   "a different spread number is a different market — DET -3.5 and DEN +6.5 can both cash");
ok(sub.marketKeyOf({ eventId: "402", mkt: "total", side: "over", line: 47.5 })
   === sub.marketKeyOf({ eventId: "402", mkt: "total", side: "under", line: 47.5 }),
   "over and under on one number are one market instance");
ok(sub.marketKeyOf({ eventId: "402", mkt: "total", side: "over", line: 47.5 })
   !== sub.marketKeyOf({ eventId: "402", mkt: "total", side: "over", line: 51.5 }),
   "different totals are different markets");
ok(sub.marketKeyOf({ eventId: "9", mkt: "prop", prop: "QB yards", line: 199.5 })
   !== sub.marketKeyOf({ eventId: "9", mkt: "prop", prop: "QB yards", line: 249.5 }),
   "the same prop at two numbers is two markets, not one");
ok(sub.marketKeyOf({ eventId: "9", mkt: "ml", side: "CLE" }) === sub.marketKeyOf({ eventId: "9", mkt: "ml", side: "PIT" }),
   "both moneylines on one game are one market instance");

/* ⚠️ THE PAGE KEEPS A MIRROR OF BOTH KEYS so it can warn you your leg is gone BEFORE you
   press submit. The server stays authoritative — drift produces a wrong warning, never a
   leg that gets through — but a wrong warning is still a lie told confidently, and these
   two implementations sit in different files with nothing but this test between them. */
{
  const pg = build(page, ["pageSelectionKey", "pageMarketKey"]);
  const cases = [
    { eventId: "401", mkt: "spread", side: "CLE",   line: 3.5,   prop: null },
    { eventId: "401", mkt: "spread", side: "PIT",   line: -3.5,  prop: null },
    { eventId: "402", mkt: "total",  side: "over",  line: 47.5,  prop: null },
    { eventId: "402", mkt: "total",  side: "under", line: 47.5,  prop: null },
    { eventId: "9",   mkt: "ml",     side: "CLE",   line: 0,     prop: null },
    { eventId: "9",   mkt: "prop",   side: "over",  line: 199.5, prop: "QB yards" },
    { eventId: "9",   mkt: "other",  side: "DET",   line: 0.5,   prop: "No overtime" },
  ];
  let selOk = 0, mktOk = 0;
  for (const c of cases) {
    if (pg.pageSelectionKey(c.eventId, c.mkt, c.side, c.line, c.prop) === sub.selectionKeyOf(c)) selOk++;
    if (pg.pageMarketKey(c.eventId, c.mkt, c.line, c.prop) === sub.marketKeyOf(c)) mktOk++;
  }
  ok(selOk === cases.length, "the page's selection key matches the Worker's on every market shape", `${selOk}/${cases.length}`);
  ok(mktOk === cases.length, "…and so does its market key", `${mktOk}/${cases.length}`);
}

/* ========================== 3. Bozo Royale levers ========================= */
const roy = build(worker, ["rImp", "rDevig", "rInvNorm", "rDir", "rSd", "rExpected",
                           "royaleBeatDeficit", "royaleApplyLever"],
                  "const ROYALE_SD = " + /const ROYALE_SD = (\{[\s\S]*?\n\});/.exec(worker)[1] + ";");

ok(near(roy.rDevig(-200, 180) * 100, 65.1), "the Worker de-vigs identically to the page — one formula, two copies, same answer");

/* ⚠️ THE EXPLOIT FIX. A prop is binary and has no margin, so Worst Beat could never
   score it and a prop-only player was immune to a quarter of the chop machinery. Kap's
   call: give it a margin from its own de-vigged closing probability. A -450 prop that
   lost has to be a worse beat than a -120 prop that lost, on the same z-scale the
   margin markets already use. */
{
  const chalk = roy.royaleBeatDeficit({ mkt: "prop", price: -450, entryPriceOpp: 340, line: 0.5, sport: "nfl" },
                                      { close: -450, closeOpp: 340 });
  const dog = roy.royaleBeatDeficit({ mkt: "prop", price: -120, entryPriceOpp: 100, line: 0.5, sport: "nfl" },
                                    { close: -120, closeOpp: 100 });
  ok(chalk.v !== null && dog.v !== null, "a binary leg CAN be scored on Worst Beat — it is no longer unmeasurable");
  ok(chalk.v > dog.v, "a -450 prop that lost is a worse beat than a -120 prop that lost");
  ok(chalk.basis === "close", "…and it is scored off the CLOSE, which is the bar this whole system argues from");

  const noClose = roy.royaleBeatDeficit({ mkt: "prop", price: -300, entryPriceOpp: 240, line: 0.5, sport: "nfl" }, {});
  ok(noClose.v !== null && noClose.basis === "entry",
     "with no close, Worst Beat falls back to the entry price and RECORDS that it did");

  const margin = roy.royaleBeatDeficit({ mkt: "spread", price: -150, line: -6.5, side: "DET", dir: "over", sport: "nfl" },
                                       { actual: -10 });
  ok(margin.basis === "margin" && margin.v > 0, "a margin market is still scored on how far under its number it finished");
}

/* Worst CLV with no capturable close: unmeasurable, falls through. NOT ranked worst
   (DraftKings pulling a market is not the player's doing) and NOT ranked best (that
   would make an uncapturable market the optimal thing to bet). */
{
  const picks = {
    A: { mkt: "ml", price: -200, entryPriceOpp: 170, ts: 100, sport: "nfl", line: 0 },
    B: { mkt: "ml", price: -300, entryPriceOpp: 250, ts: 200, sport: "nfl", line: 0 },
  };
  const noCloses = { A: {}, B: {} };
  const r = roy.royaleApplyLever(3, ["A", "B"], picks, noCloses);
  ok(r.pass === "unmeasurable", "Worst CLV with no closes at all is unmeasurable, not a tie");

  const oneClose = { A: { close: -250, closeOpp: 210 }, B: {} };
  const r2 = roy.royaleApplyLever(3, ["A", "B"], picks, oneClose);
  ok(r2.key === "A", "…and with one scorable leg it decides on that leg alone rather than guessing at the other");

  /* A tie and an unmeasurable lever are different failures and must not be reported as
     one — a tie is bad luck, an unmeasurable lever is a hole in the data. */
  const tie = roy.royaleApplyLever(0, ["A", "B"],
    { A: { price: -200, mkt: "ml" }, B: { price: -200, mkt: "ml" } }, { A: {}, B: {} });
  ok(tie.pass === "tie", "two identical prices tie on Shortest Odds, and are reported as a tie");
}

/* Shortest odds = biggest favourite = most negative price. An earlier spec snippet had
   this backwards and called -100 the chalkiest. */
{
  const r = roy.royaleApplyLever(0, ["A", "B"],
    { A: { price: -110, mkt: "ml" }, B: { price: -400, mkt: "ml" } }, { A: {}, B: {} });
  ok(r.key === "B", "Shortest Odds picks the BIGGEST favourite, not the smallest");
}
/* Last In = latest submission. */
{
  const r = roy.royaleApplyLever(2, ["A", "B"],
    { A: { ts: 100, mkt: "ml", price: -110 }, B: { ts: 900, mkt: "ml", price: -110 } }, { A: {}, B: {} });
  ok(r.key === "B", "Last In picks the latest submitted leg");
}

/* ================== 3b. resolving a free-text prop ======================= */
/* ⚠️ A prop is ALWAYS priced — every leg goes on a real bet slip, so the market exists
   and closes. What can fail is joining the text a player typed to the odds source's
   market id, which needs stat, player and number all to line up. These tests pin that
   join, and pin that a failure says WHICH of the three missed. */
const prop = build(worker, ["bzNorm", "bzAmerican", "bozoPropStats", "bozoPropNameTokens", "bozoDkPropQuote"],
  "const BOZO_CLOSE_BOOK='draftkings';\n"
  + "const BOZO_STAT_WORDS = " + /const BOZO_STAT_WORDS = (\[[\s\S]*?\n\]);/.exec(worker)[1] + ";\n"
  + "const BOZO_PROP_NOISE = " + /const BOZO_PROP_NOISE = (\/[\s\S]*?\/gi);/.exec(worker)[1] + ";");

ok(prop.bozoPropStats("Kelce receiving yards").includes("receiving_yards"), "\"receiving yards\" resolves to the receiving-yards stat");
ok(prop.bozoPropStats("Ace 5+ strikeouts").includes("strikeouts"), "\"strikeouts\" resolves");
ok(prop.bozoPropStats("Sniper 2+ shots on goal").includes("shotsOnGoal"), "\"shots on goal\" resolves");
ok(prop.bozoPropStats("QB1 1+ passing TD").includes("passing_touchdowns"), "\"passing TD\" resolves");
ok(prop.bozoPropStats("Star 25+ points").includes("points"), "\"points\" resolves");
ok(prop.bozoPropStats("vibes").length === 0, "unrecognisable text resolves to no stat rather than guessing one");

ok(prop.bozoPropNameTokens("Kelce receiving yards").join() === "kelce",
   "the stat vocabulary is stripped and what is left is the player", prop.bozoPropNameTokens("Kelce receiving yards").join());
ok(prop.bozoPropNameTokens("Patrick Mahomes 2+ passing touchdowns").join() === "patrick,mahomes",
   "a full name survives the strip", prop.bozoPropNameTokens("Patrick Mahomes 2+ passing touchdowns").join());

{
  /* One event, two players, both sides priced by DraftKings.
     ⚠️ The number is matched on `bookOverUnder` — the field that states what the book is
     actually offering — rather than on anything parsed out of the market id. That is
     deliberate: alt lines arrive as additional entries and I am not willing to pin a
     test to a guess about how the source spells their ids. bookOverUnder carries the
     number however the id is written. */
  const ev = { odds: {
    "receiving_yards-TRAVIS_KELCE_1_NFL-game-ou-over":  { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -115 } } },
    "receiving_yards-TRAVIS_KELCE_1_NFL-game-ou-under": { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -105 } } },
    "rushing_yards-ISIAH_PACHECO_1_NFL-game-ou-over":   { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -110 } } },
    "rushing_yards-ISIAH_PACHECO_1_NFL-game-ou-under":  { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -110 } } },
  } };
  const hit = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"Kelce receiving yards", line:62.5, dir:"over" });
  ok(hit.price === -115 && hit.opp === -105, "a prop resolves to DraftKings' price and the opposite side",
     JSON.stringify(hit));

  const under = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"Kelce receiving yards", line:62.5, dir:"under" });
  ok(under.price === -105 && under.opp === -115, "the under side orients the other way round");

  /* ⚠️ The NUMBER is part of the market's identity. Bozo's favourites-only band pushes
     players onto bought-down alt lines constantly, so a match that ignored the line
     would return a different market's price — confidently wrong, which is worse than
     absent. */
  const wrongLine = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"Kelce receiving yards", line:80.5, dir:"over" });
  ok(!!wrongLine.reason && /not the number 80\.5/.test(wrongLine.reason),
     "a number DraftKings isn't offering is reported as such, not silently matched to the line it does offer",
     wrongLine.reason);
  ok(!wrongLine.price, "…and no price is returned for it — a near-miss on the number is a different market");

  const wrongPlayer = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"Worthy receiving yards", line:62.5, dir:"over" });
  ok(/no market for/.test(wrongPlayer.reason || ""), "an unmatched player names itself in the reason", wrongPlayer.reason);

  const wrongStat = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"Kelce total bases", line:1.5, dir:"over" });
  ok(/market on this game/.test(wrongStat.reason || ""), "an absent stat is distinguished from an absent player", wrongStat.reason);

  const noStat = prop.bozoDkPropQuote(ev, { mkt:"prop", prop:"something clever", line:1.5, dir:"over" });
  ok(/which stat/.test(noStat.reason || ""), "unparseable text says the STAT couldn't be read, not that props don't work");

  const pulled = prop.bozoDkPropQuote({ odds: {
    "receiving_yards-TRAVIS_KELCE_1_NFL-game-ou-over":  { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -115, available: false } } },
    "receiving_yards-TRAVIS_KELCE_1_NFL-game-ou-under": { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -105 } } },
  } }, { mkt:"prop", prop:"Kelce receiving yards", line:62.5, dir:"over" });
  ok(/wasn't pricing/.test(pulled.reason || ""), "a suspended market is its own reason, not a matching failure", pulled.reason);

  // Both sides or nothing — without the opposite side there is no de-vig.
  const oneSide = prop.bozoDkPropQuote({ odds: {
    "receiving_yards-TRAVIS_KELCE_1_NFL-game-ou-over": { bookOverUnder: 62.5, byBookmaker: { draftkings: { odds: -115 } } },
  } }, { mkt:"prop", prop:"Kelce receiving yards", line:62.5, dir:"over" });
  ok(!!oneSide.reason, "a prop with only one side priced is not captured — there would be nothing to de-vig against");
}

/* ===================== 4. correlated ticket pricing ====================== */
const tp = build(worker, ["ticketPricing"]);
{
  const ledger = {
    a: { week: 1, eventId: "1", game: "A VS B", sport: "nfl", price: -150, player: "P1" },
    b: { week: 1, eventId: "1", game: "A VS B", sport: "nfl", price: -200, player: "P2" },
    c: { week: 2, eventId: "2", game: "C VS D", sport: "nfl", price: -150, player: "P1" },
    d: { week: 2, eventId: "3", game: "E VS F", sport: "nfl", price: -200, player: "P2" },
  };
  const out = tp.ticketPricing({}, ledger);
  const w1 = out.find(t => t.week === 1), w2 = out.find(t => t.week === 2);
  ok(w1.priceIsIndicative === true, "two legs on one game make the ticket a same-game parlay");
  ok(/upper bound/.test(w1.priceCaveat), "…and the caveat says the product is an upper bound, not the payout");
  ok(w1.sameGameGroups.length === 1 && w1.sameGameGroups[0].legs === 2, "…and names which game and how many legs");
  ok(w2.priceIsIndicative === false, "legs on distinct games are not flagged");
}

/* ========================= 5. the page wiring ============================ */
/* ⚠️ The regression this guards is subtle: `r.close != null ? r.close : x.price` scored
   every leg with no captured close as EXACTLY zero movement, which then beat every
   genuinely-negative CLV in the pool. Strip comments before searching, or this test
   matches the comment that explains the bug it is looking for. */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  ok(!/\?\s*r\.close\s*:\s*x\.price/.test(code),
     "the page no longer back-fills a missing close from the entry price");
  ok(/const clv\s*=\s*\(pC==null \|\| pE==null\)\s*\?\s*null/.test(code),
     "…the standard verdict scores an uncapturable close as null, not as zero movement");
  ok(/const scored\s*=\s*pool\.filter\(p=>R\[k\]\(p\)!=null\)/.test(code),
     "…and a lever that cannot score anything passes instead of ranking nulls");
  ok(!/imp\(r\.close\)\s*-\s*imp\(r\.price\)/.test(code),
     "the season sheet's CLV tile de-vigs too — one CLV number per player per page, not two");
}
/* ⚠️ Deliberate deviation from the handoff, and the reason is in the CSS comment.
   The prototype paired an OS-preference block with a [data-theme] scope. This site's
   tokens are dark-by-default with a [data-theme="light"] override and NO OS block
   anywhere — so adding one would give a light-OS reader who chose Dark light series
   colours on a dark card, which is the exact failure the instruction meant to prevent. */
ok(!/@media\s*\(\s*prefers-color-scheme/.test(page.replace(/\/\*[\s\S]*?\*\//g, "")),
   "no OS-preference media query — the site's theme toggle is the only theme input here");
ok(/:root\[data-theme="light"\][\s\S]{0,400}--s1:/.test(page),
   "the eight series colours have a light-theme override on the site's own theme scope");
ok(/:root\{[\s\S]{0,600}--s1:/.test(page),
   "…and a dark set on :root, which is this site's default");
ok(/id="clvCard"/.test(page), "the chart card exists on the page");
ok(page.indexOf('id="drawCard"') < page.indexOf('id="clvCard"')
   && page.indexOf('id="clvCard"') < page.indexOf('id="ticketCard"'),
   "the chart sits between the hierarchy slot machine and the ticket, as specified");
ok(/clv-tablewrap/.test(page), "the table twin ships — it is the WCAG counterpart and the contrast relief, not optional");

/* ============ 7. Bozo Royale survival odds ==============================
   ⚠️ These guard the HONESTY RAILS, not the arithmetic. The arithmetic was checked
   against the seeded season in a browser: curves monotone, survival starting at 1.0,
   win probabilities summing to exactly 1, and the clean-week share landing on 0.58^5.
   What a static test can protect is the set of caveats, because those are what gets
   deleted when someone decides the chart looks cluttered. */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/function simulateRoyale/.test(code), "the survival simulation exists");
  ok(/id="survCard"/.test(page), "the survival card exists");

  // It must resample REAL legs. A fitted distribution would drop the correlation between
  // the price a player takes and how badly they miss, which flatters whoever bets chalk.
  ok(/pool\[\(Math\.random\(\)\*pool\.length\)\|0\]/.test(code),
     "each simulated week deals a player one of their OWN past legs");
  ok(/Math\.random\(\) >= leg\.p/.test(code),
     "…and re-rolls only the outcome, from that leg's own de-vigged closing price");

  ok(/Simulation, not a forecast/.test(code), "the footnote says it is simulation");
  ok(/drawn independently/.test(code) && /same game/.test(code),
     "…and names the correlation it does not model");
  // ⚠️ The re-deploy stopped being an assumption when it stopped being a choice.
  ok(/need no assumption/.test(code),
     "…and says re-deploys need no assumption, because they are automatic");
  // ⚠️ Strip HTML comments too, not just JS ones. The page keeps a note explaining what
  // the buy-back was and why the timed window existed — that history is worth keeping,
  // and a test that cannot tell a comment from live code would force it to be deleted.
  const live = code.replace(/<!--[\s\S]*?-->/g, "");
  ok(!/buy-back/i.test(live), "…and no live code or copy still offers a buy-back");
  ok(!/bbTake|bbPass|bozo\/buyback/.test(live),
     "…and the Take/Decline handlers are gone, not just their markup");
  ok(/legs resampled/.test(code) && /decoration/.test(code),
     "…and says when a player's history is too thin to mean anything");
  ok(/no captured close/.test(code),
     "…and flags resampled legs whose probability came from a self-reported entry price");

  // Royale only, and only while there is something left to simulate.
  ok(/CLV\.data\.format !== 'royale'/.test(code), "it does not run on a Standard league");
  ok(/alive\.length < 2/.test(code), "…nor on a finished one");
}

/* ============ 8. the diagnostics panel stopped lying ====================
   ⚠️ This panel said "No closing prices are captured yet" in three places and printed
   TBD for every player. That was true the day it was written and false the day the
   capture shipped — the worst kind of stale copy, because it is a confident factual
   claim about the system's own state that nothing forces to stay true. */
{
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
  ok(!/No closing prices are captured yet/.test(code),
     "the panel no longer claims closes are never captured");
  ok(!/<span class="tbd">TBD<\/span>/.test(code),
     "…and no longer prints a blanket TBD for every player's CLV");

  // Three states, and the two that are NOT a number matter most: zero would be a claim
  // that the market did not move, and a raw-implied number would be wrong by the hold.
  ok(/awaiting close/.test(code), "a leg whose game has not started reads 'awaiting close'");
  ok(/one side/.test(code) && /can't be de-vigged/.test(code),
     "a close with only one side captured says so, rather than being de-vigged against nothing");
  ok(/closeUnavailableReason/.test(code) && /no close/.test(code),
     "a leg the capture could not match reads 'no close' and carries the reason");
  ok(/clvup|clvdn/.test(code) && !/class="px \$\{v>=0\?'pos'/.test(code),
     "the CLV cell uses its own classes — .pos is already the reel position label");
  ok(/Worst CLV is measured on/.test(code),
     "the lever flag counts how many legs it can actually measure instead of claiming none");
}

/* ============ 9. the belt ============================================== */
{
  const code = page.replace(/<!--[\s\S]*?-->/g, "");
  // ⚠️ Declared ONCE. Two copies of an 8 KB data URI in one file is duplication that
  // will eventually disagree with itself — a new belt in one place, the old one in the
  // other, with nothing to notice.
  ok((page.match(/data:image\/jpeg;base64/g) || []).length === 1,
     "the belt image is inlined exactly once and referenced by variable");
  ok(/--belt:url\(/.test(code), "…as a CSS custom property");
  ok(/\.beltcrest\{/.test(code) && /\.verdict \.belttrophy\{/.test(code),
     "both the season crest and the verdict trophy read that one variable");

  // ⚠️ Inline, not assets/. sw.js caches by a hash of the HTML, so an external image
  // sits outside that hash and can go stale independently of the page referencing it.
  ok(!/src="assets\/bozo-belt/.test(code), "the belt is not an external file");

  /* ⚠️ The belt goes to the CURRENT holder — the most recent bozo — not to whoever has
     worn it most. Those are different people the moment someone else gets named, and
     `.fund` (max count) already occupies the second meaning. */
  ok(/const holder = bzNow \|\| \(hist\.length/.test(code),
     "the holder is this week's bozo, falling back to the last one named");
  ok(/data-belt="\$\{holds\?1:0\}"/.test(code), "the holder's row is marked");
  ok(/\[data-belt="1"\] \.nm2::after\{display:none\}/.test(code),
     "…and the red nose is suppressed there, since holding it already implies having worn one");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
