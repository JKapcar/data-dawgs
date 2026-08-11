"""
Stamp markets.html and ai.html out of dawghouse.html. Two new top-level sections.

Fourth and fifth pages built this way (build_arena.py, build_data_library.py,
build_nfl_hub.py). No build system, so a NEW page is an existing page's head + shell +
footer with <main> and the page script swapped, sliced by CONTENT MARKERS and never by
line number.

⚠️ THESE TWO PAGES ARE DELIBERATELY EMPTY, AND THAT IS THE WHOLE POINT OF STAGE 1.
They exist so the nav has somewhere to point. Neither publishes data, computes anything,
or has a machine surface, and both say so above the fold in a `.notbuilt` banner. The
live-card grid renders `/data/surfaces.json` rows for its own domain — currently zero
rows for both — so the count on the page is the file's count and cannot be inflated by
hand. When the first surface ships it appears here with no page edit.

⚠️ ZERO ROWS AND A FAILED READ ARE DIFFERENT STATES AND MUST LOOK DIFFERENT.
build_nfl_hub.py throws when its domain has no rows, which is right for a hub over work
that already exists and wrong here: for a brand-new section "nothing is built yet" is the
truth, not an error. An empty grid that looks like a failed fetch teaches the reader to
distrust the grid; a failed fetch that looks like emptiness is a false claim. The script
below branches on the two explicitly and the suite asserts both strings.

⚠️ NO UD MAP ENTRY, ON PURPOSE. The shared shell's UD map falls through to /llms.txt for
any page not listed, and its own comment says that is the correct answer for a page with
no machine surface. Adding a key here would point the mirror at a file these pages do not
own.

Run:  cd work && python3 build_section_hub.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "dawghouse.html"
ARENA = REPO / "arena.html"

src = TEMPLATE.read_text(encoding="utf-8")
arena = ARENA.read_text(encoding="utf-8")


def once(hay, needle, what, where=""):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {where or TEMPLATE.name}, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    n = hay.count(old)
    assert n == 1, f"anchor {what!r} appears {n} times, expected 1"
    return hay.replace(old, new, 1)


# ---- the shared components, lifted verbatim from where they were built ----
UC_START = "/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT."
UC_END = "\n/* Tier chips rendered FROM surfaces.json"
UC_CSS = arena[once(arena, UC_START, "uc start", "arena.html"):once(arena, UC_END, "uc end", "arena.html")]
assert UC_CSS.count(".uc-chip{") == 1 and UC_CSS.count(".uc{") == 1

TIER_START = "/* Tier chips rendered FROM surfaces.json"
TIER_END = "\n.tool{"
TIER_CSS = arena[once(arena, TIER_START, "tier start", "arena.html"):once(arena, TIER_END, "tier end", "arena.html")]
assert ".collar{" in TIER_CSS and ".status-labs{" in TIER_CSS

# ---------------------------------------------------------------- head ----
i_head = once(src, "</head>", "head close") + len("</head>")
head_src = src[:i_head]
FWD_START = "<script>/* CEP-5A 1b:"
FWD_END = 'go();addEventListener("hashchange",go);})();</script>\n'
i_fwd = once(head_src, FWD_START, "1b forward block")
j_fwd = once(head_src, FWD_END, "1b forward close") + len(FWD_END)
head_src = head_src[:i_fwd] + head_src[j_fwd:]
assert "location.replace" not in head_src

head_src = sub1(
    head_src,
    ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
    ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\n"
    + UC_CSS + TIER_CSS.rstrip("\n"),
    ".inventory grid rule",
)

# ---------------------------------------------------------------- shell ----
i_main = once(src, "\n<main>\n", "main open")
shell_src = src[i_head:i_main]
assert '<div id="nav"></div>' in shell_src and "const UD = {" in shell_src

# ---------------------------------------------------------------- footer ----
i_foot = once(src, '\n<footer class="foot">', "footer open")
tail = src[i_foot:]
i_scr = once(tail, "\n<script>\n", "page script open")
j_scr = once(tail, "</script>\n</div>\n</body>", "page script close")
foot_open = tail[:i_scr]
foot_close = tail[j_scr + len("</script>"):]


# ---------------------------------------------------------------- pages ----
def main_html(p):
    return f"""
<main>
  <header class="p-hero">
    <div class="p-kicker">{p['kicker']}</div>
    <h1>{p['h1']} <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Why this page is a Pup">Pup</a></h1>
    <div class="notbuilt"><b>Nothing here is built yet.</b> This section was created on
    <b>{p['created']}</b> to hold work that has not started. It publishes no data file, computes
    nothing, exposes no MCP tool, and has no row in the surfaces map. Everything under
    &ldquo;What this section is for&rdquo; below is <b>stated intent, not shipped work</b> &mdash; read it
    as a plan someone can hold us to, not as a description of the site.</div>
    <p class="p-lead">{p['lead']}</p>
  </header>
  <div class="p-disclosure"><b>No oracle lives here.</b> {p['disclosure']}</div>
  <nav class="p-jump" aria-label="{p['jump_label']}">
    <a href="#live">What is live</a><a href="#plan">What this section is for</a><a href="#machines">For machines</a><a href="receipts.html#models">Belief scoreboard &rarr;</a>
  </nav>

  <section class="p-section" id="live">
    <header><div><h2>What is live</h2><p class="dek">One card per surface in
      <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> carrying
      <code>domain: &quot;{p['domain']}&quot;</code>. The count is the file&rsquo;s count, not a number typed
      into this page, so the day the first surface ships it appears here and nobody has to
      remember to add it. Today the file has none, and the grid says so in those words rather
      than sitting empty.</p></div>
      <div class="p-meta" id="secCount" aria-live="polite">reading /data/surfaces.json&hellip;</div></header>
    <div class="inventory" id="secCards"><div class="p-loading">Reading the surfaces map&hellip;</div></div>
  </section>

  <section class="p-section" id="plan">
    <header><div><h2>What this section is for</h2><p class="dek">Written down before any of it
      exists, so the first thing that ships can be checked against what was promised. None of
      this is built. None of it is callable. Nothing below is a claim about the world.</p></div></header>
    <div class="machine-box">{p['plan']}</div>
  </section>

  <section class="p-section" id="machines">
    <header><div><h2>{p['machines_h']}</h2><p class="dek">Read the files, not the cards.</p></div></header>
    <div class="machine-box"><ul>{p['machines']}</ul>
    <p class="assumption">This hub is a directory over surfaces that do not exist yet. It publishes
    no data of its own, so it has <b>no row</b> in the map &mdash; the same rule the Arena, Library and
    NFL hubs follow. Its machine mirror falls through to <a href="/llms.txt"><code>/llms.txt</code></a>,
    which is the correct answer for a page with no surface of its own.</p></div>
  </section>
</main>
"""


SCRIPT = r"""
<script>
/* %(stem)s.html — a section hub with nothing in it yet.
 *
 * The live grid is COMPUTED from the surfaces map's domain "%(domain)s" rows. It is not a
 * hand-written list, because a hand-written hub list drifts within a month and then
 * advertises something that is not there.
 *
 * ⚠️ THREE STATES, AND THEY MUST NOT LOOK ALIKE:
 *   read failed  → say the file could not be read. Loud. Never silent.
 *   zero rows    → say nothing is built yet. This is TRUE TODAY and is not an error.
 *   rows         → render them.
 * Collapsing the middle two is how an empty page starts reading as a broken one, and how a
 * broken one starts reading as an honest empty. test-section-hubs.mjs asserts all three.
 */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}

  const DOMAIN="%(domain)s";
  const TIER_LABEL={labs:"Pup",dawg:"Working Dawg",pound:"The DawgHouse"};
  const KIND={json:"JSON",markdown:"Markdown",mcp:"MCP",rest:"REST"};
  const COLLAR='<span class="collar" role="img" aria-label="Working Dawg — earned its collar" title="Working Dawg — earned its collar. Criteria: /data/receipts-method.md"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><ellipse cx="12" cy="9.5" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="2.4"></ellipse><circle cx="12" cy="17.6" r="3.1" fill="currentColor"></circle></svg></span>';
  const tierMark=t=> t==="dawg" ? COLLAR
    : `<span class="status status-${esc(t)}">${esc(TIER_LABEL[t]||t)}</span>`;
  const machineItem=m=>{
    const what = m.kind==="mcp" ? `<code>${esc(m.tool)}</code>`
      : `<a href="${esc(m.url)}"><code>${esc(m.url)}</code></a>`;
    return `<li>${esc(KIND[m.kind]||m.kind)}: ${what}${m.covers?` — ${esc(m.covers)}`:""}</li>`;
  };

  function liveCard(row){
    const live=(row.machine||[]).filter(m=>m.status==="live");
    return `<article class="tool" data-surface="${esc(row.id)}" data-tier="${esc(row.tier)}">`
      + tierMark(row.tier)
      + `<h3><a href="${esc(row.page)}">${esc(row.name)}</a></h3>`
      + (live.length
          ? `<p><b>Live for machines:</b></p><ul class="components">${live.map(machineItem).join("")}</ul>`
          : `<p class="block">No live machine surface. The page is the only way in.</p>`)
      + (row.gap?`<p class="block"><b>Known gap:</b> ${esc(row.gap)}</p>`:"")
      + `</article>`;
  }

  async function load(){
    let env;
    try{
      env=await json("/data/surfaces.json");
      if(!env||!Array.isArray(env.data)) throw new Error("surfaces payload is malformed");
    }catch(err){
      $("secCards").innerHTML='<div class="p-error">The surfaces map could not be read, so this'
        +' directory is empty rather than wrong: '+esc(err.message)+'</div>';
      $("secCount").textContent="directory unavailable";
      return;
    }
    const rows=env.data.filter(r=>r.domain===DOMAIN);
    if(!rows.length){
      $("secCards").innerHTML='<div class="p-loading"><b>Nothing is built yet.</b> The surfaces map'
        +' was read and it carries no <code>domain: "'+esc(DOMAIN)+'"</code> row. This is the'
        +' file&rsquo;s answer, not a failed request &mdash; the section is new and empty is the'
        +' honest state for it.</div>';
      $("secCount").textContent="0 surfaces · read from /data/surfaces.json ("+esc(env.as_of||"undated")+")";
      return;
    }
    $("secCards").innerHTML=rows.map(liveCard).join("");
    $("secCount").textContent=`${rows.length} ${rows.length===1?"surface":"surfaces"} · from /data/surfaces.json`;
  }
  load();
})();

</script>"""

CREATED = "2026-08-11"

PAGES = [
    dict(
        stem="markets",
        domain="markets",
        title="Prediction Markets · Data Dawgs",
        page_key="markets",
        kicker="Prediction markets · what a price claims, and whether it was right",
        h1="The prediction-markets work.",
        jump_label="Prediction markets sections",
        created=CREATED,
        lead="""A price is a forecast wearing a dollar sign. A market that says 62&cent; is making
    exactly the kind of dated, checkable claim this site already grades models on &mdash; so the
    plan is to treat venues as forecasters, log what they said before the event, and score them
    on the same board as the models. That board already exists for NFL models on
    <a href="receipts.html#models">Receipts</a>; nothing on the market side of it has been built.""",
        disclosure="""Nothing in this section has established betting profitability, and nothing in it
  is advice. When market prices do land here they will be <b>captured observations with a stated
  capture time</b> &mdash; not closing lines. The site&rsquo;s existing book-price surface already
  carries that limit and refuses to compute CLV from it; the same rule applies to anything added
  here.""",
        plan="""<p>In the order it is meant to ship, and each one is a claim we can be held to:</p>
      <ol>
        <li><b>Market-versus-model receipts.</b> Capture venue prices before an event, store them as
        prospective forecasts under the existing
        <a href="/data/model-contracts.json"><code>model-contracts.json</code></a> shape, and grade
        them alongside nfelo, 538 Classic and DDPR once results land. This is a generalisation of the
        hourly college-football market capture the site already runs, not a new machine.</li>
        <li><b>Cross-venue divergence.</b> The same event priced in more than one place, and the gap
        over time. Descriptive; it is not an arbitrage tool and will not be described as one.</li>
        <li><b>Calibration.</b> A reliability curve for market prices, which stays empty until enough
        events have resolved. Empty is the correct state for a calibration chart with no resolutions,
        and it will say so rather than drawing a flattering line through nothing.</li>
        <li><b>The market calculators.</b> Devig, fair price, expected value, hedging, parlay pricing
        &mdash; arithmetic over numbers you supply. These already exist as read-only tools; this is a
        surface over them, not new maths.</li>
      </ol>
      <p class="assumption">Two things are unresolved and will be answered in public before anything
      is built on them: whether either venue&rsquo;s public read API is reachable from a browser on
      this origin, and what the capture cadence should be. Until a capture exists there is no
      receipt, and until there is a receipt there is no claim.</p>""",
        machines_h="The prediction-markets work for machines",
        machines="""
      <li><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> &mdash; the map. Market
        rows will carry <code>domain: "markets"</code>; this page renders exactly those, and there
        are none.</li>
      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json</code></a> &mdash; the
        forecast and receipt contract any market capture has to satisfy. It exists; nothing market-side
        implements it yet.</li>
      <li><a href="/data/cfb-market.json"><code>/data/cfb-market.json</code></a> &mdash; the one market
        surface on the site today. It is college football, its books are named, and its observation
        time is unknown, which is why it is not treated as a closing line. It is listed here as the
        precedent this section generalises, not as its content.</li>""",
    ),
    dict(
        stem="ai",
        domain="ai",
        title="A.I. · Data Dawgs",
        page_key="ai",
        kicker="A.I. · bring your own dawg, and then grade it",
        h1="The A.I. work.",
        jump_label="A.I. sections",
        created=CREATED,
        lead="""Every leaguemate now turns up with an assistant. This site is built so those
    assistants can read it &mdash; dated payloads, stated sources, read-only tools &mdash; and that
    half is real and already running. The half that is <em>not</em> built is the interesting one: a
    model that emits a probability is a forecaster, and forecasters here get receipts. The plan is to
    log what several models say before an event and grade them on the same board as nfelo, 538
    Classic and the market.""",
        disclosure="""Nothing here grades any model yet. No benchmark on this page is ours, no
  scoreboard has resolved a single question, and a language model producing a confident number is not
  evidence that the number is any good &mdash; which is the entire reason to make it write the number
  down first.""",
        plan="""<p>Four things, and they are deliberately separate because they are different kinds of
      claim:</p>
      <ol>
        <li><b>Bring Your Own Dawg.</b> The machine-facing front door: what an assistant can read, what
        it can call, and how to connect one. This is the only item here whose underlying plumbing
        already exists &mdash; <a href="/llms.txt"><code>/llms.txt</code></a>, the surfaces map and the
        read-only tool catalogue are live today. What is missing is the page that explains them in one
        place.</li>
        <li><b>A model scoreboard.</b> Several models answer the same forecast questions before the
        event, their answers are stored as append-only receipts, and they are scored after resolution.
        The same treatment the site&rsquo;s own models get, with no special pleading for being new.</li>
        <li><b>Head to head.</b> Models run the site&rsquo;s actual tasks &mdash; a draft pick, a
        survivor path, a weekly leg &mdash; against each other, where a wrong answer is visible rather
        than merely low-scoring.</li>
        <li><b>Field notes.</b> Public benchmark, price and context-window figures, mirrored with their
        capture date. <b>These are other people&rsquo;s numbers</b> and will be labelled as such
        everywhere they appear. Mirroring a benchmark is not running one, and this section will never
        present a mirrored figure as something we measured.</li>
      </ol>
      <p class="assumption">The scoreboard is worth exactly as much as its question set. A set chosen
      after seeing the answers is worthless, so the questions get frozen and published before the
      models are asked &mdash; the same pre-registration rule the NFL receipts already follow.</p>""",
        machines_h="The A.I. work for machines",
        machines="""
      <li><a href="/llms.txt"><code>/llms.txt</code></a> &mdash; the curated index for assistants.
        Live, and the right starting point today.</li>
      <li><a href="/data/index.json"><code>/data/index.json</code></a> &mdash; every machine file with
        its date, size and SHA-256. Cite the <code>as_of</code> with the number.</li>
      <li><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> &mdash; the map, including
        the read-only tool catalogue. A.I. rows will carry <code>domain: "ai"</code>; there are
        none.</li>
      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json</code></a> &mdash; the
        receipt shape a model scoreboard would have to satisfy. Written; unused by any model line on
        this page, because there are none.</li>
      <li><a href="connect.html">connect.html</a> &mdash; how an assistant gets a connector URL. This
        part works now.</li>""",
    ),
]

for p in PAGES:
    head = re.sub(r"<title>.*?</title>", f"<title>{p['title']}</title>", head_src, count=1, flags=re.S)
    shell = sub1(shell_src, 'data-page="pound"', f'data-page="{p["page_key"]}"', "page key")
    out = head + shell + main_html(p) + foot_open + (SCRIPT % p) + foot_close

    # ------------------------------------------------------------ guards ----
    assert out.count("<main>") == 1 and out.count("</main>") == 1
    assert out.count('id="secCards"') == 1 and out.count('id="secCount"') == 1
    assert "toolInventory" not in out, "dawghouse's shelf script came along"
    assert out.count('data-page="pound"') == 0
    assert UC_CSS in out and TIER_CSS.rstrip("\n") in out, "the shared component did not travel verbatim"
    assert "<canvas" not in out[out.index("<main>"):]
    # the three states must all be present as literal copy, not implied
    assert "Nothing is built yet." in out and "could not be read" in out
    assert "Nothing here is built yet." in out, "the above-the-fold banner is missing"
    # no UD key: the mirror falls through to llms.txt on purpose
    assert f'"{p["stem"]}":"/data/' not in out
    assert "\r" not in out
    assert out.endswith("</html>\n") or out.endswith("</html>")

    dest = REPO / f"{p['stem']}.html"
    dest.write_text(out, encoding="utf-8")
    print(f"wrote {dest.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name} (+ component from arena.html)")
