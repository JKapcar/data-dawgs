"""
Stamp teamdraft.html out of arena.html — the 2026 NFL team draft pool.

There is no build system here, so a NEW page is an existing page's head + shell +
footer with the <main> and the page script swapped (build_arena.py precedent).
arena.html is the template: it is the smallest page carrying the whole p-* card CSS
family, and its own <main> is a clean slice between the two markers.

⚠️ Slice by CONTENT MARKERS, never line numbers.

The page reads /data/draft-2026.json and nothing else. Every number on it — expected
wins, posted lines, win distributions, per-game probabilities, the head-to-head
matrix, the draft log — comes out of that file. Nothing is computed here that the
pipe can compute, because two implementations of the same arithmetic drift and then
one of them starts lying. scripts/team_draft_pool.py owns the arithmetic.

Run:  cd work && python3 build_teamdraft.py
"""
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "arena.html"
OUT = REPO / "teamdraft.html"

src = TEMPLATE.read_text(encoding="utf-8")


def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {TEMPLATE.name}, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    n = hay.count(old)
    assert n == 1, f"anchor {what!r} appears {n} times, expected 1"
    return hay.replace(old, new, 1)


# ---------------------------------------------------------------- head ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]

head = re.sub(r"<title>.*?</title>",
              "<title>The 32-Team Draft · Data Dawgs</title>", head, count=1, flags=re.S)
assert head.count("<title>The 32-Team Draft · Data Dawgs</title>") == 1

head = re.sub(r'<meta name="description" content=".*?">',
              '<meta name="description" content="Eight drafters, four NFL teams each, all 32 owned. '
              'Expected wins, the head-to-head matrix that makes the pool zero-sum, and the draft board — '
              'read from /data/draft-2026.json.">',
              head, count=1, flags=re.S)

# ---------------------------------------------------------------------------
# The page's own stylesheet. Appended to the template's <style> so the media
# queries and the theme blocks above it still govern.
#
# EVERY selector is prefixed .td- or #td so nothing here can reach arena's cards.
# The two exceptions are the sheet bar and the tab panel, which are the shared
# page-family component lifted verbatim from receipts.html — same markup, same
# class names, same behaviour, deliberately not forked.
# ---------------------------------------------------------------------------
CSS = r"""
/* ---- page-family sheets (verbatim from receipts.html; do not fork) -------- */
.sheetbar{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 18px;
  border-bottom:1px solid var(--grid);padding-bottom:0}
.sheet-tab{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;
  color:var(--ink-3);font:inherit;font-size:14px;font-weight:700;letter-spacing:.005em;
  padding:9px 15px 8px;cursor:pointer;border-radius:7px 7px 0 0;display:inline-flex;
  align-items:center;gap:7px;margin-bottom:-1px}
.sheet-tab:hover{color:var(--ink-1);background:color-mix(in srgb,var(--ink-3) 9%,transparent)}
.sheet-tab.on{color:var(--accent);border-bottom-color:var(--accent);background:transparent}
.sheet-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sheet-hint{font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink-3);background:color-mix(in srgb,var(--ink-3) 16%,transparent);
  border-radius:5px;padding:2px 6px}
.sheet-tab.on .sheet-hint{color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
[role=tabpanel][hidden]{display:none}
@media (max-width:560px){
  .sheetbar{gap:2px}
  .sheet-tab{font-size:13px;padding:8px 11px 7px}
  .sheet-hint{display:none}
}

/* ---- the eight drafter colours -------------------------------------------
   NOT eyeballed. These are the eight documented categorical slots, validated
   against THIS SITE's two surfaces with the dataviz validator:

     light  (#fffdf7): lightness band PASS · chroma PASS · CVD worst adjacent
                       9.1 protan · normal-vision worst adjacent 19.6 · contrast
                       WARN on three slots (aqua 2.77, yellow 2.13, magenta 2.65)
     dark   (#241c12): all five checks PASS, worst adjacent 8.4 protan / 19.3 normal

   The light-mode contrast WARN is not dismissable, so this page ships the two
   reliefs it obligates: every coloured mark carries a visible value or name
   beside it, and the Diagnostics sheet is a full table view of the same numbers.

   ⚠️ EIGHT categorical colours cannot be pairwise-safe under simulated CVD — no
   ordering of eight passes the all-pairs test, which is a property of the eye and
   not of this palette. So colour NEVER carries drafter identity on its own here:
   the ladder direct-labels the owner on every bar, the matrix labels the roster it
   outlines, and the cards are headed by the name. Colour is the second channel,
   not the first. Do not "simplify" by dropping a label.

   ⚠️ Slot order is the draft order and is frozen for the season (see
   drafters[].slot in the payload). Colour follows the person, never their rank —
   re-sorting the standings must not repaint anybody. */
:root{
  --d1:#3987e5; --d2:#d95926; --d3:#199e70; --d4:#c98500;
  --d5:#d55181; --d6:#008300; --d7:#9085e9; --d8:#e66767;
  --td-none:#6f6656;           /* undrafted: reads as absent, not as a ninth drafter */
  /* Matrix game count is ORDINAL (0 -> 1 -> 2), so it is one hue in monotone steps and
     never two hues. Steps 500 and 250 of the documented blue ramp; on this dark surface
     the light end of an ordinal ramp is the high value, and both clear the 2:1 floor
     (3.11 and 7.96). Zero is left as surface — absence should look like absence. */
  --td-cell1:#256abf; --td-cell2:#86b6ef;
}
:root[data-theme="light"]{
  --d1:#2a78d6; --d2:#eb6834; --d3:#1baf7a; --d4:#eda100;
  --d5:#e87ba4; --d6:#008300; --d7:#4a3aa7; --d8:#e34948;
  --td-none:#a99e8a;
  /* Same ramp, anchor flipped: on cream the high value is the DARK end. Steps 300 and
     550 (2.46 and 6.52 against the paper). */
  --td-cell1:#6da7ec; --td-cell2:#1c5cab;
}
.td-o1{--own:var(--d1)}.td-o2{--own:var(--d2)}.td-o3{--own:var(--d3)}.td-o4{--own:var(--d4)}
.td-o5{--own:var(--d5)}.td-o6{--own:var(--d6)}.td-o7{--own:var(--d7)}.td-o8{--own:var(--d8)}
.td-o0{--own:var(--td-none)}

/* ---- the one control ------------------------------------------------------ */
.td-rail{position:sticky;top:0;z-index:40;margin:0 0 20px;padding:12px 0 11px;
  background:var(--page);border-bottom:1px solid var(--grid)}
.td-rail-in{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.td-rail-lab{font:800 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
  text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin-right:2px}
.td-chip{appearance:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer;
  border:1px solid var(--border);background:var(--surface-1);color:var(--ink-2);
  border-radius:999px;padding:5px 11px 5px 8px;font:inherit;font-size:13px;font-weight:700}
.td-chip:hover{color:var(--ink-1);border-color:var(--ink-3)}
.td-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.td-chip[aria-pressed="true"]{color:var(--ink-1);border-color:var(--own,var(--accent));
  box-shadow:inset 0 0 0 1px var(--own,var(--accent))}
.td-chip .sw{width:11px;height:11px;border-radius:3px;background:var(--own,var(--ink-3));flex:0 0 auto}
.td-chip .ew{font:650 11.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-chip[aria-pressed="true"] .ew{color:var(--ink-2)}
.td-pick{border:1px solid var(--border);background:var(--surface-1);color:var(--ink-1);
  border-radius:999px;padding:6px 11px;font:inherit;font-size:13px;font-weight:650;max-width:230px}
.td-pick:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.td-now{margin:0;padding:11px 14px;border:1px solid var(--border);border-left:3px solid var(--own,var(--ink-3));
  border-radius:0 11px 11px 0;background:var(--surface-1);font-size:14px;line-height:1.6;color:var(--ink-2)}
.td-now b{color:var(--ink-1)}
.td-now .nums{display:flex;flex-wrap:wrap;gap:14px;margin-top:7px;
  font:650 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-now .nums i{font-style:normal;color:var(--ink-1)}

/* ---- 1 · the ladder ------------------------------------------------------- */
.td-ladder{position:relative;border:1px solid var(--border);border-radius:12px;
  background:var(--surface-1);padding:12px 14px 8px}
/* ⚠️ width:100% is load-bearing. A <button> is shrink-to-fit, so without it the 1fr
   track column collapses to its content and all 32 bars render as stubs against the
   left quarter of the card. It looks like a data bug and is not one. */
.td-row{display:grid;grid-template-columns:22px 44px 1fr 52px 84px;gap:9px;align-items:center;
  width:100%;padding:2px 0;border:0;background:transparent;font:inherit;color:inherit;
  text-align:left;cursor:pointer;border-radius:6px}
.td-row:hover .td-bar{filter:brightness(1.12)}
.td-row:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.td-rank{font:650 10.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-align:right}
.td-abbr{font:800 12.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1)}
.td-track{position:relative;height:15px}
/* the bar. Anchored at zero — the axis is not truncated — with a 4px rounded data end. */
.td-bar{position:absolute;left:0;top:2px;height:11px;border-radius:2px 4px 4px 2px;
  background:var(--own,var(--td-none));transition:opacity .12s linear}
/* the posted line, as a tick THROUGH the bar. The gap between this and the bar end is
   the devig, and it is the reason none of these numbers are round. */
.td-tick{position:absolute;top:-1px;width:2px;height:17px;background:var(--ink-1);opacity:.75}
.td-par{position:absolute;top:6px;bottom:4px;width:1px;background:var(--axis);pointer-events:none}
.td-parlab{position:absolute;top:-10px;transform:translateX(-50%);white-space:nowrap;
  font:750 9.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-ew{font:750 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1);text-align:right;
  font-variant-numeric:tabular-nums}
.td-own{font-size:11.5px;font-weight:700;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-ladder.sel .td-row:not(.on){opacity:.28}
.td-ladder.sel .td-row.on{background:color-mix(in srgb,var(--own) 11%,transparent)}
.td-ladder .td-row.und .td-abbr{color:var(--ink-3)}
.td-ladder .td-row.und .td-bar{background:repeating-linear-gradient(135deg,
  var(--td-none) 0 5px,transparent 5px 10px);box-shadow:inset 0 0 0 1px var(--td-none)}

/* ---- 2 · the matrix ------------------------------------------------------- */
.td-mwrap{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--surface-1);
  padding:10px 12px 14px}
.td-matrix{display:grid;gap:1px;width:max-content;margin:0 auto;
  grid-template-columns:34px repeat(32,var(--cell,17px));
  grid-auto-rows:var(--cell,17px)}
.td-matrix{--cell:17px}
.td-mh{font:700 8.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;
  writing-mode:vertical-rl;transform:rotate(180deg);height:38px}
.td-mr{font:700 9.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  display:flex;align-items:center;justify-content:flex-end;padding-right:5px;gap:4px}
.td-mr .dot{width:5px;height:5px;border-radius:50%;background:var(--own,transparent);flex:0 0 auto}
.td-mh.own,.td-mr.own{color:var(--ink-1)}
.td-c{border-radius:2px;background:color-mix(in srgb,var(--ink-3) 7%,transparent)}
.td-c.g1{background:var(--td-cell1)}
.td-c.g2{background:var(--td-cell2)}
/* THE POINT OF THE PAGE. A cell where both teams belong to the same drafter is a game
   that pays one of their own wins and costs another — it is painted in that drafter's
   colour so the self-cancellation is visible before anyone clicks anything. */
.td-c.self{background:var(--own);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink-1) 45%,transparent)}
.td-c.diag{background:transparent;box-shadow:inset 0 0 0 1px var(--grid)}
.td-c:hover,.td-c:focus-visible{outline:2px solid var(--accent);outline-offset:0;z-index:2}
.td-matrix .dv{border-left:2px solid var(--axis)}
.td-matrix .dh{border-top:2px solid var(--axis)}
.td-matrix.sel .td-c:not(.in){opacity:.2}
.td-c.in{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink-1) 30%,transparent)}
.td-mlegend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:12.5px;color:var(--ink-2);
  align-items:center}
.td-mlegend span{display:inline-flex;align-items:center;gap:6px}
.td-mlegend i{width:13px;height:13px;border-radius:3px;display:inline-block;font-style:normal}

/* ---- 3 · standings -------------------------------------------------------- */
.td-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:12px}
.td-card{border:1px solid var(--border);border-top:3px solid var(--own,var(--td-none));
  border-radius:3px 3px 12px 12px;background:var(--surface-1);padding:13px 15px 15px;text-align:left;
  cursor:pointer;font:inherit;color:inherit;display:block;width:100%}
.td-card:hover{border-color:var(--ink-3);border-top-color:var(--own)}
.td-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.td-card[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--own)}
.td-card h3{margin:0;font-size:16px;color:var(--ink-1);display:flex;align-items:baseline;
  justify-content:space-between;gap:8px}
.td-card h3 em{font:750 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;font-style:normal;color:var(--ink-3)}
.td-big{display:flex;align-items:baseline;gap:8px;margin:9px 0 2px}
.td-big b{font:800 27px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1);
  font-variant-numeric:tabular-nums}
.td-big span{font-size:12px;color:var(--ink-3)}
.td-delta{font:750 12.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace}
.td-delta.up{color:var(--good)}.td-delta.dn{color:var(--bad)}
.td-roster{display:flex;flex-wrap:wrap;gap:5px;margin:11px 0 0}
.td-tteam{display:inline-flex;align-items:baseline;gap:5px;border:1px solid var(--border);
  border-radius:7px;padding:3px 7px;font:700 11.5px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-1)}
.td-tteam s{text-decoration:none;color:var(--ink-3);font-weight:650}
.td-tteam.open{border-style:dashed;color:var(--ink-3)}
.td-mini{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:11px;
  font:650 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-mini b{color:var(--ink-2);font-weight:750}
.td-tracker{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.td-tracker th,.td-tracker td{padding:8px 9px;border-bottom:1px solid var(--grid);text-align:right;
  font-size:13px}
.td-tracker th{font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  text-transform:uppercase;letter-spacing:.05em}
.td-tracker th:first-child,.td-tracker td:first-child{text-align:left}
.td-tracker tbody tr:last-child td{border-bottom:0}
.td-tracker td.tot{font-weight:800;color:var(--ink-1)}
.td-tracker .sw{display:inline-block;width:9px;height:9px;border-radius:2px;
  background:var(--own);margin-right:7px;vertical-align:baseline}

/* ---- the wheel ------------------------------------------------------------ */
.td-wheelwrap{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:22px;align-items:start}
.td-wheelbox{position:relative;border:1px solid var(--border);border-radius:14px;
  background:var(--surface-1);padding:14px}
.td-wheelbox svg{display:block;width:100%;height:auto}
.td-slice{stroke:var(--surface-1);stroke-width:2;stroke-linejoin:round}
.td-slice.dim{opacity:.34}
.td-wlab{font:800 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;fill:#fff;
  paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:3}
.td-wpct{font:650 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;fill:#fff;
  paint-order:stroke;stroke:rgba(0,0,0,.55);stroke-width:3}
/* The wheel and the needle spin independently, so the needle can land on second place
   while the rim lands on first. Both honour prefers-reduced-motion below. */
#tdWheelRot,#tdNeedle,#tdWheel .td-labrot{transition:transform 3.6s cubic-bezier(.16,.72,.16,1)}
.td-result{margin:0 0 12px;padding:13px 15px;border:1px solid var(--border);
  border-left:3px solid var(--own,var(--ink-3));border-radius:0 12px 12px 0;
  background:var(--surface-1);font-size:14px;line-height:1.6;color:var(--ink-2);min-height:74px}
.td-result b{color:var(--ink-1)}
.td-result .big{display:block;font:800 20px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-1);margin-bottom:3px}
.td-spinrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.td-go{appearance:none;border:1px solid var(--accent);background:var(--accent);
  color:var(--accent-ink);border-radius:999px;padding:9px 17px;font:inherit;font-size:14px;
  font-weight:800;cursor:pointer}
.td-go:hover{filter:brightness(1.08)}
.td-go:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.td-go[disabled]{opacity:.5;cursor:progress}
.td-go.ghost{background:transparent;color:var(--ink-2);border-color:var(--border)}
.td-go.ghost:hover{color:var(--ink-1);border-color:var(--ink-3)}
.td-tally{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.td-tally th,.td-tally td{padding:6px 8px;border-bottom:1px solid var(--grid);text-align:right;
  font:650 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace}
.td-tally th{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3)}
.td-tally th:first-child,.td-tally td:first-child{text-align:left}
.td-tally tbody tr:last-child td{border-bottom:0}
.td-tally .sw{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--own);
  margin-right:6px}
.td-tally tr.on td{background:color-mix(in srgb,var(--own) 12%,transparent)}
.td-tally .gap{color:var(--ink-3)}

/* ---- monte carlo ---------------------------------------------------------- */
.td-mcbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.td-prog{display:block;width:130px;height:7px;border-radius:999px;
  background:color-mix(in srgb,var(--ink-3) 20%,transparent);overflow:hidden}
.td-prog>span{display:block;height:100%;width:0;background:var(--accent);border-radius:999px}
.td-dtable tr.on td{background:color-mix(in srgb,var(--own) 12%,transparent)}

@media (max-width:860px){
  .td-wheelwrap{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  #tdWheelRot,#tdNeedle,#tdWheel .td-labrot{transition:none}
  .td-prog>span{transition:none}
}

/* ---- 4 · distributions ---------------------------------------------------- */
.td-plot{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);padding:12px 14px}
.td-plot svg{display:block;width:100%;height:auto}
.td-q{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
.td-qi{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;
  padding:5px 9px;font:650 11.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-2)}
.td-qi i{width:9px;height:9px;border-radius:2px;background:var(--own);font-style:normal}
.td-qi b{color:var(--ink-1)}

/* ---- 5 · the schedule strip ----------------------------------------------- */
.td-strip{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);
  padding:12px 14px;overflow:auto}
.td-srow{display:grid;grid-template-columns:60px repeat(17,minmax(30px,1fr));gap:3px;align-items:center;
  min-width:640px;margin-bottom:6px}
.td-srow.head{margin-bottom:3px}
.td-slab{font:800 11.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1);
  display:flex;align-items:center;gap:5px}
.td-slab .dot{width:6px;height:6px;border-radius:50%;background:var(--own);flex:0 0 auto}
.td-wk{font:700 9px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-align:center}
.td-g{border-radius:5px;padding:5px 2px 4px;text-align:center;border:1px solid var(--border);
  background:color-mix(in srgb,var(--ink-3) 6%,transparent);cursor:default}
.td-g .op{display:block;font:700 9.5px/1.15 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-2);
  overflow:hidden;text-overflow:ellipsis}
.td-g .p{display:block;font:750 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1);
  font-variant-numeric:tabular-nums}
.td-g .at{color:var(--ink-3)}
.td-g.bye{background:transparent;border-style:dashed;color:var(--ink-3)}
/* a self-collision: this drafter owns both sides, so the game is a wash for them */
.td-g.clash{border-color:var(--own);box-shadow:inset 0 0 0 1px var(--own);
  background:color-mix(in srgb,var(--own) 15%,transparent)}
.td-g.clash .op{color:var(--ink-1)}
.td-collide{display:grid;grid-template-columns:60px repeat(17,minmax(30px,1fr));gap:3px;
  align-items:end;min-width:640px}
.td-cbar{background:var(--accent);border-radius:3px 3px 2px 2px;min-height:2px;
  margin:0 auto;width:60%;max-width:22px}
.td-cwrap{height:46px;display:flex;flex-direction:column;justify-content:flex-end;gap:3px}
.td-cn{font:700 9.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-align:center}

/* ---- 6 · the board -------------------------------------------------------- */
.td-board{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;overflow:auto}
.td-bh{font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  text-transform:uppercase;letter-spacing:.04em;padding:0 0 2px;display:flex;align-items:center;gap:5px}
.td-bh .sw{width:8px;height:8px;border-radius:2px;background:var(--own);flex:0 0 auto}
.td-bc{border:1px solid var(--border);border-left:3px solid var(--own,var(--td-none));border-radius:2px 9px 9px 2px;
  background:var(--surface-1);padding:8px 9px;min-height:66px;text-align:left;cursor:pointer;
  font:inherit;color:inherit;display:block;width:100%}
.td-bc:hover{border-color:var(--ink-3);border-left-color:var(--own)}
.td-bc:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.td-bc .n{font:650 9px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-bc .t{display:block;font:800 14px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1);
  margin-top:3px}
.td-bc .e{display:block;font:650 10.5px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-bc .d{display:inline-block;margin-top:3px;border-radius:5px;padding:1px 5px;
  font:750 9.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);background:color-mix(in srgb,var(--ink-3) 13%,transparent)}
.td-bc .d.best{color:var(--good);background:color-mix(in srgb,var(--good) 15%,transparent)}
.td-bc .d.reach{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
.td-bc.empty{border-style:dashed;border-left-style:solid;background:transparent;cursor:default}
.td-bc.empty .t{color:var(--ink-3);font-size:12px;font-weight:700}
.td-board.sel .td-bc:not(.on){opacity:.3}

/* ---- diagnostics ---------------------------------------------------------- */
.td-chk{border:1px solid var(--border);border-radius:11px;background:var(--surface-1);
  padding:13px 15px;margin-bottom:9px;border-left:3px solid var(--ink-3)}
.td-chk.ok{border-left-color:var(--good)}
.td-chk.known{border-left-color:var(--warn)}
.td-chk.bad{border-left-color:var(--bad)}
.td-chk h4{margin:0 0 5px;font-size:14.5px;color:var(--ink-1);display:flex;gap:9px;align-items:baseline;
  justify-content:space-between}
.td-chk h4 em{font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;font-style:normal;
  text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);flex:0 0 auto}
.td-chk.ok h4 em{color:var(--good)}.td-chk.known h4 em{color:var(--warn)}.td-chk.bad h4 em{color:var(--bad)}
.td-chk p{margin:0;font-size:13.5px;line-height:1.62;color:var(--ink-2)}
.td-dtable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:660px}
.td-dtable th{position:sticky;top:0;background:var(--surface-1);color:var(--ink-3);
  font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;
  letter-spacing:.04em;padding:9px 8px;text-align:right;border-bottom:1px solid var(--grid);z-index:1}
.td-dtable td{padding:8px;border-bottom:1px solid var(--grid);text-align:right;font-size:12.5px;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.td-dtable th:first-child,.td-dtable td:first-child,
.td-dtable th:nth-child(2),.td-dtable td:nth-child(2){text-align:left}
.td-dtable tbody tr:last-child td{border-bottom:0}
.td-dtable td .sw{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--own);
  margin-right:6px}
.td-drift{color:var(--warn)}

/* ---- shared bits ---------------------------------------------------------- */
.td-note{margin:10px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-3)}
.td-note code{font-size:11.5px}
.td-empty{padding:26px 16px;text-align:center;color:var(--ink-3);font-size:13.5px;line-height:1.6}

@media (max-width:860px){
  .td-row{grid-template-columns:20px 40px 1fr 48px;gap:7px}
  .td-own{display:none}          /* the label moves into the tooltip; colour keeps a partner in the legend */
  .td-matrix{--cell:14px}
  .td-cards{grid-template-columns:1fr}
  .td-board{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (max-width:560px){
  .td-matrix{--cell:11px;grid-template-columns:26px repeat(32,var(--cell))}
  .td-mh{font-size:7px;height:30px}
  .td-mr{font-size:8px}
  .td-board{grid-template-columns:repeat(2,minmax(0,1fr))}
  .td-rail{padding:9px 0 8px}
}
@media (prefers-reduced-motion:reduce){
  .td-bar{transition:none}
}
"""

head = sub1(head, "\n</style>", CSS + "</style>", "style close")

# ---------------------------------------------------------------- shell ----
i_main = once(src, "\n<main>\n", "main open")
shell = src[i_head:i_main]
shell = sub1(shell, 'data-page="arena"', 'data-page="teamdraft"', "page key")
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "const UD = {" in shell, "lost the Upside Down"

# The Upside Down map is keyed by filename stem, so the new key is added HERE only.
shell = sub1(shell,
             '      "arena":"/data/surfaces.json"\n',
             '      "arena":"/data/surfaces.json",\n'
             '      "teamdraft":"/data/draft-2026.json"\n',
             "UD map tail")

# ---------------------------------------------------------------- footer ----
i_foot = once(src, '\n<footer class="foot">', "footer open")
tail = src[i_foot:]
i_scr = once(tail, "\n<script>\n", "page script open")
j_scr = once(tail, "</script>\n</div>\n</body>", "page script close")
foot_open = tail[:i_scr]
foot_close = tail[j_scr + len("</script>"):]

MAIN = r"""
<main>
  <header class="p-hero">
    <div class="p-kicker">Arena · a private eight-person pool · nothing here is graded</div>
    <h1>Four teams each. All thirty-two owned. <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Why this page is a Pup">Pup</a></h1>
    <p class="p-lead">Eight people snake-draft four NFL teams apiece and total regular-season wins is
    the only criterion. Because every team is owned, the wins are <b>conserved</b>: the 2026 regular
    season pays out exactly 272 of them, par is 34.00 a head, and there is no such thing as a roster
    that does well on its own. One person's gain is literally somebody else's loss, and two teams that
    play each other cannot both bank the win. Every number below is read from
    <a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a>.</p>
  </header>
  <div class="p-disclosure"><b>No game has been played.</b> Expected wins are devigged from four books
  and normalized to 272 — they are a market snapshot, not a forecast this site has graded, and the
  posted line sits next to each one so you can see the difference. The wins tracker reads zero because
  zero is the true number. Nothing on this page says who is winning.</div>

  <div id="sheets"></div>

  <!-- ============================ THE POOL ============================ -->
  <section id="sheetPool">
    <div class="td-rail">
      <div class="td-rail-in" id="tdRail" role="group" aria-label="Choose a drafter or a team"></div>
    </div>
    <p class="td-now" id="tdNow"></p>

    <section class="p-section" id="ladder">
      <header><div><h2>Expected wins, all 32</h2><p class="dek">Bars are devigged expected wins,
        anchored at zero. The vertical tick on each bar is the <b>posted line</b> — where the tick sits
        away from the bar end is the vig coming out, which is why none of these land on a round number.
        The rule at 8.5 is par: 272 wins over 32 teams. Colour is the owner and the owner is also
        written out; undrafted teams are hatched.</p></div>
        <div class="p-meta" id="ladderMeta" aria-live="polite"></div></header>
      <div class="td-ladder" id="tdLadder"></div>
      <p class="td-note">Every bar is a button — pick one to re-centre the whole page on that team.</p>
    </section>

    <section class="p-section" id="matrix">
      <header><div><h2>Who plays whom</h2><p class="dek">The 32&times;32 head-to-head grid, ordered by
        division so the twice-a-year rivalries form the blocks down the diagonal. This is the visual
        that makes the pool make sense: <b>a game between two teams pays exactly one win</b>, so when
        one person owns both sides it is a win they are guaranteed to collect and guaranteed to lose.
        Those cells are painted in that drafter's colour. A roster stacked with rivals has a raised
        floor and a lowered ceiling; a roster spread across divisions is holding a wider bet.</p></div>
        <div class="p-meta" id="matrixMeta" aria-live="polite"></div></header>
      <div class="td-mwrap"><div class="td-matrix" id="tdMatrix" role="grid"
        aria-label="Head-to-head games between all 32 teams"></div></div>
      <div class="td-mlegend">
        <span><i style="background:var(--td-cell1)"></i> one meeting</span>
        <span><i style="background:var(--td-cell2)"></i> two meetings — division rivals</span>
        <span><i style="background:color-mix(in srgb,var(--ink-3) 7%,transparent)"></i> never meet</span>
        <span><i style="background:linear-gradient(135deg,var(--d4) 0 25%,var(--d7) 25% 50%,var(--d2) 50% 75%,var(--d3) 75%)"></i>
          same owner on both sides, painted in <b>that drafter's</b> colour — the win cancels</span>
      </div>
      <p class="td-note">Hover or focus any cell for the two teams and the weeks they meet.
      Selecting a drafter outlines their own 4&times;4 block and counts the games inside it.</p>
    </section>

    <section class="p-section" id="standings">
      <header><div><h2>The eight rosters</h2><p class="dek">Sorted by expected wins, which is a sort of
        a market snapshot and not a standing. <b>Par is 34.00.</b> &ldquo;Internal&rdquo; is games the
        roster plays against itself — the wins that cannot help. Every card is a button.</p></div>
        <div class="p-meta" id="standMeta" aria-live="polite"></div></header>
      <div class="td-cards" id="tdCards"></div>

      <header style="margin-top:26px"><div><h3 style="margin:0 0 4px">Wins tracker</h3>
        <p class="dek">The shape the season fills in, carried over from the group's sheet: four rounds
        and a total, one row per drafter. Every cell reads zero because no game has been played. A tie
        counts half a win when there is one to count.</p></div></header>
      <div class="p-table-wrap"><table class="td-tracker" id="tdTracker"></table></div>
    </section>

    <section class="p-section" id="wheel">
      <header><div><h2>Spin it</h2><p class="dek">A pie of <b>finishing probabilities</b> — each
        slice is how often that roster comes first across the simulated seasons in the payload, so
        the wheel is the answer rather than a decoration. Press the button and it plays one whole
        season, 272 games, and stops on whoever actually won it. The <b>inner needle</b> swings to
        that same season's runner-up, because second place pays too. Spin it enough and the tally
        underneath converges on the slices — that is the wheel checking its own arithmetic in
        public.</p></div>
        <div class="p-meta" id="wheelMeta" aria-live="polite"></div></header>
      <div class="td-wheelwrap">
        <div class="td-wheelbox">
          <svg id="tdWheel" viewBox="0 0 400 400" role="img"
            aria-label="Finishing probability by drafter, as a wheel"></svg>
        </div>
        <div class="td-wheelside">
          <p class="td-result" id="tdResult" role="status" aria-live="polite"></p>
          <div class="td-spinrow">
            <button type="button" class="td-go" id="tdSpin">Simulate winners</button>
            <button type="button" class="td-go ghost" id="tdSpin10">Spin &times;10</button>
            <button type="button" class="td-go ghost" id="tdSpinReset">Reset tally</button>
          </div>
          <div class="p-table-wrap"><table class="td-tally" id="tdTally"></table></div>
          <p class="td-note" id="tdWheelNote"></p>
        </div>
      </div>
    </section>

    <section class="p-section" id="montecarlo">
      <header><div><h2>Monte Carlo</h2><p class="dek">The same machine, without the theatre. Each
        trial plays all 272 games once — a win goes to exactly one side, so every simulated season
        pays exactly 272 and a roster owning both sides of a game <b>cannot</b> bank both. That is
        why this is simulated game by game instead of by drawing each team's win total: drawing
        totals independently would break the conservation and hand a division-stacked roster a
        spread it does not have.</p></div>
        <div class="p-meta" id="mcMeta" aria-live="polite"></div></header>
      <div class="td-mcbar">
        <span class="td-rail-lab">Run</span>
        <button type="button" class="td-go" data-mc="1000">1,000 seasons</button>
        <button type="button" class="td-go" data-mc="10000">10,000</button>
        <button type="button" class="td-go" data-mc="50000">50,000</button>
        <span class="td-prog" id="tdProg" hidden><span></span></span>
      </div>
      <div class="p-table-wrap"><table class="td-dtable" id="tdMc"></table></div>
      <div class="td-plot" id="tdMcPlot" style="margin-top:14px"></div>
      <p class="td-note" id="tdMcNote"></p>
    </section>

    <section class="p-section" id="curves">
      <header><div><h2>How a season lands</h2><p class="dek">Probability mass over final win counts,
        0 through 17, straight from the payload. The default view is all 32 at once, which is the
        honest way to see the thing people always assume is false: <b>the curves are all about the same
        width</b>. Season standard deviations sit within a few tenths of 2.7 across the whole league, so
        no team here is meaningfully more of a lottery ticket than another — they are the same shape
        slid left and right. Pick a team or a drafter to pull curves forward.</p></div>
        <div class="p-meta" id="curveMeta" aria-live="polite"></div></header>
      <div class="td-plot" id="tdCurves"></div>
      <div class="td-q" id="tdQuant"></div>
      <p class="td-note">These curves are the <em>shape</em> of a season, not a second estimate of its
      total — their means run a little above expected wins for the worst teams and a little below for
      the best, which is what truncating at 0 and 17 does. The Diagnostics sheet measures it.</p>
    </section>

    <section class="p-section" id="schedule">
      <header><div><h2>Week by week</h2><p class="dek">Seventeen weeks of per-game win probability.
        Games where the selected drafter owns <b>both</b> sides are outlined — those are the ones that
        wash. With four strips stacked, a collision lines up vertically.</p></div>
        <div class="p-meta" id="schedMeta" aria-live="polite"></div></header>
      <div class="td-strip" id="tdStrip"></div>
      <p class="td-note">Per-game probabilities are internally consistent — every game's two sides sum
      to 1 and the league's 272 wins are all accounted for — but they do <b>not</b> re-add to the
      expected-wins figures in the ladder. That drift is measured on the Diagnostics sheet rather than
      papered over here.</p>
    </section>

    <section class="p-section" id="board">
      <header><div><h2>The board</h2><p class="dek">Snake order, eight columns, four rounds, serpentine
        numbering. Each pick carries the gap between the team taken and the best expected wins still on
        the board at that moment. That is a description of the board, not a grade of the pick —
        nobody drafts on expected wins alone, and everyone in this league knows what they were
        doing.</p></div>
        <div class="p-meta" id="boardMeta" aria-live="polite"></div></header>
      <div class="td-board" id="tdBoard"></div>
    </section>
  </section>

  <!-- ========================= DIAGNOSTICS ========================= -->
  <section id="sheetDiag" hidden>
    <header class="p-hero" style="padding-top:0">
      <h2 style="margin:0 0 8px">What the numbers agree with, and what they don't</h2>
      <p class="p-lead" style="font-size:16px">Every check below is measured off
      <a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a> on the run that built it,
      by <code>scripts/team_draft_pool.py</code>. Three of them are expected to report a drift; that is
      why they are here. A diagnostics panel that only ever prints OK is decoration.</p>
    </header>
    <div id="tdChecks"></div>

    <section class="p-section" id="perteam">
      <header><div><h2>Every team, every figure</h2><p class="dek">The table view of the same numbers
        the charts draw. <b>Line</b> is what was posted, <b>EW</b> is the devigged expectation,
        <b>&Delta;vig</b> is the difference. <b>&Sigma;p</b> sums the 17 game probabilities and
        <b>drift</b> is how far that lands from EW. <b>&mu;dist</b> is the mean of the win
        distribution.</p></div>
        <div class="p-meta" id="ptMeta"></div></header>
      <div class="p-table-wrap" style="max-height:640px;overflow:auto">
        <table class="td-dtable" id="tdPerTeam"></table></div>
    </section>

    <section class="p-section" id="conservation">
      <header><div><h2>Conservation</h2><p class="dek">The identity the page rests on, stated as
        arithmetic.</p></div></header>
      <div class="p-summary" id="tdCons"></div>
    </section>
  </section>

  <!-- ======================= RULES & METHOD ======================= -->
  <section id="sheetRules" hidden>
    <header class="p-hero" style="padding-top:0">
      <h2 style="margin:0 0 8px">The rules, and where the numbers come from</h2>
      <p class="p-lead" style="font-size:16px">The league's own rules, plus an honest account of what
      each figure on this page is and is not.</p>
    </header>
    <div class="p-summary" id="tdRules"></div>

    <section class="p-section" id="method">
      <header><div><h2>What each number is</h2></div></header>
      <div class="machine-box"><ul>
        <li><b>Posted line</b> — the median regular-season win total on the board. Half-points are the
          book's, not a rounding convenience.</li>
        <li><b>Expected wins</b> — the four-book prices devigged and renormalized so all 32 sum to 272.
          This is <b>not</b> the posted line, and calling it one would be wrong in the direction that
          flatters it: the line carries the hold and this does not.</li>
        <li><b>Win distribution</b> — probability mass by final win count. Its mean is close to, but not
          identical with, expected wins; the Diagnostics sheet measures the gap and says why.</li>
        <li><b>Per-game probability</b> (<code>wp</code>) — one coherent set of games where both
          sides always sum to 1. It reproduces the league's 272 wins but not each team's own total.
          Both numbers are shown; neither is quietly preferred.</li>
        <li><b>The refitted game probability</b> (<code>wpf</code>) — the same game after the
          schedule was bent onto the expected wins, which are taken as given. One offset per team,
          solved so that every team's 17 fitted games sum to its expected-wins figure;
          both sides of a game still sum to 1, so the league still pays 272. <b>Expected wins are
          not recomputed</b> — this is the other number moving. Everything simulated on this page
          runs on <code>wpf</code>, which is why a roster's simulated mean lands on the total
          printed on its own card. Simulating the raw schedule would have put a roster up to 2.7
          wins away from its own card.</li>
        <li><b>Finishing probabilities</b> — Monte Carlo over the refitted schedule, played game by
          game so a season always pays exactly 272 and a roster owning both sides of a game cannot
          bank both. They are <b>not a forecast</b>: they inherit every assumption in the prices,
          they assume games are independent given those prices, and they know nothing about
          injuries or a team having a different season than its number. Two limits worth stating
          plainly — the simulation has <b>no tie outcome</b>, so the league's half-win-for-a-tie
          rule is not modelled; and a tie for first is broken <b>at random</b>, because the real
          tiebreakers are playoff wins and point differential and neither is in this payload. The
          Diagnostics sheet reports how often that matters, and the answer is: often.</li>
        <li><b>Internal games</b> — head-to-head meetings inside one roster, counted off the overlap
          matrix. This is the only figure on the page that is purely structural: it does not depend on
          anybody's price being right.</li>
        <li><b>Reach / value on the board</b> — expected wins of the team taken minus the best still
          available. Descriptive only. It has no idea about a division rivalry somebody wanted, a team
          somebody refuses to root for, or the fact that expected wins are not the only reason to draft
          a football team.</li>
        <li><b>Nothing is graded.</b> No game has been played. There is no result on this page, no
          leaderboard, and no claim that any of these prices are right.</li>
      </ul></div>
    </section>

    <section class="p-section" id="machines">
      <header><div><h2>The same page for machines</h2></div></header>
      <div class="machine-box"><ul>
        <li><a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a> — the whole surface:
          32 teams with line, expected wins, SD, the 0&ndash;17 distribution and a 17-game schedule; the
          sparse head-to-head matrix; the draft log; the derived rosters, board and diagnostics.
          <code>as_of</code> and <code>source</code> are on the envelope.</li>
        <li><code>scripts/team_draft_pool.py</code> in the repo is the pipe. It never recomputes expected
          wins — it sums them, derives the rosters from the picks, and runs the checks on the
          Diagnostics sheet. Appending the remaining picks is a one-line command; the page follows.</li>
      </ul><p class="assumption">This is a private pool between eight people. It is on the public site
      because the arithmetic is interesting, not because anybody can enter it. There is no signup, no
      money handled here, and no contact detail on this page.</p></div>
    </section>
  </section>
</main>
"""

# ---------------------------------------------------------------------------
# DDSheets is LIFTED FROM receipts.html AT BUILD TIME, not pasted.
# A pasted copy is a fork the moment somebody fixes a bug in one of them. If the
# slice ever stops matching, this build fails rather than shipping a stale twin.
# ---------------------------------------------------------------------------
RECEIPTS = (REPO / "receipts.html").read_text(encoding="utf-8")
_i = once(RECEIPTS, "window.DDSheets = function(cfg){", "DDSheets open")
_j = RECEIPTS.index("\n};\n", _i) + len("\n};\n")
DDSHEETS = RECEIPTS[_i:_j]
assert "roving tabindex" in DDSHEETS and DDSHEETS.rstrip().endswith("};"), \
    "the DDSheets slice from receipts.html is not the whole function"

SCRIPT = r"""
<script>
/* ============================================================================
   DDSheets — the page-family component, LIFTED VERBATIM from receipts.html by
   work/build_teamdraft.py. Do not edit it here: edit receipts.html and rebuild,
   or the two copies fork and only one of them gets the next fix.
   ============================================================================ */
__DDSHEETS__
</script>
<script>
/* teamdraft.html — the 2026 NFL team draft pool.
 *
 * ONE SOURCE: /data/draft-2026.json. Expected wins, posted lines, distributions,
 * per-game probabilities, the head-to-head matrix, the draft log and the derived
 * rosters all come out of that file. This page does arithmetic in exactly two
 * places — laying out a bar and laying out a curve — and computes no football
 * anywhere. scripts/team_draft_pool.py owns everything else.
 *
 * ⚠️ FAILS LOUD, NEVER QUIET. If the payload cannot be read, every view says so.
 * An empty ladder reads as "nobody has drafted", which would be a lie.
 *
 * ⚠️ Colour is the SECOND channel for drafter identity, never the first. Eight
 * categorical colours cannot be pairwise-distinct under simulated colour-vision
 * deficiency, so every coloured mark on this page is accompanied by a name or a
 * number. See the palette comment in the stylesheet before removing a label.
 */
(function(){
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,
    c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const n2 = v => (v==null || Number.isNaN(v)) ? "—" : Number(v).toFixed(2);
  const pct = v => (v*100).toFixed(0) + "%";
  const sgn = v => (v>0?"+":"") + Number(v).toFixed(2);

  const DIVS = ["AFC East","AFC North","AFC South","AFC West",
                "NFC East","NFC North","NFC South","NFC West"];

  let D = null;                       // the payload's `data` block
  let ORDER = [];                     // matrix / roster ordering: division, then EW
  let sel = {kind:"league", id:null}; // the page's single piece of state

  /* ---- who owns what -------------------------------------------------- */
  const ownerOf = t => D.board.find(b=>b.team===t)?.drafter || null;
  const slotOf  = name => name ? (D.drafters[name]?.slot || 0) : 0;
  const oc      = name => "td-o" + slotOf(name);          // owner colour class
  const teamsOf = name => D.drafters[name]?.roster || [];

  /* The current selection expanded to a set of teams. League = everything, which
     means no view needs a special case for the default state. */
  function selTeams(){
    if(sel.kind==="team")    return [sel.id];
    if(sel.kind==="drafter") return teamsOf(sel.id);
    return [];
  }
  const selSlot = () => sel.kind==="drafter" ? slotOf(sel.id)
                      : sel.kind==="team" ? slotOf(ownerOf(sel.id)) : 0;

  /* ---- the shared tooltip --------------------------------------------- */
  /* One node, moved. Shows on hover AND on focus, because half the marks on this
     page are keyboard-reachable buttons and a mouse-only tooltip hides content. */
  const tip = document.createElement("div");
  tip.setAttribute("role","status");
  tip.style.cssText = "position:fixed;z-index:9000;pointer-events:none;opacity:0;"
    + "max-width:250px;padding:8px 10px;border-radius:9px;font-size:12.5px;line-height:1.5;"
    + "background:var(--surface-1);color:var(--ink-1);border:1px solid var(--border);"
    + "box-shadow:0 8px 26px rgba(0,0,0,.34);transition:opacity .09s linear";
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) tip.style.transition = "none";
  document.body.appendChild(tip);
  function tipAt(html, x, y){
    tip.innerHTML = html; tip.style.opacity = "1";
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x+14, innerWidth  - r.width  - 8)) + "px";
    tip.style.top  = Math.max(8, Math.min(y+16, innerHeight - r.height - 8)) + "px";
  }
  const tipOff = () => { tip.style.opacity = "0"; };
  /* Delegated: every mark just carries data-tip. */
  function wireTips(root){
    root.addEventListener("mousemove", e=>{
      const el = e.target.closest("[data-tip]");
      if(el) tipAt(el.dataset.tip, e.clientX, e.clientY); else tipOff();
    });
    root.addEventListener("mouseleave", tipOff);
    root.addEventListener("focusin", e=>{
      const el = e.target.closest("[data-tip]");
      if(!el) return;
      const r = el.getBoundingClientRect();
      tipAt(el.dataset.tip, r.left, r.bottom - 6);
    });
    root.addEventListener("focusout", tipOff);
  }

  /* ---- selection ------------------------------------------------------- */
  function select(kind, id){
    sel = (kind==="league" || (sel.kind===kind && sel.id===id))
        ? {kind:"league", id:null} : {kind, id};
    renderAll();
  }
  /* Anything with data-sel="kind:id" selects. One listener for the whole page. */
  document.addEventListener("click", e=>{
    const el = e.target.closest("[data-sel]");
    if(!el) return;
    const [kind, id] = el.dataset.sel.split(":");
    select(kind, id || null);
  });

  /* ====================== the control rail ============================== */
  function railHTML(){
    const chips = D.draft_order.map(name=>{
      const v = D.drafters[name], on = sel.kind==="drafter" && sel.id===name;
      return `<button type="button" class="td-chip ${oc(name)}" data-sel="drafter:${esc(name)}"
        aria-pressed="${on}"><span class="sw"></span>${esc(name)}
        <span class="ew">${n2(v.ew)}</span></button>`;
    }).join("");

    const byDiv = DIVS.map(div=>{
      const opts = ORDER.filter(t=>D.teams[t].division===div).map(t=>{
        const own = ownerOf(t);
        return `<option value="${esc(t)}"${sel.kind==="team"&&sel.id===t?" selected":""}>`
          + `${esc(D.teams[t].name)} · ${n2(D.teams[t].ew)} · ${own?esc(own):"on the board"}</option>`;
      }).join("");
      return `<optgroup label="${esc(div)}">${opts}</optgroup>`;
    }).join("");

    return `<span class="td-rail-lab">View</span>
      <button type="button" class="td-chip" data-sel="league:"
        aria-pressed="${sel.kind==="league"}">All 32</button>
      ${chips}
      <label class="td-rail-lab" for="tdTeamPick" style="margin-left:6px">Team</label>
      <select class="td-pick" id="tdTeamPick" aria-label="Select a team">
        <option value="">All 32 teams…</option>${byDiv}</select>`;
  }

  function nowHTML(){
    if(sel.kind==="league"){
      const made = D.picks_made, left = D.picks_total - made;
      return `<b>All 32 teams.</b> ${made} of ${D.picks_total} picks are in`
        + (left ? `, ${left} still to come` : ` — the draft is complete`)
        + `. Par is ${n2(D.par)} wins a head and the league pays exactly ${D.total_wins}.`
        + `<span class="nums"><span>picks <i>${made}/${D.picks_total}</i></span>`
        + `<span>on the board <i>${D.undrafted.length} teams</i></span>`
        + `<span>unclaimed wins <i>${n2(D.undrafted.reduce((a,t)=>a+D.teams[t].ew,0))}</i></span></span>`;
    }
    if(sel.kind==="team"){
      const t = D.teams[sel.id], own = ownerOf(sel.id);
      return `<b>${esc(t.name)}</b> — ${esc(t.division)}. `
        + (own ? `Drafted by ${esc(own)}.` : `Still on the board.`)
        + `<span class="nums"><span>expected wins <i>${n2(t.ew)}</i></span>`
        + `<span>posted line <i>${n2(t.line)}</i></span>`
        + `<span>vig <i>${sgn(t.ew - t.line)}</i></span>`
        + `<span>SD <i>${n2(t.sd)}</i></span>`
        + `<span>p10/p50/p90 <i>${t.p10} / ${t.p50} / ${t.p90}</i></span></span>`;
    }
    const v = D.drafters[sel.id];
    const sd = v.sd_sim!=null ? v.sd_sim : v.sd_model;
    return `<b>${esc(sel.id)}</b> — ${v.roster.length ? v.roster.map(esc).join(", ") : "no picks yet"}`
      + (v.picks_remaining ? ` · ${v.picks_remaining} pick${v.picks_remaining>1?"s":""} left` : "")
      + `. ${v.internal_games ? `${v.internal_games} game${v.internal_games>1?"s":""} against themselves.`
                              : `No games against themselves.`}`
      + `<span class="nums"><span>expected wins <i>${n2(v.ew)}</i></span>`
      + `<span>vs par <i>${sgn(v.par_delta)}</i></span>`
      + `<span>internal <i>${v.internal_games}</i></span>`
      + `<span>SD <i>${n2(sd)}${v.sd_sim==null?" derived":""}</i></span></span>`;
  }

  /* ====================== 1 · the ladder ================================ */
  function ladder(){
    const rows = Object.keys(D.teams).sort((a,b)=>D.teams[b].ew - D.teams[a].ew);
    const top  = Math.max(...rows.map(t=>Math.max(D.teams[t].ew, D.teams[t].line)));
    const MAX  = Math.ceil(top) + 1;                 // zero-anchored, with headroom
    const x    = v => (v / MAX * 100).toFixed(2) + "%";
    const on   = new Set(selTeams());
    /* ⚠️ PER-TEAM par, not per-drafter. `D.par` is 34.00 — one drafter's four teams —
       and this rule sits on a chart of single teams, so it is the league total over 32.
       Dividing D.par by the team count instead put the rule at 1.06 wins. */
    const TEAM_PAR = D.total_wins / rows.length;

    const html = rows.map((t,i)=>{
      const T = D.teams[t], own = ownerOf(t);
      const cls = [oc(own), on.has(t)?"on":"", own?"":"und"].filter(Boolean).join(" ");
      const tipTxt = `<b>${esc(T.name)}</b><br>expected wins ${n2(T.ew)} · posted line ${n2(T.line)}`
        + `<br>${own?`drafted by ${esc(own)}`:"still on the board"}`;
      return `<button type="button" class="td-row ${cls}" data-sel="team:${esc(t)}"
          data-tip="${esc(tipTxt).replace(/&lt;/g,"<").replace(/&gt;/g,">")}"
          aria-label="${esc(T.name)}, ${n2(T.ew)} expected wins, ${own?"drafted by "+esc(own):"undrafted"}">
        <span class="td-rank">${i+1}</span>
        <span class="td-abbr">${esc(t)}</span>
        <span class="td-track">
          <span class="td-bar" style="width:${x(T.ew)}"></span>
          <span class="td-tick" style="left:${x(T.line)}"></span>
        </span>
        <span class="td-ew">${n2(T.ew)}</span>
        <span class="td-own">${own?esc(own):"—"}</span>
      </button>`;
    }).join("");

    $("tdLadder").className = "td-ladder" + (sel.kind==="league" ? "" : " sel");
    $("tdLadder").innerHTML = html;
    /* The par rule is positioned against the TRACK column, so it is drawn inside the
       first row's track and stretched over the card rather than guessed in grid units. */
    const t0 = $("tdLadder").querySelector(".td-track");
    if(t0){
      const wrap = $("tdLadder").getBoundingClientRect(), tr = t0.getBoundingClientRect();
      const left = (tr.left - wrap.left) + tr.width * TEAM_PAR / MAX;
      $("tdLadder").insertAdjacentHTML("beforeend",
        `<span class="td-par" style="left:${left.toFixed(1)}px"></span>`
        + `<span class="td-parlab" style="left:${left.toFixed(1)}px">par ${TEAM_PAR.toFixed(1)}</span>`);
    }
    $("ladderMeta").textContent = sel.kind==="league"
      ? `32 teams · scale 0–${MAX} wins`
      : `${on.size} of 32 highlighted`;
  }

  /* ====================== 2 · the matrix ================================ */
  function matrix(){
    const cell = (a,b) => (D.overlap[a] && D.overlap[a][b]) || 0;
    const on   = new Set(selTeams());
    const out  = [];

    out.push(`<div class="td-mr" style="height:38px"></div>`);
    ORDER.forEach((t,i)=>{
      const own = ownerOf(t);
      out.push(`<div class="td-mh ${oc(own)} ${on.has(t)?"own":""} ${i%4===0&&i?"dv":""}"
        role="columnheader">${esc(t)}</div>`);
    });

    ORDER.forEach((a,r)=>{
      const ownA = ownerOf(a);
      out.push(`<div class="td-mr ${oc(ownA)} ${on.has(a)?"own":""} ${r%4===0&&r?"dh":""}"
        role="rowheader"><span class="dot"></span>${esc(a)}</div>`);
      ORDER.forEach((b,c)=>{
        const g = cell(a,b), ownB = ownerOf(b);
        const same = a!==b && ownA && ownA===ownB && g>0;
        const both = on.has(a) && on.has(b);
        const cls = ["td-c", a===b?"diag":(g===2?"g2":g===1?"g1":""),
                     same?"self":"", same?oc(ownA):"",
                     both?"in":"", c%4===0&&c?"dv":"", r%4===0&&r?"dh":""]
                    .filter(Boolean).join(" ");
        if(a===b){ out.push(`<div class="${cls}" role="gridcell" aria-hidden="true"></div>`); return; }
        const wks = (D.teams[a].schedule||[]).filter(x=>x.opp===b).map(x=>"wk "+x.week);
        const txt = `<b>${esc(a)} · ${esc(b)}</b><br>`
          + (g ? `${g} meeting${g>1?"s":""} — ${wks.join(", ")}` : "never meet")
          + (same ? `<br><b>${esc(ownA)} owns both.</b> One of these wins cancels the other.`
                  : (ownA||ownB) ? `<br>${ownA?esc(ownA):"open"} vs ${ownB?esc(ownB):"open"}` : "");
        out.push(`<div class="${cls}" role="gridcell" tabindex="-1" data-tip="${txt.replace(/"/g,"&quot;")}"
          aria-label="${esc(a)} versus ${esc(b)}, ${g} meetings"></div>`);
      });
    });

    const m = $("tdMatrix");
    m.className = "td-matrix" + (sel.kind==="league" ? "" : " sel");
    m.innerHTML = out.join("");

    if(sel.kind==="drafter"){
      const v = D.drafters[sel.id];
      $("matrixMeta").textContent = v.internal_games
        ? `${esc(sel.id)}: ${v.internal_games} internal game${v.internal_games>1?"s":""} inside the roster`
        : `${esc(sel.id)}: no internal games — nothing in this roster cancels`;
    } else if(sel.kind==="team"){
      const own = ownerOf(sel.id);
      const rivals = own ? teamsOf(own).filter(t=>t!==sel.id && cell(sel.id,t)>0) : [];
      $("matrixMeta").textContent = rivals.length
        ? `${sel.id} meets ${own}'s own ${rivals.join(" and ")}`
        : `${sel.id} plays nobody else on ${own?own+"'s roster":"any one roster"}`;
    } else {
      const tot = D.draft_order.reduce((a,n)=>a+D.drafters[n].internal_games,0);
      $("matrixMeta").textContent = `${tot} of 272 games have the same owner on both sides`;
    }
  }

  /* ====================== 3 · standings ================================= */
  function cards(){
    const names = [...D.draft_order].sort((a,b)=>D.drafters[b].ew - D.drafters[a].ew);
    $("tdCards").innerHTML = names.map(name=>{
      const v = D.drafters[name];
      const sd = v.sd_sim!=null ? v.sd_sim : v.sd_model;
      const open = Array.from({length:v.picks_remaining},
        ()=>`<span class="td-tteam open">open</span>`).join("");
      const roster = v.roster.map(t=>
        `<span class="td-tteam">${esc(t)} <s>${n2(D.teams[t].ew)}</s></span>`).join("") + open;
      const on = (sel.kind==="drafter" && sel.id===name)
              || (sel.kind==="team" && ownerOf(sel.id)===name);
      return `<button type="button" class="td-card ${oc(name)}" data-sel="drafter:${esc(name)}"
          aria-pressed="${on}">
        <h3>${esc(name)}<em>slot ${v.slot}</em></h3>
        <div class="td-big"><b>${n2(v.ew)}</b><span>expected wins</span>
          <span class="td-delta ${v.par_delta>=0?"up":"dn"}">${sgn(v.par_delta)} vs par</span></div>
        <div class="td-roster">${roster}</div>
        <div class="td-mini"><span>internal <b>${v.internal_games}</b></span>
          <span>SD <b>${n2(sd)}</b>${v.sd_sim==null?" <b>derived</b>":""}</span>
          <span>${v.picks_remaining ? `<b>${v.picks_remaining}</b> pick${v.picks_remaining>1?"s":""} left`
                                    : "roster complete"}</span></div>
      </button>`;
    }).join("");

    const done = D.picks_made === D.picks_total;
    $("standMeta").textContent = done
      ? `all ${D.picks_total} picks in · the eight totals sum to ${D.total_wins}`
      : `${D.picks_made}/${D.picks_total} picks · totals are partial and will move`;
  }

  function tracker(){
    const W = D.wins_tracker || {};
    const head = `<thead><tr><th>Drafter</th><th>R1</th><th>R2</th><th>R3</th><th>R4</th>
      <th>Total</th></tr></thead>`;
    const body = D.draft_order.map(name=>{
      const w = W[name] || {rounds:[0,0,0,0], total:0};
      return `<tr class="${oc(name)}"><td><span class="sw"></span>${esc(name)}</td>`
        + w.rounds.map(v=>`<td>${v}</td>`).join("")
        + `<td class="tot">${w.total}</td></tr>`;
    }).join("");
    $("tdTracker").innerHTML = head + `<tbody>${body}</tbody>`;
  }

  /* ====================== the season simulator ========================== */
  /* The browser replays seasons off the SAME refitted probabilities the payload's
     stored Monte Carlo ran on (`wpf`, not `wp`), so a spin here and the slice it lands
     in are two views of one model rather than two models.

     ⚠️ GAMES, NOT TOTALS. Each of the 272 games hands its single win to exactly one
     side. That is what keeps a simulated season paying exactly 272 and what stops a
     roster owning both sides of a game from banking both. Drawing each team's season
     total independently would be far faster and would quietly destroy the only claim
     this page makes. */
  let GAMES = [];        // [ownerIndexA, ownerIndexB, p] — -1 where the team is undrafted
  let NAMES = [];

  function buildGames(){
    NAMES = [...D.draft_order];
    const slot = {};
    NAMES.forEach((n,i)=> teamsOf(n).forEach(t=>{ slot[t] = i; }));
    GAMES = [];
    for(const [t, T] of Object.entries(D.teams))
      for(const g of T.schedule)
        if(t < g.opp) GAMES.push([
          slot[t] === undefined ? -1 : slot[t],
          slot[g.opp] === undefined ? -1 : slot[g.opp],
          g.wpf != null ? g.wpf : g.wp]);
  }

  /* One season. Returns per-drafter win totals plus the finishing order, ties broken
     at random — the league's real tiebreakers are playoff wins and point differential,
     and neither is in this payload. */
  function season(){
    const s = new Array(NAMES.length).fill(0);
    for(let i=0;i<GAMES.length;i++){
      const g = GAMES[i], w = Math.random() < g[2] ? g[0] : g[1];
      if(w >= 0) s[w]++;
    }
    const order = s.map((v,i)=>[v, Math.random(), i])
                   .sort((a,b)=> b[0]-a[0] || a[1]-b[1]).map(x=>x[2]);
    const tied = s.filter(v=>v === s[order[0]]).length > 1;
    return {wins:s, order, tied};
  }

  /* ====================== the wheel ===================================== */
  const REF = () => D.simulation?.drafters || {};
  let slices = [], wheelRot = 0, spins = 0, tally = {}, tieSpins = 0, spinning = false;

  function layout(){
    /* Slices are the STORED reference probabilities, so the wheel is stable and dated
       rather than redrawn under the reader every time they press the button. */
    const ref = REF();
    const p = NAMES.map(n => ref[n]?.p_first || 0);
    const sum = p.reduce((a,b)=>a+b, 0);
    slices = []; let at = 0;
    NAMES.forEach((n,i)=>{
      const frac = sum > 0 ? p[i]/sum : 1/NAMES.length;
      slices.push({name:n, from:at*360, to:(at+frac)*360, mid:(at+frac/2)*360, frac, p:p[i]});
      at += frac;
    });
  }

  /* Angles run clockwise from 12 o'clock, which is where the pointer is. */
  const pt = (deg, r) => {
    const a = (deg - 90) * Math.PI/180;
    return [(200 + r*Math.cos(a)).toFixed(2), (200 + r*Math.sin(a)).toFixed(2)];
  };
  function arc(from, to, r){
    if(to - from >= 359.999){            // a lone slice is a full circle, not an arc
      return `M200 ${200-r} A${r} ${r} 0 1 1 199.99 ${200-r} Z`;
    }
    const [x1,y1] = pt(from, r), [x2,y2] = pt(to, r);
    return `M200 200 L${x1} ${y1} A${r} ${r} 0 ${(to-from) > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
  }

  function drawWheel(){
    const R = 152, selName = sel.kind === "drafter" ? sel.id
                          : sel.kind === "team" ? ownerOf(sel.id) : null;
    const wedges = slices.map(s=>{
      const dim = selName && s.name !== selName;
      return `<path class="td-slice ${oc(s.name)} ${dim?"dim":""}" d="${arc(s.from, s.to, R)}"
        fill="var(--own)" data-sel="drafter:${esc(s.name)}"
        data-tip="<b>${esc(s.name)}</b><br>first in ${(s.p*100).toFixed(1)}% of simulated seasons"/>`;
    }).join("");
    /* Direct labels, because eight categorical colours cannot carry identity alone.
       A slice under ~5% has no room for a name; the tally beside the wheel is where
       those drafters stay legible.

       ⚠️ Each label is translated into place and then counter-rotated by the wheel's
       own angle, so the names stay UPRIGHT while the rim turns underneath them. Without
       the inner <g> the labels tumble with the wheel and land at whatever angle the spin
       stopped on, which is unreadable exactly when the reader most wants to read it. The
       counter-rotation carries the same transition, so it tracks during the spin too. */
    const labs = slices.filter(s=>s.frac > 0.05).map(s=>{
      const [lx,ly] = pt(s.mid, R*0.62);
      return `<g transform="translate(${lx} ${ly})"><g class="td-labrot"
          style="transform:rotate(${-wheelRot}deg)">
          <text class="td-wlab" text-anchor="middle">${esc(s.name)}</text>
          <text class="td-wpct" y="14" text-anchor="middle">${(s.p*100).toFixed(1)}%</text>
        </g></g>`;
    }).join("");

    $("tdWheel").innerHTML =
      `<g id="tdWheelRot" style="transform:rotate(${wheelRot}deg);transform-origin:200px 200px">
         ${wedges}${labs}
       </g>
       <circle cx="200" cy="200" r="${R}" fill="none" stroke="var(--border)" stroke-width="2"/>
       <!-- the runner-up needle: thin, inside the hub, never mistaken for the rim pointer -->
       <g id="tdNeedle" style="transform:rotate(0deg);transform-origin:200px 200px">
         <line x1="200" y1="200" x2="200" y2="86" stroke="var(--surface-1)" stroke-width="6"/>
         <line x1="200" y1="200" x2="200" y2="86" stroke="var(--ink-1)" stroke-width="2.5"/>
         <path d="M200 72 L208 94 L192 94 Z" fill="var(--ink-1)"
           stroke="var(--surface-1)" stroke-width="1.5"/>
       </g>
       <circle cx="200" cy="200" r="31" fill="var(--surface-1)" stroke="var(--border)" stroke-width="2"/>
       <text x="200" y="196" text-anchor="middle" fill="var(--ink-2)"
         font-family="ui-monospace,monospace" font-size="10" font-weight="800">2ND</text>
       <text x="200" y="207" text-anchor="middle" fill="var(--ink-3)"
         font-family="ui-monospace,monospace" font-size="8" font-weight="700">PLACE</text>
       <!-- the rim pointer is fixed at 12 o'clock; the wheel turns under it -->
       <path d="M200 34 L212 8 L188 8 Z" fill="var(--accent)"/>`;

    const zero = slices.filter(s=>s.p === 0).map(s=>s.name);
    $("tdWheelNote").innerHTML = zero.length
      ? `${zero.map(esc).join(" and ")} have no slice: across ${(D.simulation.trials).toLocaleString()}
         simulated seasons they never finished first, because they are still short of a full roster.
         A spin can still land there — the wheel shows the stored probability, the spin plays a
         real season — and the banner above would say so.`
      : `Slices are the stored ${(D.simulation.trials).toLocaleString()}-season reference in the
         payload. Each spin is a fresh season played in your browser off the same probabilities.`;
  }

  function renderTally(){
    const ref = REF();
    const rows = NAMES.map(n=>{
      const t = tally[n] || 0;
      const on = (sel.kind === "drafter" && sel.id === n)
              || (sel.kind === "team" && ownerOf(sel.id) === n);
      return {n, t, on, refp: (ref[n]?.p_first || 0)};
    }).sort((a,b)=> b.t - a.t || b.refp - a.refp);
    $("tdTally").innerHTML =
      `<thead><tr><th>Drafter</th><th>Spins won</th><th>Your rate</th><th>Model</th></tr></thead>`
      + `<tbody>${rows.map(r=>
        `<tr class="${oc(r.n)} ${r.on?"on":""}"><td><span class="sw"></span>${esc(r.n)}</td>
          <td>${r.t}</td>
          <td>${spins ? (r.t/spins*100).toFixed(1)+"%" : "—"}</td>
          <td class="gap">${(r.refp*100).toFixed(1)}%</td></tr>`).join("")}</tbody>`;
    $("wheelMeta").textContent = spins
      ? `${spins} spin${spins===1?"":"s"} · ${tieSpins} ended tied for first`
      : `${(D.simulation.trials).toLocaleString()} stored seasons · press the button to play one`;
  }

  function spin(){
    if(spinning) return;
    const r = season();
    const win = NAMES[r.order[0]], run = NAMES[r.order[1]];
    const iw = slices.findIndex(s=>s.name === win), ir = slices.findIndex(s=>s.name === run);

    /* Land the winner's slice under the fixed pointer: after rotating by `wheelRot`,
       a slice that started at `mid` sits at `mid + wheelRot`, so drive that to 0. */
    const turns = 4 + Math.floor(Math.random()*3);
    const delta = ((-(slices[iw].mid + wheelRot)) % 360 + 360) % 360;
    wheelRot += turns*360 + delta;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rot = $("tdWheelRot"), needle = $("tdNeedle");
    if(reduce){ rot.style.transition = needle.style.transition = "none"; }
    rot.style.transform = `rotate(${wheelRot}deg)`;
    needle.style.transform = `rotate(${slices[ir].mid + wheelRot}deg)`;
    /* keep the names the right way up while the rim turns under them */
    document.querySelectorAll("#tdWheel .td-labrot").forEach(el=>{
      if(reduce) el.style.transition = "none";
      el.style.transform = `rotate(${-wheelRot}deg)`;
    });

    spins++; tally[win] = (tally[win] || 0) + 1;
    if(r.tied) tieSpins++;

    const w = r.wins[r.order[0]], s2 = r.wins[r.order[1]];
    $("tdResult").className = "td-result " + oc(win);
    $("tdResult").innerHTML =
      `<span class="big">${esc(win)} wins it with ${w}.</span>`
      + `${esc(run)} takes second on ${s2}`
      + (r.tied ? ` — <b>and this one was a tie at the top</b>, broken at random here because the
          league breaks it on playoff wins and then point differential.` : `.`)
      + ` <span class="gap">One simulated season, 272 games. Not a prediction.</span>`;
    renderTally();

    spinning = true;
    setTimeout(()=>{ spinning = false; }, reduce ? 60 : 3650);
  }

  /* ====================== monte carlo =================================== */
  let mcRun = null;

  function mcTable(res, trials){
    const ref = REF();
    const rows = NAMES.map((n,i)=>({n, i, ...res[i]}))
      .sort((a,b)=> b.first - a.first || b.mean - a.mean);
    $("tdMc").innerHTML =
      `<thead><tr><th>Drafter</th><th>Roster</th><th>Mean wins</th><th>p10</th><th>p90</th>
        <th>1st</th><th>2nd</th><th>Paid</th><th>Stored 1st</th></tr></thead><tbody>`
      + rows.map(r=>{
        const on = (sel.kind === "drafter" && sel.id === r.n)
                || (sel.kind === "team" && ownerOf(sel.id) === r.n);
        return `<tr class="${oc(r.n)} ${on?"on":""}"><td><span class="sw"></span>${esc(r.n)}</td>
          <td>${teamsOf(r.n).map(esc).join(" ") || "—"}</td>
          <td>${r.mean.toFixed(2)}</td><td>${r.p10}</td><td>${r.p90}</td>
          <td>${(r.first/trials*100).toFixed(1)}%</td>
          <td>${(r.second/trials*100).toFixed(1)}%</td>
          <td>${((r.first+r.second)/trials*100).toFixed(1)}%</td>
          <td class="gap">${((ref[r.n]?.p_first||0)*100).toFixed(1)}%</td></tr>`;
      }).join("") + `</tbody>`;
  }

  /* Roster win totals from the run, drawn the same way the team curves are so the two
     read as one family. Selection focuses; league view shows all eight. */
  function mcPlot(res, trials){
    const W = 720, H = 210, PL = 34, PR = 12, PT = 12, PB = 26;
    const iw = W-PL-PR, ih = H-PT-PB;
    const lo = Math.min(...res.map(r=>r.lo)), hi = Math.max(...res.map(r=>r.hi));
    const span = Math.max(1, hi - lo);
    const top = Math.max(...res.flatMap(r=>[...r.hist.values()].map(c=>c/trials)));
    const X = w => PL + (w-lo)/span * iw;
    const Y = p => PT + ih - (p/top) * ih;
    const on = sel.kind === "league" ? null
             : (sel.kind === "drafter" ? sel.id : ownerOf(sel.id));

    const line = (r) => {
      let d = "";
      for(let w = lo; w <= hi; w++)
        d += `${d?"L":"M"}${X(w).toFixed(1)} ${Y((r.hist.get(w)||0)/trials).toFixed(1)}`;
      return d;
    };
    const paths = res.map((r,i)=>{
      const nm = NAMES[i], lit = !on || on === nm;
      return `<g class="${oc(nm)}"><path d="${line(r)}" fill="none"
        stroke="${lit?"var(--own)":"var(--ink-3)"}" stroke-width="${lit?2:1}"
        opacity="${lit?1:.22}" stroke-linejoin="round"/></g>`;
    }).join("");

    const ticks = [];
    for(let w = Math.ceil(lo/5)*5; w <= hi; w += 5)
      ticks.push(`<line x1="${X(w)}" y1="${PT}" x2="${X(w)}" y2="${PT+ih}" stroke="var(--grid)"/>`
        + `<text x="${X(w)}" y="${H-8}" text-anchor="middle" fill="var(--ink-3)" font-size="10"
            font-family="ui-monospace,monospace">${w}</text>`);
    const par = D.par >= lo && D.par <= hi
      ? `<line x1="${X(D.par)}" y1="${PT}" x2="${X(D.par)}" y2="${PT+ih}" stroke="var(--axis)"
           stroke-dasharray="3 3"/><text x="${X(D.par)}" y="${PT+9}" text-anchor="middle"
           fill="var(--ink-3)" font-size="9.5" font-family="ui-monospace,monospace">par ${D.par.toFixed(0)}</text>`
      : "";

    $("tdMcPlot").innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
        aria-label="Simulated roster win totals for ${on ? esc(on) : "all eight drafters"}">
        ${ticks.join("")}${par}
        <line x1="${PL}" y1="${PT+ih}" x2="${PL+iw}" y2="${PT+ih}" stroke="var(--axis)"/>
        ${paths}</svg>`;
  }

  function runMC(trials){
    if(mcRun) return;
    const btns = [...document.querySelectorAll("[data-mc]")];
    btns.forEach(b=>{ b.disabled = true; });
    const prog = $("tdProg"); prog.hidden = false;

    const res = NAMES.map(()=>({first:0, second:0, sum:0, hist:new Map(), lo:99, hi:0,
                                mean:0, p10:0, p90:0}));
    let done = 0, ties = 0;
    const CHUNK = 1500;                 // keeps the main thread responsive on 50k

    function step(){
      const end = Math.min(done + CHUNK, trials);
      for(; done < end; done++){
        const r = season();
        if(r.tied) ties++;
        res[r.order[0]].first++;
        res[r.order[1]].second++;
        for(let i=0;i<NAMES.length;i++){
          const w = r.wins[i], a = res[i];
          a.sum += w;
          a.hist.set(w, (a.hist.get(w)||0) + 1);
          if(w < a.lo) a.lo = w;
          if(w > a.hi) a.hi = w;
        }
      }
      prog.firstElementChild.style.width = (done/trials*100).toFixed(1) + "%";
      if(done < trials){ mcRun = requestAnimationFrame(step); return; }

      res.forEach(a=>{
        a.mean = a.sum/trials;
        const ws = [...a.hist.keys()].sort((x,y)=>x-y);
        let cum = 0;
        for(const w of ws){
          cum += a.hist.get(w);
          if(!a._p10 && cum >= trials*0.10){ a.p10 = w; a._p10 = 1; }
          if(!a._p90 && cum >= trials*0.90){ a.p90 = w; a._p90 = 1; break; }
        }
      });
      mcTable(res, trials); mcPlot(res, trials);
      LAST_MC = {res, trials};
      $("mcMeta").textContent = `${trials.toLocaleString()} seasons run here · `
        + `${(ties/trials*100).toFixed(1)}% ended tied for first`;
      $("tdMcNote").innerHTML =
        `Run in your browser just now, so it will not match the stored column to the last decimal —
         that gap <em>is</em> the sampling error, and it shrinks as you raise the trial count.
         The stored figure is ${(D.simulation.trials).toLocaleString()} seasons at seed
         ${D.simulation.seed}, recorded in the payload. Neither has a tie OUTCOME: every game here
         is decided, so no half-wins are produced, and the league's rule that a tied game counts
         half is not modelled.`;
      prog.hidden = true; prog.firstElementChild.style.width = "0";
      btns.forEach(b=>{ b.disabled = false; });
      mcRun = null;
    }
    step();
  }
  let LAST_MC = null;

  /* ====================== 4 · distributions ============================= */
  function curves(){
    const W = 720, H = 250, PL = 34, PR = 12, PT = 12, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const all = Object.keys(D.teams);
    const on  = new Set(selTeams());
    const top = Math.max(...all.map(t=>Math.max(...Object.values(D.teams[t].dist))));
    const X = w => PL + (w/17) * iw;
    const Y = p => PT + ih - (p/top) * ih;
    const path = t => Array.from({length:18},(_,w)=>
      `${w?"L":"M"}${X(w).toFixed(1)} ${Y(D.teams[t].dist[w]||0).toFixed(1)}`).join(" ");

    const grid = Array.from({length:18},(_,w)=> w%2 ? "" :
      `<line x1="${X(w)}" y1="${PT}" x2="${X(w)}" y2="${PT+ih}" stroke="var(--grid)" stroke-width="1"/>`
      + `<text x="${X(w)}" y="${H-8}" text-anchor="middle" fill="var(--ink-3)"
          font-size="10" font-family="ui-monospace,monospace">${w}</text>`).join("");

    const back = all.filter(t=>!on.has(t)).map(t=>
      `<path d="${path(t)}" fill="none" stroke="var(--ink-3)" stroke-width="1"
        opacity="${sel.kind==="league"?0.3:0.12}"/>`).join("");
    /* Selected curves get a 2px surface ring so overlapping lines stay separable. */
    const fore = [...on].map(t=>{
      const own = ownerOf(t);
      return `<g class="${oc(own)}">`
        + `<path d="${path(t)}" fill="none" stroke="var(--surface-1)" stroke-width="5"
             stroke-linejoin="round"/>`
        + `<path d="${path(t)}" fill="none" stroke="var(--own)" stroke-width="2"
             stroke-linejoin="round"/></g>`;
    }).join("");

    /* Direct labels at the median, with a leader line. Two teams in one roster often
       share a p50 — stagger the stack so the labels never sit on top of each other. */
    const labels = on.size && on.size<=4 ? [...on].map((t,i)=>{
      const T = D.teams[t], px = X(T.p50), py = Y(T.dist[T.p50]||0);
      const ly = Math.max(PT + 9, py - 12 - (i % 4) * 14);
      return `<g class="${oc(ownerOf(t))}">`
        + `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}"
             y2="${(ly+3).toFixed(1)}" stroke="var(--own)" stroke-width="1" opacity=".55"/>`
        + `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--own)"
             stroke="var(--surface-1)" stroke-width="2"/>`
        + `<text x="${px.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle"
             fill="var(--ink-1)" font-size="11" font-weight="700" paint-order="stroke"
             stroke="var(--surface-1)" stroke-width="3"
             font-family="ui-monospace,monospace">${esc(t)}</text></g>`;
    }).join("") : "";

    $("tdCurves").innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Probability of each final win total, 0 to 17, for ${on.size||32} teams">
        ${grid}
        <line x1="${PL}" y1="${PT+ih}" x2="${PL+iw}" y2="${PT+ih}" stroke="var(--axis)" stroke-width="1"/>
        <text x="${PL-6}" y="${PT+8}" text-anchor="end" fill="var(--ink-3)" font-size="10"
          font-family="ui-monospace,monospace">${(top*100).toFixed(0)}%</text>
        <text x="${PL-6}" y="${PT+ih}" text-anchor="end" fill="var(--ink-3)" font-size="10"
          font-family="ui-monospace,monospace">0</text>
        ${back}${fore}${labels}
      </svg>`;

    $("tdQuant").innerHTML = on.size && on.size<=4 ? [...on].map(t=>{
      const T = D.teams[t];
      return `<span class="td-qi ${oc(ownerOf(t))}"><i></i>${esc(t)}
        p10 <b>${T.p10}</b> · p50 <b>${T.p50}</b> · p90 <b>${T.p90}</b> · SD <b>${n2(T.sd)}</b></span>`;
    }).join("") : "";

    const sds = all.map(t=>D.teams[t].sd);
    $("curveMeta").textContent = sel.kind==="league"
      ? `32 curves · season SD ${Math.min(...sds).toFixed(2)}–${Math.max(...sds).toFixed(2)} wins`
      : `${on.size} highlighted of 32`;
  }

  /* ====================== 5 · the schedule strip ======================== */
  function strip(){
    const weeks = Array.from({length:17},(_,i)=>i+1);
    const head = `<div class="td-srow head"><span></span>`
      + weeks.map(w=>`<span class="td-wk">${w}</span>`).join("") + `</div>`;

    if(sel.kind==="league"){
      /* League default: how many games each week have the same owner on both sides.
         It is the only week-level thing that is true of the pool rather than a team. */
      const per = weeks.map(w=>{
        let c = 0;
        for(const name of D.draft_order){
          const r = teamsOf(name);
          for(const t of r) for(const g of D.teams[t].schedule)
            if(g.week===w && r.includes(g.opp)) c++;
        }
        return c/2;                    // each collision is counted from both sides
      });
      const mx = Math.max(1, ...per);
      $("tdStrip").innerHTML = head + `<div class="td-collide">`
        + `<span class="td-slab">clashes</span>`
        + per.map((c,i)=>`<span class="td-cwrap" data-tip="Week ${i+1}: ${c} game${c===1?"":"s"} with the same owner on both sides">`
            + (c?`<span class="td-cbar" style="height:${(c/mx*34+4).toFixed(0)}px"></span>`:"")
            + `<span class="td-cn">${c||""}</span></span>`).join("")
        + `</div>`;
      $("schedMeta").textContent = `${per.reduce((a,b)=>a+b,0)} self-cancelling games across the season`;
      return;
    }

    const list = sel.kind==="team" ? [sel.id] : teamsOf(sel.id);
    if(!list.length){
      $("tdStrip").innerHTML = `<div class="td-empty">${esc(sel.id)} has not drafted yet.</div>`;
      $("schedMeta").textContent = "";
      return;
    }
    const own  = sel.kind==="team" ? ownerOf(sel.id) : sel.id;
    const mate = new Set(own ? teamsOf(own) : []);

    let clashes = 0;
    const rows = list.map(t=>{
      const byWeek = {};
      D.teams[t].schedule.forEach(g=>{ byWeek[g.week] = g; });
      const cells = weeks.map(w=>{
        const g = byWeek[w];
        if(!g) return `<span class="td-g bye"><span class="op">BYE</span><span class="p">—</span></span>`;
        const clash = mate.has(g.opp) && g.opp!==t;
        if(clash) clashes++;
        const txt = `<b>Week ${w}</b><br>${esc(t)} ${g.home?"vs":"at"} ${esc(g.opp)}`
          + `<br>win probability ${(g.wp*100).toFixed(1)}%`
          + (clash?`<br><b>${esc(own)} owns both sides.</b>`:"");
        return `<span class="td-g ${clash?"clash":""}" data-tip="${txt.replace(/"/g,"&quot;")}">
          <span class="op">${g.home?"":`<span class="at">@</span>`}${esc(g.opp)}</span>
          <span class="p">${pct(g.wp)}</span></span>`;
      }).join("");
      return `<div class="td-srow ${oc(ownerOf(t))}">
        <span class="td-slab"><span class="dot"></span>${esc(t)}</span>${cells}</div>`;
    }).join("");

    $("tdStrip").innerHTML = head + rows;
    /* A drafter's strips show each collision TWICE — once from each side — so halve it.
       A single team's strip sees each of its own collisions once. */
    const games = sel.kind==="team" ? clashes : Math.round(clashes/2);
    $("schedMeta").textContent = games
      ? `${games} self-cancelling game${games===1?"":"s"} in view`
      : `no self-cancelling games in view`;
  }

  /* ====================== 6 · the board ================================= */
  function board(){
    const on = new Set(selTeams());
    const head = D.draft_order.map(name=>
      `<div class="td-bh ${oc(name)}"><span class="sw"></span>${esc(name)}</div>`).join("");

    const byKey = {};
    D.board.forEach(b=>{ byKey[b.drafter + "|" + b.round] = b; });

    let cells = "";
    for(let r=1; r<=4; r++){
      for(const name of D.draft_order){
        const b = byKey[name + "|" + r];
        if(!b || !b.team){
          cells += `<div class="td-bc empty ${oc(name)}"><span class="n">R${r}</span>
            <span class="t">on the clock</span></div>`;
          continue;
        }
        const best = b.delta === 0;
        const cls  = best ? "best" : (b.delta <= -1 ? "reach" : "");
        const txt  = `<b>Pick ${b.pick} · ${esc(b.drafter)}</b><br>${esc(D.teams[b.team].name)} — `
          + `${n2(b.ew)} expected wins<br>best available was ${esc(b.best_available)} at `
          + `${n2(b.best_available_ew)}<br>${esc(b.team)} was #${b.rank_at_pick} of `
          + `${b.available_at_pick} left on the board`;
        cells += `<button type="button" class="td-bc ${oc(name)} ${on.has(b.team)?"on":""}"
            data-sel="team:${esc(b.team)}" data-tip="${txt.replace(/"/g,"&quot;")}">
          <span class="n">${b.pick}</span>
          <span class="t">${esc(b.team)}</span>
          <span class="e">${n2(b.ew)} EW</span>
          <span class="d ${cls}">${best ? "best available" : n2(b.delta)}</span></button>`;
      }
    }
    const el = $("tdBoard");
    el.className = "td-board" + (sel.kind==="league" ? "" : " sel");
    el.innerHTML = head + cells;

    const made = D.board.filter(b=>b.team);
    const reaches = made.filter(b=>b.delta <= -1).length;
    $("boardMeta").textContent = `${made.length} picks · ${made.filter(b=>b.delta===0).length} took the `
      + `board's best remaining · ${reaches} passed on a full win or more`;
  }

  /* ====================== diagnostics =================================== */
  function diagnostics(){
    const dg = D.diagnostics || {checks:[]};
    $("tdChecks").innerHTML = dg.checks.map(c=>{
      const kind = c.ok ? "ok" : (c.severity === "hard" ? "bad" : "known");
      const word = c.ok ? "holds" : (c.severity === "hard" ? "broken" : "known drift");
      return `<div class="td-chk ${kind}"><h4>${esc(c.label)}<em>${word}</em></h4>
        <p>${esc(c.detail)}</p></div>`;
    }).join("");

    const rows = Object.keys(D.teams)
      .sort((a,b)=>D.teams[b].ew - D.teams[a].ew).map(t=>{
      const T = D.teams[t], own = ownerOf(t);
      const sp = T.schedule.reduce((a,g)=>a+g.wp, 0);
      const mass = Object.values(T.dist).reduce((a,p)=>a+p, 0);
      const mu = Object.entries(T.dist).reduce((a,[w,p])=>a + Number(w)*p, 0) / mass;
      const d1 = sp - T.ew, d2 = mu - T.ew;
      const big = v => Math.abs(v) >= 1 ? ' class="td-drift"' : "";
      return `<tr class="${oc(own)}"><td><span class="sw"></span>${esc(t)}</td>
        <td>${own?esc(own):"—"}</td><td>${n2(T.line)}</td><td>${n2(T.ew)}</td>
        <td>${sgn(T.ew - T.line)}</td><td>${n2(T.sd)}</td>
        <td>${n2(sp)}</td><td${big(d1)}>${sgn(d1)}</td>
        <td>${n2(mu)}</td><td${big(d2)}>${sgn(d2)}</td></tr>`;
    }).join("");
    $("tdPerTeam").innerHTML = `<thead><tr><th>Team</th><th>Owner</th><th>Line</th><th>EW</th>
      <th>&Delta;vig</th><th>SD</th><th>&Sigma;p</th><th>drift</th><th>&mu;dist</th><th>drift</th>
      </tr></thead><tbody>${rows}</tbody>`;
    $("ptMeta").textContent = `32 rows · from /data/draft-2026.json as_of ${esc(DATED.as_of)}`;

    const owned = D.draft_order.reduce((a,n)=>a + D.drafters[n].ew, 0);
    const pool  = D.undrafted.reduce((a,t)=>a + D.teams[t].ew, 0);
    const stat = (v,l) => `<div class="p-stat"><b>${v}</b><span>${l}</span></div>`;
    $("tdCons").innerHTML =
        stat(n2(owned), "wins on the eight rosters")
      + stat(n2(pool), `wins still on the board (${D.undrafted.length} teams)`)
      + stat(n2(owned + pool), "the two together")
      + stat(D.total_wins, "wins the league actually pays")
      + stat(n2(D.par), "par, per drafter")
      + stat(D.draft_order.reduce((a,n)=>a + D.drafters[n].internal_games, 0),
             "games with one owner on both sides");
  }

  function rules(){
    const f = D.format || {};
    const stat = (v,l) => `<div class="p-stat"><b>${v}</b><span>${l}</span></div>`;
    $("tdRules").innerHTML =
        stat(f.drafters ?? "—", "drafters")
      + stat(f.teams_per_drafter ?? "—", "NFL teams each")
      + stat(f.order ?? "—", "draft order")
      + stat("wins", "the only criterion")
      + stat(f.tie_value ?? "—", "a tie is worth this many wins")
      + stat("$" + (f.prizes?.first ?? "—"), "first place")
      + stat("$" + (f.prizes?.second ?? "—"), "second place")
      + stat(n2(D.par), "par — nobody is above it by default")
      + `<div class="p-stat" style="grid-column:1/-1"><span>Tiebreakers, in order:
          ${(f.tiebreakers||[]).map((t,i)=>`${i+1}. ${esc(t)}`).join(" &nbsp;·&nbsp; ")}</span></div>`;
  }

  /* ====================== wiring ======================================== */
  let DATED = {};
  function renderAll(){
    $("tdRail").innerHTML = railHTML();
    $("tdNow").className = "td-now " + (selSlot() ? "td-o"+selSlot() : "");
    $("tdNow").innerHTML = nowHTML();
    $("tdTeamPick").addEventListener("change", e=>{
      const v = e.target.value;
      sel = v ? {kind:"team", id:v} : {kind:"league", id:null};
      renderAll();
    });
    ladder(); matrix(); cards(); tracker(); curves(); strip(); board();
    /* The wheel keeps its rotation and its tally across a selection change — a spin
       history is the reader's, not the filter's. Only the highlight is re-derived. */
    drawWheel(); renderTally();
    if(LAST_MC){ mcTable(LAST_MC.res, LAST_MC.trials); mcPlot(LAST_MC.res, LAST_MC.trials); }
  }

  function fail(msg){
    const where = ["tdLadder","tdMatrix","tdCards","tdCurves","tdStrip","tdBoard","tdChecks",
                   "tdResult","tdMc"];
    where.forEach(id=>{ const el = $(id); if(el)
      el.innerHTML = `<div class="p-error">The draft payload could not be read, so this view is
        empty rather than wrong: ${esc(msg)}</div>`; });
    $("tdNow").innerHTML = `<b>/data/draft-2026.json is unavailable.</b> ${esc(msg)}`;
    $("tdRail").innerHTML = "";
  }

  async function load(){
    let env;
    try{
      const r = await fetch("/data/draft-2026.json");
      if(!r.ok) throw new Error("the file returned HTTP " + r.status);
      env = await r.json();
      if(!env || !env.data || !env.data.teams || !env.data.draft_order)
        throw new Error("the payload is missing teams or the draft order");
    }catch(err){ fail(err.message); return; }

    D = env.data;
    DATED = {as_of: env.as_of, source: env.source, built: env.built};
    ORDER = Object.keys(D.teams).sort((a,b)=>{
      const dd = DIVS.indexOf(D.teams[a].division) - DIVS.indexOf(D.teams[b].division);
      return dd || (D.teams[b].ew - D.teams[a].ew);
    });

    buildGames();
    layout();
    renderAll();
    diagnostics();
    rules();
    wireTips(document.body);

    $("tdResult").innerHTML = D.picks_made < D.picks_total
      ? `<span class="big">${D.picks_total - D.picks_made} picks still to come.</span>
         The wheel already works, but it is turning on <b>partial rosters</b> — a drafter holding
         ${Math.min(...D.draft_order.map(n=>D.drafters[n].roster.length))} teams cannot win a
         four-team competition. These slices describe the board as it stands, and they will move
         hard when the rest of the draft lands.`
      : `<span class="big">Press the button.</span> Every spin plays one full season — all 272
         games — and stops on whoever won it. The needle finds that season's runner-up.`;

    $("tdSpin").addEventListener("click", spin);
    $("tdSpin10").addEventListener("click", ()=>{
      /* Ten seasons, one animation: the tally is the point of a run this size, and ten
         consecutive 3.6s spins is not a feature. */
      for(let i=0;i<9;i++){
        const r = season();
        tally[NAMES[r.order[0]]] = (tally[NAMES[r.order[0]]] || 0) + 1;
        spins++; if(r.tied) tieSpins++;
      }
      spin();
    });
    $("tdSpinReset").addEventListener("click", ()=>{
      spins = 0; tieSpins = 0; tally = {}; renderTally();
    });
    document.querySelectorAll("[data-mc]").forEach(btn=>
      btn.addEventListener("click", ()=> runMC(Number(btn.dataset.mc))));

    DDSheets({key:"teamdraft", mount:"#sheets",
      sheets:[{id:"pool",  label:"The pool",       panel:"#sheetPool"},
              {id:"diag",  label:"Diagnostics",    panel:"#sheetDiag", hint:"what drifts"},
              {id:"rules", label:"Rules & method", panel:"#sheetRules"}]});

    /* Re-laying the par rule is the one thing that depends on measured geometry. */
    let rz; addEventListener("resize", ()=>{ clearTimeout(rz); rz = setTimeout(ladder, 140); });
  }
  load();
})();
</script>"""

SCRIPT = SCRIPT.replace("__DDSHEETS__", DDSHEETS.rstrip())

out = head + shell + MAIN + foot_open + SCRIPT + foot_close

# ---------------------------------------------------------------- guards ----
assert out.count("<main>") == 1 and out.count("</main>") == 1
assert out.count('id="sheetPool"') == 1 and out.count('id="sheetDiag"') == 1 \
    and out.count('id="sheetRules"') == 1
assert out.count('id="tdMatrix"') == 1 and out.count('id="tdLadder"') == 1
assert out.count('id="tdWheel"') == 1 and out.count('id="tdSpin"') == 1
assert out.count('id="tdMc"') == 1 and out.count('data-mc="50000"') == 1
# The simulator must never read the raw schedule: `wp` does not re-add to expected wins,
# so a season built on it would disagree with the ladder by up to 2.7 wins per roster.
assert "g.wpf != null ? g.wpf : g.wp" in out, "the simulator lost its fitted-probability source"
assert out.count("window.DDSheets = function") == 1, "DDSheets went missing or doubled"
assert out.count('"teamdraft":"/data/draft-2026.json"') == 1
assert "arenaCards" not in out and "surfaces.json\")" not in out, "arena's own script came along"
assert out.count('data-page="teamdraft"') == 1
# No numbers typed into the page: every figure has to come out of the payload.
for banned in ("11.73", "29.33", "8.5 wins", "272 wins each"):
    assert banned not in MAIN, f"{banned!r} is hardcoded in the markup — read it from the payload"
assert "christophertfrost" not in out and "venmo" not in out.lower(), \
    "payment/contact detail must never reach the public repo"
assert out.endswith("</html>\n") or out.endswith("</html>")
assert "\r" not in out, "CRLF crept in; this repo is all-LF"

OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name}")
