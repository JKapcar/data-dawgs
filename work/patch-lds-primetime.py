#!/usr/bin/env python3
"""Last Dawg Standing -> Prime Time structure + The House wheel.

Structure (Prime Time): the hero becomes the DANGER LADDER — every team a bar,
the cut line drawn through it. It works at 18 teams where a wheel's slices get
too thin to label, and it degrades honestly: preseason the bars are flat and
hatched, which reads "not started" rather than "broken". The wheel moves to its
own sheet and gets The House treatment (brass ring, radial labels, depth).

⚠️ Fixes a live legibility bug: .dtab td / th inherit var(--ink-1)/(--ink-3),
which are DARK inks. Inside .gx-stage (a dark panel on a light page) that is
dark-on-dark — the team table rendered as blank rows. Every colour inside the
stage is now explicit.

Run from repo root:  python3 work/patch-lds-primetime.py
"""
import re, sys, pathlib

P = pathlib.Path("guillotine.html")
s = P.read_text(encoding="utf-8")


def sub(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"{label}: expected 1 occurrence, found {n}"
    s = s.replace(old, new)
    print(f"  ok  {label}")


# ---------------------------------------------------------------- 1. CSS ----
CSS = """
/* ===================== PRIME TIME · broadcast hero ======================
   ⚠️ Every colour in here is explicit. .dtab and .legend resolve to var(--ink-*),
   which are dark inks — inside this dark stage that rendered the team table as
   blank rows on the live page. Do not reintroduce a token here without checking
   it against the dark panel, not the light page. */
.gx-stage{background:
   radial-gradient(125% 105% at 50% -28%,rgba(255,106,0,.20),transparent 58%),
   linear-gradient(180deg,#1B1611,#0E0B09)!important;border-color:#4A3A2C!important}
.gx-stage .dtab td,.gx-stage .dtab th{color:#D9CFC4;border-bottom-color:#3A2E24}
.gx-stage .dtab th{color:#9C8E80}
.pt-lower{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:0 0 16px}
.pt-title{margin:0;font-size:clamp(30px,4.6vw,42px);font-weight:800;line-height:.98;
  letter-spacing:-.022em;color:#F8F3EC;text-transform:uppercase}
.pt-title em{color:#ff8a3d;font-style:normal}
.pt-title .samp{vertical-align:middle;margin-left:8px}
.pt-tag{margin:7px 0 0;font-size:13.5px;line-height:1.5;color:#B6A899;max-width:46ch}
.pt-status{margin-left:auto;display:flex;gap:9px;flex-wrap:wrap}
.pt-stat{background:#221B15;border:1px solid #443528;border-radius:10px;padding:9px 15px;min-width:96px}
.pt-stat .v{font:600 21px/1.15 ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums;color:#F8F3EC}
.pt-stat .v.acc{color:#ff8a3d}
.pt-stat .l{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:#8E8073;margin-top:3px}
.pt-ladderwrap{overflow-x:auto;padding-bottom:2px}
.pt-ladder{display:flex;gap:5px;align-items:flex-end;min-width:520px}
.pt-lane{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;
  gap:6px;min-width:26px;cursor:pointer;background:none;border:0;padding:0;font:inherit}
.pt-col{width:100%;border-radius:6px 6px 3px 3px;background:linear-gradient(180deg,#3A2E24,#241C16);
  transition:transform .16s cubic-bezier(.2,.8,.3,1),filter .16s ease}
.pt-lane:hover .pt-col,.pt-lane:focus-visible .pt-col{transform:translateY(-4px);filter:brightness(1.28)}
.pt-lane.me .pt-col{box-shadow:0 0 0 1px #ff8a3d,0 6px 18px -8px rgba(255,138,61,.8)}
.pt-val{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#A29486;
  font-variant-numeric:tabular-nums}
.pt-lane.me .pt-val{color:#ff8a3d}
/* ⚠️ Names run vertically. 18 lanes across this panel is ~50px each; horizontal
   text truncates every team to five characters. Rotated names fit whole. */
.pt-nm{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8E8073;
  writing-mode:vertical-rl;transform:rotate(180deg);height:88px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.pt-lane.me .pt-nm{color:#ff8a3d;font-weight:800}
.pt-cut{position:relative;margin:13px 0 0;border-top:2px dashed rgba(255,86,86,.55)}
.pt-cutlab{position:absolute;top:-9px;left:0;background:#120E0B;padding-right:10px;
  font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.11em;
  text-transform:uppercase;color:#ff7a7a}
.pt-flat{margin:11px 0 0;font-size:12.5px;color:#9C8E80;text-align:center}
.pt-connect{margin-top:18px;border-top:1px solid #3A2E24;padding-top:16px}
/* ---------------------- The House wheel, its own sheet ------------------- */
.pt-wheelgrid{display:grid;grid-template-columns:minmax(280px,1fr) minmax(240px,.75fr);
  gap:24px;align-items:center}
.pt-felt{background:
   radial-gradient(85% 70% at 30% 0%,rgba(224,169,59,.13),transparent 62%),
   linear-gradient(180deg,#122318,#0B1610);border:1px solid #2A4030;border-radius:14px;padding:22px}
.gx-wheelbox canvas{filter:drop-shadow(0 22px 44px rgba(0,0,0,.75))}
.pt-land{animation:ptland .5s ease-out}
@keyframes ptland{0%{filter:drop-shadow(0 0 0 rgba(255,138,61,0))}
  45%{filter:drop-shadow(0 0 26px rgba(255,170,60,.85))}
  100%{filter:drop-shadow(0 22px 44px rgba(0,0,0,.75))}}
.pt-wheelside .pt-stat{width:100%;margin-bottom:9px}
.gx-stage .btn.pt-spin,.pt-felt .btn.pt-spin{background:linear-gradient(180deg,#F2C260,#C9922C);
  color:#170D02;border:0;font-weight:800;letter-spacing:.03em;
  box-shadow:0 4px 0 #6F5119,0 10px 20px -8px rgba(0,0,0,.75)}
.pt-felt .btn.pt-spin:hover{color:#170D02;background:linear-gradient(180deg,#FFD37A,#D89F31)}
.pt-felt .btn.pt-spin:active{transform:translateY(3px);box-shadow:0 1px 0 #6F5119}
.pt-felt .btn.pt-spin:disabled{background:#3A3226;color:#8A7F6B;box-shadow:none}
/* ------------------------------ tab strip -------------------------------- */
.gx-tabs{gap:0;border-bottom:1px solid var(--grid);padding:0;margin:18px 0 16px}
.gx-tabs button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;
  padding:12px 15px;font:800 12.5px/1 inherit;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)}
.gx-tabs button:hover{color:var(--ink-1)}
.gx-tabs button.on{background:transparent;color:var(--accent);border-bottom-color:var(--accent)}
@media(max-width:760px){.pt-wheelgrid{grid-template-columns:1fr}.pt-status{margin-left:0;width:100%}
  .pt-nm{height:70px;font-size:10.5px}.pt-stat{flex:1 1 90px;min-width:0}}
"""
sub(".gxd-onclock .sv{color:var(--good)}",
    ".gxd-onclock .sv{color:var(--good)}\n" + CSS.strip(),
    "CSS: Prime Time block")

# ------------------------------------------------------- 2. hero markup ----
sub(
    '    <h2>Chop Chamber &middot; one modeled week <span class="samp" id="gxState">Not connected</span></h2>\n',
    """    <div class="pt-lower">
      <div>
        <h2 class="pt-title">Who&rsquo;s <em>Dying</em> <span class="samp" id="gxState">Not connected</span></h2>
        <p class="pt-tag" id="gxHeroTag">Every bar is a team. The taller the bar, the likelier the chop.</p>
      </div>
      <div class="pt-status" id="gxHeroStats"></div>
    </div>
    <div class="pt-ladderwrap"><div class="pt-ladder" id="gxLadder"></div></div>
    <div class="pt-cut"><span class="pt-cutlab" id="gxCutLab">Cut line &middot; drawn once scores exist</span></div>
    <p class="pt-flat" id="gxFlat">Connect a league below and the ladder fills in.</p>
""", "hero: broadcast lower-third + ladder")

# the connect box gets a rule above it now that it sits under the ladder
sub('    <div id="gxConnect">\n', '    <div id="gxConnect" class="pt-connect">\n', "connect: divider")

# --------------------------------- 3. move wheel + predict off the stage ----
WHEEL_BLOCK = """    <div class="gx-stage-grid">
      <div class="gx-wheelbox">
        <div class="gx-pointer" aria-hidden="true"></div>
        <canvas id="gxWheel" width="760" height="760" role="img" aria-label="Probability-weighted simulated chop wheel"></canvas>
        <div class="gx-wheel-controls">
          <button class="btn" id="gxSpinOne" type="button" disabled>Spin one week</button>
          <button class="btn" id="gxSpinTen" type="button" disabled>Spin 10 weeks</button>
          <label class="gx-sound"><input type="checkbox" id="gxSound"> Sound</label>
        </div>
        <div class="gx-tally" id="gxTally">Connect a league to load the wheel.</div>
      </div>
      <div>
    <div id="gxLive" style="display:none">
      <div class="bigstat">
        <span class="v" id="gxPct">&mdash;</span>
        <span class="l" id="gxPctL"></span>
      </div>
      <div class="gauge" id="gxGauge"></div>
      <div class="statrow" id="gxStats"></div>
      <div class="tscroll" style="margin-top:20px"><table class="dtab" id="gxTab"></table></div>
      <p class="legend" id="gxNote"></p>
    </div>
      </div>
    </div>
    <div class="gx-predict" id="gxPredict" hidden>
      <h3>Weekly chopped-team prediction</h3>
      <div class="controls">
        <select id="gxPredTeam" aria-label="Predicted chopped team"></select>
        <label class="gx-sound" for="gxConfidence">Confidence <b id="gxConfOut">60%</b></label>
        <input id="gxConfidence" type="range" min="50" max="99" value="60">
        <button class="btn" id="gxPredSave" type="button">Save device receipt</button>
      </div>
      <p class="legend" id="gxDeadline" style="margin-top:8px">Deadline: Sunday at 1:00 PM Eastern.</p>
      <div class="gx-receipt" id="gxReceipt"></div>
    </div>
  </div>
"""
sub(WHEEL_BLOCK, "  </div>\n", "stage: lift wheel/live/predict out")

# ----------------------------------------------------------- 4. the tabs ----
sub("""    <button class="on" role="tab" aria-selected="true" data-gx-sheet="survival">My Survival Card</button>
    <button role="tab" aria-selected="false" data-gx-sheet="draft">Draft War Room</button>
    <button role="tab" aria-selected="false" data-gx-sheet="waivers">FAAB &amp; Waivers</button>
    <button role="tab" aria-selected="false" data-gx-sheet="danger">League Danger Board</button>
    <button role="tab" aria-selected="false" data-gx-sheet="season">Season Outlook</button>
    <button role="tab" aria-selected="false" data-gx-sheet="fragility">Roster Fragility</button>""",
    """    <button class="on" role="tab" aria-selected="true" data-gx-sheet="survival">Am I Safe?</button>
    <button role="tab" aria-selected="false" data-gx-sheet="draft">Draft Room</button>
    <button role="tab" aria-selected="false" data-gx-sheet="danger">Full Board</button>
    <button role="tab" aria-selected="false" data-gx-sheet="waivers">The Money</button>
    <button role="tab" aria-selected="false" data-gx-sheet="wheel">Chop Wheel</button>
    <button role="tab" aria-selected="false" data-gx-sheet="season">The Long Game</button>
    <button role="tab" aria-selected="false" data-gx-sheet="fragility">Weak Spots</button>""",
    "tabs: plain-English names + wheel sheet")

# --------------------------- 5. survival sheet takes #gxLive, add wheel sheet -
sub("""    <div class="hero-card"><h2>My Survival Card <span class="gx-private">Private focus team</span></h2><div class="statrow" id="gxSurvivalCard"></div><p class="legend">Your focus team is a private preference, not verified Sleeper roster ownership. Pick any team from the weekly table or Danger Board.</p></div>
  </section>""",
    """    <div class="hero-card"><h2>Am I Safe? <span class="gx-private">Private focus team</span></h2><div class="statrow" id="gxSurvivalCard"></div><p class="legend">Your focus team is a private preference, not verified Sleeper roster ownership. Pick any team from the ladder above or the Full Board.</p></div>
    <div class="hero-card" id="gxLive" style="display:none">
      <div class="bigstat">
        <span class="v" id="gxPct">&mdash;</span>
        <span class="l" id="gxPctL"></span>
      </div>
      <div class="gauge" id="gxGauge"></div>
      <div class="statrow" id="gxStats"></div>
      <div class="tscroll" style="margin-top:20px"><table class="dtab" id="gxTab"></table></div>
      <p class="legend" id="gxNote"></p>
    </div>
  </section>

  <section class="gx-sheet" id="gxSheetWheel" data-gx-panel="wheel" hidden>
    <div class="hero-card">
      <h2>The Chop Wheel <span class="samp">Simulation &middot; not live scores</span></h2>
      <p class="legend" style="margin:0 0 14px">Each slice is a team, sized by that team&rsquo;s modeled chop risk for the coming week. Spinning draws from that distribution &mdash; it is a way to feel the odds, not a second opinion about them.</p>
      <div class="pt-wheelgrid">
        <div class="pt-felt">
          <div class="gx-wheelbox">
            <div class="gx-pointer" aria-hidden="true"></div>
            <canvas id="gxWheel" width="760" height="760" role="img" aria-label="Probability-weighted simulated chop wheel"></canvas>
            <div class="gx-wheel-controls">
              <button class="btn pt-spin" id="gxSpinOne" type="button" disabled>Spin one week</button>
              <button class="btn" id="gxSpinTen" type="button" disabled>Spin 10 weeks</button>
              <label class="gx-sound"><input type="checkbox" id="gxSound"> Sound</label>
            </div>
            <div class="gx-tally" id="gxTally">Connect a league to load the wheel.</div>
          </div>
        </div>
        <div class="pt-wheelside">
          <div class="gx-predict" id="gxPredict" hidden style="margin-top:0">
            <h3>Weekly chopped-team prediction</h3>
            <div class="controls">
              <select id="gxPredTeam" aria-label="Predicted chopped team"></select>
              <label class="gx-sound" for="gxConfidence">Confidence <b id="gxConfOut">60%</b></label>
              <input id="gxConfidence" type="range" min="50" max="99" value="60">
              <button class="btn" id="gxPredSave" type="button">Save device receipt</button>
            </div>
            <p class="legend" id="gxDeadline" style="margin-top:8px">Deadline: Sunday at 1:00 PM Eastern.</p>
            <div class="gx-receipt" id="gxReceipt"></div>
          </div>
        </div>
      </div>
    </div>
  </section>""",
    "sheets: survival takes #gxLive, new Chop Wheel sheet")

# ------------------------------------------------- 6. remaining sheet copy ---
for old, new, lab in [
    ("<h2>League Danger Board <span class=\"samp\">Shareable league view</span></h2>",
     "<h2>Full Board <span class=\"samp\">Shareable league view</span></h2>", "copy: Full Board"),
    ("<h2>Season Outlook <span class=\"samp\">Shareable framework</span></h2>",
     "<h2>The Long Game <span class=\"samp\">Shareable framework</span></h2>", "copy: The Long Game"),
    ("<h2>Roster Fragility <span class=\"samp\">V1 &middot; volatility + floor</span></h2>",
     "<h2>Weak Spots <span class=\"samp\">V1 &middot; volatility + floor</span></h2>", "copy: Weak Spots"),
    ("<h2>FAAB pacing <span class=\"samp\" id=\"gxFaabState\">Observed &middot; Sleeper</span></h2>",
     "<h2>The Money &middot; FAAB pacing <span class=\"samp\" id=\"gxFaabState\">Observed &middot; Sleeper</span></h2>",
     "copy: The Money"),
    ("aria-label=\"Last Dawg Standing sheets\"", "aria-label=\"Last Dawg Standing sheets\"", "noop"),
]:
    if lab != "noop":
        sub(old, new, lab)

# ------------------------------------- 7. names in the empty stash, for the ladder
sub("""      window.__GX = { leagueId: id, league: league.name, season: league.season, teamCount: teams.length,
                      done: done, faab: faab, teams: [] };""",
    """      /* `all` carries every team's name even when the survival maths is off, so the
         hero ladder can render a real preseason roster instead of anonymous bars. */
      window.__GX = { leagueId: id, league: league.name, season: league.season, teamCount: teams.length,
                      done: done, faab: faab, teams: [],
                      all: teams.map(function(t){ return {rid:t.rid, name:t.name, owner:t.owner, dead:!!t.dead}; }) };""",
    "stash: names on the empty path")

sub("""      me: me && {rid:me.rid, name: me.name, surv: me.surv, mean: me.mean},
      teams: live.map(function(t){ return {rid:t.rid, name:t.name, owner:t.owner, surv:t.surv,
        mean:t.mean, sd:t.sd, low:t.low, last:t.last}; })""",
    """      me: me && {rid:me.rid, name: me.name, surv: me.surv, mean: me.mean},
      all: teams.map(function(t){ return {rid:t.rid, name:t.name, owner:t.owner, dead:!!t.dead}; }),
      teams: live.map(function(t){ return {rid:t.rid, name:t.name, owner:t.owner, surv:t.surv,
        mean:t.mean, sd:t.sd, low:t.low, last:t.last}; })""",
    "stash: names on the live path")

# ------------------------------------------------------- 8. The House wheel --
OLD_EMPTY = 'function emptyWheel(){if(!ctx)return;ctx.clearRect(0,0,760,760);ctx.beginPath();ctx.arc(380,380,340,0,Math.PI*2);ctx.fillStyle="#24201a";ctx.fill();ctx.strokeStyle="#665341";ctx.lineWidth=6;ctx.stroke();ctx.fillStyle="#c8bdb1";ctx.font="700 28px system-ui";ctx.textAlign="center";ctx.fillText("CONNECT A LEAGUE",380,388);}'
NEW_WHEEL = '''/* ---------------------- The House wheel -------------------------------
     A real prize wheel: brushed brass rim, radially-shaded slices, a machined
     hub, and labels that run hub-to-rim.
     ⚠️ Labels are RADIAL on purpose. Tangential text is what made the old wheel
     unreadable — at 18 teams a slice is 20 degrees and every name collided with
     its neighbours. Radial text has the whole radius to live in, and its size
     tracks slice width so a thin slice gets small type, never overlapping type. */
  var PAL=[["#FF8A3D","#B04409"],["#E9B84A","#8E6C24"],["#3FA37D","#14543C"],["#D6503F","#7C211B"],
           ["#5B90BE","#254A66"],["#B0762F","#65420F"],["#48B49A","#1B5F50"],["#9A63AE","#4E2B5C"]];
  var RIM=34, ROUT=380-RIM, HUB=78;
  function rim(){
    var g=ctx.createLinearGradient(40,40,720,720);
    g.addColorStop(0,"#F7D68C");g.addColorStop(.34,"#A97F27");g.addColorStop(.58,"#F4C765");g.addColorStop(1,"#6E521A");
    ctx.beginPath();ctx.arc(380,380,380-RIM/2,0,Math.PI*2);ctx.strokeStyle=g;ctx.lineWidth=RIM;ctx.stroke();
    ctx.beginPath();ctx.arc(380,380,ROUT,0,Math.PI*2);ctx.strokeStyle="rgba(0,0,0,.45)";ctx.lineWidth=3;ctx.stroke();
  }
  function hub(){
    var g=ctx.createRadialGradient(360,358,6,380,380,HUB);
    g.addColorStop(0,"#3A2F1E");g.addColorStop(1,"#0C0A07");
    ctx.beginPath();ctx.arc(380,380,HUB,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
    ctx.strokeStyle="#E0A93B";ctx.lineWidth=6;ctx.stroke();
    ctx.beginPath();ctx.arc(380,380,16,0,Math.PI*2);ctx.fillStyle="#E0A93B";ctx.fill();
  }
  function emptyWheel(){
    if(!ctx)return;ctx.clearRect(0,0,760,760);
    ctx.beginPath();ctx.arc(380,380,ROUT,0,Math.PI*2);
    ctx.fillStyle="#171208";ctx.fill();
    for(var i=0;i<18;i++){
      ctx.beginPath();ctx.moveTo(380,380);
      ctx.arc(380,380,ROUT,i*Math.PI/9,(i+1)*Math.PI/9);ctx.closePath();
      ctx.fillStyle=i%2?"#1D1710":"#241D14";ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,.5)";ctx.lineWidth=2;ctx.stroke();
    }
    rim();hub();
    ctx.fillStyle="#9C8E80";ctx.textAlign="center";ctx.font="800 26px ui-sans-serif,system-ui,sans-serif";
    ctx.fillText("CONNECT A LEAGUE",380,ROUT-46);
  }'''
sub(OLD_EMPTY, NEW_WHEEL, "wheel: brass rim + hub + empty state")

OLD_DRAW = 'function draw(){if(!ctx||!teams.length){emptyWheel();return;}buildArcs();ctx.clearRect(0,0,760,760);arcs.forEach(function(a,i){ctx.beginPath();ctx.moveTo(380,380);ctx.arc(380,380,340,a.start,a.end);ctx.closePath();ctx.fillStyle=colors[i%colors.length];ctx.fill();ctx.strokeStyle="#17130f";ctx.lineWidth=5;ctx.stroke();var mid=(a.start+a.end)/2,r=a.end-a.start<.28?285:250;ctx.save();ctx.translate(380+Math.cos(mid)*r,380+Math.sin(mid)*r);ctx.rotate(mid+Math.PI/2);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="800 "+(a.end-a.start<.22?16:21)+"px system-ui";var n=a.team.name.length>18?a.team.name.slice(0,17)+"…":a.team.name;ctx.fillText(n,0,0);ctx.restore();});ctx.beginPath();ctx.arc(380,380,76,0,Math.PI*2);ctx.fillStyle="#17130f";ctx.fill();ctx.strokeStyle="#ff6a00";ctx.lineWidth=6;ctx.stroke();ctx.fillStyle="#fff";ctx.font="900 23px system-ui";ctx.textAlign="center";ctx.fillText("CHOP",380,388);}'
NEW_DRAW = '''function draw(){
    if(!ctx||!teams.length){emptyWheel();return;}
    buildArcs();ctx.clearRect(0,0,760,760);
    arcs.forEach(function(a,i){
      var pair=PAL[i%PAL.length],span=a.end-a.start,mid=(a.start+a.end)/2;
      var g=ctx.createRadialGradient(380,380,HUB,380,380,ROUT);
      g.addColorStop(0,pair[0]);g.addColorStop(1,pair[1]);
      ctx.beginPath();ctx.moveTo(380,380);ctx.arc(380,380,ROUT,a.start,a.end);ctx.closePath();
      ctx.fillStyle=g;ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,.55)";ctx.lineWidth=3;ctx.stroke();
      if(span>0.085){
        var size=Math.max(13,Math.min(30,Math.round(span*72)));
        var flip=Math.cos(mid)<0;
        ctx.save();ctx.translate(380,380);ctx.rotate(flip?mid+Math.PI:mid);
        ctx.fillStyle="#fff";ctx.textBaseline="middle";ctx.textAlign=flip?"left":"right";
        ctx.font="800 "+size+"px ui-sans-serif,system-ui,sans-serif";
        ctx.shadowColor="rgba(0,0,0,.7)";ctx.shadowBlur=5;
        var n=a.team.name,room=Math.floor((ROUT-HUB-26)/(size*0.55));
        if(n.length>room)n=n.slice(0,Math.max(3,room-1))+"…";
        ctx.fillText(n,flip?-(ROUT-18):(ROUT-18),0);
        ctx.restore();
      }
    });
    rim();hub();
  }'''
sub(OLD_DRAW, NEW_DRAW, "wheel: shaded slices + radial labels")

# spin: longer, heavier ease, and a landing flash
sub('canvas.style.transition="transform "+(n===1?"1.7s":"2.2s")+" cubic-bezier(.12,.72,.18,1)";canvas.style.transform="rotate("+rotation+"rad)";beep();',
    'canvas.style.transition="transform "+(n===1?"4.2s":"5s")+" cubic-bezier(.08,.62,.12,1)";canvas.style.transform="rotate("+rotation+"rad)";beep();'
    'canvas.classList.remove("pt-land");setTimeout(function(){canvas.classList.add("pt-land");},(n===1?4150:4950));',
    "wheel: heavier spin + landing flash")

# ------------------------------------------------------------ 9. the ladder --
sub("  function paint(G){if(!G||!G.teams||!G.teams.length)return;",
    '''  /* -------------------------- the hero ladder ---------------------------
     Every team is a bar; height is modeled chop risk. This is the one hero that
     survives its own empty state: with no scores the bars sit flat and hatched,
     which reads "nothing has happened yet" rather than "this is broken" — the
     failure the dead wheel used to put at the top of the page. */
  function ladder(G){
    var box=document.getElementById("gxLadder");if(!box)return;
    var stats=document.getElementById("gxHeroStats"),cut=document.getElementById("gxCutLab"),
        flat=document.getElementById("gxFlat"),tag=document.getElementById("gxHeroTag");
    if(!G){box.innerHTML="";if(stats)stats.innerHTML="";return;}
    var live=G.teams&&G.teams.length,rows=live?G.teams.slice():(G.all||[]),
        chopped=G.chopped||0,alive=(G.teamCount||rows.length)-chopped;
    if(!rows.length){box.innerHTML="";if(stats)stats.innerHTML="";return;}
    var mine=G.me&&G.me.rid;
    if(live){
      var max=Math.max.apply(null,rows.map(function(t){return 1-t.surv;}))||1;
      box.innerHTML=rows.map(function(t){
        var risk=1-t.surv,h=Math.round(26+(risk/max)*104),pct=Math.round(risk*100);
        var col=risk>=max*0.72?"linear-gradient(180deg,#FF5656,#8E1F1F)"
               :risk>=max*0.38?"linear-gradient(180deg,#E9A13D,#8A5510)"
               :"linear-gradient(180deg,#3FA37D,#17553F)";
        return '<button type="button" class="pt-lane'+(t.rid===mine?" me":"")+'" data-rid="'+t.rid+'" '
          +'title="'+esc(t.name)+' — '+pct+'% modeled chop risk">'
          +'<span class="pt-val">'+pct+'%</span>'
          +'<span class="pt-col" style="height:'+h+'px;background:'+col+'"></span>'
          +'<span class="pt-nm">'+esc(t.name)+'</span></button>';
      }).join("");
      if(cut)cut.textContent="Projected cut · median simulated low";
      if(tag)tag.textContent="Every bar is a team. The taller the bar, the likelier the chop.";
      if(flat)flat.innerHTML="Modeled from "+G.done+" completed week"+(G.done===1?"":"s")
        +" — a simulation, not live scores. Tap a bar to make that team your focus.";
    }else{
      var ghost="repeating-linear-gradient(135deg,#3A2E24 0 7px,#2A211A 7px 14px)",
          mineg="repeating-linear-gradient(135deg,#FF8A3D 0 7px,#C4600F 7px 14px)";
      box.innerHTML=rows.map(function(t){
        return '<button type="button" class="pt-lane'+(t.rid===mine?" me":"")+'" data-rid="'+t.rid+'" '
          +'title="'+esc(t.name)+'"><span class="pt-val">&mdash;</span>'
          +'<span class="pt-col" style="height:96px;background:'+(t.rid===mine?mineg:ghost)+'"></span>'
          +'<span class="pt-nm">'+esc(t.name)+'</span></button>';
      }).join("");
      if(cut)cut.textContent="Cut line · drawn once scores exist";
      if(tag)tag.textContent="Every bar is a team. They separate the moment scores exist.";
      if(flat)flat.textContent=G.done>0
        ? "Only "+G.done+" completed week — survival needs two before the bars mean anything."
        : "No games played yet — every dawg is level.";
    }
    if(stats)stats.innerHTML=
      '<div class="pt-stat"><div class="v">'+alive+'</div><div class="l">Alive</div></div>'
      +'<div class="pt-stat"><div class="v">'+chopped+'</div><div class="l">Chopped</div></div>'
      +'<div class="pt-stat"><div class="v'+(live?" acc":"")+'">'+(live?Math.round(G.chop*10)/10:"&mdash;")
      +'</div><div class="l">Cut line</div></div>';
    Array.prototype.forEach.call(box.querySelectorAll(".pt-lane"),function(b){
      b.onclick=function(){focus(Number(b.getAttribute("data-rid")));};});
  }
  function paint(G){ladder(G);if(!G||!G.teams||!G.teams.length)return;''',
    "ladder: render + wire focus")

P.write_text(s, encoding="utf-8")
print("\nguillotine.html patched.")
