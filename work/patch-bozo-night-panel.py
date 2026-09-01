"""Add the read-only Bozo night hypothetical and keep Toto's manual in sync."""
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
    """.pb-bill .slip .sl-exp b{letter-spacing:.1em;text-transform:uppercase;font-size:10px}
/* ================= ACTS I–IV: the four levers ================= */""",
    """.pb-bill .slip .sl-exp b{letter-spacing:.1em;text-transform:uppercase;font-size:10px}
/* The hypothetical sits outside the receipt: it reads the filed rows but is not a
   graded fact, and its visible assumption is part of the component rather than a tip. */
.pb-bill .bozo-tonight{margin:14px 0 0;padding:14px clamp(13px,2.4vw,20px);
  border:1px solid var(--pb-red);background:color-mix(in srgb,var(--pb-red) 7%,transparent);
  color:var(--pb-ink);font-family:var(--pb-serif)}
.pb-bill .bozo-tonight[hidden]{display:none}
.pb-bill .bozo-tonight .bt-k{margin:0 0 5px;font:700 9px/1.5 var(--pb-mono);
  letter-spacing:.24em;text-transform:uppercase;color:var(--pb-red)}
.pb-bill .bozo-tonight h3{margin:0 0 8px;font-family:var(--pb-display);font-size:clamp(16px,2.4vw,22px);
  line-height:1.05;text-transform:uppercase;color:var(--pb-ink)}
.pb-bill .bozo-tonight .bt-row{margin:7px 0;color:var(--pb-ink2);line-height:1.5}
.pb-bill .bozo-tonight .bt-row b{color:var(--pb-ink)}
.pb-bill .bozo-tonight .bt-label{font:700 9.5px/1.4 var(--pb-mono);letter-spacing:.12em;
  text-transform:uppercase;color:var(--pb-red);margin-right:.55em}
.pb-bill .bozo-tonight .bt-assumption{margin:10px 0 0;padding-top:9px;border-top:1px solid var(--pb-rule);
  font:10.5px/1.55 var(--pb-mono);color:var(--pb-ink3)}
/* ================= ACTS I–IV: the four levers ================= */""",
    "panel styles",
)
s = replace_once(
    s,
    """    <p class="pb-sub" id="pbHouseSub">&mdash;</p>
    <div class="slip" id="houseSlip"></div>
  </section>""",
    """    <p class="pb-sub" id="pbHouseSub">&mdash;</p>
    <div class="slip" id="houseSlip"></div>
    <section class="bozo-tonight" id="bozoTonight" aria-live="polite" hidden></section>
  </section>""",
    "panel markup",
)
s = replace_once(
    s,
    """const NUMWORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                 'eleven','twelve'];
function paintHouseTicket(){""",
    """const NUMWORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                 'eleven','twelve'];

/* A read-only standing, never a forecast. Before lock there is no running order; after
   lock, only levers computable from filed rows may speak. Beat needs outcomes, and CLV
   needs a complete close, so neither is inferred here. */
function bozoTonightModel(players, picks, status, order, results){
  const live = players.map(p=>({p, ...(picks[kEnc(p)]||{})}))
    .filter(x=>Number.isFinite(+x.price));
  const anyOutcome = Object.values(results||{}).some(r=>r && typeof r.won==='boolean');
  if(live.length < 2 || status==='graded' || anyOutcome) return null;

  const minPrice = Math.min(...live.map(x=>+x.price));
  const shortest = {key:'odds', name:'Shortest odds', value:minPrice,
    leaders:live.filter(x=>+x.price===minPrice)};
  const timed = live.filter(x=>Number.isFinite(+x.ts));
  const lastTs = timed.length ? Math.max(...timed.map(x=>+x.ts)) : null;
  const last = lastTs==null ? null : {key:'last', name:'Last in', value:lastTs,
    leaders:timed.filter(x=>+x.ts===lastTs)};
  const standings = [shortest, last].filter(Boolean);

  if(status==='open') return {state:'open', standings};
  if(status!=='placed' || !Array.isArray(order)) return null;
  const byLever = {0:shortest, 2:last};
  const first = order.map(Number).map(i=>byLever[i]).find(Boolean);
  return first ? {state:'placed', first} : null;
}
window.DDBozoTonightModel = bozoTonightModel;

function tonightNames(leaders){
  const a = leaders.map(x=>teamOf(x.p));
  if(a.length < 2) return a[0] || '';
  if(a.length === 2) return a[0] + ' and ' + a[1];
  return a.slice(0,-1).join(', ') + ', and ' + a[a.length-1];
}
function paintBozoTonight(players, picks, status, results){
  const el = document.getElementById('bozoTonight'); if(!el) return;
  const m = bozoTonightModel(players, picks, status, S.order, results);
  if(!m){ el.hidden=true; el.innerHTML=''; return; }
  const assumption = 'Hypothetical: assumes every currently filed leg loses. Nothing has been graded.';
  el.hidden=false;
  if(m.state==='open'){
    el.innerHTML = `<p class="bt-k">Independent lever standings</p><h3>As it stands</h3>` +
      m.standings.map(x=>x.key==='odds'
        ? `<p class="bt-row"><span class="bt-label">Shortest odds</span><b>${esc(tonightNames(x.leaders))}</b> holds the shortest price on the board (${x.value>0?'+':''}${x.value}).</p>`
        : `<p class="bt-row"><span class="bt-label">Last in</span><b>${esc(tonightNames(x.leaders))}</b> filed most recently${x.leaders.length>1?' at the same time':''}.</p>`).join('') +
      `<p class="bt-assumption">No running order exists before the card locks. These are separate standings, not a bozo prediction. ${assumption}</p>`;
    return;
  }
  const x=m.first, namesText=esc(tonightNames(x.leaders));
  const value = x.key==='odds' ? ` (${x.value>0?'+':''}${x.value})` : '';
  el.innerHTML = `<p class="bt-k">Written order, computable levers only</p><h3>If every leg lost</h3>` +
    `<p class="bt-row">First computable lever drawn: <span class="bt-label">${esc(x.name)}</span>` +
    `<b>${namesText}</b>${x.leaders.length>1?' are tied':' currently leads'}${value}.</p>` +
    `<p class="bt-assumption">${assumption} This panel never names a bozo.</p>`;
}

function paintHouseTicket(){""",
    "panel logic",
)
s = replace_once(
    s,
    """      '<p class="sl-note">The league boards are not reachable from this device right now. ' +
      'Nothing below is stale — there is simply nothing to print.</p>';
    if(bar) bar.hidden = true;""",
    """      '<p class="sl-note">The league boards are not reachable from this device right now. ' +
      'Nothing below is stale — there is simply nothing to print.</p>';
    paintBozoTonight([], {}, 'open', {});
    if(bar) bar.hidden = true;""",
    "empty state hides panel",
)
s = replace_once(
    s,
    """    `and there are no edits after it. Prices above are <b>self-reported</b> and are not ` +
    `checked against any book.</p>`;

  // The pinned stub.""",
    """    `and there are no edits after it. Prices above are <b>self-reported</b> and are not ` +
    `checked against any book.</p>`;

  paintBozoTonight(players, picks, status, res);

  // The pinned stub.""",
    "panel render call",
)
s = replace_once(
    s,
    """- A spread or total priced past about -145 is off market and worth mentioning if you see one. A moneyline has no internal cross-check at all.
- You may NOT place, edit or remove anyone's leg, and you must never tell someone their bet is guaranteed. Prices and probabilities, never certainties.`;""",
    """- A spread or total priced past about -145 is off market and worth mentioning if you see one. A moneyline has no internal cross-check at all.
- The "As it stands / If every leg lost" panel is a read-only hypothetical over currently filed legs. It assumes every filed leg loses, does not know results, and never names a bozo. Before the card locks there is no running order at all. Never present the panel as a prediction, a probability, or a graded outcome.
- You may NOT place, edit or remove anyone's leg, and you must never tell someone their bet is guaranteed. Prices and probabilities, never certainties.`;""",
    "Toto panel caveat",
)
PAGE.write_text(s, encoding="utf-8", newline="\n")

# HELP and MAP are copied into the 31 production pages that carry Toto inline. Keep the
# page manual byte-identical everywhere; the standalone design reference intentionally
# has no site runtime and is not rewritten.
help_old = 'STATE: everything saves in the browser on that device, under its own key per league'
help_new = ('BOZO HYPOTHETICAL (bozo.html): "As it stands" reports Shortest Odds and Last In separately before lock. '
            '"If every leg lost" walks the written order after lock and shows the first computable lever. '
            'Both are read-only hypotheticals, assume every filed leg loses, and never name a bozo.\n' + help_old)
map_old = 'bozo.html — the weekly one-leg parlay game: board, ledger, closing-line value, standings, the belt.'
map_new = ('bozo.html — the weekly one-leg parlay game: board, ledger, closing-line value, standings, the belt, '
           'and a read-only "as it stands / if every leg lost" hypothetical that never names a bozo.')

patched = 0
for path in sorted(ROOT.glob('*.html')):
    text = path.read_text(encoding='utf-8')
    if 'const HELP = `AUCTIONEER CONTROLS' not in text:
        continue
    if help_new in text:
        print(f'  skip {path.name} HELP - already patched')
    else:
        assert text.count(help_old) == 1, f'{path.name} HELP anchor count {text.count(help_old)}'
        text = text.replace(help_old, help_new, 1)
    text = replace_once(text, map_old, map_new, f'{path.name} MAP')
    path.write_text(text, encoding='utf-8', newline='\n')
    patched += 1
assert patched == 31, f'expected 31 inline Toto pages, got {patched}'
print(f'  panel current; HELP/MAP current on {patched} pages')
