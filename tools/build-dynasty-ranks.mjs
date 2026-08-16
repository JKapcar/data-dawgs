import fs from "node:fs";

const [input, output = "data/dynasty-ranks.json"] = process.argv.slice(2);
if (!input) throw new Error("usage: node tools/build-dynasty-ranks.mjs <input.csv> [output.json]");

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted && c === '"' && n === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') { row.push(cell); cell = ""; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); if (row.some(x => x !== "")) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(x => x.replace(/^\uFEFF/, ""));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const money = v => Number(String(v).replace(/[$,]/g, ""));
const num = v => Number(v);
const rows = parseCsv(fs.readFileSync(input, "utf8")).map(r => ({
  name: r.Player,
  team: r.Team,
  pos: r.Position,
  age: num(r.Age),
  status: r.Status,
  one_qb_rank: num(r["1QB Rank"]),
  sf_te_premium_rank: num(r["SF/TE Prem"]),
  one_qb_pos_rank: r["1QB Pos Rk"],
  sf_te_premium_pos_rank: r["SF/TE Pr Pos Rk"],
  one_qb_auction: money(r["1QBAuction"]),
  two_qb_auction: money(r["2QBAuction"]),
  note: r.Notes || ""
}));

if (!rows.length) throw new Error("no dynasty rows parsed");
if (new Set(rows.map(r => r.name.toLowerCase())).size !== rows.length) throw new Error("duplicate player name");
for (const r of rows) for (const k of ["age", "one_qb_rank", "sf_te_premium_rank", "one_qb_auction", "two_qb_auction"])
  if (!Number.isFinite(r[k])) throw new Error(`${r.name}: invalid ${k}`);

const envelope = {
  source_page: "/master.html",
  tier: "labs",
  tier_meaning: "Pup — live and useful, not yet validated. It may compute real answers and still have open questions about calibration, assumptions, data quality or edge. Everything starts here.",
  graded: false,
  as_of: "2026-08-15",
  source: "Independent research ranking supplied by the site owner; no publisher or commercial brand claimed.",
  note: "Dynasty rankings and auction values are analyst estimates, not observed market prices or projections. Tied ranks are preserved from the supplied source.",
  scoring_keys: {
    one_qb_rank: "Overall dynasty rank for a 1QB league",
    sf_te_premium_rank: "Overall dynasty rank for a superflex / TE-premium league",
    one_qb_auction: "Dynasty auction dollars for a 1QB league",
    two_qb_auction: "Dynasty auction dollars for a 2QB / superflex league"
  },
  count: rows.length,
  data: rows
};
fs.writeFileSync(output, JSON.stringify(envelope, null, 1) + "\n");
console.log(`${output}: ${rows.length} dynasty rows`);
