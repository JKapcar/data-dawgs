"""
Stage WC-A — the dd_find_cfb_* consolidation. Seven find tools become five.

`dd_find_cfb_team_games` absorbs `dd_find_cfb_latest_games`, and
`dd_find_cfb_team_periods` absorbs `dd_find_cfb_latest_team_periods`, each behind a
`scope` parameter. Both retired names are REMOVED, not aliased — Kap's 2026-08-10 ruling,
taken knowing that a name-based caller breaks. The registry goes 43 -> 41.

`dd_find_cfb_games` is NOT folded in. It covers the dated 2026 schedule while the
team-game surface covers 2025 results; one tool spanning both invites a caller to read
2025 form as 2026 form. Divergence and historical market stay separate because they are
different questions, not different views of one.

⚠️ THE POINT OF THE WHOLE STAGE IS THAT A SCOPE-INVALID PARAMETER IS REFUSED.
Two tools with different filter sets behind one flat schema means a caller can pass
`opponent` while asking for `latest-per-team`. Silently ignoring it hands back a plausible
answer to a question nobody asked, which is the dishonest failure. Refusal comes for free
from the existing parsers: each already rejects unknown fields by name against its own
`allowed` list, so DELEGATING to the unchanged parser per scope makes the refusal a
property of code that already shipped rather than new code to keep in sync.

The two run bodies are EXTRACTED VERBATIM and lifted to module functions. Nothing about
what either surface returns changes except two added fields: `query.scope` echoes the
scope, and `response_shape` names which payload shape came back. The top-level `scope`
field keeps its existing meaning (the data surface's own coverage string), so no current
consumer's parsing moves.

Strict extraction, exact expected count per edit, nothing written unless every file
agrees. Run from the repo root at main b8df441.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLOCK = ROOT / "work" / "mcp-block.js"
src = BLOCK.read_text(encoding="utf-8")

GONE = ["dd_find_cfb_latest_games", "dd_find_cfb_latest_team_periods"]
KEPT = ["dd_find_cfb_team_games", "dd_find_cfb_team_periods"]


def apply(text, edits, label):
    for old, new, n in edits:
        found = text.count(old)
        if found != n:
            raise SystemExit(f"ABORT {label}: expected {n}, found {found}: {old[:110]!r}")
        text = text.replace(old, new)
    return text


def tool_object(text, name):
    """The exact source of one tool object, from its opening `  {` through `  },\n`."""
    marker = f'\n    name: "{name}",\n'
    at = text.index(marker)
    # ⚠️ NOT rindex("\\n  {\\n", 0, at): the marker's leading newline IS the one that closes
    # `  {`, so that search excludes this object's own opener by one byte and silently
    # returns the PREVIOUS tool. Anchor on the exact three bytes instead.
    assert text[at - 3:at] == "  {", repr(text[at - 12:at])
    open_at = at - 3
    depth = 0
    i = open_at
    while True:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        elif c == '"':                      # skip string literals so a brace inside one
            i += 1                          # cannot unbalance the count
            while text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        i += 1
    end = text.index("\n", i) + 1
    assert text[i:end].strip() in ("},", "}"), text[i:end]
    return text[open_at:end]


def run_body(obj, parse_call):
    """The body of `async run(args) {` with its own parse line removed. Still at the
    original six-space indentation; dedent() is applied after the edits below, so those
    edits are written against the source as it actually reads."""
    head = "    async run(args) {\n"
    start = obj.index(head) + len(head)
    end = obj.rindex("    },\n")
    body = obj[start:end]
    assert "`" not in body, "a template literal would not survive the dedent"
    line = f"      const input = {parse_call}(args);\n"
    assert body.count(line) == 1, parse_call
    return body.replace(line, "")


def dedent(body):
    """Six spaces inside a tool object becomes two inside a module-level function."""
    return "".join(l[4:] if l.startswith("    ") else l for l in body.splitlines(keepends=True))


# ---------------------------------------------------------------------------
# Extract all four run bodies before anything is rewritten.

BODIES = {}
for name, parse in [("dd_find_cfb_team_games", "mcpCfbTeamGameArgs"),
                    ("dd_find_cfb_latest_games", "mcpCfbLatestGameArgs"),
                    ("dd_find_cfb_team_periods", "mcpCfbTeamPeriodArgs"),
                    ("dd_find_cfb_latest_team_periods", "mcpCfbLatestPeriodArgs")]:
    BODIES[name] = run_body(tool_object(src, name), parse)

# Echo the scope in the query block, and declare the payload shape. Both surfaces already
# echo every other argument under `query`, so the scope belongs there and NOT at the top
# level, where `scope` already means the data surface's coverage string.
BODIES["dd_find_cfb_team_games"] = apply(BODIES["dd_find_cfb_team_games"], [
    ("        query: {\n          team: team.team,\n          opponent:",
     "        query: {\n          scope: input.scope,\n          team: team.team,\n          opponent:", 1),
    ("        matched_before_limit: matches.length,",
     '        response_shape: "team-game-rows",\n        matched_before_limit: matches.length,', 1),
], "team-games body")

BODIES["dd_find_cfb_latest_games"] = apply(BODIES["dd_find_cfb_latest_games"], [
    ("        query: { team: team ? team.team : null, conference, opponent_division:",
     "        query: { scope: input.scope, team: team ? team.team : null, conference, opponent_division:", 1),
    ("        matched_before_pagination: matches.length,",
     '        response_shape: "latest-per-team-rows",\n        matched_before_pagination: matches.length,', 1),
], "latest-games body")

BODIES["dd_find_cfb_team_periods"] = apply(BODIES["dd_find_cfb_team_periods"], [
    ("        query: {\n          team: team.team,\n          week: input.week,",
     "        query: {\n          scope: input.scope,\n          team: team.team,\n          week: input.week,", 1),
    ("        matched_before_limit: matches.length,",
     '        response_shape: "team-period-rows",\n        matched_before_limit: matches.length,', 1),
], "team-periods body")

BODIES["dd_find_cfb_latest_team_periods"] = apply(BODIES["dd_find_cfb_latest_team_periods"], [
    ("        query: { team: team ? team.team : null, division: input.division, conference,",
     "        query: { scope: input.scope, team: team ? team.team : null, division: input.division, conference,", 1),
    ("        matched_before_pagination: matches.length,",
     '        response_shape: "latest-per-team-rows",\n        matched_before_pagination: matches.length,', 1),
], "latest-periods body")

# ---------------------------------------------------------------------------
# The scope dispatchers and the four lifted run functions.

SCOPE_HELPERS = '''/* ==================== the two merged CFB find surfaces ====================
 * `dd_find_cfb_team_games` and `dd_find_cfb_team_periods` each cover a PARENT surface
 * (one team, longitudinal) and its DERIVED cross-sectional view (every team's latest).
 * They used to be four tools. Two names a model has to choose between, whose difference
 * is one word, is a discovery hazard: `latest_games` got picked for questions that wanted
 * `team_games`.
 *
 * ⚠️ A PARAMETER BELONGING TO THE OTHER SCOPE MUST BE REFUSED, NOT IGNORED. Ignoring it
 * answers a question the caller did not ask and looks like success. The refusal is not new
 * code: each scope DELEGATES to its original unchanged parser, and those already reject
 * unknown fields by name against their own `allowed` list. The list below is only a
 * first-pass check that can name the scope in the message; the delegated parser is the
 * backstop, so a drift between them can make an error message worse and can never let an
 * invalid field through.
 *
 * ⚠️ `required: ["team"]` LEFT THE JSON SCHEMA because the requirement is now conditional
 * on the scope, and a schema that cannot express a rule must not pretend to. It is
 * enforced below with an error that says which scope needs it and which one does not.
 */
const MCP_CFB_SCOPE_FIELDS = {
  "dd_find_cfb_team_games": {
    "team-games": ["team", "opponent", "week", "season_type", "result", "site", "sort", "limit"],
    "latest-per-team": ["team", "conference", "opponent_division", "season_type", "result", "site", "sort", "offset", "limit"],
  },
  "dd_find_cfb_team_periods": {
    "team-periods": ["team", "week", "season_type", "sort", "limit"],
    "latest-per-team": ["team", "division", "conference", "season_type", "period_outcome", "sort", "offset", "limit"],
  },
};

function mcpCfbScopeArgs(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const scopes = MCP_CFB_SCOPE_FIELDS[tool];
  const names = Object.keys(scopes);
  const scope = args.scope === undefined ? names[0] : args.scope;
  if (!names.includes(scope)) throw new Error("scope must be " + names.join(" or "));
  const allowed = scopes[scope];
  const extra = Object.keys(args).filter(k => k !== "scope" && !allowed.includes(k));
  if (extra.length)
    throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + " for scope " + scope + ": " + extra.join(", ") +
      " (supported: " + allowed.join(", ") + ")");
  // The default scope wants one exact team; the derived scope is cross-team by design.
  if (scope !== "latest-per-team" && args.team === undefined)
    throw new Error("team is required when scope is " + scope + "; use scope latest-per-team for bounded cross-team discovery");
  const rest = { ...args };
  delete rest.scope;
  return { scope, rest };
}

async function mcpCfbTeamGamesScoped(args) {
  const { scope, rest } = mcpCfbScopeArgs("dd_find_cfb_team_games", args);
  if (scope === "latest-per-team") return mcpCfbLatestGamesRun({ scope, ...mcpCfbLatestGameArgs(rest) });
  return mcpCfbTeamGamesRun({ scope, ...mcpCfbTeamGameArgs(rest) });
}

async function mcpCfbTeamPeriodsScoped(args) {
  const { scope, rest } = mcpCfbScopeArgs("dd_find_cfb_team_periods", args);
  if (scope === "latest-per-team") return mcpCfbLatestPeriodsRun({ scope, ...mcpCfbLatestPeriodArgs(rest) });
  return mcpCfbTeamPeriodsRun({ scope, ...mcpCfbTeamPeriodArgs(rest) });
}

async function mcpCfbTeamGamesRun(input) {
__TEAM_GAMES__}

async function mcpCfbLatestGamesRun(input) {
__LATEST_GAMES__}

async function mcpCfbTeamPeriodsRun(input) {
__TEAM_PERIODS__}

async function mcpCfbLatestPeriodsRun(input) {
__LATEST_PERIODS__}

'''
SCOPE_HELPERS = (SCOPE_HELPERS
                 .replace("__TEAM_GAMES__", dedent(BODIES["dd_find_cfb_team_games"]))
                 .replace("__LATEST_GAMES__", dedent(BODIES["dd_find_cfb_latest_games"]))
                 .replace("__TEAM_PERIODS__", dedent(BODIES["dd_find_cfb_team_periods"]))
                 .replace("__LATEST_PERIODS__", dedent(BODIES["dd_find_cfb_latest_team_periods"])))

src = apply(src, [("function mcpCfbGameArgs(args) {", SCOPE_HELPERS + "function mcpCfbGameArgs(args) {", 1)],
            "helper insertion")

# ---------------------------------------------------------------------------
# The two merged tool objects.

MERGED_GAMES = '''  {
    name: "dd_find_cfb_team_games",
    title: "CFB team games",
    catalog: "full",
    readOnlyHint: true,
    description: "Query bounded schedule-derived 2025 CFB game results from a team's perspective. scope=team-games returns every covered game for one exact required team, optionally by opponent, week, regular/postseason, result or site. scope=latest-per-team returns one compact latest completed game per FBS team for bounded cross-team discovery, where team is optional and conference and opponent_division apply instead. Observed score and outcome facts only: latest means the last completed game in the dated 2025 surface, not current 2026 form, a forecast or a model grade. No EPA, opponent adjustment or market performance is available. A parameter belonging to the other scope is refused by name rather than ignored.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["team-games", "latest-per-team"], default: "team-games", description: "team-games needs one exact team and returns that team's covered games. latest-per-team returns each FBS team's last completed game and makes team optional." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact canonical team name or slug, case-insensitive. REQUIRED when scope is team-games; optional when scope is latest-per-team." },
        opponent: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact canonical opponent name or slug, case-insensitive. scope=team-games only." },
        week: { type: "integer", minimum: 1, maximum: 20, description: "scope=team-games only." },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact FBS conference name, case-insensitive. scope=latest-per-team only." },
        opponent_division: { type: "string", enum: ["all", "fbs", "fcs"], default: "all", description: "scope=latest-per-team only." },
        season_type: { type: "string", enum: ["all", "regular", "postseason"], default: "all" },
        result: { type: "string", enum: ["all", "win", "loss", "tie"], default: "all" },
        site: { type: "string", enum: ["all", "home", "away", "neutral"], default: "all" },
        sort: { type: "string", enum: ["kickoff-asc", "kickoff-desc", "team-asc"], default: "kickoff-asc", description: "kickoff-asc or kickoff-desc under scope=team-games, default kickoff-asc. team-asc or kickoff-desc under scope=latest-per-team, default team-asc. A value belonging to the other scope is refused." },
        offset: { type: "integer", minimum: 0, maximum: 199, default: 0, description: "scope=latest-per-team only." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      },
      additionalProperties: false,
    },
    async run(args) {
      return mcpCfbTeamGamesScoped(args);
    },
  },
'''

MERGED_PERIODS = '''  {
    name: "dd_find_cfb_team_periods",
    title: "CFB team periods",
    catalog: "full",
    readOnlyHint: true,
    description: "Query bounded schedule-derived 2025 CFB team-period results, with regular and postseason week labels kept distinct. scope=team-periods returns every covered period for one exact required team, optionally by week or season type. scope=latest-per-team returns each team's latest covered period for bounded cross-team discovery, where team is optional and division, conference and period_outcome apply instead. Period and season-to-date record and scoring facts only: latest means the last covered 2025 period, not current 2026 form. FCS records include only games against FBS opponents. No EPA, success rate, explosiveness, havoc, garbage-time, opponent adjustment or market performance is available. A parameter belonging to the other scope is refused by name rather than ignored.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["team-periods", "latest-per-team"], default: "team-periods", description: "team-periods needs one exact team and returns that team's covered periods. latest-per-team returns each team's latest period and makes team optional." },
        team: { type: "string", minLength: 1, maxLength: 80, description: "Exact canonical team name or slug, case-insensitive. REQUIRED when scope is team-periods; optional when scope is latest-per-team." },
        week: { type: "integer", minimum: 1, maximum: 20, description: "scope=team-periods only." },
        division: { type: "string", enum: ["all", "fbs", "fcs"], default: "all", description: "scope=latest-per-team only." },
        conference: { type: "string", minLength: 1, maxLength: 80, description: "Optional exact conference name, case-insensitive. scope=latest-per-team only." },
        season_type: { type: "string", enum: ["all", "regular", "postseason"], default: "all" },
        period_outcome: { type: "string", enum: ["all", "positive", "negative", "even"], default: "all", description: "Filter the latest period by the sign of its observed point differential; a period can contain multiple games. scope=latest-per-team only." },
        sort: { type: "string", enum: ["period-asc", "period-desc", "team-asc", "through-desc", "conference-record-desc"], default: "period-asc", description: "period-asc or period-desc under scope=team-periods, default period-asc. team-asc, through-desc or conference-record-desc under scope=latest-per-team, default team-asc. conference-record-desc orders by observed regular-season conference win percentage, then wins and point differential; it is not an official standing. A value belonging to the other scope is refused." },
        offset: { type: "integer", minimum: 0, maximum: 399, default: 0, description: "scope=latest-per-team only." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25, description: "scope=team-periods accepts 1 through 25 and defaults to 20; scope=latest-per-team accepts 1 through 50 and defaults to 25. The lower ceiling is a payload bound, not an oversight." },
      },
      additionalProperties: false,
    },
    async run(args) {
      return mcpCfbTeamPeriodsScoped(args);
    },
  },
'''

src = apply(src, [(tool_object(src, "dd_find_cfb_team_games"), MERGED_GAMES, 1)], "merge team-games")
src = apply(src, [(tool_object(src, "dd_find_cfb_team_periods"), MERGED_PERIODS, 1)], "merge team-periods")
for name in GONE:
    src = apply(src, [(tool_object(src, name), "", 1)], f"remove {name}")

# ---------------------------------------------------------------------------
# The shared CFB honesty caveat names every tool in the family by hand, so it names two
# that no longer exist. It is the string a model actually reads before trusting any of
# this, which makes a stale tool name in it worse than a stale comment.

src = apply(src, [
    ("dd_find_cfb_team_games, dd_find_cfb_latest_games, dd_find_cfb_team_periods and "
     "dd_find_cfb_latest_team_periods return schedule-derived results only; latest means "
     "latest within the 2025 FBS-involved surface, not current 2026 form, and FCS records are partial.",
     "dd_find_cfb_team_games and dd_find_cfb_team_periods return schedule-derived results "
     "only, for one exact team by default or for every team's most recent game or period "
     "under scope=latest-per-team; latest means latest within the 2025 FBS-involved surface, "
     "not current 2026 form, and FCS records are partial.", 1),
], "CFB caveat roll-call")

# ---------------------------------------------------------------------------
# The registry no longer carries 43 tools, so no comment may say it does.

src = apply(src, [
    ("// not spend 43 tool schemas of context on tools they never call",
     "// not spend 41 tool schemas of context on tools they never call", 0),
], "count comments")

declared = re.findall(r'\n    name: "(dd_\w+)",\n', src)
if len(declared) != 41:
    raise SystemExit(f"ABORT: {len(declared)} tools declared, expected 41")
for name in GONE:
    if name in src:
        raise SystemExit(f"ABORT: {name} still appears in work/mcp-block.js")
for name in KEPT:
    if src.count(f'name: "{name}",') != 1:
        raise SystemExit(f"ABORT: {name} is not declared exactly once")

BLOCK.write_text(src, encoding="utf-8")
print(f"work/mcp-block.js rewritten: {len(declared)} tools declared, {', '.join(GONE)} removed")
