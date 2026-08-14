"""
Annotate every tool in work/mcp-block.js with a display title, a read-only hint and a
catalog tag. Mechanical and purely additive: no description, schema or run() body moves.

    python3 work/patch-mcp-annotations.py

⚠️ THE TABLE BELOW IS THE DECISION, THE SCRIPT IS JUST TYPING. `core` is the everyday
league surface — who is in it, what the board and the draft look like, the price math a
Bozo leg actually needs, and the site map. `full` is everything, and it is what the bare
/mcp/<credential> URL keeps serving, so no connector already in the wild loses a tool.
The point of `core` is context: 43 schemas cost 10-25k tokens in every conversation that
connects, and most conversations never touch the college-football evidence surfaces or
the solvers.

⚠️ readOnlyHint is stored per tool rather than hardcoded at the wire boundary, so the day
a write tool ships it has somewhere honest to say false. Today every tool is true, and
work/assemble.mjs fails the build if the block ever contains `readOnlyHint: false` while
the block still claims to be read-only.

⚠️ ONE INSERTION PER TOOL, ASSERTED. Each `name: "dd_x",` line must appear exactly once
in the file; the script refuses rather than guessing if it does not. Re-running after the
patch has landed is a no-op with a message, not a second insertion.
"""
import pathlib, re, sys

SRC = pathlib.Path(__file__).resolve().parent / "mcp-block.js"

# name -> (title, catalog)
TOOLS = [
    ("dd_whoami",                        "Who am I",                     "core"),
    ("dd_league_overview",               "League overview",              "core"),
    ("dd_bozo_week",                     "Bozo board this week",         "core"),
    ("dd_bozo_standings",                "Bozo season ledger",           "core"),
    ("dd_draft_bozo_leg",                "Draft a Bozo leg",             "core"),
    ("dd_draft_board",                   "Live auction board",           "core"),
    ("dd_draft_pool",                    "Draft player pool",            "core"),
    ("dd_survivor_week",                 "Survivor ownership snapshot",  "core"),
    ("dd_survivor_ev",                   "Survivor pick EV",             "core"),
    ("dd_optimize_survivor_path",        "Survivor path optimizer",      "full"),
    ("dd_analyze_matchup",               "NFL matchup read",             "core"),
    ("dd_convert_odds",                  "Odds converter",               "core"),
    ("dd_elo_game",                      "Elo game probability",         "full"),
    ("dd_translate_probability",         "Probability to margin",        "full"),
    ("dd_devig_market",                  "Two-way devig",                "full"),
    ("dd_price_parlay",                  "Parlay pricer",                "core"),
    ("dd_calculate_bet_ev",              "Bet EV",                       "core"),
    ("dd_calculate_hedge",               "Hedge sizer",                  "full"),
    ("dd_nfl_passer_rating",             "NFL passer rating",            "full"),
    ("dd_score_forecast",                "Score one forecast",           "full"),
    ("dd_summarize_beliefs",             "Summarize probabilities",      "full"),
    ("dd_get_cfb_rating_system",         "CFB rating systems",           "full"),
    ("dd_rank_cfb_teams",                "CFB team ranking",             "full"),
    ("dd_cfb_team_profile",              "CFB team profile",             "full"),
    ("dd_compare_cfb_teams",             "Compare CFB teams",            "full"),
    ("dd_project_cfb_matchup",           "CFB matchup projection",       "full"),
    ("dd_project_cfb_schedule_path",     "CFB schedule path",            "full"),
    ("dd_find_cfb_record_divergence",    "CFB record divergence",        "full"),
    ("dd_get_cfb_model_disagreement",    "CFB model disagreement",       "full"),
    ("dd_get_cfb_model_receipt_status",  "CFB receipt ledger status",    "full"),
    # ⚠️ dd_find_cfb_latest_games and dd_find_cfb_latest_team_periods were REMOVED by
    # work/patch-cfb-tool-merge.py on 2026-08-10. Their rows are gone from this table so
    # re-running this one-shot annotator can never reintroduce two tools the registry no
    # longer declares.
    ("dd_find_cfb_team_games",           "CFB team games",               "full"),
    ("dd_find_cfb_team_periods",         "CFB team periods",             "full"),
    ("dd_find_cfb_games",                "CFB schedule search",          "full"),
    ("dd_find_cfb_historical_market",    "CFB historical prices",        "full"),
    ("dd_get_cfb_model_card",            "CFB model card",               "full"),
    ("dd_model_scoreboard",              "NFL model scoreboard",         "full"),
    ("dd_scores",                        "Live scores",                  "core"),
    ("dd_dfs_correlations",              "DFS correlations",             "full"),
    ("dd_solve_dfs_lineup",              "DFS lineup solver",            "full"),
    ("dd_guillotine_odds",               "Last Dawg Standing odds",      "core"),
    ("dd_site_map",                      "Site map",                     "core"),
]

s = SRC.read_text(encoding="utf-8")

block = s[s.index("const MCP_TOOLS = ["):]
declared = re.findall(r'\n    name: "(dd_\w+)",\n', block)
assert declared == [t[0] for t in TOOLS], (
    "the registry and this table disagree.\n"
    f"  in mcp-block.js but not here: {[n for n in declared if n not in [t[0] for t in TOOLS]]}\n"
    f"  here but not in mcp-block.js: {[t[0] for t in TOOLS if t[0] not in declared]}\n"
    "  (order matters — a tool moved is still a table that needs updating)"
)

if '\n    title: "' in block:
    print("already annotated; nothing to do")
    sys.exit(0)

for name, title, catalog in TOOLS:
    old = f'\n    name: "{name}",\n'
    assert s.count(old) == 1, f"{name}: expected exactly 1 declaration, found {s.count(old)}"
    new = (f'\n    name: "{name}",\n'
           f'    title: "{title}",\n'
           f'    catalog: "{catalog}",\n'
           f'    readOnlyHint: true,\n')
    s = s.replace(old, new, 1)

SRC.write_text(s, encoding="utf-8")
core = sum(1 for _, _, c in TOOLS if c == "core")
print(f"annotated {len(TOOLS)} tools: {core} core, {len(TOOLS)} full")
print("now run: cd work && node assemble.mjs")
