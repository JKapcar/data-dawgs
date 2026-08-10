"""
Stage WC-A, part two — work/test-mcp.mjs follows the registry from 43 tools to 41, the two
retired tools' coverage moves onto the merged tools' `latest-per-team` scope, and the merge
gets the assertions that make it honest.

Also fixes the TWO ASSERTIONS THAT COULD NOT FAIL, recorded in project memory as noticed
and unfixed. `oldLines` read dawg-bot-worker.js and compared it with itself, so
"purely additive: every non-blank old line survives" was true for any input whatsoever.
There is no reference-free way to make that sentence mean something, so it is replaced by
the invariant that was actually worth having: the assembled Worker's tool roster is exactly
the registry's, bounded by the block markers. That is the check that would have caught the
divergence this very stage cleaned up — work/mcp-block.js had said
"(Pup / Dawgs / The DawgHouse)" since Stage TR while the assembled Worker still said
"(Labs / Dawgs / The Pound)", and 343 green assertions never noticed.

Run from the repo root, after patch-cfb-tool-merge.py.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUITE = ROOT / "work" / "test-mcp.mjs"
src = SUITE.read_text(encoding="utf-8")


def apply(text, edits, label):
    for old, new, n in edits:
        found = text.count(old)
        if found != n:
            raise SystemExit(f"ABORT {label}: expected {n}, found {found}: {old[:110]!r}")
        text = text.replace(old, new)
    return text


# ---------------------------------------------------------------------------
# 1. Every call to a retired tool becomes the merged tool at latest-per-team scope.
#    Coverage is preserved exactly: same arguments, same expected rows, same refusals.

for gone, kept in [("dd_find_cfb_latest_games", "dd_find_cfb_team_games"),
                   ("dd_find_cfb_latest_team_periods", "dd_find_cfb_team_periods")]:
    with_args = f'call("{gone}", {{'
    bare = f'call("{gone}")'
    n_args, n_bare = src.count(with_args), src.count(bare)
    if not n_args and not n_bare:
        raise SystemExit(f"ABORT: no calls to {gone} found — has the suite already been patched?")
    src = src.replace(with_args, f'call("{kept}", {{ scope: "latest-per-team",')
    src = src.replace(bare, f'call("{kept}", {{ scope: "latest-per-team" }})')
    print(f"  {gone}: {n_args} argument calls + {n_bare} bare calls rescoped onto {kept}")
    if gone in src.replace(f'"{gone}"', "", src.count(f'"{gone}"')):
        pass

# The multi-line call whose object opens on the next line needs the scope on its own line.
src = apply(src, [
    ('call("dd_find_cfb_team_games", { scope: "latest-per-team",\n    team: "OHIO STATE", conference: "big ten"',
     'call("dd_find_cfb_team_games", {\n    scope: "latest-per-team", team: "OHIO STATE", conference: "big ten"', 1),
    ('call("dd_find_cfb_team_periods", { scope: "latest-per-team",\n    team: "OHIO STATE", division: "fbs"',
     'call("dd_find_cfb_team_periods", {\n    scope: "latest-per-team", team: "OHIO STATE", division: "fbs"', 1),
    ('call("dd_find_cfb_team_periods", { scope: "latest-per-team",\n    sort: "conference-record-desc"\n  }',
     'call("dd_find_cfb_team_periods", {\n    scope: "latest-per-team", sort: "conference-record-desc"\n  }', 1),
], "multi-line rescope")

# The section headers named the tools that no longer exist.
src = apply(src, [
    ("// dd_find_cfb_latest_games: compact bounded cross-team final-game discovery.",
     "// dd_find_cfb_team_games at scope=latest-per-team: compact bounded cross-team\n"
     "// final-game discovery, formerly dd_find_cfb_latest_games.", 1),
    ("// dd_find_cfb_latest_team_periods: compact bounded cross-team discovery whose\n"
     '// "latest" label stays tied to the dated 2025 FBS-involved surface.',
     "// dd_find_cfb_team_periods at scope=latest-per-team: compact bounded cross-team\n"
     '// discovery whose "latest" label stays tied to the dated 2025 FBS-involved surface.\n'
     "// Formerly dd_find_cfb_latest_team_periods.", 1),
], "section headers")

# ---------------------------------------------------------------------------
# 2. The counts.

src = apply(src, [
    ('ok(t.length === 43, "forty-three tools listed in the staged Worker source");',
     'ok(t.length === 41, "forty-one tools listed in the staged Worker source");', 1),
    ('"dd_find_cfb_team_games", "dd_find_cfb_latest_games", "dd_find_cfb_team_periods", '
     '"dd_find_cfb_latest_team_periods", "dd_find_cfb_games"',
     '"dd_find_cfb_team_games", "dd_find_cfb_team_periods", "dd_find_cfb_games"', 1),
    (" * Forty-three schemas cost 10-25k tokens in every conversation that connects.",
     " * Forty-one schemas cost 10-25k tokens in every conversation that connects.", 1),
    ('ok(full.length === 43 && core.length === 16, "full lists 43, core lists 16");',
     'ok(full.length === 41 && core.length === 16, "full lists 41, core lists 16");', 1),
    ('ok(n === 43, `…and gets the default full catalog, not an empty or partial one`, "tools=" + n);',
     'ok(n === 41, `…and gets the default full catalog, not an empty or partial one`, "tools=" + n);', 1),
    ('ok(/16 of 43|43 of 43/.test(j.result.instructions), "…with the honest count for that path");',
     'ok(/16 of 41|41 of 41/.test(j.result.instructions), "…with the honest count for that path");', 1),
    ('ok(tools === 43, "43 tools declared in work/mcp-block.js");',
     'ok(tools === 41, "41 tools declared in work/mcp-block.js");', 1),
], "counts")

# ---------------------------------------------------------------------------
# 3. The merge's own assertions. A scope-invalid parameter must be REFUSED BY NAME.
#    Every one of these is graded by message text, not by isError alone: an error thrown
#    for the wrong reason is indistinguishable from the right one otherwise.

MERGE_TESTS = '''
/* ------------- the merged CFB find surfaces: scope is a real boundary -------------
 * ⚠️ WHY THESE EXIST. `dd_find_cfb_team_games` and `dd_find_cfb_team_periods` each cover
 * a parent surface and its derived cross-sectional view behind one flat schema, which
 * means a caller can pass a parameter the chosen scope does not support. IGNORING IT
 * WOULD BE THE DISHONEST FAILURE: the caller gets a plausible answer to a question it did
 * not ask, and nothing in the response says so. Every assertion below reads the error
 * MESSAGE, because an error thrown for some other reason would satisfy isError just as
 * well and prove nothing.
 */
{
  const msg = async (tool, args) => {
    const j = await (await req(call(tool, args))).json();
    if (!j.result || j.result.isError !== true) return "(no error)";
    return j.result.content[0].text;
  };

  // the retired names are gone from the wire, not merely undocumented
  for (const gone of ["dd_find_cfb_latest_games", "dd_find_cfb_latest_team_periods"]) {
    const j = await (await req(call(gone))).json();
    ok(/Unknown tool/.test((j.error && j.error.message) || (j.result && j.result.content[0].text) || ""),
       gone + " is not callable — the consolidation removed the name, it did not alias it");
  }

  // team is required for the default scope and optional for the derived one, and the
  // error says which is which rather than "team must be a non-empty name or slug"
  const noTeam = await msg("dd_find_cfb_team_games", {});
  ok(/team is required when scope is team-games/.test(noTeam) && /latest-per-team/.test(noTeam),
     "the conditional team requirement is enforced with an error that names both scopes", noTeam);
  const noTeamPeriods = await msg("dd_find_cfb_team_periods", {});
  ok(/team is required when scope is team-periods/.test(noTeamPeriods),
     "…and the same holds for the period surface", noTeamPeriods);

  // a parameter belonging to the other scope is refused BY NAME, naming the scope
  const wrongWay = await msg("dd_find_cfb_team_games", { scope: "latest-per-team", opponent: "Georgia" });
  ok(/unsupported field for scope latest-per-team: opponent/.test(wrongWay),
     "a parent-scope parameter is refused by name under the derived scope", wrongWay);
  const otherWay = await msg("dd_find_cfb_team_games", { team: "Ohio State", conference: "Big Ten" });
  ok(/unsupported field for scope team-games: conference/.test(otherWay),
     "…and a derived-scope parameter is refused by name under the parent scope", otherWay);
  const periodWrongWay = await msg("dd_find_cfb_team_periods", { team: "Ohio State", period_outcome: "positive" });
  ok(/unsupported field for scope team-periods: period_outcome/.test(periodWrongWay),
     "the period surface refuses period_outcome outside latest-per-team", periodWrongWay);
  const plural = await msg("dd_find_cfb_team_games", { team: "Ohio State", conference: "Big Ten", offset: 1 });
  ok(/unsupported fields for scope team-games: conference, offset/.test(plural),
     "…and two of them are refused together, both named", plural);

  // the sort enum is the union of both scopes, so a value must be checked against the
  // scope and not merely against the enum
  const crossSort = await msg("dd_find_cfb_team_games", { team: "Ohio State", sort: "team-asc" });
  ok(/sort must be kickoff-asc or kickoff-desc/.test(crossSort),
     "a sort value from the other scope is refused even though the schema enum allows it", crossSort);
  const crossSortBack = await msg("dd_find_cfb_team_games", { scope: "latest-per-team", sort: "kickoff-asc" });
  ok(/sort must be team-asc or kickoff-desc/.test(crossSortBack),
     "…in both directions", crossSortBack);
  const crossPeriodSort = await msg("dd_find_cfb_team_periods", { team: "Ohio State", sort: "conference-record-desc" });
  ok(/sort must be period-asc or period-desc/.test(crossPeriodSort),
     "…and on the period surface too", crossPeriodSort);

  // ⚠️ THE PER-SCOPE LIMIT CEILING SURVIVED THE MERGE. The schema advertises the union
  // maximum of 50; team-periods still refuses 26, because that bound is a payload bound
  // and raising it silently would be a behaviour change disguised as a refactor.
  const tightLimit = await msg("dd_find_cfb_team_periods", { team: "Ohio State", limit: 26 });
  ok(/limit must be a whole number from 1 through 25/.test(tightLimit),
     "team-periods keeps its 25 ceiling under the union schema maximum of 50", tightLimit);
  {
    const j = await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team", limit: 26 }))).json();
    ok(!j.result.isError, "…while latest-per-team accepts 26, so the ceiling is per-scope and not global");
  }

  // an invented scope is refused, and names what is available
  const badScope = await msg("dd_find_cfb_team_games", { scope: "everything" });
  ok(/scope must be team-games or latest-per-team/.test(badScope), "an invented scope is refused", badScope);

  // both scopes declare which shape came back, so a consumer branches on a stated field
  // instead of probing for a key
  {
    const parent = text(await (await req(call("dd_find_cfb_team_games", { team: "Ohio State" }))).json());
    ok(parent.query.scope === "team-games" && parent.response_shape === "team-game-rows" &&
       Array.isArray(parent.games) && !("rows" in parent),
       "the parent scope echoes its scope and declares the team-game shape");
    const derived = text(await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team" }))).json());
    ok(derived.query.scope === "latest-per-team" && derived.response_shape === "latest-per-team-rows" &&
       Array.isArray(derived.rows) && !("games" in derived),
       "the derived scope echoes its scope and declares the latest-per-team shape");
    // ⚠️ the top-level `scope` field is the DATA SURFACE's coverage string and predates
    // the parameter. If the parameter had been echoed there it would have overwritten a
    // published honesty claim, so the two must not be the same field.
    ok(parent.scope !== parent.query.scope && typeof parent.scope === "string",
       "the top-level scope still carries the data surface's coverage string, not the argument");
    const derivedPeriods = text(await (await req(call("dd_find_cfb_team_periods", { scope: "latest-per-team" }))).json());
    ok(derivedPeriods.response_shape === "latest-per-team-rows" && derivedPeriods.query.scope === "latest-per-team",
       "the period surface declares its shape the same way");
  }

  // the per-scope DEFAULTS differ, and the default must follow the scope
  {
    const parent = text(await (await req(call("dd_find_cfb_team_games", { team: "Ohio State" }))).json());
    ok(parent.query.sort === "kickoff-asc" && parent.query.limit === 25,
       "the parent scope keeps its own sort and limit defaults");
    const derived = text(await (await req(call("dd_find_cfb_team_games", { scope: "latest-per-team" }))).json());
    ok(derived.query.sort === "team-asc" && derived.query.offset === 0,
       "the derived scope keeps its own sort default and its pagination");
    const parentPeriods = text(await (await req(call("dd_find_cfb_team_periods", { team: "Ohio State" }))).json());
    ok(parentPeriods.query.sort === "period-asc" && parentPeriods.query.limit === 20,
       "the period parent scope defaults to period-asc and a limit of 20, not the union's 25");
  }

  // the merged descriptions have to name the scopes, or a model cannot discover them
  {
    const listed = (await (await req(rpc("tools/list"))).json()).result.tools;
    for (const name of ["dd_find_cfb_team_games", "dd_find_cfb_team_periods"]) {
      const tool = listed.find(x => x.name === name);
      ok(/scope=latest-per-team/.test(tool.description) && /refused by name rather than ignored/.test(tool.description),
         name + " tells a caller the derived scope exists and that a wrong parameter is refused");
      ok(tool.inputSchema.properties.scope && !("required" in tool.inputSchema),
         name + " advertises scope and no longer claims an unconditional required field");
    }
  }
}
'''

ANCHOR = "/* ----------------------- source-level safety asserts ----------------------- */"
src = apply(src, [(ANCHOR, MERGE_TESTS.lstrip("\n") + "\n" + ANCHOR, 1)], "merge assertions")

# ---------------------------------------------------------------------------
# 4. The two assertions that could not fail.

VACUOUS = '''const assembled = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
const oldLines = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8").split("\\n").filter(l => l.trim());
const newSet = new Set(assembled.split("\\n"));
ok(oldLines.every(l => newSet.has(l)), "purely additive: every non-blank old line survives");
'''

REPLACEMENT = '''const assembled = readFileSync(resolve(WORK, "..", "dawg-bot-worker.js"), "utf8");
/* ⚠️ THIS USED TO BE AN ASSERTION THAT COULD NOT FAIL. It read dawg-bot-worker.js into
   `assembled` and then read THE SAME FILE into `oldLines`, so "purely additive: every
   non-blank old line survives" compared a file with itself and was true for any input.
   There is no reference-free way to make that sentence mean anything, so it is replaced
   by the invariant that was actually worth having and that nothing else covered: THE
   ASSEMBLED WORKER'S TOOL ROSTER IS EXACTLY THE REGISTRY'S, and the generated block is
   bounded by its markers so nothing leaked outside them.

   This is not hypothetical. work/mcp-block.js had said "(Pup / Dawgs / The DawgHouse)"
   since Stage TR while the committed Worker still said "(Labs / Dawgs / The Pound)",
   because the Worker had not been reassembled. 343 assertions were green throughout. */
const MCP_START = "/* ===== DD-MCP-BLOCK START — generated from work/mcp-block.js; edit THERE ===== */";
const MCP_END = "/* ===== DD-MCP-BLOCK END ===== */";
ok(assembled.split(MCP_START).length === 2 && assembled.split(MCP_END).length === 2,
   "the generated block appears exactly once, bounded by its markers");
{
  const inBlock = assembled.slice(assembled.indexOf(MCP_START), assembled.indexOf(MCP_END));
  const outOfBlock = assembled.slice(0, assembled.indexOf(MCP_START)) + assembled.slice(assembled.indexOf(MCP_END));
  const names = s => (s.match(/\\n    name: "dd_\\w+",\\n/g) || []).map(m => m.trim());
  const registry = names(blockSrc);
  ok(registry.length === 41 && names(inBlock).join("|") === registry.join("|"),
     "the assembled block declares the registry's 41 tools, in the registry's order",
     `${names(inBlock).length} assembled vs ${registry.length} declared`);
  ok(names(outOfBlock).length === 0,
     "no tool is declared outside the markers, where assemble.mjs would never regenerate it");
  // and the block is genuinely a COPY of the source, not a drifted sibling: the source's
  // own text has to be present verbatim, which is what caught nothing for two stages.
  const registrySource = blockSrc.slice(blockSrc.indexOf("const MCP_TOOLS = ["));
  ok(inBlock.includes(registrySource.trimEnd()),
     "the assembled block contains work/mcp-block.js verbatim — a stale Worker fails here");
}
'''

src = apply(src, [(VACUOUS, REPLACEMENT, 1)], "vacuous assertions")

if "oldLines.every(" in src or "new Set(assembled.split(" in src:
    raise SystemExit("ABORT: the self-comparing assertion is still present")
for gone in ["dd_find_cfb_latest_games", "dd_find_cfb_latest_team_periods"]:
    stray = [i + 1 for i, l in enumerate(src.split("\n"))
             if gone in l and "Unknown tool" not in l and "formerly" not in l.lower()
             and "consolidation removed" not in l and "for (const gone of" not in l]
    if stray:
        raise SystemExit(f"ABORT: {gone} still referenced at lines {stray}")

SUITE.write_text(src, encoding="utf-8")
print("work/test-mcp.mjs updated: 43 -> 41, latest-* rescoped, merge assertions added, "
      "the self-comparing assertion replaced")
