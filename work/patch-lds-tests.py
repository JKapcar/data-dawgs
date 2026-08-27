"""
test-guillotine: drop the Draft War Room block, retarget the three structure assertions.

The 15 Draft War Room assertions go with the sheet they covered. The other three failures
are NOT draft tests -- they are structure guards that were describing the old layout, so
they are RETARGETED rather than deleted. A structure guard that gets deleted the moment
structure changes was never a guard.

    cd work && py patch-lds-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"

s = T.read_text(encoding="utf-8")
before = s.count(NL)

# ---- the Draft War Room block, banner through the Toto ctx assertion --------
start = s.index("/* ----------------------------- Draft War Room ---------------------------- */")
end = s.index("/* ------------------- Prime Time hero: the danger ladder ------------------ */")
assert start < end
s = s[:start] + s[end:]

# ---- retarget: the wheel now lives INSIDE Am I Safe -------------------------
old = 'ok("the wheel moved to its own sheet", html.includes(\'data-gx-panel="wheel"\'));'
new = ('/* ⚠ The wheel USED to be its own sheet. It and the decay curve now live inside\n'
       '   Am I Safe, which is the whole point of the consolidation -- assert the fold,\n'
       '   not just that the markup exists somewhere on the page. */\n'
       'ok("the wheel and the decay curve live inside Am I Safe",\n'
       '  html.indexOf(\'id="gxSheetSurvival"\') < html.indexOf(\'id="gxWheel"\')\n'
       '  && html.indexOf(\'id="gxWheel"\') < html.indexOf(\'id="gxSeasonChart"\')\n'
       '  && html.indexOf(\'id="gxSeasonChart"\')\n'
       '     < html.indexOf(\'</section>\', html.indexOf(\'id="gxSheetSurvival"\')));\n'
       'ok("the wheel and the season sheets no longer exist on their own",\n'
       '  !html.includes(\'data-gx-panel="wheel"\') && !html.includes(\'data-gx-panel="season"\'));')
assert s.count(old) == 1, "wheel assertion"
s = s.replace(old, new, 1)

# ---- retarget: the tab strip -----------------------------------------------
old = ('ok("tab labels are plain English",' + NL +
       '  ["Am I Safe?", "Draft Room", "Full Board", "The Money", "Chop Wheel", "The Long Game", "Weak Spots"]' + NL +
       '    .every(t => html.includes(">" + t + "</button>")));')
new = ('ok("tab labels are plain English",' + NL +
       '  ["Am I Safe?", "Full Board", "The Money", "Weak Spots"]' + NL +
       '    .every(t => html.includes(">" + t + "</button>")));' + NL +
       'ok("the folded and removed tabs are gone from the strip",' + NL +
       '  ["Draft Room", "Chop Wheel", "The Long Game"]' + NL +
       '    .every(t => !html.includes(">" + t + "</button>")));' + NL +
       '/* ⚠ These read as DISABLED text before: var(--ink-3) uppercase on cream, which is' + NL +
       '   why the sheets went unused. The strip is a segmented control now. */' + NL +
       'ok("the tab strip is not painted in the disabled-text ink",' + NL +
       '  !/\.gx-tabs button\{[^}]*color:var\(--ink-3\)/.test(html));')
assert s.count(old) == 1, "tab labels assertion"
s = s.replace(old, new, 1)

# ---- retarget: sheet inventory ---------------------------------------------
old = ('ok("all six lower sheets are present",' + NL +
       '  ["survival", "draft", "waivers", "danger", "season", "fragility"].every(k => html.includes(`data-gx-panel="${k}"`)));')
new = ('ok("all four lower sheets are present",' + NL +
       '  ["survival", "waivers", "danger", "fragility"].every(k => html.includes(`data-gx-panel="${k}"`)));' + NL +
       'ok("the draft room is gone in full — sheet, script and Toto surface",' + NL +
       '  !html.includes(\'data-gx-panel="draft"\') && !html.includes("dd-guillotine-draft-v1")' + NL +
       '  && !html.includes("__GXD") && !html.includes("DRAFT WAR ROOM"));')
assert s.count(old) == 1, "sheet inventory assertion"
s = s.replace(old, new, 1)

T.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-tests: ok (%d -> %d lines)" % (before, s.count(NL)))
