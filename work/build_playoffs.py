"""
Stamp playoffs.html — Playoff Leverage (Lab / Pup) — out of fourth-down.html.

Same technique as build_explore.py: there is no build system, so a NEW page is an existing
page's head + shared nav/Toto shell with <main> and the page script swapped. fourth-down.html
is the template because it already loads its behaviour from root *.js files (which sw.js
VERSION hashes).

⚠️ Slice by CONTENT MARKERS, never line numbers.
⚠️ Run work/patch-nav-playoffs.py FIRST so the template already lists playoffs.html in the
   nav and MAP; this script asserts it.
⚠️ The page script is playoffs.js. Its ?v= is the first 12 hex of its md5, so a JS-only
   change re-keys the URL as well as sw.js VERSION. Re-run this script after editing it,
   then work/stamp-sw-version.py.
⚠️ The page publishes NO numbers of its own: everything it shows is read at runtime from
   /data/nfl-playoff-leverage.json, so the daily data commit needs no page edit or sw bump.

    cd work && python3 patch-nav-playoffs.py && python3 build_playoffs.py && python3 stamp-sw-version.py
"""
import hashlib
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "fourth-down.html"
OUT = REPO / "playoffs.html"
src = TEMPLATE.read_text(encoding="utf-8")


def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    once(hay, old, what)
    return hay.replace(old, new, 1)


assert '["playoffs.html","Playoff Leverage","playoffs"]' in src, "run patch-nav-playoffs.py first"

# ---- head ----
i_head = once(src, "</head>", "head close")
head = src[:i_head]
head = re.sub(r"<title>.*?</title>", "<title>Playoff Leverage · Data Dawgs</title>", head, count=1, flags=re.S)
head = re.sub(r'<meta name="description" content="[^"]*">',
              '<meta name="description" content="What each NFL game is worth this week: every team\'s playoff chances '
              'if it wins and if it loses, from a daily 100,000-season simulation over real results and nfelo game '
              'probabilities. Lab / Pup: simulation output, ungraded.">',
              head, count=1)
head, n_css = re.subn(r'<link rel="stylesheet" href="fourth-down\.css\?v=[0-9a-f]+">\n', "", head)
assert n_css == 1, "fourth-down stylesheet link not found exactly once"
assert "fourth-down" not in head.split("</style>")[-1], "a fourth-down asset survived in the head"

CSS = r"""<style>
/* Playoff Leverage — page-local styles on the shared site variables.
   Marker colours are validated pairs (dataviz validate_palette.js, both themes): loss
   blue / win orange pass lightness, chroma, CVD (ΔE 27) and 3:1 contrast on surface-1.
   The brand accent itself is too light for a dark-surface mark, hence the darker step. */
.pl{max-width:1080px;margin:auto;padding-bottom:40px;
  --pl-loss:#3987e5;--pl-win:#ea5d00;--pl-tick:var(--ink-1);
  --pl-cols:minmax(120px,176px) minmax(0,1fr) 72px}
:root[data-theme="light"] .pl{--pl-loss:#2a78d6;--pl-win:#d13a00}
.pl-kicker{font:800 12px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.pl-hero{padding:14px 0 6px}
.pl-hero h1{font-size:clamp(34px,5.5vw,60px);line-height:1.02;letter-spacing:-.045em;margin:10px 0 12px;font-weight:900}
.pl-hero h1 span{color:var(--accent)}
.pl-hero p{max-width:760px;color:var(--ink-2);margin:0 0 8px;font-size:16px}
.pl-hero p b{color:var(--ink-1)}
.pl-fine{font-size:13px!important;color:var(--ink-3)!important}
.pl-lead-s{display:none}
.pl-legend .pl-s{display:none}
.pl-root.pl-root-empty{border:0;background:none;padding:0 2px;margin:0 0 6px}
.pl-status{font:700 12px/1.6 ui-monospace,monospace;color:var(--ink-2);margin:6px 0 4px}
.pl-status.bad{color:var(--bad)}
.pl-stale{border:2px solid var(--warn);border-radius:10px;padding:8px 12px;margin:8px 0;font-weight:700;color:var(--ink-1)}
.pl-h2{font-size:20px;margin:22px 0 6px;letter-spacing:-.01em}
.pl section>h2{font-size:20px;margin:26px 0 6px;letter-spacing:-.01em}
.pl-dek{color:var(--ink-2);font-size:14px;margin:0 0 10px;max-width:760px}
.pl-controls{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:14px 0 10px}
.pl-pick{display:flex;align-items:center;gap:8px;font:700 13px system-ui;color:var(--ink-2)}
.pl-pick select{font:inherit;font-size:15px;font-weight:800;background:var(--surface-1);color:var(--ink-1);border:1px solid var(--border);border-radius:10px;padding:7px 10px;min-height:42px;cursor:pointer}
.pl-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}
.pl-key{display:inline-flex;align-items:center;gap:6px}
.pl-key i{width:12px;height:12px;border-radius:50%;display:inline-block}
.pl-key .k-loss{background:var(--pl-loss)}.pl-key .k-win{background:var(--pl-win)}
.pl-key .k-now{width:3px;height:16px;border-radius:2px;background:var(--pl-tick)}
.pl-seg{display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:3px;background:var(--surface-1);margin-left:auto}
.pl-root-unit{font-size:12px;color:var(--ink-3);margin:-4px 0 10px}
.pl-seg button{font:800 12px system-ui;border:0;background:none;color:var(--ink-2);padding:6px 14px;border-radius:999px;min-height:34px;cursor:pointer}
.pl-seg button[aria-pressed="true"]{background:var(--ink-1);color:var(--page)}
.pl-seg button:focus-visible,.pl-pick select:focus-visible,.pl-root-go:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.pl-onegame{font-size:13px;color:var(--ink-3);margin:0 0 10px}
/* root-for guide */
.pl-root{border:1px solid var(--border);background:var(--surface-1);border-radius:14px;padding:12px 16px;margin:0 0 14px}
.pl-root-head{margin:0 0 10px;font-size:15px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--ink-2)}
.pl-root-head b{color:var(--ink-1)}
.pl-root-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.pl-root-list li{display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:12px;align-items:center;font-size:14px;color:var(--ink-2)}
.pl-root-list li b{color:var(--ink-1)}
.pl-root-own .pl-root-text{color:var(--ink-1)}
.pl-root-meter{height:6px;border-radius:3px;background:var(--grid);overflow:hidden}
.pl-root-meter i{display:block;height:100%;background:var(--pl-win);border-radius:3px}
.pl-root-go{font:800 12px system-ui;border:1px solid var(--border);background:var(--page);color:var(--ink-1);border-radius:999px;padding:5px 12px;min-height:32px;cursor:pointer;transition:transform .12s ease,border-color .2s}
.pl-root-go:hover{border-color:var(--accent)}.pl-root-go:active{transform:scale(.94)}
.pl-hint{color:var(--ink-3);font-size:13px;margin:6px 0 0}
/* chart */
.pl-chart{display:grid;gap:10px}
.pl-axis{display:grid;grid-template-columns:var(--pl-cols);align-items:end;height:20px;padding:0 13px;font:700 11px ui-monospace,monospace;color:var(--ink-3)}
.pl-axis .pl-track{height:20px}
.pl-axis-l{position:absolute;bottom:2px;transform:translateX(-50%)}
.pl-axis-sw{text-align:right;text-transform:uppercase;letter-spacing:.08em}
.pl-game{border:1px solid var(--border);background:var(--surface-1);border-radius:14px;padding:10px 12px 8px;transition:border-color .25s,box-shadow .25s}
.pl-game.pl-flipped{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.pl-ghead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 12px;margin-bottom:4px}
.pl-gtitle{font:800 12px/1.3 system-ui;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);margin:0}
.pl-when{font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink-3);margin-left:8px}
.pl-kicked{margin:2px 0 6px;font-size:12px;color:var(--warn);font-weight:700}
.pl-row{display:grid;grid-template-columns:var(--pl-cols);align-items:center;min-height:38px;border-radius:8px}
.pl-row:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.pl-row.pl-yours{background:rgba(255,106,2,.10)}
.pl-team{display:flex;align-items:center;gap:8px;min-width:0}
.pl-name{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-1)}
.pl-chip{display:inline-grid;place-items:center;min-width:36px;height:22px;padding:0 4px;border-radius:6px;font:800 11px ui-monospace,monospace;background:var(--grid);color:var(--ink-1);box-shadow:0 0 0 1px var(--border);flex:none}
.pl-track{position:relative;height:38px}
.pl-plot{position:absolute;left:28px;right:32px;top:0;bottom:0;background-image:linear-gradient(to right,var(--grid) 1px,transparent 1px);background-size:20% 100%;border-right:1px solid var(--grid)}
.pl-axis .pl-plot{background:none;border:0}
.pl-bar{position:absolute;top:50%;height:6px;margin-top:-3px;border-radius:3px;opacity:.62;background:linear-gradient(to right,var(--pl-loss),var(--pl-win))}
.pl-bar-rev{background:linear-gradient(to right,var(--pl-win),var(--pl-loss))}
.pl-dot{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;box-shadow:0 0 0 2px var(--surface-1)}
.pl-loss{background:var(--pl-loss)}.pl-win{background:var(--pl-win)}
.pl-tick{position:absolute;top:50%;width:3px;height:22px;margin:-11px 0 0 -1.5px;border-radius:2px;background:var(--pl-tick);box-shadow:0 0 0 2px var(--surface-1);transition:left .55s cubic-bezier(.22,1.3,.36,1)}
.pl-moved .pl-tick{background:var(--accent);width:4px;margin-left:-2px}
.pl-lab{position:absolute;top:50%;font:700 12px ui-monospace,monospace;color:var(--ink-2);white-space:nowrap;font-variant-numeric:tabular-nums}
.pl-lab-lo{transform:translate(calc(-100% - 10px),-50%)}
.pl-lab-hi{transform:translate(10px,-50%);color:var(--ink-1)}
.pl-swing{display:flex;flex-direction:column;align-items:flex-end;font:800 15px ui-monospace,monospace;font-variant-numeric:tabular-nums;color:var(--ink-1);line-height:1.15}
.pl-read{font:700 11px ui-monospace,monospace;color:var(--ink-2)}
.pl-read:empty{display:none}
.pl-read b{color:var(--accent)}
.pl-ripple{margin:6px 2px 2px;font-size:13px;color:var(--ink-2);line-height:1.5}
.pl-ripple b{color:var(--ink-1)}
.pl-mine{color:var(--ink-1);font-weight:800;text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:3px}
.pl-byes{font-size:13px;color:var(--ink-3);margin:2px 2px 0}
.pl-empty,.pl-loading{color:var(--ink-2);padding:18px;border:1px dashed var(--border);border-radius:12px}
.pl-error{color:var(--bad);font:600 14px ui-monospace,monospace;padding:16px;border:2px solid var(--bad);border-radius:12px}
/* the result switch: a three-position slider with a weighted thumb */
.pl-switch{position:relative;display:inline-grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--border);border-radius:999px;padding:3px;margin:0;background:var(--page);min-width:236px;box-shadow:inset 0 1px 3px rgba(0,0,0,.35)}
.pl-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pl-opt{position:relative;z-index:1;display:grid;place-items:center;min-height:34px;padding:0 8px;font:800 12px system-ui;color:var(--ink-2);cursor:pointer;border-radius:999px;user-select:none;white-space:nowrap;transition:color .2s}
.pl-opt input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.pl-opt:focus-within{outline:3px solid var(--accent);outline-offset:1px}
.pl-thumb{position:absolute;z-index:0;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:999px;background:var(--accent);box-shadow:0 2px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.28);transition:transform .34s cubic-bezier(.34,1.56,.64,1),background-color .2s}
.pl-switch[data-pos="now"] .pl-thumb{transform:translateX(100%);background:var(--axis)}
.pl-switch[data-pos="home"] .pl-thumb{transform:translateX(200%)}
.pl-switch:active .pl-thumb{scale:.95}
.pl-switch[data-pos="away"] .pl-opt:nth-of-type(1),.pl-switch[data-pos="home"] .pl-opt:nth-of-type(3){color:var(--accent-ink)}
.pl-switch[data-pos="now"] .pl-opt:nth-of-type(2){color:var(--ink-1)}
/* tables */
.pl-tablewrap{overflow-x:auto}
.pl-table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
.pl-table caption{text-align:left;font:700 12px ui-monospace,monospace;color:var(--ink-3);padding:6px 0;white-space:normal}
.pl-table th{text-align:left;font:800 11px system-ui;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:6px 8px;border-bottom:1px solid var(--axis)}
.pl-table td{padding:5px 8px;border-top:1px solid var(--grid);color:var(--ink-1);text-align:left}
.pl-table td.num{text-align:right;font-family:ui-monospace,Menlo,monospace}
.pl-table tr.pl-yours td{background:rgba(255,106,2,.12)}
.pl-tteam{white-space:nowrap}
.pl-th-s{display:none}
.pl-oddsgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
/* tooltip */
.pl-tip{position:fixed;z-index:60;pointer-events:none;background:var(--surface-1);border:1px solid var(--axis);border-radius:10px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,.45);font-size:12px;display:grid;gap:2px;min-width:200px;color:var(--ink-2)}
.pl-tip[hidden]{display:none}
.pl-tip-name{color:var(--ink-3);font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:11px}
.pl-tip-line b{font:800 14px ui-monospace,monospace;color:var(--ink-1)}
/* method */
.pl-method{border:1px solid var(--border);background:var(--surface-1);border-radius:14px;padding:12px 16px;margin-top:22px;font-size:14px;color:var(--ink-2)}
.pl-method summary{cursor:pointer;font-weight:800;color:var(--ink-1)}
.pl-method h3{font-size:15px;color:var(--ink-1);margin:14px 0 4px}
.pl-method li{margin:3px 0}
@media(max-width:860px){.pl-oddsgrid{grid-template-columns:1fr}}
@media(max-width:640px){
  .pl{--pl-cols:96px minmax(0,1fr) 54px}
  .pl-hero{padding-top:6px}
  .pl-hero h1{font-size:32px;margin:6px 0 8px}
  .pl-hero p{font-size:15px;line-height:1.45;margin-bottom:6px}
  .pl-lead-l{display:none}.pl-lead-s{display:block}
  .pl-fine{font-size:12px!important}
  .pl-legend .pl-l{display:none}.pl-legend .pl-s{display:inline}
  .pl-legend{gap:10px;font-size:12px}
  .pl-onegame{font-size:12px}
  .pl-status{font-size:11px;line-height:1.5}
  .pl-controls{margin:10px 0 8px;gap:8px 14px}
  .pl-name{font-size:13px}
  .pl-swing{font-size:13px}
  .pl-seg{margin-left:auto}
  .pl-pick{flex:1 1 100%}
  .pl-pick select{flex:1}
  .pl-switch{min-width:0;width:100%}
  .pl-plot{left:24px;right:26px}
  .pl-root-list li{grid-template-columns:minmax(0,1fr) auto}
  .pl-root-meter{display:none}
}
@media(max-width:480px){
  .pl{--pl-cols:44px minmax(0,1fr) 52px}
  .pl-name{display:none}
  .pl-th-l,.pl-tname,.pl-col-game{display:none}.pl-th-s{display:inline}
  .pl-table td,.pl-table th{padding:5px 4px}
}
@media(prefers-reduced-motion:reduce){
  .pl-tick,.pl-thumb,.pl-opt,.pl-game,.pl-root-go{transition:none!important}
  .pl-switch:active .pl-thumb,.pl-root-go:active{scale:1;transform:none}
}
</style>
"""
head = head + CSS

# ---- body: keep the shared nav/Toto shell, swap <main> ----
i_body = once(src, "</head>\n<body>\n", "body open") + len("</head>\n")
i_main = once(src, '<main class="fd">', "fd main")
shell = src[i_body:i_main]
shell = sub1(shell, '<script data-page="fourth-down">', '<script data-page="playoffs">', "nav data-page")
# The Upside Down mirror, keyed by this page's own stem — added HERE and nowhere else,
# the same way build_nfl_hub.py adds "nfl". The secondary mirrors are the two inputs.
shell = sub1(shell, '      "calculators":"/data/model-contracts.json"\n    },',
             '      "calculators":"/data/model-contracts.json",\n      "playoffs":"/data/nfl-playoff-leverage.json"\n    },',
             "UD map tail")
shell = sub1(shell, '      "dawghouse":["/data/model-contracts.json","/data/upstream-models.json"],\n',
             '      "dawghouse":["/data/model-contracts.json","/data/upstream-models.json"],\n'
             '      "playoffs":["/data/survivor.json","/data/nfl-schedule.json"],\n',
             "UD also tail")

MAIN = r"""<main class="pl" id="pl">
  <header class="pl-hero">
    <div class="pl-kicker" id="pl-kicker">NFL · playoff leverage</div>
    <h1>What each game is <span>worth.</span> <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Pup — live and useful, not yet validated">Pup</a></h1>
    <p class="pl-lead-l">Each bar runs from a team's chance to make the playoffs if it <b>loses</b> its <span id="pl-week">this week's</span> game to its chance if it <b>wins</b>. The tick is where it stands now. The longer the bar, the more that one result is worth, and games are ordered by how much they swing both teams.</p>
    <p class="pl-lead-s">Each bar: a team's playoff chances if it <b>loses</b> → if it <b>wins</b> this week. The tick is now. Longest bars first.</p>
    <p class="pl-fine">Simulation output, rebuilt daily from real results and nfelo game probabilities. Ungraded, and not betting advice.</p>
    <div class="pl-status" id="pl-status" role="status" aria-live="polite">Loading the simulation…</div>
    <div class="pl-stale" id="pl-stale" role="alert" hidden></div>
  </header>

  <section aria-labelledby="pl-games-h">
    <h2 class="pl-sr" id="pl-games-h">This week's games</h2>
    <div class="pl-controls">
      <label class="pl-pick" for="pl-team">Your team <select id="pl-team"><option value="">Pick a team</option></select></label>
      <div class="pl-legend"><span class="pl-key"><i class="k-loss"></i><span class="pl-l">If they lose</span><span class="pl-s">Lose</span></span><span class="pl-key"><i class="k-win"></i><span class="pl-l">If they win</span><span class="pl-s">Win</span></span><span class="pl-key"><i class="k-now"></i>Now</span></div>
      <div class="pl-seg" role="group" aria-label="Show this week's games as"><button type="button" data-view="chart" aria-pressed="true">Chart</button><button type="button" data-view="table" aria-pressed="false">Table</button></div>
    </div>
    <div class="pl-root" id="pl-root" aria-live="polite"></div>
    <p class="pl-onegame">Flip a result to see where both teams land. One game at a time: every other game stays simulated. Hover or focus a row for the exact numbers.</p>
    <div class="pl-chart" id="pl-chart"><div class="pl-loading">Loading this week's games…</div></div>
    <div class="pl-tablewrap" id="pl-chart-table" hidden></div>
  </section>

  <section aria-labelledby="pl-odds-h">
    <h2 id="pl-odds-h">Playoff odds now, all 32</h2>
    <p class="pl-dek">Share of simulated seasons in which each team makes the field, wins its division or takes the #1 seed and its bye. Records are real results; the rest is simulation.</p>
    <div class="pl-oddsgrid" id="pl-odds"></div>
  </section>

  <details class="pl-method" id="method"><summary>Method — how these numbers are made, and where they can be wrong</summary>
    <h3>The simulation</h3>
    <p>Every day after the nfelo refresh, 100,000 copies of the rest of the season are played. Finished games keep their real result (a tie counts as half a win, as the league counts it). Every unplayed game is one coin flip weighted by its home-win probability from <a href="/data/survivor.json">/data/survivor.json</a>: the published nfelo forecast for this week, the nfelo season projection after it. Then each conference is seeded the league's way — four division winners and three wild cards.</p>
    <h3>What the bar measures</h3>
    <p>For each game this week, every simulated season is played twice: once with the home team winning and once with the away team winning, while every other game keeps the result it got in that season. "If they win" and "if they lose" are the share of those seasons in which the team makes the playoffs; "now" is the share with nothing forced; the swing is the difference. Because the two halves share every other result, the swing isolates what this one game does. The ± in the tooltip and table is the simulation's own error on the swing.</p>
    <h3>Tie-breakers</h3>
    <p>The NFL's division and wild-card procedures, in order: head-to-head (for three or more wild-card clubs, a sweep only), division record, common games (wild card: at least four), conference record, strength of victory, strength of schedule. A tie still standing after that would need points, which are not simulated, so it goes to a coin toss. The seeding code is checked against history: replaying the 2002–2025 regular seasons through it reproduces every conference's actual playoff field, byes and wild-card pairings, 48 of 48 conference-seasons, and the check reruns on every change to it.</p>
    <h3>Where it can be wrong</h3>
    <ul id="pl-limits"><li>Loading…</li></ul>
    <p>That is why the page prints <b>&lt;1</b> and <b>&gt;99</b> instead of 0 and 100: 100,000 seasons cannot tell "very unlikely" from "eliminated", and a model that holds team strength fixed is too sure of itself near the ends.</p>
    <h3>Inputs, dated</h3>
    <ul id="pl-inputs"><li>Loading…</li></ul>
    <p>Machines: read <a href="/data/nfl-playoff-leverage.json"><code>/data/nfl-playoff-leverage.json</code></a> — every number on this page, with its method, inputs and limits. Its <code>if_home_win</code> and <code>if_away_win</code> arrays carry all 32 teams for every game, which is what the root-for guide reads.</p>
  </details>
  <div class="pl-tip" id="pl-tip" role="tooltip" hidden></div>
</main>
<footer class="foot">Data Dawgs · Data, Not Dogma · Playoff Leverage (Pup) · Simulation output, ungraded.</footer>
</div>
"""

js = (REPO / "playoffs.js").read_bytes().replace(b"\r\n", b"\n")
v = hashlib.md5(js).hexdigest()[:12]
tail = f'<script src="playoffs.js?v={v}"></script>\n<script src="install-help.js" defer></script>\n</body></html>\n'
html = head + "</head>\n" + shell + MAIN + tail

# ---- guards ----
assert html.count('data-tier="labs"') == 1 and html.count("window.DD_BOTCTX=") == 0
assert html.count("const MAP = `") == 1 and "playoffs.html — Playoff Leverage (Pup)" in html
assert html.count("<main") == 1 and html.count("</main>") == 1
assert 'class="fd"' not in html and "fourth-down-page.js" not in html
assert "\r" not in html
OUT.write_text(html, encoding="utf-8", newline="\n")
print(f"  wrote {OUT.name} ({len(html.encode()):,} bytes), playoffs.js?v={v}")
