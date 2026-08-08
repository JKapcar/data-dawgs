/* Keep survivor.html's solver byte-for-byte aligned with the shared source.
 * Run from work/: node sync-survivor-path.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const SOURCE = "survivor-path-engine.js";
const TARGET = "../survivor.html";
const START = "/* ===== DD-SURVIVOR-PATH-ENGINE START — generated from work/survivor-path-engine.js; edit THERE ===== */";
const END = "/* ===== DD-SURVIVOR-PATH-ENGINE END ===== */";

const engine = readFileSync(SOURCE, "utf8").replace(/\s+$/, "");
let html = readFileSync(TARGET, "utf8");
const start = html.indexOf(START), end = html.indexOf(END);
if (start < 0 || end < start) fail("survivor path markers missing or reversed");
if (html.indexOf(START, start + START.length) >= 0 || html.indexOf(END, end + END.length) >= 0)
  fail("survivor path markers must appear exactly once");

const replacement = START + "\n" + engine + "\n" + END;
const out = html.slice(0, start) + replacement + html.slice(end + END.length);
writeFileSync(TARGET, out);

if (out.slice(start, start + replacement.length) !== replacement) fail("sync verification failed");
console.log(`synced ${SOURCE} into ${TARGET}`);

function fail(message) { console.error("SYNC FAILED: " + message); process.exit(1); }
