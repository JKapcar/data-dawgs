"""
Last Dawg Standing polish: the wheel spins from its own hub, the team selector stops
looking like debug output, the confidence slider goes, and the Monte Carlo gets a
single-season result you can actually read.

1. SPIN FROM THE HUB. The wheel had a gold hub drawn on canvas doing nothing while the
   control that spins it sat underneath in a row of grey buttons. The hub is now the
   button: an absolutely-positioned circle over the canvas centre, sized off the same
   HUB radius the canvas draws (78 of 760 => ~20.5% diameter), so it lands on the hub at
   every width without a second magic number. "Spin 10 weeks" survives as a quiet
   secondary underneath -- it does something the hub cannot, so removing it would cost a
   feature rather than tidy one.

2. CONFIDENCE COMES OUT. It was a slider nobody moved that then rode along in the saved
   receipt. Dropping the control means dropping the field: a receipt that still carried a
   confidence number the reader never set would be recording a claim they did not make.

3. THE TEAM SELECTOR. It was a bare wrap of 11px pills that read as debug output. Now a
   proper control: a rounded track, chips with room to breathe, a selected state that
   fills rather than only changing border colour, and your own team pinned first and
   visually distinct. Horizontal scroll with the wrap kept on narrow screens.

4. SIMULATED RESULT. The Monte Carlo showed distributions -- survival curves and a heat
   matrix -- which answer "how often" but never "what does one season look like". One
   button now runs a single season off the same maths and prints the finishing order,
   last dawg first, with the week each team went. It is the same model, so it is labelled
   as one draw from it and not a forecast.

    cd work && py patch-lds-polish.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ============================ 1. the hub spin ===============================
old = ('            <div class="gx-wheel-controls">' + NL +
       '              <button class="btn pt-spin" id="gxSpinOne" type="button" disabled>Spin one week</button>' + NL +
       '              <button class="btn" id="gxSpinTen" type="button" disabled>Spin 10 weeks</button>' + NL +
       '              <label class="gx-sound"><input type="checkbox" id="gxSound"> Sound</label>' + NL +
       '            </div>')
new = ('            <button class="gx-hubspin" id="gxSpinOne" type="button" disabled ' +
       'aria-label="Spin one week"><span>SPIN</span><small>one week</small></button>' + NL +
       '            <div class="gx-wheel-controls">' + NL +
       '              <button class="btn gx-secondary" id="gxSpinTen" type="button" disabled>Spin 10 weeks</button>' + NL +
       '              <label class="gx-sound"><input type="checkbox" id="gxSound"> Sound</label>' + NL +
       '            </div>')
assert s.count(old) == 1, "wheel controls"
s = s.replace(old, new, 1)

# ============================ 2. confidence out =============================
old = ('              <label class="gx-sound" for="gxConfidence">Confidence <b id="gxConfOut">60%</b></label>' + NL +
       '              <input id="gxConfidence" type="range" min="50" max="99" value="60">' + NL)
assert s.count(old) == 1, "confidence control"
s = s.replace(old, "", 1)

old = '  var conf=document.getElementById("gxConfidence");conf.oninput=function(){document.getElementById("gxConfOut").textContent=conf.value+"%";};'
assert s.count(old) == 1, "confidence handler"
s = s.replace(old, "", 1)

old = 'r.team+" · "+r.confidence+"% · saved "'
new = 'r.team+" · saved "'
assert s.count(old) == 1, "receipt text"
s = s.replace(old, new, 1)

old = 'rosterId:t.rid,confidence:Number(conf.value),savedAt:Date.now()'
new = 'rosterId:t.rid,savedAt:Date.now()'
assert s.count(old) == 1, "receipt payload"
s = s.replace(old, new, 1)

# ============================ 3. styles =====================================
old = ('.gx-cmp{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 2px}' + NL +
       '.gx-cmp button{border:1px solid var(--grid);background:var(--surface-1);color:var(--ink-2);' + NL +
       '  border-radius:999px;padding:5px 11px;font:700 11px/1.2 inherit;cursor:pointer}' + NL +
       '.gx-cmp button.on{border-color:currentColor}' + NL +
       '.gx-cmp button.me{color:var(--accent);border-color:var(--accent);font-weight:800;cursor:default}')
assert s.count(old) == 1, "cmp css"
new = r'''/* ⚠ This was a bare wrap of 11px pills and it read as debug output rather than a
   control. A selected chip changed only its border colour, which is invisible at that
   size. It is a real track now, the selected state FILLS, and the hit target clears the
   44px guidance. */
.gx-cmp{display:flex;gap:7px;margin:16px 0 6px;padding:7px;background:var(--surface-1);
  border:1px solid var(--grid);border-radius:16px;overflow-x:auto;scrollbar-width:thin;
  -webkit-overflow-scrolling:touch}
.gx-cmp button{flex:0 0 auto;border:1px solid transparent;background:transparent;color:var(--ink-1);
  border-radius:999px;padding:9px 14px;min-height:38px;font:700 12px/1.2 inherit;cursor:pointer;
  white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.gx-cmp button:hover{background:color-mix(in srgb,var(--ink-1) 7%,transparent)}
.gx-cmp button.on{color:#fff;background:currentColor;box-shadow:inset 0 0 0 999px currentColor}
.gx-cmp button.me{color:var(--accent);border-color:var(--accent);font-weight:800;cursor:default;
  background:color-mix(in srgb,var(--accent) 12%,transparent);box-shadow:none}
@media(max-width:520px){.gx-cmp{flex-wrap:wrap;overflow-x:visible}}

/* The hub was decoration and the control was a grey button underneath it. Sized off the
   canvas HUB radius (78/760) so it sits on the hub at any width. */
/* ⚠ NOT position:absolute against .gx-wheelbox -- that box also holds the controls and
   the tally, so its centre sits ~226px BELOW the canvas centre and the hub landed on the
   felt under the wheel. Sharing grid cell 1/1 with the canvas centres it on the WHEEL,
   and makes the % width resolve against the canvas rather than the whole column. */
.gx-wheelbox canvas{grid-area:1/1}
.gx-hubspin{grid-area:1/1;place-self:center;position:relative;
  /* the canvas is width:min(100%,430px) and draws its hub at 156/760 of that, so the
     button matches at both ends: 20.5% while the wheel is fluid, capped at 88px once
     the canvas stops growing. A bare 20.5% resolves against the GRID CELL, which is
     wider than the wheel on a desktop, and the button overhung the slices. */
  width:min(20.5%,88px);aspect-ratio:1;border-radius:50%;cursor:pointer;z-index:2;
  border:3px solid #E0A93B;background:radial-gradient(circle at 42% 38%,#4A3B22,#0C0A07 72%);
  color:#F2C260;display:grid;place-content:center;gap:1px;text-align:center;
  box-shadow:0 6px 18px rgba(0,0,0,.55);transition:transform .12s,box-shadow .12s}
.gx-hubspin span{font:800 clamp(10px,2.1vw,15px)/1 inherit;letter-spacing:.10em}
.gx-hubspin small{font:700 clamp(7px,1.3vw,9px)/1 inherit;color:#C8A96B}
.gx-hubspin:hover:not(:disabled){transform:scale(1.045);box-shadow:0 8px 24px rgba(0,0,0,.6)}
.gx-hubspin:active:not(:disabled){transform:scale(.97)}
.gx-hubspin:disabled{cursor:default;opacity:.55}
.gx-secondary{background:transparent;border:1px solid #6b5a41;color:#d9cbb4}'''
# ⚠ The old .gx-cmp rules sat INSIDE `@media(max-width:640px){` (opened at the top of that
# block), so the team selector was styled ONLY on narrow screens and rendered as unstyled
# browser buttons on a desktop -- which is exactly why it looked like debug output. Editing
# in place would have inherited that scope, so the block is DELETED there and the new rules
# are inserted at top level, with only the wrap tweak left behind a media query.
s = s.replace(old, "", 1)
mq = "@media(max-width:640px){" + NL
assert s.count(mq) == 1, "top-level media query anchor"
s = s.replace(mq, new + NL + mq, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-polish (wheel + selector + confidence): ok")
