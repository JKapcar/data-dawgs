"""
The weekly prediction becomes a VOTE that is actually graded.

The panel read as a dev widget -- "Weekly chopped-team prediction", a bare select, "Save
device receipt" -- and the owner of the site could not tell what it was for. Two problems,
and only one of them is copy.

⚠️ IT WAS NOT GRADED, and the honesty card said so in as many words. Writing "graded" on
the panel would have made the page lie about itself. So this BUILDS the grading rather
than relabelling: in this format the team chopped in week W is the lowest scorer among the
teams still alive that week, and the page already scans every week's matchups to build
team score histories. Retaining those scores PER WEEK makes the actual result derivable
for every completed week, at which point a stored vote can be marked right or wrong.

Storage moves from one row to a per-week map. The old shape held a single prediction that
each new week overwrote, so there was nothing to grade against even in principle; the old
value is migrated rather than dropped.

Still device-local. Grading it locally does not make it server-persisted, immutable or
cross-device, and the honesty card is amended to say exactly that rather than quietly
dropping the caveat.

The panel also leaves the wheel's side column -- on a phone that column stacks below the
wheel, the controls and the tally, which is how it ended up buried. It is its own card
directly under the wheel now, with the question as the heading.

    cd work && py patch-lds-vote-graded.py
"""
import pathlib
import re

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "guillotine.html"
s = PAGE.read_text(encoding="utf-8")

# ---- 1. keep per-week scores so the real result is derivable ---------------
old = """        (ms||[]).forEach(function(m){
          var t=byRid[m.roster_id];
          if(t && typeof m.points === "number" && m.points > 0) t.scores.push(m.points);"""
new = """        (ms||[]).forEach(function(m){
          var t=byRid[m.roster_id];
          /* ⚠ Per WEEK, not just appended to a flat list. Without the week attached there
             is no way to say who was chopped when, and therefore no way to grade a vote. */
          if(t && typeof m.points === "number" && m.points > 0){
            t.scores.push(m.points);
            (wkPts[w]=wkPts[w]||{})[t.rid]=m.points;
          }"""
assert s.count(old) == 1, "score loop"
s = s.replace(old, new, 1)

old = '    var pScores = {};   // player id -> [that player\'s weekly points, in THIS league\'s scoring]'
new = (old + NL +
       '    var wkPts = {};     // week -> {rosterId: points} — the basis for grading a vote')
assert s.count(old) == 1, "pScores decl"
s = s.replace(old, new, 1)

# ---- 2. derive the actual chop per completed week --------------------------
old = "    var live = alive.filter(function(t){ return t.n >= 2 && t.sd > 0; });"
new = (r'''    /* The guillotine rule IS the derivation: whoever scores lowest among the teams still
       alive that week is the one who goes. A chopped roster stops scoring afterwards, so
       "present in week w" is exactly "alive in week w". */
    var gone={}, chopHistory=[];
    Object.keys(wkPts).map(Number).sort(function(a,b){return a-b;}).forEach(function(w){
      var m=wkPts[w], lo=Infinity, rid=null;
      /* ⚠ Skip anyone already chopped. Without this a team that posted the lowest score in
         week 1 is named again in week 2 -- Sleeper keeps reporting a roster for a week or
         two after it is emptied, so "lowest present" alone re-chops the same team. */
      for(var k in m){ if(!gone[k] && m[k]<lo){ lo=m[k]; rid=k; } }
      if(rid==null) return;
      gone[rid]=1;
      var t=byRid[rid];
      chopHistory.push({week:w, rid:String(rid), name:(t&&t.name)||("Roster "+rid), pts:lo});
    });

''' + old)
assert s.count(old) == 1, "live filter"
s = s.replace(old, new, 1)

old = "      done: done, mode: MODE, ws: WS, plan: WP, chop: res.chop,"
new = "      done: done, mode: MODE, ws: WS, plan: WP, chopHistory: chopHistory, chop: res.chop,"
assert s.count(old) == 1, "stash"
s = s.replace(old, new, 1)

# ---- 3. the panel: out of the wheel column, into its own card --------------
m = re.search(r'\n        <div class="pt-wheelside">\n(.*?)\n        </div>\n', s, re.S)
assert m, "wheelside block"
s = s.replace(m.group(0), NL, 1)

old = '    <div class="hero-card"><h2>Am I Safe?'
card = r'''    <div class="hero-card" id="gxVoteCard">
      <h2>Your vote: who gets chopped this week? <span class="samp">Graded against the result</span></h2>
      <p class="legend" style="margin:0 0 12px">Pick the team you think goes this week and lock it in. Once the
        week is scored the page marks it right or wrong on its own and keeps your running record. Saved on this
        device only &mdash; nobody else in the league sees it, and it does not follow you to another phone.</p>
      <div class="gx-predict" id="gxPredict" hidden style="margin-top:0">
        <div class="controls">
          <select id="gxPredTeam" aria-label="Team you think gets chopped this week"></select>
          <button class="btn pt-spin" id="gxPredSave" type="button">Lock in my vote</button>
        </div>
        <p class="legend" id="gxDeadline" style="margin-top:8px">Deadline: Sunday at 1:00 PM Eastern.</p>
        <div class="gx-receipt" id="gxReceipt"></div>
      </div>
      <div id="gxVoteRecord"></div>
    </div>

'''
assert s.count(old) == 1, "am i safe card"
s = s.replace(old, card + old, 1)

# ---- 4. per-week storage, grading, and the record --------------------------
old = 'function receipt(){var r=read(PRED,null),'
i = s.index(old)
j = s.index(NL, s.index('document.getElementById("gxPredSave").onclick=', i))
block = r'''function predKey(){ return window.__GX ? String(window.__GX.leagueId)+":"+(Number(window.__GX.done||0)+1) : null; }
  /* ⚠ The old shape was ONE prediction that every new week overwrote, so there was never
     anything to grade against. It is a map keyed by league:week now, and the single old
     value is migrated rather than thrown away. */
  function predAll(){
    var m=read(PRED,null);
    if(!m) return {};
    if(m.leagueId && m.week!=null && !m.byWeek){
      var out={}; out[String(m.leagueId)+":"+m.week]={team:m.team,rosterId:m.rosterId,savedAt:m.savedAt,storage:"local-device"};
      write(PRED,{byWeek:out}); return out;
    }
    return m.byWeek||{};
  }
  function receipt(){
    var all=predAll(), k=predKey(), r=k?all[k]:null,
        box=document.getElementById("gxReceipt"), save=document.getElementById("gxPredSave");
    if(save) save.disabled=locked();
    if(!box) return;
    box.textContent = r
      ? "YOUR VOTE · week "+(k.split(":")[1])+" · "+r.team+" · locked "+new Date(r.savedAt).toLocaleString()+" · this device only"
      : "No vote locked in for this week on this device.";
    voteRecord();
  }
  /* Grades every stored vote whose week has actually been played. */
  function voteRecord(){
    var el=document.getElementById("gxVoteRecord"); if(!el) return;
    var G=window.__GX, all=predAll();
    if(!G || !G.chopHistory || !G.chopHistory.length){
      el.innerHTML='<p class="legend">Nothing graded yet &mdash; a vote is marked once its week has been scored.</p>';
      return;
    }
    var rows=[], right=0;
    G.chopHistory.forEach(function(c){
      var r=all[String(G.leagueId)+":"+c.week];
      if(!r) return;
      var ok=String(r.rosterId)===String(c.rid);
      if(ok) right++;
      rows.push('<tr><td>Week '+c.week+'</td><td>'+esc(r.team)+'</td><td>'+esc(c.name)+'</td>'
        +'<td style="color:var(--'+(ok?'good':'bad')+');font-weight:800">'+(ok?'Right':'Wrong')+'</td></tr>');
    });
    if(!rows.length){
      el.innerHTML='<p class="legend">No graded weeks yet &mdash; votes are graded once their week has been scored.</p>';
      return;
    }
    el.innerHTML='<p class="legend" style="margin:14px 0 6px"><b>Your record: '+right+' of '+rows.length
      +'</b> &mdash; graded on this device against who actually had the lowest score that week.</p>'
      +'<div class="tscroll"><table class="dtab"><thead><tr><th>Week</th><th>You said</th><th>Actually chopped</th><th></th></tr></thead>'
      +'<tbody>'+rows.join("")+'</tbody></table></div>';
  }
  document.getElementById("gxPredSave").onclick=function(){
    if(locked())return;
    var sel=document.getElementById("gxPredTeam"),t=teams.find(function(x){return String(x.rid)===sel.value;});
    if(!t||!window.__GX)return;
    var all=predAll(); all[predKey()]={team:t.name,rosterId:t.rid,savedAt:Date.now(),storage:"local-device"};
    write(PRED,{byWeek:all}); receipt();
  };'''
s = s[:i] + block + s[j:]

# ---- 5. the honesty card tells the truth about what changed ---------------
old = ("Prediction receipts are local-device only and are not immutable, server-persisted, "
       "cross-device or graded.")
new = ("Your weekly vote is graded on this device: once a week has been scored the page compares "
       "your pick against whoever actually posted the lowest score that week and keeps a running "
       "record. It is still LOCAL to the device &mdash; not immutable, not server-persisted, not "
       "cross-device, and not scored with Brier history &mdash; so clearing site data clears the record.")
assert s.count(old) == 1, "honesty card"
s = s.replace(old, new, 1)

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-vote-graded: ok")
