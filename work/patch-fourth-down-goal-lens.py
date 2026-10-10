"""
Add the Goal Lens to the Fourth Down Lab. Anchor-based and idempotent.

    cd work && python3 patch-fourth-down-goal-lens.py && python3 stamp-sw-version.py

Touches: fourth-down.html (panel markup, method copy, script tags, asset ?v= keys),
fourth-down-page.js (lens wiring, share/copy, Toto sys + chips), fourth-down.css,
build_explore.py (it pins the template's css link), and the pasted MAP sentence in
every page that carries it. Re-running changes nothing.
"""
import glob
import hashlib
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent


def patch(path, edits, marker):
    p = REPO / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        print(f"  {path}: already patched")
        return
    for old, new in edits:
        assert s.count(old) == 1, f"{path}: anchor appears {s.count(old)} times: {old[:70]!r}"
        s = s.replace(old, new)
    assert marker in s
    p.write_text(s, encoding="utf-8")
    print(f"  {path}: patched")


PANEL = """
      <section class="fd-sensitivity fd-goal" id="fd-goal" hidden aria-label="Goal lens">
        <div class="fd-kicker">Goal lens · same play, different scoreboard</div><h3>What are you actually playing for?</h3>
        <p>The call above maximises one thing: your chance to win. Pick another goal and the same modelled outcomes are scored again. The play and its probabilities do not change. Only what counts does.</p>
        <div class="fd-goal-picks" id="fd-goal-picks" role="group" aria-label="Goal"></div>
        <p class="fd-goal-blurb" id="fd-goal-blurb"></p>
        <div class="fd-slider-control" id="fd-goal-param-control" hidden><label for="fd-goal-param"><span id="fd-goal-param-label"></span> <output id="fd-goal-param-value" for="fd-goal-param"></output></label><input id="fd-goal-param" type="range"><div class="fd-goal-strip" id="fd-goal-param-strip" aria-hidden="true"></div><div class="fd-goal-presets" id="fd-goal-presets"></div></div>
        <div class="fd-slider-control" id="fd-goal-horizon-control" hidden><label for="fd-goal-horizon">How far ahead do you care? <output id="fd-goal-horizon-value" for="fd-goal-horizon"></output></label><input id="fd-goal-horizon" type="range" min="0" step="1"><div class="fd-goal-strip" id="fd-goal-horizon-strip" aria-hidden="true"></div><small>Far left: only the moment after this play. Far right: every second to the final gun.</small></div>
        <div class="fd-goal-verdict" id="fd-goal-verdict" role="status"></div>
        <div class="fd-bars" id="fd-goal-bars"></div>
        <p class="fd-chart-note" id="fd-goal-note"></p>
        <div class="fd-legend fd-goal-legend" id="fd-goal-legend"><span style="--key:#e96512"><i></i>Go wins at this setting</span><span style="--key:#2d87b7"><i></i>Field goal</span><span style="--key:#a17ac1"><i></i>Punt</span><span class="faint" style="--key:var(--ink-2)"><i></i>Faded: level or too close to call</span></div>
        <details class="fd-source"><summary>How the path is modelled, and how wrong it is</summary><p id="fd-goal-method"></p><p>The strips under each slider show which choice wins at every setting; tap one to jump there. A goal is a way of keeping score, not advice: nothing here estimates what any coach is really optimising, and the lens never replaces the win-probability call. <a href="data/fourth-down-paths.json">Path model, errors and calibration table</a> · <a href="data/fourth-down-method.md">Full method</a>.</p></details>
      </section>"""

METHOD = """<p><strong>Goal lens.</strong> The lens scores the same outcome probabilities and win probabilities against a different objective, such as clock time spent above a win-probability line. It needs a model of how win probability travels after the play, which nfl4th does not supply: a diffusion on an information clock measured from 2016–2022 play-by-play and tested on 2023–2025. That path is modelled, not observed, misses by about one point of clock share on held-out games, and does not answer inside the final 30 seconds. “Average win probability” is included because it is the obvious first idea and it provably returns the standard numbers. The lens is a way of keeping score, never the recommendation.</p>"""

patch("fourth-down.html", [
    ('<div class="fd-branches" id="fd-branches"></div>\n', '<div class="fd-branches" id="fd-branches"></div>' + PANEL + "\n"),
    ('<p>Weekly plays come from ESPN, with pregame lines from nflverse.', METHOD + '<p>Weekly plays come from ESPN, with pregame lines from nflverse.'),
    ('<script src="fourth-down-explorer.js?v=', '<script src="fourth-down-objectives.js?v=0"></script>\n<script src="fourth-down-lens.js?v=0"></script>\n<script src="fourth-down-explorer.js?v='),
    ('explore conversion thresholds, and review weekly coaching decisions.">', 'explore conversion thresholds, re-score the call under other goals, and review weekly coaching decisions.">'),
], 'id="fd-goal"')

SYS_OLD = " There is no fourth-down MCP tool yet.',ctx:"
SYS_NEW = (" GOAL LENS: current.goalLens re-scores the same outcome lots under another objective the reader picked. It is a way of keeping score, never the recommendation: the recommendation is always the win-probability call in current.result, and you must say so whenever you quote a lens result. Never say a coach should follow a lens, and never claim it shows what coaches or fans actually optimise; nothing here is fitted to coach behaviour. Average win probability is identical to win probability by construction (expected future win probability equals current win probability), so it cannot change a call; explain that instead of presenting it as a second opinion. Time above a line, Keep it a game and Hate falling behind (when its horizon is past the moment after the play) use a MODELLED path: a diffusion on an information clock fitted to 2016-2022 nflverse play-by-play and tested on 2023-2025, regulation only. Quote goalLens.pathModel for its dates and held-out error; it is not observed, not a forecast of this game and not prospectively graded. If tooCloseToCall or level is true, say the lens does not separate the choices; do not name a winner. If available is false, give the reason and stop; the path model does not answer inside the final 30 seconds. winProbabilityGivenUpPP is the modelled win probability lost by following the lens instead of the bot. Felt points are a loss-aversion score chosen by the reader, not a measured preference. Margin, cover and score-based goals are not available: there is no score-path model here. Path model data at /data/fourth-down-paths.json. There is no fourth-down MCP tool yet.',ctx:")
patch("fourth-down-page.js", [
    ("window.DDFourthState={input:activeInput,result:r,baseline:result,scenario:explorer.getState(),source:sourceLabel};\n  }",
     "lens.setResult(result,r);\n    syncState();\n  }\n"
     "  // The lens redraws on its own dials; the shared state has to follow it.\n"
     "  function syncState(){if(displayResult&&activeInput)window.DDFourthState={input:activeInput,result:displayResult,baseline:result,scenario:explorer.getState(),goalLens:lens.getState(),source:sourceLabel};}\n"
     "  const lens=DDFourthLens.create({onChange:syncState});"),
    ("$('fd-sensitivity').hidden=true;result=null;displayResult=null;window.DDFourthState=null;}",
     "$('fd-sensitivity').hidden=true;lens.hide();result=null;displayResult=null;window.DDFourthState=null;}"),
    ("window.DDFourthState=null;$('fd-sensitivity').hidden=true;});",
     "window.DDFourthState=null;displayResult=null;$('fd-sensitivity').hidden=true;lens.hide();});"),
    ("u.searchParams.set('fp',(displayResult.fgMake*100).toFixed(1));}copy(u.href);});",
     "u.searchParams.set('fp',(displayResult.fgMake*100).toFixed(1));}lens.shareParams(u.searchParams);copy(u.href);});"),
    ("· kickoff: own ${activeInput.touchback}.`);});", "· kickoff: own ${activeInput.touchback}.${lens.copyLine()}`);});"),
    ("chips:['Why this call?','What conversion rate breaks even?','Explain the clock assumptions']",
     "chips:['Why this call?','What conversion rate breaks even?','What does the goal lens change?','Explain the clock assumptions']"),
    (SYS_OLD, SYS_NEW),
], "DDFourthLens.create")

CSS = """
/* Goal lens */
.fd-goal-picks,.fd-goal-presets{display:flex;gap:8px;flex-wrap:wrap}.fd-goal-picks{margin:14px 0 10px}.fd-goal-picks button{font-size:13px;flex:1 1 0;min-width:118px;line-height:1.25;transition:transform .08s ease,box-shadow .12s ease,border-color .12s ease}.fd-goal-picks button:active,.fd-goal-presets button:active{transform:translateY(1px) scale(.98)}.fd-goal-picks button[aria-pressed=true],.fd-goal-presets button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 -3px var(--accent);background:var(--page)}.fd-goal-presets{margin-top:10px}.fd-goal-presets button{font-size:12px;min-height:40px;padding:8px 12px}.fd-sensitivity p.fd-goal-blurb{font-size:14px;color:var(--ink-1);margin:0 0 4px;min-height:2.9em}
.fd-goal-strip{display:flex;gap:2px;height:22px;padding:0 9px;margin:2px 0 4px}.fd-goal-strip button{flex:1;min-width:0;min-height:0;padding:0;border:0;border-radius:3px;background:var(--key);opacity:.92;transition:transform .1s ease,opacity .15s ease}.fd-goal-strip button.faint{background:color-mix(in srgb,var(--key) 28%,var(--surface-1))}.fd-goal-strip button:hover{transform:scaleY(1.25);border:0}.fd-goal-strip button.on{outline:2px solid var(--ink-1);outline-offset:1px;transform:scaleY(1.25)}
.fd-goal-verdict{margin:16px 0 18px;padding:14px 16px;border-left:4px solid var(--good);background:var(--page);border-radius:0 9px 9px 0}.fd-goal-verdict b{display:block;font-size:22px;letter-spacing:-.02em;line-height:1.2;color:var(--ink-1)}.fd-goal-verdict span{display:block;font-size:13px;line-height:1.55;color:var(--ink-2);margin-top:6px}.fd-goal-verdict.flip{border-color:var(--fd-orange)}.fd-goal-verdict.close,.fd-goal-verdict.off{border-color:var(--axis)}
.fd-goal .fd-slider-control label{flex-wrap:wrap;gap:2px 12px}.fd-goal .fd-slider-control output{font-size:20px;margin-left:auto}.fd-goal .fd-bars{gap:14px}.fd-goal .fd-bar-row .fd-note{display:block;margin-top:5px;font-size:11px}.fd-goal-legend{margin:4px 0 10px}.fd-goal-legend i{height:10px;border-radius:2px}.fd-goal-legend .faint i{opacity:.35}
@media(max-width:650px){.fd-goal-picks button{flex:1 1 44%}.fd-goal-verdict b{font-size:20px}.fd-goal .fd-slider-control output{font-size:17px}}
@media(prefers-reduced-motion:reduce){.fd-goal-picks button,.fd-goal-strip button{transition:none}}
"""
css = REPO / "fourth-down.css"
t = css.read_text(encoding="utf-8")
if "/* Goal lens */" not in t:
    css.write_text(t.rstrip("\n") + "\n" + CSS, encoding="utf-8")
    print("  fourth-down.css: patched")
else:
    print("  fourth-down.css: already patched")

# The MAP sentence is pasted into every page that carries Toto's site map.
OLD = "conversion break-even, shareable scenarios, and delayed weekly decisions. Model estimates; no fourth-down MCP tool."
NEW = "conversion break-even, a goal lens that re-scores the same outcomes under other objectives (a modelled path; never the recommendation), shareable scenarios, and delayed weekly decisions. Model estimates; no fourth-down MCP tool."
done = 0
for f in sorted(glob.glob(str(REPO / "*.html"))):
    p = pathlib.Path(f)
    s = p.read_text(encoding="utf-8")
    if NEW in s or "fourth-down.html — Fourth Down Lab" not in s:
        continue
    assert s.count(OLD) == 1, f"{p.name}: MAP sentence appears {s.count(OLD)} times"
    p.write_text(s.replace(OLD, NEW), encoding="utf-8")
    done += 1
print(f"  MAP sentence updated in {done} pages")

# Asset cache keys: first 12 hex of each file's sha256, as the page already does.
html = REPO / "fourth-down.html"
s = html.read_text(encoding="utf-8")
old_css = re.search(r'fourth-down\.css\?v=([0-9a-f]+)', s).group(1)
for name in ["fourth-down.css", "fourth-down-engine.js", "fourth-down-analysis.js", "fourth-down-objectives.js",
             "fourth-down-lens.js", "fourth-down-explorer.js", "fourth-down-page.js"]:
    key = hashlib.sha256((REPO / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]
    s, n = re.subn(re.escape(name) + r'\?v=[0-9A-Za-z]+', f"{name}?v={key}", s)
    assert n == 1, f"{name}: {n} references in fourth-down.html"
html.write_text(s, encoding="utf-8")
new_css = re.search(r'fourth-down\.css\?v=([0-9a-f]+)', s).group(1)
be = REPO / "work/build_explore.py"
b = be.read_text(encoding="utf-8")
if old_css != new_css:
    assert b.count(f"fourth-down.css?v={old_css}") == 1, "build_explore.py no longer pins the template css link"
    be.write_text(b.replace(f"fourth-down.css?v={old_css}", f"fourth-down.css?v={new_css}"), encoding="utf-8")
print(f"  asset keys stamped (css {old_css} -> {new_css})")
