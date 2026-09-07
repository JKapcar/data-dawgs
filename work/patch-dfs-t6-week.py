#!/usr/bin/env python3
"""Phase 0.5 T6 — inline week object + refresh receipts/standings; wire Lock week + Toto.

Run from repo root:
    python3 work/patch-dfs-t6-week.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "dfs.html"
page = PAGE.read_text(encoding="utf-8")

stand = (ROOT / "work/dfs-standings-ingest.js").read_text(encoding="utf-8")
receipts = (ROOT / "work/dfs-receipts.js").read_text(encoding="utf-8")
week = (ROOT / "work/dfs-week.js").read_text(encoding="utf-8")

# --- replace Phase 1 standings block ---
s0 = page.find("/* ---- Standings ingest (Phase 1 — source: work/dfs-standings-ingest.js) ---- */")
s1 = page.find("/* ---- Contest presets (Phase 1 — source: work/dfs-contest-presets.js) ---- */")
assert s0 >= 0 and s1 > s0, "standings anchors missing"
stand_block = (
    "/* ---- Standings ingest (Phase 1 — source: work/dfs-standings-ingest.js) ---- */\n"
    + stand + "\n\n"
)
page = page[:s0] + stand_block + page[s1:]

# --- replace receipts + insert week module before screener ---
r0 = page.find("/* ---- Receipts grades (Phase 1 — source: work/dfs-receipts.js) ---- */")
r1 = page.find("/* ---- Contest screener (Phase 1 — source: work/dfs-contest-screener.js) ---- */")
assert r0 >= 0 and r1 > r0, "receipts anchors missing"
recv_block = (
    "/* ---- Receipts grades (Phase 1 — source: work/dfs-receipts.js) ---- */\n"
    + receipts + "\n\n"
    + "/* ---- Week object (Phase 0.5 T6 — source: work/dfs-week.js) ---- */\n"
    + week + "\n\n"
)
page = page[:r0] + recv_block + page[r1:]

# --- DEF: add weeks ---
if "weeks: {}" not in page and "weeks:{}" not in page:
    page = page.replace(
        '  sheet: "slate"\n};',
        '  sheet: "slate",\n  weeks: {},\n  week: 1,\n  season: 2026\n};',
        1,
    )

# --- Lock week button next to Export ---
if 'id="lockWeek"' not in page:
    page = page.replace(
        '<button class="btn ghost sm" id="exportCsv">Export DraftKings CSV</button>',
        '<button class="btn ghost sm" id="exportCsv">Export DraftKings CSV</button>\n'
        '      <button class="btn ghost sm" id="lockWeek">Lock week</button>\n'
        '      <button class="btn ghost sm" id="downloadWeekReceipt" hidden>Download week receipt (.json)</button>',
        1,
    )

# --- exportCsv: also build/store week object after successful export ---
OLD_EXPORT_END = """  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (missing) banner("solveWarn", "warn", `<b>${missing} slot${missing === 1 ? "" : "s"} had no DraftKings player ID</b> and were written as names instead. That happens with the demo slate or a hand-built pool; a real salary export always carries IDs.`);
}"""

NEW_EXPORT_END = """  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  S.exportedAt = new Date().toISOString();
  save();
  if (missing) banner("solveWarn", "warn", `<b>${missing} slot${missing === 1 ? "" : "s"} had no DraftKings player ID</b> and were written as names instead. That happens with the demo slate or a hand-built pool; a real salary export always carries IDs.`);
  // Week-object path: export also locks expectations when DDFSWeek is present.
  if (typeof DDFSWeek !== "undefined") {
    try { lockWeek({ quiet: true }); } catch (e) { /* lock is best-effort on export */ }
  }
}"""

if OLD_EXPORT_END in page and "lockWeek({ quiet: true })" not in page:
    page = page.replace(OLD_EXPORT_END, NEW_EXPORT_END, 1)

# --- inject lockWeek + download helpers before Toto section ---
if "async function lockWeek" not in page and "function lockWeek" not in page:
    lock_fn = r'''
/* ---------------------------------------------------------------- week object (T6) */
async function lockWeek(opts) {
  opts = opts || {};
  if (typeof DDFSWeek === "undefined" || typeof DDFSReceipts === "undefined") {
    if (!opts.quiet) banner("solveWarn", "err", "<b>Week module missing.</b> Reload.");
    return null;
  }
  if (!S.lineups || !S.lineups.length) {
    if (!opts.quiet) banner("solveWarn", "err", "<b>No lineups to lock.</b> Build a set first.");
    return null;
  }
  const contests = (S.contests && S.contests.length) ? S.contests
    : (S.screener || []).filter(c => c && (c.id || c.contestKey)).map(c => ({
        id: c.id || c.contestKey, name: c.name || c.contestName || "", buyIn: c.buyIn, entryCap: c.entryCap, fieldCap: c.fieldCap, preset: c.presetKey || c.preset
      }));
  // Ensure week/season on S for the builder
  if (S.week == null && $("stWeek")) S.week = parseInt($("stWeek").value, 10) || 1;
  let weekObj = DDFSWeek.build(S, SIM, contests);
  weekObj = await DDFSWeek.stampLockedSha256Async(weekObj);
  DDFSWeek.storeInState(S, weekObj);
  save();
  const btn = $("downloadWeekReceipt");
  if (btn) btn.hidden = false;
  if (!opts.quiet) {
    banner("solveWarn", "ok",
      `<b>Week ${weekObj.week} locked.</b> sha ${esc((weekObj.lockedSha256 || "").slice(0, 8))}… · realized:null until Monday ingest. ` +
      `Download the week receipt to publish later.`);
  }
  botContext();
  return weekObj;
}

function downloadWeekReceipt() {
  const cur = S.weeksCurrent != null ? S.weeksCurrent : S.week;
  const w = S.weeks && S.weeks[cur];
  if (!w) {
    banner("solveWarn", "err", "<b>No locked week</b> on this device yet.");
    return;
  }
  const blob = new Blob([JSON.stringify(w, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dd-dfs-week-${w.season}-W${w.week}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

'''
    anchor = "/* ---------------------------------------------------------------- Toto */"
    assert anchor in page, "Toto anchor missing"
    page = page.replace(anchor, lock_fn + anchor, 1)

# --- wire click handlers ---
if 'lockWeek").addEventListener' not in page and "$(\"lockWeek\")" not in page:
    page = page.replace(
        '$("exportCsv").addEventListener("click", exportCsv);',
        '$("exportCsv").addEventListener("click", exportCsv);\n'
        '  if ($("lockWeek")) $("lockWeek").addEventListener("click", () => { lockWeek({}); });\n'
        '  if ($("downloadWeekReceipt")) $("downloadWeekReceipt").addEventListener("click", downloadWeekReceipt);',
        1,
    )

# --- standings ingest: apply week realized ---
OLD_ST_SAVE = """    const saved = await DDFSStandings.saveLocal(rec);
    banner("stWarn", "ok", `<b>Saved ${rec.n} entries</b> for week ${esc(String(rec.week || "—"))} · key <code>${esc(rec.contestKey)}</code> (${esc(saved.storage)}). On-device only (I3).`);"""

# Find a stable fragment around standings save
if "applyWeekRealized" not in page:
    needle = "DDFSStandings.saveLocal(rec)"
    idx = page.find(needle)
    assert idx > 0, "saveLocal call missing"
    # Insert after the saveLocal await line
    # Find end of that statement
    semi = page.find(";", idx)
    insert = (
        "\n    if (S.weeks && typeof DDFSStandings.applyWeekRealized === \"function\") {\n"
        "      const applied = DDFSStandings.applyWeekRealized(S.weeks, rec);\n"
        "      if (applied.updated) { save(); botContext(); }\n"
        "    }"
    )
    page = page[: semi + 1] + insert + page[semi + 1 :]

# --- Toto ctx: prepend week-object report ---
OLD_CTX_START = """    ctx: () => {
      const L = [];
      L.push(`SHEET ON SCREEN: ${S.sheet}.`);"""

NEW_CTX_START = """    ctx: () => {
      const L = [];
      if (typeof DDFSWeek !== "undefined") L.push(DDFSWeek.totoReport(S));
      L.push(`SHEET ON SCREEN: ${S.sheet}.`);"""

if "DDFSWeek.totoReport" not in page:
    assert OLD_CTX_START in page, "Toto ctx anchor missing"
    page = page.replace(OLD_CTX_START, NEW_CTX_START, 1)

# Soften "NO RECEIPTS" once week-object path exists
page = page.replace(
    "- ⚠️ There are NO RECEIPTS. Nothing here has been run forward against a declared benchmark. If asked whether it beats anything, the answer is that nobody knows yet.",
    "- ⚠️ Week-object receipts (T6) lock expectations before kickoff (lockedSha256; realized:null until Monday ingest). PoC C1–C5 already hashed. Until realized weeks accumulate, do not claim a graded edge.",
    1,
)

PAGE.write_text(page, encoding="utf-8", newline="\n")
print("dfs.html T6 patch applied")
