/* Last Dawg Standing — DataDawg$ roster value. Lifts the shipped helpers so the test
   cannot drift. Invented names only; the repo is public. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "guillotine.html"), "utf8");
const lift = (name) => {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error(name + " not found in guillotine.html");
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
};
let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));
const ddKeyOf = new Function(lift("ddKeyOf") + "; return ddKeyOf;")();

/* key shape must match the Worker's ddPlayerKey and the war room's ddKey */
ok("player keys by normalised name", ddKeyOf("Ada Lovelace", "RB", "DET") === "name:ada lovelace");
ok("suffix stripped", ddKeyOf("Katherine Johnson Jr.", "WR", "KC") === "name:katherine johnson");
ok("punctuation stripped", ddKeyOf("Ja'Marr O'Neil", "WR", "CIN") === "name:jamarr oneil");
ok("DST keys by team, not name", ddKeyOf("Ravens", "DST", "BAL") === "dst:BAL");
ok("DEF is treated as DST", ddKeyOf("Ravens", "DEF", "BAL") === "dst:BAL");
ok("DST with no team is unkeyable", ddKeyOf("Ravens", "DST", "") === null);
ok("empty name is unkeyable", ddKeyOf("", "RB", "DET") === null);
ok("Kenneth uses the Worker's explicit alias", ddKeyOf("Kenneth Gainwell", "RB", "PHI") === "name:kenny gainwell");
ok("Cameron uses the Worker's explicit alias", ddKeyOf("Cameron Ward", "QB", "TEN") === "name:cam ward");
ok("Sleeper JAC defense uses the Worker's team alias", ddKeyOf("Jaguars", "DEF", "JAC") === "dst:JAX");

/* structural guarantees of the patch */
ok("card exists on the Money sheet", /id="gxDdCard"/.test(src));
ok("card is hidden until it has data", /id="gxDdCard" style="display:none"/.test(src));
ok("team objects keep player ids", /pids:\(r\.players\|\|\[\]\)\.slice\(\)/.test(src));
ok("renderDd is awaited in the sync path", /await renderDd\(league, teams, faabBudget\)/.test(src));
ok("session header is sent", /X-Bozo-Session/.test(src.slice(src.indexOf("async function renderDd"))));
{
  const fn = src.slice(src.indexOf("async function renderDd"), src.indexOf("/* ------------------------------ Waiver value"));
  ok("signed-out returns null before any fetch",
     /var tok=[^\n]*\n\s*if\(!tok\|\|!teams\|\|!teams\.length\) return null;/.test(fn));
  ok("posts to /dd/values, never asks for a board", fn.includes("/dd/values") && !/dd\/board/.test(fn));
  ok("caps the key list", /keys\.slice\(0,\s*700\)/.test(fn));
  ok("survival caveat is in the note, not just the docstring",
     /not a survival tool/i.test(fn) && /weekly floor/i.test(fn));
  ok("labels it private, dated and ungraded", /ungraded/.test(fn) && /meta\.as_of/.test(fn));
  ok("reports unrostered pool value", /Value unrostered/.test(fn));
}
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
