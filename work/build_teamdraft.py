"""
Stamp teamdraft.html out of arena.html — the 2026 NFL team draft pool.

There is no build system here, so a NEW page is an existing page's head + shell +
footer with the <main> and the page script swapped (build_arena.py precedent).

⚠️ Slice by CONTENT MARKERS, never line numbers.

The page reads /data/draft-2026.json and nothing else. Every number on it comes out
of that file; scripts/team_draft_pool.py owns all the arithmetic, including the
three-tier basis (settled result / market price / model) that the page only reads.

TWO SHEETS, and the split is the point:
  Pool — what is true of the whole league. Tracker, rosters, wheel, Monte Carlo,
         ladder, matrix, board.
  Team — what is only true of one team or one roster at a time. Week by week, the
         season curve, the schedule table.
Nine equally-weighted sections meant nothing led. Seven plus a second sheet means
every section answers a question the reader actually has at that moment.

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
              'A wins tracker, a spin wheel over simulated seasons, and the head-to-head matrix that '
              'makes the pool zero-sum — read from /data/draft-2026.json.">',
              head, count=1, flags=re.S)

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
   The hues are the ones chosen in tracker-mockups.html — Matt blue, Rob rust,
   Kevin teal, Chris gold, Tyler magenta, Jason green, Jared violet, Alan red —
   but the STEPS are not that file's. Those were tuned against a near-black
   mockup field and fail on both of this site's surfaces: the mint read L 0.833
   (outside the band in either mode) and 1.56:1 on the cream paper, which is
   invisible, and four slots sat outside the dark band as well.

   Each hue was re-snapped to the nearest step that passes the six checks against
   THIS site's actual card colours, verified with the dataviz validator:

     dark  (#241c12): band PASS · chroma PASS · CVD 9.1 protan ·
                      normal-vision 19.2 · contrast all >= 3:1
     light (#fffdf7): band PASS · chroma PASS · CVD 9.7 deutan ·
                      normal-vision 18.1 · contrast all >= 3:1

   Both modes clear every check with no relief required, which is better than the
   previous palette managed. Identity is unchanged — nobody's colour moved hue.

   ⚠️ EIGHT categorical colours still cannot be pairwise-safe under simulated CVD;
   that is a property of the eye, not of any palette. So colour is never the only
   channel here: the tracker, the ring, the ladder and the cards all print the name
   beside the swatch. Do not "tidy up" by removing a label.

   ⚠️ Slot order is the DRAFT order and is frozen for the season. Colour follows the
   person, never their rank — re-sorting the tracker must not repaint anybody. */
:root{
  --d1:#4a90d8; --d2:#c45218; --d3:#00ae8d; --d4:#997400;
  --d5:#cb5282; --d6:#1bb253; --d7:#9788d3; --d8:#b6433f;
  --td-none:#6f6656;
  --td-cell1:#256abf; --td-cell2:#86b6ef;
}
:root[data-theme="light"]{
  --d1:#3e83cb; --d2:#c45218; --d3:#009878; --d4:#845f00;
  --d5:#ac3668; --d6:#199947; --d7:#8273bc; --d8:#b2403c;
  --td-none:#a99e8a;
  --td-cell1:#6da7ec; --td-cell2:#1c5cab;
}
.td-o1{--own:var(--d1)}.td-o2{--own:var(--d2)}.td-o3{--own:var(--d3)}.td-o4{--own:var(--d4)}
.td-o5{--own:var(--d5)}.td-o6{--own:var(--d6)}.td-o7{--own:var(--d7)}.td-o8{--own:var(--d8)}
.td-o0{--own:var(--td-none)}

/* ---- the one control ------------------------------------------------------ */
.td-rail{position:sticky;top:0;z-index:40;margin:0 0 18px;padding:11px 0 10px;
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

/* ---- 1 · the wins tracker, as a race track -------------------------------- */
.td-race{border:1px solid var(--border);border-radius:13px;background:var(--surface-1);
  padding:18px 18px 15px}
.td-scale{position:relative;height:15px;margin:0 0 6px 104px;border-bottom:1px solid var(--grid)}
.td-scale span{position:absolute;transform:translateX(-50%);top:2px;
  font:10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3)}
.td-rrow{display:grid;grid-template-columns:104px 1fr;gap:11px;align-items:center;
  padding:5px 0;border:0;background:none;width:100%;font:inherit;color:inherit;
  text-align:left;cursor:pointer;border-radius:7px}
.td-rrow:hover{background:color-mix(in srgb,var(--ink-3) 7%,transparent)}
.td-rrow:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.td-rlab{display:flex;align-items:center;gap:7px;justify-content:flex-end;text-align:right;
  font-size:13px;font-weight:700;color:var(--ink-1)}
.td-rlab i{width:9px;height:9px;border-radius:2px;background:var(--own);flex:none}
.td-rtrack{position:relative;height:26px;border-radius:5px;
  background:color-mix(in srgb,var(--ink-3) 12%,transparent)}
/* banked wins: one segment per DRAFT ROUND, same hue at stepped opacity */
.td-seg{position:absolute;top:0;bottom:0;background:var(--own);display:flex;align-items:center;
  justify-content:center;font:800 11.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--accent-ink);overflow:hidden}
.td-seg:first-of-type{border-radius:5px 0 0 5px}
/* the season still to play. Preseason this is the WHOLE bar, which is what gives
   eight empty tracks something true to say before week 1. */
.td-ghost{position:absolute;top:3px;bottom:3px;border-radius:0 4px 4px 0;
  border:1px dashed color-mix(in srgb,var(--own) 62%,transparent);
  background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--own) 22%,transparent) 0 5px,transparent 5px 10px)}
/* Sits above the par rule and carries a halo, because at most projections the label
   runs straight through 34 and the rule is drawn over the fill by design. */
.td-rtot{position:absolute;top:50%;transform:translateY(-50%);padding-left:9px;z-index:4;
  font:800 12.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--own);
  white-space:nowrap;text-shadow:0 0 4px var(--surface-1),0 0 4px var(--surface-1),0 0 4px var(--surface-1)}
.td-rproj{font-weight:650;color:var(--ink-3)}
/* par: the reference the entire page rests on, so it is drawn ABOVE the fill and
   overshoots the track top and bottom. Second thing the eye should find. */
.td-rpar{position:absolute;top:-5px;bottom:-5px;width:2px;background:var(--ink-1);
  opacity:.8;z-index:3;pointer-events:none}
.td-rfoot{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:11px 0 0 104px;
  font:10.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  letter-spacing:.05em}
.td-rfoot b{color:var(--ink-2)}
.td-disc{margin-top:12px}
.td-disc summary{cursor:pointer;font:750 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);letter-spacing:.05em}
.td-disc summary:hover{color:var(--ink-1)}
.td-disc summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.td-disc[open] summary{margin-bottom:10px;color:var(--ink-2)}

/* ---- 2 · roster cards ------------------------------------------------------ */
.td-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.td-card{border:1px solid var(--border);border-top:3px solid var(--own,var(--td-none));
  border-radius:3px 3px 12px 12px;background:var(--surface-1);padding:13px 15px 15px;text-align:left;
  cursor:pointer;font:inherit;color:inherit;display:block;width:100%}
.td-card:hover{border-color:var(--ink-3);border-top-color:var(--own)}
.td-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.td-card[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--own)}
.td-card h3{margin:0;font-size:16px;color:var(--ink-1);display:flex;align-items:baseline;
  justify-content:space-between;gap:8px}
.td-card h3 em{font:750 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;font-style:normal;color:var(--ink-3)}
.td-big{display:flex;align-items:baseline;gap:8px;margin:9px 0 2px;flex-wrap:wrap}
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

/* ---- 3 · the ring ---------------------------------------------------------- */
/* ONE COLUMN, ring on top. Side by side the ring was capped near 330px and read as a
   thumbnail beside its own result; stacked it gets the page column and the result line
   sits directly under the thing that produced it. */
.td-wheelwrap{display:block}
.td-wheelbox{border:1px solid var(--border);border-radius:14px;background:var(--surface-1);
  padding:16px;max-width:620px;margin:0 auto 16px}
.td-wheelbox svg{display:block;width:100%;height:auto;overflow:visible}
.td-slice{stroke:var(--surface-1);stroke-width:2;stroke-linejoin:round}
.td-slice.dim{opacity:.3}
.td-wlab{font:700 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;fill:var(--ink-1)}
.td-wpct{font:650 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;fill:var(--ink-3)}
#tdWheelRot,#tdWheel .td-labrot{transition:transform 3.6s cubic-bezier(.16,.72,.16,1)}
.td-spinrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;justify-content:center}
.td-go{appearance:none;border:1px solid var(--accent);background:var(--accent);
  color:var(--accent-ink);border-radius:999px;padding:9px 17px;font:inherit;font-size:14px;
  font-weight:800;cursor:pointer}
.td-go:hover{filter:brightness(1.08)}
.td-go:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.td-go[disabled]{opacity:.5;cursor:progress}
.td-go.ghost{background:transparent;color:var(--ink-2);border-color:var(--border)}
.td-go.ghost:hover{color:var(--ink-1);border-color:var(--ink-3)}
.td-result{margin:0 0 13px;padding:14px 16px;border:1px solid var(--border);
  border-left:3px solid var(--own,var(--ink-3));border-radius:0 12px 12px 0;
  background:var(--surface-1);font-size:14px;line-height:1.62;color:var(--ink-2);min-height:86px}
.td-result b{color:var(--ink-1)}
.td-result .big{display:block;font:800 22px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-1);margin-bottom:5px}
.td-ratio{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.td-ratio th,.td-ratio td{padding:7px 8px;border-bottom:1px solid var(--grid);text-align:right;
  font:650 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace}
.td-ratio th{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3)}
.td-ratio th:first-child,.td-ratio td:first-child{text-align:left}
.td-ratio tbody tr:last-child td{border-bottom:0}
.td-ratio .sw{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--own);
  margin-right:6px}
.td-ratio tr.on td{background:color-mix(in srgb,var(--own) 12%,transparent)}
.td-ratio .hi{color:var(--warn)}
.td-ratio .lo{color:var(--good)}
.td-bar{display:block;height:3px;border-radius:2px;margin-top:3px;
  background:color-mix(in srgb,var(--ink-3) 22%,transparent)}
.td-bar span{display:block;height:100%;border-radius:2px;background:var(--own)}

/* ---- 4 · monte carlo ------------------------------------------------------- */
.td-mcbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.td-prog{display:block;width:130px;height:7px;border-radius:999px;
  background:color-mix(in srgb,var(--ink-3) 20%,transparent);overflow:hidden}
.td-prog>span{display:block;height:100%;width:0;background:var(--accent);border-radius:999px}

/* ---- 5 · the ladder -------------------------------------------------------- */
.td-ladder{position:relative;border:1px solid var(--border);border-radius:12px;
  background:var(--surface-1);padding:12px 14px 8px}
/* ⚠️ width:100% is load-bearing — a <button> is shrink-to-fit, and without it the
   1fr track collapses and all 32 bars render as stubs against the left quarter. */
.td-row{display:grid;grid-template-columns:22px 44px 1fr 52px 84px;gap:9px;align-items:center;
  width:100%;padding:2px 0;border:0;background:transparent;font:inherit;color:inherit;
  text-align:left;cursor:pointer;border-radius:6px}
.td-row:hover .td-lbar{filter:brightness(1.12)}
.td-row:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.td-rank{font:650 10.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-align:right}
.td-abbr{font:800 12.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-1)}
.td-track{position:relative;height:15px}
.td-lbar{position:absolute;left:0;top:2px;height:11px;border-radius:2px 4px 4px 2px;
  background:var(--own,var(--td-none));transition:opacity .12s linear}
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
.td-ladder .td-row.und .td-lbar{background:repeating-linear-gradient(135deg,
  var(--td-none) 0 5px,transparent 5px 10px);box-shadow:inset 0 0 0 1px var(--td-none)}

/* ---- 6 · the matrix -------------------------------------------------------- */
.td-mwrap{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--surface-1);
  padding:10px 12px 14px}
.td-matrix{display:grid;gap:1px;width:max-content;margin:0 auto;--cell:17px;
  grid-template-columns:34px repeat(32,var(--cell));grid-auto-rows:var(--cell)}
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

/* ---- 7 · the board --------------------------------------------------------- */
.td-board{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;overflow:auto}
.td-bh{font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);
  text-transform:uppercase;letter-spacing:.04em;padding:0 0 2px;display:flex;align-items:center;gap:5px}
.td-bh .sw{width:8px;height:8px;border-radius:2px;background:var(--own);flex:0 0 auto}
.td-bc{border:1px solid var(--border);border-left:3px solid var(--own,var(--td-none));
  border-radius:2px 9px 9px 2px;background:var(--surface-1);padding:8px 9px;min-height:66px;
  text-align:left;cursor:pointer;font:inherit;color:inherit;display:block;width:100%}
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

/* ---- the Team sheet -------------------------------------------------------- */
.td-hero{border:1px solid var(--border);border-left:3px solid var(--own,var(--ink-3));
  border-radius:0 13px 13px 0;background:var(--surface-1);padding:16px 18px;margin:0 0 22px}
.td-hero h2{margin:0 0 3px;font-size:22px;color:var(--ink-1)}
.td-hero .sub{margin:0;color:var(--ink-3);font-size:13px}
.td-hstats{display:flex;flex-wrap:wrap;gap:9px;margin-top:13px}
.td-hstat{border:1px solid var(--border);border-radius:9px;padding:7px 11px;min-width:88px}
.td-hstat b{display:block;font:800 17px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-1);font-variant-numeric:tabular-nums}
.td-hstat span{display:block;margin-top:3px;font:650 9.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.td-plot{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);padding:12px 14px}
.td-plot svg{display:block;width:100%;height:auto}
.td-q{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}
.td-qi{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:8px;
  padding:5px 9px;font:650 11.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-2)}
.td-qi i{width:9px;height:9px;border-radius:2px;background:var(--own);font-style:normal}
.td-qi b{color:var(--ink-1)}
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
.td-g.clash{border-color:var(--own);box-shadow:inset 0 0 0 1px var(--own);
  background:color-mix(in srgb,var(--own) 15%,transparent)}
.td-g.clash .op{color:var(--ink-1)}
.td-g.done{background:color-mix(in srgb,var(--good) 14%,transparent);border-color:var(--good)}
.td-gtable{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:520px}
.td-gtable th{position:sticky;top:0;background:var(--surface-1);color:var(--ink-3);
  font:750 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;
  letter-spacing:.04em;padding:9px 8px;text-align:right;border-bottom:1px solid var(--grid);z-index:1}
.td-gtable td{padding:8px;border-bottom:1px solid var(--grid);text-align:right;font-size:12.5px;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.td-gtable th:first-child,.td-gtable td:first-child,
.td-gtable th:nth-child(2),.td-gtable td:nth-child(2){text-align:left}
.td-gtable tbody tr:last-child td{border-bottom:0}
.td-tierchip{display:inline-block;border-radius:5px;padding:1px 6px;
  font:750 9.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink-3);background:color-mix(in srgb,var(--ink-3) 14%,transparent)}
.td-tierchip.settled{color:var(--good);background:color-mix(in srgb,var(--good) 16%,transparent)}
.td-tierchip.market{color:var(--accent);background:color-mix(in srgb,var(--accent) 15%,transparent)}

/* ---- diagnostics ----------------------------------------------------------- */
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
.td-dtable tr.on td{background:color-mix(in srgb,var(--own) 12%,transparent)}
.td-dtable td .sw{display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--own);
  margin-right:6px}
.td-drift{color:var(--warn)}

/* ---- shared ---------------------------------------------------------------- */
.td-note{margin:10px 0 0;font-size:12.5px;line-height:1.6;color:var(--ink-3)}
.td-note code{font-size:11.5px}
.td-empty{padding:26px 16px;text-align:center;color:var(--ink-3);font-size:13.5px;line-height:1.6}

@media (max-width:860px){
  .td-row{grid-template-columns:20px 40px 1fr 48px;gap:7px}
  .td-own{display:none}
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
  /* the tracker has to work at 375px: the label gutter shrinks and the round
     numerals drop out of the segments rather than the bar wrapping */
  .td-race{padding:14px 12px 12px}
  .td-scale{margin-left:74px}
  .td-rrow{grid-template-columns:74px 1fr;gap:8px}
  .td-rfoot{margin-left:0}
  .td-seg{font-size:0}
  .td-rtot{font-size:11.5px;padding-left:6px}
  .td-rword{display:none}
}
@media (prefers-reduced-motion:reduce){
  .td-lbar{transition:none}
  #tdWheelRot,#tdWheel .td-labrot{transition:none}
}
"""

head = sub1(head, "\n</style>", CSS + "</style>", "style close")

# ---------------------------------------------------------------- shell ----
i_main = once(src, "\n<main>\n", "main open")
shell = src[i_head:i_main]
shell = sub1(shell, 'data-page="arena"', 'data-page="teamdraft"', "page key")
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "const UD = {" in shell, "lost the Upside Down"
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
    the only criterion. Every number below is read from
    <a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a>.</p>
  </header>
  <div class="p-disclosure"><b>No game has been played.</b> Expected wins are devigged from four books
  and normalized to 272 — a market snapshot, not a forecast this site has graded. The tracker reads
  zero because zero is the true number, and nothing here says who is winning.</div>

  <div id="sheets"></div>
  <div class="td-rail">
    <div class="td-rail-in" id="tdRail" role="group" aria-label="Choose a drafter or a team"></div>
  </div>

  <!-- ============================ THE POOL ============================ -->
  <section id="sheetPool">
    <section class="p-section" id="tracker" style="padding-top:0">
      <header><div><h2>Wins tracker</h2><p class="dek">Each bar is a roster's season against the
        <b>par rule at 34</b> — 272 wins split eight ways. Solid segments are wins actually banked,
        one per draft round; the hatched extension is the season still to play, ending at that
        roster's projection. Nothing is banked yet, so right now every bar is entirely projection —
        and that is the honest shape of it. Scale is fixed at 48 so par never moves.</p></div>
        <div class="p-meta" id="trackMeta" aria-live="polite"></div></header>
      <div class="td-race" id="tdRace"></div>
      <details class="td-disc" id="tdDisc">
        <summary>Round by round, as a table</summary>
        <div class="p-table-wrap"><table class="td-dtable" id="tdTracker"></table></div>
      </details>
    </section>

    <section class="p-section" id="wheel">
      <header><div><h2>Spin wheel</h2><p class="dek">The ring is <b>finishing probability</b> — each
        slice is how often that roster comes first across the simulated seasons in the payload, so the
        wheel is the answer and not a decoration. Press the button and it plays one whole season, 272
        games, and stops on whoever actually won it. Spin it enough and the tally converges on the
        slices.</p></div>
        <div class="p-meta" id="wheelMeta" aria-live="polite"></div></header>
      <div class="td-wheelwrap">
        <div class="td-spinrow">
          <button type="button" class="td-go" id="tdSpin">Spin wheel</button>
          <button type="button" class="td-go ghost" id="tdSpin10">Spin &times;10</button>
          <button type="button" class="td-go ghost" id="tdSpinReset">Reset tally</button>
        </div>
        <div class="td-wheelbox">
          <!-- ⚠️ The viewBox is WIDER THAN TALL on purpose. Labels sit outside the ring
               on leader lines and "Kevin 15.5%" runs well past the rim, so a square
               0 0 300 300 box clips the east and west names to "Rob 19.9" and a bare
               percentage. Do not tidy this back to a square. -->
          <svg id="tdWheel" viewBox="-52 -6 404 312" role="img"
            aria-label="Finishing probability by drafter"></svg>
        </div>
        <p class="td-result" id="tdResult" role="status" aria-live="polite"></p>
        <div class="p-table-wrap"><table class="td-ratio" id="tdRatio"></table></div>
        <p class="td-note" id="tdWheelNote"></p>
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

    <section class="p-section" id="ladder">
      <header><div><h2>Expected wins, all 32</h2><p class="dek">Bars are devigged expected wins,
        anchored at zero. The vertical tick on each bar is the <b>posted line</b> — the gap between
        tick and bar end is the vig coming out, which is why none of these land on a round number.
        The rule at 8.5 is par per team. Colour is the owner and the owner is also written out;
        undrafted teams are hatched.</p></div>
        <div class="p-meta" id="ladderMeta" aria-live="polite"></div></header>
      <div class="td-ladder" id="tdLadder"></div>
      <p class="td-note">Every bar is a button — pick one and the Team sheet opens on it.</p>
    </section>

    <section class="p-section" id="matrix">
      <header><div><h2>Who plays whom</h2><p class="dek">The 32&times;32 head-to-head grid, ordered by
        division so the twice-a-year rivalries form the blocks down the diagonal. This is the visual
        that makes the pool make sense: <b>a game between two teams pays exactly one win</b>, so when
        one person owns both sides it is a win they are guaranteed to collect and guaranteed to lose.
        Those cells are painted in that drafter's colour.</p></div>
        <div class="p-meta" id="matrixMeta" aria-live="polite"></div></header>
      <div class="td-mwrap"><div class="td-matrix" id="tdMatrix" role="grid"
        aria-label="Head-to-head games between all 32 teams"></div></div>
      <div class="td-mlegend">
        <span><i style="background:var(--td-cell1)"></i> one meeting</span>
        <span><i style="background:var(--td-cell2)"></i> two meetings — division rivals</span>
        <span><i style="background:color-mix(in srgb,var(--ink-3) 7%,transparent)"></i> never meet</span>
        <span><i style="background:linear-gradient(135deg,var(--d4) 0 25%,var(--d7) 25% 50%,var(--d2) 50% 75%,var(--d3) 75%)"></i>
          same owner on both sides, in <b>that drafter's</b> colour — the win cancels</span>
      </div>
      <p class="td-note">Hover or focus any cell for the two teams and the weeks they meet.</p>
    </section>

    <section class="p-section" id="board">
      <header><div><h2>The board</h2><p class="dek">Snake order, eight columns, four rounds. Each pick
        carries the gap between the team taken and the best expected wins still on the board at that
        moment. That is a description of the board, not a grade of the pick — and it is a statement
        about <b>draft day</b>, computed against the numbers as they stood then. It will not be
        recomputed against live ratings later, because that would make it retroactively wrong.</p></div>
        <div class="p-meta" id="boardMeta" aria-live="polite"></div></header>
      <div class="td-board" id="tdBoard"></div>
    </section>

    <section class="p-section" id="rosters">
      <header><div><h2>The eight rosters</h2><p class="dek">Sorted by expected wins, which is a market
        snapshot and not a standing. &ldquo;Internal&rdquo; is games the roster plays against
        itself — the wins that cannot help. Every card is a button.</p></div>
        <div class="p-meta" id="standMeta" aria-live="polite"></div></header>
      <div class="td-cards" id="tdCards"></div>
    </section>
  </section>

  <!-- ============================ ONE TEAM ============================ -->
  <section id="sheetTeam" hidden>
    <div class="td-hero" id="tdHero"></div>

    <section class="p-section" id="strip" style="padding-top:0">
      <header><div><h2>Week by week</h2><p class="dek">Seventeen weeks of per-game win probability.
        Games where the same drafter owns <b>both</b> sides are outlined — those are the ones that
        wash. With four strips stacked, a collision lines up vertically.</p></div>
        <div class="p-meta" id="schedMeta" aria-live="polite"></div></header>
      <div class="td-strip" id="tdStrip"></div>
    </section>

    <section class="p-section" id="curve">
      <header><div><h2>How a season lands</h2><p class="dek">Probability mass over final win counts,
        0 through 17, straight from the payload. Season standard deviations sit within a few tenths of
        2.7 across the whole league, so no team here is meaningfully more of a lottery ticket than
        another — they are the same shape slid left and right.</p></div>
        <div class="p-meta" id="curveMeta" aria-live="polite"></div></header>
      <div class="td-plot" id="tdCurves"></div>
      <div class="td-q" id="tdQuant"></div>
      <p class="td-note">These curves are the <em>shape</em> of a season, not a second estimate of its
      total — their means run a little above expected wins for the worst teams and a little below for
      the best, up to 0.36 wins, which is what truncating at 0 and 17 does to a distribution built
      around a mean near the edge.</p>
    </section>

    <section class="p-section" id="gametable">
      <header><div><h2>Every game</h2><p class="dek">The same 17 games as a table, with where each
        number came from.</p></div>
        <div class="p-meta" id="gtMeta"></div></header>
      <div class="p-table-wrap" style="max-height:560px;overflow:auto">
        <table class="td-gtable" id="tdGameTable"></table></div>
    </section>
  </section>

  <!-- ========================= DIAGNOSTICS ========================= -->
  <section id="sheetDiag" hidden>
    <header class="p-hero" style="padding-top:0">
      <h2 style="margin:0 0 8px">What the numbers agree with, and what they don't</h2>
      <p class="p-lead" style="font-size:16px">Every check below is measured off
      <a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a> on the run that built it,
      by <code>scripts/team_draft_pool.py</code>. A diagnostics panel that only ever prints OK is
      decoration, so the ones that report drift are the point.</p>
    </header>
    <div id="tdChecks"></div>

    <section class="p-section" id="perteam">
      <header><div><h2>Every team, every figure</h2><p class="dek">The table view of the same numbers
        the charts draw. <b>Line</b> is what was posted, <b>EW</b> is the devigged expectation,
        <b>&Delta;vig</b> is the difference. <b>&Sigma;p</b> sums the 17 game probabilities.
        <b>&mu;dist</b> is the mean of the win distribution.</p></div>
        <div class="p-meta" id="ptMeta"></div></header>
      <div class="p-table-wrap" style="max-height:640px;overflow:auto">
        <table class="td-dtable" id="tdPerTeam"></table></div>
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
          flatters it: the line carries the hold and this does not. It is frozen at the draft-day
          devig and is never recomputed, because the board's reach and value are claims about that
          day.</li>
        <li><b>Where each game's number comes from</b> — resolved per game, in order: a
          <b>settled</b> result if it has been played; a <b>market</b> price if one exists for an
          unplayed game; the <b>model</b> beyond the market's horizon; and, before the season starts,
          the frozen <b>preseason</b> devig. Every game on the Team sheet carries its own tier. The
          switch is data-driven — one settled game anywhere and the whole payload flips — so no date
          is hardcoded.</li>
        <li><b>Why not just switch to the model in September?</b> Because market primacy does not
          lapse when the season starts. The reason to move off a frozen preseason total is not that
          the model beats the market; it is that a number frozen on 9 August stops being true the
          moment a starting quarterback tears an ACL, and a live pipeline reprices that in a week
          where a snapshot never does.</li>
        <li><b>Win distribution</b> — probability mass by final win count. Its mean sits up to 0.36
          wins from expected wins for the teams at either end, which is what truncation at 0 and 17
          does. Said once, on the distribution, and nowhere else.</li>
        <li><b>Internal games</b> — head-to-head meetings inside one roster, counted off the overlap
          matrix. The only figure here that is purely structural: it does not depend on anybody's
          price being right.</li>
        <li><b>Finishing probabilities</b> — Monte Carlo over the schedule, game by game, on top of
          whatever is already banked. <b>Not a forecast.</b> No tie outcome is modelled, so the
          league's half-win-for-a-tie rule does not appear; and a tie for first is broken at random,
          because the real tiebreakers are playoff wins and point differential and neither is in this
          payload.</li>
        <li><b>Nothing is graded.</b> There is no result on this page, no leaderboard, and no claim
          that any of these prices are right.</li>
      </ul></div>
    </section>

    <section class="p-section" id="machines">
      <header><div><h2>The same page for machines</h2></div></header>
      <div class="machine-box"><ul>
        <li><a href="/data/draft-2026.json"><code>/data/draft-2026.json</code></a> — the whole surface:
          32 teams with line, expected wins, SD, the 0&ndash;17 distribution and a 17-game schedule
          carrying each game's tier; the sparse head-to-head matrix; the draft log; and the derived
          rosters, tracker, board, simulation and diagnostics.</li>
        <li><a href="/data/nfl-schedule.json"><code>/data/nfl-schedule.json</code></a> and
          <a href="/data/survivor.json"><code>/data/survivor.json</code></a> — the results feed and the
          price feed the in-season composite reads. This page holds no copy of either.</li>
        <li><code>scripts/team_draft_pool.py</code> is the pipe, and
          <code>.github/workflows/draft-picks.yml</code> runs it from the Actions tab so recording a
          pick needs no laptop.</li>
      </ul><p class="assumption">This is a private pool between eight people. It is on the public site
      because the arithmetic is interesting, not because anybody can enter it. There is no signup, no
      money handled here, and no contact detail on this page.</p></div>
    </section>
  </section>
</main>
"""

# ---------------------------------------------------------------------------
# DDSheets is LIFTED FROM receipts.html AT BUILD TIME, not pasted. A pasted copy
# is a fork the moment somebody fixes a bug in one of them.
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
   work/build_teamdraft.py. Do not edit it here.
   ============================================================================ */
__DDSHEETS__
</script>
<script>
/* teamdraft.html — the 2026 NFL team draft pool.
 *
 * ONE SOURCE: /data/draft-2026.json. This page does arithmetic in exactly two
 * places — laying out a bar and laying out a curve — and computes no football
 * anywhere. scripts/team_draft_pool.py owns everything else, including which of
 * the four tiers each game's number came from.
 *
 * ⚠️ FAILS LOUD, NEVER QUIET. If the payload cannot be read, every view says so.
 * An empty tracker reads as "nobody has any wins", which is a different claim.
 *
 * ⚠️ Colour is the SECOND channel for drafter identity, never the first. Eight
 * categorical colours cannot be pairwise-distinct under simulated colour-vision
 * deficiency, so every coloured mark is accompanied by a name or a number.
 */
(function(){
  const $ = id => document.getElementById(id);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,
    c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const n2 = v => (v==null || Number.isNaN(v)) ? "—" : Number(v).toFixed(2);
  const n1 = v => (v==null || Number.isNaN(v)) ? "—" : Number(v).toFixed(1);
  const pct = v => (v*100).toFixed(0) + "%";
  const sgn = v => (v>0?"+":"") + Number(v).toFixed(2);

  const DIVS = ["AFC East","AFC North","AFC South","AFC West",
                "NFC East","NFC North","NFC South","NFC West"];
  const TRACK_MAX = 48;                 // fixed, so the par rule never moves week to week

  let D = null, ORDER = [], sheets = null;
  let sel = {kind:"league", id:null};

  const ownerOf = t => D.board.find(b=>b.team===t)?.drafter || null;
  const slotOf  = name => name ? (D.drafters[name]?.slot || 0) : 0;
  const oc      = name => "td-o" + slotOf(name);
  const teamsOf = name => D.drafters[name]?.roster || [];
  const selTeams = () => sel.kind==="team" ? [sel.id]
                       : sel.kind==="drafter" ? teamsOf(sel.id) : [];
  const selOwner = () => sel.kind==="drafter" ? sel.id
                       : sel.kind==="team" ? ownerOf(sel.id) : null;

  /* ---- one tooltip, moved. Shows on hover AND focus. -------------------- */
  const tip = document.createElement("div");
  tip.setAttribute("role","status");
  tip.style.cssText = "position:fixed;z-index:9000;pointer-events:none;opacity:0;"
    + "max-width:260px;padding:8px 10px;border-radius:9px;font-size:12.5px;line-height:1.5;"
    + "background:var(--surface-1);color:var(--ink-1);border:1px solid var(--border);"
    + "box-shadow:0 8px 26px rgba(0,0,0,.34);transition:opacity .09s linear";
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) tip.style.transition = "none";
  document.body.appendChild(tip);
  function tipAt(html,x,y){
    tip.innerHTML = html; tip.style.opacity = "1";
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x+14, innerWidth  - r.width  - 8)) + "px";
    tip.style.top  = Math.max(8, Math.min(y+16, innerHeight - r.height - 8)) + "px";
  }
  const tipOff = () => { tip.style.opacity = "0"; };
  document.addEventListener("mousemove", e=>{
    const el = e.target.closest("[data-tip]");
    if(el) tipAt(el.dataset.tip, e.clientX, e.clientY); else tipOff();
  });
  document.addEventListener("focusin", e=>{
    const el = e.target.closest("[data-tip]"); if(!el) return;
    const r = el.getBoundingClientRect(); tipAt(el.dataset.tip, r.left, r.bottom - 6);
  });
  document.addEventListener("focusout", tipOff);

  /* ---- selection -------------------------------------------------------- */
  function select(kind, id, opts){
    sel = (kind==="league" || (sel.kind===kind && sel.id===id))
        ? {kind:"league", id:null} : {kind, id};
    renderAll();
    /* Clicking a team on the Pool sheet is a request to SEE that team, and the
       detail lives on the other sheet. Chips in the rail do not jump — they are
       a filter for whichever sheet you are already reading. */
    if(opts && opts.jump && sel.kind!=="league" && sheets) sheets.show("team");
  }
  document.addEventListener("click", e=>{
    const el = e.target.closest("[data-sel]");
    if(!el) return;
    const [kind, id] = el.dataset.sel.split(":");
    select(kind, id || null, {jump: el.hasAttribute("data-jump")});
  });

  /* ====================== the control rail ============================== */
  function railHTML(){
    const chips = D.draft_order.map(name=>{
      const v = D.drafters[name], on = sel.kind==="drafter" && sel.id===name;
      return `<button type="button" class="td-chip ${oc(name)}" data-sel="drafter:${esc(name)}"
        aria-pressed="${on}"><span class="sw"></span>${esc(name)}
        <span class="ew">${n2(v.projected)}</span></button>`;
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

  /* ====================== 1 · the wins tracker ========================== */
  /* A race track, not a grid. The question people actually ask during the season
     is "who is ahead and by how much", and a table of sixteen numbers answers it
     slower than eight bars against a rule.

     ⚠️ The scale is FIXED at 48 and does not autoscale to the leader. The whole
     value of the par rule is that it sits in the same place every week; rescaling
     to whoever is hot would move it and destroy the comparison. */
  function race(){
    const W = D.wins_tracker || {};
    const x = v => (Math.max(0, Math.min(TRACK_MAX, v)) / TRACK_MAX * 100);
    const anyPlayed = D.draft_order.some(n=>(W[n]?.total || 0) > 0);
    /* Sort by total once there are totals; draft order before that, because
       sorting eight identical zeros invents a ranking that does not exist. */
    const names = anyPlayed
      ? [...D.draft_order].sort((a,b)=>(W[b].total||0) - (W[a].total||0))
      : [...D.draft_order];

    const ticks = [0,12,24,34,48].map(v=>
      `<span style="left:${x(v)}%">${v}</span>`).join("");

    const rows = names.map(name=>{
      const w = W[name] || {rounds:[null,null,null,null], teams:[], total:0, projected:0};
      const total = w.total || 0, proj = w.projected || 0;
      let acc = 0;
      const segs = (w.rounds||[]).map((v,i)=>{
        if(!v) return "";
        const L = x(acc), Wd = x(acc+v) - x(acc); acc += v;
        return `<span class="td-seg" style="left:${L}%;width:${Wd}%;opacity:${(0.45+i*0.18).toFixed(2)}"
          >${n1(v)}</span>`;
      }).join("");
      /* The season still to play. Preseason this IS the bar — eight empty tracks
         with nothing in them would be the flattest thing on the page, and this is
         the element that opens it. */
      const ghost = proj > total
        ? `<span class="td-ghost" style="left:${x(total)}%;width:${x(proj)-x(total)}%"></span>` : "";
      /* The word "projected" is dropped below 560px — at 375 it runs past the card
         edge and gets visually clipped, and the number alone is unambiguous next to a
         hatched bar. The full phrase stays in the aria-label and the tooltip. */
      const label = `${total ? `<b>${n1(total)}</b>` : ""}<span class="td-rproj">${
          total ? ` of ${n2(proj)}` : n2(proj)
        }<span class="td-rword"> projected</span></span>`;
      const rosterTxt = (w.teams||[]).map((t,i)=>
        t ? `R${i+1} ${t}${w.rounds[i]!=null?` ${n1(w.rounds[i])}`:""}` : `R${i+1} —`).join(" · ");
      const alt = `${name}: ${anyPlayed
        ? `${(w.rounds||[]).map((v,i)=>`round ${i+1} ${v==null?"no pick":n1(v)}`).join(", ")}, total ${n1(total)}`
        : `no games played, projected ${n2(proj)}`}, par 34.`;
      return `<button type="button" class="td-rrow ${oc(name)}" data-sel="drafter:${esc(name)}"
          aria-label="${esc(alt)}"
          data-tip="<b>${esc(name)}</b><br>${esc(rosterTxt)}<br>projected ${n2(proj)} · par ${n2(D.par)}">
        <span class="td-rlab"><i></i>${esc(name)}</span>
        <span class="td-rtrack">
          ${segs}${ghost}
          <span class="td-rpar" style="left:${x(D.par)}%"></span>
          <span class="td-rtot" style="left:${x(Math.max(total, proj))}%">${label}</span>
        </span>
      </button>`;
    }).join("");

    $("tdRace").innerHTML = `<div class="td-scale">${ticks}</div>${rows}
      <div class="td-rfoot">
        <span>&#9650; the vertical rule is <b>par — ${n2(D.par)}</b></span>
        <span>scale fixed 0&ndash;${TRACK_MAX}</span>
        <span>a tie counts <b>half</b> a win</span>
      </div>`;

    $("trackMeta").textContent = anyPlayed
      ? `${D.basis.settled_games} of ${D.basis.total_games} games played`
      : `no games played · bars are projection only`;

    /* the disclosure table — round by round, which the bars deliberately compress */
    const head = `<thead><tr><th>Drafter</th><th>R1</th><th>R2</th><th>R3</th><th>R4</th>
      <th>Total</th><th>Projected</th></tr></thead>`;
    const body = names.map(name=>{
      const w = W[name] || {rounds:[], teams:[], total:0, projected:0};
      const cells = (w.rounds||[]).map((v,i)=>{
        const t = (w.teams||[])[i];
        return `<td>${v==null ? "—" : n1(v)}${t?` <span class="td-tierchip">${esc(t)}</span>`:""}</td>`;
      }).join("");
      return `<tr class="${oc(name)}"><td><span class="sw"></span>${esc(name)}</td>${cells}
        <td><b>${n1(w.total||0)}</b></td><td>${n2(w.projected)}</td></tr>`;
    }).join("");
    $("tdTracker").innerHTML = head + `<tbody>${body}</tbody>`;
  }

  /* ====================== 2 · roster cards ============================== */
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

  /* ====================== 3 · the ring ================================== */
  const REF = () => D.simulation?.drafters || {};
  let slices = [], wheelRot = 0, spins = 0, tally = {}, tieSpins = 0, spinning = false;
  let GAMES = [], NAMES = [], BANKED = [];

  function buildGames(){
    NAMES = [...D.draft_order];
    const slot = {};
    NAMES.forEach((n,i)=> teamsOf(n).forEach(t=>{ slot[t] = i; }));
    BANKED = NAMES.map(n=>Number(D.drafters[n].banked || 0));
    GAMES = [];
    for(const [t,T] of Object.entries(D.teams))
      for(const g of T.schedule){
        if(t >= g.opp || g.settled) continue;   // settled games are banked, not replayed
        GAMES.push([slot[t] === undefined ? -1 : slot[t],
                    slot[g.opp] === undefined ? -1 : slot[g.opp],
                    g.live != null ? g.live : g.wp]);
      }
  }
  function season(){
    const s = BANKED.slice();
    for(let i=0;i<GAMES.length;i++){
      const g = GAMES[i], w = Math.random() < g[2] ? g[0] : g[1];
      if(w >= 0) s[w]++;
    }
    const order = s.map((v,i)=>[v, Math.random(), i])
                   .sort((a,b)=> b[0]-a[0] || a[1]-b[1]).map(x=>x[2]);
    return {wins:s, order, tied: s.filter(v=>v === s[order[0]]).length > 1};
  }

  function layout(){
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
  const CX = 150, CY = 150, R = 108, HUB = 56;
  const pt = (deg, r) => {
    const a = (deg - 90) * Math.PI/180;
    return [CX + r*Math.cos(a), CY + r*Math.sin(a)];
  };
  /* A donut wedge: outer arc forward, inner arc back. The hole is what retires the
     second-place needle — there is no centre left to put one in, which is the
     correct outcome given P(2nd) ranks almost identically to P(1st). */
  function wedge(from, to){
    if(to - from >= 359.999){
      return `M${CX} ${CY-R} A${R} ${R} 0 1 1 ${CX-0.01} ${CY-R} Z`
           + `M${CX} ${CY-HUB} A${HUB} ${HUB} 0 1 0 ${CX-0.01} ${CY-HUB} Z`;
    }
    const [x1,y1] = pt(from,R), [x2,y2] = pt(to,R);
    const [x3,y3] = pt(to,HUB), [x4,y4] = pt(from,HUB);
    const big = (to-from) > 180 ? 1 : 0;
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 ${big} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
         + ` L${x3.toFixed(2)} ${y3.toFixed(2)} A${HUB} ${HUB} 0 ${big} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
  }

  function drawWheel(){
    const selName = selOwner();
    const wedges = slices.map(s=>
      `<path class="td-slice ${oc(s.name)} ${selName && s.name!==selName ? "dim":""}"
        d="${wedge(s.from, s.to)}" fill="var(--own)" data-sel="drafter:${esc(s.name)}"
        data-tip="<b>${esc(s.name)}</b><br>first in ${(s.p*100).toFixed(1)}% of simulated seasons"/>`
    ).join("");

    /* ⚠️ LABELS LIVE OUTSIDE THE RING, on a leader line. Alan's slice is under 3%
       and text will never fit inside it; inside-labelling clipped names to "Ja|on"
       in the mockup. Each label is translated into place then counter-rotated by the
       wheel's own angle so it stays upright while the rim turns. */
    const labs = slices.filter(s=>s.frac > 0.012).map(s=>{
      const [ex,ey] = pt(s.mid, R+3), [lx,ly] = pt(s.mid, R+16);
      const c = Math.cos((s.mid-90)*Math.PI/180);
      const anch = c > 0.15 ? "start" : c < -0.15 ? "end" : "middle";
      const dx = anch==="start" ? 4 : anch==="end" ? -4 : 0;
      return `<g class="${oc(s.name)}">
        <line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}"
          stroke="var(--own)" stroke-width="1.2" opacity=".8"/>
        <g transform="translate(${(lx+dx).toFixed(1)} ${(ly+3.5).toFixed(1)})">
          <g class="td-labrot" style="transform:rotate(${-wheelRot}deg)">
            <text class="td-wlab" text-anchor="${anch}">${esc(s.name)}
              <tspan class="td-wpct">${(s.p*100).toFixed(1)}%</tspan></text>
          </g></g></g>`;
    }).join("");

    $("tdWheel").innerHTML =
      `<g id="tdWheelRot" style="transform:rotate(${wheelRot}deg);transform-origin:${CX}px ${CY}px">
         ${wedges}${labs}
       </g>
       <circle cx="${CX}" cy="${CY}" r="${HUB}" fill="var(--surface-1)"
         stroke="var(--border)" stroke-width="1.5"/>
       <text x="${CX}" y="${CY-8}" text-anchor="middle" fill="var(--ink-3)"
         font-family="ui-monospace,monospace" font-size="9.5" letter-spacing="1.6">FINISHES</text>
       <text x="${CX}" y="${CY+14}" text-anchor="middle" fill="var(--ink-1)"
         font-family="ui-monospace,monospace" font-size="19" font-weight="700">FIRST</text>
       <!-- one needle, fixed at 12 o'clock; the ring turns under it. Tip points DOWN
            into the rim and the whole triangle stays inside the viewBox. -->
       <path d="M${CX} ${CY-R-5} L${CX+10} ${CY-R-25} L${CX-10} ${CY-R-25} Z" fill="var(--accent)"/>`;

    const zero = slices.filter(s=>s.p === 0).map(s=>s.name);
    $("tdWheelNote").innerHTML = zero.length
      ? `${zero.map(esc).join(" and ")} have no slice: across
         ${D.simulation.trials.toLocaleString()} simulated seasons they never finished first.
         A spin can still land there — the ring shows the stored probability, the spin plays a
         real season — and the banner would say so.`
      : `Slices are the stored ${D.simulation.trials.toLocaleString()}-season reference in the
         payload. Each spin is a fresh season played in your browser off the same probabilities.`;
  }

  /* Second place as a COLUMN, not a needle. P(2nd) ranks almost identically to
     P(1st), so a second needle would draw the same picture twice in the hardest
     place to read it. The RATIO is the part that carries information: above 1.00
     means a roster is likelier to place than to win. */
  function ratio(){
    const ref = REF();
    const rows = NAMES.map(n=>({n, ...ref[n], ew:D.drafters[n].ew}))
      .sort((a,b)=>(b.p_first||0)-(a.p_first||0));
    const top = Math.max(...rows.map(r=>r.p_first||0), 0.0001);
    $("tdRatio").innerHTML =
      `<thead><tr><th>Drafter</th><th>EW</th><th>1st</th><th>2nd</th><th>2nd&divide;1st</th></tr></thead>`
      + `<tbody>${rows.map(r=>{
        const on = (sel.kind==="drafter" && sel.id===r.n)
                || (sel.kind==="team" && ownerOf(sel.id)===r.n);
        const rat = r.p_first ? (r.p_second/r.p_first) : null;
        return `<tr class="${oc(r.n)} ${on?"on":""}">
          <td><span class="sw"></span>${esc(r.n)}</td>
          <td>${n2(r.ew)}</td>
          <td>${((r.p_first||0)*100).toFixed(1)}%
            <span class="td-bar"><span style="width:${((r.p_first||0)/top*100).toFixed(1)}%"></span></span></td>
          <td>${((r.p_second||0)*100).toFixed(1)}%</td>
          <td class="${rat==null?"":rat>1?"hi":"lo"}">${rat==null?"—":rat.toFixed(2)}</td></tr>`;
      }).join("")}</tbody>`;
    $("wheelMeta").textContent = spins
      ? `${spins} spin${spins===1?"":"s"} · ${tieSpins} ended tied for first`
      : `${D.simulation.trials.toLocaleString()} stored seasons · press the button to play one`;
  }

  function spin(){
    if(spinning) return;
    const r = season();
    const win = NAMES[r.order[0]], run = NAMES[r.order[1]];
    const iw = slices.findIndex(s=>s.name === win);
    const turns = 4 + Math.floor(Math.random()*3);
    wheelRot += turns*360 + ((-(slices[iw].mid + wheelRot)) % 360 + 360) % 360;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rot = $("tdWheelRot");
    if(reduce) rot.style.transition = "none";
    rot.style.transform = `rotate(${wheelRot}deg)`;
    document.querySelectorAll("#tdWheel .td-labrot").forEach(el=>{
      if(reduce) el.style.transition = "none";
      el.style.transform = `rotate(${-wheelRot}deg)`;
    });

    spins++; tally[win] = (tally[win] || 0) + 1;
    if(r.tied) tieSpins++;

    $("tdResult").className = "td-result " + oc(win);
    $("tdResult").innerHTML =
      `<span class="big">${esc(win)} wins it with ${n1(r.wins[r.order[0]])}.</span>`
      + `${esc(run)} takes second on ${n1(r.wins[r.order[1]])}`
      + (r.tied ? ` — <b>and this one was a tie at the top</b>, broken at random here because the
          league breaks it on playoff wins and then point differential.` : `.`)
      + ` One simulated season, 272 games. <b>Not a prediction.</b>`
      + `<br><span style="color:var(--ink-3)">${spins} spin${spins===1?"":"s"} so far · `
      + NAMES.filter(n=>tally[n]).sort((a,b)=>tally[b]-tally[a])
             .map(n=>`${esc(n)} ${tally[n]}`).join(" · ") + `</span>`;
    ratio();

    spinning = true;
    setTimeout(()=>{ spinning = false; }, reduce ? 60 : 3650);
  }

  /* ====================== 4 · monte carlo =============================== */
  let mcRun = null, LAST_MC = null;

  function mcTable(res, trials){
    const ref = REF();
    const rows = NAMES.map((n,i)=>({n, i, ...res[i]}))
      .sort((a,b)=> b.first - a.first || b.mean - a.mean);
    $("tdMc").innerHTML =
      `<thead><tr><th>Drafter</th><th>Roster</th><th>Mean wins</th><th>p10</th><th>p90</th>
        <th>1st</th><th>2nd</th><th>Paid</th><th>Stored 1st</th></tr></thead><tbody>`
      + rows.map(r=>{
        const on = (sel.kind==="drafter" && sel.id===r.n)
                || (sel.kind==="team" && ownerOf(sel.id)===r.n);
        return `<tr class="${oc(r.n)} ${on?"on":""}"><td><span class="sw"></span>${esc(r.n)}</td>
          <td>${teamsOf(r.n).map(esc).join(" ") || "—"}</td>
          <td>${r.mean.toFixed(2)}</td><td>${n1(r.p10)}</td><td>${n1(r.p90)}</td>
          <td>${(r.first/trials*100).toFixed(1)}%</td>
          <td>${(r.second/trials*100).toFixed(1)}%</td>
          <td>${((r.first+r.second)/trials*100).toFixed(1)}%</td>
          <td style="color:var(--ink-3)">${((ref[r.n]?.p_first||0)*100).toFixed(1)}%</td></tr>`;
      }).join("") + `</tbody>`;
  }

  function mcPlot(res, trials){
    const W = 720, H = 210, PL = 34, PR = 12, PT = 12, PB = 26;
    const iw = W-PL-PR, ih = H-PT-PB;
    const lo = Math.min(...res.map(r=>r.lo)), hi = Math.max(...res.map(r=>r.hi));
    const span = Math.max(1, hi - lo);
    const top = Math.max(...res.flatMap(r=>[...r.hist.values()].map(c=>c/trials)));
    const X = w => PL + (w-lo)/span * iw;
    const Y = p => PT + ih - (p/top) * ih;
    const on = selOwner();
    const line = r => {
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
           fill="var(--ink-3)" font-size="9.5" font-family="ui-monospace,monospace">par ${n2(D.par)}</text>`
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
    const res = NAMES.map(()=>({first:0, second:0, sum:0, hist:new Map(), lo:1e9, hi:-1e9,
                                mean:0, p10:0, p90:0}));
    let done = 0, ties = 0;
    const CHUNK = 1500;
    function step(){
      const end = Math.min(done + CHUNK, trials);
      for(; done < end; done++){
        const r = season();
        if(r.tied) ties++;
        res[r.order[0]].first++;
        res[r.order[1]].second++;
        for(let i=0;i<NAMES.length;i++){
          const w = r.wins[i], a = res[i];
          a.sum += w; a.hist.set(w, (a.hist.get(w)||0) + 1);
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
         that gap <em>is</em> the sampling error, and it shrinks as you raise the trial count. The
         stored figure is ${D.simulation.trials.toLocaleString()} seasons at seed
         ${D.simulation.seed}. Neither has a tie OUTCOME: every game is decided, so the league's
         rule that a tied game counts half is not modelled.`;
      prog.hidden = true; prog.firstElementChild.style.width = "0";
      btns.forEach(b=>{ b.disabled = false; });
      mcRun = null;
    }
    step();
  }

  /* ====================== 5 · the ladder ================================ */
  function ladder(){
    const rows = Object.keys(D.teams).sort((a,b)=>D.teams[b].ew - D.teams[a].ew);
    const top  = Math.max(...rows.map(t=>Math.max(D.teams[t].ew, D.teams[t].line)));
    const MAX  = Math.ceil(top) + 1;
    const x    = v => (v / MAX * 100).toFixed(2) + "%";
    const on   = new Set(selTeams());
    /* ⚠️ PER-TEAM par, not per-drafter. `D.par` is 34.00 — one roster of four — and
       this is a chart of single teams, so the rule is the league total over 32. */
    const TEAM_PAR = D.total_wins / rows.length;

    $("tdLadder").className = "td-ladder" + (sel.kind==="league" ? "" : " sel");
    $("tdLadder").innerHTML = rows.map((t,i)=>{
      const T = D.teams[t], own = ownerOf(t);
      const cls = [oc(own), on.has(t)?"on":"", own?"":"und"].filter(Boolean).join(" ");
      const txt = `<b>${esc(T.name)}</b><br>expected wins ${n2(T.ew)} · posted line ${n2(T.line)}`
        + `<br>${own?`drafted by ${esc(own)}`:"still on the board"}`;
      return `<button type="button" class="td-row ${cls}" data-sel="team:${esc(t)}" data-jump
          data-tip="${txt.replace(/"/g,"&quot;")}"
          aria-label="${esc(T.name)}, ${n2(T.ew)} expected wins, ${own?"drafted by "+esc(own):"undrafted"}">
        <span class="td-rank">${i+1}</span>
        <span class="td-abbr">${esc(t)}</span>
        <span class="td-track">
          <span class="td-lbar" style="width:${x(T.ew)}"></span>
          <span class="td-tick" style="left:${x(T.line)}"></span>
        </span>
        <span class="td-ew">${n2(T.ew)}</span>
        <span class="td-own">${own?esc(own):"—"}</span>
      </button>`;
    }).join("");

    const t0 = $("tdLadder").querySelector(".td-track");
    if(t0){
      const wrap = $("tdLadder").getBoundingClientRect(), tr = t0.getBoundingClientRect();
      const left = (tr.left - wrap.left) + tr.width * TEAM_PAR / MAX;
      $("tdLadder").insertAdjacentHTML("beforeend",
        `<span class="td-par" style="left:${left.toFixed(1)}px"></span>`
        + `<span class="td-parlab" style="left:${left.toFixed(1)}px">par ${TEAM_PAR.toFixed(1)}</span>`);
    }
    $("ladderMeta").textContent = sel.kind==="league"
      ? `32 teams · scale 0–${MAX} wins` : `${on.size} of 32 highlighted`;
  }

  /* ====================== 6 · the matrix ================================ */
  function matrix(){
    const cell = (a,b) => (D.overlap[a] && D.overlap[a][b]) || 0;
    const on = new Set(selTeams());
    const out = [`<div class="td-mr" style="height:38px"></div>`];
    ORDER.forEach((t,i)=>{
      out.push(`<div class="td-mh ${oc(ownerOf(t))} ${on.has(t)?"own":""} ${i%4===0&&i?"dv":""}"
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
        const cls = ["td-c", a===b?"diag":(g===2?"g2":g===1?"g1":""), same?"self":"",
                     same?oc(ownA):"", both?"in":"", c%4===0&&c?"dv":"", r%4===0&&r?"dh":""]
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
        ? `${sel.id}: ${v.internal_games} internal game${v.internal_games>1?"s":""} inside the roster`
        : `${sel.id}: no internal games — nothing in this roster cancels`;
    } else if(sel.kind==="team"){
      const own = ownerOf(sel.id);
      const rivals = own ? teamsOf(own).filter(t=>t!==sel.id && cell(sel.id,t)>0) : [];
      $("matrixMeta").textContent = rivals.length
        ? `${sel.id} meets ${own}'s own ${rivals.join(" and ")}`
        : `${sel.id} plays nobody else on ${own?own+"'s roster":"any one roster"}`;
    } else {
      const tot = D.draft_order.reduce((a,n)=>a+D.drafters[n].internal_games,0);
      $("matrixMeta").textContent = `${tot} of ${D.total_wins} games have the same owner on both sides`;
    }
  }

  /* ====================== 7 · the board ================================= */
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
        const best = b.delta === 0, cls = best ? "best" : (b.delta <= -1 ? "reach" : "");
        const txt = `<b>Pick ${b.pick} · ${esc(b.drafter)}</b><br>${esc(D.teams[b.team].name)} — `
          + `${n2(b.ew)} expected wins<br>best available was ${esc(b.best_available)} at `
          + `${n2(b.best_available_ew)}<br>${esc(b.team)} was #${b.rank_at_pick} of `
          + `${b.available_at_pick} left on the board`;
        cells += `<button type="button" class="td-bc ${oc(name)} ${on.has(b.team)?"on":""}"
            data-sel="team:${esc(b.team)}" data-jump data-tip="${txt.replace(/"/g,"&quot;")}">
          <span class="n">${b.pick}</span><span class="t">${esc(b.team)}</span>
          <span class="e">${n2(b.ew)} EW</span>
          <span class="d ${cls}">${best ? "best available" : n2(b.delta)}</span></button>`;
      }
    }
    const el = $("tdBoard");
    el.className = "td-board" + (sel.kind==="league" ? "" : " sel");
    el.innerHTML = head + cells;
    const made = D.board.filter(b=>b.team);
    $("boardMeta").textContent = `${made.length} picks · ${made.filter(b=>b.delta===0).length} took the `
      + `board's best remaining · ${made.filter(b=>b.delta <= -1).length} passed on a full win or more`;
  }

  /* ====================== the Team sheet ================================ */
  /* Everything here is about ONE team or ONE roster. The old page defaulted these
     to all 32 at once, which is a wall of identical curves answering a question
     nobody asked. */
  function teamSheet(){
    const list = selTeams();
    if(!list.length){
      $("tdHero").className = "td-hero";
      $("tdHero").innerHTML = `<h2>Pick a team</h2><p class="sub">Use the rail above, or click any
        bar on the ladder. This sheet is the one-team view — the week-by-week strip, the season
        curve and the full schedule.</p>`;
      ["tdStrip","tdCurves","tdGameTable"].forEach(id=>{ $(id).innerHTML =
        `<div class="td-empty">Nothing selected.</div>`; });
      $("tdQuant").innerHTML = "";
      ["schedMeta","curveMeta","gtMeta"].forEach(id=>{ $(id).textContent = ""; });
      return;
    }
    hero(); strip(); curves(); gameTable();
  }

  function hero(){
    const own = selOwner();
    $("tdHero").className = "td-hero " + (own ? oc(own) : "");
    const stat = (v,l) => `<div class="td-hstat"><b>${v}</b><span>${l}</span></div>`;
    if(sel.kind==="team"){
      const T = D.teams[sel.id];
      $("tdHero").innerHTML = `<h2>${esc(T.name)}</h2>
        <p class="sub">${esc(T.division)} · ${own?`drafted by ${esc(own)}`:"still on the board"}</p>
        <div class="td-hstats">${stat(n2(T.ew),"expected wins")}${stat(n2(T.line),"posted line")}
          ${stat(sgn(T.ew-T.line),"vig")}${stat(n2(T.sd),"season SD")}
          ${stat(`${T.p10}–${T.p90}`,"p10 to p90")}${stat(n2(T.projected),"projected")}</div>`;
    } else {
      const v = D.drafters[sel.id];
      $("tdHero").innerHTML = `<h2>${esc(sel.id)}</h2>
        <p class="sub">${v.roster.map(esc).join(" · ") || "no picks yet"}${
          v.picks_remaining?` · ${v.picks_remaining} pick${v.picks_remaining>1?"s":""} left`:""}</p>
        <div class="td-hstats">${stat(n2(v.ew),"expected wins")}${stat(sgn(v.par_delta),"vs par")}
          ${stat(v.internal_games,"internal games")}
          ${stat(n2(v.sd_sim!=null?v.sd_sim:v.sd_model),"roster SD")}
          ${stat(n1(v.banked),"banked")}${stat(n2(v.projected),"projected")}</div>`;
    }
  }

  function strip(){
    const weeks = Array.from({length:18},(_,i)=>i+1);
    const list = selTeams(), own = selOwner();
    const mate = new Set(own ? teamsOf(own) : []);
    const head = `<div class="td-srow head"><span></span>`
      + weeks.slice(0,17).map(w=>`<span class="td-wk">${w}</span>`).join("") + `</div>`;
    let clashes = 0;
    const rows = list.map(t=>{
      const byWeek = {};
      D.teams[t].schedule.forEach(g=>{ byWeek[g.week] = g; });
      const cells = weeks.filter(w=>w<=17 || byWeek[w]).slice(0,17).map(w=>{
        const g = byWeek[w];
        if(!g) return `<span class="td-g bye"><span class="op">BYE</span><span class="p">—</span></span>`;
        const clash = mate.has(g.opp) && g.opp!==t;
        if(clash) clashes++;
        const p = g.live != null ? g.live : g.wp;
        const txt = `<b>Week ${w}</b><br>${esc(t)} ${g.home?"vs":"at"} ${esc(g.opp)}`
          + `<br>${g.settled?`<b>final</b>`:`win probability ${(p*100).toFixed(1)}%`}`
          + `<br>basis: ${esc(g.tier||"preseason")}`
          + (clash?`<br><b>${esc(own)} owns both sides.</b>`:"");
        return `<span class="td-g ${clash?"clash":""} ${g.settled?"done":""}"
          data-tip="${txt.replace(/"/g,"&quot;")}">
          <span class="op">${g.home?"":`<span class="at">@</span>`}${esc(g.opp)}</span>
          <span class="p">${g.settled ? (p>=1?"W":p<=0?"L":"T") : pct(p)}</span></span>`;
      }).join("");
      return `<div class="td-srow ${oc(ownerOf(t))}">
        <span class="td-slab"><span class="dot"></span>${esc(t)}</span>${cells}</div>`;
    }).join("");
    $("tdStrip").innerHTML = head + rows;
    const games = sel.kind==="team" ? clashes : Math.round(clashes/2);
    $("schedMeta").textContent = games
      ? `${games} self-cancelling game${games===1?"":"s"} in view`
      : `no self-cancelling games in view`;
  }

  function curves(){
    const W = 720, H = 250, PL = 34, PR = 12, PT = 12, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const on = selTeams();
    const top = Math.max(...on.map(t=>Math.max(...Object.values(D.teams[t].dist))));
    const X = w => PL + (w/17) * iw;
    const Y = p => PT + ih - (p/top) * ih;
    const path = t => Array.from({length:18},(_,w)=>
      `${w?"L":"M"}${X(w).toFixed(1)} ${Y(D.teams[t].dist[w]||0).toFixed(1)}`).join(" ");
    const grid = Array.from({length:18},(_,w)=> w%2 ? "" :
      `<line x1="${X(w)}" y1="${PT}" x2="${X(w)}" y2="${PT+ih}" stroke="var(--grid)" stroke-width="1"/>`
      + `<text x="${X(w)}" y="${H-8}" text-anchor="middle" fill="var(--ink-3)"
          font-size="10" font-family="ui-monospace,monospace">${w}</text>`).join("");
    const fore = on.map(t=>{
      return `<g class="${oc(ownerOf(t))}">`
        + `<path d="${path(t)}" fill="none" stroke="var(--surface-1)" stroke-width="5"
             stroke-linejoin="round"/>`
        + `<path d="${path(t)}" fill="none" stroke="var(--own)" stroke-width="2"
             stroke-linejoin="round"/></g>`;
    }).join("");
    const labels = on.map((t,i)=>{
      const T = D.teams[t], px = X(T.p50), py = Y(T.dist[T.p50]||0);
      const ly = Math.max(PT + 9, py - 12 - (i % 4) * 14);
      return `<g class="${oc(ownerOf(t))}">
        <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${px.toFixed(1)}"
          y2="${(ly+3).toFixed(1)}" stroke="var(--own)" stroke-width="1" opacity=".55"/>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="var(--own)"
          stroke="var(--surface-1)" stroke-width="2"/>
        <text x="${px.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="var(--ink-1)"
          font-size="11" font-weight="700" paint-order="stroke" stroke="var(--surface-1)"
          stroke-width="3" font-family="ui-monospace,monospace">${esc(t)}</text></g>`;
    }).join("");
    $("tdCurves").innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet"
         aria-label="Probability of each final win total, 0 to 17">
        ${grid}
        <line x1="${PL}" y1="${PT+ih}" x2="${PL+iw}" y2="${PT+ih}" stroke="var(--axis)" stroke-width="1"/>
        <text x="${PL-6}" y="${PT+8}" text-anchor="end" fill="var(--ink-3)" font-size="10"
          font-family="ui-monospace,monospace">${(top*100).toFixed(0)}%</text>
        <text x="${PL-6}" y="${PT+ih}" text-anchor="end" fill="var(--ink-3)" font-size="10"
          font-family="ui-monospace,monospace">0</text>
        ${fore}${labels}</svg>`;
    $("tdQuant").innerHTML = on.map(t=>{
      const T = D.teams[t];
      return `<span class="td-qi ${oc(ownerOf(t))}"><i></i>${esc(t)}
        p10 <b>${T.p10}</b> · p50 <b>${T.p50}</b> · p90 <b>${T.p90}</b> · SD <b>${n2(T.sd)}</b></span>`;
    }).join("");
    $("curveMeta").textContent = `${on.length} curve${on.length===1?"":"s"} · 0–17 wins`;
  }

  function gameTable(){
    const list = selTeams();
    const rows = list.flatMap(t=>D.teams[t].schedule.map(g=>({t, ...g})))
      .sort((a,b)=>a.week-b.week || a.t.localeCompare(b.t));
    const own = selOwner(), mate = new Set(own ? teamsOf(own) : []);
    $("tdGameTable").innerHTML =
      `<thead><tr><th>Wk</th><th>Team</th><th>Opponent</th><th>H/A</th><th>Win prob</th>
        <th>Basis</th></tr></thead><tbody>`
      + rows.map(g=>{
        const p = g.live != null ? g.live : g.wp;
        const clash = mate.has(g.opp) && g.opp!==g.t;
        return `<tr class="${oc(ownerOf(g.t))}"><td>${g.week}</td>
          <td><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;
            background:var(--own);margin-right:6px"></span>${esc(g.t)}</td>
          <td>${esc(g.opp)}${clash?` <b style="color:var(--own)">· same owner</b>`:""}</td>
          <td>${g.home?"home":"away"}</td>
          <td>${g.settled ? (p>=1?"won":p<=0?"lost":"tied") : (p*100).toFixed(1)+"%"}</td>
          <td><span class="td-tierchip ${esc(g.tier||"")}">${esc(g.tier||"preseason")}</span></td></tr>`;
      }).join("") + `</tbody>`;
    $("gtMeta").textContent = `${rows.length} games · basis per game`;
  }

  /* ====================== diagnostics + rules =========================== */
  let DATED = {};
  function diagnostics(){
    const dg = D.diagnostics || {checks:[]};
    $("tdChecks").innerHTML = dg.checks.map(c=>{
      const kind = c.ok ? "ok" : (c.severity === "hard" ? "bad" : "known");
      const word = c.ok ? "holds" : (c.severity === "hard" ? "broken" : "known drift");
      return `<div class="td-chk ${kind}"><h4>${esc(c.label)}<em>${word}</em></h4>
        <p>${esc(c.detail)}</p></div>`;
    }).join("");
    const rows = Object.keys(D.teams).sort((a,b)=>D.teams[b].ew - D.teams[a].ew).map(t=>{
      const T = D.teams[t], own = ownerOf(t);
      const sp = T.schedule.reduce((a,g)=>a+g.wp, 0);
      const mass = Object.values(T.dist).reduce((a,p)=>a+p, 0);
      const mu = Object.entries(T.dist).reduce((a,[w,p])=>a + Number(w)*p, 0) / mass;
      const big = v => Math.abs(v) >= 0.3 ? ' class="td-drift"' : "";
      return `<tr class="${oc(own)}"><td><span class="sw"></span>${esc(t)}</td>
        <td>${own?esc(own):"—"}</td><td>${n2(T.line)}</td><td>${n2(T.ew)}</td>
        <td>${sgn(T.ew - T.line)}</td><td>${n2(T.sd)}</td>
        <td>${n2(sp)}</td><td${big(sp-T.ew)}>${sgn(sp-T.ew)}</td>
        <td>${n2(mu)}</td><td${big(mu-T.ew)}>${sgn(mu-T.ew)}</td></tr>`;
    }).join("");
    $("tdPerTeam").innerHTML = `<thead><tr><th>Team</th><th>Owner</th><th>Line</th><th>EW</th>
      <th>&Delta;vig</th><th>SD</th><th>&Sigma;p</th><th>drift</th><th>&mu;dist</th><th>drift</th>
      </tr></thead><tbody>${rows}</tbody>`;
    $("ptMeta").textContent = `32 rows · from /data/draft-2026.json as_of ${esc(DATED.as_of)}`;
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
  function renderAll(){
    $("tdRail").innerHTML = railHTML();
    $("tdTeamPick").addEventListener("change", e=>{
      const v = e.target.value;
      sel = v ? {kind:"team", id:v} : {kind:"league", id:null};
      renderAll();
    });
    race(); cards(); drawWheel(); ratio(); ladder(); matrix(); board(); teamSheet();
    if(LAST_MC){ mcTable(LAST_MC.res, LAST_MC.trials); mcPlot(LAST_MC.res, LAST_MC.trials); }
  }

  function fail(msg){
    ["tdRace","tdCards","tdWheel","tdMc","tdLadder","tdMatrix","tdBoard","tdChecks",
     "tdStrip","tdCurves","tdGameTable","tdResult"].forEach(id=>{
      const el = $(id); if(el) el.innerHTML =
        `<div class="p-error">The draft payload could not be read, so this view is empty rather
         than wrong: ${esc(msg)}</div>`; });
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

    $("tdResult").innerHTML = D.picks_made < D.picks_total
      ? `<span class="big">${D.picks_total - D.picks_made} picks still to come.</span>
         The ring already works, but it is turning on <b>partial rosters</b>. These slices describe
         the board as it stands and will move when the rest of the draft lands.`
      : `<span class="big">Press the button.</span> Every spin plays one full season — all
         ${D.total_wins} games — and stops on whoever won it.`;

    $("tdSpin").addEventListener("click", spin);
    $("tdSpin10").addEventListener("click", ()=>{
      /* Ten seasons, one animation. The tally is the point of a run this size, and
         ten consecutive 3.6-second spins is not a feature. */
      for(let i=0;i<9;i++){
        const r = season();
        tally[NAMES[r.order[0]]] = (tally[NAMES[r.order[0]]] || 0) + 1;
        spins++; if(r.tied) tieSpins++;
      }
      spin();
    });
    $("tdSpinReset").addEventListener("click", ()=>{
      spins = 0; tieSpins = 0; tally = {}; ratio();
    });
    document.querySelectorAll("[data-mc]").forEach(btn=>
      btn.addEventListener("click", ()=> runMC(Number(btn.dataset.mc))));

    sheets = DDSheets({key:"teamdraft", mount:"#sheets",
      sheets:[{id:"pool",  label:"The pool",       panel:"#sheetPool"},
              {id:"team",  label:"One team",       panel:"#sheetTeam"},
              {id:"diag",  label:"Diagnostics",    panel:"#sheetDiag", hint:"what drifts"},
              {id:"rules", label:"Rules & method", panel:"#sheetRules"}],
      onShow(id){
        /* Opening the Team sheet with nothing chosen would show an empty page, so it
           lands on the top of the ladder rather than on a prompt. */
        if(id === "team" && sel.kind === "league"){
          const top = Object.keys(D.teams).sort((a,b)=>D.teams[b].ew - D.teams[a].ew)[0];
          sel = {kind:"team", id:top};
          renderAll();
        }
      }});

    let rz; addEventListener("resize", ()=>{ clearTimeout(rz); rz = setTimeout(ladder, 140); });
  }
  load();
})();
</script>"""

SCRIPT = SCRIPT.replace("__DDSHEETS__", DDSHEETS.rstrip())

out = head + shell + MAIN + foot_open + SCRIPT + foot_close

# ---------------------------------------------------------------- guards ----
assert out.count("<main>") == 1 and out.count("</main>") == 1
for pid in ("sheetPool", "sheetTeam", "sheetDiag", "sheetRules"):
    assert out.count(f'id="{pid}"') == 1, f"{pid} missing or duplicated"
for eid in ("tdRace", "tdWheel", "tdMatrix", "tdLadder", "tdMc", "tdRatio", "tdGameTable"):
    assert out.count(f'id="{eid}"') == 1, f"{eid} missing or duplicated"
assert out.count("window.DDSheets = function") == 1, "DDSheets went missing or doubled"
assert out.count('"teamdraft":"/data/draft-2026.json"') == 1
assert out.count('data-page="teamdraft"') == 1
assert "arenaCards" not in out, "arena's own script came along"
# The tracker's ceiling is fixed on purpose; autoscaling would move the par rule.
assert "TRACK_MAX = 48" in out and "Math.max(...names" not in out
# The simulation must read the live basis, never the raw preseason column alone.
assert "g.live != null ? g.live : g.wp" in out, "the simulator lost its live-basis source"
assert "if(t >= g.opp || g.settled) continue" in out, "settled games would be replayed"
# No numbers typed into the markup.
for banned in ("11.73", "29.33", "26.2%", "15.8%"):
    assert banned not in MAIN, f"{banned!r} is hardcoded in the markup — read it from the payload"
assert "christophertfrost" not in out and "venmo" not in out.lower(), \
    "payment/contact detail must never reach the public repo"
assert out.endswith("</html>\n") or out.endswith("</html>")
assert "\r" not in out, "CRLF crept in; this repo is all-LF"

OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name}")
