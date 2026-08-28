"""
Toto in the draft room: one shared block again, and no invented dollars.

Four findings from the draft-rig audit, fixed here.

1. THE "SHARED" TOTO BLOCK HAD DRIFTED INTO THREE VARIANTS. It is copy-pasted into
   every flattened page (AGENTS.md, "Toto's surface on a page"), and the league work
   updated it on six rig pages only. master.html — which sets window.DD_POOL and so
   gets the DRAFT surface, not the page reader — kept the pre-league copy. On that
   page Toto and the "Who are you?" chip both read the UNSCOPED `dd-auction-v1` /
   `dd-me-v1` keys, so for anyone in a league instance the picker listed zero teams
   AND ask() refused every question behind "tap the Who are you? chip" — a dead end
   with no way out. It also still told the model it was in "a 14-team auction".
   Fixed by bringing every page back to one identical block, and by giving master.html
   draft-league.js plus a decorated link so the league id actually reaches it.

2. A SNAKE LEAGUE GOT A FABRICATED $200 BUDGET. draft-leagues.html has shipped a
   snake option since the league work; ctx() read `st.budget||200`, so a snake league
   (budget:null) was handed to the model as a $200 auction with dollars left, max bids
   and an inflation multiplier. Inventing state is the one thing this assistant exists
   not to do. ctx() and the draft system block now branch on draftType.

3. THE PPN ROOM WAS PRICED IN THE WRONG COLUMN. board.html?league=pepperoninipples
   drops every generic MV column and shows `lg` alone. ctx() priced from
   settings.scoring ("half"), so Toto named dollar figures that appear nowhere on the
   reader's screen — and mixed them with `pick.etr`, which the operator page records
   from its own generic column. Both now follow the column the room displays.

4. THE SITE MANUAL DID NOT KNOW LEAGUES EXIST. HELP is the ONLY source Toto may answer
   how-to from, and it had nothing about draft-leagues.html, league links, snake, or
   per-league storage — so "how do I import my Sleeper league" was an "I don't know".
   auction.html's copy had also drifted a line out of sync with the other 32.

Run:  cd work && python3 patch-toto-draft-audit.py && python3 stamp-sw-version.py
"""
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGES = sorted(REPO.glob("*.html"))
MARK = "/* ---------- Toto: shared draft assistant"

changed = {}


def sub(text, old, new, path, label, required=True):
    n = text.count(old)
    if n == 0:
        if required:
            sys.exit(f"FAIL {path.name}: {label} — anchor not found")
        return text
    assert n == 1, f"FAIL {path.name}: {label} — {n} matches, expected 1"
    changed.setdefault(path.name, []).append(label)
    return text.replace(old, new, 1)


# ---------------------------------------------------------------- 1. one block
STALE = [
    ('  const LS_STATE= "dd-auction-v1";',
     '  const LS_STATE=window.DDLeague ? DDLeague.storageKey("dd-auction-v1") : "dd-auction-v1";',
     "LS_STATE is league-scoped"),
    ('  const SYS_DRAFT = `RIGHT NOW you are the live auction assistant, advising whoever is asking, mid-draft, in a 14-team fantasy football auction.',
     '  const SYS_DRAFT = `RIGHT NOW you are the live draft assistant, advising whoever is asking, mid-draft, in a fantasy football draft.',
     "SYS_DRAFT is draft-generic"),
    ('  const KEY="dd-me-v1", listeners=[];',
     '  const KEY=(window.DDLeague ? DDLeague.storageKey("dd-me-v1") : "dd-me-v1"), listeners=[];',
     "DDMe key is league-scoped"),
    ('  const teams=()=>{ try{ const S=JSON.parse(localStorage.getItem("dd-auction-v1")||"null");',
     '  const teams=()=>{ try{ const S=JSON.parse(localStorage.getItem(window.DDLeague?DDLeague.storageKey("dd-auction-v1"):"dd-auction-v1")||"null");',
     "DDMe reads the league's state"),
]

STALE_LEAGUE_LINE = (
    '    const L=[];\n'
    '    L.push(`LEAGUE: 14-team offline auction, $${st.budget} budget, ${st.spots} roster spots each '
    '(QB, 2 RB, 2 WR, TE, 2 FLEX W/R/T, DEF, rest bench; no kicker). Scoring: '
    '${{half14:"14-team Half PPR · derived",half:"12-team Half PPR",full:"12-team Full PPR",'
    'sf:"12-team Superflex PPR",sfhalf12:"12-team Superflex Half PPR · hybrid"}[scoring]||scoring}. '
    '$0 bids are legal, so a team\'s max bid = its dollars left.`);\n'
)
RIG_LEAGUE_LINE = (
    '    const L=[];\n'
    '    const roster=(st.rosterSlots||[]).map(s=>`${s.count} ${s.slot}`).join(", ")||`${st.spots} roster spots`;\n'
    '    const draftType=st.draftType||"auction";\n'
    '    L.push(`LEAGUE: ${T.length}-team ${draftType} draft, ${roster}. Scoring: '
    '${{half14:"14-team Half PPR · derived",half:"12-team Half PPR",full:"12-team Full PPR",'
    'sf:"12-team Superflex PPR",sfhalf12:"12-team Superflex Half PPR · hybrid"}[scoring]||scoring}.'
    '${draftType==="auction"?` $${st.budget} budget; $0 bids are legal, so a team\'s max bid = its dollars left.`:""}`);\n'
)

# ------------------------------------------------------------------ 2/3. ctx()
CTX_NEW = (pathlib.Path(__file__).resolve().parent / "toto-ctx.js").read_text(encoding="utf-8")

SYS_DRAFT_OLD = """- MV is a dated market-consensus value snapshot, not a points projection. Surplus vs MV measures buying below consensus, not winning.
- Reason from: dollars left, open starting slots, positional scarcity on the board, inflation, and each rival's max bid. $1-3 endgame fills are a real plan, not a failure.
- When asked to decide, name the player(s) and the price you would pay.
- If the state shows no picks yet, say so and talk strategy rather than pretending to see a board.`;"""

SYS_DRAFT_NEW = """- The money column is named at the top of the state block and it is the ONLY one you may quote. "MV" is the dated public market-consensus snapshot; "$ PPN" is that snapshot re-priced for one league, and is the only column that league's room displays. Use whichever name the state uses, and never convert between them or quote a format the room does not show. Either way it is a value estimate, not a points projection: surplus against it measures buying below consensus, not winning.
- AUCTION LEAGUES ONLY: reason from dollars left, open starting slots, positional scarcity on the board, inflation, and each rival's max bid. $1-3 endgame fills are a real plan, not a failure. When asked to decide, name the player(s) and the price you would pay.
- SNAKE LEAGUES HAVE NO MONEY. If the state says the draft type is snake there is no budget, no bid, no price paid and no inflation — the dollar figures are value estimates used to rank players. Never quote dollars left or a max bid there, and never invent a budget the state does not give you. Decide by naming the player you would take and who you would take over.
- If the state shows no picks yet, say so and talk strategy rather than pretending to see a board.`;"""

# ------------------------------------------------------------------- 4. manual
HELP_MONEY_OLD = "THE MONEY PILE: every team's remaining budget, sorted — on the Fantasy Draft Dashboard's summary strip.\n"
HELP_VOICE_OLD = ("VOICE BOARD: radio-style dials at the bottom of the operator page that set the league announcer's "
                  "model, stability, style, likeness, speed and speaker boost. The money pile moved off this page to "
                  "the Draft Dashboard strip.\n")
HELP_MONEY_NEW = ("THE MONEY PILE: every team's remaining budget, sorted — on the Fantasy Draft Dashboard's summary "
                  "strip. It is not on the operator page.\n"
                  "VOICE BOARD: radio-style dials at the bottom of the operator page that set the league announcer's "
                  "model, stability, style, likeness, speed and speaker boost.\n")

HELP_ANCHOR = "OTHER PAGES: Big Board is the projector view"
HELP_LEAGUES = """LEAGUES (draft-leagues.html) — the front door. Every room is one league, and the league id travels in the URL as ?league=<id>; a page opened without it falls back to the legacy room.
YOUR LEAGUES: the shelf at the top lists the leagues opened on this browser. Each row has Open, "Copy league link" and "Remove from this device". The link is a capability link — anyone holding it can open that room and no Data Dawgs account is needed — and removing a league only forgets it on that device.
CREATE LEAGUE: name, season, teams, draft type (Auction or Snake), auction budget, roster configuration, scoring, points per reception, and a team/owner list. A snake league has no budget and no bidding.
CONNECT LEAGUE: paste a Sleeper league URL and press "Recognize League" to import teams and settings. Yahoo and ESPN are not imported this way and are set up by hand. There is a separate "Connect ESPN" form taking an ESPN league id, season and the espn_s2 / SWID cookies.
OPENING A RIG PAGE with leagues on the shelf but no draft on the device sends you here to pick one first — that is the picker, not an error.
"""

HELP_STATE_OLD = ("STATE: everything saves in the browser on that device. A different device shows a different draft "
                  "unless the live mirror is switched on.")
HELP_STATE_NEW = ("STATE: everything saves in the browser on that device, under its own key per league — so two "
                  "leagues on one browser never see each other, and a different device shows a different draft "
                  "unless it opens the same league link or the live mirror is switched on.")

for path in PAGES:
    s = path.read_text(encoding="utf-8")
    if MARK not in s:
        continue
    orig = s

    for old, new, label in STALE:
        s = sub(s, old, new, path, label, required=False)
    if STALE_LEAGUE_LINE in s:
        s = sub(s, STALE_LEAGUE_LINE, RIG_LEAGUE_LINE, path, "LEAGUE line is derived", required=False)

    # ctx(): replace the whole function, which is identical on every page by now
    start = s.index("  function ctx(){\n")
    end = s.index("  const HIST=[]; let busy=false;")
    s = s[:start] + CTX_NEW + s[end:]
    changed.setdefault(path.name, []).append("ctx() branches on draft type and money column")

    s = sub(s, SYS_DRAFT_OLD, SYS_DRAFT_NEW, path, "draft system block covers snake and $ PPN")

    if HELP_VOICE_OLD in s:
        s = sub(s, HELP_VOICE_OLD, HELP_MONEY_NEW, path, "manual: money pile + voice board")
    else:
        s = sub(s, HELP_MONEY_OLD, HELP_MONEY_NEW, path, "manual: money pile + voice board")
    s = sub(s, HELP_ANCHOR, HELP_LEAGUES + HELP_ANCHOR, path, "manual: leagues section")
    s = sub(s, HELP_STATE_OLD, HELP_STATE_NEW, path, "manual: state is per league")

    if s != orig:
        path.write_text(s, encoding="utf-8", newline="\n")

# ------------------------------------ master.html joins the league system for real
master = REPO / "master.html"
s = master.read_text(encoding="utf-8")
if 'src="draft-league.js"' not in s:
    # exactly where every other rig page puts it: after the nav mount, before the
    # page's own script, so DDLeague exists by the time the shared block reads a key
    marker = '  <div id="nav"></div>\n  <script data-page="master">'
    assert s.count(marker) == 1, "master.html has no unique nav/page-script seam"
    s = s.replace(marker, '  <div id="nav"></div>\n  <script src="draft-league.js"></script>\n'
                          '  <script data-page="master">', 1)
    changed.setdefault("master.html", []).append("loads draft-league.js")
    master.write_text(s, encoding="utf-8", newline="\n")

lib = REPO / "draft-league.js"
s = lib.read_text(encoding="utf-8")
old = ('    const pages=new Set(["dashboard.html","auction.html","board.html","bigboard.html",'
       '"dataviz.html","report.html"]);')
new = ('    /* ⚠️ master.html BELONGS HERE and did not used to. It sets window.DD_POOL, so Toto and\n'
       '       the "Who are you?" chip take the DRAFT surface there — and with no ?league= on the\n'
       '       link they resolved against the legacy unscoped keys, which for a league instance is\n'
       '       an empty team list and an assistant that refuses to answer. It stays out of the\n'
       '       rigPages picker redirect above: the player pool is worth reading league-free. */\n'
       '    const pages=new Set(["dashboard.html","auction.html","board.html","bigboard.html",'
       '"dataviz.html","report.html","master.html"]);')
assert s.count(old) == 1, "draft-league.js: decorateDraftLinks page set is not unique"
lib.write_text(s.replace(old, new, 1), encoding="utf-8", newline="\n")
changed.setdefault("draft-league.js", []).append("decorated links carry the league to master.html")

for name in sorted(changed):
    print(f"  {name}")
    for label in changed[name]:
        print(f"      - {label}")
