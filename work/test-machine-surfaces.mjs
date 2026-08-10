/* llms.txt and sitemap.xml, graded against the registry rather than against a human's memory.
   Run:  node work/test-machine-surfaces.mjs        (from the REPO ROOT)

   ⚠️ WHY THIS SUITE EXISTS. On 2026-08-09 the live llms.txt carried two false claims at
   once: "26 live read-only MCP tools" when surfaces.json listed 42, and "No CFB MCP tool is
   callable" when sixteen of them were in tools_live. Nothing caught either, because llms.txt
   is prose and prose does not get asserted. A confidently stale number is the exact failure
   this site is built to argue against, so the fix is not "be careful when editing llms.txt",
   it is "make llms.txt fail a test when it disagrees with the registry".

   The counts here are DERIVED from data/surfaces.json, never typed in. If a Worker deploy
   promotes the staged tool, surfaces.json moves, and this suite tells you llms.txt now lies
   — which is the whole point. Do not fix a failure here by editing the expectation.
*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log("  FAIL " + name + (extra ? "  — " + extra : "")); }
};

const surfaces = JSON.parse(read("data/surfaces.json"));
const llms = read("llms.txt");
const sitemap = read("sitemap.xml");

/* ---------- llms.txt agrees with the registry ---------- */

const counts = surfaces.counts;
const live = surfaces.mcp.tools_live;
const staged = surfaces.mcp.tools_staged;

ok("surfaces.json is internally consistent: tools_live length matches its own count",
   live.length === counts.mcp_tools_live, `${live.length} vs ${counts.mcp_tools_live}`);
ok("surfaces.json is internally consistent: tools_staged length matches its own count",
   staged.length === counts.mcp_tools_staged, `${staged.length} vs ${counts.mcp_tools_staged}`);
ok("surfaces.json is internally consistent: live + staged = registered",
   live.length + staged.length === counts.mcp_tools_registered,
   `${live.length}+${staged.length} vs ${counts.mcp_tools_registered}`);

/* Every integer that appears in llms.txt next to the words "live" and "MCP tools" must be
   the real live count. Scanning for the NUMBER rather than for one fixed sentence means a
   rewording of the prose cannot smuggle a stale figure back in. */
const liveClaims = [...llms.matchAll(/(\d+)\s+live[^.\n]{0,60}?MCP tools/gi)].map(m => +m[1]);
ok("llms.txt states a live MCP tool count at all", liveClaims.length > 0);
ok("every live-MCP-tool count in llms.txt equals the registry",
   liveClaims.every(n => n === counts.mcp_tools_live),
   `claims ${JSON.stringify(liveClaims)} vs registry ${counts.mcp_tools_live}`);

const registeredClaims = [...llms.matchAll(/(\d+)\s+registered/gi)].map(m => +m[1]);
ok("every registered count in llms.txt equals the registry",
   registeredClaims.every(n => n === counts.mcp_tools_registered),
   `claims ${JSON.stringify(registeredClaims)} vs registry ${counts.mcp_tools_registered}`);

/* ---------- llms.txt agrees with the receipt LEDGER, not just the tool registry ----------
   ⚠️ WHY THIS BLOCK EXISTS. The three checks above guard MCP tool counts and nothing else.
   On 2026-08-10 Stage MS appended two DDPR lines to data/model-receipts.json, taking it from
   544 rows to 1,088, and llms.txt went on telling every crawler "544 append-only prospective
   forecasts across nfelo and 538 Classic" — a false count AND a false model list. All 19
   assertions in this suite stayed green. That is the exact failure this file was written to
   make impossible, one payload over from where it was first caught.
   Read the ledger itself rather than surfaces.json: the number is only in surfaces.json as
   prose inside a `covers` string, and grading prose against prose proves nothing. */
const LEDGER = JSON.parse(read("data/model-receipts.json"));
const ledgerRows = LEDGER.data.length;
const ledgerModels = [...new Set(LEDGER.data.map(r => r.model_id))];

/* Match the number with or without thousands separators, so reformatting 1088 as 1,088
   cannot make the claim invisible to this check. */
const rowClaims = [...llms.matchAll(/([\d,]+)\s+append-only prospective forecasts/gi)]
  .map(m => +m[1].replace(/,/g, ""));
ok("llms.txt states a receipt-ledger row count at all", rowClaims.length > 0,
   "no 'N append-only prospective forecasts' claim found");
ok("every receipt-ledger row count in llms.txt equals the ledger",
   rowClaims.every(n => n === ledgerRows),
   `claims ${JSON.stringify(rowClaims)} vs ledger ${ledgerRows}`);

const modelLineClaims = [...llms.matchAll(/([\d,]+)\s+model lines/gi)]
  .map(m => +m[1].replace(/,/g, ""));
ok("llms.txt states how many model lines the ledger carries", modelLineClaims.length > 0,
   "no 'N model lines' claim found");
ok("every model-line count in llms.txt equals the ledger",
   modelLineClaims.every(n => n === ledgerModels.length),
   `claims ${JSON.stringify(modelLineClaims)} vs ledger ${ledgerModels.length} (${ledgerModels})`);

/* ⚠️ NOT a count check. Three of the four lines are functions of nfelo, so a reader told
   "4 model lines" and nothing else is told there is more independent evidence here than
   there is. The independence figure is measured in data/ddpr-nfl.json from prospective
   forecasts alone, and llms.txt has to carry it. */
const DDPR = JSON.parse(read("data/ddpr-nfl.json"));
const independentSources = DDPR.data.input_model_ids.length;
const independentClaims = [...llms.matchAll(/([\d,]+)\s+independent/gi)]
  .map(m => +m[1].replace(/,/g, ""));
ok("llms.txt does not let the model-line count imply independent evidence",
   independentClaims.length > 0 && independentClaims.every(n => n === independentSources),
   `claims ${JSON.stringify(independentClaims)} vs ${independentSources} independent inputs`);
ok("the ledger carries strictly more model lines than independent sources, so the claim matters",
   ledgerModels.length > independentSources,
   `${ledgerModels.length} lines vs ${independentSources} sources`);

/* Staged is not live. If anything is staged, llms.txt has to say so by name, or a reader is
   told 43 tools exist and left to discover that one of them does not answer. */
if (staged.length) {
  ok("llms.txt names the staged tool rather than implying it is callable",
     staged.every(t => llms.includes(t)), `missing ${staged.filter(t => !llms.includes(t))}`);
  ok("llms.txt uses the word staged", /\bSTAGED\b|\bstaged\b/.test(llms));
}

/* The CFB claim. Sixteen dd_*cfb* tools are in tools_live, so llms.txt must not deny them. */
const cfbLive = live.filter(t => /cfb/i.test(t));
ok("registry actually carries CFB tools (guards the next assertion)", cfbLive.length > 0,
   `${cfbLive.length}`);
ok("llms.txt does not claim CFB tools are uncallable while they are live",
   !/no cfb mcp tool is callable/i.test(llms));
const cfbNumWords = { 16: /sixteen|\b16\b/i };
if (cfbNumWords[cfbLive.length]) {
  ok("llms.txt states the CFB tool count correctly",
     cfbNumWords[cfbLive.length].test(llms), `expected ${cfbLive.length}`);
}

/* ---------- sitemap.xml covers the pages that actually exist ---------- */

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const htmlLocs = locs.filter(u => u.endsWith(".html")).map(u => u.split("/").pop());

/* index.html is listed as the bare origin, by design — do not require the filename. */
ok("sitemap lists the site root", locs.some(u => /datadawgs216\.com\/$/.test(u)));

/* A redirect stub is not a destination. survivor-settings.html is a meta-refresh to
   survivor.html#settings; listing it invites a crawler to index a page with no content. */
const stubs = pages.filter(p => {
  const s = read(p);
  return s.length < 4000 && /http-equiv=["']refresh["']/i.test(s);
});
ok("redirect stubs are not in the sitemap",
   stubs.every(p => !htmlLocs.includes(p)), `stub(s) listed: ${stubs.filter(p => htmlLocs.includes(p))}`);

/* Deliberately unlinked operator pages stay out; everything else a person can reach
   should be findable. auction and bigboard are unlinked on purpose (see AGENTS.md). */
const UNLINKED = new Set(["auction.html", "bigboard.html"]);
const shouldList = pages.filter(p => p !== "index.html" && !UNLINKED.has(p) && !stubs.includes(p));
const missing = shouldList.filter(p => !htmlLocs.includes(p));
ok("every reachable page is in the sitemap", missing.length === 0, `missing: ${missing}`);

const ghost = htmlLocs.filter(p => !pages.includes(p));
ok("the sitemap lists no page that does not exist", ghost.length === 0, `ghosts: ${ghost}`);

ok("sitemap has no duplicate entries", new Set(locs).size === locs.length);

/* Every /data/ URL the sitemap advertises must be a file the validator knows about. */
const dataLocs = locs.filter(u => u.includes("/data/")).map(u => u.split("/data/")[1]);
const dataFiles = new Set(fs.readdirSync(path.join(ROOT, "data")));
const badData = dataLocs.filter(f => !dataFiles.has(f));
ok("every /data/ URL in the sitemap exists on disk", badData.length === 0, `${badData}`);

/* ---------- llms.txt links resolve ----------
   ⚠️ Match BOTH the absolute and the relative form. llms.txt shrank under the 5 KB budget on
   8/9 by dropping the repeated origin, and a regex that only knew the absolute form would
   have matched nothing and passed VACUOUSLY on an empty array — a green light meaning "I
   checked no links". The two counts below exist to make that failure loud instead. */
const llmsData = [...llms.matchAll(/(?:datadawgs216\.com)?\/data\/([A-Za-z0-9._-]+)/g)].map(m => m[1]);
ok("the /data/ link check actually found links to check", llmsData.length >= 10,
   `found ${llmsData.length}`);
const badLinks = [...new Set(llmsData)].filter(f => !dataFiles.has(f));
ok("every /data/ file llms.txt links to exists", badLinks.length === 0, `${badLinks}`);

const llmsPages = [...llms.matchAll(/(?:datadawgs216\.com)?\/([A-Za-z0-9._-]+\.html)/g)].map(m => m[1]);
ok("the page-link check actually found links to check", llmsPages.length >= 1,
   `found ${llmsPages.length}`);
const badPages = [...new Set(llmsPages)].filter(f => !pages.includes(f));
ok("every page llms.txt links to exists", badPages.length === 0, `${badPages}`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
