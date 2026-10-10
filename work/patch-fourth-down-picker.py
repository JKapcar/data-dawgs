"""
Fourth Down Lab: open on a real fourth down. Anchor-based and idempotent.

    cd work && python3 patch-fourth-down-picker.py && python3 stamp-sw-version.py

The hand-picked preset cards (CLE vs CAR and friends) give way to a game and play
picker fed by data/fourth-down.json and data/fourth-down-previous.json. The weekly
board at the bottom is folded into it (same rows, same decision cost). The form
stays, as the "Edit the situation" tab. Touches fourth-down.html, fourth-down-page.js,
fourth-down.css, the css link pinned in build_explore.py, the sitemap date and the
Fourth Down sentence in Toto's pasted MAP on every page that carries it.
"""
import glob
import hashlib
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent
MARK = 'id="fd-plays"'


def edit(path, pairs, marker):
    p = REPO / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        print(f"  {path}: already patched")
        return
    for old, new in pairs:
        if callable(old):
            s = old(s)
            continue
        assert s.count(old) == 1, f"{path}: anchor appears {s.count(old)} times: {old[:80]!r}"
        s = s.replace(old, new)
    assert marker in s, f"{path}: marker missing after patch"
    p.write_text(s, encoding="utf-8")
    print(f"  {path}: patched")


def cut_between(start, end_after):
    """Remove from `start` through the first `end_after` that follows it."""
    def run(s):
        assert s.count(start) == 1, f"block start appears {s.count(start)} times: {start[:60]!r}"
        i = s.index(start)
        j = s.index(end_after, i) + len(end_after)
        return s[:i] + s[j:]
    return run


STEP1 = """<section class="fd-pick" id="weekly" aria-labelledby="fd-pick-title">
    <div class="fd-pick-head"><h2 id="fd-pick-title"><span class="fd-step" aria-hidden="true">1</span>Pick a game</h2><div class="fd-weeks" id="fd-weeks" role="group" aria-label="Week" hidden></div></div>
    <div class="fd-games" id="fd-games" role="group" aria-label="Games"></div>
    <p class="fd-feed-status" id="fd-feed-status" role="status">Loading this week’s games…</p>
  </section>"""

LEFT = """<section class="fd-panel fd-left" aria-label="Pick a fourth down">
      <div class="fd-tabs" role="tablist" aria-label="Choose a play or edit the situation"><button type="button" role="tab" id="fd-tab-plays" aria-selected="true" aria-controls="fd-pane-plays"><span class="fd-step" aria-hidden="true">2</span>Pick a play</button><button type="button" role="tab" id="fd-tab-edit" aria-selected="false" aria-controls="fd-form">Edit the situation</button></div>
      <div id="fd-pane-plays" role="tabpanel" aria-labelledby="fd-tab-plays">
        <div class="fd-plays-head"><b id="fd-plays-title"></b><div class="fd-plays-sort" id="fd-plays-sort" role="group" aria-label="Order" hidden><button type="button" data-sort="game" aria-pressed="true">Game order</button><button type="button" data-sort="miss" aria-pressed="false">Coach vs model</button></div></div>
        <div class="fd-plays" id="fd-plays"><p class="fd-plays-empty">Loading fourth downs…</p></div>
        <p class="fd-plays-note">Every card is judged before the snap. ✓ means the coach made the model’s call; pp is the win probability the coach’s choice gave up.</p>
      </div>
    <form id="fd-form" class="fd-edit" role="tabpanel" aria-labelledby="fd-tab-edit" hidden><p class="fd-edit-intro">Change anything and recalculate: distance, field position, clock, score. It starts from the play you picked. Or start from one of these:</p><div class="fd-starts"><button type="button" data-preset="goal">Goal-line gamble</button><button type="button" data-preset="midfield">4th &amp; short at midfield</button><button type="button" data-preset="longkick">Long field goal</button></div>"""

NAV = """<div class="fd-play-nav" id="fd-play-nav" hidden><button type="button" id="fd-prev" aria-label="Previous fourth down">‹</button><span id="fd-play-pos" aria-live="off"></span><button type="button" id="fd-next" aria-label="Next fourth down">›</button></div>"""

edit("fourth-down.html", [
    (cut_between('<div class="fd-shortcuts"', "</div>\n"), None),
    ('  <div class="fd-layout">\n', "  " + STEP1 + "\n  <div class=\"fd-layout\">\n"),
    ('<form class="fd-panel" id="fd-form"><h2>Set the situation</h2>', LEFT),
    ('<p class="fd-status" id="fd-status" role="status">Loading trained models, about 5 MB once.</p></form>',
     '</form><p class="fd-status" id="fd-status" role="status">Loading trained models, about 5 MB once.</p></section>'),
    ('id="fd-result"><div class="fd-verdict">', 'id="fd-result">' + NAV + '<div class="fd-verdict">'),
    ('<div class="fd-situation" id="fd-situation"></div>', '<div class="fd-actual" id="fd-actual" hidden></div><div class="fd-situation" id="fd-situation"></div>'),
    (cut_between('<section class="fd-board" id="weekly">', "</section>\n"), None),
    ("<p>One decision. Three ways to play it. Compare your chances of winning before judging what happened next.</p>",
     "<p>One decision. Three ways to play it. Pick any fourth down from this week’s NFL games and see which choice gave the best chance to win, judged before the snap.</p>"),
    ('<p>Weekly plays come from ESPN, with pregame lines from nflverse.',
     '<p>The page opens on a real fourth down: the latest play of a live game, otherwise the week’s biggest coach-versus-model disagreement. The previous captured week stays available, frozen, in <a href="data/fourth-down-previous.json">its own file</a>. Weekly plays come from ESPN, with pregame lines from nflverse.'),
    ('content="Go, kick, or punt? Compare NFL fourth-down win probabilities with the open nfl4th model, explore conversion thresholds, re-score the call under other goals, and review weekly coaching decisions.">',
     'content="Go, kick, or punt? Pick any fourth down from this week’s NFL games and see which choice gave the best chance to win, with the open nfl4th model. Then stress-test it, re-score it under other goals, or build your own situation.">'),
    ('<script src="fourth-down-page.js?v=', '<script src="fourth-down-picker.js?v=0"></script>\n<script src="fourth-down-page.js?v='),
], MARK)

# Sanity: the old board and preset cards are gone; the form survives with every field.
html = (REPO / "fourth-down.html").read_text(encoding="utf-8")
for gone in ['fd-shortcuts', 'fd-decisions', 'fd-game-filter', 'data-preset="browns"']:
    assert gone not in html, gone
for kept in ['id="fd-homeTeam"', 'id="fd-yardline"', 'id="fd-touchback"', 'id="fd-calculate"', 'id="fd-reset"', 'id="fd-goal"', 'id="weekly"']:
    assert html.count(kept) == 1, kept

PAGE_NEW = r"""  // ---- Game and play picker: the page opens on a real fourth down ----
  const picker=DDFourthPicker.create({onPick:choose});
  function openTab(t){const edit=t==='edit';$('fd-tab-plays').setAttribute('aria-selected',!edit);$('fd-tab-edit').setAttribute('aria-selected',edit);$('fd-pane-plays').hidden=edit;form.hidden=!edit;}
  $('fd-tab-plays').addEventListener('click',()=>openTab('plays'));$('fd-tab-edit').addEventListener('click',()=>openTab('edit'));
  function choose(info,source){
    const g=info.game,d=info.decision;
    sourceLabel=`${g.away} @ ${g.home} · week ${info.weekNumber} · captured ${new Date(info.captured).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
    setForm({...d.input,homeTeam:g.home,awayTeam:g.away});openTab('plays');calculate();
    if(source==='play'&&matchMedia('(max-width:850px)').matches)$('fd-result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }
  $('fd-prev').addEventListener('click',()=>picker.step(-1));$('fd-next').addEventListener('click',()=>picker.step(1));
  function playState(){const c=picker.current();if(!c)return null;const d=c.decision;return {game:c.matchup,season:c.season,week:c.weekNumber,date:c.game.date,frozenPreviousWeek:c.frozen,clock:`Q${d.input.qtr} ${d.clock}`,offense:d.offense,coachChose:d.actual||null,description:d.description,captured:c.captured,position:c.index>=0?`${c.index+1} of ${c.count}`:null};}
  function paintPlay(r){
    const c=picker.current(),nav=$('fd-play-nav'),act=$('fd-actual');
    if(!c){nav.hidden=true;act.hidden=true;return;}
    nav.hidden=false;
    $('fd-play-pos').innerHTML=`<b>${esc(c.matchup)}</b> · Week ${c.weekNumber}${c.index>=0?` · ${c.index+1} of ${c.count}`:''}`;
    $('fd-prev').disabled=c.index<=0;$('fd-next').disabled=c.index<0||c.index>=c.count-1;
    const d=c.decision,a=r.choices.find(x=>x.id===d.actual),label=DDFourth.labels[d.actual],best=Math.max(...r.choices.filter(x=>x.wp!==null).map(x=>x.wp));
    let line;
    if(!d.actual)line='The feed does not make the coach’s choice clear.';
    else if(a?.wp==null)line=`<b>The coach chose: ${esc(label)}.</b> That option is outside this model’s range here.`;
    else if(d.actual===r.best)line=`<b>The coach chose: ${esc(label)}.</b> Same as the call.`;
    else{const gap=100*(best-a.wp);line=`<b>The coach chose: ${esc(label)}.</b> That gave up ${gap.toFixed(1)} pp of win probability versus ${esc(DDFourth.labels[r.best].toLowerCase())}${gap<1?', a close call':''}.`;}
    act.hidden=false;act.innerHTML=`<p>${line}</p><p class="fd-actual-play"><span>What happened</span>${esc(d.description)}</p><small>Judged before the snap: how the play turned out does not change the call.</small>`;
  }
  async function getFeed(url,fresh){const r=await fetch(url,{cache:fresh?'no-store':'default'});if(!r.ok)throw Error('Feed request failed.');const env=await r.json();if(!env.source||!env.as_of||!Array.isArray(env.data?.games))throw Error('Feed is incomplete.');return env;}
  async function refresh(){
    const rid=++requestId;
    try{const env=await getFeed('data/fourth-down.json',true);if(rid!==requestId)return;weekly=env;picker.setFeed('current',env);}
    catch(e){if(!picker.hasFeed())$('fd-feed-status').textContent=`This week’s games could not load (${e.message}). Edit the situation by hand instead.`;}
  }
  async function loadPrevious(){try{picker.setFeed('previous',await getFeed('data/fourth-down-previous.json',false));}catch{/* optional: the live week still works */}}"""

INIT_OLD = """  DDFourth.load().then(e=>{engine=e;$('fd-calculate').disabled=false;$('fd-calculate').textContent='Calculate the call';calculate();}).catch(e=>{status(e.message+' Reload to retry.',true);$('fd-recommendation').textContent='Model unavailable.';$('fd-verdict-text').textContent='No probabilities have been calculated.';});
  refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);"""
INIT_NEW = """  // Choose what to show once the feeds are in (or after 8 s without them), then calculate once.
  const started=Promise.race([Promise.all([refresh(),loadPrevious()]),new Promise(r=>setTimeout(r,8000))]).then(()=>{
    if(query.has('play')&&picker.select(query.get('play'),{source:'link'}))return;
    if(sharedSituation){openTab('edit');return;}
    if(picker.selectDefault({source:'default'}))return;
    sourceLabel='Custom situation';openTab('edit');
  });
  Promise.all([DDFourth.load(),started]).then(([e])=>{engine=e;$('fd-calculate').disabled=false;$('fd-calculate').textContent='Calculate the call';calculate();}).catch(e=>{status(e.message+' Reload to retry.',true);$('fd-recommendation').textContent='Model unavailable.';$('fd-verdict-text').textContent='No probabilities have been calculated.';});
  setInterval(()=>{if(!document.hidden)refresh();},60000);"""

SYS_OLD = " GOAL LENS: current.goalLens"
SYS_NEW = (" PICKER: the page opens on a real fourth down from the delayed ESPN snapshot: the latest play of a live game, otherwise the week’s biggest coach-versus-model disagreement. current.play describes the selected play: game, week, ESPN description, coachChose = what the coach actually did, frozenPreviousWeek = from the previous captured week (/data/fourth-down-previous.json), which is not always the immediately preceding week, so quote its week number. If current.play is null the reader built or edited the situation by hand: never attribute it to a real game. Judge every decision before the snap; never grade it by how the play turned out."
           " GOAL LENS: current.goalLens")

edit("fourth-down-page.js", [
    ("let engine,result,displayResult,activeInput,weekly,requestId=0,sourceLabel='Browns vs Panthers · Sep 27, 2026';",
     "let engine,result,displayResult,activeInput,weekly,requestId=0,sourceLabel='Custom situation',sharedSituation=false;"),
    ("return `${off} vs ${def} · Q${s.qtr} ${Math.floor(s.seconds/60)}:${String(s.seconds%60).padStart(2,'0')} · 4th & ${s.toGo} · ${s.yardline>50?'own '+(100-s.yardline):def+' '+s.yardline} · ${s.diff>0?'leading by '+s.diff:s.diff<0?'trailing by '+(-s.diff):'tied'}`;}",
     "const y=Number(s.yardline),g=Number(s.toGo),d=Number(s.diff);return `${off} vs ${def} · Q${s.qtr} ${Math.floor(s.seconds/60)}:${String(s.seconds%60).padStart(2,'0')} · ${g>=y?'4th & goal':'4th & '+g} at ${y===50?'midfield':y>50?off+' '+(100-y):def+' '+y} · ${d>0?off+' up '+d:d<0?off+' down '+(-d):'tied'}`;}"),
    ("    $('fd-situation').textContent=situation(activeInput);\n", "    $('fd-situation').textContent=situation(activeInput);paintPlay(r);\n"),
    ("window.DDFourthState={input:activeInput,result:displayResult,baseline:result,scenario:explorer.getState(),goalLens:lens.getState(),source:sourceLabel};}",
     "window.DDFourthState={input:activeInput,play:playState(),result:displayResult,baseline:result,scenario:explorer.getState(),goalLens:lens.getState(),source:sourceLabel};}"),
    ("try{if(!form.reportValidity())return;render(engine.calculate(inputs()));}",
     "try{if(!form.checkValidity()){openTab('edit');form.reportValidity();return;}render(engine.calculate(inputs()));}"),
    ("$('fd-sensitivity').hidden=true;lens.hide();result=null;displayResult=null;window.DDFourthState=null;}",
     "$('fd-sensitivity').hidden=true;lens.hide();$('fd-play-nav').hidden=true;$('fd-actual').hidden=true;openTab('edit');result=null;displayResult=null;window.DDFourthState=null;}"),
    ("form.addEventListener('input',()=>{sourceLabel='Custom situation';",
     "form.addEventListener('input',()=>{sourceLabel='Custom situation';picker.markEdited();$('fd-play-nav').hidden=true;$('fd-actual').hidden=true;"),
    ("document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{sourceLabel=b.dataset.preset==='browns'?'Browns vs Panthers · Sep 27, 2026':'Hypothetical scenario';setForm(presets[b.dataset.preset]);calculate();}));",
     "document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{sourceLabel='Hypothetical scenario';picker.clear();setForm(presets[b.dataset.preset]);calculate();}));"),
    ("$('fd-reset').addEventListener('click',()=>{sourceLabel='Browns vs Panthers · Sep 27, 2026';setForm(browns);calculate();});",
     "// Reset returns to the real play the reader last picked; with none, to the verified Browns case.\n  $('fd-reset').addEventListener('click',()=>{if(picker.reselect()){openTab('edit');return;}sourceLabel='Browns vs Panthers · Sep 27, 2026';setForm(browns);calculate();});"),
    ("lens.shareParams(u.searchParams);copy(u.href);});",
     "lens.shareParams(u.searchParams);const c=picker.current();if(c)u.searchParams.set('play',c.decision.id);copy(u.href);});"),
    ("copy(`Data Dawgs · Fourth Down Lab\\n${situation(activeInput)}\\n",
     "const c=picker.current();copy(`Data Dawgs · Fourth Down Lab\\n${c?`${c.matchup} · week ${c.weekNumber} · coach chose: ${DDFourth.labels[c.decision.actual]||'unclear'}\\n`:''}${situation(activeInput)}\\n"),
    (cut_between("  function renderBoard(){", "$('fd-sort').addEventListener('change',renderBoard);\n"), None),
    ("  const query=new URLSearchParams(location.search);if(query.has('qtr')){", PAGE_NEW + "\n  const query=new URLSearchParams(location.search);if(query.has('qtr')){"),
    ("setForm(s);sourceLabel='Shared situation';}}", "setForm(s);sourceLabel='Shared situation';sharedSituation=true;}}"),
    (INIT_OLD, INIT_NEW),
    (SYS_OLD, SYS_NEW),
    ("ctx:()=>JSON.stringify({current:window.DDFourthState||null,weeklyAsOf:weekly?.data.refreshed_at})",
     "ctx:()=>JSON.stringify({current:window.DDFourthState||null,weeklyAsOf:weekly?.data.refreshed_at,feeds:picker.feeds()})"),
], "DDFourthPicker.create")

js = (REPO / "fourth-down-page.js").read_text(encoding="utf-8")
for gone in ["renderBoard", "fd-game-filter", "fd-decisions", "fd-board-status", "fd-refresh"]:
    assert gone not in js, gone

CSS = """
/* Game and play picker */
.fd-pick{margin:0 0 18px}.fd-pick-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.fd-pick h2{margin:0;font-size:22px;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.fd-step{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font:800 13px ui-monospace,monospace;flex:none}
.fd-weeks{display:flex;gap:6px}.fd .fd-weeks button{min-height:44px;padding:6px 13px;font-size:13px;line-height:1.25;display:flex;flex-direction:column;align-items:flex-start}.fd-weeks small{font-weight:600;color:var(--ink-2);font-size:11px}
.fd .fd-weeks button[aria-pressed=true],.fd .fd-game[aria-pressed=true],.fd .fd-tabs button[aria-selected=true]{border-color:var(--accent);box-shadow:inset 0 -3px var(--accent);background:var(--page)}
.fd-games{display:flex;flex-wrap:wrap;gap:8px}.fd .fd-game{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:8px 12px;min-width:0;min-height:52px;text-align:left;transition:transform .08s ease,border-color .12s ease,box-shadow .12s ease}.fd .fd-game:active,.fd .fd-play:active{transform:translateY(1px) scale(.985)}
.fd-game-teams{display:flex;align-items:baseline;gap:5px;font-size:14.5px;white-space:nowrap}.fd-game-teams em{font:700 14px ui-monospace,monospace;font-style:normal;color:var(--ink-2)}.fd-game-teams i{font-style:normal;color:var(--ink-2);font-weight:500;font-size:12px;margin:0 1px}
.fd-game-meta{font-size:11px;font-weight:650;color:var(--ink-2);display:flex;align-items:center;gap:6px;white-space:nowrap}.fd .fd-game[data-empty]{opacity:.6}.fd .fd-game[data-empty][aria-pressed=true]{opacity:1}.fd-game-all .fd-game-teams b{color:var(--accent)}.fd .fd-game-more{border-style:dashed}.fd-game-more .fd-game-teams b{color:var(--ink-2)}.fd-left .fd-status{font-size:11px;margin-top:14px}
.fd-live-dot{width:8px;height:8px;border-radius:50%;background:#e5322d;animation:fd-pulse 1.4s ease-in-out infinite}@keyframes fd-pulse{50%{opacity:.3}}
.fd-feed-status{font:600 11px/1.5 ui-monospace,monospace;color:var(--ink-2);margin:10px 0 0}.fd-feed-status.fd-stale{color:var(--bad)}
.fd-tabs{display:flex;gap:6px;margin:0 0 14px}.fd .fd-tabs button{flex:1;font-size:13px;min-height:46px;display:flex;align-items:center;justify-content:center;gap:7px;padding:8px 10px;line-height:1.2}.fd-tabs .fd-step{width:20px;height:20px;font-size:11px}
.fd-plays-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;min-height:34px}.fd-plays-head b{font-size:15px}.fd-plays-sort{display:flex;gap:4px}.fd .fd-plays-sort button{min-height:34px;padding:5px 9px;font-size:11px}.fd .fd-plays-sort button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.fd-plays{display:flex;flex-direction:column;gap:8px;max-height:min(64vh,660px);overflow-y:auto;overscroll-behavior:contain;padding:2px 4px 2px 2px}
.fd .fd-play{display:grid;gap:5px;text-align:left;padding:11px 12px;width:100%;font-weight:500;flex:none;transition:transform .08s ease,border-color .12s ease,box-shadow .12s ease}
.fd-play-top{font:700 11px ui-monospace,monospace;color:var(--ink-2)}.fd-play-top b{color:var(--ink-1)}.fd-play-down{font-size:17px;font-weight:850;letter-spacing:-.015em;color:var(--ink-1)}.fd-play-score{font-size:12px;color:var(--ink-2)}
.fd-mini-field{width:100%;height:12px;display:block;border-radius:2px}.fd-mf-turf{fill:#3d7a47}.fd-mf-end{fill:#295532}.fd-mf-yard{stroke:rgba(255,255,255,.35);stroke-width:.5}.fd-mf-gain{stroke:#ffd23f;stroke-width:1.4}.fd-mf-ball{fill:#8f4d1d;stroke:#fff;stroke-width:.9}
.fd-play-calls{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}.fd-coach,.fd-bot{font:700 11px ui-monospace,monospace;padding:3px 7px;border-radius:5px;border:1px solid var(--grid);white-space:nowrap}.fd-bot-agree{color:var(--good);border-color:color-mix(in srgb,var(--good) 45%,transparent)}.fd-bot-miss{color:#d0560c;border-color:color-mix(in srgb,#e96512 55%,transparent);background:color-mix(in srgb,#e96512 9%,transparent)}.fd-bot-none{opacity:.7}
.fd .fd-play.is-on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent),0 2px 0 var(--accent);background:var(--page)}.fd .fd-play.is-edited{border-style:dashed;box-shadow:none}
.fd-plays-empty{font-size:13px;color:var(--ink-2);line-height:1.6;margin:6px 0}.fd-plays-note{font-size:11px;color:var(--ink-2);margin:12px 0 0;line-height:1.5}
.fd-edit-intro{font-size:13px;color:var(--ink-2);margin:0 0 10px;line-height:1.5}.fd-starts{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}.fd .fd-starts button{font-size:11px;min-height:38px;padding:6px 10px}
.fd-play-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;background:#24150c;color:#e6d6c4;border-bottom:1px solid #4a3523;font:600 12px ui-monospace,monospace;text-align:center}.fd-play-nav b{color:#fff7ed}.fd .fd-play-nav button{min-height:40px;min-width:48px;background:#3e3020;border-color:#6b5638;color:#fff7ed;font-size:22px;padding:0 12px;line-height:1}.fd .fd-play-nav button:disabled{cursor:default;opacity:.35}
.fd-actual{border:1px solid var(--grid);border-left:4px solid var(--accent);border-radius:0 9px 9px 0;padding:12px 14px;margin-bottom:16px;background:var(--page)}.fd-actual p{margin:0;font-size:14px;line-height:1.5}.fd-actual .fd-actual-play{margin-top:9px;font-size:12px;color:var(--ink-2)}.fd-actual-play span{display:block;font:800 10px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:2px}.fd-actual small{display:block;margin-top:7px;font-size:11px;color:var(--ink-2)}
@media(max-width:650px){.fd-pick h2{font-size:20px}.fd-games{flex-wrap:nowrap;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 8px;scrollbar-width:thin}.fd .fd-game{flex:0 0 auto;scroll-snap-align:start}.fd-plays{flex-direction:row;max-height:none;overflow-x:auto;overflow-y:visible;scroll-snap-type:x mandatory;padding:2px 2px 10px}.fd .fd-play{flex:0 0 82%;scroll-snap-align:start}.fd-weeks{width:100%}.fd .fd-weeks button{flex:1}}
@media(prefers-reduced-motion:reduce){.fd-live-dot{animation:none}.fd .fd-game,.fd .fd-play{transition:none}}
"""
css = REPO / "fourth-down.css"
t = css.read_text(encoding="utf-8")
if "/* Game and play picker */" not in t:
    assert t.count(".fd-result{order:-1}") == 1, "mobile result-first rule drifted"
    t = t.replace(".fd-result{order:-1}", "")  # the picker now comes first on phones
    css.write_text(t.rstrip("\n") + "\n" + CSS, encoding="utf-8")
    print("  fourth-down.css: patched")
else:
    print("  fourth-down.css: already patched")

# Toto's MAP: keep the goal-lens sentence intact (that patch checks for it) and lead with the picker.
OLD = "fourth-down.html — Fourth Down Lab: nfl4th go/field-goal/punt win probabilities,"
NEW = "fourth-down.html — Fourth Down Lab: opens on a real fourth down from this week's games (or the previous captured week); pick any game and play, or edit the situation by hand. nfl4th go/field-goal/punt win probabilities,"
done = 0
for f in sorted(glob.glob(str(REPO / "*.html"))):
    p = pathlib.Path(f)
    s = p.read_text(encoding="utf-8")
    if NEW in s or OLD not in s:
        continue
    assert s.count(OLD) == 1, f"{p.name}: MAP sentence appears {s.count(OLD)} times"
    p.write_text(s.replace(OLD, NEW), encoding="utf-8")
    done += 1
print(f"  MAP sentence updated in {done} pages")

sm = REPO / "sitemap.xml"
s = sm.read_text(encoding="utf-8")
s2 = re.sub(r"(<loc>https://datadawgs216\.com/fourth-down\.html</loc><lastmod>)[0-9-]+(</lastmod>)", r"\g<1>2026-10-10\g<2>", s)
assert "fourth-down.html</loc><lastmod>2026-10-10" in s2
sm.write_text(s2, encoding="utf-8")

# Asset cache keys: first 12 hex of each file's sha256, as the page already does.
html_p = REPO / "fourth-down.html"
s = html_p.read_text(encoding="utf-8")
old_css = re.search(r'fourth-down\.css\?v=([0-9a-f]+)', s).group(1)
for name in ["fourth-down.css", "fourth-down-engine.js", "fourth-down-analysis.js", "fourth-down-objectives.js",
             "fourth-down-lens.js", "fourth-down-explorer.js", "fourth-down-picker.js", "fourth-down-page.js"]:
    key = hashlib.sha256((REPO / name).read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]
    s, n = re.subn(re.escape(name) + r'\?v=[0-9A-Za-z]+', f"{name}?v={key}", s)
    assert n == 1, f"{name}: {n} references in fourth-down.html"
html_p.write_text(s, encoding="utf-8")
new_css = re.search(r'fourth-down\.css\?v=([0-9a-f]+)', s).group(1)
be = REPO / "work/build_explore.py"
b = be.read_text(encoding="utf-8")
if old_css != new_css:
    assert b.count(f"fourth-down.css?v={old_css}") == 1, "build_explore.py no longer pins the template css link"
    be.write_text(b.replace(f"fourth-down.css?v={old_css}", f"fourth-down.css?v={new_css}"), encoding="utf-8")
print(f"  asset keys stamped (css {old_css} -> {new_css})")
