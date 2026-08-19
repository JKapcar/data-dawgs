#!/usr/bin/env python3
"""
patch-bozo-playbill.py — the Playbill/Slip build of bozo.html.

Idempotent and anchor-based, per AGENTS.md. Every replacement asserts it matched
exactly once; a page that has drifted fails loudly instead of half-applying.

Three surfaces, one commit:
  1. CSS  — a Playbill/Slip design system appended to the Bozo block.
  2. HTML — #hubCard rebuilt as a printed broadside with a live slip inside it.
  3. JS   — paintHub() re-templated onto the stubs, paintHouseTicket() added,
            and #bzHead hidden on the hub (the bill carries the wordmark there).

Nothing in the game logic, the Worker calls, Machine v2 or DD_BOTCTX is touched.
Every id and data-attribute the existing handlers query is preserved:
  hubCard hubCount hubList mkLeague nlName nlId nlMgr nlFormat nlBuybackWrap
  nlBuyback nlGo nlErr hubNote  +  data-open/-rename/-del/-title/-rnerr
"""
import re, sys, pathlib

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'bozo.html')
s = SRC.read_text(encoding='utf-8')
orig = s

def once(old, new, what):
    """Replace exactly once, or explain what drifted.

    ⚠️ The already-applied test comes FIRST and tests the REPLACEMENT, not the
    anchor. Several of these replacements keep their own anchor (the CSS block is
    inserted *before* a comment that survives; two of the JS edits wrap code they
    also contain), so an anchor-count test alone re-applied them on a second run
    and doubled a 20KB stylesheet. Idempotence is not optional here: this script
    is expected to be re-run against a page other people are also editing."""
    global s
    if new in s:
        print(f'  = {what}: already applied'); return
    n = s.count(old)
    assert n == 1, f'{what}: expected 1 occurrence of anchor, found {n}'
    s = s.replace(old, new, 1)
    print(f'  + {what}')

# ============================================================================
# 1 · CSS — the Playbill and the Slip
# ============================================================================
CSS_ANCHOR = '/* ---- editable settings ---- */'
CSS = r'''/* ================= THE PLAYBILL & THE SLIP =================
   The hub is a printed broadside. Anything on it that carries a LIVE NUMBER is a
   printed slip laid on top of the bill. That split is the whole design rule:

     the bill  advertises  — display type, vermillion, dingbats, rules, no data
     the slip  records     — mono, tabular figures, perforations, a rubber stamp

   It is also an honesty device. Claims live on the bill; anything the site is
   asserting as fact about this week is on a slip, dated, with its provenance
   printed next to it. A number that cannot be put on a slip does not belong on
   the page.

   ⚠️ Zero webfonts, sitewide rule (sw.js is draft-night offline insurance and a
   CDN face is a network dependency the offline path cannot keep). The bill reads
   as a bill because of STRUCTURE and the three system stacks below, not a face. */
:root{
  --pb-display:"Arial Black","Helvetica Neue",Helvetica,Arial,sans-serif;
  --pb-serif:Georgia,"Times New Roman",ui-serif,serif;
  --pb-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* dark = the bill printed on dark stock */
  --pb-stock:#1c1509; --pb-ink:#f4ebda; --pb-ink2:#bcb098; --pb-ink3:#8d8371;
  --pb-red:#ff6a02; --pb-rule:#3c3122; --pb-edge:#4d3d27;
  --pb-shadow:rgba(0,0,0,.46);
  /* the slip stays paper in both themes — a real receipt on a dark table */
  --slip-stock:#efe6d3; --slip-ink:#1d1509; --slip-ink2:#6d5f48; --slip-rule:#c6b99f;
  --slip-red:#a8290b;
}
:root[data-theme="light"]{
  --pb-stock:#fdf8ec; --pb-ink:#1e1209; --pb-ink2:#5b4a37; --pb-ink3:#8c7b66;
  --pb-red:#c1290a; --pb-rule:#dccfb2; --pb-edge:#241a0d;
  --pb-shadow:rgba(49,29,0,.14);
  --slip-stock:#fffdf6; --slip-ink:#1a1208; --slip-ink2:#6b5c45; --slip-rule:#d9cdb4;
  --slip-red:#b32d0c;
}
/* ---- the bill itself: #hubCard stops being a card and becomes stock ---- */
#hubCard.pb-bill{
  background:var(--pb-stock); color:var(--pb-ink);
  border:1px solid var(--pb-edge); border-radius:3px;
  padding:0; overflow:hidden;
  box-shadow:0 1px 0 var(--pb-edge), 0 10px 30px var(--pb-shadow);
}
/* the printed area sits inside a hairline frame, like a real broadside's plate */
.pb-bill .pb-plate{border:1px solid var(--pb-rule);margin:clamp(9px,1.6vw,15px);
  padding:clamp(16px,3.4vw,38px) clamp(14px,3.6vw,44px)}
.pb-bill hr{border:0;margin:0}
.pb-bill .pb-rule{border-top:1px solid var(--pb-ink);opacity:.85}
/* the double rule is the bill's signature. Two borders, not `double`, so the gap
   is controllable and does not collapse at small sizes. */
.pb-bill .pb-rule2{height:4px;border-top:2px solid var(--pb-ink);border-bottom:1px solid var(--pb-ink)}
.pb-bill .pb-rule-thin{border-top:1px solid var(--pb-rule)}
.pb-bill .pb-eyebrow{font:700 clamp(8.5px,1.5vw,10.5px)/1.6 var(--pb-mono);letter-spacing:.34em;
  text-transform:uppercase;color:var(--pb-ink2);text-align:center;margin:0 0 11px}
.pb-bill .pb-eyebrow .sep{margin:0 .55em;color:var(--pb-ink3)}
.pb-bill .pb-present{font:italic 400 clamp(13px,2.4vw,19px)/1.4 var(--pb-serif);
  color:var(--pb-ink2);text-align:center;margin:14px 0 4px}
/* THE WORDMARK. Letterpress mis-registration: one hard offset in the ink colour's
   shadow, no blur. Blur reads as a drop shadow; an offset reads as printing. */
.pb-bill .pb-word{font-family:var(--pb-display);font-weight:900;
  font-size:clamp(58px,17vw,148px);line-height:.86;letter-spacing:-.012em;
  text-transform:uppercase;text-align:center;color:var(--pb-red);
  margin:2px 0 6px;text-shadow:3px 4px 0 var(--pb-shadow)}
.pb-bill .pb-souls{font:700 clamp(8.5px,1.7vw,12px)/1.7 var(--pb-mono);letter-spacing:.22em;
  text-transform:uppercase;color:var(--pb-ink2);text-align:center;margin:6px 0 12px}
.pb-bill .pb-souls em{font-style:normal;color:var(--pb-red)}
.pb-bill .pb-souls .sep{color:var(--pb-ink3);margin:0 .5em}
.pb-bill .pb-lede{font-family:var(--pb-serif);font-size:clamp(17px,2.7vw,23px);line-height:1.34;
  text-align:center;color:var(--pb-ink);margin:18px auto 12px;max-width:34ch}
.pb-bill .pb-lede b{font-family:var(--pb-display);font-weight:900;letter-spacing:-.01em;display:block;
  font-size:1.06em}
.pb-bill .pb-body{font-family:var(--pb-serif);font-size:clamp(14px,1.9vw,16.5px);line-height:1.62;
  color:var(--pb-ink2);text-align:center;margin:0 auto;max-width:56ch}
.pb-bill .pb-body b{color:var(--pb-ink)}
.pb-bill .pb-orn{text-align:center;color:var(--pb-red);letter-spacing:.7em;margin:22px 0;
  font-size:13px;line-height:1}
.pb-bill .pb-orn::before{content:"";display:inline-block;width:min(22%,120px);border-top:1px solid var(--pb-rule);
  vertical-align:.34em;margin-right:.7em}
.pb-bill .pb-orn::after{content:"";display:inline-block;width:min(22%,120px);border-top:1px solid var(--pb-rule);
  vertical-align:.34em;margin-left:.2em}
/* ---- the bill's buttons: pressed blocks of ink, not UI chrome ---- */
.pb-bill .pb-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:22px 0 4px}
.pb-bill .pb-btn{display:inline-block;font-family:var(--pb-display);font-weight:900;
  font-size:clamp(12px,1.7vw,14.5px);letter-spacing:.06em;text-transform:uppercase;
  padding:14px 22px;text-decoration:none;border:2px solid var(--pb-red);
  background:var(--pb-red);color:#fff8ef;cursor:pointer;border-radius:2px;
  box-shadow:3px 3px 0 var(--pb-shadow);transition:transform .08s,box-shadow .08s}
.pb-bill .pb-btn:hover{transform:translate(1px,1px);box-shadow:2px 2px 0 var(--pb-shadow);color:#fff8ef}
.pb-bill .pb-btn:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--pb-shadow)}
.pb-bill .pb-btn.ghost{background:transparent;color:var(--pb-ink);border-color:var(--pb-ink)}
.pb-bill .pb-btn.ghost:hover{color:var(--pb-ink)}
.pb-bill .pb-btn:focus-visible,
.pb-bill a:focus-visible,
.pb-bill button:focus-visible,
.pb-bill .slip button:focus-visible,
.pb-bill .slip a:focus-visible{outline:2px solid var(--pb-red);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.pb-bill .pb-btn{transition:none}}
/* ---- act headings ---- */
.pb-bill .pb-act{margin-top:clamp(26px,4vw,44px)}
.pb-bill .pb-kicker{font:700 clamp(8.5px,1.5vw,10px)/1.6 var(--pb-mono);letter-spacing:.3em;
  text-transform:uppercase;color:var(--pb-red);text-align:center;margin:0 0 5px}
.pb-bill .pb-h2{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  font-size:clamp(21px,4.4vw,38px);line-height:1.02;letter-spacing:-.01em;
  text-align:center;color:var(--pb-ink);margin:0 0 6px}
.pb-bill .pb-sub{font-family:var(--pb-serif);font-style:italic;font-size:clamp(13px,1.9vw,16px);
  color:var(--pb-ink2);text-align:center;margin:0 auto 16px;max-width:58ch;line-height:1.5}
/* ================= THE SLIP =================
   Perforations are a repeating-gradient on the border box, so a slip can be any
   height without a fixed-size sprite. */
.pb-bill .slip{background:var(--slip-stock);color:var(--slip-ink);position:relative;
  font-family:var(--pb-mono);font-size:13px;line-height:1.55;
  padding:16px clamp(12px,2.4vw,22px) 14px;
  box-shadow:0 2px 0 rgba(0,0,0,.14),0 12px 24px var(--pb-shadow);
  --perf:radial-gradient(circle at 50% 0,var(--pb-stock) 0 4.2px,transparent 4.8px) 0 0/14px 8px repeat-x}
.pb-bill .slip::before,
.pb-bill .slip::after{content:"";position:absolute;left:0;right:0;height:8px;
  background:var(--perf);pointer-events:none}
.pb-bill .slip::before{top:-1px}
.pb-bill .slip::after{bottom:-1px;transform:rotate(180deg)}
.pb-bill .slip .sl-hd{display:flex;justify-content:space-between;align-items:baseline;gap:10px;
  flex-wrap:wrap;border-bottom:1px solid var(--slip-rule);padding-bottom:8px;margin-bottom:10px}
.pb-bill .slip .sl-t{font-weight:700;font-size:11px;letter-spacing:.2em;text-transform:uppercase}
.pb-bill .slip .sl-m{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--slip-ink2)}
.pb-bill .slip dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:10px 14px;margin:0 0 12px}
.pb-bill .slip dt{font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--slip-ink2);margin:0}
.pb-bill .slip dd{margin:2px 0 0;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;
  letter-spacing:-.01em}
.pb-bill .slip .sl-rows{border-top:1px dashed var(--slip-rule);padding-top:9px;margin-top:2px}
.pb-bill .slip .sl-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:9px;align-items:baseline;
  padding:5px 0;border-bottom:1px dotted var(--slip-rule)}
.pb-bill .slip .sl-row:last-child{border-bottom:0}
.pb-bill .slip .sl-row .n{font-size:10px;color:var(--slip-ink2);font-variant-numeric:tabular-nums}
.pb-bill .slip .sl-row .who{font-size:9.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--slip-ink2);
  display:block}
.pb-bill .slip .sl-row .what{font-weight:700;font-size:13.5px}
.pb-bill .slip .sl-row .px{font-weight:700;font-variant-numeric:tabular-nums;font-size:13.5px;white-space:nowrap}
.pb-bill .slip .sl-row.empty .what{font-weight:400;color:var(--slip-ink2);font-style:italic}
.pb-bill .slip .sl-row.empty .px{color:var(--slip-ink2)}
.pb-bill .slip .sl-tot{display:flex;gap:clamp(14px,3vw,30px);flex-wrap:wrap;align-items:flex-end;
  border-top:2px solid var(--slip-ink);margin-top:10px;padding-top:9px}
.pb-bill .slip .sl-tot div{min-width:0}
.pb-bill .slip .sl-tot .k{font-size:9.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--slip-ink2)}
.pb-bill .slip .sl-tot .v{font-size:clamp(19px,3.4vw,26px);font-weight:700;font-variant-numeric:tabular-nums;
  letter-spacing:-.02em;line-height:1.1}
.pb-bill .slip .sl-tot .v.red{color:var(--slip-red)}
.pb-bill .slip .sl-note{font-size:11px;line-height:1.55;color:var(--slip-ink2);margin:10px 0 0;
  border-top:1px dashed var(--slip-rule);padding-top:9px}
.pb-bill .slip .sl-note b{color:var(--slip-ink)}
/* the rubber stamp. Rotated, outlined, never over a number it would obscure. */
/* ⚠️ The stamp is a FLEX ITEM in the totals rule, not an absolutely-positioned
   overlay. As an overlay it landed on top of the note at some widths, and a rubber
   stamp sitting over the honesty paragraph is the one place it must never be. */
.pb-bill .slip .stamp{position:static;margin-left:auto;align-self:center;
  border:2.5px solid var(--slip-red);color:var(--slip-red);border-radius:4px;
  font-weight:700;font-size:clamp(11px,2vw,15px);letter-spacing:.16em;text-transform:uppercase;
  padding:5px 11px;transform:rotate(-8deg);opacity:.6;pointer-events:none;white-space:nowrap}
.pb-bill .slip .stamp.graded{color:#1d6b2a;border-color:#1d6b2a}
@media(max-width:520px){.pb-bill .slip .stamp{margin:8px 0 0;align-self:flex-start;
  transform:rotate(-3deg);opacity:.75}}
/* the exposure line: the one place the slip raises its voice */
.pb-bill .slip .sl-exp{margin:11px 0 0;padding:9px 11px;border-left:3px solid var(--slip-red);
  background:rgba(168,41,11,.07);font-size:11.5px;line-height:1.55;color:var(--slip-ink)}
.pb-bill .slip .sl-exp b{letter-spacing:.1em;text-transform:uppercase;font-size:10px}
/* ================= ACTS I–IV: the four levers ================= */
.pb-bill .acts{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:0;
  border-top:1px solid var(--pb-rule)}
.pb-bill .act{display:grid;grid-template-columns:clamp(46px,7vw,70px) minmax(0,1fr);gap:clamp(10px,2vw,18px);
  align-items:start;padding:14px 4px;border-bottom:1px solid var(--pb-rule)}
.pb-bill .act .no{font-family:var(--pb-serif);font-size:clamp(15px,2.4vw,20px);color:var(--pb-red);
  letter-spacing:.04em;text-align:right;font-variant:small-caps;padding-top:2px}
.pb-bill .act h3{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  font-size:clamp(13px,2vw,17px);letter-spacing:.02em;margin:0 0 3px;color:var(--pb-ink)}
.pb-bill .act p{margin:0;font-family:var(--pb-serif);font-size:clamp(13.5px,1.8vw,15.5px);line-height:1.55;
  color:var(--pb-ink2)}
.pb-bill .act p .unmeas{font-family:var(--pb-mono);font-size:.78em;letter-spacing:.12em;text-transform:uppercase;
  color:var(--slip-red);border:1px solid currentColor;border-radius:3px;padding:1px 5px;
  margin-left:6px;white-space:nowrap;vertical-align:.12em}
/* the running order: a strip of four cards the reader can riffle */
.pb-bill .riffle{margin:18px 0 0;text-align:center}
.pb-bill .riffle-strip{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 12px;
  min-height:64px}
.pb-bill .riffle-card{border:1px solid var(--pb-ink);background:var(--pb-stock);color:var(--pb-ink);
  padding:9px 12px;min-width:clamp(88px,17vw,132px);box-shadow:2px 2px 0 var(--pb-shadow);
  transition:transform .28s cubic-bezier(.2,.9,.25,1)}
.pb-bill .riffle-card .rc-n{font:700 9px/1.4 var(--pb-mono);letter-spacing:.2em;text-transform:uppercase;
  color:var(--pb-red)}
.pb-bill .riffle-card .rc-l{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  font-size:clamp(10px,1.6vw,12.5px);letter-spacing:.01em;margin-top:3px;line-height:1.2}
.pb-bill .riffle.shuffling .riffle-card{transform:translateY(-9px) rotate(var(--rot,0deg))}
@media(prefers-reduced-motion:reduce){.pb-bill .riffle-card{transition:none}
.pb-bill .riffle.shuffling .riffle-card{transform:none}}
.pb-bill .riffle-note{font-family:var(--pb-serif);font-size:13.5px;line-height:1.55;color:var(--pb-ink2);
  max-width:60ch;margin:0 auto}
.pb-bill .riffle-note b{color:var(--pb-ink)}
/* ================= THE BILL: leagues as ticket stubs ================= */
#hubCard .hub{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));
  gap:clamp(12px,2vw,18px);margin-top:16px}
/* the stub: torn on the left, notched on both flanks, numbered like a real one */
#hubCard .hcard{position:relative;display:block;cursor:pointer;border-radius:0;
  background:var(--slip-stock);color:var(--slip-ink);border:1px solid var(--slip-rule);
  border-left:3px solid var(--pb-red);
  padding:14px 16px 13px;transition:transform .12s,box-shadow .12s;
  box-shadow:0 2px 0 rgba(0,0,0,.1),0 8px 18px var(--pb-shadow)}
#hubCard .hcard:hover{transform:translateY(-2px);box-shadow:0 3px 0 rgba(0,0,0,.12),0 14px 26px var(--pb-shadow)}
#hubCard .hcard:focus-within{outline:2px solid var(--pb-red);outline-offset:2px}
/* the notches. Pseudo-elements in the stock colour, punched out of the flanks. */
#hubCard .hcard::before,
#hubCard .hcard::after{content:"";position:absolute;width:13px;height:13px;
  border-radius:50%;background:var(--pb-stock);border:1px solid var(--slip-rule);
  top:50%;transform:translateY(-50%)}
#hubCard .hcard::before{left:-7px;clip-path:inset(0 0 0 50%)}
#hubCard .hcard::after{right:-7px;clip-path:inset(0 50% 0 0)}
#hubCard .hcard.demo{border-left-style:dashed;background:
  repeating-linear-gradient(135deg,transparent 0 9px,rgba(168,41,11,.045) 9px 18px),var(--slip-stock)}
#hubCard .hcard .hhead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:2px}
#hubCard .hcard h3{margin:0;font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  font-size:clamp(14px,2vw,17px);letter-spacing:-.005em;color:var(--slip-ink);line-height:1.15}
#hubCard .hcard .meta{font:10.5px/1.6 var(--pb-mono);letter-spacing:.09em;text-transform:uppercase;
  color:var(--slip-ink2);margin:3px 0 9px}
#hubCard .hcard .bar{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
#hubCard .hcard .chip{border-radius:2px;border:1px solid currentColor;background:none;
  font:700 9px/1.5 var(--pb-mono);letter-spacing:.13em;text-transform:uppercase;padding:2px 6px;
  color:var(--slip-ink2);cursor:default}
#hubCard .hcard .chip.open{color:var(--slip-red);border-color:currentColor;
  background:rgba(168,41,11,.08)}
#hubCard .hcard .chip.graded{color:#1d6b2a}
#hubCard .hcard .chip.placed{color:#8a6100}
#hubCard .hcard .chip.fmt{color:var(--slip-ink);background:rgba(0,0,0,.05)}
#hubCard .hcard .chip.demo{background:#e9a400;border-color:#8a6100;color:#241703}
#hubCard .hcard .yours{font:700 9px/1.5 var(--pb-mono);letter-spacing:.13em;text-transform:uppercase;
  padding:2px 6px;border-radius:2px;background:var(--pb-red);color:#fff8ef}
#hubCard .hcard .go{display:block;margin-top:2px;font:700 10.5px/1.5 var(--pb-mono);letter-spacing:.11em;
  text-transform:uppercase;color:var(--slip-red)}
#hubCard .hcard .iconbtn{background:none;border:1px solid var(--slip-rule);border-radius:2px;
  color:var(--slip-ink2);cursor:pointer;font:700 9px/1.4 var(--pb-mono);letter-spacing:.11em;
  text-transform:uppercase;padding:3px 6px}
#hubCard .hcard .iconbtn:hover{border-color:var(--slip-red);color:var(--slip-red)}
#hubCard .hcard .iconbtn.danger:hover{border-color:#a8290b;color:#a8290b}
#hubCard .hcard input.rn{font:700 15px var(--pb-display);padding:3px 7px;border:1px solid var(--pb-red);
  border-radius:2px;background:#fff;color:var(--slip-ink);width:100%;max-width:230px}
#hubCard .hcard .rnerr{color:#a8290b;font:600 11px var(--pb-mono);margin-top:6px}
/* the stub number, printed down the tear edge */
#hubCard .hcard .stubno{position:absolute;right:9px;top:9px;font:700 9px/1 var(--pb-mono);
  letter-spacing:.14em;color:var(--slip-ink2);opacity:.65}
/* the live count, in the stub's own hand */
#hubCard .hcard .fill{display:flex;gap:3px;margin:0 0 9px}
#hubCard .hcard .fill i{width:11px;height:11px;border:1px solid var(--slip-rule);border-radius:1px;
  font-style:normal;display:block}
#hubCard .hcard .fill i.on{background:var(--pb-red);border-color:var(--pb-red)}
/* ---- admin: booking a new bill ---- */
#mkLeague.pb-book{margin-top:clamp(26px,4vw,40px);border:1px dashed var(--pb-rule);
  padding:clamp(14px,2.4vw,22px);background:rgba(0,0,0,.06)}
:root[data-theme="light"] #mkLeague.pb-book{background:rgba(49,29,0,.03)}
#mkLeague.pb-book h3{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  font-size:13px;letter-spacing:.06em;color:var(--pb-red);margin:0 0 4px}
#mkLeague.pb-book .tm{font-family:var(--pb-serif);font-size:14px;color:var(--pb-ink2);margin:0 0 12px}
#mkLeague.pb-book label{font:700 9.5px/1.6 var(--pb-mono);letter-spacing:.15em;text-transform:uppercase;
  color:var(--pb-ink3)}
#mkLeague.pb-book input,
#mkLeague.pb-book select{background:var(--pb-stock);color:var(--pb-ink);
  border:1px solid var(--pb-rule);border-radius:2px}
#mkLeague.pb-book .btn{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
  letter-spacing:.06em;background:var(--pb-red);color:#fff8ef;border:2px solid var(--pb-red);
  border-radius:2px;padding:9px 16px;box-shadow:2px 2px 0 var(--pb-shadow)}
/* ---- the small print: the caveats, set as small print, which is the joke ---- */
.pb-bill .pb-fine{margin:clamp(22px,3.4vw,34px) 0 0;padding-top:14px;border-top:1px solid var(--pb-rule);
  font-family:var(--pb-mono);font-size:10.5px;line-height:1.75;color:var(--pb-ink3);
  columns:2;column-gap:34px;column-rule:1px solid var(--pb-rule)}
.pb-bill .pb-fine b{color:var(--pb-ink2);letter-spacing:.08em;text-transform:uppercase;font-size:9.5px}
.pb-bill .pb-fine p{margin:0 0 9px;break-inside:avoid}
@media(max-width:720px){.pb-bill .pb-fine{columns:1}}
#hubCard .note{font-family:var(--pb-mono);font-size:11px;letter-spacing:.06em;color:var(--pb-ink3);
  text-align:center;margin:16px 0 0}
#hubCard .pend{font-family:var(--pb-serif);font-style:italic;color:var(--pb-ink2);text-align:center}
/* ================= THUMB: the bill, folded ==================
   Not a separate design — the same bill with the ordering that a one-handed
   reader needs: the live slip rises above the explainer, the stubs become a
   snap carousel, and the one action that matters is pinned to the thumb. */
.pb-stub-bar{display:none}
@media(max-width:719px){
.pb-bill .pb-plate{margin:6px;padding:18px 14px 22px}
#hubCard.pb-bill{border-radius:2px}
/* the stubs read as a strip of tickets you thumb through */
  #hubCard .hub{grid-auto-flow:column;grid-template-columns:none;
    grid-auto-columns:minmax(252px,84%);overflow-x:auto;overflow-y:visible;
    scroll-snap-type:x mandatory;scroll-padding:0 14px;
    margin-inline:-14px;padding:10px 14px 16px;
    -webkit-overflow-scrolling:touch;scrollbar-width:none}
#hubCard .hub::-webkit-scrollbar{display:none}
#hubCard .hcard{scroll-snap-align:start}
#hubCard .hcard::before,
#hubCard .hcard::after{display:none}
.pb-bill .pb-cta{flex-direction:column;align-items:stretch}
.pb-bill .pb-btn{text-align:center;padding:15px 18px}
/* pinned action: a torn-off stub at the bottom of the screen */
  .pb-stub-bar{display:block;position:fixed;left:0;right:0;bottom:0;z-index:40;
    background:var(--slip-stock);color:var(--slip-ink);
    border-top:1px solid var(--slip-rule);
    box-shadow:0 -8px 24px rgba(0,0,0,.34);
    padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px))}
.pb-stub-bar::before{content:"";position:absolute;top:-8px;left:0;right:0;height:8px;
    background:radial-gradient(circle at 50% 100%,transparent 0 4px,var(--slip-stock) 4.6px) 0 0/13px 8px repeat-x;
    pointer-events:none}
.pb-stub-bar a{display:flex;align-items:center;justify-content:space-between;gap:12px;
    text-decoration:none;color:inherit}
.pb-stub-bar .sb-k{display:block;font:700 9px/1.4 var(--pb-mono);letter-spacing:.16em;text-transform:uppercase;
    color:var(--slip-ink2)}
.pb-stub-bar .sb-v{display:block;font-family:var(--pb-display);font-weight:900;
    text-transform:uppercase;font-size:14px;letter-spacing:.01em;line-height:1.25;margin-top:2px}
.pb-stub-bar .sb-go{font-family:var(--pb-display);font-weight:900;text-transform:uppercase;
    font-size:12.5px;letter-spacing:.05em;background:var(--pb-red);color:#fff8ef;
    padding:11px 15px;border-radius:2px;white-space:nowrap;box-shadow:2px 2px 0 rgba(0,0,0,.22)}
/* the fixed stub would otherwise sit on the small print */
  body.pb-hasbar{padding-bottom:84px}
}
@media(max-width:400px){.pb-bill .pb-word{font-size:clamp(46px,16vw,64px)}}

'''
once(CSS_ANCHOR, CSS + CSS_ANCHOR, 'CSS · playbill + slip design system')


# ============================================================================
# 2 · HTML — #hubCard becomes the bill
# ============================================================================
HUB_OLD_HEAD = '''<!-- ---------- the hub: every league, plus admin ---------- -->
<div class="card" id="hubCard" style="display:none">
  <div class="bz-hdr"><h2 class="bz" style="margin:0">Leagues</h2><span class="tm" id="hubCount"></span></div>
  <div class="hub" id="hubList"></div>
  <div id="mkLeague" style="display:none;margin-top:20px;border-top:1px solid var(--grid);padding-top:16px">
    <h3 style="font-size:13px;letter-spacing:1.1px;text-transform:uppercase;color:var(--accent);margin:0 0 4px">New league</h3>
    <p class="tm" style="margin:0 0 10px">A separate group with its own roster size, band, week and ledger. You pick who runs it.</p>'''

HUB_NEW_HEAD = '''<!-- ---------- the hub: THE BILL ----------
     The directory used to be three cards and an admin form: it never said what Bozo
     was, never taught the levers, and hid the live week behind a click. It is now a
     printed broadside. Two materials, and the split is a rule rather than a mood:
     the BILL (display type, vermillion, dingbats) makes claims; the SLIP (mono,
     tabular, perforated, stamped) carries live numbers with their provenance. If a
     figure cannot go on a slip with a date on it, it does not go on the page.

     ⚠️ Every id and data-attribute the old hub's handlers query is preserved:
     hubCount, hubList, mkLeague, nlName/nlId/nlMgr/nlFormat/nlBuybackWrap/nlBuyback/
     nlGo/nlErr, hubNote, and the data-open/-rename/-del/-title/-rnerr contract on
     each stub. paintHub() re-templates; it does not re-wire. -->
<div class="card pb-bill" id="hubCard" style="display:none">
 <div class="pb-plate">
  <p class="pb-eyebrow">Data Dawgs <span class="sep">·</span> The DawgHouse <span class="sep">·</span> <span id="pbBillWk">this week&rsquo;s bill</span></p>
  <hr class="pb-rule2">
  <p class="pb-present">For one week only, the management presents</p>
  <h1 class="pb-word">Bozo</h1>
  <p class="pb-souls"><span id="pbSouls">Eight souls</span><span class="sep">&#10022;</span>One ticket<span class="sep">&#10022;</span>Real money<span class="sep">&#10022;</span><em>No escape but winning</em></p>
  <hr class="pb-rule2">

  <p class="pb-lede">One favorite each. One big parlay.<b>Whoever busts it worst wears it.</b></p>
  <p class="pb-body">Every member of the league files <b>one leg</b> &mdash; a favorite, priced inside the
    league&rsquo;s band. All of them ride <b>one real parlay at DraftKings</b>, funded by last week&rsquo;s bozo.
    If it cashes, everybody eats. If it busts, exactly one loser is named the bozo, and that person
    buys next week&rsquo;s ticket. You can only be the bozo <b>if your own leg lost</b>.</p>

  <div class="pb-cta">
    <a class="pb-btn" id="pbOpen" href="bozo.html?l=main">Open my live league &rarr;</a>
    <a class="pb-btn ghost" href="#pbHow">How the bozo is named</a>
  </div>
  <p class="pb-orn">&#9733; &#10022; &#9733;</p>

  <!-- ---- the house ticket: the live week, on a slip ---- -->
  <section class="pb-act" id="pbHouse">
    <p class="pb-kicker">Tonight on the boards</p>
    <h2 class="pb-h2">The House Ticket</h2>
    <p class="pb-sub" id="pbHouseSub">&mdash;</p>
    <div class="slip" id="houseSlip"></div>
  </section>

  <!-- ---- acts I-IV ---- -->
  <section class="pb-act" id="pbHow">
    <p class="pb-kicker">Four levers &#183; a fresh order every week</p>
    <h2 class="pb-h2">How the bozo is named</h2>
    <p class="pb-sub">Only legs that <em>lost</em> are eligible &mdash; cash yours and you walk, however ugly
      the price was. Among the losers, the levers below decide, in an order that is drawn fresh
      every single week.</p>
    <ol class="acts">
      <li class="act"><span class="no">I</span><div><h3>Shortest Odds</h3>
        <p>The biggest favorite in the pool. The chalkiest leg on the ticket, if it lost, is the
          first one anybody looks at.</p></div></li>
      <li class="act"><span class="no">II</span><div><h3>Worst Beat</h3>
        <p>Finished furthest under its number, measured in standard deviations &mdash; so a blowout
          in a low-variance market counts for more than a blowout anywhere.</p></div></li>
      <li class="act"><span class="no">III</span><div><h3>Last In</h3>
        <p>The final leg submitted. The only lever you can move by acting: it belongs to whoever
          files last, and it moves to the next person the moment they enter.</p></div></li>
      <li class="act"><span class="no">IV</span><div><h3>Worst CLV</h3>
        <p>The price that moved most against it between submission and close.
          <span class="unmeas">not measured yet</span></p></div></li>
    </ol>
    <div class="riffle" id="pbRiffle">
      <div class="riffle-strip" id="riffleStrip" role="list" aria-live="polite"></div>
      <button class="pb-btn ghost" id="riffleGo" type="button">Draw a running order</button>
      <p class="riffle-note" id="riffleNote"></p>
    </div>
  </section>

  <!-- ---- the bill: every league as a ticket stub ---- -->
  <section class="pb-act" id="pbBill">
    <p class="pb-kicker">The bill</p>
    <h2 class="pb-h2">Every league on the card</h2>
    <p class="pb-sub"><span class="tm" id="hubCount"></span> running. Open one to see its board;
      the boards are public whether or not you are in them.</p>
    <div class="hub" id="hubList"></div>
  <div id="mkLeague" class="pb-book" style="display:none">
    <h3>Book a new bill</h3>
    <p class="tm">A separate group with its own roster size, band, week and ledger. You pick who runs it.</p>'''
once(HUB_OLD_HEAD, HUB_NEW_HEAD, 'HTML · bill head + acts + house ticket')

HUB_OLD_TAIL = '''    <div class="err" id="nlErr"></div>
  </div>
  <p class="note" id="hubNote"></p>
</div>'''

HUB_NEW_TAIL = '''    <div class="err" id="nlErr"></div>
  </div>
  <p class="note" id="hubNote"></p>
  </section>

  <!-- ---- the small print. Set as small print, which is both the joke and the point:
       on a real slip this is where the book hides things, so this is where the site
       puts what it cannot stand behind. Everything here is also in Toto's sys block,
       because a caveat that lives only in page prose is one he gets talked past. -->
  <div class="pb-fine">
    <p><b>Prices are self-reported.</b> Every number on a board is typed in by the player who
      filed it. Nothing here checks it against DraftKings or any other book, and nothing here
      ever will vouch for one. A spread or total priced past about &minus;145 is off market and
      worth a second look; a moneyline has no internal cross-check at all.</p>
    <p><b>Bozo odds are simulation.</b> Anywhere this site quotes a chance of wearing it, that is
      Monte Carlo output, not an observation, and the simulation draws every leg independently.
      Two legs on the same game are not independent, so a ticket carrying a stack is wrong in a
      direction nobody has measured.</p>
    <p><b>CLV is not measured yet.</b> No closing prices are captured, so Worst CLV names nobody
      and no CLV figure on this site is real. The lever stays in the draw and falls through to
      the next one. It is dormant, not passing.</p>
    <p><b>Demo leagues are invented.</b> Every leg, price, close and result in a league badged
      DEMO&#160;&#183;&#160;SIMULATED was fabricated to exercise the interface. They use the real
      eight names on purpose, which is exactly why the badge is load-bearing rather than
      decoration. They count toward nothing.</p>
    <p><b>The draw is the server&rsquo;s.</b> The running order is one permutation, drawn at the
      moment the ticket locks and written once. Nothing in your browser can re-roll it, and the
      strip above is a demonstration of the shuffle, not a preview of it.</p>
  </div>
 </div>
</div>

<!-- The pinned stub: mobile only, one action, painted by paintHouseTicket(). -->
<div class="pb-stub-bar" id="pbStubBar" hidden></div>'''
once(HUB_OLD_TAIL, HUB_NEW_TAIL, 'HTML · small print + pinned stub')



# ============================================================================
# 3 · JS — paintHub re-templated, the house ticket, the riffle, the stub
# ============================================================================
def between(start, end, new, what):
    """Replace the span from `start` through `end` (inclusive) exactly once.

    Same rule as once(): the replacement is tested before the anchor, because
    STUB_NEW contains STUB_START and would otherwise re-apply forever."""
    global s
    if new in s:
        print(f'  = {what}: already applied'); return
    i = s.find(start)
    if i < 0:
        assert new in s, f'{what}: start anchor not found and replacement absent'
        print(f'  = {what}: already applied'); return
    j = s.find(end, i)
    assert j > 0, f'{what}: end anchor not found'
    j += len(end)
    assert s.count(start) == 1, f'{what}: start anchor is not unique'
    s = s[:i] + new + s[j:]
    print(f'  + {what}')

STUB_START = "  document.getElementById('hubCount').textContent ="
STUB_END   = """  }).join('') || '<p class="pend">No leagues yet.</p>';"""
STUB_NEW = r"""  document.getElementById('hubCount').textContent =
    LEAGUES.length + (LEAGUES.length===1 ? ' league' : ' leagues');
  // ⚠️ A div, not an <a> — the stub carries buttons and an input, and nesting
  // interactive controls inside an anchor is both invalid and unusable.
  // ⚠️ The data-* contract (open/rename/del/title/rnerr) is what the delegated click
  // handler below reads. Restyling the stub must never drop one of these.
  document.getElementById('hubList').innerHTML = LEAGUES.map((l,i)=>{
    const mine = ME && (l.members||[]).includes(ME.name);
    const chip = l.status==='open' ? 'open' : l.status;
    const st = l.settings || {};
    const royale = st.format === 'royale';
    // Fill boxes: the live one prints its own count, so the directory answers
    // "is there anything to do here" without opening anything. Only the league we
    // actually hold state for can say — S is one league's state, not all of them.
    const known = (l.id === LID);
    const inNow = known ? Object.keys(S.picks||{}).length : null;
    const fill = (inNow==null) ? '' :
      `<div class="fill" role="img" aria-label="${inNow} of ${l.size} legs in">` +
      Array.from({length:l.size},(_,k)=>`<i class="${k<inNow?'on':''}"></i>`).join('') + '</div>';
    return `<div class="hcard${st.synthetic?' demo':''}" data-open="${esc(l.id)}">
      <span class="stubno">No. ${String(i+1).padStart(3,'0')}</span>
      <div class="hhead">
        <h3 data-title="${esc(l.id)}">${esc(l.name)}</h3>
        ${canManage(l)?`<button class="iconbtn" data-rename="${esc(l.id)}" title="Rename this league">Rename</button>`:''}
        ${canManage(l) && l.id!=='main'?`<button class="iconbtn danger" data-del="${esc(l.id)}" title="Delete this league and every row in it">Delete</button>`:''}
      </div>
      <div class="meta">${l.size} player${l.size===1?'':'s'} &middot; week ${l.week} &middot; run by ${esc(l.manager||'—')}</div>
      ${fill}
      <div class="bar"><span class="chip ${esc(chip)}">${esc(chip)}</span>
        ${royale?'<span class="chip fmt">Bozo Royale</span>':''}
        ${st.synthetic?'<span class="chip demo" title="Simulated season. Every leg, price, close and result in this league is fabricated, and it counts toward nothing.">DEMO · SIMULATED</span>':''}
        ${mine?'<span class="yours">you’re in</span>':''}</div>
      <span class="go">${canManage(l)?'Open to manage roster &amp; rules →':'Open the board →'}</span>
      <div class="rnerr" data-rnerr="${esc(l.id)}"></div>
    </div>`;
  }).join('') || '<p class="pend">No leagues yet.</p>';"""
between(STUB_START, STUB_END, STUB_NEW, 'JS · league stubs')

# --- the house ticket, the riffle and the pinned stub -----------------------
RIFFLE_ANCHOR = '// Inline rename, straight off the card. Commits on Enter or blur; Escape backs out.'
HOUSE = r'''/* ---------------- the house ticket ----------------
   The hub's one live surface. It reads the SAME S the board reads — on the hub LID
   is the default league, so this is that league's real week, not a summary of all of
   them. Everything it prints is a figure the board would print; nothing is derived
   here that is not derived there, so the two cannot disagree.

   ⚠️ It is a SLIP, and that is a rule rather than a texture: the bill above it makes
   claims, and every number lives down here where the date, the source and the stamp
   are printed next to it. If a figure cannot carry those three things, it does not
   belong on this page at all. */
const NUMWORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                 'eleven','twelve'];
function paintHouseTicket(){
  const slip = document.getElementById('houseSlip');
  const bar  = document.getElementById('pbStubBar');
  if(!slip) return;
  const lg = league();
  const players = names();
  const wkEl = document.getElementById('pbBillWk');
  const soulsEl = document.getElementById('pbSouls');
  const subEl = document.getElementById('pbHouseSub');
  const openBtn = document.getElementById('pbOpen');

  // No league state at all — say so plainly rather than printing a hopeful zero.
  if(!lg || !players.length){
    slip.innerHTML = '<div class="sl-hd"><span class="sl-t">The house ticket</span>' +
      '<span class="sl-m">no board loaded</span></div>' +
      '<p class="sl-note">The league boards are not reachable from this device right now. ' +
      'Nothing below is stale — there is simply nothing to print.</p>';
    if(bar) bar.hidden = true;
    document.body.classList.remove('pb-hasbar');
    return;
  }

  const st = settings(), bd = band(), stake = st.stake ?? 50;
  const picks = S.picks || {}, res = S.results || {}, status = S.status || 'open';
  const week = S.week || lg.week || 1;
  const rows = players.map(p=>({p, x:picks[kEnc(p)]||{}, r:res[kEnc(p)]||{}}))
    .sort((a,b)=>{
      const ai=a.x.price!=null, bi=b.x.price!=null;
      if(ai!==bi) return ai?-1:1;                    // legs in first, blanks last
      if(ai) return (a.x.ts||0)-(b.x.ts||0);         // then in submission order
      return a.p.localeCompare(b.p);
    });
  const live = rows.filter(r=>r.x.price!=null);
  const nIn = live.length, nAll = players.length;
  const graded = status==='graded';

  if(wkEl) wkEl.textContent = 'Week ' + week + ' bill';
  if(soulsEl) soulsEl.textContent =
    (NUMWORD[nAll] ? NUMWORD[nAll].replace(/^./,c=>c.toUpperCase()) : nAll) +
    (nAll===1 ? ' soul' : ' souls');
  if(openBtn){
    openBtn.href = 'bozo.html?l=' + encodeURIComponent(lg.id);
    openBtn.textContent = (ME && (lg.members||[]).includes(ME.name))
      ? 'Open my live league →' : 'Open the board →';
  }
  if(subEl) subEl.innerHTML = esc(lg.name) + ' &middot; week ' + week + ' &middot; ' +
    (graded ? 'graded and settled'
            : status==='placed' ? 'the ticket is placed and running'
            : nIn===0 ? 'the card is open and nobody has filed yet'
            : nIn>=nAll ? 'every leg is in — the ticket locks on this'
            : 'the card is still open');

  // The rows. Submission order is load-bearing: Last In is a lever, so the bottom
  // filed leg is the one currently exposed to it and you can see that without
  // reading a timestamp.
  const rowHtml = rows.map((row,i)=>{
    const {p,x,r} = row;
    if(x.price==null)
      return `<div class="sl-row empty"><span class="n">${i+1}</span>` +
        `<span><span class="who">${esc(teamOf(p))}</span>` +
        `<span class="what">no leg yet</span></span><span class="px">&mdash;</span></div>`;
    const mark = graded ? (r.won===true?'✓':r.won===false?'✕':'—') : (i+1);
    return `<div class="sl-row"><span class="n">${mark}</span>` +
      `<span><span class="who">${esc(teamOf(p))} &middot; ${esc(when(x.ts))}</span>` +
      `<span class="what">${esc(x.label||'')}</span></span>` +
      `<span class="px">${esc(String(x.price>0?'+'+x.price:x.price))}</span></div>`;
  }).join('');

  const stamp = graded ? '<span class="stamp graded">Graded</span>'
    : status==='placed' ? '<span class="stamp">Placed</span>'
    : '<span class="stamp">Open &middot; ungraded</span>';

  // Pricing. Same two lines the board's diagnostics run, so they cannot disagree.
  let tot = '';
  if(nIn){
    const offDec  = live.reduce((a,x)=>a*dec(x.x.price),1);
    const fairDec = 1/live.reduce((a,x)=>a*devig(x.x.price),1);
    tot = `<div class="sl-tot">` +
      `<div><div class="k">Legs in</div><div class="v">${nIn}<span style="opacity:.45">/${nAll}</span></div></div>` +
      `<div><div class="k">Parlay price</div><div class="v red">${esc(amer(offDec))}</div></div>` +
      `<div><div class="k">$${stake} returns</div><div class="v">$${Math.round(offDec*stake).toLocaleString()}</div></div>` +
      `<div><div class="k">Book keeps</div><div class="v">${esc(pct(1-offDec/fairDec))}</div></div>` +
      stamp + `</div>`;
  } else {
    tot = `<div class="sl-tot"><div><div class="k">Legs in</div>` +
      `<div class="v">0<span style="opacity:.45">/${nAll}</span></div></div>` +
      `<div><div class="k">Parlay price</div><div class="v">&mdash;</div></div>` + stamp + `</div>`;
  }

  // The exposure line. Only while it is TRUE — an always-on warning is wallpaper.
  let exp = '';
  if(status==='open' && nIn>0 && nIn<nAll){
    const last = live[live.length-1];
    exp = `<p class="sl-exp"><b>Exposed to Last In</b><br>` +
      `${esc(teamOf(last.p))} filed most recently, so Last In currently points at them. ` +
      `It moves to the next person the moment they enter &mdash; ` +
      `${nAll-nIn} ${nAll-nIn===1?'leg is':'legs are'} still to come.</p>`;
  }

  slip.innerHTML =
    `<div class="sl-hd"><span class="sl-t">The house ticket</span>` +
    `<span class="sl-m">${esc(lg.name)} &middot; week ${week} &middot; ${esc(status)}</span></div>` +
    `<dl>` +
      `<div><dt>Stake</dt><dd>$${stake}</dd></div>` +
      `<div><dt>Price band</dt><dd>${bd.ceil} / ${bd.floor}</dd></div>` +
      `<div><dt>Format</dt><dd>${st.format==='royale'?'Royale':'Standard'}</dd></div>` +
      `<div><dt>Closes</dt><dd>${st.lockRule==='count' ? 'on leg '+st.lockCount : 'on leg '+nAll}</dd></div>` +
    `</dl>` +
    `<div class="sl-rows">${rowHtml}</div>` + tot + exp +
    `<p class="sl-note">Favorites only, inside the band. No exact duplicate legs. ` +
    `<b>The ticket locks the moment the last leg lands</b> &mdash; that instant is the close, ` +
    `and there are no edits after it. Prices above are <b>self-reported</b> and are not ` +
    `checked against any book.</p>`;

  // The pinned stub. Mobile only (CSS decides), one action, and it says the thing
  // that would make you tap it rather than shouting the brand at you.
  if(bar){
    const mine = ME && (lg.members||[]).includes(ME.name);
    const filed = ME && picks[kEnc(ME.name)];
    const label = graded ? 'See who wore it'
      : !ME ? 'Sign in to file'
      : !mine ? 'Open the board'
      : filed ? 'Your leg is in' : 'File your leg';
    bar.hidden = false;
    bar.innerHTML = `<a href="bozo.html?l=${encodeURIComponent(lg.id)}">` +
      `<span><span class="sb-k">${esc(lg.name)} &middot; week ${week}</span>` +
      `<span class="sb-v">${nIn} of ${nAll} in</span></span>` +
      `<span class="sb-go">${label} &rarr;</span></a>`;
    document.body.classList.add('pb-hasbar');
  }
}

/* ---------------- the riffle ----------------
   A demonstration of the shuffle, and it is labelled as one in three places: the
   button says "a running order" not "this week's", the note names what it is, and
   the small print at the foot of the bill says it again. The real permutation is
   drawn on the server at the close and written once; nothing here can preview it,
   and a page that implied otherwise would be displaying a hierarchy that does not
   exist. That is the same line the machine refuses to cross on the board. */
function paintRiffle(order){
  const strip = document.getElementById('riffleStrip');
  if(!strip) return;
  strip.innerHTML = order.map((li,i)=>
    `<div class="riffle-card" role="listitem" style="--rot:${(i%2?1:-1)*(1.4+i*.5)}deg">` +
    `<div class="rc-n">${['1st','2nd','3rd','4th'][i]||(i+1)}</div>` +
    `<div class="rc-l">${esc(LEVERS[li].name)}</div></div>`).join('');
}
let riffleWired = false;
function wireRiffle(){
  if(riffleWired) return;
  const go = document.getElementById('riffleGo'), wrap = document.getElementById('pbRiffle');
  const note = document.getElementById('riffleNote');
  if(!go || !wrap || !note) return;
  riffleWired = true;
  const base = [0,1,2,3];
  paintRiffle(base);
  note.innerHTML = 'Walk the order left to right. The first lever that isolates one person ' +
    'names the bozo; a tie falls through to the next. It is <b>not</b> a weighted score and ' +
    '<b>not</b> a fixed cascade &mdash; a blend would just be a new objective somebody solves.';
  go.addEventListener('click', ()=>{
    const o = base.slice();
    for(let i=o.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [o[i],o[j]]=[o[j],o[i]]; }
    wrap.classList.add('shuffling');
    setTimeout(()=>{ paintRiffle(o); wrap.classList.remove('shuffling');
      note.innerHTML = 'In that order, <b>' + esc(LEVERS[o[0]].name) + '</b> goes first: ' +
        esc(LEVERS[o[0]].desc) + '. If it isolates one losing leg, that is the bozo and nothing ' +
        'else is consulted. <b>This is a demonstration of the shuffle, not this week&rsquo;s draw</b> ' +
        '&mdash; the real one is drawn on the server when the ticket locks, and is written once.';
    }, 190);
  });
}

'''
once(RIFFLE_ANCHOR, HOUSE + RIFFLE_ANCHOR, 'JS · house ticket + riffle')

# paintHub calls them
once("""  document.getElementById('hubNote').textContent = ME
    ? (isAdmin() ? 'You can rename any league here, or open one to manage its roster and rules.'
                 : 'Open a league to see its board.')
    : 'Sign in to submit a leg. The boards are public either way.';
}""",
"""  document.getElementById('hubNote').textContent = ME
    ? (isAdmin() ? 'You can rename any league here, or open one to manage its roster and rules.'
                 : 'Open a league to see its board.')
    : 'Sign in to submit a leg. The boards are public either way.';

  // The bill's live surfaces. Both are cheap and idempotent; paintHub runs on every
  // poll, so neither may do anything that accumulates.
  paintHouseTicket();
  wireRiffle();
}""",
'JS · paintHub calls the live surfaces')

# render(): the bill carries the wordmark on the hub, so the page header stands down
once("""  document.getElementById('bzBand').style.display = hub ? 'none' : '';""",
"""  document.getElementById('bzBand').style.display = hub ? 'none' : '';
  /* ⚠️ On the hub the BILL is the masthead — it prints the eyebrow, the wordmark and
     the dek itself, at broadside scale. Leaving #bzHead up too rendered "BOZO" twice,
     six inches apart. On a league board the header stays exactly as it was: it is the
     playbill for THAT league and carries the cast strip. */
  document.getElementById('bzHead').style.display = hub ? 'none' : '';
  if(!hub) document.body.classList.remove('pb-hasbar');""",
'JS · hide the page header on the hub')



# ============================================================================
# 4 · The board header, set on the same press as the bill
# ============================================================================
# The board is already carnival — big top, brass cabinet, split-flap season board
# (Machine v2, shipped separately). What it was NOT doing was printing in the same
# hand as the directory. This is the smallest change that makes the two views one
# publication: the display face, the eyebrow's tracking, and the double rule.
#
# ⚠️ --bz-display was left as a variable on purpose, with a note saying a display
# face would be a one-line change but must not be a webfont (sw.js is draft-night
# offline insurance; a CDN face is a dependency the offline path cannot keep).
# "Arial Black" is a system face on every platform this site is read on and costs
# zero bytes over the wire, so this is that one-line change, taken.
once('''.playbill{--bz-display:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0 0 20px}
.playbill .eyebrow{font:700 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:3.4px;
  text-transform:uppercase;color:var(--accent);text-align:center;margin:0 0 9px}''',
'''.playbill{--bz-display:"Arial Black","Helvetica Neue",Helvetica,Arial,sans-serif;margin:0 0 20px}
.playbill .eyebrow{font:700 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.32em;
  text-transform:uppercase;color:var(--accent);text-align:center;margin:0 0 9px}
/* the bill's double rule, so the header reads as the top of the same broadside */
.playbill .eyebrow{padding-bottom:10px;border-bottom:1px solid var(--ink-1);
  box-shadow:0 3px 0 -1px var(--ink-1)}''',
     'CSS · board header on the same press')

# the wordmark takes the bill's letterpress offset, at board scale
once('''.playbill h1{font-family:var(--bz-display);font-weight:900;font-size:clamp(38px,11vw,54px);
  letter-spacing:-.5px;line-height:.95;text-transform:uppercase;text-align:center;margin:0}''',
'''.playbill h1{font-family:var(--bz-display);font-weight:900;font-size:clamp(40px,11.5vw,62px);
  letter-spacing:-.012em;line-height:.92;text-transform:uppercase;text-align:center;margin:6px 0 0;
  color:var(--accent);text-shadow:2px 3px 0 var(--pb-shadow)}
.playbill .dek em{font-family:Georgia,"Times New Roman",ui-serif,serif;font-style:italic}''',
     'CSS · board wordmark')


SRC.write_text(s, encoding="utf-8", newline=chr(10))  # Windows: keep the repo LF (AGENTS.md byte gates)
print('\nwrote', SRC, f'({len(s)-len(orig):+d} chars)')
