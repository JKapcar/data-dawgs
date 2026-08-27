/* Invariants for the pepperoninipples league values and the board profile.

   These run on the BAKED pages, not the builder, so they hold whether or not the builder
   was just run — a half-applied bake (one file updated, the other stale) is exactly the
   failure mode this suite exists to catch, because the dashboard's Toto context and the
   cheat sheet would quietly quote different dollars for the same player.

       node work/test-ppn-values.mjs
*/
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok  ", name); }
  else { fail++; console.log("  FAIL", name, detail == null ? "" : " — " + detail); }
};

function pool(file, marker) {
  const s = fs.readFileSync(ROOT + "/" + file, "utf8");
  const i = s.indexOf(marker);
  return { arr: JSON.parse(s.slice(i + marker.length - 1, s.indexOf("];", i) + 1)), src: s };
}
const B = pool("board.html", "const SEED = [");
const D = pool("dashboard.html", "window.DD_POOL = [");

ok("every player carries lg in the board pool", B.arr.every(r => typeof r.lg === "number"));
ok("every player carries lg in the dashboard pool", D.arr.every(r => typeof r.lg === "number"));
ok("the two pools agree on every lg value",
  B.arr.length === D.arr.length && B.arr.every((r, i) => r.lg === D.arr[i].lg && r.name === D.arr[i].name));
ok("no NaN, no negatives", B.arr.every(r => Number.isFinite(r.lg) && r.lg >= 0));
// ⚠️ this league has NO kicker slot — a kicker with a price would be a lie on the sheet
ok("every kicker is $0", B.arr.filter(r => r.pos === "K").every(r => r.lg === 0));
ok("DSTs are priced (the league starts one)",
  B.arr.filter(r => r.pos === "DST" && r.lg > 0).length >= 10);
const sum = B.arr.reduce((a, r) => a + r.lg, 0);
ok("the pool sums to the room's real budget (14 x $200)", Math.abs(sum - 2800) <= 5, sum.toFixed(0));
const top = B.arr.slice().sort((a, b) => b.lg - a.lg);
ok("a real player tops the board", top[0].lg > 60 && top[0].pos !== "K", top[0].name);
// the scoring sheet punishes QBs (-2.5 INT, incompletions); a QB1 priced like an RB1 would
// mean the ratio didn't fire
const topQB = top.find(r => r.pos === "QB");
ok("QBs are discounted relative to the top of the board", topQB && topQB.lg < 0.5 * top[0].lg,
  topQB && `${topQB.name} $${topQB.lg} vs ${top[0].name} $${top[0].lg}`);

/* ---- the profile gating: only pepperoninipples sees any of this ---------- */
const s = B.src;
ok("profile is gated on the URL param", s.includes('get("league")==="pepperoninipples"'));
ok("kicker rows are filtered only under the profile", s.includes('LGP && r.pos==="K"'));
ok("the bold column follows the profile", s.includes('LGP ? "lg" :'));
ok("card CSS knows the lg column", s.includes("td[data-c=lg]") && s.includes('content:" PPN"'));
ok("the intro names the method without naming a vendor",
  s.includes("value-over-replacement ratio") && !/ETR/i.test(
    s.slice(s.indexOf("Priced for <b>this league</b>"), s.indexOf("Priced for <b>this league</b>") + 1400)));
ok("the intro admits the holes", s.includes("sacks taken") && s.includes("kickers are $0"));

console.log(`\nppn-values: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
