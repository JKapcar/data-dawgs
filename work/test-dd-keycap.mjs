/* Regression: Sleeper's ~3,200-player universe must fit the Worker's 700-key limit. */
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "fantasy-warroom.html"), "utf8");
const lift = (n, kind = "function") => {
  const at = src.indexOf(kind + " " + n + "(");
  if (at < 0) throw new Error(n + " not found");
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) { i++; break; } }
  return src.slice(at, i);
};
let pass = 0, fail = 0;
const ok = (n, c) => c ? pass++ : (fail++, console.log("  FAIL " + n));

const fn = lift("ddFromWorker", "async function");
const block = fn.slice(fn.indexOf("const DD_MAX_KEYS"), fn.indexOf("if(!keys.length)return null;"));
const pick = (pool, teams) => new Function("pool", "teams", "ddKey",
  block + " return keys;")(pool, teams, (p) => (p && p.k) || null);
const P = (k, p = 0) => ({ k, p });
const roster = (ks) => ({ players: ks.map(k => P(k)) });

{
  const rostered = Array.from({ length: 374 }, (_, i) => "r" + i);
  const teams = []; for (let i = 0; i < 12; i++) teams.push(roster(rostered.slice(i * 31, (i + 1) * 31)));
  const pool = [...rostered.map((k, i) => P(k, 100 - i)), ...Array.from({ length: 2838 }, (_, i) => P("x" + i, 50 - i / 100))];
  const keys = pick(pool, teams);
  ok("never exceeds the Worker's limit", keys.length <= 700);
  ok("a real Sleeper pool no longer 413s", pool.length > 700 && keys.length === 700);
  const held = new Set(teams.flatMap(t => t.players.map(p => p.k)));
  ok("every rostered player survives the cut", [...held].every(k => keys.includes(k)));
}
{
  const teams = [roster(["star", "bench"])];
  const pool = [...Array.from({ length: 800 }, (_, i) => P("pool" + i, 1000 - i)), P("star", 5), P("bench", 1)];
  const keys = pick(pool, teams);
  ok("rostered players beat higher-projected free agents", keys.includes("star") && keys.includes("bench"));
  ok("the pool tail is dropped", keys.length === 700 && !keys.includes("pool799"));
  ok("remaining budget uses projection order", keys.includes("pool0"));
}
{
  ok("no teams, no crash", pick([P("a", 1)], []).length === 1);
  ok("empty pool and roster yields nothing", pick([], []).length === 0);
  ok("duplicate roster entries dedupe", pick([P("a", 1)], [roster(["a", "a"])]).length === 1);
  ok("duplicate free-agent entries dedupe", pick([P("a", 2), P("a", 1)], []).length === 1);
}
ok("a refusal is logged", /\[DataDawg\$\] \/dd\/values/.test(src));
ok("the cap is stated where enforced", /const DD_MAX_KEYS=700;/.test(src));
ok("loadDD supplies the target league's teams", /ddFromWorker\(prov,st\.ref\.id,st\.pool,'dynasty',st\.teams\)/.test(src)
  && /ddFromWorker\(prov,st\.ref\.id,st\.pool,'season',st\.teams\)/.test(src));
console.log(`\npass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
