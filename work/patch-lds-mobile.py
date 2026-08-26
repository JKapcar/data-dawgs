#!/usr/bin/env python3
"""Last Dawg Standing: put the machine room behind a door, and make the ladder
work on a phone.

Measured at 390px before this patch (nothing connected): the page is 3,990px
tall and the Modules list (1,250px) plus the "What this can't do" essay (695px)
are 49% of it. Both describe how the tool is built. Neither is something a
manager opens the page to read. They move behind one <details> back card —
kept reachable, because the honesty card is a house-style contract, just not
half the page.

League setup (the paste box, its explanation and the saved-league shelf) is a
once-per-device chore sitting in the middle of the hero. It becomes a drawer
that opens itself when nothing is connected and shuts once a league is.

⚠️ The ladder had min-width:520px, so on a 390px phone it hid 18 teams behind a
horizontal scroll nobody discovers, at ~29px per lane. Under 640px it becomes a
row list — name, bar, risk% — which is readable and tappable. Bar magnitude now
travels as --h (desktop height) and --p (mobile width) so one render serves
both.

Run from repo root:  python3 work/patch-lds-mobile.py
"""
import pathlib

P = pathlib.Path("guillotine.html")
s = P.read_text(encoding="utf-8")


def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}"
    s = s.replace(old, new)
    print(f"  ok  {label}")


# ------------------------------------------------------------------ CSS ----
sub(".pt-felt .gx-sound,.pt-felt .gx-tally{color:#c8bdb1}",
    """.pt-felt .gx-sound,.pt-felt .gx-tally{color:#c8bdb1}
/* ------------- setup drawer + back card: the machine room ---------------- */
.pt-setup{margin-top:16px;border-top:1px solid #3A2E24;padding-top:4px}
.pt-setup>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;
  padding:11px 2px;font:800 12px/1 inherit;letter-spacing:.08em;text-transform:uppercase;color:#B6A899}
.pt-setup>summary::-webkit-details-marker{display:none}
.pt-setup>summary::after{content:"▾";margin-left:auto;font-size:13px;color:#8E8073;transition:transform .18s ease}
.pt-setup[open]>summary::after{transform:rotate(180deg)}
.pt-setup>summary:hover{color:#ff8a3d}
.pt-setupwho{font-weight:600;letter-spacing:0;text-transform:none;color:#8E8073;font-size:12.5px}
.pt-back{border:1px solid var(--grid);border-radius:13px;background:var(--surface-1);margin:26px 0}
.pt-back>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:16px 18px;
  font:800 13px/1.35 inherit;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-2)}
.pt-back>summary::-webkit-details-marker{display:none}
.pt-back>summary::after{content:"▾";margin-left:auto;color:var(--ink-3);transition:transform .18s ease}
.pt-back[open]>summary::after{transform:rotate(180deg)}
.pt-back>summary:hover{color:var(--accent)}
.pt-backsub{display:block;font:400 12.5px/1.45 inherit;letter-spacing:0;text-transform:none;color:var(--ink-3);margin-top:4px}
.pt-backbody{padding:0 18px 6px;border-top:1px solid var(--grid)}
.pt-backbody .secn{margin-top:22px}
/* ------------------------------ phone ladder ----------------------------- */
.pt-col{height:var(--h,20px)}
@media(max-width:640px){
  .pt-ladderwrap{overflow:visible}
  .pt-ladder{min-width:0}
  /* live: one row per team — name, bar, risk. No hidden sideways scroll. */
  .pt-ladder.is-live{flex-direction:column;align-items:stretch;gap:3px}
  .pt-ladder.is-live .pt-lane{display:grid;grid-template-columns:1fr 104px 40px;align-items:center;
    gap:10px;min-width:0;padding:3px 0}
  .pt-ladder.is-live .pt-nm{writing-mode:horizontal-tb;transform:none;height:auto;font-size:12.5px;
    text-align:left;letter-spacing:.01em;text-transform:none;font-weight:700;color:#D9CFC4;min-width:0}
  .pt-ladder.is-live .pt-lane.me .pt-nm{color:#ff8a3d}
  .pt-ladder.is-live .pt-col{height:13px!important;width:var(--p,10%);border-radius:99px;justify-self:start}
  .pt-ladder.is-live .pt-lane:hover .pt-col{transform:none}
  .pt-ladder.is-live .pt-val{font-size:12.5px;text-align:right}
  /* preseason: it carries no information, so it stays a thin texture strip
     rather than 18 identical hatched rows. */
  .pt-ladder.is-flat .pt-nm,.pt-ladder.is-flat .pt-val{display:none}
  .pt-ladder.is-flat .pt-lane{min-width:0}
  .pt-ladder.is-flat .pt-col{height:44px!important}
  .pt-status{margin-left:0;width:100%}
  .pt-stat{flex:1 1 0;min-width:0;padding:9px 10px}
  .pt-back>summary,.pt-backbody{padding-left:14px;padding-right:14px}
}""",
    "CSS: drawer, back card, phone ladder")

# --------------------------------------------------- setup drawer markup ----
sub('    <div id="gxConnect" class="pt-connect">\n',
    """    <details class="pt-setup" id="gxSetup" open>
      <summary>League setup <span class="pt-setupwho" id="gxSetupWho">Not connected</span></summary>
    <div id="gxConnect">
""", "markup: setup drawer opens")

sub("""        <div class="gx-shelf-list" id="gxShelfList"></div>
      </div>
    </div>
""",
    """        <div class="gx-shelf-list" id="gxShelfList"></div>
      </div>
    </div>
    </details>
""", "markup: setup drawer closes")

# ------------------------------------------------------ back card markup ----
sub('  <div class="hero-card">\n    <h2>How survival compounds <span class="samp">Illustration &mdash; not your league</span></h2>',
    """  <details class="pt-back" id="gxBack">
    <summary>How this works
      <span class="pt-backsub">The seven modules, the maths behind the ladder, and an honest list of what this tool cannot do.</span>
    </summary>
    <div class="pt-backbody">

  <div class="hero-card" style="margin-top:18px">
    <h2>How survival compounds <span class="samp">Illustration &mdash; not your league</span></h2>""",
    "markup: back card opens")

sub("""  <div class="honesty">
    <h3>What this can't do</h3>""",
    """  <div class="honesty" style="margin-bottom:0">
    <h3>What this can't do</h3>""", "markup: honesty spacing")

# close the back card after the honesty block, before the footer
OLD_TAIL = """ The observed FAAB module encodes a framework about dollar appreciation, not a guarantee. The Draft War Room polls Sleeper every few seconds &mdash; near-live, not instant &mdash; and never writes to Sleeper; its pick matching is a name-and-position heuristic that can miss an unusual name, which a tap on the row fixes. The Guillotine Board&rsquo;s ranks, tiers and flags are editorial opinion built 2026-08-26 over the 2026-08-24 MV snapshot, not projections, and the FAAB War Plan is a dated editorial framework, not a bid engine.</p>
  </div>

  <footer>"""
NEW_TAIL = """ The observed FAAB module encodes a framework about dollar appreciation, not a guarantee. The Draft War Room polls Sleeper every few seconds &mdash; near-live, not instant &mdash; and never writes to Sleeper; its pick matching is a name-and-position heuristic that can miss an unusual name, which a tap on the row fixes. The Guillotine Board&rsquo;s ranks, tiers and flags are editorial opinion built 2026-08-26 over the 2026-08-24 MV snapshot, not projections, and the FAAB War Plan is a dated editorial framework, not a bid engine.</p>
  </div>

    </div>
  </details>

  <footer>"""
sub(OLD_TAIL, NEW_TAIL, "markup: back card closes")

# ------------------------------------------------------------------- JS -----
# bar magnitude travels as custom properties so one render serves both layouts
sub("""        var risk=1-t.surv,h=Math.round(26+(risk/max)*104),pct=Math.round(risk*100);
        var col=risk>=max*0.72?"linear-gradient(180deg,#FF5656,#8E1F1F)"
               :risk>=max*0.38?"linear-gradient(180deg,#E9A13D,#8A5510)"
               :"linear-gradient(180deg,#3FA37D,#17553F)";
        return '<button type="button" class="pt-lane'+(t.rid===mine?" me":"")+'" data-rid="'+t.rid+'" '
          +'title="'+esc(t.name)+' — '+pct+'% modeled chop risk">'
          +'<span class="pt-val">'+pct+'%</span>'
          +'<span class="pt-col" style="height:'+h+'px;background:'+col+'"></span>'
          +'<span class="pt-nm">'+esc(t.name)+'</span></button>';""",
    """        var risk=1-t.surv,h=Math.round(26+(risk/max)*104),pct=Math.round(risk*100);
        var col=risk>=max*0.72?"linear-gradient(180deg,#FF5656,#8E1F1F)"
               :risk>=max*0.38?"linear-gradient(180deg,#E9A13D,#8A5510)"
               :"linear-gradient(180deg,#3FA37D,#17553F)";
        /* --h drives the desktop column, --p the phone row. One render, two layouts. */
        return '<button type="button" class="pt-lane'+(t.rid===mine?" me":"")+'" data-rid="'+t.rid+'" '
          +'title="'+esc(t.name)+' — '+pct+'% modeled chop risk">'
          +'<span class="pt-val">'+pct+'%</span>'
          +'<span class="pt-col" style="--h:'+h+'px;--p:'+Math.max(8,Math.round(risk/max*100))+'%;background:'+col+'"></span>'
          +'<span class="pt-nm">'+esc(t.name)+'</span></button>';""",
    "JS: --h / --p on live bars")

sub("""          +'title="'+esc(t.name)+'"><span class="pt-val">&mdash;</span>'
          +'<span class="pt-col" style="height:96px;background:'+(t.rid===mine?mineg:ghost)+'"></span>'""",
    """          +'title="'+esc(t.name)+'"><span class="pt-val">&mdash;</span>'
          +'<span class="pt-col" style="--h:96px;--p:100%;background:'+(t.rid===mine?mineg:ghost)+'"></span>'""",
    "JS: --h / --p on flat bars")

# layout class + drawer state
sub("    if(live){\n      var max=Math.max.apply(null,rows.map(function(t){return 1-t.surv;}))||1;",
    """    box.className="pt-ladder "+(live?"is-live":"is-flat");
    if(live){
      var max=Math.max.apply(null,rows.map(function(t){return 1-t.surv;}))||1;""",
    "JS: ladder layout class")

sub("""    Array.prototype.forEach.call(box.querySelectorAll(".pt-lane"),function(b){
      b.onclick=function(){focus(Number(b.getAttribute("data-rid")));};});""",
    """    Array.prototype.forEach.call(box.querySelectorAll(".pt-lane"),function(b){
      b.onclick=function(){focus(Number(b.getAttribute("data-rid")));};});
    /* Setup is a once-per-device chore: shut the drawer as soon as a league is in,
       and let its summary carry the league name so nothing is hidden. */
    var setup=document.getElementById("gxSetup"),who=document.getElementById("gxSetupWho");
    if(who)who.textContent=G.league?G.league:"Not connected";
    if(setup&&G.leagueId)setup.open=false;""",
    "JS: close the setup drawer once connected")

P.write_text(s, encoding="utf-8")
print("\nguillotine.html patched (mobile).")
