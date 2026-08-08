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

// Inject the exact browser/Node DFS engine, but give its universal wrapper a private
// root inside this module. The source remains work/dfs-engine.js; the Worker does not
// carry a hand-maintained fork that can silently disagree with the human page.
const engineSuffix =
  '})(typeof module !== "undefined" && module.exports ? module.exports : (typeof self !== "undefined" ? self : this));';
const engineSource = readFileSync("dfs-engine.js", "utf8").replace(/\s+$/, "");
if (!engineSource.endsWith(engineSuffix)) fail("dfs-engine.js wrapper changed — update the explicit Worker-root transform");
const engine = "const mcpDdfsRoot = {};\n" +
  engineSource.slice(0, -engineSuffix.length) + "})(mcpDdfsRoot);";
const mcp = readFileSync("mcp-block.js", "utf8").replace(/\s+$/, "");
const block =
  "/* Shared DFS engine — generated verbatim from work/dfs-engine.js except for its private root. */\n" +
  engine + "\n\n" + mcp;
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
once("async function handleMcp", "handleMcp definition");
once("async function mcpDispatch", "mcpDispatch definition");
once("DD-MCP-ROUTE", "injected route");
once("export default", "worker default export");

// The read-only invariant, enforced by the build rather than by memory.
const blockOnly = out.slice(out.indexOf(START));
for (const banned of ["fbPut(", "fbPatch(", "fbDelete("]) {
  if (blockOnly.includes(banned)) fail(`the MCP block calls ${banned} — read-only invariant broken`);
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
console.log("  shared DFS source · single declarations · parses · idempotent · no write calls in the block");

function fail(msg) { console.error("BUILD FAILED: " + msg); process.exit(1); }
