#!/usr/bin/env python3
"""Stage RI, part 2 — the inventory counts move to BUILD time.

Run AFTER work/patch_receipts_inventory.py.

Part 1 had the inventory sheet fetch all four ledgers plus the audit on show. Because the
inventory is the DEFAULT sheet, that broke the lazy-load contract the receipts page has held
since CEP-5A: `work/test-receipts-sheets.mjs` asserts that at page load NONE of
538-classic.json, cfb-model-receipts.json or tier-audit.json is fetched, and it went red.

That assertion is not a technicality. model-receipts.json is **688 KB**, 538-classic.json is
another 94 KB, and the default sheet would have pulled ~830 KB to print five numbers. The
expectation was right and the implementation was wrong.

So the counts are derived by the BUILDER, from the payloads on disk, and published as one
small file. Three things get better:
  1. the default sheet fetches ~1 KB instead of ~830 KB;
  2. the counts become a GATED fact -- validate-data.js recomputes them from the source
     payloads and fails on drift, which is stronger than a runtime fetch nobody watches;
  3. agents get the inventory as a machine surface for free.

⚠️ ORDERING HAZARD, and why the gate matters: model-receipts.json, 538-classic.json and the
cfb-* files are written by the Python backbones, NOT by build-data.js. If a backbone runs
AFTER build-data.js, the published inventory is stale. Nothing in the build enforces the
order, so the assertion in validate-data.js is the thing that catches it. This is the
tier_meaning lesson applied before it bites: a derived value with no equality check is two
definitions waiting to diverge.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def patch(relpath, pairs):
    p = ROOT / relpath
    src = p.read_text(encoding="utf-8")
    out = src
    for old, new, count in pairs:
        found = out.count(old)
        if found != count:
            sys.exit(f"ANCHOR FAIL {relpath}: expected {count}x, found {found}x:\n  {old[:110]!r}")
        out = out.replace(old, new)
    p.write_text(out, encoding="utf-8", newline="\n")
    print(f"  patched {relpath}")


# ------------------------------------------- 1. the builder writes the inventory
patch("tools/build-data.js", [("/* ---------- index.json (manifest) ----------", """/* ---------- receipts-inventory.json ----------
   Stage RI. The aggregate inventory behind receipts.html#inventory: how much has been
   registered, how much is settled, per ledger. NO SCORE, by design -- there is no honest
   Brier across domains, so this file counts and never grades.

   ⚠️ The ledgers OVERLAP. receipts.json's rows and the nfelo half of model-receipts.json
   are the SAME forecasts; 538-classic.json and the 538-classic half are likewise the same.
   So `aggregate` is computed from the SUPERSET ledger alone and never by summing across
   ledgers. `naive_sum` is published deliberately, as the number a reader would get by
   adding the column up, so the page can name it and correct it rather than hoping nobody
   tries.

   ⚠️ These files are written by the PYTHON BACKBONES, not by this script, so this block
   reads them off disk. If a backbone runs after this script the counts go stale --
   tools/validate-data.js recomputes all of them and fails on drift. Do not remove that
   check and leave this file unguarded. */
const INV_LEDGERS = [
  { file: 'model-receipts.json', id: 'model-receipts', name: 'NFL model receipts', sheet: 'models',
    superset: true, rows: d => d,
    what: 'Append-only prospective forecasts, one row per model per game. This is the superset the others are views of.' },
  { file: 'receipts.json', id: 'receipts', name: 'NFL pre-registered calls', sheet: 'receipts',
    rows: d => d,
    what: 'The locked, SHA-256 hashed nfelo set. The same forecasts as the nfelo half of the ledger above, fixed in place so they cannot be edited after a result.' },
  { file: '538-classic.json', id: '538-classic', name: '538 Classic beliefs', sheet: 'classic',
    rows: d => d.forecasts || [],
    what: 'A deliberately simple Elo benchmark with no QB, injury, weather or market adjustment.' },
  { file: 'cfb-model-receipts.json', id: 'cfb-model-receipts', name: 'CFB model receipts', sheet: 'cfbrec',
    rows: d => d,
    what: 'The college-football contract. Empty by design: no CFB forecast has been frozen before a kickoff yet.' },
];
/* A row is SETTLED when it carries a result. No payload carries one today, so every count
   below is 0 -- but this probes for the field instead of hardcoding a zero, so grading
   starts being counted the day it lands, with no edit here. */
const INV_SETTLED_KEYS = ['resolved_at', 'graded_at', 'outcome', 'result', 'actual', 'final'];
function invSettled(rows) {
  return rows.filter(r => r && typeof r === 'object' &&
    INV_SETTLED_KEYS.some(k => r[k] !== undefined && r[k] !== null && r[k] !== '')).length;
}
function buildInventory() {
  const ledgers = INV_LEDGERS.map(l => {
    const env = JSON.parse(fs.readFileSync(path.join(OUT, l.file), 'utf8'));
    const rows = l.rows(env.data);
    if (!Array.isArray(rows)) throw new Error('inventory: ' + l.file + ' did not yield an array');
    const settled = invSettled(rows);
    return {
      id: l.id, name: l.name, what: l.what, sheet: l.sheet,
      machine: '/data/' + l.file, as_of: env.as_of,
      registered: rows.length, settled, pending: rows.length - settled,
      superset: !!l.superset,
      _rows: rows,
    };
  });
  const sup = ledgers.find(l => l.superset);
  if (!sup) throw new Error('inventory: no ledger is marked the superset');
  const games = new Set(sup._rows.map(r => r.game_id).filter(Boolean)).size;
  const settled = ledgers.reduce((a, l) => a + l.settled, 0);
  const audit = JSON.parse(fs.readFileSync(path.join(OUT, 'tier-audit.json'), 'utf8'));
  return {
    ledgers: ledgers.map(({ _rows, ...l }) => l),
    aggregate: {
      forecasts: sup.registered,
      games,
      settled,
      pending: sup.registered - settled,
      counted_from: sup.machine,
      naive_sum: ledgers.reduce((a, l) => a + l.registered, 0),
    },
    /* Counted apart from every forecast column on purpose: a verdict about our own tools
       is a judgment by one reviewer on one day, has no kickoff, and can never be settled. */
    audit: {
      tools: (audit.data || []).length,
      dawgs: (audit.counts || {}).dawgs || 0,
      outside_the_tier_system: (audit.counts || {}).outside_the_tier_system || 0,
      audited_on: audit.as_of,
      sheet: 'audit',
      machine: '/data/tier-audit.json',
    },
  };
}
write('receipts-inventory.json', {
  as_of: BUILT,
  source: 'Derived at build time by tools/build-data.js from the published receipt ledgers in /data/. Counts only; no grading.',
  tier: 'labs',
  graded: false,
  note: 'An INVENTORY, not a scoreboard. There is no honest Brier across domains, so this file '
      + 'counts what has been registered and settled and never scores it. The ledgers OVERLAP: '
      + 'receipts.json and the nfelo half of model-receipts.json are the same forecasts, as are '
      + '538-classic.json and its half. aggregate is therefore computed from aggregate.counted_from '
      + 'alone; aggregate.naive_sum is what summing the registered column would wrongly give, '
      + 'published so it can be named and corrected rather than quietly reproduced.',
  data: buildInventory(),
});

/* ---------- index.json (manifest) ----------""", 1)])

# ------------------------------- 2. the page reads ONE small file, not five big ones
OLD_LOADER_START = "let invLoaded=false;\n/* Stage RI. Every ledger the site keeps"
p = ROOT / "receipts.html"
src = p.read_text(encoding="utf-8")
i = src.index(OLD_LOADER_START)
j = src.index("let auLoaded=false;\nasync function loadAudit(){", i)
NEW_LOADER = """let invLoaded=false;
/* Stage RI. ONE fetch of ~1 KB. The counts are derived at BUILD time by
   tools/build-data.js and gated by tools/validate-data.js against the source payloads --
   see that file for why a runtime fetch of the ledgers was the wrong answer here
   (model-receipts.json alone is 688 KB, and this is the DEFAULT sheet). */
const invNum=n=>Number(n).toLocaleString("en-US");
async function loadInventory(){
  if(invLoaded)return;invLoaded=true;
  try{
    const env=await mdlJson("/data/receipts-inventory.json");
    const d=env.data||{},led=d.ledgers||[],ag=d.aggregate||{},au=d.audit||{};
    if(!led.length)throw new Error("the inventory published no ledgers");

    mdlEl("invTable").querySelector("tbody").innerHTML=led.map(l=>
      `<tr><td><b>${mdlEsc(l.name)}</b><span class="inv-what">${mdlEsc(l.what)}</span></td>`+
      `<td class="inv-n">${invNum(l.registered)}</td><td class="inv-n">${invNum(l.settled)}</td>`+
      `<td class="inv-n">${invNum(l.pending)}</td>`+
      `<td><a href="#${mdlEsc(l.sheet)}">sheet</a> &middot; `+
      `<a href="${mdlEsc(l.machine)}"><code>${mdlEsc(String(l.machine).replace("/data/",""))}</code></a>`+
      `<span class="inv-what">as of ${mdlEsc(l.as_of||"undated")}</span></td></tr>`).join("");
    mdlEl("invLoad").hidden=true;
    mdlEl("invTable").hidden=false;

    mdlEl("invForecasts").textContent=invNum(ag.forecasts);
    mdlEl("invGames").textContent=invNum(ag.games);
    mdlEl("invResolved").textContent=invNum(ag.settled);
    mdlEl("invPending").textContent=invNum(ag.pending);

    /* ⚠️ The correction that makes the table honest. The builder publishes the wrong
       number on purpose so the page can name it. */
    mdlEl("invOverlap").innerHTML=
      `<b>Do not add the Registered column up.</b> It comes to ${invNum(ag.naive_sum)}, which `+
      `counts the same NFL forecast more than once: the pre-registered calls and the 538 `+
      `Classic beliefs are both views of rows already inside the append-only ledger, not `+
      `extra forecasts alongside it. The honest aggregates are the two on the left &mdash; `+
      `${invNum(ag.forecasts)} distinct forecasts across ${invNum(ag.games)} games &mdash; `+
      `counted from <a href="${mdlEsc(ag.counted_from||"")}"><code>`+
      `${mdlEsc(String(ag.counted_from||"").replace("/data/",""))}</code></a> alone, never `+
      `summed across ledgers.`;

    mdlEl("invAudit").innerHTML=
      `<b>${invNum(au.tools)} tools audited</b> on ${mdlEsc(au.audited_on||"an undated day")}, `+
      `by one reviewer in one day &mdash; a judgment, not a measurement. `+
      `${invNum(au.dawgs)} hold a collar; ${invNum(au.outside_the_tier_system)} sit outside the `+
      `tier system entirely. It is counted here and nowhere else on this sheet, because a `+
      `verdict about our own tools is not a forecast and must never share a column with one. `+
      `<a href="#audit">Read the audit</a>.`;
  }catch(err){
    invLoaded=false;
    mdlEl("invLoad").className="inv-err";
    mdlEl("invLoad").textContent="Inventory unavailable: "+err.message;
    mdlEl("invAudit").textContent="Inventory unavailable: "+err.message;
  }
}
"""
p.write_text(src[:i] + NEW_LOADER + src[j:], encoding="utf-8", newline="\n")
print("  patched receipts.html (loader replaced)")

# loadInventoryAudit is gone -- it is one fetch now
patch("receipts.html", [
    ('onShow(id){ if(id==="inventory"){ loadInventory(); loadInventoryAudit(); }',
     'onShow(id){ if(id==="inventory") loadInventory();', 1),
])

# ------------------------------------ 3. the gate that makes the derivation safe
patch("tools/validate-data.js", [("console.log('\\ntier_meaning matches its source of truth');", """// -------------------------------------------------- the inventory is not stale
// Stage RI, 2026-08-10. receipts-inventory.json is DERIVED from the receipt ledgers, but
// the ledgers it reads are written by scripts/*_backbone.py and scripts/elo_538_classic.py,
// NOT by tools/build-data.js. Nothing in the build enforces that build-data runs last, so
// a backbone run after it silently publishes stale counts. Recompute every number here.
// Same failure shape as tier_meaning's five sources: a derived value with no equality check
// is two definitions waiting to diverge.
console.log('\\nreceipts-inventory.json agrees with the ledgers it counts');
{
  const invPath = path.join(DATA, 'receipts-inventory.json');
  if (!fs.existsSync(invPath)) {
    fail('receipts-inventory.json is missing — receipts.html#inventory renders nothing');
  } else {
    const inv = JSON.parse(fs.readFileSync(invPath, 'utf8')).data || {};
    const KEYS = ['resolved_at', 'graded_at', 'outcome', 'result', 'actual', 'final'];
    const settledOf = rows => rows.filter(r => r && typeof r === 'object' &&
      KEYS.some(k => r[k] !== undefined && r[k] !== null && r[k] !== '')).length;
    const rowsOf = (file, d) => file === '538-classic.json' ? (d.forecasts || []) : d;
    let bad = 0;
    const ledgers = inv.ledgers || [];
    if (!ledgers.length) { fail('receipts-inventory.json publishes no ledgers'); bad++; }
    for (const l of ledgers) {
      const file = String(l.machine || '').replace('/data/', '');
      const p = path.join(DATA, file);
      if (!fs.existsSync(p)) { fail(`receipts-inventory.json counts ${file}, which does not exist`); bad++; continue; }
      const env = JSON.parse(fs.readFileSync(p, 'utf8'));
      const rows = rowsOf(file, env.data);
      if (!Array.isArray(rows)) { fail(`receipts-inventory.json: ${file} did not yield an array`); bad++; continue; }
      const settled = settledOf(rows);
      if (l.registered !== rows.length) {
        fail(`receipts-inventory.json: ${file} registered=${l.registered} but the file holds ${rows.length}`); bad++;
      }
      if (l.settled !== settled) {
        fail(`receipts-inventory.json: ${file} settled=${l.settled} but the file shows ${settled}`); bad++;
      }
      if (l.pending !== rows.length - settled) {
        fail(`receipts-inventory.json: ${file} pending=${l.pending} does not equal registered minus settled`); bad++;
      }
      if (l.as_of !== env.as_of) {
        fail(`receipts-inventory.json: ${file} as_of=${l.as_of} but the file says ${env.as_of}`); bad++;
      }
    }
    // The aggregate must come from ONE superset ledger, never from summing the column.
    const ag = inv.aggregate || {};
    const supFile = String(ag.counted_from || '').replace('/data/', '');
    const supPath = path.join(DATA, supFile);
    if (!supFile || !fs.existsSync(supPath)) {
      fail(`receipts-inventory.json: aggregate.counted_from "${ag.counted_from}" does not exist`); bad++;
    } else {
      const sup = JSON.parse(fs.readFileSync(supPath, 'utf8')).data;
      const games = new Set(sup.map(r => r.game_id).filter(Boolean)).size;
      if (ag.forecasts !== sup.length) {
        fail(`receipts-inventory.json: aggregate.forecasts=${ag.forecasts} but ${supFile} holds ${sup.length}`); bad++;
      }
      if (ag.games !== games) {
        fail(`receipts-inventory.json: aggregate.games=${ag.games} but ${supFile} covers ${games}`); bad++;
      }
      const naive = ledgers.reduce((a, l) => a + l.registered, 0);
      if (ag.naive_sum !== naive) {
        fail(`receipts-inventory.json: aggregate.naive_sum=${ag.naive_sum} but the column sums to ${naive}`); bad++;
      }
      // The whole point of the file: the aggregate must NOT be the column sum.
      if (ledgers.length > 1 && ag.forecasts === naive) {
        fail('receipts-inventory.json: aggregate.forecasts equals the column sum — the overlap was double-counted'); bad++;
      }
    }
    // An inventory that scores is the cross-domain blend the page argues against.
    const txt = fs.readFileSync(invPath, 'utf8');
    for (const w of ['brier', 'accuracy', '"score"']) {
      if (txt.toLowerCase().includes(w) && !txt.toLowerCase().includes('never ' + w)) {
        fail(`receipts-inventory.json mentions ${w} — this file counts, it does not grade`); bad++;
      }
    }
    const au = inv.audit || {};
    const ta = JSON.parse(fs.readFileSync(path.join(DATA, 'tier-audit.json'), 'utf8'));
    if (au.tools !== (ta.data || []).length) {
      fail(`receipts-inventory.json: audit.tools=${au.tools} but tier-audit.json holds ${(ta.data || []).length}`); bad++;
    }
    if (ledgers.some(l => /audit/i.test(l.id || ''))) {
      fail('receipts-inventory.json puts the tier audit in the forecast ledgers — a judgment is not a forecast'); bad++;
    }
    if (!bad) ok(`${ledgers.length} ledgers, the aggregate and the audit all match the files they count`);
  }
}

console.log('\\ntier_meaning matches its source of truth');""", 1)])

print("done")
