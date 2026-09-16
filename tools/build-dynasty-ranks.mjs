import fs from "node:fs";

const [input, output = "data/dynasty-ranks.json", asOf = "2026-08-15"] = process.argv.slice(2);
if (!input) throw new Error("usage: node tools/build-dynasty-ranks.mjs <input.csv> [output.json] [as_of YYYY-MM-DD]");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("as_of must be YYYY-MM-DD");

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
// The export's header wording has drifted between pulls ("Position"/"Pos", "1QB Rank"/"1QB Rk",
// "1QBAuction"/"1QB Auction"); accept every spelling seen so far. Draft-pick rows carry no age.
const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k]; return ""; };
const rows = parseCsv(fs.readFileSync(input, "utf8")).map(r => ({
  name: r.Player,
  team: r.Team,
  pos: pick(r, "Position", "Pos"),
  age: pick(r, "Age") === "" ? 0 : num(r.Age),
  status: r.Status,
  one_qb_rank: num(pick(r, "1QB Rank", "1QB Rk")),
  sf_te_premium_rank: num(pick(r, "SF/TE Prem", "SF/TE Prem Rk")),
  one_qb_pos_rank: pick(r, "1QB Pos Rk", "1QB PosRk"),
  sf_te_premium_pos_rank: pick(r, "SF/TE Pr Pos Rk", "SF/TE Pr PosRk"),
  one_qb_auction: money(pick(r, "1QBAuction", "1QB Auction")),
  two_qb_auction: money(pick(r, "2QBAuction", "2QB Auction")),
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
  as_of: asOf,
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
