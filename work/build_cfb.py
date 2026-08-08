"""
Stamp cfb.html — the College Football lab page — out of connect.html.

Same technique as build_signon.py (which stamped signon out of connect, which was
stamped out of strategy): there is no page build system, so a NEW page is an existing
page's head + shell + footer with the body and page script swapped. connect.html is the
template because its head already carries the lab chip, card, form and honesty CSS this
page needs, and it is the leanest page that has them.

WHY THIS PAGE EXISTS. The CFB series shipped fourteen /data/ files and sixteen MCP tools
and zero human pages. Every number below was already published and machine-readable; the
only new thing here is a way for a person to look at it.

⚠️ Slice by CONTENT MARKERS, never line numbers (build_connect.py's rule).

⚠️ HONESTY CONSTRAINTS baked into the copy, all of them from the CFB handoff:
  - 2025 results only. There is NO 2026 schedule in this data; do not imply one.
  - ONE Elo system, retrodictive, ungraded. Not a consensus, not a power ranking,
    not a forecast.
  - Market prices have an UNKNOWN observation time, so this page shows none of them
    and computes no CLV.
  - The prospective forecast ledger is EMPTY by design.
  - Matchup output is a hypothetical rating-period calculation, not a scheduled game.
Observed and modelled objects are kept visually separate everywhere, because the source
files keep them separate and blending them here would undo that work.

Run:  cd work && python3 build_cfb.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "connect.html"
OUT = REPO / "cfb.html"

src = TEMPLATE.read_text(encoding="utf-8")


def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {TEMPLATE.name}, expected 1"
    return hay.index(needle)


# ---------------------------------------------------------------- page CSS ----
# Appended inside the template's single <style> block. Everything new is prefixed
# `cfb` or is a table/figure primitive the template does not already define, so
# nothing here can restyle a card, a form field or the nav.
CSS = r"""
/* ---- cfb.html ---- */
select.fi{width:100%;box-sizing:border-box;background:var(--page);border:1px solid var(--grid);
  border-radius:9px;color:var(--ink-1);font:inherit;font-size:14px;padding:9px 11px}
select.fi:focus{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:1px}
.cfbfilt{display:flex;gap:0 16px;flex-wrap:wrap;align-items:flex-end}
.cfbfilt label.fld{flex:1 1 200px;min-width:0;margin-bottom:8px}
.cfbcount{font-size:12.5px;color:var(--ink-3);margin:2px 0 0}

/* ⚠️ The scroller, not the table, is what keeps 320px honest. The table has a
   min-width so the columns never crush; the wrapper absorbs the overflow so the
   DOCUMENT never grows sideways. Same trap that cost bigboard and guillotine. */
.cfbwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:12px 0 0;
  border:1px solid var(--grid);border-radius:11px}
table.cfbt{border-collapse:collapse;width:100%;min-width:660px;font-size:12.5px;
  font-variant-numeric:tabular-nums}
table.cfbt th,table.cfbt td{padding:6px 10px;text-align:right;white-space:nowrap;
  border-bottom:1px solid var(--grid)}
table.cfbt th:first-child,table.cfbt td:first-child{text-align:left;
  white-space:normal;overflow-wrap:anywhere;min-width:120px}
table.cfbt th:nth-child(2),table.cfbt td:nth-child(2){text-align:left;
  white-space:normal;overflow-wrap:anywhere}
table.cfbt tbody tr:hover td{background:color-mix(in srgb,var(--accent) 7%,transparent)}
table.cfbt tbody tr:last-child td{border-bottom:0}
/* the group band: OBSERVED on the left, MODELLED on the right, never blended */
table.cfbt thead tr.cfbgrp th{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;
  font-weight:800;padding:8px 10px 5px;text-align:left;border-bottom:1px solid var(--axis)}
table.cfbt thead tr.cfbgrp th.obs{color:var(--ink-2)}
table.cfbt thead tr.cfbgrp th.mod{color:var(--accent)}
table.cfbt thead tr.cfbhd th{font-size:10px;letter-spacing:.06em;text-transform:uppercase;
  font-weight:800;color:var(--ink-3);cursor:pointer;user-select:none;
  border-bottom:1px solid var(--axis);background:var(--surface-1)}
table.cfbt thead tr.cfbhd th:hover{color:var(--ink-1)}
table.cfbt thead tr.cfbhd th[aria-sort="ascending"],
table.cfbt thead tr.cfbhd th[aria-sort="descending"]{color:var(--accent)}
table.cfbt th.cfbsep,table.cfbt td.cfbsep{border-left:1px solid var(--axis)}
table.cfbt td.tm{color:var(--ink-1);font-weight:650}
table.cfbt td.cf{color:var(--ink-3)}
.cfbmore{margin:11px 0 0}

/* figures */
.cfbkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px;margin:14px 0 0}
.cfbkpi{border:1px solid var(--grid);border-radius:11px;padding:12px 14px;background:var(--page)}
.cfbkpi .k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);font-weight:800}
.cfbkpi .v{font-size:23px;font-weight:800;color:var(--ink-1);margin-top:5px;line-height:1.1}
.cfbkpi .r{font-size:11.5px;color:var(--ink-3);margin-top:4px;line-height:1.5}

/* the meter: one measure against its complement, same ramp, 2px surface gap */
.cfbmeter{display:flex;gap:2px;height:26px;margin:14px 0 0;background:var(--surface-1)}
.cfbmeter i{display:block;border-radius:4px;min-width:2px}
.cfbmeter i.f{background:var(--accent)}
.cfbmeter i.t{background:color-mix(in srgb,var(--accent) 20%,transparent)}
.cfbmends{display:flex;justify-content:space-between;gap:12px;margin:7px 0 0;font-size:12.5px;
  color:var(--ink-2);flex-wrap:wrap}
.cfbmends b{color:var(--ink-1);font-weight:800;font-variant-numeric:tabular-nums}

/* scatter */
.cfbfig{position:relative;margin:14px 0 0}
.cfbfig svg{width:100%;height:auto;display:block;touch-action:pan-y}
.cfbfig svg:focus{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}
.cfbtip{position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;
  background:var(--surface-1);border:1px solid var(--axis);border-radius:9px;
  padding:8px 11px;font-size:12px;line-height:1.55;color:var(--ink-2);
  box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:230px;z-index:5}
.cfbtip.on{opacity:1}
.cfbtip b{color:var(--ink-1);display:block;font-size:12.5px;margin-bottom:3px}
.cfbtip span{font-variant-numeric:tabular-nums}
.cfbcap{font-size:12px;color:var(--ink-3);line-height:1.6;margin:9px 0 0}
.cfbsrc{font-size:11.5px;color:var(--ink-3);line-height:1.6;margin:11px 0 0;overflow-wrap:anywhere}
.cfbsrc code{font-size:11px;overflow-wrap:anywhere}
.cfbdir{font-weight:700}
@media(max-width:560px){
  .cfbkpi .v{font-size:20px}
  .cfbmeter{height:22px}
}
"""

# --------------------------------------------------------------- page body ----
BODY = r"""  <div class="lab-hd"><span class="lab-chip">Labs</span></div>
  <h1 style="margin:10px 0 0;font-size:27px;font-weight:800;letter-spacing:-.01em">College Football Lab</h1>
  <p class="lab-sub">One hundred and thirty-six FBS teams, their 2025 results, and one deliberately
  simple Elo rating built from game results and margin alone. The rating is retrodictive and
  ungraded &mdash; it has never forecast a game before kickoff. Everything on this page is the
  same data the CFB tools serve to machines, drawn for people.</p>

  <div class="banner" style="margin-top:14px"><b>2025 only.</b> There is no 2026 schedule in this
  data, so nothing here is a projection of a coming season, a ranking, or a bet. The one thing you
  can compute is a hypothetical: what this rating would have said about two teams meeting during
  the 2025 rating period.</div>

  <!-- ================= matchup calculator ================= -->
  <div class="card" id="matchup">
    <h3>Matchup calculator <span class="rt" id="cfbMxAsOf"></span></h3>
    <p class="sub">Pick two teams. This applies the ratings registry&rsquo;s <b>published</b> transform
    to their end-of-2025 strengths &mdash; the same formula, scale and venue adjustment the
    <code>dd_project_cfb_matchup</code> tool uses, read from the file rather than retyped here.</p>
    <div class="grid2">
      <label class="fld"><span>Home team</span>
        <select class="fi" id="cfbHome"></select></label>
      <label class="fld"><span>Away team</span>
        <select class="fi" id="cfbAway"></select></label>
    </div>
    <label class="fld" style="margin-bottom:4px"><span>Venue</span>
      <select class="fi" id="cfbVenue">
        <option value="home">Home game for the home team</option>
        <option value="neutral">Neutral site</option>
      </select></label>

    <div id="cfbMxOut" hidden>
      <div class="cfbmeter" role="img" id="cfbMeter" aria-label="Win probability split">
        <i class="f" id="cfbMeterF"></i><i class="t" id="cfbMeterT"></i>
      </div>
      <div class="cfbmends">
        <span id="cfbMxHome"></span><span id="cfbMxAway"></span>
      </div>
      <div class="cfbkpis">
        <div class="cfbkpi"><div class="k">Rating gap</div><div class="v" id="cfbMxGap"></div>
          <div class="r" id="cfbMxGapR"></div></div>
        <div class="cfbkpi"><div class="k">Home team strength</div><div class="v" id="cfbMxHs"></div>
          <div class="r" id="cfbMxHr"></div></div>
        <div class="cfbkpi"><div class="k">Away team strength</div><div class="v" id="cfbMxAs"></div>
          <div class="r" id="cfbMxAr"></div></div>
      </div>
      <p class="cfbsrc">Transform, as published: <code id="cfbMxFormula"></code>
      &nbsp;<span id="cfbMxParams"></span></p>
    </div>
    <p class="note warn" style="margin-top:12px"><b>This is a hypothetical, not a forecast.</b>
    Both ratings are frozen at the end of the 2025 season and no game on any 2026 schedule has been
    priced with them. Expected margin, spread and total stay empty rather than being reverse-engineered
    out of a win probability &mdash; the rating does not produce them.</p>
    <p class="note" id="cfbMxErr" hidden></p>
  </div>

  <!-- ================= one filter row, scoping everything below ================= -->
  <div class="card">
    <h3>Filter</h3>
    <p class="sub">One filter for the whole page below: the team table, the expected-versus-observed
    chart and the divergence table all redraw against the same slice.</p>
    <div class="cfbfilt">
      <label class="fld"><span>Conference</span>
        <select class="fi" id="cfbConf"><option value="">All conferences</option></select></label>
      <label class="fld"><span>Team <span class="hint">&mdash; name contains</span></span>
        <input class="fi" id="cfbQ" type="search" placeholder="e.g. Ohio" autocomplete="off"></label>
    </div>
    <p class="cfbcount" id="cfbCount">Loading&hellip;</p>
  </div>

  <!-- ================= 136-team explorer ================= -->
  <div class="card" id="explorer">
    <h3>Team explorer <span class="rt" id="cfbTblAsOf"></span></h3>
    <p class="sub">Click any column to sort. The left band is <b>observed</b> &mdash; what happened,
    counted off the canonical schedule. The right band is <b>modelled</b> &mdash; one Elo system,
    fitted to nothing, graded against nothing. They are kept apart here because they are kept apart
    in the source file.</p>
    <div class="cfbwrap">
      <table class="cfbt" id="cfbTbl">
        <thead>
          <tr class="cfbgrp">
            <th class="obs" colspan="6">Observed &middot; 2025 results</th>
            <th class="mod cfbsep" colspan="5">Modelled &middot; dd-cfb-elo &middot; retrodictive, ungraded</th>
          </tr>
          <tr class="cfbhd">
            <th data-k="team" data-t="s" scope="col">Team</th>
            <th data-k="conference" data-t="s" scope="col">Conference</th>
            <th data-k="record" data-t="s" scope="col">Record</th>
            <th data-k="pf" data-t="n" scope="col">PF/G</th>
            <th data-k="pa" data-t="n" scope="col">PA/G</th>
            <th data-k="pd" data-t="n" scope="col">Diff/G</th>
            <th data-k="rank" data-t="n" class="cfbsep" scope="col">Elo rank</th>
            <th data-k="elo" data-t="n" scope="col">Elo</th>
            <th data-k="exp" data-t="n" scope="col">Exp W</th>
            <th data-k="obs" data-t="n" scope="col">Obs W</th>
            <th data-k="dw" data-t="n" scope="col">Obs &minus; Exp</th>
          </tr>
        </thead>
        <tbody id="cfbTblBody"></tbody>
      </table>
    </div>
    <p class="cfbcap"><b>Elo rank</b> orders this one system&rsquo;s numbers. It is not a poll, a
    committee ranking, or a claim about who is better now. <b>Exp W</b> sums that team&rsquo;s pregame
    Elo win probabilities across the 2025 walk-forward backtest, so <b>Obs &minus; Exp</b> is model
    residual &mdash; not luck, not team quality, and not a forecast.</p>
    <div class="cfbmore"><button class="btn ghost sm" id="cfbTblMore" type="button" hidden></button></div>
    <p class="cfbsrc" id="cfbTblSrc"></p>
  </div>

  <!-- ================= expected vs observed ================= -->
  <div class="card" id="expected">
    <h3>Expected versus observed wins</h3>
    <p class="sub">Every FBS team, plotted where the Elo expected it against where it finished.
    The diagonal is agreement. Distance from it is how wrong this rating was about that team
    across 2025 &mdash; which is the only claim the number supports.</p>
    <div class="cfbfig">
      <div class="cfbtip" id="cfbTip" role="status" aria-live="polite"></div>
      <svg id="cfbScatter" viewBox="0 0 620 420" role="img" tabindex="0"
        aria-label="Scatter chart of observed wins against Elo expected wins for every FBS team in 2025, with a diagonal agreement line."></svg>
    </div>
    <p class="cfbcap">Hover, or focus the chart and use the arrow keys, to read a team.
    Every point here is also a row in the team explorer above, where <b>Exp W</b>, <b>Obs W</b> and
    the difference are readable as text.</p>
  </div>

  <!-- ================= how good is the rating ================= -->
  <div class="card" id="baseline">
    <h3>How good is this rating, honestly <span class="rt" id="cfbEloAsOf"></span></h3>
    <p class="sub">A baseline only earns the name if it is scored against something. These are the
    published 2025 backtest numbers, read from the model&rsquo;s own output file. Lower Brier is better;
    higher favourite accuracy is better.</p>
    <div class="cfbkpis" id="cfbEloKpis"></div>
    <p class="cfbcap" id="cfbEloCap"></p>
    <p class="cfbsrc" id="cfbEloSrc"></p>
  </div>

  <!-- ================= divergence ================= -->
  <div class="card" id="divergence">
    <h3>Record versus scoring margin <span class="rt" id="cfbDivAsOf"></span></h3>
    <p class="sub">A team&rsquo;s win-percentage rank against its point-differential-per-game rank.
    A positive gap means the record ranks better than the scoring margin. This is a
    <b>descriptive</b> baseline: the published file carries a null label on every row, and nothing
    here calls a team overrated, underrated or a fraud.</p>
    <div class="cfbwrap">
      <table class="cfbt" id="cfbDiv">
        <thead>
          <tr class="cfbgrp"><th class="obs" colspan="8">Observed &middot; 2025 results, descriptive</th></tr>
          <tr class="cfbhd">
            <th data-k="team" data-t="s" scope="col">Team</th>
            <th data-k="conference" data-t="s" scope="col">Conference</th>
            <th data-k="record" data-t="s" scope="col">Record</th>
            <th data-k="rrank" data-t="n" scope="col">Win% rank</th>
            <th data-k="srank" data-t="n" scope="col">Margin rank</th>
            <th data-k="gap" data-t="n" scope="col">Gap</th>
            <th data-k="dir" data-t="s" scope="col">Direction</th>
            <th data-k="osr" data-t="s" scope="col">One-score</th>
          </tr>
        </thead>
        <tbody id="cfbDivBody"><tr><td colspan="8" style="color:var(--ink-3)">Loading&hellip;</td></tr></tbody>
      </table>
    </div>
    <div class="cfbmore"><button class="btn ghost sm" id="cfbDivMore" type="button" hidden></button></div>
    <p class="cfbcap" id="cfbDivCap"></p>
    <p class="cfbsrc" id="cfbDivSrc"></p>
  </div>

  <!-- ================= honesty ================= -->
  <div class="honesty" id="honesty" style="margin-top:16px">
    <h3>What this is, and what it isn&rsquo;t</h3>
    <p><b>It is one rating, not a consensus.</b> A single system cannot be a consensus, and this one
    has no blend weights because there is nothing to blend it with. Registry membership is not
    evidence of skill.</p>
    <p style="margin-top:10px"><b>It is retrodictive, not prospective.</b> The 2025 season was already
    complete when the backtest ran. Ratings only ever updated from games already played, which is what
    makes the numbers meaningful at all &mdash; but no row here was frozen before a kickoff, so no row
    is a receipt. The prospective ledger at <code>/data/cfb-model-receipts.json</code> is
    <b>empty by design</b> and will stay empty until a scheduled 2026 game is priced before it is played.</p>
    <p style="margin-top:10px"><b>There are no market prices on this page.</b> The historical CFB market
    file exists, but every quote in it shares its game&rsquo;s kickoff timestamp rather than an
    observation time. That means they are not closing lines and no closing-line value can be computed
    from them, so showing them beside a model number here would imply a comparison the data cannot
    support.</p>
    <p style="margin-top:10px"><b>What the rating cannot see.</b> Recruiting, the portal, rosters,
    injuries, weather, travel, play-by-play efficiency, opponent adjustment and coaching. It knows who
    won, by how much, and where. That is the entire feature set, on purpose &mdash; it is the floor a
    better CFB model has to clear.</p>
  </div>
"""

# ---------------------------------------------------------------- page JS ----
PAGE_JS = r"""<script>
/* ============================================================================
   cfb.html — the College Football lab
   ============================================================================
   ⚠️ NOTHING IS TYPED IN. Every number, label, formula, parameter and date rendered
   here is read out of the published /data/ envelopes at runtime. That is deliberate:
   a transcribed Brier score goes stale the first time the backtest is rebuilt and the
   page starts quietly lying. The build asserts that none of the current headline figures
   appears as a literal in this file. If a field is missing, the block that needs it says
   so and the rest of the page still works.

   ⚠️ OBSERVED AND MODELLED NEVER MERGE. cfb-teams.json keeps `observed_results` and
   `systems["dd-cfb-elo"]` as separate objects; the table keeps them as separate column
   bands and the copy keeps them as separate sentences. Do not add a column that mixes
   them (a "luck" or "true record" number is exactly the thing this data cannot support).

   Loading: cfb-teams.json (157 KB) is fetched on load because the calculator, the table
   and the chart all need it. cfb-elo.json and the two divergence files are fetched only
   when their section first scrolls into view — together they are another 180 KB and
   nobody needs them to use the calculator. */
(function(){
  "use strict";
  var SYS = "dd-cfb-elo";
  var $ = function(id){ return document.getElementById(id); };
  var esc = function(s){ return String(s == null ? "" : s)
    .replace(/[<>&"]/g, function(c){ return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]; }); };
  var n1 = function(v){ return v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1); };
  var n2 = function(v){ return v == null ? "—" : (Math.round(v * 100) / 100).toFixed(2); };
  var pct = function(v){ return v == null ? "—" : (v * 100).toFixed(1) + "%"; };
  var sgn = function(v){ return v == null ? "—" : (v > 0 ? "+" : "") + n1(v); };

  /* ---------- state ---------- */
  var TEAMS = [];        // flattened rows, observed and modelled kept as sibling fields
  var MX = null;         // the published matchup transform, straight out of the file
  var ENV = {};          // envelope metadata per file, for the source lines
  var DIV = [];          // divergence rows
  var filt = {conf:"", q:""};
  var sortT = {k:"rank", dir:1};
  var sortD = {k:"gap", dir:-1, abs:true};
  /* ⚠️ A 136-row table and a second 136-row table below it make a 9,000px page that
     nobody scrolls to the bottom of, and on a phone the nested scroller you would
     otherwise need swallows the page's own scroll gesture. So both tables open at
     PAGE_ROWS and expand on request. The count line above always reports the true
     number of matches, so the cap can never read as "that is all there is". */
  var PAGE_ROWS = 30;
  var openT = false, openD = false;

  function srcLine(env, url){
    if(!env) return "";
    var bits = [];
    if(env.as_of) bits.push("as_of " + esc(env.as_of));
    if(env.integrity && env.integrity.snapshot_id)
      bits.push("snapshot <code>" + esc(String(env.integrity.snapshot_id).slice(0, 23)) + "…</code>");
    return "Source: <a href=\"" + url + "\">" + url + "</a> &middot; " + bits.join(" &middot; ");
  }

  /* ================= load the primary surface ================= */
  fetch("/data/cfb-teams.json").then(function(r){
    if(!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function(env){
    ENV.teams = env;
    var d = env.data || {};
    var sysDef = (d.systems || []).filter(function(s){ return s.system_id === SYS; })[0] || {};
    MX = sysDef.matchup_probability || null;
    TEAMS = (d.teams || []).map(function(t){
      var o = t.observed_results || {};
      var m = (t.systems || {})[SYS] || {};
      var g = m.retrodictive_team_diagnostic || {};
      return {
        slug: t.team_slug, team: t.team, conference: t.conference,
        record: o.record, wins: o.wins, games: o.games,
        pf: o.points_for_per_game, pa: o.points_against_per_game, pd: o.point_differential_per_game,
        rank: m.rank, elo: m.team_strength, rated: m.games_rated,
        exp: g.expected_wins, obs: g.observed_wins, dw: g.actual_minus_expected_wins,
        brier: g.brier_win_probability, mpwp: g.mean_pregame_win_probability, dgames: g.games
      };
    });
    initConf(); initMatchup(); redraw();
    var stamp = (env.as_of ? "as of " + env.as_of : "") + (d.season ? " · " + d.season + " season" : "");
    $("cfbTblAsOf").textContent = stamp;
    $("cfbMxAsOf").textContent = (d.rating_period && d.rating_period.label) ? d.rating_period.label : stamp;
    $("cfbTblSrc").innerHTML = srcLine(env, "/data/cfb-teams.json");
  }).catch(function(e){
    $("cfbCount").textContent = "Could not load /data/cfb-teams.json — " + e.message;
    $("cfbMxErr").hidden = false;
    $("cfbMxErr").className = "note bad";
    $("cfbMxErr").textContent = "The calculator needs /data/cfb-teams.json and it did not load: " + e.message;
  });

  /* ================= filter row ================= */
  function initConf(){
    var seen = {}, out = [];
    TEAMS.forEach(function(t){ if(t.conference && !seen[t.conference]){ seen[t.conference] = 1; out.push(t.conference); } });
    out.sort();
    var sel = $("cfbConf");
    out.forEach(function(c){
      var o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
    });
  }
  function matches(t){
    if(filt.conf && t.conference !== filt.conf) return false;
    if(filt.q && String(t.team).toLowerCase().indexOf(filt.q) < 0) return false;
    return true;
  }
  $("cfbConf").addEventListener("change", function(){ filt.conf = this.value; redraw(); });
  $("cfbQ").addEventListener("input", function(){ filt.q = this.value.trim().toLowerCase(); redraw(); });

  function redraw(){
    var rows = TEAMS.filter(matches);
    $("cfbCount").textContent = rows.length + " of " + TEAMS.length + " FBS teams"
      + (filt.conf ? " · " + filt.conf : "") + (filt.q ? " · matching “" + filt.q + "”" : "");
    drawTable(rows);
    drawScatter(rows);
    drawDiv();
    stash();
  }

  /* The page's state lives inside this IIFE and escapes only into the DOM, so anything
     Toto needs is stashed on window.__CFB. Same pattern as guillotine.html's window.__GX.
     ⚠️ Stash FACTS, already labelled. Toto's context builder must never have to decide
     whether a number is observed or modelled. */
  function stash(){
    var w = window.__CFB || (window.__CFB = {});
    w.as_of = (ENV.teams && ENV.teams.as_of) || null;
    w.teams = TEAMS;
    w.filter = (filt.conf || filt.q)
      ? [filt.conf ? "conference " + filt.conf : "", filt.q ? "name contains “" + filt.q + "”" : ""]
          .filter(Boolean).join(", ")
      : "none";
  }

  /* ================= sorting ================= */
  function cmp(a, b, k, type, dir, abs){
    var x = a[k], y = b[k];
    if(x == null && y == null) return 0;
    if(x == null) return 1;          // missing always sinks, in both directions
    if(y == null) return -1;
    if(type === "s") return String(x).localeCompare(String(y)) * dir;
    if(abs){ x = Math.abs(x); y = Math.abs(y); }
    return (x - y) * dir;
  }
  function wireSort(tableId, state, after){
    var ths = document.querySelectorAll("#" + tableId + " thead tr.cfbhd th");
    Array.prototype.forEach.call(ths, function(th){
      th.addEventListener("click", function(){
        var k = th.getAttribute("data-k");
        if(state.k === k){ state.dir = -state.dir; }
        else { state.k = k; state.dir = (th.getAttribute("data-t") === "s") ? 1 : -1; state.abs = false; }
        after();
      });
    });
  }
  function markSort(tableId, state){
    var ths = document.querySelectorAll("#" + tableId + " thead tr.cfbhd th");
    Array.prototype.forEach.call(ths, function(th){
      if(th.getAttribute("data-k") === state.k)
        th.setAttribute("aria-sort", state.dir === 1 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  }

  /* ================= the explorer ================= */
  function drawTable(rows){
    var ths = document.querySelectorAll("#cfbTbl thead tr.cfbhd th");
    var type = "n";
    Array.prototype.forEach.call(ths, function(th){
      if(th.getAttribute("data-k") === sortT.k) type = th.getAttribute("data-t");
    });
    var s = rows.slice().sort(function(a, b){ return cmp(a, b, sortT.k, type, sortT.dir, false); });
    var btn = $("cfbTblMore");
    if(s.length > PAGE_ROWS){
      btn.hidden = false;
      btn.textContent = openT ? "Show the first " + PAGE_ROWS : "Show all " + s.length + " teams";
    } else { btn.hidden = true; }
    if(!openT) s = s.slice(0, PAGE_ROWS);
    var h = s.map(function(t){
      return "<tr><td class=\"tm\">" + esc(t.team) + "</td>"
        + "<td class=\"cf\">" + esc(t.conference) + "</td>"
        + "<td>" + esc(t.record) + "</td>"
        + "<td>" + n1(t.pf) + "</td><td>" + n1(t.pa) + "</td><td>" + sgn(t.pd) + "</td>"
        + "<td class=\"cfbsep\">" + (t.rank == null ? "—" : t.rank) + "</td>"
        + "<td>" + n1(t.elo) + "</td>"
        + "<td>" + n1(t.exp) + "</td><td>" + (t.obs == null ? "—" : t.obs) + "</td>"
        + "<td>" + sgn(t.dw) + "</td></tr>";
    }).join("");
    $("cfbTblBody").innerHTML = h || "<tr><td colspan=\"11\" style=\"color:var(--ink-3)\">No team matches this filter.</td></tr>";
    markSort("cfbTbl", sortT);
  }
  wireSort("cfbTbl", sortT, function(){ redraw(); });
  $("cfbTblMore").addEventListener("click", function(){ openT = !openT; redraw(); });

  /* ================= the matchup calculator ================= */
  function initMatchup(){
    var byName = TEAMS.slice().sort(function(a, b){ return String(a.team).localeCompare(String(b.team)); });
    ["cfbHome", "cfbAway"].forEach(function(id){
      var sel = $(id);
      byName.forEach(function(t){
        var o = document.createElement("option");
        o.value = t.slug; o.textContent = t.team + " · " + t.conference;
        sel.appendChild(o);
      });
    });
    /* Default to the two highest-rated teams so the card shows real output on load
       instead of an empty state the reader has to earn. */
    var top = TEAMS.slice().filter(function(t){ return t.rank != null; })
                   .sort(function(a, b){ return a.rank - b.rank; });
    if(top.length > 1){ $("cfbHome").value = top[0].slug; $("cfbAway").value = top[1].slug; }
    ["cfbHome", "cfbAway", "cfbVenue"].forEach(function(id){
      $(id).addEventListener("change", calcMatchup);
    });
    calcMatchup();
  }
  function bySlug(s){
    for(var i = 0; i < TEAMS.length; i++) if(TEAMS[i].slug === s) return TEAMS[i];
    return null;
  }
  function calcMatchup(){
    var err = $("cfbMxErr"), out = $("cfbMxOut");
    var h = bySlug($("cfbHome").value), a = bySlug($("cfbAway").value);
    /* ⚠️ Fail closed on a missing transform. If the registry ever stops publishing
       matchup_probability, or marks it unavailable, this page must NOT fall back to a
       formula typed in here — that would be this page inventing a model. */
    if(!MX || MX.available !== true || !MX.elo_scale){
      out.hidden = true; err.hidden = false; err.className = "note bad";
      err.textContent = "The ratings registry is not publishing a matchup transform, so this "
        + "calculator has nothing to apply. It will not guess one.";
      return;
    }
    if(!h || !a || h.elo == null || a.elo == null){
      out.hidden = true; err.hidden = false; err.className = "note warn";
      err.textContent = "One of those teams has no published team strength.";
      return;
    }
    if(h.slug === a.slug){
      out.hidden = true; err.hidden = false; err.className = "note warn";
      err.textContent = "Pick two different teams.";
      return;
    }
    err.hidden = true; out.hidden = false;
    var neutral = $("cfbVenue").value === "neutral";
    var hfa = neutral ? (MX.neutral_site_home_field_elo != null ? MX.neutral_site_home_field_elo : 0)
                      : (MX.home_field_elo != null ? MX.home_field_elo : 0);
    var diff = h.elo - a.elo + hfa;
    var p = 1 / (1 + Math.pow(10, -diff / MX.elo_scale));
    $("cfbMeterF").style.flex = Math.max(p, 0.001);
    $("cfbMeterT").style.flex = Math.max(1 - p, 0.001);
    $("cfbMeter").setAttribute("aria-label",
      esc(h.team) + " " + pct(p) + ", " + esc(a.team) + " " + pct(1 - p));
    $("cfbMxHome").innerHTML = esc(h.team) + (neutral ? "" : " (home)") + " <b>" + pct(p) + "</b>";
    $("cfbMxAway").innerHTML = esc(a.team) + (neutral ? "" : " (away)") + " <b>" + pct(1 - p) + "</b>";
    $("cfbMxGap").textContent = (diff > 0 ? "+" : "") + n1(diff);
    $("cfbMxGapR").textContent = neutral
      ? "Elo points, neutral site — no venue adjustment applied."
      : "Elo points, including the published +" + n1(MX.home_field_elo) + " home adjustment.";
    $("cfbMxHs").textContent = n1(h.elo);
    $("cfbMxHr").textContent = "rank " + (h.rank == null ? "—" : h.rank) + " of " + TEAMS.length
      + " · " + (h.rated == null ? "?" : h.rated) + " games rated";
    $("cfbMxAs").textContent = n1(a.elo);
    $("cfbMxAr").textContent = "rank " + (a.rank == null ? "—" : a.rank) + " of " + TEAMS.length
      + " · " + (a.rated == null ? "?" : a.rated) + " games rated";
    $("cfbMxFormula").textContent = MX.formula || "";
    $("cfbMxParams").textContent = "elo_scale " + MX.elo_scale
      + " · home_field_elo " + MX.home_field_elo
      + " · neutral " + MX.neutral_site_home_field_elo;
    var w = window.__CFB || (window.__CFB = {});
    w.matchup = h.team + (neutral ? " vs " : " (home) vs ") + a.team
      + (neutral ? " at a neutral site" : " (away)")
      + " — hypothetical end-of-2025 rating-period calculation: " + h.team + " " + pct(p)
      + ", " + a.team + " " + pct(1 - p) + ", rating gap " + (diff > 0 ? "+" : "") + n1(diff)
      + " Elo points. NOT a scheduled-game forecast";
  }

  /* ================= expected vs observed ================= */
  /* One series, one hue: this is a residual plot, not an identity plot, so colouring by
     conference would spend the only free channel on something the reader did not ask
     about — and eleven categorical hues is past every legibility ceiling anyway. Teams
     outside the current filter stay on the chart in the de-emphasis grey so the slice
     keeps its context; the survivors are never repainted. */
  var PTS = [];
  var VB = {w:620, h:420, l:52, r:16, t:24, b:52};
  function drawScatter(rows){
    var svg = $("cfbScatter");
    var all = TEAMS.filter(function(t){ return t.exp != null && t.obs != null; });
    if(!all.length){ svg.innerHTML = ""; return; }
    var keep = {};
    rows.forEach(function(t){ keep[t.slug] = 1; });
    var hi = 0;
    all.forEach(function(t){ hi = Math.max(hi, t.exp, t.obs); });
    hi = Math.ceil(hi / 2) * 2;
    var x0 = VB.l, x1 = VB.w - VB.r, y0 = VB.h - VB.b, y1 = VB.t;
    var X = function(v){ return x0 + (v / hi) * (x1 - x0); };
    var Y = function(v){ return y0 + (v / hi) * (y1 - y0); };
    var step = hi > 12 ? 4 : 2;
    var s = [];
    // grid + ticks, solid hairlines one step off the surface
    for(var v = 0; v <= hi; v += step){
      s.push('<line x1="' + X(0).toFixed(1) + '" y1="' + Y(v).toFixed(1) + '" x2="' + X(hi).toFixed(1)
        + '" y2="' + Y(v).toFixed(1) + '" stroke="var(--grid)" stroke-width="1"/>');
      s.push('<line x1="' + X(v).toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + X(v).toFixed(1)
        + '" y2="' + Y(hi).toFixed(1) + '" stroke="var(--grid)" stroke-width="1"/>');
      s.push('<text x="' + (X(0) - 8).toFixed(1) + '" y="' + Y(v).toFixed(1)
        + '" font-size="10" fill="var(--ink-3)" text-anchor="end" dy="3.5">' + v + '</text>');
      s.push('<text x="' + X(v).toFixed(1) + '" y="' + (Y(0) + 16).toFixed(1)
        + '" font-size="10" fill="var(--ink-3)" text-anchor="middle">' + v + '</text>');
    }
    s.push('<line x1="' + X(0).toFixed(1) + '" y1="' + Y(0).toFixed(1) + '" x2="' + X(hi).toFixed(1)
      + '" y2="' + Y(hi).toFixed(1) + '" stroke="var(--axis)" stroke-width="2" stroke-linecap="round"/>');
    s.push('<text x="' + (X(hi) - 4).toFixed(1) + '" y="' + (Y(hi) + 14).toFixed(1)
      + '" font-size="10.5" fill="var(--ink-3)" text-anchor="end">model agreed</text>');
    s.push('<text x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (VB.h - 12)
      + '" font-size="11" fill="var(--ink-2)" text-anchor="middle">Expected wins — Elo, retrodictive</text>');
    s.push('<text x="14" y="' + ((y0 + y1) / 2).toFixed(1)
      + '" font-size="11" fill="var(--ink-2)" text-anchor="middle" transform="rotate(-90 14 '
      + ((y0 + y1) / 2).toFixed(1) + ')">Observed wins</text>');

    PTS = [];
    var on = [], off = [];
    all.forEach(function(t){
      var p = {t:t, x:X(t.exp), y:Y(t.obs), on:!!keep[t.slug]};
      PTS.push(p);
      (p.on ? on : off).push(p);
    });
    off.forEach(function(p){
      s.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1)
        + '" r="3" fill="var(--ink-3)" opacity="0.28"/>');
    });
    on.forEach(function(p){
      s.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1)
        + '" r="4" fill="var(--accent)" stroke="var(--surface-1)" stroke-width="2" opacity="0.92"/>');
    });
    // direct-label the two extremes only; the axis and the tooltip carry the rest
    var lab = on.slice().sort(function(a, b){ return a.t.dw - b.t.dw; });
    if(lab.length > 3){
      [lab[0], lab[lab.length - 1]].forEach(function(p){
        var anchor = p.x > (x0 + x1) / 2 ? "end" : "start";
        var dx = anchor === "end" ? -9 : 9;
        s.push('<text x="' + (p.x + dx).toFixed(1) + '" y="' + (p.y + 4).toFixed(1)
          + '" font-size="10.5" fill="var(--ink-2)" text-anchor="' + anchor + '">'
          + esc(p.t.team) + ' ' + sgn(p.t.dw) + '</text>');
      });
    }
    s.push('<circle id="cfbHi" r="7" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0"/>');
    svg.innerHTML = s.join("");
  }

  /* nearest-point layer: a 4px dot is an impossible hit target, so the whole plot is
     the target and the nearest team inside a generous radius wins */
  var tip = $("cfbTip"), kbi = -1;
  function svgPt(evt){
    var svg = $("cfbScatter"), pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var m = svg.getScreenCTM();
    if(!m) return null;
    return pt.matrixTransform(m.inverse());
  }
  function showTip(p){
    if(!p){ tip.classList.remove("on"); var hi0 = $("cfbHi"); if(hi0) hi0.setAttribute("opacity", "0"); return; }
    var t = p.t;
    tip.innerHTML = "<b>" + esc(t.team) + "</b>"
      + esc(t.conference) + " · " + esc(t.record) + "<br>"
      + "<span>Expected " + n1(t.exp) + " · observed " + t.obs + " · " + sgn(t.dw) + "</span><br>"
      + "<span>Elo " + n1(t.elo) + " · rank " + t.rank + "</span>";
    var svg = $("cfbScatter"), r = svg.getBoundingClientRect();
    var sx = r.width / VB.w, sy = r.height / VB.h;
    var left = p.x * sx + 14, top = p.y * sy - 10;
    if(left + 236 > r.width) left = p.x * sx - 236;
    if(left < 0) left = 0;
    if(top < 0) top = 0;
    tip.style.left = left + "px"; tip.style.top = top + "px";
    tip.classList.add("on");
    var hi = $("cfbHi");
    if(hi){ hi.setAttribute("cx", p.x.toFixed(1)); hi.setAttribute("cy", p.y.toFixed(1)); hi.setAttribute("opacity", "1"); }
  }
  function nearest(pt){
    var best = null, bd = 26 * 26;
    PTS.forEach(function(p){
      if(!p.on) return;
      var dx = p.x - pt.x, dy = p.y - pt.y, d = dx * dx + dy * dy;
      if(d < bd){ bd = d; best = p; }
    });
    return best;
  }
  $("cfbScatter").addEventListener("pointermove", function(e){
    var pt = svgPt(e); if(!pt) return;
    showTip(nearest(pt));
  });
  $("cfbScatter").addEventListener("pointerleave", function(){ showTip(null); });
  $("cfbScatter").addEventListener("blur", function(){ showTip(null); });
  $("cfbScatter").addEventListener("keydown", function(e){
    var live = PTS.filter(function(p){ return p.on; })
                  .sort(function(a, b){ return a.t.exp - b.t.exp; });
    if(!live.length) return;
    if(e.key === "ArrowRight" || e.key === "ArrowDown"){ kbi = (kbi + 1) % live.length; }
    else if(e.key === "ArrowLeft" || e.key === "ArrowUp"){ kbi = (kbi - 1 + live.length) % live.length; }
    else if(e.key === "Escape"){ showTip(null); return; }
    else return;
    e.preventDefault();
    showTip(live[kbi]);
  });

  /* ================= lazy: backtest + divergence ================= */
  var lazyDone = false;
  function loadLazy(){
    if(lazyDone) return;
    lazyDone = true;
    fetch("/data/cfb-elo.json").then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
      .then(drawElo)
      .catch(function(e){ $("cfbEloSrc").textContent = "Could not load /data/cfb-elo.json — " + e.message; });
    Promise.all([
      fetch("/data/cfb-record-divergence.json").then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); }),
      fetch("/data/cfb-record-divergence-validation.json").then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
    ]).then(function(a){ gotDiv(a[0], a[1]); })
      .catch(function(e){
        $("cfbDivBody").innerHTML = "<tr><td colspan=\"8\" style=\"color:var(--bad)\">Could not load /data/cfb-record-divergence.json — "
          + esc(e.message) + "</td></tr>";
      });
  }
  /* ⚠️ IntersectionObserver DOES NOT DELIVER RECORDS WHILE THE DOCUMENT IS HIDDEN.
     A background tab never runs the rendering steps the spec computes intersections
     in, so a page opened in a background tab sat on "Loading…" forever. Found by
     verifying the live page from an automation tab, which is always hidden — the
     local suite never caught it because a Playwright page is visible.
     So the observer is the FAST path, not the only path. A rect check on scroll,
     resize and visibilitychange covers everything it misses, and loadLazy latches,
     so nothing can double-fetch. */
  function nearView(){
    var el = $("baseline");
    if(!el) return false;
    var r = el.getBoundingClientRect(), vh = window.innerHeight || 800;
    return r.top < vh + 400 && r.bottom > -400;
  }
  function maybeLazy(){ if(nearView()) loadLazy(); }
  if("IntersectionObserver" in window){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(en){ if(en.isIntersecting){ loadLazy(); io.disconnect(); } });
    }, {rootMargin:"400px"});
    io.observe($("baseline"));
  }
  window.addEventListener("scroll", maybeLazy, {passive:true});
  window.addEventListener("resize", maybeLazy, {passive:true});
  document.addEventListener("visibilitychange", maybeLazy);
  maybeLazy();

  function drawElo(env){
    var d = env.data || {}, bt = d.backtest || {}, base = bt.elo_baseline || {}, ref = bt.reference_points || {};
    var vm = bt.versus_market || null;
    $("cfbEloAsOf").textContent = env.as_of ? "as of " + env.as_of : "";
    var k = [];
    k.push(kpi("Brier, home win", n2(base.brier_home_win),
      "over " + (bt.n_games || "?") + " FBS-vs-FBS finals. Always guessing the base rate scores "
      + n2(ref.climatological_brier) + "."));
    k.push(kpi("Favourite accuracy", pct(base.favorite_accuracy),
      "against " + pct(ref.always_pick_home_accuracy) + " for always picking the home team."));
    if(ref.espn_pregame_elo_favorite_accuracy != null)
      k.push(kpi("ESPN pregame Elo", pct(ref.espn_pregame_elo_favorite_accuracy),
        "favourite accuracy only, on the same games. No probability comparison is possible."));
    if(vm && vm.market_median_devig && vm.elo_baseline_same_games)
      k.push(kpi("Market, same games", n2(vm.market_median_devig.brier_home_win),
        "Brier over " + vm.n_games + " games where a price exists. This Elo scores "
        + n2(vm.elo_baseline_same_games.brier_home_win) + " on those same games."));
    $("cfbEloKpis").innerHTML = k.join("");
    $("cfbEloCap").innerHTML = "The plain Elo losing to the market is the expected and correct result, "
      + "and it is recorded rather than buried so a future CFB model can be judged against something "
      + "real. <b>The comparison also flatters the market</b>: those prices carry no observation "
      + "timestamp, so some of the gap may be a later look at the same world rather than better "
      + "modelling. Parameters were fixed before the evaluation season and nothing was tuned on it.";
    $("cfbEloSrc").innerHTML = srcLine(env, "/data/cfb-elo.json")
      + (d.params ? " &middot; k " + d.params.k_factor + " &middot; home " + d.params.home_field_elo
         + " &middot; burn-in " + (d.params.burn_in_seasons || []).join("–") : "");
    var w = window.__CFB || (window.__CFB = {});
    w.backtest = "retrodictive 2025, " + (bt.n_games || "?") + " FBS-vs-FBS finals. Elo Brier "
      + n2(base.brier_home_win) + " / favourite accuracy " + pct(base.favorite_accuracy)
      + "; always-pick-home " + pct(ref.always_pick_home_accuracy)
      + "; climatological Brier " + n2(ref.climatological_brier)
      + (vm && vm.market_median_devig
          ? "; on the " + vm.n_games + " priced games the market's median devigged price scored Brier "
            + n2(vm.market_median_devig.brier_home_win) + " and this Elo scored "
            + n2(vm.elo_baseline_same_games.brier_home_win)
            + " — and that market comparison flatters the market, because those prices carry no observation timestamp"
          : "");
  }
  function kpi(label, value, rest){
    return "<div class=\"cfbkpi\"><div class=\"k\">" + esc(label) + "</div><div class=\"v\">"
      + esc(value) + "</div><div class=\"r\">" + rest + "</div></div>";
  }

  function gotDiv(env, val){
    ENV.div = env;
    DIV = ((env.data || {}).rows || []).map(function(r){
      var os = r.one_score_games || {};
      return {
        slug: r.team_slug, team: r.team, conference: r.conference, record: r.record,
        rrank: r.record_rank, srank: r.scoring_rank, gap: r.record_scoring_rank_gap,
        dir: r.descriptive_direction,
        osr: (os.wins == null ? "—" : os.wins + "-" + os.losses + (os.ties ? "-" + os.ties : ""))
      };
    });
    $("cfbDivAsOf").textContent = env.as_of ? "as of " + env.as_of : "";
    var defs = (env.data || {}).definitions || {};
    var cap = defs.record_scoring_rank_gap ? esc(defs.record_scoring_rank_gap) : "";
    var pv = (env.data || {}).predictive_validation || {};
    if(val && val.data && val.data.result && val.data.result.holdout){
      var ho = val.data.result.holdout;
      var d1 = ho.delta_versus_elo || ho.deltas || null;
      cap += " The hypothesis has been tested once, chronologically and out of sample: "
        + (val.data.result.qualified_games || "?") + " qualified games, "
        + (ho.n_games || "?") + " held out at a whole-kickoff boundary"
        + (d1 && d1.brier_home_win != null
            ? ", Brier moved " + (d1.brier_home_win > 0 ? "+" : "") + d1.brier_home_win.toFixed(6) + " against Elo alone"
            : "")
        + ". That is a small retrodictive signal, not a verdict on any team.";
    }
    if(pv.forward_value_claimed === false)
      cap += " The file claims <b>no forward value</b> and permits <b>no team labels</b>; both flags are read from it, not asserted here.";
    $("cfbDivCap").innerHTML = cap;
    $("cfbDivSrc").innerHTML = srcLine(env, "/data/cfb-record-divergence.json");
    drawDiv();
  }
  function drawDiv(){
    if(!DIV.length) return;
    var rows = DIV.filter(function(r){
      if(filt.conf && r.conference !== filt.conf) return false;
      if(filt.q && String(r.team).toLowerCase().indexOf(filt.q) < 0) return false;
      return true;
    });
    var ths = document.querySelectorAll("#cfbDiv thead tr.cfbhd th");
    var type = "n";
    Array.prototype.forEach.call(ths, function(th){
      if(th.getAttribute("data-k") === sortD.k) type = th.getAttribute("data-t");
    });
    var s = rows.slice().sort(function(a, b){ return cmp(a, b, sortD.k, type, sortD.dir, sortD.abs); });
    var btn = $("cfbDivMore");
    if(s.length > PAGE_ROWS){
      btn.hidden = false;
      btn.textContent = openD ? "Show the first " + PAGE_ROWS : "Show all " + s.length + " teams";
    } else { btn.hidden = true; }
    if(!openD) s = s.slice(0, PAGE_ROWS);
    $("cfbDivBody").innerHTML = s.map(function(r){
      return "<tr><td class=\"tm\">" + esc(r.team) + "</td><td class=\"cf\">" + esc(r.conference) + "</td>"
        + "<td>" + esc(r.record) + "</td><td>" + r.rrank + "</td><td>" + r.srank + "</td>"
        + "<td>" + (r.gap > 0 ? "+" : "") + r.gap + "</td>"
        + "<td class=\"cfbdir\" style=\"text-align:left;font-size:11.5px;color:var(--ink-2)\">"
        + esc(String(r.dir || "").replace(/-/g, " ")) + "</td>"
        + "<td>" + esc(r.osr) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"8\" style=\"color:var(--ink-3)\">No team matches this filter.</td></tr>";
    markSort("cfbDiv", sortD);
  }
  wireSort("cfbDiv", sortD, function(){ drawDiv(); });
  $("cfbDivMore").addEventListener("click", function(){ openD = !openD; drawDiv(); });
})();
</script>
<script>
/* ---------------- Toto's surface: the College Football lab ----------------
   ⚠️ The system block is where the honesty constraints have to be repeated, because
   Toto answers from it and not from the page copy. Every limit stated on the page is
   restated here as an instruction, so he cannot be talked past one. */
window.DD_BOTCTX = {
  label: 'CURRENT COLLEGE FOOTBALL LAB STATE',
  title: 'Ask Toto — he reads this page',
  chrome: {sub:'reads the CFB lab', ph:'Ask Toto about the CFB data…', chips:[
    ['What does the Elo actually know, and what can it not see?','What it knows'],
    ['Which teams did this rating get most wrong in 2025, and what does that mean?','Biggest misses'],
    ['Is this rating any good compared to the market?','Any good?'],
    ['Why is there no 2026 forecast on this page?','No 2026?']]},
  sys: `RIGHT NOW you are on the College Football Lab. It shows 136 FBS teams' OBSERVED 2025 results beside ONE modelled Elo rating, plus a matchup calculator, an expected-versus-observed chart and a descriptive record-versus-scoring-margin table.
- ⚠️ THE SEASON IS 2025 AND ONLY 2025. There is no 2026 schedule in this data. Never produce a 2026 prediction, ranking, or game pick. If asked for one, say plainly that the data does not support it and what would be needed.
- ⚠️ THE ELO IS RETRODICTIVE AND UNGRADED. The 2025 season was already over when the backtest ran. It has never issued a forecast before a kickoff. The prospective receipt ledger is EMPTY BY DESIGN. Never call it graded, proven, or a track record.
- ⚠️ IT IS ONE SYSTEM, NOT A CONSENSUS, AND ELO RANK IS NOT A POWER RANKING. It has no blend weights because there is nothing to blend with.
- ⚠️ EXPECTED WINS IS MODEL RESIDUAL, NOT LUCK. "Actual minus expected" describes where this rating was wrong. It is not a luck estimate, not a true-talent estimate, and not a forecast. Say so whenever you quote one.
- ⚠️ NO MARKET PRICES ARE ON THIS PAGE. The historical CFB market file has NO observation timestamp, so those are not closing lines and no closing-line value can be computed. The one market number quoted here is an aggregate Brier score on the same games, and even that flatters the market for the same reason.
- ⚠️ THE MATCHUP CALCULATOR IS A HYPOTHETICAL. It applies the published end-of-2025 transform to two frozen ratings. It is not a scheduled-game forecast and it produces no spread or total.
- ⚠️ THE DIVERGENCE TABLE IS DESCRIPTIVE. Every predictive label in the source file is null. Never call a team overrated, underrated, or a fraud.
- The rating sees game results, margin and site. It does NOT see recruiting, the portal, rosters, injuries, weather, travel, play-by-play efficiency or opponent strength adjustment.`,
  ctx(){
    var L = [];
    var w = window.__CFB || null;
    if(!w || !w.teams || !w.teams.length) return 'The College Football lab has not finished loading its data, so there is no state to read yet.';
    L.push('SEASON 2025, as of ' + (w.as_of || 'unknown') + '. ' + w.teams.length + ' FBS teams.');
    L.push('FILTER IN EFFECT: ' + (w.filter || 'none') + '.');
    L.push('MATCHUP CALCULATOR: ' + (w.matchup || 'nothing selected') + '.');
    L.push('TOP 15 BY THIS ONE ELO (modelled, retrodictive, ungraded — NOT a power ranking):');
    L.push('rank | team | conference | elo | observed record | expected wins | observed wins | obs-exp');
    w.teams.slice().sort(function(a,b){ return (a.rank||999)-(b.rank||999); }).slice(0,15).forEach(function(t){
      L.push(t.rank + ' | ' + t.team + ' | ' + t.conference + ' | ' + t.elo + ' | ' + t.record + ' | '
        + (t.exp==null?'?':t.exp.toFixed(2)) + ' | ' + t.obs + ' | ' + (t.dw==null?'?':(t.dw>0?'+':'')+t.dw.toFixed(2)));
    });
    var byd = w.teams.filter(function(t){ return t.dw != null; }).sort(function(a,b){ return b.dw-a.dw; });
    L.push('THE FIVE TEAMS THIS RATING UNDER-EXPECTED MOST (observed wins above expected — model residual, NOT luck):');
    byd.slice(0,5).forEach(function(t){ L.push(t.team + ' | ' + t.record + ' | expected ' + t.exp.toFixed(2) + ' | observed ' + t.obs + ' | +' + t.dw.toFixed(2)); });
    L.push('THE FIVE IT OVER-EXPECTED MOST:');
    byd.slice(-5).reverse().forEach(function(t){ L.push(t.team + ' | ' + t.record + ' | expected ' + t.exp.toFixed(2) + ' | observed ' + t.obs + ' | ' + t.dw.toFixed(2)); });
    if(w.backtest) L.push('PUBLISHED 2025 BACKTEST (retrodictive): ' + w.backtest);
    L.push('⚠️ Nothing above is a 2026 claim. No forecast in this data was issued before a kickoff.');
    return L.join('\n');
  }
};
</script>"""

# ---------------------------------------------------------------- assemble ----
# ⚠️ CSS, BODY, PAGE_JS and FOOTER are each a single `NAME = r"""..."""` block, and they
# have to stay that way. The browser-side deploy path (work/README + the session notes)
# extracts them out of this file by those exact markers rather than re-sending 45 KB of
# page source through a chat transcript. A SHA-256 check against the file built here is
# what makes that safe, but a reformatted marker turns a cheap deploy into a puzzle.

i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]
head = re.sub(r"<title>.*?</title>", "<title>College Football Lab — Data Dawgs</title>",
              head, count=1, flags=re.S)
i_css = once(head, "\n</style>", "style close")
head = head[:i_css] + "\n" + CSS.strip("\n") + head[i_css:]

i_body = once(src, '  <div class="lab-hd">', "body content start")
shell = src[i_head:i_body]
shell = shell.replace('data-page="connect"', 'data-page="cfb"')
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "window.DDAuth" in shell, "nav shell lost DDAuth"
assert 'data-page="cfb"' in shell, "page key not stamped"

FOOTER = r"""  <footer>
    College football source: SportsDataverse <a href="https://github.com/sportsdataverse/cfbfastR-data" target="_blank" rel="noopener">cfbfastR-data</a> schedules, canonicalized to <code>/data/cfb-schedule.json</code>; the Elo is Data Dawgs&rsquo; own and is retrodictive and ungraded. Upstream licence not independently verified.<br><a class="udmach" href="/data/cfb-teams.json">🤖 For machines</a> · This site is mirrored for machines. 🙃 shows you the other side.
  </footer>"""

out = head + shell + BODY + "\n" + FOOTER + "\n</div>\n\n" + PAGE_JS + "\n</body>\n</html>\n"
OUT.write_text(out, encoding="utf-8")

# ---- proofs, in the build, so a broken stamp cannot reach a commit ----
for must in ['id="nav"', 'data-page="cfb"', "window.DDAuth", "cfbScatter", "cfbTblBody",
             "cfbDivBody", "cfbMxFormula", "/data/cfb-teams.json", "/data/cfb-elo.json",
             "/data/cfb-record-divergence.json", "DD_BOTCTX", 'id="matchup"',
             "empty by design", "retrodictive"]:
    assert must in out, f"missing {must}"
assert "<title>College Football Lab — Data Dawgs</title>" in out, "title not swapped"
assert 'data-page="connect"' not in out, "template page key leaked"
assert out.count("cMint") == 0 and out.count("cSignedOut") == 0, "connect body leaked through"
# the honesty constraints are load-bearing copy; a silent deletion is a regression
for claim in ["no market prices on this page", "not a consensus", "hypothetical, not a forecast",
              "2025 only", "empty by design"]:
    assert claim.lower() in out.lower(), f"honesty claim dropped: {claim}"
# no page may hardcode a headline number the source file owns
for typed in ["0.7017", "0.1862", "0.1814", "0.7241"]:
    assert typed not in out, f"{typed} is typed in; read it from the envelope instead"
print(f"cfb.html  {len(out):,} bytes")
