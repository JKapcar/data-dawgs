"""
Leaving full screen left the live board as a giant black block.

Regression from 8ed9263, and the mechanism is the stored height rather than the CSS.

In full screen the shell pins the iframe to 100vh and the board fills it, so the board
posts a height of roughly the whole screen (~1100px). The shell stores every posted height
in dataset.h without asking whether it is currently pinned, so that screen-sized value
became the frame's remembered height. On exit the handler restores `dataset.h` -- the
pinned value -- and the frame stays screen-tall around a board that is now only a few
hundred pixels of content. Hence the black expanse under the grid.

A height measured while pinned describes the SCREEN, not the content, and must never be
remembered as the content height.

    cd work && py patch-dash-fullscreen-exit.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "dashboard.html"
s = PAGE.read_text(encoding="utf-8")

old = """    for(const k in frames){
      if(frames[k].contentWindow === e.source){
        frames[k].dataset.h = Math.max(320, e.data.h);
        if(k === active) frames[k].style.height = frames[k].dataset.h + "px";
      }
    }"""
new = """    // ⚠️ A height posted while we are PINNED describes the screen, not the content: the
    // board fills 100vh in full screen and posts ~1100px. Storing that made dataset.h the
    // screen height, and exiting restored it — a screen-tall frame around a short board,
    // which is the black block. Ignore posts while pinned; the board re-posts its true
    // height as soon as it is unpinned.
    if(document.fullscreenElement) return;
    for(const k in frames){
      if(frames[k].contentWindow === e.source){
        frames[k].dataset.h = Math.max(320, e.data.h);
        if(k === active) frames[k].style.height = frames[k].dataset.h + "px";
      }
    }"""
assert s.count(old) == 1, "height handler"
s = s.replace(old, new, 1)

old = """    f.style.height = pinned ? "100vh" : (f.dataset.h || 420)+"px";"""
new = """    // On the way out, do not trust the remembered height either — it may predate the
    // full-screen round trip. Collapse to the floor and let the board's own post size it.
    f.style.height = pinned ? "100vh" : "320px";"""
assert s.count(old) == 1, "fullscreen handler"
s = s.replace(old, new, 1)

# ---- and the authoritative half, in the board itself -----------------------
# The shell guard depends on document.fullscreenElement, which is awkward to reason about
# across the transition. The BOARD always knows whether it is pinned -- it is carrying the
# class -- and it is the thing doing the measuring, so the cleanest rule is that a pinned
# board simply does not report a height. Then no screen-sized value can ever be stored.
B = REPO / "board.html"
b = B.read_text(encoding="utf-8")
old_post = """  const post = () => {
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    parent.postMessage({dd:"height", h}, location.origin);
  };"""
new_post = """  const post = () => {
    /* ⚠ A pinned board is filling the SCREEN, so its scrollHeight describes the screen and
       not the content. Posting it made the shell remember a screen-sized height, and
       leaving full screen restored that around a short board -- a black expanse under the
       grid. Stay quiet while pinned; the unpin message triggers a fresh, honest post. */
    if(document.body.classList.contains("dd-pinned")) return;
    const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    parent.postMessage({dd:"height", h}, location.origin);
  };"""
assert b.count(old_post) == 1, "post()"
b = b.replace(old_post, new_post, 1)
B.write_text(b, encoding="utf-8", newline=NL)
print("board no longer posts while pinned")

PAGE.write_text(s, encoding="utf-8", newline=NL)
print("patch-dash-fullscreen-exit: ok")
