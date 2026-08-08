"""Build the flattened Pound page from the current site shell plus tested pure functions.

The deployed artifact remains pound.html. This helper exists so the shared navigation/auth
shell comes from an existing page and the calculator core stays independently testable.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
template = (ROOT / "nfelo.html").read_text(encoding="utf-8")
core = (ROOT / "work" / "pound-core.js").read_text(encoding="utf-8")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

style_end = template.index("</style>")
body_start = template.index("<body>")
nav_start = template.index('<script data-page="nfelo">', body_start)
nav_end = template.index("</script>", nav_start) + len("</script>")

CSS = r'''

/* ---- The Pound --------------------------------------------------------- */
.p-hero{padding:10px 0 4px;max-width:850px}
.p-kicker{font:750 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.p-hero h1{font-size:clamp(34px,7vw,66px);line-height:.95;letter-spacing:-.045em;margin:10px 0 14px}
.p-lead{font-size:clamp(16px,2.1vw,20px);max-width:760px;color:var(--ink-2);margin:0}
.p-disclosure{margin:22px 0;padding:14px 16px;border-left:4px solid var(--warn);background:color-mix(in srgb,var(--warn) 8%,var(--surface-1));border-radius:0 10px 10px 0;color:var(--ink-2)}
.p-jump{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 28px}
.p-jump a,.p-pill{border:1px solid var(--border);border-radius:999px;padding:6px 11px;color:var(--ink-2);text-decoration:none;font:700 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--surface-1)}
.p-jump a:hover{border-color:var(--accent);color:var(--accent)}
.p-section{scroll-margin-top:16px;margin:34px 0}
.p-section>header{display:flex;align-items:end;justify-content:space-between;gap:18px;border-bottom:1px solid var(--grid);padding-bottom:10px;margin-bottom:16px}
.p-section h2{margin:0;font-size:clamp(23px,3.5vw,34px);letter-spacing:-.025em}
.p-section .dek{color:var(--ink-3);margin:3px 0 0;max-width:720px}
.p-meta{font:700 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-align:right}
.p-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
.p-stat{border:1px solid var(--border);background:var(--surface-1);border-radius:10px;padding:13px}
.p-stat b{display:block;font-size:25px;line-height:1;color:var(--ink-1)}
.p-stat span{display:block;color:var(--ink-3);font:650 11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:6px;text-transform:uppercase}
.p-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:11px;background:var(--surface-1)}
.p-table{width:100%;border-collapse:collapse;min-width:820px;font-variant-numeric:tabular-nums}
.p-table th{position:sticky;top:0;background:var(--surface-1);color:var(--ink-3);font:750 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.04em;text-align:right;padding:10px;border-bottom:1px solid var(--grid)}
.p-table th:first-child,.p-table td:first-child{text-align:left}
.p-table td{padding:11px 10px;border-bottom:1px solid var(--grid);text-align:right}
.p-table tr:last-child td{border-bottom:0}.p-table .game{font-weight:800}.p-table .date{display:block;color:var(--ink-3);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;margin-top:2px}
.p-table .hot{color:var(--warn);font-weight:800}.p-table .cross{color:var(--bad);font-weight:800}
.p-loading,.p-error{padding:20px;color:var(--ink-3)}.p-error{color:var(--bad)}
.calc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.calc{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);padding:16px;min-width:0}
.calc.wide{grid-column:1/-1}.calc h3{margin:0 0 4px;font-size:17px}.calc .why{color:var(--ink-3);font-size:12.5px;margin:0 0 13px}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.fields.five{grid-template-columns:repeat(5,minmax(0,1fr))}
.field{display:flex;flex-direction:column;gap:4px}.field.full{grid-column:1/-1}.field label{font:700 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-transform:uppercase}
.field input,.field select{width:100%;border:1px solid var(--border);background:var(--page);color:var(--ink-1);border-radius:8px;padding:9px 10px;font:inherit;font-variant-numeric:tabular-nums}
.field input:focus,.field select:focus,.p-filter:focus{outline:2px solid var(--accent);outline-offset:2px}
.calc button{margin-top:11px;border:0;background:var(--accent);color:var(--accent-ink);border-radius:8px;padding:9px 13px;font-weight:800;cursor:pointer}.calc button:hover{filter:brightness(1.08)}
.answer{min-height:45px;margin-top:12px;border-top:1px solid var(--grid);padding-top:10px;color:var(--ink-2);font-variant-numeric:tabular-nums}.answer b{color:var(--ink-1);font-size:18px}.answer.err{color:var(--bad)}
.assumption{font-size:11.5px;color:var(--ink-3);margin:10px 0 0}.assumption b{color:var(--warn)}
.p-filter{border:1px solid var(--border);border-radius:8px;background:var(--surface-1);color:var(--ink-1);padding:8px 10px}
.inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tool{border:1px solid var(--border);border-radius:11px;background:var(--surface-1);padding:14px}.tool h3{font-size:16px;margin:6px 0}.tool p{margin:5px 0;color:var(--ink-2);font-size:13px}.tool .block{color:var(--ink-3);border-top:1px solid var(--grid);margin-top:9px;padding-top:9px}.tool code{font-size:11px}
.status{display:inline-flex;border-radius:999px;padding:3px 7px;font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;border:1px solid var(--border)}
.status-complete{color:var(--good);border-color:color-mix(in srgb,var(--good) 50%,var(--border))}.status-ready{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 50%,var(--border))}.status-frontend-only{color:var(--warn)}.status-backend-blocked,.status-data-blocked{color:var(--bad)}
.provenance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.prov{border:1px solid var(--border);border-radius:10px;padding:13px;background:var(--surface-1)}.prov h3{margin:0 0 6px;font-size:15px}.prov p{margin:4px 0;color:var(--ink-3);font-size:12px}.prov a{color:var(--accent)}
.machine-box{border:1px solid var(--border);border-radius:12px;padding:16px;background:var(--surface-1)}.machine-box code{overflow-wrap:anywhere}.machine-box li{margin:6px 0;color:var(--ink-2)}
@media(max-width:760px){.p-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.calc-grid,.inventory{grid-template-columns:1fr}.fields.five{grid-template-columns:repeat(2,minmax(0,1fr))}.provenance{grid-template-columns:1fr}.p-section>header{display:block}.p-meta{text-align:left;margin-top:7px}}
@media(max-width:430px){.fields{grid-template-columns:1fr}.fields.five{grid-template-columns:1fr}.p-summary{grid-template-columns:1fr 1fr}.calc{padding:13px}}
'''

CONTENT = r'''
<main>
  <header class="p-hero">
    <div class="p-kicker">The Pound · Worker tools live 2026-08-07</div>
    <h1>Tools that show their work. <a class="tierchip" href="index.html#tiers" title="Why this work is in The Pound">The Pound</a></h1>
    <p class="p-lead">A transparent model scoreboard and a set of deterministic football calculators. Useful now; still earning their collar. Missing data, licensing limits and ungraded claims stay visible.</p>
  </header>
  <div class="p-disclosure"><b>No oracle lives here.</b> Current game numbers are dated 2026 inputs. Calculator output is arithmetic or explicitly <b>MODELLED</b>. Nothing on this page has established betting profitability, and the multi-model system has not yet been graded prospectively.</div>
  <nav class="p-jump" aria-label="The Pound sections">
    <a href="#scoreboard">Scoreboard</a><a href="#calculators">Calculators</a><a href="#inventory">Tool inventory</a><a href="#provenance">Provenance</a><a href="#machines">For machines</a>
  </nav>

  <section class="p-section" id="scoreboard">
    <header><div><h2>Model Scoreboard</h2><p class="dek">Current Week 1 beliefs, normalized to home win probability. The equal-weight mean, range and standard deviation are descriptive—not a validated consensus blend or confidence score.</p></div><div class="p-meta">nfelo snapshot 2026-08-06<br>market observations carried in the schedule snapshot</div></header>
    <div class="p-summary" id="scoreSummary"><div class="p-stat"><b>—</b><span>games</span></div><div class="p-stat"><b>2</b><span>available beliefs</span></div><div class="p-stat"><b>0</b><span>prospectively graded models</span></div><div class="p-stat"><b>—</b><span>largest range</span></div></div>
    <div class="p-table-wrap"><div class="p-loading" id="scoreLoad" role="status">Loading the public dated surfaces…</div><table class="p-table" id="scoreTable" aria-label="Week 1 model and market belief scoreboard" hidden><thead><tr><th>Game</th><th>nfelo</th><th>Market</th><th>Mean</th><th>Range</th><th>Std dev</th><th>50% split?</th></tr></thead><tbody></tbody></table></div>
    <p class="assumption"><b>Important:</b> nfelo and market are highly related because nfelo regresses toward the market. Two correlated inputs are not independent confirmation. 538, SRS, Units, WEPA and QB-adjusted columns remain absent until lawful normalized forecasts exist.</p>
  </section>

  <section class="p-section" id="calculators">
    <header><div><h2>Calculators</h2><p class="dek">Pure functions. Inputs stay in this browser. Every result names the assumption it uses.</p></div><div class="p-meta">deterministic · no upload<br>public contracts</div></header>
    <div class="calc-grid">
      <form class="calc" id="oddsForm"><h3>Odds converter</h3><p class="why">American price → decimal odds + raw implied probability.</p><div class="field"><label for="oddsA">American odds</label><input id="oddsA" type="number" value="-110" required></div><button>Convert</button><div class="answer" id="oddsOut" aria-live="polite"></div></form>
      <form class="calc" id="parlayForm"><h3>Parlay calculator</h3><p class="why">Compounds prices. It does not claim the legs are independent.</p><div class="field"><label for="parlayA">American odds, comma separated</label><input id="parlayA" value="-110, +125, -150" required></div><button>Compound</button><div class="answer" id="parlayOut" aria-live="polite"></div><p class="assumption"><b>Not modelled:</b> correlation, limits, rejected legs or price movement.</p></form>
      <form class="calc" id="vigForm"><h3>Hold / vig calculator</h3><p class="why">Two-way raw implied probabilities and proportional devig.</p><div class="fields"><div class="field"><label for="vigA">Side A</label><input id="vigA" type="number" value="-110" required></div><div class="field"><label for="vigB">Side B</label><input id="vigB" type="number" value="-110" required></div></div><button>Remove vig</button><div class="answer" id="vigOut" aria-live="polite"></div></form>
      <form class="calc" id="evForm"><h3>Probability / EV</h3><p class="why">Your declared win probability against a price.</p><div class="fields"><div class="field"><label for="evP">Win probability %</label><input id="evP" type="number" value="55" min="0" max="100" step="0.1" required></div><div class="field"><label for="evA">American odds</label><input id="evA" type="number" value="-110" required></div></div><button>Calculate EV</button><div class="answer" id="evOut" aria-live="polite"></div><p class="assumption">The probability is an input, not something this calculator discovered.</p></form>
      <form class="calc" id="hedgeForm"><h3>Hedge calculator</h3><p class="why">Sizes the opposite side to equalize the two net outcomes.</p><div class="fields"><div class="field"><label for="hedgeS">Original stake</label><input id="hedgeS" type="number" value="100" min="0.01" step="0.01" required></div><div class="field"><label for="hedgeO">Original odds</label><input id="hedgeO" type="number" value="200" required></div><div class="field"><label for="hedgeH">Hedge odds</label><input id="hedgeH" type="number" value="-150" required></div></div><button>Size hedge</button><div class="answer" id="hedgeOut" aria-live="polite"></div><p class="assumption">Arithmetic, not advice. Ignores limits, tax and execution risk.</p></form>
      <form class="calc" id="passerForm"><h3>NFL passer rating</h3><p class="why">The public deterministic passer-rating formula—not QBR and not a forecast.</p><div class="fields five"><div class="field"><label for="prA">Att</label><input id="prA" type="number" value="30" min="1" step="1" required></div><div class="field"><label for="prC">Cmp</label><input id="prC" type="number" value="20" min="0" step="1" required></div><div class="field"><label for="prY">Yards</label><input id="prY" type="number" value="250" step="1" required></div><div class="field"><label for="prT">TD</label><input id="prT" type="number" value="2" min="0" step="1" required></div><div class="field"><label for="prI">INT</label><input id="prI" type="number" value="1" min="0" step="1" required></div></div><button>Rate line</button><div class="answer" id="passerOut" aria-live="polite"></div></form>
      <form class="calc" id="eloForm"><h3>538 Classic Elo · one game</h3><p class="why">MIT benchmark mathematics: logistic Elo probability with the original 65-Elo HFA default.</p><div class="fields"><div class="field"><label for="eloH">Home Elo</label><input id="eloH" type="number" value="1500" required></div><div class="field"><label for="eloA">Away Elo</label><input id="eloA" type="number" value="1500" required></div><div class="field"><label for="eloF">Home-field Elo</label><input id="eloF" type="number" value="65" required></div></div><button>Project game</button><div class="answer" id="eloOut" aria-live="polite"></div><p class="assumption">Calculator only. Current 2026 538 team states and prospective receipts are not built.</p></form>
      <form class="calc" id="transForm"><h3>Win % → expected margin / cover</h3><p class="why">Independent Data Dawgs normal-margin approximation using the published 13.18-point residual SD.</p><div class="fields"><div class="field"><label for="trP">Home win probability %</label><input id="trP" type="number" value="60" min="0.1" max="99.9" step="0.1" required></div><div class="field"><label for="trS">Residual SD, points</label><input id="trS" type="number" value="13.18" min="0.01" step="0.01" required></div><div class="field"><label for="trL">Home spread (favorite is negative)</label><input id="trL" type="number" value="-3" step="0.5"></div></div><button>Translate</button><div class="answer" id="transOut" aria-live="polite"></div><p class="assumption"><b>MODELLED:</b> win-probability inversion uses the site’s published 0.5-point win threshold. Cover uses sportsbook line convention and a continuous normal distribution with zero push mass. No injuries, weather, byes or NFL key-number mass.</p></form>
      <form class="calc" id="gradeForm"><h3>Forecast grader</h3><p class="why">Brier score and log loss for one declared probability.</p><div class="fields"><div class="field"><label for="grP">Forecast probability %</label><input id="grP" type="number" value="70" min="0" max="100" step="0.1" required></div><div class="field"><label for="grY">Outcome</label><select id="grY"><option value="1">Occurred (1)</option><option value="0">Did not occur (0)</option></select></div></div><button>Grade forecast</button><div class="answer" id="gradeOut" aria-live="polite"></div><p class="assumption">n=1. One score is not validation and earns no grade.</p></form>
      <form class="calc" id="consForm"><h3>Belief summary / disagreement lab</h3><p class="why">Equal-weight descriptive statistics for any declared probability list.</p><div class="field"><label for="consP">Probabilities %, comma separated</label><input id="consP" value="53, 59, 66" required></div><button>Describe beliefs</button><div class="answer" id="consOut" aria-live="polite"></div><p class="assumption">Equal weight only. This is not a validated consensus blend, opaque score, or claim that greater spread predicts error.</p></form>
    </div>
  </section>

  <section class="p-section" id="inventory">
    <header><div><h2>Every requested tool</h2><p class="dek">Nothing disappears because it is hard. Complete means the requested human, contract and MCP layers are live; blocked work keeps its exact blocker and minimum path.</p></div><label class="p-meta" for="toolFilter">Filter status<br><select class="p-filter" id="toolFilter"><option value="all">All</option><option>complete</option><option>ready</option><option>frontend-only</option><option>backend-blocked</option><option>data-blocked</option></select></label></header>
    <div class="inventory" id="toolInventory"><div class="p-loading">Loading the public inventory…</div></div>
  </section>

  <section class="p-section" id="provenance">
    <header><div><h2>Provenance before claims</h2><p class="dek">A public repository is not automatically reusable software. Integration mode follows the verified license.</p></div><div class="p-meta">captured 2026-08-07<br>primary repositories inspected</div></header>
    <div class="provenance" id="provGrid"><div class="p-loading">Loading upstream provenance…</div></div>
  </section>

  <section class="p-section" id="machines">
    <header><div><h2>The same evidence for machines</h2><p class="dek">Assistants should read deterministic state, not scrape the cards above.</p></div></header>
    <div class="machine-box"><ul>
      <li><a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a> — full inventory, delivery status and blockers.</li>
      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json</code></a> — normalized forecast, receipt and calculator contracts.</li>
      <li><a href="/data/upstream-models.json"><code>/data/upstream-models.json</code></a> — repository, commit, license status and integration mode.</li>
      <li><a href="/data/nfl-schedule.json"><code>/data/nfl-schedule.json</code></a> — validated canonical 2026 schedule, exact upstream commit and snapshot hash.</li>
      <li><a href="/data/model-receipts.json"><code>/data/model-receipts.json</code></a> — append-only normalized forecast ledger; empty until the first model runner ships.</li>
      <li><a href="/data/nfelo.json"><code>/data/nfelo.json</code></a> + <a href="/data/survivor.json"><code>/data/survivor.json</code></a> — the dated inputs behind the staged scoreboard.</li>
      <li><code>dd_analyze_matchup</code> — live Worker tool for the current matchup view.</li>
      <li><code>dd_elo_game</code>, <code>dd_translate_probability</code>, <code>dd_convert_odds</code>, <code>dd_devig_market</code>, <code>dd_price_parlay</code>, <code>dd_calculate_bet_ev</code>, <code>dd_calculate_hedge</code>, <code>dd_nfl_passer_rating</code>, <code>dd_score_forecast</code> and <code>dd_summarize_beliefs</code> — live, read-only Worker tools for deterministic calculations over caller-supplied inputs.</li>
    </ul><p class="assumption">The AI explains these outputs. It does not invent the underlying number, fill nulls or promote an ungraded tool.</p></div>
  </section>
</main>
<footer class="foot">Data Dawgs · Data, Not Dogma · <a href="/llms.txt">For machines</a> · All model and market numbers carry their date.</footer>
'''

CONTROLLER = r'''
(function(){
  const P=window.DDPound, $=id=>document.getElementById(id);
  const n=id=>Number($(id).value), pct=v=>(v*100).toFixed(2)+"%", signed=(v,digits=1)=>(v>=0?"+":"")+v.toFixed(digits);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const american=v=>(v>=0?"+":"")+Math.round(v);
  function values(id){return $(id).value.split(/[\s,;]+/).filter(Boolean).map(Number)}
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}
  function wire(form,out,fn){$(form).addEventListener("submit",e=>{e.preventDefault();const box=$(out);try{box.classList.remove("err");box.innerHTML=fn()}catch(err){box.classList.add("err");box.textContent=err.message}});$(form).requestSubmit()}
  wire("oddsForm","oddsOut",()=>{const r=P.oddsConverter(n("oddsA"));return `<b>${r.decimal.toFixed(3)} decimal</b><br>${pct(r.implied_probability)} raw implied probability`});
  wire("parlayForm","parlayOut",()=>{const r=P.parlay(values("parlayA"));return `<b>${american(r.american)}</b> · ${r.decimal.toFixed(3)} decimal<br>${pct(r.implied_probability)} raw implied probability`});
  wire("vigForm","vigOut",()=>{const r=P.holdVig(n("vigA"),n("vigB"));return `<b>${pct(r.hold)} hold</b><br>Devig: ${pct(r.devig_probability[0])} / ${pct(r.devig_probability[1])}`});
  wire("evForm","evOut",()=>{const r=P.betEV(n("evP")/100,n("evA"));return `<b>${signed(r.expected_profit_per_unit,3)} units EV</b> per unit<br>${pct(r.roi)} ROI · ${pct(r.break_even_probability)} break-even`});
  wire("hedgeForm","hedgeOut",()=>{const r=P.hedge(n("hedgeS"),n("hedgeO"),n("hedgeH"));return `<b>$${r.hedge_stake.toFixed(2)} hedge stake</b><br>Equalized net: $${r.locked_profit.toFixed(2)}`});
  wire("passerForm","passerOut",()=>{const r=P.passerRating(n("prA"),n("prC"),n("prY"),n("prT"),n("prI"));return `<b>${r.rating.toFixed(1)} NFL passer rating</b><br>Components: ${r.components.map(v=>v.toFixed(3)).join(" · ")}`});
  wire("eloForm","eloOut",()=>{const r=P.eloGame(n("eloH"),n("eloA"),n("eloF"));return `<b>${pct(r.home_win_probability)} home</b><br>${pct(r.away_win_probability)} away · adjusted Elo gap ${signed(r.adjusted_elo_difference)}`});
  wire("transForm","transOut",()=>{const r=P.normalTranslation(n("trP")/100,n("trS"),$("trL").value);return `<b>${signed(r.expected_margin_home)} expected home margin</b><br>${pct(r.home_cover_probability)} modelled P(home covers ${signed(r.home_line)}) · push ${pct(r.push_probability)}`});
  wire("gradeForm","gradeOut",()=>{const r=P.forecastGrade(n("grP")/100,n("grY"));return `<b>${r.brier.toFixed(4)} Brier</b><br>${r.log_loss.toFixed(4)} log loss · n=${r.sample_size}`});
  wire("consForm","consOut",()=>{const r=P.beliefSummary(values("consP").map(v=>v/100));return `<b>${pct(r.mean)} mean · ${pct(r.median)} median</b><br>range ${pct(r.min)}–${pct(r.max)} (${(r.range*100).toFixed(1)} pp) · SD ${(r.standard_deviation*100).toFixed(1)} pp · 50% split ${r.crosses_50?"yes":"no"}`});

  async function loadScoreboard(){
    try{
      const [nfEnv,svEnv]=await Promise.all([json("/data/nfelo.json"),json("/data/survivor.json")]);
      const nf=nfEnv.data.week1||[], games=(svEnv.data.games||[]).filter(g=>g.wk===1);
      if(!Array.isArray(nf)||!Array.isArray(games)||!games.length)throw new Error("dated Week 1 inputs are missing")
      const map=new Map(nf.map(g=>[g.a+"@"+g.h,g]));
      const rows=games.map(g=>{const m=map.get(g.a+"@"+g.h), beliefs=[m&&m.hwp,g.mk].filter(v=>Number.isFinite(v));const summary=beliefs.length?P.beliefSummary(beliefs):null;return {g,m,summary};}).sort((x,y)=>(y.summary?.range??-1)-(x.summary?.range??-1));
      const max=rows.reduce((a,r)=>Math.max(a,r.summary?.range||0),0), splits=rows.filter(r=>r.summary?.crosses_50).length, maxBeliefs=rows.reduce((a,r)=>Math.max(a,r.summary?.count||0),0);
      $("scoreSummary").innerHTML=`<div class="p-stat"><b>${rows.length}</b><span>games</span></div><div class="p-stat"><b>${maxBeliefs}</b><span>max beliefs / game</span></div><div class="p-stat"><b>0</b><span>prospectively graded models</span></div><div class="p-stat"><b>${(max*100).toFixed(1)} pp</b><span>largest range · ${splits} 50% splits</span></div>`;
      $("scoreTable").querySelector("tbody").innerHTML=rows.map(({g,m,summary:s})=>`<tr><td><span class="game">${esc(g.a)} @ ${esc(g.h)}</span><span class="date">${esc(g.d)} · ${esc(g.id)}</span></td><td>${Number.isFinite(m&&m.hwp)?pct(m.hwp):"—"}</td><td>${Number.isFinite(g.mk)?pct(g.mk):"—"}</td><td><b>${s?pct(s.mean):"—"}</b></td><td class="${s&&s.range>=.05?"hot":""}">${s?(s.range*100).toFixed(1)+" pp":"—"}</td><td>${s?(s.standard_deviation*100).toFixed(1)+" pp":"—"}</td><td class="${s&&s.crosses_50?"cross":""}">${s?(s.crosses_50?"YES":"no"):"—"}</td></tr>`).join("");
      $("scoreLoad").hidden=true;$("scoreTable").hidden=false;
    }catch(err){$("scoreLoad").className="p-error";$("scoreLoad").textContent="Scoreboard unavailable: "+err.message}
  }
  let allTools=[];
  function renderTools(status){const rows=status==="all"?allTools:allTools.filter(t=>t.status===status);$("toolInventory").innerHTML=rows.map(t=>`<article class="tool"><span class="status status-${esc(t.status)}">${esc(t.status)}</span><h3>${esc(t.name)}</h3><p>${esc(t.intended_user_value)}</p><p><b>Machine:</b> <code>${esc(t.machine_readable_requirement)}</code>${t.existing_worker_mcp_implementation?`<br><b>Live MCP:</b> <code>${esc(t.existing_worker_mcp_implementation)}</code>`:""}${t.staged_worker_mcp_implementation?`<br><b>Staged MCP:</b> <code>${esc(t.staged_worker_mcp_implementation)}</code>`:""}</p>${t.exact_blocker?`<p class="block"><b>Blocker:</b> ${esc(t.exact_blocker)}<br><b>Minimum path:</b> ${esc(t.minimum_path_to_completion)}</p>`:""}</article>`).join("")||'<div class="p-loading">No tools match.</div>'}
  async function loadInventory(){try{const env=await json("/data/pound-tools.json");if(!Array.isArray(env.data))throw new Error("inventory payload is malformed");allTools=env.data;renderTools("all");$("toolFilter").addEventListener("change",e=>renderTools(e.target.value))}catch(err){$("toolInventory").innerHTML='<div class="p-error">Inventory unavailable: '+esc(err.message)+'</div>'}}
  async function loadProvenance(){try{const env=await json("/data/upstream-models.json");if(!Array.isArray(env.data))throw new Error("provenance payload is malformed");$("provGrid").innerHTML=env.data.map(x=>`<article class="prov"><h3>${esc(x.id)}</h3><p><a href="https://github.com/${esc(x.repository)}" target="_blank" rel="noopener">${esc(x.repository)}</a></p><p><b>License:</b> ${esc(x.license||"unverified")} · ${esc(x.license_status)}</p><p><b>Mode:</b> ${esc(x.integration_mode)}</p><p>${esc(x.notes)}</p></article>`).join("")}catch(err){$("provGrid").innerHTML='<div class="p-error">Provenance unavailable: '+esc(err.message)+'</div>'}}
  loadScoreboard();loadInventory();loadProvenance();
})();
'''

head = template[:style_end] + CSS + "\n</style>\n</head>"
head = replace_once(head, "<title>nfelo Power Ratings · Data Dawgs</title>", "<title>The Pound · Data Dawgs</title>", "page title")
shell = replace_once(template[body_start:nav_end], 'data-page="nfelo"', 'data-page="pound"', "page identity")
shell = replace_once(shell, '"strategy":"/data/strategy.md"', '"strategy":"/data/strategy.md",\n      "pound":"/data/pound-tools.json"', "primary machine surface")
shell = replace_once(shell, '"survivor":["/data/models.json"],', '"survivor":["/data/models.json"],\n      "pound":["/data/model-contracts.json","/data/upstream-models.json"],', "secondary machine surfaces")

page = head + "\n" + shell + "\n" + CONTENT + "\n<script>\n" + core + "\n</script>\n<script>\n" + CONTROLLER + "\n</script>\n</div>\n</body>\n</html>\n"
(ROOT / "pound.html").write_text(page, encoding="utf-8", newline="\n")
print(f"wrote pound.html ({len(page):,} chars)")
