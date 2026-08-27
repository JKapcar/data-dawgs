"""
Coverage for the Am I Safe rework: order, the hub spin, the dropped confidence field, and
the single simulated season.

The order assertion is the one that matters most and is the easiest to lose: it is a
layout decision made deliberately (the wheel is what people open the page for), and
nothing else in the suite would notice if a later edit shuffled the cards back.

    cd work && py patch-lds-polish-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"
s = T.read_text(encoding="utf-8")

anchor = 'ok("prediction receipt is explicitly local-device V1",'
assert s.count(anchor) == 1, "anchor"

block = r'''/* ------------------- Am I Safe: order, hub, one season ------------------- */
/* ⚠ Deliberate order, and nothing else here would notice if it got shuffled back:
   wheel first (it is what people open the page for), then who is dying, then the decay
   curve, then the decay matrix, then a single sampled season. */
const SURV = html.slice(html.indexOf('id="gxSheetSurvival"'),
                        html.indexOf("</section>", html.indexOf('id="gxSheetSurvival"')));
const order = ["The Chop Wheel", "Am I Safe?", "The Long Game", "Week-by-week decay", "One simulated season"]
  .map(t => SURV.indexOf(t));
ok("the five cards are in the intended order, wheel first",
  order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), order.join(","));

// the hub IS the control now, not decoration with a grey button underneath
ok("spin one week is the wheel hub", /class="gx-hubspin"[^>]*id="gxSpinOne"/.test(html));
ok("spin ten survives as a secondary control", html.includes('id="gxSpinTen"'));

// ⚠️ Dropping the slider has to drop the stored field too — a receipt carrying a
// confidence the reader never set would record a claim they did not make.
ok("the confidence slider is gone", !html.includes('id="gxConfidence"'));
ok("and the receipt no longer stores a confidence", !/confidence:\s*Number/.test(html));

// one sampled season, drawn from the same model as the curves.
// ⚠️ Do NOT els.clear() here: the harness caches element stubs, so clearing hands
// back a fresh object with none of the wiring paint() just attached.
const oneBtn = byId("gxOneRun");
ok("the one-season button exists and enables with a league", !!oneBtn && oneBtn.disabled === false);
if (oneBtn && !oneBtn.disabled) oneBtn.onclick();
const oneHtml = byId("gxOneTab").innerHTML;
ok("a simulated season prints a full finishing order",
  (oneHtml.match(/<tr/g) || []).length - 1 >= 4, String((oneHtml.match(/<tr/g) || []).length));
ok("the finish table says who was chopped and when",
  oneHtml.includes("week ") || oneHtml.includes("still standing"));
ok("the single draw is labelled a sample, never a forecast",
  byId("gxOneNote").innerHTML.includes("SAMPLE") && html.includes("not a forecast"));

'''
s = s.replace(anchor, block + anchor, 1)
T.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-polish-tests: ok")
