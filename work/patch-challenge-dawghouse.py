"""Phase 1: replace Challenge's slider cards with the Dawg House Drive.

Deliberately anchor-based and idempotent: it only owns the Challenge board and never
duplicates forecast/model values.  Run from the repository root.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "challenge.html"

CSS = r'''
/* === The Dawg House · The Drive (Phase 1) ================================ */
.drive-card{padding:0;overflow:hidden;border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}.drive-head{padding:14px 16px 0}.drive-field{height:235px;position:relative;overflow:hidden;touch-action:none;cursor:ew-resize;background:repeating-linear-gradient(90deg,transparent 0 7.9%,rgba(255,255,255,.12) 8% 8.25%),linear-gradient(#28653b,#1b4d2e)}.drive-field:before,.drive-field:after{content:"";position:absolute;top:0;bottom:0;width:10%;background:repeating-linear-gradient(45deg,rgba(0,20,50,.75) 0 4px,rgba(0,20,50,.5) 4px 8px)}.drive-field:after{right:0;background:repeating-linear-gradient(45deg,rgba(0,88,65,.78) 0 4px,rgba(0,88,65,.48) 4px 8px)}.drive-yard{position:absolute;top:0;bottom:0;border-left:1px solid rgba(255,255,255,.32);font:800 11px ui-monospace,monospace;color:rgba(255,255,255,.62);padding:4px}.drive-yard b{position:absolute;bottom:4px;left:-7px}.drive-chain{position:absolute;top:0;bottom:0;background:rgba(255,176,32,.17);border-left:3px solid #ffb020;border-right:3px solid #ffb020;pointer-events:none}.drive-chain:before{content:"";position:absolute;top:29px;left:0;right:0;border-top:6px dotted #ffd48b}.drive-chain span{position:absolute;top:3px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#ffb020;color:#261400;padding:1px 6px;border-radius:3px;font:800 9px ui-monospace,monospace}.drive-cluster{position:absolute;top:72px;width:150px;height:98px;transform:translateX(-50%);pointer-events:none}.drive-helmet{position:absolute;width:76px;height:68px;object-fit:contain;top:8px}.drive-away{left:0}.drive-home{right:0}.drive-ball{position:absolute;left:62px;top:31px;width:28px;height:38px;border-radius:50%;background:#7c3e18;border:2px solid #f1b17b;transform:rotate(22deg)}.drive-ball:after{content:"";position:absolute;left:5px;right:5px;top:16px;border-top:2px solid #f7d3ad}.drive-value{position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);padding:2px 8px;border-radius:999px;background:#161009;color:#fff;font:800 13px ui-monospace,monospace}.drive-bottom{padding:12px 16px 16px}.drive-coach{margin:0 0 10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;text-align:center;font-size:13px}.drive-cards{display:flex;gap:7px;overflow:auto;margin:10px 0}.drive-model{min-width:118px;padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--surface-1);cursor:pointer}.drive-model b{display:block;color:var(--accent);font-size:17px}.drive-model[hidden]{display:none}.drive-note{min-height:1.4em}.drive-touchdown{outline:4px solid color-mix(in srgb,#ffb020 70%,transparent);animation:dddriveflash .4s 2}@keyframes dddriveflash{50%{transform:translateX(3px)}}@media(prefers-reduced-motion:reduce){.drive-touchdown{animation:none}}
'''

MARKUP = '''  <div class="card drive-card" id="cwDriveBoard">
    <div class="drive-head"><h3>The Drive <span class="rt" id="cwWeekTag"></span></h3>
    <p class="sub">Drag the football between the goal lines to set <b>P(home)</b>. Untouched is an absence, not 50.</p>
    <div class="btnrow" style="margin-bottom:12px"><label class="fld" style="max-width:220px"><span>Week</span><select class="fi" id="cwWeek"></select></label></div>
    <p class="note" id="cwAuth"></p><p class="note" id="cwMsg"></p></div><div id="cwGames"></div>
  </div>'''

START = '  function drawBoard() {'
END = '  function submit(g, value, side, touched, st, card, slider, flip, save) {'

DRAW = r'''  function independentLines(g) {
    /* ddpr-linear is correlated with ddpr and is deliberately excluded. */
    var ids = {"nfelo":true,"ddpr-nfl":true,"538-classic":true};
    return (modelsByGame[g.game_id] || []).filter(function(m){ return ids[m.model_id]; });
  }
  function driveCoach(p, touched, lo, hi) {
    if (!touched) return "Chains are out at <b>"+lo+"–"+hi+"</b>. Where do you stand?";
    var inside=p>=lo&&p<=hi ? " You’re <b>inside the chains</b>." : " You’re <b>outside the chains</b>.";
    if (p===0 || p===100) return "<b>"+(p===100?"TOUCHDOWN":"PICK SIX")+" — "+p+"%.</b> Wrong means the maximum Brier penalty.";
    if (p>=48&&p<=52) return "Midfield — a <b>coin flip</b>. Chains sit "+lo+"–"+hi+".";
    return "Your call: <b>"+p+"%</b>."+inside;
  }
  function drawBoard() {
    var host = $("cwGames"); host.replaceChildren(); var rows = byWeek[week] || [];
    if (!rows.length) { host.textContent = "No games in the canonical schedule for that week."; return; }
    var signedIn = !!(window.DDAuth && window.DDAuth.me());
    rows.forEach(function(g) {
      var locked=isLocked(g), val=valueOf[g.game_id]; if(val==null) val=50;
      var lines=independentLines(g), vals=lines.map(function(m){return Math.round(m.p*100);});
      var lo=vals.length?Math.min.apply(null,vals):50, hi=vals.length?Math.max.apply(null,vals):50;
      var card=document.createElement("section"); card.className="card drive-card"; if(locked) card.style.opacity=".62";
      card.innerHTML='<div class="drive-head"><h3>'+esc(g.away_team)+' @ '+esc(g.home_team)+' <span class="rt">'+(locked?"locked":until(g.kickoff_ms))+'</span></h3><p class="sub">'+new Date(g.kickoff_ms).toLocaleString()+'</p></div><div class="drive-field" role="slider" tabindex="0" aria-label="Home win probability for '+esc(g.home_team)+'" aria-valuemin="0" aria-valuemax="100"><div class="drive-chain"><span>CHAINS '+lo+'–'+hi+' · SPREAD '+(hi-lo)+'</span></div><div class="drive-cluster"><img class="drive-helmet drive-away" alt="'+esc(g.away_team)+' helmet" src="assets/helmets/'+esc(g.away_team)+'_right.png"><i class="drive-ball"></i><img class="drive-helmet drive-home" alt="'+esc(g.home_team)+' helmet" src="assets/helmets/'+esc(g.home_team)+'_left.png"><output class="drive-value"></output></div></div><div class="drive-bottom"><p class="drive-coach"></p><button type="button" class="btn sm drive-ask">Ask Madden</button><div class="drive-cards"></div><p class="note drive-corr" hidden>⚠ ddpr-linear rides the bench: it is correlated with ddpr. Chains show independent disagreement only.</p><div class="btnrow"><button type="button" class="btn sm drive-lock">Lock it in</button></div><p class="note drive-note"></p></div>';
      var field=card.querySelector(".drive-field"), chain=card.querySelector(".drive-chain"), cluster=card.querySelector(".drive-cluster"), out=card.querySelector("output"), coach=card.querySelector(".drive-coach"), ask=card.querySelector(".drive-ask"), cards=card.querySelector(".drive-cards"), corr=card.querySelector(".drive-corr"), lock=card.querySelector(".drive-lock"), note=card.querySelector(".drive-note"), p=val, naive=null;
      chain.style.left=(10+lo*.8)+"%"; chain.style.width=Math.max(1,(hi-lo)*.8)+"%";
      function paint(){ cluster.style.left=(10+p*.8)+"%"; out.value=out.textContent=Math.round(p)+"%"; field.setAttribute("aria-valuenow",Math.round(p)); coach.innerHTML=driveCoach(Math.round(p),touchedGames.has(g.game_id),lo,hi); card.classList.toggle("drive-touchdown",p===0||p===100); }
      function set(ev){ var r=field.getBoundingClientRect(); p=Math.max(0,Math.min(100,Math.round((ev.clientX-r.left-r.width*.1)/(r.width*.8)*100))); valueOf[g.game_id]=p; touchedGames.add(g.game_id); paint(); }
      if(!locked&&signedIn){ field.addEventListener("pointerdown",function(e){try{field.setPointerCapture(e.pointerId)}catch(ignore){}set(e)}); field.addEventListener("pointermove",function(e){if(e.buttons)set(e)}); field.addEventListener("keydown",function(e){if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();p=Math.max(0,Math.min(100,p+(e.key==="ArrowLeft"?-1:1)));valueOf[g.game_id]=p;touchedGames.add(g.game_id);paint();}); }
      ask.addEventListener("click",function(){ if(ask.disabled)return; naive=touchedGames.has(g.game_id)?p:null; ask.hidden=true; lines.forEach(function(m){var b=document.createElement("button");b.type="button";b.className="drive-model";b.textContent=m.model_id+" · tap";b.addEventListener("click",function(){b.innerHTML="<small>"+esc(m.model_id)+"</small><b>"+pct(m.p)+"</b>"});cards.appendChild(b)});corr.hidden=false; });
      lock.addEventListener("click",function(){ if(!touchedGames.has(g.game_id)){note.className="note warn drive-note";note.textContent="UNTOUCHED ≠ 50 — set the ball first.";return;} note.textContent="Saving…"; submit(g,p,"home",true,note,card,field,null,lock,{p_naive:naive,entry_method:"drive",hints_revealed:!ask.hidden}); });
      if(!signedIn) note.innerHTML='Sign in to lock a forecast.'; if(locked){ask.disabled=true;lock.disabled=true;} paint(); host.appendChild(card);
    });
  }

'''

def main():
    s = PAGE.read_text(encoding="utf-8")
    if "The Dawg House · The Drive (Phase 1)" in s:
        raise SystemExit("already patched")
    if s.count("</style>") < 1 or s.count(START) != 1 or s.count(END) != 1:
        raise SystemExit("unexpected anchors; no write")
    s = s.replace("</style>", CSS + "</style>", 1)
    old_board = '''  <div class="card">\n    <h3>This week <span class="rt" id="cwWeekTag"></span></h3>'''
    a=s.index(old_board); b=s.index("  </div>\n  </div>\n\n  <!-- ===================== LEADERBOARD",a)+len("  </div>\n  </div>")
    s=s[:a]+MARKUP+s[b:]
    a=s.index(START); b=s.index(END); s=s[:a]+DRAW+s[b:]
    # Optional fields are intentionally client-only until Phase 2 makes the Worker schema additive.
    needle='''      touched: !!touched\n      /* home_win_probability is deliberately absent — sending it is a 400. */'''
    if needle not in s: raise SystemExit("submit anchor missing; no write")
    s=s.replace(needle, '''      touched: !!touched\n      /* home_win_probability is deliberately absent — sending it is a 400. */''', 1)
    PAGE.write_text(s,encoding="utf-8")
    print("patched challenge.html")
if __name__ == "__main__": main()
