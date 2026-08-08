"""
The projection-vs-rarity card on dfs.html: the frontier, the cost curve, the portfolio
overlay, and the table view that makes every plotted number readable without a mouse.

    python3 work/patch-dfs-rarity-ui.py          (from the repo root; run the engine
                                                  patch first)

⚠️ ANCHORED, RE-RUNNABLE, AND IT COUNTS. Every pair asserts its old text appears exactly
once before replacing it, and the whole script no-ops if the card is already there.

⚠️ TWO CHARTS, NOT ONE WITH TWO AXES. The frontier is projection against ownership; the
cost curve is points-per-ownership-point against ownership. Those are different units, so
they get their own plots stacked on a shared x range. A second y-axis on one plot would
invent a relationship between the two scales.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "dfs.html"
SW = ROOT / "sw.js"

page = PAGE.read_text()

if 'id="rarityCard"' in page:
    print("page: rarity card already present — nothing to do")
    raise SystemExit(0)

# --------------------------------------------------------------------- 1. the markup

HTML_OLD = '''  <div class="card"><h3>Salary used</h3><div id="expSal"></div></div>
'''
HTML_NEW = '''  <div class="card"><h3>Salary used</h3><div id="expSal"></div></div>
  <div class="card" id="rarityCard">
    <h3>Projection vs rarity <span class="rt" id="rarityState"></span></h3>
    <p class="sub">Every projected point you add to a lineup costs you ownership, and in a
      tournament ownership is what you are trying not to have. This traces the exact trade:
      for each level of cumulative ownership, the most projection any legal lineup can
      reach — and where your own lineups sit against it.</p>
    <div class="btnrow">
      <button class="btn sm" id="rarityGo">Trace the frontier</button>
      <button class="btn ghost sm" id="rarityTabGo" aria-expanded="false" aria-controls="rarityTab">Show the numbers</button>
    </div>
    <div class="prog" id="rarityProg" hidden><i></i></div>
    <div class="banner" id="rarityWarn" hidden></div>
    <div class="statrow" id="rarityStats" hidden></div>
    <div id="rarityLegend" class="rlegend" hidden>
      <span><i class="k-front"></i>Frontier — the best projection available at that ownership</span>
      <span><i class="k-port"></i>Your lineups</span>
    </div>
    <div id="rarityChart"></div>
    <div id="rarityCost"></div>
    <p class="note" id="rarityNote"></p>
    <div class="tscroll" id="rarityTab" hidden><table class="dtab" id="rarityTabT"></table></div>
  </div>
'''
assert page.count(HTML_OLD) == 1, "the Salary used card is not unique"
page = page.replace(HTML_OLD, HTML_NEW, 1)

# --------------------------------------------------------------------- 2. the styles
# ⚠️ dfs.html carries three copies of the chart-ish rules (base, then two media blocks
# that restate them). The legend key is layout-independent, so it goes in once, next to
# the single .statrow definition — which is why that anchor and not .prog.

CSS_OLD = ".prog{height:6px;background:var(--grid);border-radius:4px;overflow:hidden;margin:12px 0 0}\n"
CSS_NEW = (CSS_OLD +
           ".rlegend{display:flex;flex-wrap:wrap;gap:6px 18px;margin:14px 0 2px;font-size:12px;color:var(--ink-2)}\n"
           ".rlegend span{display:inline-flex;align-items:center;gap:7px}\n"
           ".rlegend i{width:14px;height:0;border-top:2px solid var(--ink-2);flex:none}\n"
           ".rlegend i.k-port{width:9px;height:9px;border:0;border-radius:50%;background:var(--accent)}\n"
           ".rtip{position:absolute;z-index:40;pointer-events:none;background:var(--surface-1);\n"
           "  border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:12px;\n"
           "  color:var(--ink-1);box-shadow:0 4px 14px rgba(0,0,0,.35);white-space:nowrap}\n"
           ".rtip b{color:var(--ink-1)} .rtip span{color:var(--ink-3)}\n")
assert page.count(CSS_OLD) == 3, "expected three copies of the .prog rule, found %d" % page.count(CSS_OLD)
page = page.replace(CSS_OLD, CSS_NEW, 1)

# --------------------------------------------------------------------- 3. the logic

JS_OLD = "function renderExposure() {\n"
JS_NEW = r'''/* ============================================================================
   PROJECTION vs RARITY

   ⚠️ WHAT THE CURVE IS. Each point is a lineup that is EXACTLY optimal for one weighting
   of projection against ownership — proved, not approximated. The line between two points
   is a chord of the convex hull, so it is a floor: the real frontier is at or above it,
   never below. A lineup in a dent between two vertices is optimal for no weighting at all
   and cannot be found by this method. The note under the chart says so; do not delete it.

   ⚠️ OWNERSHIP IS AN IMPORT, NOT AN OBSERVATION. Everything here is measured in the
   ownership numbers the user pasted in. They are somebody's projection of the field.
   ========================================================================== */

let FRONT = null, frontWorker = null;

function runFrontier() {
  const st = poolStats();
  if (!st.priced) { banner("rarityWarn", "err", "<b>No projections.</b> There is nothing to trade off yet."); return; }
  if (!st.own) {
    banner("rarityWarn", "err", "<b>No ownership.</b> This chart is entirely about ownership, so it cannot be drawn without it. Re-import your projections with the ownership column mapped.");
    return;
  }
  readCfg();
  const players = enginePlayers();
  const cfg = {
    site: S.site, minSalary: S.cfg.minSal, maxSalary: S.cfg.maxSal,
    maxPerTeam: S.cfg.team, maxPerGame: S.cfg.game,
    stack: { qbMin: S.cfg.qbMin, qbPos: S.cfg.qbPos.split(","), bringBack: S.cfg.bring,
             noRbVsDst: S.cfg.noRbDst, noOppDst: S.cfg.noOppDst },
    timeLimitMs: 30000
  };
  banner("rarityWarn", null, null);
  $("rarityProg").hidden = false; $("rarityProg").firstElementChild.style.width = "5%";
  $("rarityGo").disabled = true;
  $("rarityState").textContent = "tracing…";
  const t0 = Date.now();

  const finish = (r) => {
    $("rarityProg").hidden = true; $("rarityGo").disabled = false;
    FRONT = r; FRONT.ms = Date.now() - t0; FRONT.cfg = cfg;
    $("rarityState").textContent = r.points.length
      ? `${r.points.length} point${r.points.length === 1 ? "" : "s"} in ${(FRONT.ms / 1000).toFixed(1)}s` : "";
    drawRarity();
  };

  if (WORKER_URL) {
    try {
      if (frontWorker) frontWorker.terminate();
      frontWorker = new Worker(WORKER_URL);
      frontWorker.onmessage = (e) => {
        const d = e.data;
        if (d.type === "progress") $("rarityProg").firstElementChild.style.width = Math.max(5, (d.n / d.t) * 100) + "%";
        else if (d.type === "done") { finish(d.result); frontWorker.terminate(); frontWorker = null; }
        else if (d.type === "error") {
          $("rarityProg").hidden = true; $("rarityGo").disabled = false; $("rarityState").textContent = "";
          banner("rarityWarn", "err", "<b>The sweep failed.</b> " + esc(d.message));
        }
      };
      frontWorker.onerror = () => { frontWorker = null; setTimeout(() => finish(E.frontier(players, cfg)), 20); };
      frontWorker.postMessage({ op: "frontier", players, cfg });
      return;
    } catch (e) { frontWorker = null; }
  }
  banner("rarityWarn", "warn", "<b>Running on the main thread.</b> This browser blocked the background worker, so the page will be unresponsive until the sweep finishes.");
  setTimeout(() => finish(E.frontier(players, cfg)), 30);
}

/* the hull, read as a function of ownership — used for the gap each lineup gives up */
function hullAt(pts, own) {
  if (pts.length < 2 || own < pts[0].own || own > pts[pts.length - 1].own) return null;
  for (let i = 1; i < pts.length; i++) {
    if (own <= pts[i].own + 1e-9) {
      const a = pts[i - 1], b = pts[i];
      return a.proj + (own - a.own) * (b.proj - a.proj) / (b.own - a.own);
    }
  }
  return null;
}

function portfolioPoints() {
  const P = S.players;
  return S.lineups.map((l, i) => ({
    i, proj: l.proj, sal: l.sal,
    own: l.ids.reduce((t, id) => t + (P[id].own || 0), 0)
  }));
}

function drawRarity() {
  const chart = $("rarityChart"), cost = $("rarityCost"), note = $("rarityNote");
  const stats = $("rarityStats"), legend = $("rarityLegend");
  /* ⚠️ The card mirrors its own state onto data- attributes, the same way the Upside Down
     mirrors the page: what is on screen should be readable by something that is not a
     pair of eyes. It is also what the browser test asserts against. */
  const card = $("rarityCard");
  const stamp = o => { for (const k of ["points", "solves", "capped", "lineups", "unavailable"]) delete card.dataset[k];
                       for (const k in o) if (o[k] != null) card.dataset[k] = String(o[k]); };

  if (!FRONT) { chart.innerHTML = cost.innerHTML = ""; note.textContent = ""; stats.hidden = legend.hidden = true; $("rarityTab").hidden = true; stamp({}); return; }

  if (FRONT.unavailable || FRONT.points.length < 2) {
    chart.innerHTML = cost.innerHTML = ""; stats.hidden = legend.hidden = true; $("rarityTab").hidden = true;
    const why = FRONT.unavailable === "showdown"
      ? "<b>Not available on a showdown slate.</b> Cumulative ownership is not the right rarity measure when one player is a captain at 1.5&times; — the sweep would be optimising something other than what the chart claims to show, so it refuses rather than drawing it."
      : FRONT.unavailable === "no-ownership"
        ? "<b>No ownership in the pool.</b> Re-import your projections with the ownership column mapped."
        : FRONT.unavailable === "infeasible"
          ? "<b>No lineup satisfies these constraints.</b> The frontier is empty because the pool is."
          : `<b>Only ${FRONT.points.length} point${FRONT.points.length === 1 ? "" : "s"} could be proved</b> inside the ${(FRONT.ms / 1000).toFixed(0)}s budget. A curve needs at least two. Widening the salary window is usually what unsticks it.`;
    banner("rarityWarn", "warn", why);
    note.textContent = "";
    stamp({ points: FRONT.points.length, solves: FRONT.solves, unavailable: FRONT.unavailable || "too-few-points" });
    return;
  }

  const pts = FRONT.points, segs = FRONT.segments, port = portfolioPoints();
  const owns = pts.map(p => p.own).concat(port.map(p => p.own));
  const projs = pts.map(p => p.proj).concat(port.map(p => p.proj));
  const x0 = Math.min(...owns), x1 = Math.max(...owns);
  const y0 = Math.min(...projs), y1 = Math.max(...projs);
  const xs = (x1 - x0) || 1, ys = (y1 - y0) || 1;
  const W = Math.max(280, chart.clientWidth || 640);
  const H = 260, PADL = 46, PADR = 16, PADT = 14, PADB = 34;
  const X = v => PADL + ((v - x0 + xs * 0.04) / (xs * 1.08)) * (W - PADL - PADR);
  const Y = v => PADT + (1 - (v - y0 + ys * 0.06) / (ys * 1.12)) * (H - PADT - PADB);

  const ticksY = [y0, y0 + (y1 - y0) / 2, y1];
  const ticksX = [x0, x0 + (x1 - x0) / 2, x1];
  const grid = ticksY.map(v => `<line x1="${PADL}" y1="${Y(v).toFixed(1)}" x2="${W - PADR}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${PADL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-3)" style="font-variant-numeric:tabular-nums">${fmt(v, 0)}</text>`).join("")
    + ticksX.map((v, i) => `<text x="${X(v).toFixed(1)}" y="${H - 12}" text-anchor="${i === 0 ? "start" : i === 2 ? "end" : "middle"}" font-size="10" fill="var(--ink-3)" style="font-variant-numeric:tabular-nums">${fmt(v, 0)}%</text>`).join("");

  const line = pts.map((p, i) => (i ? "L" : "M") + X(p.own).toFixed(1) + " " + Y(p.proj).toFixed(1)).join(" ");
  const marks = pts.map(p => `<rect x="${(X(p.own) - 3.5).toFixed(1)}" y="${(Y(p.proj) - 3.5).toFixed(1)}" width="7" height="7"
      fill="var(--surface-1)" stroke="var(--ink-2)" stroke-width="2"/>`).join("");
  const dots = port.map(p => `<circle cx="${X(p.own).toFixed(1)}" cy="${Y(p.proj).toFixed(1)}" r="4"
      fill="var(--accent)" stroke="var(--surface-1)" stroke-width="2"/>`).join("");
  // ⚠️ Two labels, not one per point. The axis and the tooltip carry the rest.
  const rich = pts[pts.length - 1], lean = pts[0];
  // ⚠️ ABOVE the rare-end point, not below it. Below puts this text straight through the
  // x-axis tick for the same value, and the two render as one unreadable smear.
  const labels =
    `<text x="${(X(rich.own) - 8).toFixed(1)}" y="${(Y(rich.proj) - 9).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-2)">best projection ${fmt(rich.proj)}</text>` +
    `<text x="${(X(lean.own) + 9).toFixed(1)}" y="${(Y(lean.proj) - 7).toFixed(1)}" font-size="10" fill="var(--ink-2)">rarest reached ${fmt(lean.own, 0)}%</text>`;

  chart.innerHTML = `<div style="position:relative">
    <svg id="raritySvg" viewBox="0 0 ${W} ${H}" width="100%" style="height:auto;display:block;touch-action:pan-y" role="img"
      aria-label="Projected points against cumulative ownership. The frontier runs from ${fmt(lean.own, 0)}% ownership at ${fmt(lean.proj)} projected points up to ${fmt(rich.own, 0)}% at ${fmt(rich.proj)}. ${port.length} of your lineups are plotted against it. Exact figures are in the table below.">
      ${grid}
      <path d="${line}" fill="none" stroke="var(--ink-2)" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${marks}${labels}
      <text x="${PADL}" y="${PADT - 2}" font-size="10" fill="var(--ink-3)">projected points</text>
      <text x="${W - PADR}" y="${H - 24}" text-anchor="end" font-size="10" fill="var(--ink-3)">cumulative ownership</text>
    </svg></div>`;

  /* ---- the cost curve: a second plot, its own y-axis, the same x range ----
     ⚠️ LOG SCALE, AND IT SAYS SO. The exchange rate on a real slate spans three orders of
     magnitude — the first step off the rarest lineup can buy 5 points per ownership point
     and the last buys 0.01. On a linear axis every step but the first is a flat line on
     the floor, which is a chart that shows nothing. The caption sits ABOVE the plot, not
     under it: the Ask Toto launcher is fixed to the bottom-right of every page and eats
     anything parked down there. */
  const CH = 132, rates = segs.map(s => s.rate);
  const rHi = Math.max(...rates), rLoRaw = Math.min(...rates);
  const rLo = Math.max(rLoRaw, rHi / 1000);        // three decades is as far as the eye goes
  const lg = v => Math.log10(Math.max(v, rLo));
  const span = Math.max(lg(rHi) - lg(rLo), 0.3);
  const rY = v => 16 + (1 - (lg(v) - lg(rLo)) / span) * (CH - 16 - 30);
  const decades = [];
  for (let e = Math.ceil(Math.log10(rLo)); e <= Math.floor(Math.log10(rHi)); e++) decades.push(Math.pow(10, e));
  // ⚠️ Name the bottom of the axis. Without it the last step floats under the lowest
  // decade line with nothing to read it against, and looks like it means zero.
  if (!decades.length || decades[0] > rLo * 1.6) decades.unshift(rLo);
  const dLines = decades.map(v => `<line x1="${PADL}" y1="${rY(v).toFixed(1)}" x2="${W - PADR}" y2="${rY(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${PADL - 8}" y="${(rY(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-3)" style="font-variant-numeric:tabular-nums">${v >= 1 ? v : fmt(v, v < 0.1 ? 3 : 2)}</text>`).join("");
  const steps = segs.map(s => {
    const xa = X(s.from.own).toFixed(1), xb = X(s.to.own).toFixed(1), yy = rY(s.rate).toFixed(1);
    return `<line class="cstep" x1="${xa}" y1="${yy}" x2="${xb}" y2="${yy}" stroke="var(--ink-2)" stroke-width="2" stroke-linecap="round"/>`;
  }).join("");
  const clipped = rates.filter(r => r < rHi / 1000).length;
  cost.innerHTML =
    `<p class="note" style="margin:14px 0 0">What each step of ownership buys, along the frontier —
      projected points per point of cumulative ownership, on a <b>log scale</b> (it spans
      ${fmt(rHi, 2)} down to ${fmt(rLoRaw, rLoRaw < 0.1 ? 3 : 2)}).${clipped ? ` ${clipped} step${clipped === 1 ? " is" : "s are"} below the bottom of the axis and sit${clipped === 1 ? "s" : ""} on it.` : ""}</p>
    <svg viewBox="0 0 ${W} ${CH}" width="100%" style="height:auto;display:block;margin-top:4px" role="img"
      aria-label="The exchange rate along the frontier on a log scale: projected points gained per point of cumulative ownership added. It falls from ${fmt(rHi, 2)} at the rare end to ${fmt(rLoRaw, 3)} at the chalky end. The same figures are in the table below.">
    ${dLines}${steps}
    <text x="${PADL}" y="${CH - 8}" font-size="10" fill="var(--ink-3)">rarer ←</text>
    <text x="${W - PADR}" y="${CH - 8}" text-anchor="end" font-size="10" fill="var(--ink-3)">→ chalkier</text>
  </svg>`;

  /* ---- the headline numbers ---- */
  const gaps = port.map(p => { const h = hullAt(pts, p.own); return h == null ? null : h - p.proj; }).filter(v => v != null);
  gaps.sort((a, b) => a - b);
  const med = gaps.length ? gaps[gaps.length >> 1] : null;
  stats.hidden = false; legend.hidden = false;
  stats.innerHTML = [
    ["Frontier points", pts.length],
    ["Exact solves", FRONT.solves],
    ["Best projection", fmt(rich.proj)],
    ["Rarest reached", fmt(lean.own, 0) + "%"],
    ["Median lineup gives up", med == null ? "—" : fmt(med) + " pts"]
  ].map(([l, v]) => `<div class="s"><div class="sv">${v}</div><div class="sl">${l}</div></div>`).join("");

  /* ---- the table view: every plotted number, readable without a pointer ---- */
  let t = `<thead><tr><th>Cumulative own</th><th>Projection</th><th>Salary</th><th>Next point costs</th></tr></thead><tbody>`;
  pts.forEach((p, i) => {
    const s = segs[i];
    t += `<tr><td>${fmt(p.own)}%</td><td>${fmt(p.proj)}</td><td>$${p.sal.toLocaleString()}</td>
      <td>${s ? fmt(s.rate, 3) + " pts per own%" : "—"}</td></tr>`;
  });
  $("rarityTabT").innerHTML = t + "</tbody>";

  /* ---- and what none of it proves ---- */
  const outside = port.length - gaps.length;
  note.innerHTML =
    `Traced with <b>${FRONT.solves}</b> exact solves in ${(FRONT.ms / 1000).toFixed(1)}s under the salary window and stack rules currently set on the Solver sheet. ` +
    `Every square is a lineup proved optimal for one weighting of projection against ownership. ` +
    `<b>The line joining them is the convex hull, not the frontier</b> — it is a floor, so the true best-at-that-ownership is at or above it, and a lineup that beats the straight line at some ownership in between is optimal for no weighting at all and cannot be found this way. ` +
    (FRONT.capped ? `The sweep stopped on its ${E.FRONTIER_MAX_SOLVES}-solve budget rather than on convergence, so there are hull vertices it did not reach — the rare end especially, where the search is hardest. ` : "") +
    (outside > 0 ? `${outside} of your ${port.length} lineups sit outside the ownership range that was traced, so no gap is computed for them. ` : "") +
    `Ownership is whatever you imported: somebody's projection of the field, not an observation of it. Change it and this whole picture moves.`;

  stamp({ points: pts.length, solves: FRONT.solves, capped: FRONT.capped, lineups: port.length });
  attachRarityTip(pts, port, X, Y, W, H);
}

/* Nearest-point hover. ⚠️ The tooltip enhances; it never gates. Every number in it is
   also in the table view above, which is why that toggle exists. */
function attachRarityTip(pts, port, X, Y, W, H) {
  const svg = $("raritySvg"); if (!svg) return;
  const wrap = svg.parentNode;
  const all = pts.map(p => ({ x: X(p.own), y: Y(p.proj), kind: "frontier", own: p.own, proj: p.proj, sal: p.sal }))
    .concat(port.map(p => ({ x: X(p.own), y: Y(p.proj), kind: "lineup", own: p.own, proj: p.proj, sal: p.sal, i: p.i })));
  let tip = null;
  const hide = () => { if (tip) { tip.remove(); tip = null; } };
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (W / r.width), sy = (ev.clientY - r.top) * (H / r.height);
    let best = null, bd = Infinity;
    for (const p of all) { const d = (p.x - sx) ** 2 + (p.y - sy) ** 2; if (d < bd) { bd = d; best = p; } }
    // a generous hit area — a 4px dot you must land on dead-centre is not a hit target
    if (!best || bd > 26 * 26) { hide(); return; }
    if (!tip) { tip = document.createElement("div"); tip.className = "rtip"; wrap.appendChild(tip); }
    tip.innerHTML = `<b>${best.kind === "frontier" ? "Frontier" : "Lineup #" + (best.i + 1)}</b><br>` +
      `<span>own</span> ${fmt(best.own)}% &nbsp; <span>proj</span> ${fmt(best.proj)}<br>` +
      `<span>salary</span> $${best.sal.toLocaleString()}`;
    const px = (best.x / W) * r.width, py = (best.y / H) * r.height;
    tip.style.left = Math.min(r.width - 150, Math.max(0, px + 12)) + "px";
    tip.style.top = Math.max(0, py - 52) + "px";
  };
  svg.addEventListener("mousemove", move);
  svg.addEventListener("mouseleave", hide);
}

function renderExposure() {
'''
assert page.count(JS_OLD) == 1, "renderExposure is not unique"
page = page.replace(JS_OLD, JS_NEW, 1)

# redraw the card whenever the exposure sheet redraws, so a resize or a theme flip is fine
EXP_OLD = '''  const sals = S.lineups.map(l => l.sal).sort((a, b) => a - b);
'''
EXP_NEW = '''  drawRarity();

  const sals = S.lineups.map(l => l.sal).sort((a, b) => a - b);
'''
assert page.count(EXP_OLD) == 1, "the salary histogram anchor is not unique"
page = page.replace(EXP_OLD, EXP_NEW, 1)

# a new pool of lineups invalidates the overlay, exactly as it invalidates the sim
SOLVE_OLD = "    SIM = null;\n    save();\n"
SOLVE_NEW = "    SIM = null; FRONT = null;\n    save();\n"
assert page.count(SOLVE_OLD) == 1, "the SIM reset anchor is not unique"
page = page.replace(SOLVE_OLD, SOLVE_NEW, 1)

# ---- and the block Ask Toto reads, so the bot cannot overstate the chart either ----
TOTO_OLD = '''      } else L.push("Nothing is logged in the bankroll tracker.");
'''
TOTO_NEW = '''      } else L.push("Nothing is logged in the bankroll tracker.");
      if (FRONT && FRONT.points.length > 1) {
        const a = FRONT.points[0], z = FRONT.points[FRONT.points.length - 1];
        L.push(`PROJECTION-VS-RARITY: traced with ${FRONT.solves} exact solves. ${FRONT.points.length} vertices, from ${a.own.toFixed(1)}% cumulative ownership at ${a.proj.toFixed(1)} projected points to ${z.own.toFixed(1)}% at ${z.proj.toFixed(1)}. Steepest exchange rate ${FRONT.segments[0].rate.toFixed(3)} points per ownership point, shallowest ${FRONT.segments[FRONT.segments.length - 1].rate.toFixed(3)}.`);
        L.push(`⚠️ THAT IS THE CONVEX HULL OF THE FRONTIER, NOT THE FRONTIER. Each vertex is exactly optimal for ONE weighting of projection against ownership; a lineup that beats the straight line between two vertices is optimal for no weighting at all and this method cannot find it. Say "hull" or "at least this good", never "the best lineup at that ownership".${FRONT.capped ? " The sweep also stopped on its solve budget rather than on convergence, so vertices are missing — the rare end especially." : ""}`);
      } else L.push("No projection-vs-rarity frontier has been traced in this session.");
'''
assert page.count(TOTO_OLD) == 1, "the bankroll-empty line is not unique"
page = page.replace(TOTO_OLD, TOTO_NEW, 1)

VOCAB_OLD = "Cash% = share of simulations finishing in the money.`);"
VOCAB_NEW = "Cash% = share of simulations finishing in the money. Cumulative own = the sum of the projected ownership of the nine players in a lineup, which is what \"rarity\" means on this page. Exchange rate = projected points gained per point of cumulative ownership added, along the frontier.`);"
assert page.count(VOCAB_OLD) == 1, "the vocabulary line is not unique"
page = page.replace(VOCAB_OLD, VOCAB_NEW, 1)

PAGE.write_text(page)

# --------------------------------------------------------------------- 4. the wiring

page = PAGE.read_text()
WIRE_OLD = '$("expPos").addEventListener'
assert page.count(WIRE_OLD) >= 1, "no expPos listener to anchor the wiring to"
i = page.index(WIRE_OLD)
line_end = page.index("\n", i) + 1
WIRE_NEW = '''$("rarityGo").addEventListener("click", runFrontier);
$("rarityTabGo").addEventListener("click", () => {
  const t = $("rarityTab"), b = $("rarityTabGo");
  const open = t.hidden;
  t.hidden = !open;
  b.setAttribute("aria-expanded", String(open));
  b.textContent = open ? "Hide the numbers" : "Show the numbers";
});
'''
page = page[:line_end] + WIRE_NEW + page[line_end:]
PAGE.write_text(page)

# --------------------------------------------------------------------- 5. sw VERSION

html = sorted(p.name for p in ROOT.glob("*.html"))
import hashlib
h = hashlib.md5()
for name in html:
    h.update((ROOT / name).read_bytes())
ver = h.hexdigest()[:10]
sw = SW.read_text()
m = re.search(r'const VERSION = "([0-9a-f]{10})"', sw)
assert m, "sw.js VERSION not found in the expected shape"
old_ver = m.group(1)
SW.write_text(sw.replace(m.group(0), 'const VERSION = "%s"' % ver, 1))

print("page: rarity card, styles, logic, wiring all inserted")
print("sw.js: VERSION %s -> %s  (%d html files)" % (old_ver, ver, len(html)))
