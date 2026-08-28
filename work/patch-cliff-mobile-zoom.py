"""
The cliff chart is usable on a phone at a live draft.

Reported from the draft room: on desktop the chart is fine, on mobile it is too dense to
plan with. The prior mobile mode squeezed all ~450 bars into ~300px, which was a
deliberate choice and a defensible one — a cliff is a SHAPE, and you cannot read a shape
nine bars at a time. But the shape is the pre-draft question. Mid-draft, on a phone, the
question is "who is left in this tier and what do they cost", and a 0.7px bar cannot
answer it. Both readings are real, so keep both and default to the one the room needs.

  · mobile now defaults to ZOOMED: 11px bars with a 2px gutter, scrolling sideways,
    with last names under the bars — the same reading the desktop chart gives.
  · a Zoom / Fit toggle keeps the whole-shape view one tap away rather than deleting it.
  · desktop is untouched: 14px bars, no toggle shown, because it never had the problem.

The names come back on mobile because at 11px they fit; the old code dropped them at
1.7px, where a rotated last name really was ink rather than information.

Run:  cd work && python3 patch-cliff-mobile-zoom.py && python3 stamp-sw-version.py
"""
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
p = REPO / "dataviz.html"
s = p.read_text(encoding="utf-8")

OLD_SIZING = '''  const cw=container.clientWidth||1100;
  const m={t:18,r:14,b:44,l:40}, H=330;
  const fit = cw < 620;
  const GAP = fit ? 0 : 3;                               // no gutter: 155 gutters IS the chart
  const BW  = fit ? Math.max(1, (cw - m.l - m.r) / n) : 14;'''
NEW_SIZING = '''  const cw=container.clientWidth||1100;
  const m={t:18,r:14,b:44,l:40}, H=330;
  const narrow = cw < 620;
  /* ⚠️ ON A PHONE THE DEFAULT IS ZOOMED, NOT FITTED. Squeezing ~450 bars into 300px shows
     the cliff's SHAPE, which is the right answer before the draft and the wrong one
     during it: mid-draft the question is "who is left in this tier and what do they
     cost", and a 0.7px bar cannot answer it. The shape reading is kept one tap away on
     the Zoom/Fit toggle rather than deleted. Desktop never had the problem and is
     unchanged. */
  const fit = narrow && cliffFit;
  const GAP = fit ? 0 : (narrow ? 2 : 3);                // no gutter when fitting: 155 gutters IS the chart
  const BW  = fit ? Math.max(1, (cw - m.l - m.r) / n) : (narrow ? 11 : 14);'''
if s.count(OLD_SIZING) != 1:
    sys.exit(f"FAIL sizing block matched {s.count(OLD_SIZING)} times")
s = s.replace(OLD_SIZING, NEW_SIZING, 1)

# names return whenever the bars are wide enough to carry them
OLD_LBL = "    // last-name label under every bar, rotated — wide screens only\n    if(!fit){"
NEW_LBL = ("    /* last-name label under every bar, rotated. Gated on WIDTH, not on screen size:\n"
           "       at 11px a name reads, at 1.7px it is ink. */\n"
           "    if(BW >= 7){")
if s.count(OLD_LBL) != 1:
    sys.exit(f"FAIL label gate matched {s.count(OLD_LBL)} times")
s = s.replace(OLD_LBL, NEW_LBL, 1)

OLD_STATE = 'let cliffHide=false;      // true = drop drafted players so the chart shrinks to what\'s left'
NEW_STATE = (OLD_STATE + "\n"
             "let cliffFit=false;       // phones only: true = squeeze every bar in to read the SHAPE,\n"
             "                          // false (default) = 11px bars you can actually plan against")
if s.count(OLD_STATE) != 1:
    sys.exit("FAIL cliff state anchor not unique")
s = s.replace(OLD_STATE, NEW_STATE, 1)

OLD_TOG = '''        <span class="vtog" id="cliffTog">
          <button type="button" data-v="0"${cliffHide?"":' class="on"'}>All players</button>
          <button type="button" data-v="1"${cliffHide?' class="on"':""}>Hide drafted</button>
        </span>'''
NEW_TOG = OLD_TOG + '''
        <span class="vtog" id="cliffZoom" style="display:none">
          <button type="button" data-v="0"${cliffFit?"":' class="on"'}>Zoom</button>
          <button type="button" data-v="1"${cliffFit?' class="on"':""}>Fit all</button>
        </span>'''
if s.count(OLD_TOG) != 1:
    sys.exit("FAIL toggle markup not unique")
s = s.replace(OLD_TOG, NEW_TOG, 1)

OLD_HANDLER = '''  document.getElementById("cliffTog").addEventListener("click",e=>{
    const b=e.target.closest("button"); if(!b) return;
    cliffHide = b.dataset.v==="1"; render();
  });'''
NEW_HANDLER = OLD_HANDLER + '''
  /* The zoom control is meaningless on a wide screen — the bars are already 14px — so it
     is only shown where it does something. */
  {
    const z=document.getElementById("cliffZoom");
    const cc=document.getElementById("chartCliff");
    if(z && cc && (cc.clientWidth||1100) < 620){
      z.style.display="";
      z.addEventListener("click",e=>{
        const b=e.target.closest("button"); if(!b) return;
        cliffFit = b.dataset.v==="1"; render();
      });
    }
  }'''
if s.count(OLD_HANDLER) != 1:
    sys.exit("FAIL toggle handler not unique")
s = s.replace(OLD_HANDLER, NEW_HANDLER, 1)

# the hint should describe whichever mode is showing
OLD_HINT = '''  if(W>cw+1) hint.textContent="Scroll right for the rest of the board →";
  // ⚠️ Say so when the labels are gone, or the phone chart reads as a rendering failure.
  else if(fit) hint.textContent=`All ${n} players, most valuable first — tap any bar for the name and price.`;'''
NEW_HINT = '''  if(W>cw+1) hint.textContent=`Scroll right for the rest of the board → (${n} players${narrow?" · tap Fit all for the whole shape":""})`;
  // ⚠️ Say so when the labels are gone, or the phone chart reads as a rendering failure.
  else if(fit) hint.textContent=`All ${n} players, most valuable first — tap any bar for the name and price.`;'''
if s.count(OLD_HINT) != 1:
    sys.exit("FAIL hint block not unique")
s = s.replace(OLD_HINT, NEW_HINT, 1)

p.write_text(s, encoding="utf-8", newline="\n")
print("  dataviz.html: mobile cliff defaults to 11px zoomed bars, Zoom/Fit toggle, names gated on width")
