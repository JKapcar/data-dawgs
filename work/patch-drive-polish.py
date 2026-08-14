#!/usr/bin/env python3
"""patch-drive-polish.py — visual layer for The Drive (Phase 1.5).

Phase 1 shipped the right plumbing (entries, p_naive, chains data, helmets,
a11y) but none of the approved design layer. This patch adds visuals ONLY:
Bungee display font, card max-width + field proportions, theme-aware turf
(dark = MNF night game with floodlights, light = cream day game), goalposts,
chain poles/knobs/link, big readout, styled Ask Madden + face-down reveal
cards, drag dust, TD/pick-six celebration. Entry semantics unchanged.

Run from repo root AFTER `git fetch && git reset --hard origin/main`:
    python3 work/patch-drive-polish.py
Same commit: cd work && python3 stamp-sw-version.py && node verify-sw.mjs
Idempotent: second run is a no-op.
"""
import io, re, sys

PATH = "challenge.html"
MARK = "/* drive-polish v1 */"

s = io.open(PATH, encoding="utf-8").read()
if MARK in s:
    print("already applied - no-op"); sys.exit(0)

def rep1(old, new):
    global s
    assert s.count(old) == 1, "anchor not unique/missing: %r" % old[:72]
    s = s.replace(old, new)

# ---- 1. Bungee font ------------------------------------------------------
assert s.count("fonts.googleapis.com") == 0, "font already present?"
rep1("</title>",
     '</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">'
     '<link href="https://fonts.googleapis.com/css2?family=Bungee&display=swap" rel="stylesheet">')

# ---- 2. Replace the whole drive CSS block --------------------------------
a = s.index("House · The Drive (Phase 1)")
a = s.index("*/", a) + 2
seg = s[a:a+6000]
last = 0
for m in re.finditer(r"\.drive-[a-z-]+[^{]*\{[^}]*\}", seg):
    last = m.end()
assert last > 1000, "drive css block not found where expected"
b = a + last

NEW_CSS = MARK + r"""
.drive-card{padding:0;overflow:hidden;max-width:760px;margin-left:auto;margin-right:auto;border-color:color-mix(in srgb,var(--accent) 30%,var(--border))}
.drive-head{padding:14px 16px 0}
.drive-field{height:176px;position:relative;overflow:hidden;touch-action:none;cursor:grab;border-radius:10px;margin:10px 12px 0;border:2px solid rgba(0,0,0,.35);
  background:radial-gradient(150px 80px at 25% -8%,rgba(210,235,255,.18),transparent 70%),radial-gradient(150px 80px at 75% -8%,rgba(210,235,255,.18),transparent 70%),repeating-linear-gradient(90deg,#164a29 0 10%,#123f22 10% 20%);
  box-shadow:inset 0 0 55px rgba(0,0,0,.7)}
[data-theme="light"] .drive-field{background:repeating-linear-gradient(90deg,#3f9450 0 10%,#348245 10% 20%);box-shadow:none}
.drive-field:active{cursor:grabbing}
.drive-field:before,.drive-field:after{content:"";position:absolute;top:0;bottom:0;width:10%;z-index:1;background:repeating-linear-gradient(45deg,#0b2a4c 0 12px,#082038 12px 24px)}
.drive-field:after{right:0;background:repeating-linear-gradient(45deg,#0a4426 0 12px,#07331c 12px 24px)}
[data-theme="light"] .drive-field:before{background:repeating-linear-gradient(45deg,#0e3a66 0 12px,#0c3258 12px 24px)}
[data-theme="light"] .drive-field:after{background:repeating-linear-gradient(45deg,#0a5a2e 0 12px,#085026 12px 24px)}
.drive-yard{position:absolute;top:0;bottom:0;border-left:2px solid rgba(190,240,205,.38);pointer-events:none}
[data-theme="light"] .drive-yard{border-left-color:rgba(255,255,255,.85)}
.drive-yard b{position:absolute;bottom:4px;left:4px;font:400 10px 'Bungee',cursive;color:rgba(190,240,205,.5)}
[data-theme="light"] .drive-yard b{color:rgba(255,255,255,.9)}
.drive-gp{position:absolute;top:8px;width:24px;height:58px;pointer-events:none;z-index:2}
.drive-gp:before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:#ffd23f;border-radius:2px}
.drive-gp:after{content:"";position:absolute;left:10px;top:4px;bottom:0;width:4px;background:#ffd23f;border-radius:2px}
.drive-gp.l{left:2.5%}.drive-gp.r{right:2.5%}
.drive-gp.flash{animation:dgp .6s ease 2}
@keyframes dgp{50%{filter:drop-shadow(0 0 12px #ffd23f) brightness(1.7)}}
.drive-chain{position:absolute;top:0;bottom:0;background:rgba(255,176,32,.15);pointer-events:none;z-index:2;border-left:2px solid rgba(255,176,32,.85);border-right:2px solid rgba(255,176,32,.85)}
.drive-chain i{position:absolute;top:13px;bottom:36px;width:7px;border-radius:4px;background:linear-gradient(180deg,#ff8a4d,#c04e00);box-shadow:0 2px 5px rgba(0,0,0,.45)}
.drive-chain i:before{content:"";position:absolute;top:-4px;left:-5px;width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#ffd9c2,#ff6a02 60%,#c04e00);border:2px solid rgba(0,0,0,.35)}
.drive-chain i.l{left:-4px}.drive-chain i.r{right:-4px}
.drive-chain u{position:absolute;top:24px;left:7px;right:7px;height:7px;text-decoration:none;border-radius:4px;background:repeating-linear-gradient(90deg,rgba(255,205,140,.95) 0 7px,transparent 7px 12px)}
.drive-chain span{position:absolute;top:2px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#ffb020;color:#261400;padding:1px 6px;border-radius:3px;font:800 9px ui-monospace,monospace;z-index:1}
.drive-cluster{position:absolute;top:26px;width:150px;margin-left:-75px;z-index:3}
.drive-helmet{position:absolute;width:58px;height:52px;object-fit:contain;top:10px;filter:drop-shadow(0 5px 7px rgba(0,0,0,.55))}
.drive-away{left:0}.drive-home{right:0}
.drive-ball{position:absolute;left:58px;top:26px;width:34px;height:24px;border-radius:50%;background:radial-gradient(circle at 34% 28%,#c08a4e,#7a4a1c 68%,#432708);border:2px solid #33200a;box-shadow:0 4px 8px rgba(0,0,0,.5)}
.drive-ball:after{content:"";position:absolute;left:7px;right:7px;top:50%;height:2px;transform:translateY(-50%);background:repeating-linear-gradient(90deg,#fff 0 2.5px,transparent 2.5px 5px)}
.drive-cluster.moving .drive-ball{animation:drock .3s ease infinite}
@keyframes drock{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}
.drive-value{display:block;text-align:center;margin:8px 0 2px;font:400 30px 'Bungee',cursive}
.drive-value:not(:empty):after{content:"%";font-size:14px;color:#ff6a02;margin-left:2px}
.drive-dust{position:absolute;width:8px;height:8px;border-radius:50%;pointer-events:none;z-index:3;background:radial-gradient(circle,#7a9a86,transparent 70%);animation:dpuff .55s ease-out forwards}
[data-theme="light"] .drive-dust{background:radial-gradient(circle,#d9c8a0,transparent 70%)}
@keyframes dpuff{from{transform:translate(0,0) scale(.7);opacity:.95}to{transform:translate(var(--dx),var(--dy)) scale(2.6);opacity:0}}
.drive-conf{position:absolute;width:8px;height:12px;top:-14px;pointer-events:none;z-index:5;animation:dfall 1.5s ease-in forwards}
@keyframes dfall{from{transform:translateY(0) rotate(0);opacity:1}to{transform:translateY(210px) rotate(var(--rot));opacity:.15}}
.drive-banner{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) scale(.4);z-index:6;font:400 24px 'Bungee',cursive;color:#fff;white-space:nowrap;opacity:0;pointer-events:none;text-shadow:0 0 16px rgba(255,176,32,.9),0 3px 0 rgba(0,0,0,.55)}
.drive-banner.show{animation:dban 1.7s cubic-bezier(.2,1.4,.3,1) forwards}
@keyframes dban{0%{opacity:0;transform:translate(-50%,-50%) scale(.4) rotate(-6deg)}22%{opacity:1;transform:translate(-50%,-50%) scale(1.15) rotate(2deg)}38%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%) scale(1)}}
.drive-field.shake{animation:dqk .35s ease}
@keyframes dqk{25%{transform:translate(2px,-2px)}50%{transform:translate(-2px,2px)}75%{transform:translate(1px,-1px)}}
.drive-bottom{padding:12px 16px 16px}
.drive-coach{margin:0 0 10px;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;text-align:center;font-size:13.5px;line-height:1.5}
.drive-ask{display:flex;align-items:center;gap:8px;margin:0 auto 10px;font:400 13px 'Bungee',cursive;letter-spacing:1px;color:#fff !important;background:linear-gradient(180deg,#ff8a4d,#ff6a02) !important;border:2px solid #c04e00 !important;border-left:6px solid #161009 !important;border-radius:8px;padding:12px 22px;cursor:pointer;box-shadow:0 5px 0 #c04e00;transition:transform .06s,box-shadow .06s}
.drive-ask:active{transform:translateY(3px);box-shadow:0 1px 0 #c04e00}
.drive-ask:before{content:"🎧 "}
.drive-cards{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.drive-model{width:112px;border-radius:8px;overflow:hidden;border:1.5px solid var(--border);cursor:pointer;background:var(--card,#141414);padding:0;text-align:center}
.drive-model:before{content:attr(data-line);display:block;background:#ff6a02;color:#fff;border-bottom:2px solid #c04e00;font:800 9px system-ui;letter-spacing:1.5px;padding:5px 6px;text-transform:uppercase}
.drive-model small{display:block;font-size:9px;letter-spacing:1px;color:var(--muted,#8f897d);text-transform:uppercase;padding-top:8px}
.drive-model b{display:block;font:400 24px 'Bungee',cursive;padding:2px 0 10px}
.drive-lock{font:400 12px 'Bungee',cursive !important;letter-spacing:1px}
.drive-touchdown{display:none}
.drive-note{min-height:18px}"""
s = s[:a] + NEW_CSS + s[b:]

# ---- 3. Template: goalposts, chain internals, banner, relocate readout ---
rep1('class="drive-chain"><span>CHAINS ',
     'class="drive-chain"><i class="l"></i><i class="r"></i><u></u><span>CHAINS ')
rep1('</div><div class="drive-cluster">',
     '</div><b class="drive-gp l"></b><b class="drive-gp r"></b><div class="drive-cluster">')
rep1('<output class="drive-value"></output></div></div><div class="drive-bottom">',
     '</div><b class="drive-banner"></b></div><div class="drive-bottom"><output class="drive-value"></output>')

# ---- 4. JS: dust + celebration + moving state in set(ev) -----------------
OLD_SET = ('function set(ev){ var r=field.getBoundingClientRect(); '
           'p=Math.max(0,Math.min(100,Math.round((ev.clientX-r.left-r.width*.1)/(r.width*.8)*100))); '
           'valueOf[g.game_id]=p; touchedGames.add(g.game_id); paint(); }')
NEW_SET = (
 'var lastX=null,lastT=0,celeb=null;\n'
 '      function dust(x,y,fast){var n=fast?4:1;for(var q=0;q<n;q++){var d=document.createElement("div");'
 'd.className="drive-dust";d.style.left=(x+(Math.random()*16-8))+"px";d.style.top=(y+(Math.random()*8-2))+"px";'
 'd.style.setProperty("--dx",(Math.random()*44-22)+"px");d.style.setProperty("--dy",(-(Math.random()*24+6))+"px");'
 'field.appendChild(d);(function(dd){setTimeout(function(){dd.remove()},620)})(d);}}\n'
 '      function celebrate(txt,gpSel){var bn=field.querySelector(".drive-banner");if(bn){bn.textContent=txt;'
 'bn.classList.remove("show");void bn.offsetWidth;bn.classList.add("show");}'
 'field.classList.remove("shake");void field.offsetWidth;field.classList.add("shake");'
 'var gp=field.querySelector(gpSel);if(gp){gp.classList.remove("flash");void gp.offsetWidth;gp.classList.add("flash");}'
 'var cols=["#ff6a02","#2fbf3f","#ffb020","#fff","#69d68f"];'
 'for(var q=0;q<40;q++){var c=document.createElement("div");c.className="drive-conf";'
 'c.style.left=(Math.random()*100)+"%";c.style.background=cols[q%cols.length];'
 'c.style.setProperty("--rot",(Math.random()*720-360)+"deg");c.style.animationDelay=(Math.random()*.35)+"s";'
 'field.appendChild(c);(function(cc){setTimeout(function(){cc.remove()},2100)})(c);}}\n'
 '      function set(ev){ var r=field.getBoundingClientRect(); '
 'var now=performance.now(); var vel=(lastX===null)?0:Math.abs(ev.clientX-lastX)/Math.max(1,now-lastT); '
 'lastX=ev.clientX; lastT=now; '
 'p=Math.max(0,Math.min(100,Math.round((ev.clientX-r.left-r.width*.1)/(r.width*.8)*100))); '
 'var cl=field.querySelector(".drive-cluster"); if(cl){cl.classList.add("moving");'
 'clearTimeout(cl._mt);cl._mt=setTimeout(function(){cl.classList.remove("moving")},180);} '
 'if(vel>0.08){dust(ev.clientX-r.left,r.height-52,vel>0.7);} '
 'if(p>=100&&celeb!=="H"){celeb="H";celebrate("TOUCHDOWN "+g.home_team+"!",".drive-gp.r");}'
 'else if(p<=0&&celeb!=="A"){celeb="A";celebrate("PICK SIX "+g.away_team+"!",".drive-gp.l");}'
 'else if(p>2&&p<98){celeb=null;} '
 'valueOf[g.game_id]=p; touchedGames.add(g.game_id); paint(); }')
rep1(OLD_SET, NEW_SET)

# ---- 5. Ask Madden reveal cards: face-down state -------------------------
rep1('b.className="drive-model";b.textContent=m.model_id+" \u00b7 tap";',
     'b.className="drive-model";b.setAttribute("data-line","LINE "+(cards.children.length+1));'
     'b.innerHTML="<small>tap to reveal</small><b>?</b>";')

io.open(PATH, "w", encoding="utf-8").write(s)
print("applied ok")
