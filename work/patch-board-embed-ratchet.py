"""
Stop the embedded live board growing without bound.

`.dd-embed body.livefull .bmx{height:auto;min-height:calc(100vh - 108px)}` was written for
the projector. Inside an iframe 100vh IS the iframe height, and in the dashboard the iframe
height is whatever the board last POSTED. So the min-height feeds its own measurement back:

    posted = grid + chrome ; grid >= frame - 108 ; frame = posted
    => posted' = posted + (chrome - 108)

The original note reasoned this converges because chrome (~90px) < 108. That holds on a
desktop. On a phone the chrome above the grid -- tab row, Auctioneer / Sound / Full screen,
heading, note, all wrapping -- is ~175px, so the sign flips and it ratchets UPWARD forever.
Measured 2026-08-27 at 375x812 on the live site: +67px every 900ms tick, 3430 -> 4033 and
still climbing, five times the viewport. The shell clamps only the LOW side
(Math.max(320, h)), so nothing stopped it.

The vh fill is correct only when the shell has actually PINNED the frame to the screen,
which it does in fullscreen and nowhere else (dashboard.html: iframe.on{height:100vh
!important} plus the fullscreenchange handler). So it is armed by an explicit signal now
rather than assumed.

    cd work && py patch-board-embed-ratchet.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
BOARD = REPO / "board.html"
DASH = REPO / "dashboard.html"

BOARD_EDITS = [
(
 '''       the content height instead of ratcheting. */
    + ".dd-embed body.livefull .bmx{height:auto;min-height:calc(100vh - 108px)}";''',
 r'''       the content height instead of ratcheting.

       ⚠ 2026-08-27: the min-height above USED TO BE calc(100vh - 108px) here, and that
       is the ratchet. In auto-height mode 100vh is the height we ourselves posted, so the
       rule measures its own output. Desktop chrome (~90px) is under the 108px subtracted
       so it crept downward and looked fine; phone chrome is ~175px, the sign flips, and
       the board grew 67px every tick without limit. The vh fill is now armed only by
       .dd-pinned, which the shell sets when it has really pinned the frame to the screen. */
    + ".dd-embed body.livefull .bmx{height:auto;min-height:0}"
    + ".dd-embed body.livefull.dd-pinned .bmx{height:calc(100vh - 108px);min-height:0}";'''
),
(
 '    if(e.origin!==location.origin || !e.data || e.data.dd!=="theme") return;',
 '''    if(e.origin!==location.origin || !e.data) return;
    /* Only the shell knows whether our 100vh is the real screen or just the height we
       last posted. Never infer it in here -- inferring it is what ratcheted. */
    if(e.data.dd==="pinned"){ document.body.classList.toggle("dd-pinned", !!e.data.on); setTimeout(post,60); return; }
    if(e.data.dd!=="theme") return;'''
),
]

DASH_EDITS = [
(
 '''    const f = frames[active]; if(!f) return;
    f.style.height = document.fullscreenElement ? "100vh" : (f.dataset.h || 420)+"px";''',
 '''    const f = frames[active]; if(!f) return;
    const pinned = !!document.fullscreenElement;
    f.style.height = pinned ? "100vh" : (f.dataset.h || 420)+"px";
    // tell the board which mode it is in: pinned means its 100vh is the real screen, so
    // the projector fill is safe. Unpinned it would be measuring its own posted height.
    try{ f.contentWindow.postMessage({dd:"pinned", on:pinned}, location.origin); }catch(err){}'''
),
]

def apply(path, edits):
    s = path.read_text(encoding="utf-8")
    applied = present = 0
    for old, new in edits:
        if new in s:
            present += 1
            continue
        n = s.count(old)
        assert n == 1, "%s: anchor not unique (%d): %.60s" % (path.name, n, old)
        s = s.replace(old, new, 1)
        applied += 1
    path.write_text(s, encoding="utf-8", newline=NL)
    return applied, present

ba, bp = apply(BOARD, BOARD_EDITS)
da, dp = apply(DASH, DASH_EDITS)
print("patch-board-embed-ratchet: board %d applied/%d present, dashboard %d applied/%d present" % (ba, bp, da, dp))
