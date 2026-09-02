/* Rebuild ../dawg-bot-worker.js from its hand-written half plus the generated blocks.
 *
 * ⚠️ THIS BUILD IS IDEMPOTENT AND MUST STAY THAT WAY.
 * The first version read ../dawg-bot-worker.js as a "base" and appended the block.
 * But the committed worker IS the assembled output — it already contains the block —
 * so a second run appended a second copy and produced `SyntaxError: Identifier
 * 'MCP_PROTOS' has already been declared`. A build that corrupts its own input on the
 * second run is a trap that fires the moment anyone touches the Worker again.
 *
 * So: strip first, then inject. Boundaries are CONTENT MARKERS, never line numbers —
 * the same rule the site build follows, for the same reason. The legacy fallback
 * handles the one-time case where the committed file predates the markers.
 *
 * ⚠️ THE STRIP-AND-INJECT PIPELINE LIVES IN ONE FUNCTION, `transform()`, AND IS CALLED
 * TWICE: once to build, once to prove that assembling the output again changes nothing.
 * It used to be written out twice — the build inline, the idempotency proof a hand-copied
 * echo of it. Two blocks to inject would have meant two hand-copies to keep in sync, and
 * a proof that has drifted from the thing it proves is worse than no proof at all.
 *
 * Run:  cd work && node assemble.mjs        (writes ../dawg-bot-worker.js in place)
 */
import { readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";

const TARGET = "../dawg-bot-worker.js";
const START = "/* ===== DD-MCP-BLOCK START — generated from work/mcp-block.js; edit THERE ===== */";
const END   = "/* ===== DD-MCP-BLOCK END ===== */";
const ROUTE =
  '    // DD-MCP-ROUTE — matched before ANY Origin-gated handler; see the block at the bottom.\n' +
  '    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return handleMcp(request, url, env);';
const ANCHOR = "    const url = new URL(request.url);";

/* The Dog Track's capture half. Injected ABOVE the MCP block, on purpose — see the
 * ordering assertion further down, which explains why putting it below would trip the
 * MCP block's write-scope guard for a reason that has nothing to do with this feature. */
const R_START = "/* ===== DD-RANKINGS-BLOCK START — generated from work/rankings-block.js; edit THERE ===== */";
const R_END   = "/* ===== DD-RANKINGS-BLOCK END ===== */";
const R_ROUTE =
  '    // DD-RANKINGS-ROUTE — The Dog Track capture half; see the DD-RANKINGS-BLOCK below.\n' +
  '    if (url.pathname.startsWith("/rankings/")) return handleRankings(request, url, env, cors);';
const R_ANCHOR = '    if (url.pathname.startsWith("/api/swoledawg")) return handleSwole(request, url, env, cors);';

/* Yahoo's public-league HTML adapter. Its parser remains a separately tested source file,
 * while yahoo-worker.js owns fetches, caching, refusals, and route handling. */
const Y_START = "/* ===== DD-YAHOO-BLOCK START — generated from work/yahoo-parse.js + work/yahoo-worker.js; edit THERE ===== */";
const Y_END   = "/* ===== DD-YAHOO-BLOCK END ===== */";
const Y_ROUTE =
  '    // DD-YAHOO-ROUTE — public share read first; every other Yahoo route is session-gated in handleYahoo.\n' +
  '    if (url.pathname.startsWith("/yahoo/share/") && request.method === "GET") return handleYahooShareRead(request, url, env, cors);\n' +
  '    if (url.pathname === "/yahoo" || url.pathname.startsWith("/yahoo/")) return handleYahoo(request, url, env, cors);';
const Y_ANCHOR = '    if (url.pathname === "/espn" || url.pathname.startsWith("/espn/")) return handleEspn(request, url, env, cors);';

let src = readFileSync(TARGET, "utf8");
const before = src;

// Inject the exact browser/Node engines, but give each universal wrapper a private
// root inside this module. The Worker never carries hand-maintained solver forks.
const engineSuffix =
  '})(typeof module !== "undefined" && module.exports ? module.exports : (typeof self !== "undefined" ? self : this));';
const privateEngine = (file, root) => {
  const source = readFileSync(file, "utf8").replace(/\s+$/, "");
  if (!source.endsWith(engineSuffix)) fail(file + " wrapper changed — update the explicit Worker-root transform");
  return "const " + root + " = {};\n" + source.slice(0, -engineSuffix.length) + "})(" + root + ");";
};
const dfsEngine = privateEngine("dfs-engine.js", "mcpDdfsRoot");
const survivorEngine = privateEngine("survivor-path-engine.js", "mcpSurvivorPathRoot");
const mcp = readFileSync("mcp-block.js", "utf8").replace(/\s+$/, "");
const block =
  "/* Shared DFS engine — generated verbatim from work/dfs-engine.js except for its private root. */\n" +
  dfsEngine + "\n\n" +
  "/* Shared survivor path engine — generated verbatim from work/survivor-path-engine.js except for its private root. */\n" +
  survivorEngine + "\n\n" + mcp;
/* The capture half and the grading half are separate files so each stays reviewable, and
 * one block so there is one marker pair to reason about. Order matters only for reading:
 * capture first, then the grading engine that consumes what it captured. */
const rankings = readFileSync("rankings-block.js", "utf8").replace(/\s+$/, "")
  + "\n" + readFileSync("rankings-grade.js", "utf8").replace(/\s+$/, "");
const yahoo = readFileSync("yahoo-parse.js", "utf8").replace(/\s+$/, "")
  + "\n\n" + readFileSync("yahoo-worker.js", "utf8").replace(/\s+$/, "");

/* ---- the whole pipeline, so the build and its idempotency proof cannot diverge ---- */
function transform(input) {
  let t = input;

  /* 1. strip any previously injected MCP block */
  const s = t.indexOf(START), e = t.indexOf(END);
  if (s >= 0 && e > s) {
    t = t.slice(0, s) + t.slice(e + END.length);
  } else {
    // Legacy: assembled before markers existed. The block ran from this header to EOF.
    const legacy = t.indexOf("/* ================================== /mcp ================================== */");
    if (legacy >= 0) t = t.slice(0, legacy);
  }

  /* 2. strip any previously injected rankings block */
  const rs = t.indexOf(R_START), re = t.indexOf(R_END);
  if (rs >= 0 && re > rs) t = t.slice(0, rs) + t.slice(re + R_END.length);

  /* 3. strip any previously injected Yahoo block */
  const ys = t.indexOf(Y_START), ye = t.indexOf(Y_END);
  if (ys >= 0 && ye > ys) t = t.slice(0, ys) + t.slice(ye + Y_END.length);

  /* 4. strip any previously injected route (marked or legacy) */
  t = t
    .split("\n")
    .filter(line => {
      if (line.includes("DD-MCP-ROUTE")) return false;
      if (/if \(url\.pathname === "\/mcp"/.test(line)) return false;
      // the legacy one-line comment that used to sit above the route
      if (/\/\/ \/mcp is matched before ANY Origin-gated handler/.test(line)) return false;
      if (line.includes("DD-RANKINGS-ROUTE")) return false;
      if (/if \(url\.pathname\.startsWith\("\/rankings\/"\)\)/.test(line)) return false;
      if (line.includes("DD-YAHOO-ROUTE")) return false;
      if (/if \(url\.pathname\.startsWith\("\/yahoo\/share\/"\)/.test(line)) return false;
      if (/if \(url\.pathname === "\/yahoo"/.test(line)) return false;
      return true;
    })
    .join("\n");

  /* 5. nothing generated may survive the strip */
  if (t.includes("handleMcp"))
    fail("strip left a handleMcp reference behind — the markers did not cover everything");
  if (t.includes("handleRankings"))
    fail("strip left a handleRankings reference behind — the markers did not cover everything");
  if (t.includes("handleYahoo"))
    fail("strip left a handleYahoo reference behind — the markers did not cover everything");

  /* 6. inject the routes. Each anchor must appear EXACTLY once: an anchor that has drifted
   * into two places would put a live route somewhere nobody is looking, which is the same
   * failure the sitewide nav edits guard with assert s.count(old) == 1. */
  for (const [anchor, what] of [[ANCHOR, "MCP route anchor"], [R_ANCHOR, "rankings route anchor"],
                                [Y_ANCHOR, "Yahoo route anchor"]]) {
    if (!t.includes(anchor)) fail(what + " not found in " + TARGET);
    if (t.split(anchor).length - 1 !== 1) fail(what + " is ambiguous — appears more than once");
  }
  t = t.replace(ANCHOR, ANCHOR + "\n" + ROUTE);
  t = t.replace(R_ANCHOR, R_ANCHOR + "\n" + R_ROUTE);
  t = t.replace(Y_ANCHOR, Y_ANCHOR + "\n" + Y_ROUTE);

  /* 7. inject the blocks, Yahoo and rankings before MCP's write-scope boundary */
  return t.replace(/\s+$/, "")
    + "\n\n" + Y_START + "\n" + yahoo + "\n" + Y_END
    + "\n\n" + R_START + "\n" + rankings + "\n" + R_END
    + "\n\n" + START + "\n" + block + "\n" + END + "\n";
}

const out = transform(src);

/* ---- prove it before writing ---- */
const once = (needle, what) => {
  const n = out.split(needle).length - 1;
  if (n !== 1) fail(`${what}: expected exactly 1, found ${n}`);
};
once("const MCP_PROTOS", "MCP_PROTOS declaration");
once("const MCP_TOOLS", "MCP_TOOLS declaration");
once("const mcpDdfsRoot", "private DFS engine root");
once("function solveLineups", "shared DFS solver");
once("const mcpSurvivorPathRoot", "private survivor path engine root");
once("function solvePath", "shared survivor path solver");
once("async function handleMcp", "handleMcp definition");
once("async function mcpDispatch", "mcpDispatch definition");
once("DD-MCP-ROUTE", "injected route");
once("export default", "worker default export");
once(R_START, "rankings block start marker");
once(R_END, "rankings block end marker");
once("DD-RANKINGS-ROUTE", "injected rankings route");
once("async function handleRankings", "handleRankings definition");
once("async function rankingsSnapshot", "rankingsSnapshot definition");
once("const RANKINGS_DEPTHS", "RANKINGS_DEPTHS declaration");
once("function rankingsNormName", "shared name-normalization spec");
once("async function rankingsGrade(", "rankingsGrade definition");
once("async function rankingsGrades(", "public rankingsGrades definition");
once("function rankingsMidRanks", "mid-rank helper");
once("function rankingsWeightedTau", "weighted Kendall tau");
once("const RANKINGS_BOOTSTRAP_DRAWS", "bootstrap draw count");
once("const RANKINGS_G ", "capture-rate group sizes");
once(Y_START, "Yahoo block start marker");
once(Y_END, "Yahoo block end marker");
once("DD-YAHOO-ROUTE", "injected Yahoo route");
once("async function handleYahoo(", "handleYahoo definition");
once("async function handleYahooShareRead(", "Yahoo public share handler");
once("async function yahooWarroomFeed(", "Yahoo War Room feed");
once("function yahooParseSettings(", "Yahoo settings parser");

/* ⚠️ ORDERING IS LOAD-BEARING, NOT COSMETIC.
 * The write-scope invariant below scans from the MCP START marker to end of file. The
 * rankings block is a capture ledger and legitimately calls fbPut/fbPost, so if it ever
 * slid below that marker it would fail a guard written about a completely different
 * concern — and the obvious "fix" would be to weaken the guard. Assert the order instead. */
if (!(out.indexOf(Y_START) < out.indexOf(R_START) && out.indexOf(R_START) < out.indexOf(START)))
  fail("the Yahoo and rankings blocks must be injected ABOVE the MCP block — see the write-scope invariant");

// The write-scope invariant, enforced by the build rather than by memory.
// History: this block was fully read-only until dd_submit_bozo_leg (2026-08-13), the
// deliberately-added two-phase write tool spec'd in claude/data-dawgs-cep-identity.md §4.
// The invariant did not get weaker, it got precise:
//   - the block still NEVER calls a Firebase write helper directly;
//   - the only route to a Firebase write is commitBozoLeg — the same single write path
//     bozoPick uses — and the block may call it EXACTLY once, inside the confirm branch;
//   - KV writes (env.RL.put) exist only for rate limits and the mcpconfirm: staging keys.
const blockOnly = out.slice(out.indexOf(START));
for (const banned of ["fbPut(", "fbPatch(", "fbDelete("]) {
  if (blockOnly.includes(banned)) fail(`the MCP block calls ${banned} — no direct Firebase write is ever allowed here`);
}
const commitCalls = (blockOnly.match(/commitBozoLeg\(/g) || []).length;
if (commitCalls !== 1)
  fail(`the MCP block calls commitBozoLeg ${commitCalls} times — exactly 1 is allowed, inside dd_submit_bozo_leg's confirm branch`);

/* ---- the rankings block's own invariant: no public route, and no raw rank in a response ----
 * Stage A adds admin-only routes. The single public read in this feature is
 * GET /rankings/grades (Stage B), which serves derived scores. Until that exists, every
 * handler here must be behind rankingsAdminOk — a handler that forgets it would expose
 * paid third-party ranks, which handoff §1 makes the one unrecoverable mistake.
 */
// Spec §1 makes exactly one route public: GET /rankings/grades, which serves derived
// scores. Everything else in this block reads or writes paid third-party ranks and must be
// admin-gated. This is an explicit ALLOWLIST rather than a count, for the same reason
// WRITE_TOOLS above is: the point is not how many there are, it is that a public route
// cannot appear by accident. A name here that no longer exists fails the build too, so the
// list cannot rot into a rubber stamp.
const RANKINGS_PUBLIC = [
  "rankingsGrades",       // the derived season doc — no player, no rank, no snapshot
];
const RANKINGS_UNGATED_OK = ["handleRankings", "rankingsReadBody"];  // dispatcher + body reader
const rankingsOnly = out.slice(out.indexOf(R_START), out.indexOf(R_END));
for (const name of RANKINGS_PUBLIC) {
  if (!rankingsOnly.includes(`async function ${name}(`))
    fail(`RANKINGS_PUBLIC lists ${name} but no such handler is in the block — remove the stale allowance`);
}
for (const m of rankingsOnly.matchAll(/\nasync function (rankings[A-Za-z]*|handleRankings)\(request/g)) {
  const at = rankingsOnly.indexOf(`async function ${m[1]}(request`);
  const body = rankingsOnly.slice(at, rankingsOnly.indexOf("\n}", at));
  if (body.includes("rankingsAdminOk(request, env)")) continue;
  if (RANKINGS_UNGATED_OK.includes(m[1])) continue;
  if (RANKINGS_PUBLIC.includes(m[1])) continue;
  fail(`${m[1]} does not check rankingsAdminOk and is not in RANKINGS_PUBLIC — add it there, on purpose, or gate it`);
}

writeFileSync(TARGET, out);
try {
  execFileSync(process.execPath, ["--check", TARGET], { stdio: "pipe" });
} catch (err) {
  writeFileSync(TARGET, before);           // put it back; never leave a broken worker on disk
  fail("assembled worker does not parse (reverted):\n" + String(err.stderr || err));
}

/* ---- prove idempotency: assembling the output again must be a no-op ---- */
if (transform(readFileSync(TARGET, "utf8")) !== out)
  fail("build is not idempotent — a second run would change the file");

console.log(`assembled ${TARGET}: ${out.split("\n").length} lines, ${(out.length / 1024).toFixed(1)} KB`);
console.log("  shared DFS + survivor sources · single declarations · parses · idempotent · write scope pinned to dd_submit_bozo_leg → commitBozoLeg ×1");
console.log(`  rankings block above the MCP block · ${RANKINGS_PUBLIC.length} public route (${RANKINGS_PUBLIC.join(", ")}) · all others admin-gated`);
console.log("  Yahoo parser + fetch layer above MCP · public share read isolated · all other routes session-gated");

function fail(msg) { console.error("BUILD FAILED: " + msg); process.exit(1); }
