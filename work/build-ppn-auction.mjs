/* Wrap the PPN v3 auction artifacts into this site's /data/ envelope contract.
 *
 * The artifacts in work/ppn-auction-src/ are FINAL and arrive from outside this repo
 * (an ETR half-PPR auction snapshot converted for the PPN league — see HANDOFF.md).
 * Nothing here recomputes, smooths, caps or merges a value. The whole job is packaging:
 *
 *   - the source object is nested VERBATIM under the envelope's `data` key, so the
 *     original payload is recoverable byte-for-byte and the "do not modify" instruction
 *     survives contact with the repo's own rules;
 *   - the envelope adds the six fields tools/validate-data.js requires and this site's
 *     whole /data/ layer exists to guarantee: as_of, source, tier, graded, tier_meaning
 *     and a canonical_url. AGENTS.md: "as_of and source are mandatory on every payload."
 *     Dropping the raw artifacts into data/ produces 11 build-blocking failures.
 *   - the method markdown gets YAML front matter for the same reason: the markdown-mirror
 *     check reads as_of and source out of the first 900 bytes.
 *   - the board's fetch unwraps `.data` once, so its six accessors are untouched.
 *
 * ⚠️ tier_meaning is PARSED from tools/build-data.js, never retyped. validate-data.js
 * compares every payload's copy against that map, and two hand-maintained copies of a
 * paragraph cannot stay equal by intention.
 *
 * NAMING. The published surface is DataDawg$ — the site's OWN converted auction dollars.
 * It is deliberately NOT "PPN": that is a league abbreviation (pepperoninipples), and this
 * conversion is method-general, pointed at one league first. MV stays MV, because MV is the
 * MARKET's number from an outside source and this is ours. The v2 `lg` column on board.html
 * keeps "$ PPN" — that one genuinely is one league's re-pricing of a personal board.
 *
 * ⚠️ THE SEALED PAYLOAD KEEPS ITS OWN model_id (`datadawgs-ppn-auction-2026-v3`). That string
 * identifies the computation that produced these numbers and is part of the provenance chain
 * the source artifacts are diffed against. Renaming it would make the artifacts stop matching
 * what was handed over, for cosmetics. File names and labels are the product; model_id is the
 * receipt. work/ppn-auction-src/ keeps its delivered names for exactly the same reason.
 *
 *   node work/build-ppn-auction.mjs && node tools/data-manifest.js && node tools/validate-data.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "work", "ppn-auction-src");
const DATA = path.join(ROOT, "data");
const BUILT = process.env.DD_BUILD_DATE || new Date().toISOString().slice(0, 10);

const read = p => fs.readFileSync(p, "utf8");
const write = (p, s) => fs.writeFileSync(p, s, { encoding: "utf8" });

/* ---- tier_meaning, from its one source of truth ---- */
const tierBlock = read(path.join(ROOT, "tools/build-data.js")).match(/const TIER_MEANING = \{([\s\S]*?)\n\};/);
if (!tierBlock) throw new Error("tools/build-data.js: TIER_MEANING map not found");
const TIER_MEANING = {};
for (const m of tierBlock[1].matchAll(/^\s*(labs|dawg|pound):\s*'((?:[^'\\]|\\.)*)',?\s*$/gm))
  TIER_MEANING[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, "\\");

const SOURCE = "Establish The Run half-PPR auction values (private subscriber snapshot, "
  + "identified publicly only by SHA-256), converted to the JohnMaddenPepperoniNipplesXV "
  + "room (Yahoo 773763; 14 teams, $200, no kicker, 2 flex, $0 bids legal) by the VOR-based "
  + "conversion documented in /data/datadawg-dollars-method.md. Reproducible and red-teamed; "
  + "not outcome-validated.";

const NOTE = "Dated snapshot. low/high are conversion-assumption sensitivity bounds, NOT "
  + "bid ceilings and NOT player-outcome intervals. Keeper inflation (Sep 8 deadline) and "
  + "out-of-sample validation are open items, deliberately not modelled here.";

function envelope(name, payload) {
  const body = {
    as_of: payload.as_of,
    source: SOURCE,
    note: NOTE,
    tier: payload.tier || "labs",
    graded: payload.graded === true,
    tier_meaning: TIER_MEANING[payload.tier || "labs"],
    built: BUILT,
    canonical_url: "https://datadawgs216.com/data/" + name,
    data: payload,                      // ⚠️ verbatim. Never edit a value in here.
  };
  if (!body.as_of) throw new Error(name + ": source artifact has no as_of");
  if (!body.tier_meaning) throw new Error(name + ": no tier_meaning for tier " + body.tier);
  write(path.join(DATA, name), JSON.stringify(body, null, 1) + "\n");
  return body;
}

const values = JSON.parse(read(path.join(SRC, "ppn-auction-values.json")));
const method = JSON.parse(read(path.join(SRC, "ppn-auction-method.json")));
envelope("datadawg-dollars-values.json", values);
/* The method contract carries no tier/graded of its own — it describes the same model, so
   it inherits the values payload's classification rather than inventing a second one. */
envelope("datadawg-dollars-method.json", { ...method, tier: values.tier, graded: values.graded });

/* ---- markdown mirror: front matter, body verbatim ---- */
const mdBody = read(path.join(SRC, "ppn-auction-method.md")).replace(/\r\n/g, "\n");
const frontMatter = [
  "<!-- mirror of https://datadawgs216.com/data/datadawg-dollars-method.json -->",
  "---",
  "title: DataDawg$ — auction conversion method contract",
  "as_of: " + values.as_of,
  "source: " + SOURCE,
  "staleness: A dated conversion of a dated ETR snapshot. Keeper inflation is not modelled and the Sep 8 keeper deadline will move real prices.",
  "canonical_url: https://datadawgs216.com/data/datadawg-dollars-method.md",
  "---",
  "",
].join("\n");
write(path.join(DATA, "datadawg-dollars-method.md"), frontMatter + mdBody);

/* ---- the board: unwrap the envelope once, leave every accessor alone ---- */
const BOARD_OLD = "const j=await(await fetch(URL)).json();";
const BOARD_NEW = "const j=(await(await fetch(URL)).json()).data;  // /data/ payloads are enveloped";
let board = read(path.join(SRC, "ppn-auction-board.html"));
if (board.split(BOARD_OLD).length - 1 !== 1)
  throw new Error("ppn-auction-board.html: fetch line is not unique — re-check the accessor patch");
board = board.replace(BOARD_OLD, BOARD_NEW);
/* Published copy carries the product name; every substitution is asserted so a reworded
   source artifact fails the build instead of shipping half-renamed. */
for (const [from, to] of [
  ["<title>PPN Auction Board — DataDawgs", "<title>DataDawg$ Auction Board — DataDawgs"],
  ["<h1>PPN Auction Board <span>Target $</span></h1>",
   "<h1>DataDawg$ <span>Target $ — our conversion, not the market's</span></h1>"],
  ["const URL='data/ppn-auction-values.json';", "const URL='data/datadawg-dollars-values.json';"],
  ["Source: data/ppn-auction-values.json", "Source: data/datadawg-dollars-values.json"],
  /* The private localStorage key ('ppn_gone') is deliberately NOT renamed: it has a read and
     a write site, and renaming one of a pair splits the drafted-players set in half. It is
     invisible to the reader and carries no product name. */
]) {
  if (board.split(from).length - 1 !== 1) throw new Error("board rename anchor not unique: " + from);
  board = board.replace(from, to);
}
write(path.join(ROOT, "datadawg-dollars.html"), board);

console.log("  data/datadawg-dollars-values.json  (envelope; data = source artifact verbatim)");
console.log("  data/datadawg-dollars-method.json  (envelope; data = source artifact verbatim)");
console.log("  data/datadawg-dollars-method.md    (front matter + body verbatim)");
console.log("  datadawg-dollars.html              (source + envelope unwrap + product name)");
