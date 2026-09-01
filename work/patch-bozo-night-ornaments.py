"""Add the static Midnight Midway rail and fog to bozo.html."""
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "bozo.html"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if old_count == 1 and new_count == 0:
        return text.replace(old, new, 1)
    if old_count == 0 and new_count == 1:
        print(f"  skip {label} - already patched")
        return text
    raise AssertionError(
        f"{label}: expected old/new counts 1/0 or 0/1, got {old_count}/{new_count}"
    )


s = PAGE.read_text(encoding="utf-8")
s = replace_once(
    s,
    """  --pb-display:"Arial Black","Helvetica Neue",Helvetica,Arial,sans-serif;
  --pb-serif:Georgia,"Times New Roman",ui-serif,serif;
  --pb-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* dark = the bill printed on dark stock */""",
    """  --pb-display:"Arial Black","Helvetica Neue",Helvetica,Arial,sans-serif;
  --pb-serif:Georgia,"Times New Roman",ui-serif,serif;
  --pb-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* the cabinet and the closed midway share one bulb system */
  --bulb:#ffd98a; --bulb-off:#5d4826; --bulbrun:paused;
  --pb-night-ornaments:1; --pb-fog-alpha:.08;
  --pb-dead-bulb-rail:radial-gradient(circle at 13px 8px,var(--bulb-off) 0 3.4px,transparent 4.2px) 0 0/26px 16px repeat-x;
  /* dark = the bill printed on dark stock */""",
    "shared bulb tokens",
)
s = replace_once(
    s,
    """  --pb-shadow:rgba(49,29,0,.14);
  --slip-stock:#fffdf6;""",
    """  --pb-shadow:rgba(49,29,0,.14);
  --pb-night-ornaments:0; --pb-fog-alpha:0;
  --slip-stock:#fffdf6;""",
    "light-theme ornament disable",
)
s = replace_once(
    s,
    """  /* the cabinet's own metals — brown-and-gold, unchanged */
  --bulb:#ffd98a; --bulb-off:#5d4826; --brass:#c9a24a; --brass-hi:#f2dda6; --brass-lo:#6d5220;""",
    """  /* the cabinet's own metals — brown-and-gold, unchanged */
  --brass:#c9a24a; --brass-hi:#f2dda6; --brass-lo:#6d5220;""",
    "cabinet uses shared bulbs",
)
s = replace_once(
    s,
    """#hubCard.pb-bill{
  background:var(--pb-stock); color:var(--pb-ink);
  border:1px solid var(--pb-edge); border-radius:3px;
  padding:0; overflow:hidden;
  box-shadow:0 1px 0 var(--pb-edge), 0 10px 30px var(--pb-shadow);
}
/* the printed area sits inside a hairline frame, like a real broadside's plate */
.pb-bill .pb-plate{border:1px solid var(--pb-rule);margin:clamp(9px,1.6vw,15px);
  padding:clamp(16px,3.4vw,38px) clamp(14px,3.6vw,44px)}""",
    """#hubCard.pb-bill{
  background:var(--pb-stock); color:var(--pb-ink); position:relative;
  border:1px solid var(--pb-edge); border-radius:3px;
  padding:0; overflow:hidden;
  box-shadow:0 1px 0 var(--pb-edge), 0 10px 30px var(--pb-shadow);
}
/* One shared dead rail, top and bottom. The larger radial layers are glow only;
   the final layer is the same off-bulb repeat on both edges. Static by design. */
#hubCard.pb-bill::before,#hubCard.pb-bill::after{content:"";position:absolute;left:0;right:0;
  height:16px;z-index:2;pointer-events:none;opacity:var(--pb-night-ornaments);animation:none;
  background:
    radial-gradient(circle at 13% 8px,rgba(255,233,168,.40) 0 5px,rgba(255,233,168,.10) 8px,transparent 22px),
    radial-gradient(circle at 51% 8px,rgba(255,233,168,.40) 0 5px,rgba(255,233,168,.10) 8px,transparent 22px),
    radial-gradient(circle at 91% 8px,rgba(255,233,168,.40) 0 5px,rgba(255,233,168,.10) 8px,transparent 22px),
    radial-gradient(circle at 13% 8px,var(--bulb) 0 3.4px,transparent 4.2px),
    radial-gradient(circle at 51% 8px,var(--bulb) 0 3.4px,transparent 4.2px),
    radial-gradient(circle at 91% 8px,var(--bulb) 0 3.4px,transparent 4.2px),
    var(--pb-dead-bulb-rail)}
#hubCard.pb-bill::before{top:0}
#hubCard.pb-bill::after{bottom:0;transform:rotate(180deg)}
/* The closed midway hangs low over the page; the light theme resolves both alpha
   variables to zero, so its rendering remains unchanged. */
body::after{content:"";position:fixed;left:0;right:0;bottom:0;height:min(42vh,420px);
  z-index:39;pointer-events:none;background:
    radial-gradient(ellipse 72% 68% at bottom left,rgb(139 145 121 / var(--pb-fog-alpha)) 0,transparent 68%),
    radial-gradient(ellipse 72% 68% at bottom right,rgb(139 145 121 / var(--pb-fog-alpha)) 0,transparent 68%)}
/* the printed area sits inside a hairline frame, like a real broadside's plate */
.pb-bill .pb-plate{position:relative;z-index:1;border:1px solid var(--pb-rule);margin:clamp(9px,1.6vw,15px);
  padding:clamp(16px,3.4vw,38px) clamp(14px,3.6vw,44px)}""",
    "rail and fog",
)
PAGE.write_text(s, encoding="utf-8", newline="\n")
print("  bozo.html Midnight Midway ornaments current")
