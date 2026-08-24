"""
Build rankings.html — "The Dog Track" — from the shared page chrome plus this file's
content. Also builds rankings-admin.html.

⚠️ WHY A BUILDER AND NOT A HAND-EDITED PAGE.
The flattened HTML *is* the source in this repo, but the ~160KB of shared chrome (site
CSS, nav, navauth, theme, the DDSync client) is identical on every page and must stay that
way. Cloning a donor by hand means the next sitewide nav edit has to find this page too.
Every cut below is a CONTENT MARKER asserted to occur exactly once — never a line number,
which is the failure mode work/build_section_tools.py documents having hit twice.

Run:  python3 work/build_rankings.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DONOR = ROOT / "nfl.html"          # a hub page carrying the standard chrome

TITLE = "The Dog Track · Data Dawgs"
DESC = ("Weekly report card grading fantasy ranking services against actual PPR finishes. "
        "Spearman, weighted Kendall tau and points captured, with bootstrap intervals and "
        "photo-finish ties. Pre-registered methodology, receipts stamped every Thursday.")

# --------------------------------------------------------------------------- CSS ----
# Ported from work/dog-track-mockups-v2.html. The mockup's own palette variables are
# REMAPPED onto the site tokens (--accent, --ink-1, --good…) rather than redeclared, so the
# page follows the site theme in both light and dark instead of forking it. Trap #7: no
# webfonts — the LED look is mono plus text-shadow, exactly as the mockup does it.
CSS = r"""
/* ===================== The Dog Track ===================== */
.dt{--felt:color-mix(in srgb, var(--page) 88%, #000);--led:#ffb15e;
    --ledglow:rgba(255,106,2,.55);--dtwarn:var(--warn)}
:root[data-theme="light"] .dt{--felt:#efe7d4;--led:#d13a00;--ledglow:rgba(209,58,0,.25)}
.dt .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

.dt-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:12px 0;align-items:center}
.dt-tabs button{border:2px dashed color-mix(in srgb,var(--ink-3) 55%,transparent);
  background:var(--surface-1);color:var(--ink-2);font-size:12px;font-weight:800;
  padding:8px 13px;border-radius:50px;cursor:pointer;letter-spacing:.02em}
.dt-tabs button[aria-selected="true"]{background:var(--accent);border-color:#fff3;
  color:var(--accent-ink);box-shadow:0 0 12px var(--ledglow)}
.dt-view{display:none}.dt-view.on{display:block;animation:dtin .3s ease-out}
@keyframes dtin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.dt-vh{margin:2px 0;font-size:22px;font-weight:900;letter-spacing:.02em}
.dt-vh .neon{color:var(--led);text-shadow:0 0 9px var(--ledglow)}

.dt-explain{display:flex;gap:10px;background:color-mix(in srgb,var(--accent) 6%,var(--surface-1));
  border:1px solid color-mix(in srgb,var(--accent) 30%,var(--grid));border-radius:10px;
  padding:11px 13px;font-size:13px;color:var(--ink-2);margin:10px 0 14px;line-height:1.55}
.dt-explain .tag{flex-shrink:0;font-size:9.5px;font-weight:900;letter-spacing:.08em;
  color:var(--accent);writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;
  border-right:2px solid var(--accent);padding-right:8px}
.dt-explain b{color:var(--ink-1)}
@media(max-width:480px){.dt-explain .tag{writing-mode:horizontal-tb;transform:none;
  border-right:0;border-bottom:2px solid var(--accent);padding:0 0 6px}
  .dt-explain{flex-direction:column;gap:7px}}

.dt-ctl{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.dt-seg{display:flex;gap:6px;flex-wrap:wrap}
.dt-seg button{border:1.5px solid var(--grid);background:var(--surface-1);color:var(--ink-2);
  font-size:12px;font-weight:900;padding:6px 14px;border-radius:7px;cursor:pointer;
  font-family:ui-monospace,Menlo,monospace}
.dt-seg button[aria-pressed="true"]{background:var(--led);color:#140a02;border-color:var(--led);
  box-shadow:0 0 10px var(--ledglow)}
/* ⚠️ ON NARROW SCREENS THE CONTROL ROWS SCROLL, THEY DO NOT WRAP.
   Wrapping made the week row two lines tall at 390px, which pushed the far-right buttons
   into the fixed "Ask Toto" launcher's corner — W3/W4/W5 rendered inside the viewport and
   were unclickable. Every other page on the site has zero covered controls, so this was
   ours, not the chrome's. One scrollable row keeps the block short and clear of it. */
@media(max-width:520px){
  .dt-ctl{gap:8px;margin-bottom:10px}
  .dt-explain{padding:9px 11px;margin:8px 0 10px}
  .dt-vh{font-size:19px}
  .dt-seg{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;
    scrollbar-width:none;padding-bottom:2px;max-width:100%}
  .dt-seg::-webkit-scrollbar{display:none}
  .dt-seg button{flex:0 0 auto;padding:6px 11px}
}
.dt-weekbadge{display:inline-block;font-size:10px;font-weight:900;letter-spacing:.07em;
  padding:3px 9px;border-radius:4px;background:var(--dtwarn);color:#140a02;margin-bottom:12px}
.dt-foot{font-size:10.5px;color:var(--ink-3);margin-top:10px;line-height:1.5}

/* Board */
.dt-board{background:color-mix(in srgb,var(--page) 92%,#000);border:2px solid var(--grid);
  border-radius:12px;padding:6px 0;overflow-x:auto}
.dt-board table{width:100%;border-collapse:collapse;min-width:420px}
.dt-board th{font-size:9.5px;letter-spacing:.14em;color:var(--ink-3);text-transform:uppercase;
  padding:8px 10px;text-align:left;border-bottom:1px solid var(--grid)}
.dt-board td{padding:11px 10px;border-bottom:1px solid color-mix(in srgb,var(--grid) 60%,transparent);
  vertical-align:middle}
.dt-board tr:last-child td{border-bottom:none}
.dt-svc{font-weight:900;color:var(--ink-1);font-size:14px;letter-spacing:.03em;white-space:nowrap}
.dt-lanechip{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
  border-radius:5px;color:#fff;font-size:11px;font-weight:900;margin-right:8px;
  font-family:ui-monospace,Menlo,monospace}
.dt-lednum{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:19px;
  color:var(--led);text-shadow:0 0 8px var(--ledglow)}
.dt-ledci{display:block;font-size:9.5px;color:var(--ink-3);font-weight:400;letter-spacing:.03em}
.dt-pf{display:inline-block;font-size:9px;font-weight:900;letter-spacing:.09em;padding:2px 7px;
  border-radius:3px;background:var(--dtwarn);color:#140a02;animation:dtblink 1.6s steps(2) infinite}
@keyframes dtblink{50%{opacity:.55}}
.dt-trail{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.07em;padding:2px 7px;
  border-radius:3px;background:var(--grid);color:var(--ink-3)}

/* Race — trap #13: the container grows per lane rather than assuming four */
.dt-track{background:var(--felt);border:1px solid var(--grid);border-radius:12px;
  padding:14px 10px 8px;position:relative;overflow:hidden}
.dt-lane{position:relative;height:44px;border-bottom:1.5px dashed color-mix(in srgb,var(--ink-3) 30%,transparent)}
.dt-lane:last-of-type{border-bottom:none}
.dt-lane .who{position:absolute;left:6px;top:4px;font-size:10px;font-weight:900;color:var(--ink-3);letter-spacing:.06em}
.dt-dog{position:absolute;top:50%;transform:translate(-50%,-50%);transition:left 1.4s cubic-bezier(.2,.8,.25,1);
  display:flex;flex-direction:column;align-items:center}
.dt-dog .pup{font-size:21px;transform:scaleX(-1);filter:drop-shadow(0 0 5px var(--ledglow))}
.dt-dog .tagv{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:900;padding:0 5px;
  border-radius:3px;color:#fff}
.dt-finish{position:absolute;right:44px;top:0;bottom:26px;width:8px;
  background:repeating-conic-gradient(#fff 0 25%,#111 0 50%) 0 0/8px 8px;opacity:.7;border-radius:2px}
.dt-scale{display:flex;justify-content:space-between;font-size:9.5px;color:var(--ink-3);
  padding:6px 4px 0;font-family:ui-monospace,Menlo,monospace}
.dt-pfoverlay{position:absolute;right:10px;top:8px;z-index:3}
.dt-rerun{border:1.5px solid var(--accent);background:transparent;color:var(--accent);font-weight:900;
  font-size:11px;padding:5px 12px;border-radius:6px;cursor:pointer;margin-top:10px}

.dt-feltbox{background:var(--felt);border:1px solid var(--grid);border-radius:12px;padding:10px 6px 4px;overflow-x:auto}

/* Cage — trap #13: auto-fit, never repeat(4,1fr) */
.dt-cage{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:10px;align-items:end;
  background:var(--felt);border:1px solid var(--grid);border-radius:12px;padding:18px 10px 10px;min-height:240px}
.dt-stackcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:2px}
.dt-chip{width:100%;max-width:56px;height:11px;border-radius:6px;border:1.5px dashed rgba(255,255,255,.5);
  box-shadow:0 2px 0 rgba(0,0,0,.35);opacity:0;transform:translateY(-14px)}
.dt-chip.in{opacity:1;transform:none;transition:opacity .25s ease,transform .25s cubic-bezier(.2,.9,.3,1.3)}
.dt-stackval{font-family:ui-monospace,Menlo,monospace;font-weight:900;font-size:16px;margin-top:8px;
  color:var(--led);text-shadow:0 0 7px var(--ledglow)}
.dt-stackwho{font-size:11px;font-weight:900;color:var(--ink-2);letter-spacing:.05em;margin-top:1px;text-align:center}

/* Report card */
.dt-rc{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.dt-card{background:var(--surface-1);border:1.5px solid var(--grid);border-radius:12px;padding:14px;position:relative}
.dt-card.lead{border-color:var(--led);box-shadow:0 0 0 1px var(--led),0 0 16px var(--ledglow)}
.dt-rctop{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:10px}
/* The left column must be allowed to shrink (min-width:0) or the flex default of `auto`
   keeps it at its content width and the scope line breaks mid-token — "Weeks 1–" then "4"
   on the next line, which reads like a bug in the number. */
.dt-rctop>div:first-child{min-width:0;flex:1 1 auto}
.dt-rctop>div:last-child{flex:0 0 auto;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dt-scopeline{font-size:10.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dt-svcname{font-weight:900;font-size:15px}
.dt-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px}
.dt-grade{font-size:38px;font-weight:900;font-family:ui-monospace,Menlo,monospace;line-height:1;
  text-shadow:0 0 10px var(--ledglow)}
.dt-badge{display:inline-block;font-size:9.5px;font-weight:900;letter-spacing:.06em;padding:2px 7px;
  border-radius:3px;text-transform:uppercase}
.dt-badge.pf{background:var(--dtwarn);color:#140a02;animation:dtblink 1.6s steps(2) infinite}
.dt-badge.prov{background:color-mix(in srgb,var(--ink-3) 18%,transparent);color:var(--ink-3)}
.dt-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;text-align:center;margin-bottom:10px}
.dt-metrics .m{background:color-mix(in srgb,var(--grid) 45%,transparent);border-radius:7px;padding:8px 4px}
.dt-metrics .lab{color:var(--ink-3);font-size:9px;text-transform:uppercase;letter-spacing:.05em}
.dt-metrics .v{font-family:ui-monospace,Menlo,monospace;font-weight:900;font-size:15px;margin-top:2px;color:var(--ink-1)}
.dt-hyg{font-size:11px;color:var(--ink-3)}
.dt-hyg b{color:var(--dtwarn)}
.dt-spark{display:block;margin-top:8px}

/* ⚠️ A CLOSED <details> STILL REPORTS GEOMETRY IN CHROME. Its children keep a real
   bounding rect and a computed display of block, so anything measuring the page — the
   launcher-overlap guard, and DDBotScan, which walks the DOM to tell Toto what is on
   screen — sees the entire methodology as visible content sitting wherever it would be.
   That is how a closed drawer produced 6,648 px² of "unreachable" text under the fixed
   launcher at 390px. Hiding the body explicitly when the drawer is shut makes the DOM say
   what is actually true; [open] takes the rule off again. */
.dt-method:not([open]) .dt-methodbody{display:none}
.dt-method{margin-top:18px}
.dt-method summary{cursor:pointer;padding:10px 0;font-size:14px}
.dt-methodbody h4{margin:16px 0 6px;font-size:13px;letter-spacing:.02em}
.dt-methodbody p,.dt-methodbody li{font-size:13px;line-height:1.6;color:var(--ink-2);margin:0 0 8px}
.dt-methodbody ol{padding-left:20px;margin:0 0 8px}
.dt-empty{background:var(--surface-1);border:1px dashed var(--grid);border-radius:12px;padding:26px 18px;text-align:center}
.dt-empty h3{margin:0 0 8px;font-size:17px}
.dt-empty p{margin:0 auto;max-width:520px;color:var(--ink-2);font-size:13.5px;line-height:1.6}
.dt-err{background:color-mix(in srgb,var(--bad) 10%,var(--surface-1));border:1px solid var(--bad);
  border-radius:10px;padding:12px 14px;font-size:13px;color:var(--ink-1)}
@media (prefers-reduced-motion:reduce){
  .dt *,.dt *::after{animation:none!important;transition:none!important}
}
"""

# ------------------------------------------------------------------------- copy ----
# PLAIN ENGLISH explainer text, verbatim from the mockup (spec §4), with one necessary
# change: the mockup hard-codes "8 weeks of data" because it ships with eight weeks of
# sample data. That number is templated as {weeks} — a page that says "8 weeks" while
# showing three would be exactly the kind of uncheckable claim the site exists to avoid.
EXPLAIN = {
  "rc": ("The season grade, one card per service. The letter blends three things: "
         "<b>whole-list order</b> (Spearman), <b>getting the top guys right</b> (weighted &tau; — "
         "misses at the top cost more), and <b>points captured</b> (the money view). "
         "<b>Hygiene</b> counts how often a service left a ruled-OUT player ranked high on Thursday — "
         "sloppy, so we track it separately. Cards with the flashing lights are tied for the lead: "
         "a photo finish, not a champion."),
  "race": ("Same scores, run as a dog race. Each dog's position on the track is its "
           "<b>season accuracy so far</b> — further right is better. The checkered post is a perfect "
           "score, which nobody reaches. Dogs bunched together are in a <b>photo finish</b>: the season "
           "hasn't separated them yet. Hit <b>Re-run</b> to watch them come out of the gate again."),
  "board": ("Every Thursday before kickoff, each service hands in its rankings. After Monday night, "
            "we check how close each one's <b>order</b> was to how players <b>actually finished</b>. "
            "A score of <b>1.00</b> means the order was perfect; <b>0</b> means it was no better than "
            "shuffling names in a hat. The big number is each service's <b>season average so far</b>. "
            "If two services are inside each other's error bars, the board calls it a "
            "<b>PHOTO FINISH</b> — too close to name a winner yet."),
  "spread": ("One chip per week, per service. A chip far right = that service nailed that week's order; "
             "far left = a rough week. Notice every service has chips scattered all over — "
             "<b>week-to-week luck is huge</b>, and the scatter inside one service is bigger than the gap "
             "between services. That's why we won't crown a winner on <span data-dt-weeks>this much</span> "
             "data. The bar is each service's typical (median) week."),
  "cage": ("Forget correlations — this is the money view. Imagine the perfect lineup: the players who "
           "<b>actually</b> scored the most that week. Those points are the whole pot. Each service's chip "
           "stack shows <b>how much of the pot its top-ranked players grabbed</b>. 100% would mean their "
           "top group WAS the perfect group. A couple of points of difference &asymp; one busted start a week."),
}

FOOTS = {
  "rc": ("Grade = blended percentile of the three metrics vs. the field, shrunk. Provisional until the "
         "declared season gate. Every input snapshot is stamped by the server before Thursday kickoff."),
  "race": ("Dog position = season-to-date shrunk mean &rho; mapped onto the track (0.30 at the gate, 1.00 at "
           "the post). Bunching = overlapping confidence intervals."),
  "board": ("Score = mean weekly Spearman &rho; on the shared player pool, shrunk toward the field. Range under "
            "the number = bootstrap 95% CI. Everything is provisional until the declared season gate. "
            "Method &rarr; the drawer below."),
  "spread": "Each chip = one week's Spearman &rho;. Bar = median week.",
  "cage": ("Capture rate = points scored by each service's top-ranked group &divide; points scored by the actual "
           "top group, season to date. Differences under ~1.5 pts are noise at this sample."),
}

VIEWS = [("rc", "\U0001F3C6 Report Card", "Report <span class='neon'>Card</span>"),
         ("race", "\U0001F415 The Race", "The <span class='neon'>Race</span>"),
         ("board", "\U0001F3B0 The Board", "The <span class='neon'>Board</span>"),
         ("spread", "\U0001F3B2 Wild Weeks", "Wild <span class='neon'>Weeks</span>"),
         ("cage", "\U0001FA99 The Cage", "The <span class='neon'>Cage</span>")]


def views_html():
    out = []
    for key, _tab, heading in VIEWS:
        out.append(f"""
    <section class="dt-view{' on' if key == 'rc' else ''}" id="dt-view-{key}" role="tabpanel" aria-labelledby="dt-tab-{key}">
      <h2 class="dt-vh">{heading}</h2>
      <div class="dt-explain"><span class="tag">PLAIN ENGLISH</span><div>{EXPLAIN[key]}</div></div>
      <div class="dt-ctl">
        <div class="dt-seg" data-seg="scope" data-view="{key}" role="group" aria-label="Position scope"></div>
        <div class="dt-seg" data-seg="week" data-view="{key}" role="group" aria-label="Week"></div>
      </div>
      <div data-weekbadge="{key}"></div>
      <div data-body="{key}"></div>
      <div class="dt-foot">{FOOTS[key]}</div>
    </section>""")
    return "".join(out)


TABS = "".join(
    f'<button role="tab" id="dt-tab-{k}" aria-controls="dt-view-{k}" data-v="{k}"'
    f' aria-selected="{"true" if k == "rc" else "false"}">{t}</button>'
    for k, t, _h in VIEWS)

# --------------------------------------------------------------------- methodology --
# Spec §3, published BEFORE Week 1 and stated here as the pre-registration. The amendment
# rule is part of the content, not a footnote: a methodology that can change quietly is not
# pre-registered at all.
METHOD = r"""
<details class="dt-method" id="method">
  <summary><b>Methodology — pre-registered before Week 1</b></summary>
  <div class="dt-methodbody">
    <p><b>The claim being tested.</b> Whether a ranking service's Thursday order predicts the order players
    actually finish in, measured the same way every week, on rules fixed before the first snapshot.</p>

    <p><b>Amendment rule.</b> This section published before Week 1. Any change after Week 1 carries a dated
    note here saying what changed and why. If you are reading a number and cannot find the rule that produced
    it, that is a bug — say so.</p>

    <h4>What gets graded</h4>
    <p>An open entrants registry, not a fixed list. Each entrant is <span class="mono">{id, name, type, first_week, color}</span>.
    <b>The Blend</b> is the per-player mean rank across every service registered before Week 1's first kickoff;
    its membership <b>freezes at Week 1</b> and is named below. Entrants registered from Week 1 onward never
    join it — a benchmark that moves corrupts every comparison made against it.</p>

    <h4>Scoring</h4>
    <p>Full PPR points for that NFL week. Actual finish = within-position rank by PPR points, <b>mid-ranks for
    ties</b>. The pool per position per week is the union of the consensus top-N across uploaded services and
    the actual top-N by PPR, at depths <b>RB 36, WR 48, QB 24, TE 24</b>. A player a service left unranked is
    slotted at that service's deepest ranked player + 1, ordered by consensus — never dropped. Players who did
    not play (inactive, bye, ruled out) leave the correlation pool entirely.</p>

    <h4>The three metrics — all three, no fourth</h4>
    <ol>
      <li><b>Spearman &rho;</b> (headline) — the service's order against the actual order, across the whole pool.</li>
      <li><b>Weighted Kendall &tau;</b> — the same idea with hyperbolic weights on the actual finish
      (<span class="mono">w(r)=1/(r+1)</span>), so missing the RB1 costs far more than missing the RB30.</li>
      <li><b>Capture rate</b> — points scored by the service's top-G group divided by points scored by the
      actual top-G group. G is RB 12, WR 12, QB 6, TE 6.</li>
    </ol>
    <p><b>Hygiene</b> counts players who were officially OUT at capture time yet sat inside the startable range
    (top 24 RB/WR, top 12 QB/TE). It never touches the correlation.</p>

    <h4>Season aggregation and uncertainty</h4>
    <p>Season value = mean of the weekly values per position. The <b>ALL</b> scope is an equal-weight mean
    across the four positions — a declared choice, stated here because it is a choice. No dropped weeks, no
    mulligans. Confidence intervals are a bootstrap over weeks (resampled with replacement, 2,000 draws,
    percentile method) and are <b>seeded</b>, so rebuilding the page does not move a number that nothing
    changed. Scores are shrunk toward the field: <span class="mono">shrunk = field + 0.7 &times; (raw &minus; field)</span>
    until Week 10, and an empirical-Bayes weight after. The headline number is the shrunk one; the raw value
    and its interval sit underneath.</p>

    <h4>Ties, and what we refuse to claim</h4>
    <p>Any service whose interval upper bound reaches the leader's lower bound is <b>tied</b> with the leader
    and renders as a <b>PHOTO FINISH</b>. Head-to-head calls use only the weeks both entrants were graded; under
    four shared weeks we say "insufficient overlap" rather than pick. An entrant with fewer than four graded
    weeks is <b>provisional</b> regardless of its score. Single-week views show raw metrics only — no interval,
    no shrinkage — because one week is one observation.</p>

    <h4>Promotion gate, declared now</h4>
    <p>This page is a <b>Pup</b>. It becomes a Working Dawg at season's end only if at least one pair of
    services separates with non-overlapping shrunk intervals on the ALL scope. If no pair separates, this page
    will say so plainly and stay a Pup. "We could not tell them apart" is a result, and it is the one this
    kind of exercise usually produces.</p>

    <h4>Provenance</h4>
    <p>Every snapshot is stamped <span class="mono">captured_at</span> by the server, before that week's first
    kickoff, and is immutable once written. A bad upload is corrected by a logged void plus a fresh snapshot
    before kickoff — never by replacement. Raw third-party ranks are paid content: they never leave the
    server, and nothing player-level appears in this page or its machine surface. Only derived scores publish.</p>
  </div>
</details>
"""

# --------------------------------------------------------------------------- JS ----
JS = r"""
/* The Dog Track — renders entirely from GET /rankings/grades.
 *
 * ⚠️ TRAP #13: EVERY VIEW RENDERS N ENTRANTS, NOT FOUR. Lanes, board rows, cage columns and
 * report cards all come from the doc's entrant list, and the containers size themselves.
 * Registering a fifth service on launch day must be a paste, not a code change.
 * ⚠️ TRAP #12: colours come from the registry via the doc, never from an array index — a
 * mid-season entrant must not repaint everybody else.
 * ⚠️ TRAP #11: the week view is NOT the season view with n=1. It shows raw metrics, no
 * interval, no shrinkage, no photo-finish call, and it says so on the badge.
 */
(function(){
  var TOTO = "https://toto.jkapcar4.workers.dev";
  var SCOPES = ["ALL","RB","WR","QB","TE"];
  var VIEWS = ["rc","race","board","spread","cage"];
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var doc = null, err = null;
  var scope = {}, week = {};
  VIEWS.forEach(function(v){ scope[v]="ALL"; week[v]="SEASON"; });

  var $ = function(s,r){ return (r||document).querySelector(s); };
  var esc = function(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); };
  var fmt2 = function(x){ return (x==null||!isFinite(x)) ? "—" : x.toFixed(2).replace(/^0\./,"."); };
  var fmt1 = function(x){ return (x==null||!isFinite(x)) ? "—" : x.toFixed(1); };

  /* One accessor for both modes, so no renderer has to know which it is in. Season rows
     carry ci/grade/weekly_rho; week rows deliberately do not. */
  function rows(view){
    if(!doc || !doc.entrants) return [];
    var sc = scope[view], wk = week[view];
    var src = wk==="SEASON" ? ((doc.scopes||{})[sc]||{}) : (((doc.weeks||{})[wk]||{})[sc]||{});
    return Object.keys(src).map(function(id){
      var e = (doc.entrants||{})[id] || {};
      return { id:id, name:e.name||id, color:e.color||"#888", m:src[id]||{}, season:wk==="SEASON" };
    }).filter(function(r){ return r.m && (isFinite(r.m.rho)||isFinite(r.m.capture)); })
      .sort(function(a,b){ return (b.m.rho||-9) - (a.m.rho||-9); });
  }
  function weeksAvailable(){ return Object.keys((doc&&doc.weeks)||{}).map(Number).sort(function(a,b){return a-b;}); }

  function countUp(el, target, dec, suffix){
    if(target==null || !isFinite(target)){ el.textContent = "—"; return; }
    if(RM){ el.textContent = target.toFixed(dec).replace(/^0\./,".") + (suffix||""); return; }
    var t0 = performance.now();
    (function step(t){
      var k = Math.min(1,(t-t0)/800), e = 1-Math.pow(1-k,3);
      el.textContent = (target*e).toFixed(dec).replace(/^0\./,".") + (suffix||"");
      if(k<1) requestAnimationFrame(step);
    })(t0);
  }

  /* Trap #9: the sparkline scale is FIXED at .35–.85 and values outside it clamp. Rescaling
     per service would make two sparklines that look alike mean different things. */
  function spark(weekly, color){
    if(!weekly || weekly.length<2) return "";
    var W=104,H=22,lo=.35,hi=.85;
    var pts = weekly.map(function(v,i){
      var y = H - ((Math.max(lo,Math.min(hi,v))-lo)/(hi-lo))*(H-4) - 2;
      return (i/(weekly.length-1)*(W-2)+1).toFixed(1)+","+y.toFixed(1);
    }).join(" ");
    return '<svg class="dt-spark" viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" aria-hidden="true">'
      + '<polyline fill="none" stroke="'+esc(color)+'" stroke-width="1.6" points="'+pts+'"/></svg>';
  }

  function hygText(m){
    if(!doc || doc.hygiene_tracked !== true) return 'Hygiene: <b>not tracked yet</b> — the Thursday OUT list is not captured';
    var n = m.hygiene;
    if(n==null) return 'Hygiene: <b>not tracked yet</b>';
    return 'Hygiene: <b>'+n+'</b> OUT player'+(n===1?"":"s")+' left ranked at capture';
  }

  /* ---------------- renderers ---------------- */
  function renderRC(el){
    var rs = rows("rc");
    el.innerHTML = '<div class="dt-rc">' + rs.map(function(r){
      var tied = r.season && r.m.tied_with_leader;
      return '<div class="dt-card'+(tied?" lead":"")+'">'
        + '<div class="dt-rctop"><div><div class="dt-svcname"><span class="dt-dot" style="background:'+esc(r.color)+'"></span>'+esc(r.name)+'</div>'
        + '<div class="dt-scopeline">'+esc(scopeLabel("rc"))+'</div></div>'
        + '<div><div class="dt-grade" style="color:'+esc(r.color)+'">'+esc(r.season?(r.m.grade||"—"):"—")+'</div>'
        + (r.season
            ? (tied ? '<span class="dt-badge pf">📸 Photo finish</span>'
                    : '<span class="dt-badge prov">'+(r.m.provisional?"Provisional":"Season to date")+'</span>')
            : '<span class="dt-badge prov">One week</span>')
        + '</div></div>'
        + '<div class="dt-metrics">'
        + '<div class="m"><div class="lab">Order (ρ)</div><div class="v">'+fmt2(r.m.rho)+'</div></div>'
        + '<div class="m"><div class="lab">Top-heavy (τ)</div><div class="v">'+fmt2(r.m.tau)+'</div></div>'
        + '<div class="m"><div class="lab">Pot captured</div><div class="v">'+(isFinite(r.m.capture)?fmt1(r.m.capture)+"%":"—")+'</div></div>'
        + '</div>'
        + '<div class="dt-hyg">'+hygText(r.m)+'</div>'
        + (r.season ? spark(r.m.weekly_rho, r.color) : "")
        + '</div>';
    }).join("") + '</div>';
  }

  function renderBoard(el){
    var rs = rows("board");
    var h = '<table><thead><tr><th>#</th><th>Runner</th><th>'+(week.board==="SEASON"?"Season score":"Week score")+'</th><th>Call</th></tr></thead><tbody>';
    rs.forEach(function(r,i){
      var call;
      if(!r.season) call = '<span class="dt-trail">RAW WEEK</span>';
      else if(r.m.tied_with_leader) call = '<span class="dt-pf">📸 PHOTO FINISH</span>';
      else call = '<span class="dt-trail">TRAILING</span>';
      var ci = (r.season && r.m.ci) ? '<span class="dt-ledci">range '+fmt2(r.m.ci[0])+' – '+fmt2(r.m.ci[1])+'</span>'
             : '<span class="dt-ledci">'+(r.season?"interval needs 2+ weeks":"single week — no interval")+'</span>';
      h += '<tr><td><span class="dt-lanechip" style="background:'+esc(r.color)+'">'+(i+1)+'</span></td>'
        + '<td class="dt-svc">'+esc(r.name)+'</td>'
        + '<td><span class="dt-lednum" data-cu="'+(isFinite(r.m.rho)?r.m.rho:"")+'"></span>'+ci+'</td>'
        + '<td>'+call+'</td></tr>';
    });
    el.innerHTML = '<div class="dt-board">'+h+'</tbody></table></div>';
    el.querySelectorAll("[data-cu]").forEach(function(n){
      var v = n.getAttribute("data-cu"); countUp(n, v===""?null:+v, 2);
    });
  }

  function renderRace(el){
    var rs = rows("race"), min=.30, max=1.0;
    el.innerHTML = '<div class="dt-track" id="dt-trackbox"><div class="dt-finish"></div>'
      + rs.map(function(r,i){
          var x = isFinite(r.m.rho) ? Math.max(0, Math.min(100, (r.m.rho-min)/(max-min)*100)) : 0;
          return '<div class="dt-lane"><span class="who">LANE '+(i+1)+' · '+esc(r.name.toUpperCase())+'</span>'
            + '<div class="dt-dog" data-x="'+x+'" style="left:4%"><span class="pup">🐕</span>'
            + '<span class="tagv" style="background:'+esc(r.color)+'">'+fmt2(r.m.rho)+'</span></div></div>';
        }).join("")
      + '<div class="dt-scale"><span>GATE .30</span><span>.65</span><span>PERFECT 1.00 🏁</span></div></div>'
      + '<button class="dt-rerun" type="button" id="dt-rerun">🔫 RE-RUN THE RACE</button>';

    if(week.race==="SEASON" && rs.some(function(r){ return r.m.tied_with_leader; }))
      $("#dt-trackbox", el).insertAdjacentHTML("beforeend",
        '<div class="dt-pfoverlay"><span class="dt-pf">📸 PHOTO FINISH</span></div>');

    /* ⚠️ TRAP #2 — THE DEAD-DOG BUG. Setting the final `left` in the same frame as the
       innerHTML above means the browser never sees a start value and no transition fires:
       the dogs sit at the gate. TWO nested rAFs — one to let layout settle on the start
       position, one to change it — is what makes them run. Do not "simplify" this. */
    var dogs = el.querySelectorAll(".dt-dog");
    var place = function(){ dogs.forEach(function(d){ d.style.left = Math.min(92, 4 + (+d.getAttribute("data-x"))*0.88) + "%"; }); };
    if(RM) place(); else requestAnimationFrame(function(){ requestAnimationFrame(place); });
    $("#dt-rerun", el).addEventListener("click", function(){ draw("race"); });
  }

  function renderSpread(el){
    var rs = rows("spread"), W=680, lh=48, H=rs.length*lh+40;   // trap #13: height from count
    var min=.30, max=.90, xv=function(v){ return 66+(Math.max(min,Math.min(max,v))-min)/(max-min)*(W-96); };
    var ax = [.3,.4,.5,.6,.7,.8,.9].map(function(v){
      return '<line x1="'+xv(v)+'" x2="'+xv(v)+'" y1="14" y2="'+(H-26)+'" stroke="var(--grid)" opacity=".55"/>'
        + '<text x="'+xv(v)+'" y="'+(H-8)+'" font-size="9.5" fill="var(--ink-3)" text-anchor="middle" font-family="ui-monospace,Menlo,monospace">'+fmt2(v)+'</text>';
    }).join("");
    var body = rs.map(function(r,i){
      var yy = 28+i*lh;
      var vals = r.season ? (r.m.weekly_rho||[]) : (isFinite(r.m.rho)?[r.m.rho]:[]);
      var srt = vals.slice().sort(function(a,b){return a-b;});
      var med = srt.length ? (srt.length%2 ? srt[(srt.length-1)/2] : (srt[srt.length/2-1]+srt[srt.length/2])/2) : null;
      return '<text x="6" y="'+(yy+4)+'" font-size="11" font-weight="900" fill="var(--ink-1)" font-family="ui-monospace,Menlo,monospace">'+esc(r.id)+'</text>'
        + '<line x1="66" x2="'+(W-30)+'" y1="'+yy+'" y2="'+yy+'" stroke="var(--grid)"/>'
        + (med!=null && vals.length>1 ? '<rect x="'+(xv(med)-1.5)+'" y="'+(yy-12)+'" width="3" height="24" rx="1.5" fill="'+esc(r.color)+'"/>' : "")
        + vals.map(function(v){
            return '<circle cx="'+xv(v)+'" cy="'+yy+'" r="7" fill="'+esc(r.color)+'" opacity=".8"/>'
              + '<circle cx="'+xv(v)+'" cy="'+yy+'" r="7" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="2.5 2.5"/>';
          }).join("");
    }).join("");
    el.innerHTML = '<div class="dt-feltbox"><svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Weekly Spearman values per entrant">'+ax+body+'</svg></div>';
  }

  function renderCage(el){
    var rs = rows("cage").filter(function(r){ return isFinite(r.m.capture); })
                         .sort(function(a,b){ return b.m.capture - a.m.capture; });
    el.innerHTML = '<div class="dt-cage">' + rs.map(function(r){
      var n = Math.max(1, Math.round((r.m.capture-68)/1.6));
      var chips = "";
      for(var i=0;i<n;i++) chips += '<div class="dt-chip" style="background:'+esc(r.color)+';transition-delay:'+(i*45)+'ms"></div>';
      return '<div class="dt-stackcol">'+chips+'<div class="dt-stackval" data-cu="'+r.m.capture+'"></div>'
        + '<div class="dt-stackwho">'+esc(r.id)+'</div></div>';
    }).join("") + '</div>';
    var go = function(){
      el.querySelectorAll(".dt-chip").forEach(function(c){ c.classList.add("in"); });
      el.querySelectorAll("[data-cu]").forEach(function(n){ countUp(n, +n.getAttribute("data-cu"), 1, "%"); });
    };
    if(RM) go(); else requestAnimationFrame(function(){ requestAnimationFrame(go); });
  }

  var RENDER = { rc:renderRC, race:renderRace, board:renderBoard, spread:renderSpread, cage:renderCage };

  function scopeLabel(v){
    var sc = scope[v]==="ALL" ? "All positions" : scope[v];
    return sc + " · " + (week[v]==="SEASON" ? ("Weeks 1–"+((doc&&doc.weeks_graded)||0)) : ("Week "+week[v]));
  }

  function drawControls(){
    document.querySelectorAll('[data-seg="scope"]').forEach(function(el){
      var v = el.getAttribute("data-view");
      el.innerHTML = SCOPES.map(function(s){
        return '<button type="button" data-p="'+s+'" aria-pressed="'+(scope[v]===s)+'">'+s+'</button>';
      }).join("");
    });
    var wks = weeksAvailable();
    document.querySelectorAll('[data-seg="week"]').forEach(function(el){
      var v = el.getAttribute("data-view");
      el.innerHTML = ['SEASON'].concat(wks.map(String)).map(function(w){
        return '<button type="button" data-w="'+w+'" aria-pressed="'+(String(week[v])===String(w))+'">'
          + (w==="SEASON"?"SEASON":"W"+w) + '</button>';
      }).join("");
    });
  }

  function draw(v){
    var body = document.querySelector('[data-body="'+v+'"]');
    if(!body) return;
    if(err){ body.innerHTML = '<div class="dt-err"><b>The board is not reachable right now.</b> '
      + 'This page reads live scores from the Data Dawgs worker; nothing is cached here. '
      + esc(err) + '</div>'; return; }
    if(!doc || doc.empty || !doc.weeks_graded){
      body.innerHTML = '<div class="dt-empty"><h3>Season opens Sep 10</h3>'
        + '<p>No weeks have been graded yet. The methodology below is pre-registered and published '
        + 'before the first snapshot — that is the point of publishing it now. Receipts follow the '
        + 'first Tuesday grade run.</p></div>';
      return;
    }
    var badge = document.querySelector('[data-weekbadge="'+v+'"]');
    if(badge) badge.innerHTML = week[v]==="SEASON" ? ""
      : '<span class="dt-weekbadge">ONE WEEK ≠ SKILL · raw values, no interval, no shrinkage</span>';
    RENDER[v](body);
    var wkEl = document.querySelector("[data-dt-weeks]");
    if(wkEl) wkEl.textContent = (doc.weeks_graded||0) + " week" + (doc.weeks_graded===1?"":"s") + " of";
  }

  function drawAll(){ drawControls(); VIEWS.forEach(draw); }

  document.addEventListener("click", function(ev){
    var seg = ev.target.closest && ev.target.closest("[data-seg] button");
    if(seg){
      var host = seg.closest("[data-seg]"), v = host.getAttribute("data-view");
      if(host.getAttribute("data-seg")==="scope") scope[v] = seg.getAttribute("data-p");
      else week[v] = seg.getAttribute("data-w");
      drawControls(); draw(v); return;
    }
    var tab = ev.target.closest && ev.target.closest("#dt-tabs button[data-v]");
    if(tab){
      var v2 = tab.getAttribute("data-v");
      document.querySelectorAll("#dt-tabs button[data-v]").forEach(function(b){
        b.setAttribute("aria-selected", String(b.getAttribute("data-v")===v2)); });
      document.querySelectorAll(".dt-view").forEach(function(s){ s.classList.toggle("on", s.id==="dt-view-"+v2); });
      /* the animated views re-run on tab-switch: their transitions never fired while the
         panel was display:none (trap #2's second half) */
      if(v2==="race"||v2==="cage") draw(v2);
    }
  });

  fetch(TOTO + "/rankings/grades?season=" + (new Date().getUTCFullYear()))
    .then(function(r){ if(!r.ok) throw new Error("worker returned " + r.status); return r.json(); })
    .then(function(d){ doc = d; window.DD_RANKINGS = d; drawAll(); })
    .catch(function(e){ err = String(e && e.message || e); drawAll(); });

  drawAll();
})();
"""

# ------------------------------------------------------------------ bot surface ----
# AGENTS.md: `sys` is where a caveat has to live — Toto answers from the system block, not
# from page prose. Every limit this page states in copy is restated here as an instruction,
# because a limit he can be talked past is not a limit.
BOTCTX = r"""
<script>
/* rankings.html — The Dog Track. A curated spine for provenance and the refusals, with the
   page reader folded in underneath for whatever is actually on screen. */
window.DD_BOTCTX = {
  label: "Dog Track",
  title: "The Dog Track — rankings report card",
  chrome: { sub: "Grading ranking services against actual PPR finishes",
            ph: "Ask about the method, the scores, or why nothing is settled yet",
            chips: ["How is this scored?", "Who is winning?", "Why provisional?", "What is a photo finish?"] },
  sys: [
    "This page grades fantasy ranking services against actual weekly PPR finishes.",
    "TIER: Pup. It is PROVISIONAL. Never state a winner. If services are tied the page says PHOTO FINISH, and so must you.",
    "The promotion gate is declared: this becomes a Working Dawg only if at least one pair of services separates with non-overlapping shrunk intervals on the ALL scope at season's end. If that has not happened, say it has not.",
    "Three metrics only: Spearman rho, weighted Kendall tau, and points-capture rate. There is no fourth. Do not invent one.",
    "An entrant with fewer than 4 graded weeks is provisional regardless of score. A single-week view has NO confidence interval and NO shrinkage — one week is one observation, never evidence of skill.",
    "Hygiene is NOT TRACKED YET: the Thursday OUT list is not captured, so hygiene reads null. Do not report it as zero — absence is not a clean record.",
    "RAW THIRD-PARTY RANKS ARE PAID CONTENT AND ARE NOT AVAILABLE HERE OR ANYWHERE PUBLIC. You cannot show a player-level rank from any service, and there is no player-level data on this page to read. If asked, say the ranks are private by design and only derived scores publish.",
    "Methodology was pre-registered before Week 1 and is published in the drawer on this page. Any amendment carries a dated note.",
  ].join(" "),
  ctx: function(){
    var d = window.DD_RANKINGS || null;
    var spine = "THE DOG TRACK — rankings report card.\n"
      + "STATUS: " + (d && d.weeks_graded ? (d.weeks_graded + " week(s) graded, season " + d.season) : "no graded weeks yet; season opens Sep 10") + ".\n"
      + "SCORING: full PPR. Method version " + ((d && d.method_version) || "1.0") + ". Provisional: "
      + (d ? String(d.provisional !== false) : "true") + ".\n"
      + "HYGIENE TRACKED: " + (d && d.hygiene_tracked === true ? "yes" : "no — the Thursday OUT list is not captured, hygiene reads null") + ".\n"
      + "ENTRANTS: " + (d && d.entrants ? Object.keys(d.entrants).join(", ") : "not yet registered") + ".\n"
      + "THE BLEND: " + (d && d.blend && d.blend.members ? ("mean rank across " + d.blend.members.join(", ") + ", membership frozen at Week " + d.blend.frozen_at_week) : "membership freezes at Week 1") + ".\n"
      + "EXCLUDED (unmatched names): " + ((d && d.excluded_unmatched) || 0) + ".\n"
      + "MACHINE READS: /data/rankings-grades.json (the derived season doc; scores only, nothing player-level).\n\n";
    return spine + (window.DDBotScan ? window.DDBotScan(5200) : "The page reader could not run, so nothing on the page can be read right now.");
  }
};
</script>
"""

MAIN = """<main>
  <header class="p-hero">
    <div class="p-kicker">Arena · grading the people who grade the players</div>
    <h1>The Dog Track. <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Why this page is a Pup">Pup</a></h1>
    <p class="p-dek">Every Thursday before kickoff, each ranking service hands in its list. After Monday
    night we check how close its <b>order</b> was to how players <b>actually finished</b> — and publish the
    score, not the ranks. The method below was written down before the first snapshot, and nothing here
    claims a winner the math does not support.</p>
  </header>

  <div class="dt">
    <div class="dt-tabs" id="dt-tabs" role="tablist" aria-label="Dog Track views">__TABS__</div>
    __VIEWS__
    __METHOD__
  </div>
</main>"""


def build_page():
    donor = DONOR.read_text(encoding="utf-8")

    # every cut is a marker asserted exactly once — never a line number
    # ⚠️ `<div id="nav"></div>` alone occurs TWICE — the real one, and a copy inside a
    # comment in the shared script explaining the pattern. Anchor on the wrap line instead.
    NAV_ANCHOR = '<div class="wrap">\n  <div id="nav"></div>'
    for marker in ('<main>', '</main>', '<title>NFL · Data Dawgs</title>',
                   'data-page="nfl"', NAV_ANCHOR, '</style>\n</head>'):
        assert donor.count(marker) == 1, f"donor marker not unique: {marker!r} ({donor.count(marker)})"

    prefix = donor[:donor.index('<main>')]
    after = donor[donor.index('</main>') + len('</main>'):]
    # keep the donor's shared footer, drop its page-specific bot script
    foot_end = after.index('<script>')
    footer = after[:foot_end]

    # The donor carries no description meta, so this INSERTS one after the title rather
    # than replacing — asserted, because a silent no-op replace would ship a page with the
    # donor's title semantics and no description at all.
    assert '<meta name="description"' not in prefix, "donor gained a description meta; switch to replace"
    prefix = prefix.replace('<title>NFL · Data Dawgs</title>',
                            f'<title>{TITLE}</title>\n<meta name="description" content="{DESC}">', 1)
    assert f'<title>{TITLE}</title>' in prefix and 'name="description"' in prefix
    prefix = prefix.replace('data-page="nfl"', 'data-page="rankings"', 1)

    # Trap #8: dark is THIS page's default, via the live-board early-inline pattern. It sets
    # the attribute before first paint so a phone never flashes light, writes nothing, and
    # leaves the global dd-theme2 fallback and key alone.
    theme = ('<div id="nav"></div>\n'
             '  <script>window.DD_PAGE="rankings"; window.DD_THEME_DEFAULT="dark";\n'
             '    /* flip before paint; a reader who has chosen a theme for THIS page keeps it */\n'
             '    try{ if(!localStorage.getItem("dd-theme2-rankings")) document.documentElement.dataset.theme="dark"; }catch(e){}\n'
             '  </script>')
    prefix = prefix.replace(NAV_ANCHOR, '<div class="wrap">\n  ' + theme, 1)
    prefix = prefix.replace('</style>\n</head>', CSS + '\n</style>\n</head>', 1)

    main = (MAIN.replace("__TABS__", TABS)
                .replace("__VIEWS__", views_html())
                .replace("__METHOD__", METHOD))

    page = (prefix + main + "</main>" + footer
            + "\n<script>\n" + JS + "\n</script>\n"
            + BOTCTX + "\n</body>\n</html>\n")
    page = page.replace("</main></main>", "</main>", 1)

    out = ROOT / "rankings.html"
    out.write_text(page, encoding="utf-8")

    # structural assertions — a page that builds but is malformed is worse than a failure
    assert page.count("<main>") == 1 and page.count("</main>") == 1, "main is not balanced"
    assert page.count('id="dt-tabs"') == 1
    assert page.count('class="dt-view') == 5, "expected five views"
    # ⚠️ Section ids are dt-view-* precisely so they cannot collide with the component
    # classes rendered inside them. id="dt-cage" (the panel) and class="dt-cage" (the grid
    # inside it) both existed once, and every selector written against them silently
    # measured the wrong element — the grid reported display:block and one column.
    for _k, _t, _h in VIEWS:
        assert not (f'id="dt-{_k}"' in page and f'class="dt-{_k}"' in page), f"id/class collision on dt-{_k}"
    assert 'class="tierchip"' in page and 'data-tier="labs"' in page
    assert "dd-theme2-rankings" in page
    assert "repeat(auto-fit" in page, "trap #13: the cage grid must not be repeat(4,1fr)"
    assert "requestAnimationFrame(function(){ requestAnimationFrame(place); })" in page, "trap #2: double rAF"
    assert "prefers-reduced-motion" in page
    assert "/rankings/grades?season=" in page, "the page must actually fetch the public route"
    assert page.count("/* The Dog Track — renders entirely") == 1, "page JS missing"
    for gone in ("ETR", "PFF", "ESPN"):
        assert f'>{gone}<' not in main, f"hardcoded service name {gone} in the markup"
    return out, len(page)


# ------------------------------------------------------------------ admin page ----
# Unlisted, noindex, not in nav (spec §4). Deliberately standalone rather than carrying the
# site chrome: it is an operator console, it must load fast on a phone on a Thursday, and
# keeping it out of the flattened set means a nav re-flatten never has to touch it.
#
# ⚠️ ZERO HARDCODED SERVICE NAMES. Every paste box, every status row and every colour comes
# from the entrants registry. Adding a fifth service on launch day is a form submission.
ADMIN = r"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>Dog Track — admin</title>
<style>
:root{color-scheme:dark;--page:#161009;--panel:#1e1710;--ink:#f5f1ea;--ink2:#c8c1b4;--ink3:#8f897d;
  --grid:#2b251d;--accent:#ff6a02;--good:#2fbf3f;--bad:#ff6b6b;--warn:#eda100}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:0 0 60px}
.wrap{max-width:860px;margin:0 auto;padding:16px 14px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
.sub{color:var(--ink3);font-size:12.5px;margin-bottom:16px}
.card{background:var(--panel);border:1px solid var(--grid);border-radius:12px;padding:14px;margin-bottom:14px}
label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin:8px 0 4px}
input,select,textarea{width:100%;background:#120d08;border:1px solid var(--grid);border-radius:8px;
  color:var(--ink);padding:9px 10px;font:13px/1.4 ui-monospace,Menlo,monospace}
textarea{min-height:150px;resize:vertical}
button{background:var(--accent);color:#140a02;border:0;border-radius:8px;font-weight:800;font-size:13px;
  padding:9px 16px;cursor:pointer;margin-top:10px}
button.ghost{background:transparent;color:var(--ink2);border:1px solid var(--grid)}
button.danger{background:transparent;color:var(--bad);border:1px solid var(--bad)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.row>*{flex:1;min-width:120px}
.strip{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 0}
.pill{font-size:11px;font-weight:800;padding:4px 10px;border-radius:20px;border:1px solid var(--grid);
  display:flex;align-items:center;gap:6px}
.pill.captured{border-color:var(--good);color:var(--good)}
.pill.missing{border-color:var(--ink3);color:var(--ink3)}
.pill.voided{border-color:var(--warn);color:var(--warn)}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.out{white-space:pre-wrap;font:11.5px/1.45 ui-monospace,Menlo,monospace;background:#0e0a06;
  border:1px solid var(--grid);border-radius:8px;padding:10px;margin-top:10px;max-height:280px;overflow:auto}
.ok{color:var(--good)}.err{color:var(--bad)}.warnc{color:var(--warn)}
.unm{border-top:1px solid var(--grid);padding:8px 0;font-size:12.5px}
.note{font-size:11.5px;color:var(--ink3);line-height:1.5}
</style>
</head>
<body>
<div class="wrap">
  <h1>Dog Track — admin</h1>
  <div class="sub">Unlisted operator console. The key is stored in this browser only.
  Every paste is stamped <b>captured_at</b> by the server and is immutable once written.</div>

  <div class="card">
    <label for="key">Admin key</label>
    <input id="key" type="password" autocomplete="off" placeholder="RANKINGS_ADMIN_KEY">
    <div class="row"><button id="save">Save key</button>
      <button class="ghost" id="refresh">Refresh status</button></div>
    <div class="note" style="margin-top:8px">Stored at <span style="font-family:ui-monospace">localStorage["dd-rankings-admin"]</span>.
    Until the secret exists in the Cloudflare dashboard every route answers 403 — that is the intended state.</div>
  </div>

  <div class="card">
    <div class="row">
      <div><label for="season">Season</label><input id="season" value=""></div>
      <div><label for="week">Week</label><input id="week" value="1"></div>
    </div>
    <h2 style="margin-top:16px">This week's captures</h2>
    <div class="strip" id="strip"><span class="note">Save a key and hit refresh.</span></div>
  </div>

  <div class="card">
    <h2>Register an entrant</h2>
    <div class="row">
      <div><label for="eid">ID</label><input id="eid" placeholder="4-16 chars, A-Z 0-9 _"></div>
      <div><label for="ename">Name</label><input id="ename" placeholder="Display name"></div>
    </div>
    <div class="row">
      <div><label for="etype">Type</label><select id="etype"><option value="service">service</option><option value="house">house</option></select></div>
      <div><label for="efw">First week</label><input id="efw" value="1"></div>
      <div><label for="ecolor">Colour (optional)</label><input id="ecolor" placeholder="#ff6a02"></div>
    </div>
    <button id="addent">Register</button>
  </div>

  <div id="boxes"></div>

  <div class="card">
    <h2>Grade the week</h2>
    <div class="note">Runs after Monday night. Refuses to re-grade a week that already has rows.</div>
    <div class="row"><button id="grade">Run grade</button>
      <button class="ghost" id="gradedry">Dry run</button></div>
    <div id="gradeout"></div>
  </div>

  <div class="card" id="unmatchedcard" style="display:none">
    <h2>Unmatched names</h2>
    <div class="note">These were excluded from the week. Adding an alias fixes them for the next run —
    a wrong merge would corrupt a graded row that cannot be edited, so nothing is matched by guesswork.</div>
    <div id="unmatched"></div>
  </div>
</div>

<script>
var TOTO = "https://toto.jkapcar4.workers.dev";
var $ = function(id){ return document.getElementById(id); };
var keyOf = function(){ return localStorage.getItem("dd-rankings-admin") || ""; };
$("season").value = String(new Date().getUTCFullYear());
$("key").value = keyOf();

function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({ "x-dd-admin": keyOf(), "Content-Type": "application/json" }, opts.headers||{});
  return fetch(TOTO + path, opts).then(function(r){
    return r.json().catch(function(){ return { error: "non-JSON response " + r.status }; })
      .then(function(j){ return { status: r.status, body: j }; });
  });
}
function show(el, res){
  var cls = res.status === 200 ? "ok" : "err";
  el.innerHTML = '<div class="out ' + cls + '">' + JSON.stringify(res.body, null, 1) + '</div>';
}
$("save").onclick = function(){ localStorage.setItem("dd-rankings-admin", $("key").value.trim()); load(); };

function load(){
  var s = $("season").value, w = $("week").value;
  api("/rankings/status?season=" + encodeURIComponent(s) + "&week=" + encodeURIComponent(w)).then(function(res){
    var strip = $("strip"), boxes = $("boxes");
    if(res.status !== 200){
      strip.innerHTML = '<span class="note err">' + (res.body.error || res.status) + '</span>';
      boxes.innerHTML = ""; return;
    }
    var ents = res.body.entrants || [];
    strip.innerHTML = ents.length ? ents.map(function(e){
      var lbl = e.state === "captured" ? "captured ✓" : (e.state === "voided" ? "voided" : "missing");
      return '<span class="pill ' + e.state + '"><span class="dot" style="background:' + e.color + '"></span>'
        + e.id + ' · ' + lbl + '</span>';
    }).join("") : '<span class="note">No entrants registered yet.</span>';

    /* one paste box PER REGISTERED ENTRANT, generated from the registry */
    boxes.innerHTML = ents.map(function(e){
      return '<div class="card"><h2><span class="dot" style="background:' + e.color + '"></span> '
        + e.name + ' <span class="note">(' + e.id + ' · ' + e.type + ' · from W' + e.first_week + ')</span></h2>'
        + (e.state === "captured"
            ? '<div class="note ok">Captured ' + e.captured_at + '<br>sha ' + String(e.sha256).slice(0,16)
              + ' · kickoff check: ' + e.kickoff_check + '</div>'
              + '<button class="danger" data-void="' + e.id + '" data-cap="' + e.capture_id + '">Void this capture</button>'
            : '<label>Paste ranks — <span style="font-family:ui-monospace">pos,rank,player,team</span>, all four positions</label>'
              + '<textarea data-csv="' + e.id + '" placeholder="RB,1,Player Name,ATL"></textarea>'
              + '<button data-snap="' + e.id + '">Snapshot ' + e.id + '</button>')
        + '<div data-out="' + e.id + '"></div></div>';
    }).join("");
  });
}

document.addEventListener("click", function(ev){
  var t = ev.target;
  var s = t.getAttribute && t.getAttribute("data-snap");
  if(s){
    var csv = document.querySelector('[data-csv="' + s + '"]').value;
    api("/rankings/snapshot", { method:"POST", body: JSON.stringify({
      season:+$("season").value, week:+$("week").value, entrant:s, csv:csv }) })
      .then(function(res){ show(document.querySelector('[data-out="' + s + '"]'), res); load(); });
  }
  var v = t.getAttribute && t.getAttribute("data-void");
  if(v){
    var reason = prompt("Why is this capture being voided? (kept on the record)");
    if(!reason) return;
    api("/rankings/void", { method:"POST", body: JSON.stringify({
      season:+$("season").value, week:+$("week").value, entrant:v,
      capture_id:t.getAttribute("data-cap"), reason:reason }) })
      .then(function(res){ show(document.querySelector('[data-out="' + v + '"]'), res); load(); });
  }
  var a = t.getAttribute && t.getAttribute("data-alias");
  if(a){
    api("/rankings/aliases", { method:"POST", body: JSON.stringify({
      key:a, player_id:t.getAttribute("data-pid") }) })
      .then(function(res){ t.outerHTML = res.status===200
        ? '<span class="ok">alias added</span>' : '<span class="err">' + (res.body.error||res.status) + '</span>'; });
  }
});

$("addent").onclick = function(){
  var body = { id:$("eid").value.trim(), name:$("ename").value.trim(), type:$("etype").value,
               first_week:+$("efw").value };
  if($("ecolor").value.trim()) body.color = $("ecolor").value.trim();
  api("/rankings/entrants", { method:"POST", body: JSON.stringify(body) })
    .then(function(res){ show($("boxes"), res); load(); });
};
$("refresh").onclick = load;
$("season").onchange = load; $("week").onchange = load;

function runGrade(dry){
  api("/rankings/grade", { method:"POST", body: JSON.stringify({
    season:+$("season").value, week:+$("week").value, dry_run: !!dry }) })
    .then(function(res){
      show($("gradeout"), res);
      var un = (res.body && res.body.unmatched) || [];
      $("unmatchedcard").style.display = un.length ? "" : "none";
      $("unmatched").innerHTML = un.map(function(u){
        return '<div class="unm">' + u.entrant + ' · ' + u.pos + u.rank + ' · <b>' + u.name + '</b> (' + u.team + ')'
          + (u.suggestion
              ? ' <button data-alias="' + u.alias_key + '" data-pid="' + u.suggestion + '">alias &rarr; ' + u.suggestion + '</button>'
              : ' <span class="note">no candidate — check the name against the player index</span>')
          + '</div>';
      }).join("");
    });
}
$("grade").onclick = function(){ runGrade(false); };
$("gradedry").onclick = function(){ runGrade(true); };

if(keyOf()) load();
</script>
</body>
</html>
"""


def build_admin():
    out = ROOT / "rankings-admin.html"
    out.write_text(ADMIN, encoding="utf-8")
    assert "noindex" in ADMIN
    # ⚠️ ZERO hardcoded service names, and that includes form PLACEHOLDERS. The first
    # version used "ETR" and "Establish The Run" as input hints — harmless-looking, but
    # §4 says the admin UI names no service anywhere, and a hint is still the page
    # asserting which services exist. Checked against the whole file, not just rendered rows.
    for name in ("ETR", "PFF", "ESPN", "Establish The Run", "Pro Football Focus"):
        assert name not in ADMIN, f"hardcoded service name in the admin page: {name}"
    return out, len(ADMIN)


if __name__ == "__main__":
    p, n = build_page()
    a, m = build_admin()
    print(f"built {p.name}: {n/1024:.1f} KB")
    print(f"built {a.name}: {m/1024:.1f} KB")
