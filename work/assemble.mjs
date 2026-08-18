/* Rebuild ../dawg-bot-worker.js from its hand-written half plus work/mcp-block.js.
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

let src = readFileSync(TARGET, "utf8");
const before = src;

/* ---- 1. strip any previously injected block ---- */
const s = src.indexOf(START), e = src.indexOf(END);
if (s >= 0 && e > s) {
  src = src.slice(0, s) + src.slice(e + END.length);
} else {
  // Legacy: assembled before markers existed. The block ran from this header to EOF.
  const legacy = src.indexOf("/* ================================== /mcp ================================== */");
  if (legacy >= 0) src = src.slice(0, legacy);
}

/* ---- 2. strip any previously injected route (marked or legacy) ---- */
src = src
  .split("\n")
  .filter((line, i, all) => {
    if (line.includes("DD-MCP-ROUTE")) return false;
    if (/if \(url\.pathname === "\/mcp"/.test(line)) return false;
    // the legacy one-line comment that used to sit above the route
    if (/\/\/ \/mcp is matched before ANY Origin-gated handler/.test(line)) return false;
    return true;
  })
  .join("\n");

const stripped = src;
if (stripped.includes("handleMcp"))
  fail("strip left a handleMcp reference behind — the markers did not cover everything");

/* ---- 3. inject ---- */
if (!src.includes(ANCHOR)) fail("route anchor not found in " + TARGET);
if (src.split(ANCHOR).length - 1 !== 1) fail("route anchor is ambiguous — appears more than once");
src = src.replace(ANCHOR, ANCHOR + "\n" + ROUTE);

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
const out = src.replace(/\s+$/, "") + "\n\n" + START + "\n" + block + "\n" + END + "\n";

/* ---- 4. prove it before writing ---- */
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

/* ---- 4b. every registered tool carries its full annotation set ----
 * ⚠️ A tool added without a title, catalog and readOnlyHint would list with an undefined
 * title, would fall out of BOTH catalogs (mcpCatalogTools filters core on t.catalog), and
 * would make tools/list disagree with the coverage map that tools/build-data.js derives
 * from this same file. Counting is enough to catch it and costs nothing.
 */
const count = re => (blockOnly.match(re) || []).length;
// Both tool families: dd_* reads the league, sd_* reads and writes the signed-in
// athlete's training log. A prefix-specific count would silently stop guarding the
// moment a second family was added, which is exactly what happened when sd_* landed.
const nTools = count(/\n    name: "(?:dd|sd)_\w+",\n/g);
for (const [what, n] of [["title", count(/\n    title: "[^"]+",\n/g)],
                         ["catalog", count(/\n    catalog: "(?:core|full)",\n/g)],
                         ["readOnlyHint", count(/\n    readOnlyHint: (?:true|false),\n/g)]]) {
  if (n !== nTools) fail(`${nTools} tools declared but ${n} carry a ${what} — run work/patch-mcp-annotations.py`);
}
if (nTools === 0) fail("no tools found in the block — the registry regex has drifted");
// Every write tool is named here, and nothing else may declare readOnlyHint: false.
// This started as "exactly one, and it must be dd_submit_bozo_leg" — the guard's real
// point was never the number, it was that a write tool cannot appear by accident. SwoleDawg
// (2026-08-18) added a second family that writes the signed-in athlete's own training log,
// so the check becomes an explicit ALLOWLIST rather than a count: a write tool that is not
// on this list still fails the build, and a name on this list that no longer exists fails
// it too, so the list cannot rot into a rubber stamp.
const WRITE_TOOLS = [
  "dd_submit_bozo_leg",   // league: own Bozo leg, two-phase, spec'd in claude/data-dawgs-cep-identity.md §4
  "sd_start_session",     // SwoleDawg: all five write the caller's OWN log, gated on caller.kind === "user"
  "sd_log_set",
  "sd_log_sets",
  "sd_finish_session",
  "sd_log_measurement",
  "sd_log_nutrition",
];
const writeHints = count(/\n    readOnlyHint: false,\n/g);
if (writeHints !== WRITE_TOOLS.length)
  fail(`${writeHints} tools declare readOnlyHint: false but ${WRITE_TOOLS.length} are allowlisted — add it to WRITE_TOOLS in assemble.mjs, on purpose, or make it read-only`);
for (const name of WRITE_TOOLS) {
  const at = blockOnly.indexOf(`name: "${name}"`);
  if (at < 0) fail(`WRITE_TOOLS lists ${name} but no such tool is in the block — remove it rather than leaving a stale allowance`);
  if (!/readOnlyHint: false/.test(blockOnly.slice(at, at + 700)))
    fail(`${name} is allowlisted as a write tool but does not declare readOnlyHint: false`);
}
// ⚠️ The block must not touch D1 directly either. Every SwoleDawg read and write goes
// through the swole* layer in the hand-written half of the Worker, so there is exactly one
// implementation of what a valid write is and exactly one place the uid filter can be
// forgotten. A .prepare( in here would be a second one.
if (/\.prepare\(/.test(blockOnly))
  fail("the MCP block calls .prepare( — D1 access belongs in the swole* layer, not in a tool body");
// Every sd_* tool is personal data, so every one of them must gate on caller identity.
for (const m of blockOnly.matchAll(/\n    name: "(sd_\w+)",\n/g)) {
  const at = blockOnly.indexOf(`name: "${m[1]}"`);
  const body = blockOnly.slice(at, blockOnly.indexOf('\n  },', at));
  if (!body.includes('caller.kind !== "user"'))
    fail(`${m[1]} does not gate on caller.kind === "user" — a training log call with no identity is unattributable`);
}

writeFileSync(TARGET, out);
try {
  execFileSync(process.execPath, ["--check", TARGET], { stdio: "pipe" });
} catch (err) {
  writeFileSync(TARGET, before);           // put it back; never leave a broken worker on disk
  fail("assembled worker does not parse (reverted):\n" + String(err.stderr || err));
}

/* ---- 5. prove idempotency: assembling the output again must be a no-op ---- */
const secondPass = (() => {
  const a = readFileSync(TARGET, "utf8");
  const s2 = a.indexOf(START), e2 = a.indexOf(END);
  let t = a.slice(0, s2) + a.slice(e2 + END.length);
  t = t.split("\n").filter(l => !l.includes("DD-MCP-ROUTE") && !/if \(url\.pathname === "\/mcp"/.test(l)).join("\n");
  t = t.replace(ANCHOR, ANCHOR + "\n" + ROUTE);
  return t.replace(/\s+$/, "") + "\n\n" + START + "\n" + block + "\n" + END + "\n";
})();
if (secondPass !== out) fail("build is not idempotent — a second run would change the file");

console.log(`assembled ${TARGET}: ${out.split("\n").length} lines, ${(out.length / 1024).toFixed(1)} KB`);
console.log("  shared DFS + survivor sources · single declarations · parses · idempotent · write scope pinned to dd_submit_bozo_leg → commitBozoLeg ×1");

function fail(msg) { console.error("BUILD FAILED: " + msg); process.exit(1); }
