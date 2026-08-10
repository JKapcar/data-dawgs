"""
Stamp nfl.html out of dawghouse.html. CEP-5A Stage 6.

Third page built this way (build_arena.py, build_data_library.py). No build system, so a
NEW page is an existing page's head + shell + footer with <main> and the page script
swapped, sliced by CONTENT MARKERS and never by line number.

nfl.html is the NFL ANALYSIS hub: what we know about the league, as opposed to Arena
(surfaces where a person competes against other people) and the Library (raw material).

BOTH CARD SETS ARE COMPUTED.
* Live cards  = /data/surfaces.json rows with domain "nfl" — epa, nfelo, calculators.
* Under construction = /data/pound-tools.json rows with domain "NFL" whose status is not
  "complete". Those rows already carry `exact_blocker` and `minimum_path_to_completion`,
  so the cards write themselves and cannot drift from the shelf: dawghouse.html renders
  the same eight rows from the same file, which is why the two can never disagree.

⚠️ THE UNDER-CONSTRUCTION RULES ARE SLICED OUT OF arena.html BY THIS SCRIPT, not retyped.
Stage 4 built the component once. test-nfl-hub.mjs asserts all three copies are identical.

Run:  cd work && python3 build_nfl_hub.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "dawghouse.html"
ARENA = REPO / "arena.html"
OUT = REPO / "nfl.html"

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


# ---- the shared component, lifted verbatim from where it was built ----
UC_START = "/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT."
UC_END = "\n/* Tier chips rendered FROM surfaces.json"
UC_CSS = arena[once(arena, UC_START, "uc start", "arena.html"):once(arena, UC_END, "uc end", "arena.html")]
assert UC_CSS.count(".uc-chip{") == 1 and UC_CSS.count(".uc-art{") == 1 and UC_CSS.count(".uc{") == 1

# the collar + tier chip rules travel too: this hub renders tiers from the map as well
TIER_START = "/* Tier chips rendered FROM surfaces.json"
TIER_END = "\n.tool{"
TIER_CSS = arena[once(arena, TIER_START, "tier start", "arena.html"):once(arena, TIER_END, "tier end", "arena.html")]
assert ".collar{" in TIER_CSS and ".status-labs{" in TIER_CSS

# ---------------------------------------------------------------- head ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]
FWD_START = "<script>/* CEP-5A 1b:"
FWD_END = 'go();addEventListener("hashchange",go);})();</script>\n'
i_fwd = once(head, FWD_START, "1b forward block")
j_fwd = once(head, FWD_END, "1b forward close") + len(FWD_END)
head = head[:i_fwd] + head[j_fwd:]
assert "location.replace" not in head
head = re.sub(r"<title>.*?</title>", "<title>NFL · Data Dawgs</title>", head, count=1, flags=re.S)

head = sub1(head, ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
            ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}\n"
            + UC_CSS + TIER_CSS.rstrip("\n"), ".inventory grid rule")

# ---------------------------------------------------------------- shell ----
i_main = once(src, "\n<main>\n", "main open")
shell = src[i_head:i_main]
shell = sub1(shell, 'data-page="pound"', 'data-page="nfl"', "page key")
assert '<div id="nav"></div>' in shell and "const UD = {" in shell
# keyed by this page's own stem — added HERE and nowhere else
shell = sub1(shell,
             '      "dawghouse":"/data/pound-tools.json"\n',
             '      "dawghouse":"/data/pound-tools.json",\n'
             '      "nfl":"/data/epa-teams.json"\n',
             "UD map tail")

# ---------------------------------------------------------------- footer ----
i_foot = once(src, '\n<footer class="foot">', "footer open")
tail = src[i_foot:]
i_scr = once(tail, "\n<script>\n", "page script open")
j_scr = once(tail, "</script>\n</div>\n</body>", "page script close")
foot_open = tail[:i_scr]
foot_close = tail[j_scr + len("</script>"):]

MAIN = """
<main>
  <header class="p-hero">
    <div class="p-kicker">NFL · what we know about the league, and what we do not</div>
    <h1>The NFL work. <a class="tierchip" href="index.html#tiers" title="Why this page is in Labs">Labs</a></h1>
    <p class="p-lead">Play-level aggregates, power ratings and the deterministic calculators — the
    analysis side of the site, as opposed to the games you play against other people. Every card
    below is an NFL surface in <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a>,
    with its own tier and machine access read from the file. The belief scoreboard is not here on
    purpose: what models <em>believe</em> and how our pre-registered calls <em>grade</em> are kept
    apart, and both live on <a href="receipts.html#models">Receipts</a>.</p>
  </header>
  <div class="p-disclosure"><b>No oracle lives here.</b> These are dated 2026 inputs. EPA is
  descriptive, not predictive; nfelo is a faithful mirror of a named upstream model, not evidence
  that model forecasts well; the calculators are arithmetic. Nothing on this page has established
  betting profitability.</div>
  <nav class="p-jump" aria-label="NFL sections">
    <a href="#live">What is live</a><a href="#building">Under construction</a><a href="#machines">For machines</a><a href="receipts.html#models">Belief scoreboard &rarr;</a>
  </nav>

  <section class="p-section" id="live">
    <header><div><h2>What is live</h2><p class="dek">One card per NFL surface in the map, rendered
      from the file — the count is the file's. A
      <span class="collar"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><ellipse cx="12" cy="9.5" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="2.4"></ellipse><circle cx="12" cy="17.6" r="3.1" fill="currentColor"></circle></svg></span>
      collar means the surface earned one; the criteria are in
      <a href="/data/receipts-method.md">receipts-method.md</a>, and each collar certifies only
      what its audit entry says it certifies.</p></div>
      <div class="p-meta" id="nflCount" aria-live="polite">reading /data/surfaces.json&hellip;</div></header>
    <div class="inventory" id="nflCards"><div class="p-loading">Loading the NFL surfaces&hellip;</div></div>
  </section>

  <section class="p-section" id="building">
    <header><div><h2>Under construction</h2><p class="dek">The NFL work that is blocked, rendered
      from <a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a> — the same rows
      the <a href="dawghouse.html#inventory">DawgHouse shelf</a> renders, from the same file, so the
      two cannot disagree. Each card keeps its <b>exact blocker</b> and its <b>minimum path back</b>,
      because "not built yet" without a reason is how work quietly disappears. None of them has a
      control: a card that says it is not built is honest, a live-looking one that silently fails
      is not.</p></div>
      <div class="p-meta" id="nflUcCount" aria-live="polite"></div></header>
    <div class="inventory" id="nflUcCards"></div>
  </section>

  <section class="p-section" id="machines">
    <header><div><h2>The NFL work for machines</h2><p class="dek">Read the files, not the cards.</p></div></header>
    <div class="machine-box"><ul>
      <li><a href="/data/epa-teams.json"><code>/data/epa-teams.json</code></a> and
        <a href="/data/epa-players.json"><code>/data/epa-players.json</code></a> — team, QB and
        per-player aggregates. Descriptive. No play names a receiver, a blocker or a defender, so
        no tool built on this snapshot can produce receiving or defensive player EPA.</li>
      <li><a href="/data/nfelo.json"><code>/data/nfelo.json</code></a> and
        <a href="/data/models.json"><code>/data/models.json</code></a> — the mirrored ratings and the
        margin-model parameters.</li>
      <li><a href="/data/model-contracts.json"><code>/data/model-contracts.json</code></a> — the
        calculator I/O contracts the forms on <a href="calculators.html">calculators.html</a> implement.</li>
      <li><a href="/data/pound-tools.json"><code>/data/pound-tools.json</code></a> — every blocked
        item with its exact blocker and minimum path, including the ones on this page.</li>
      <li><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> — the map. The NFL rows
        carry <code>domain: "nfl"</code>; this page renders exactly those.</li>
    </ul><p class="assumption">This hub is a directory over surfaces that already exist. It publishes
    no data of its own, so it has <b>no row</b> in the map.</p></div>
  </section>
</main>
"""

SCRIPT = r"""
<script>
/* nfl.html — the NFL analysis hub.
 *
 * Both card sets are COMPUTED. Live cards are the surfaces map's domain "nfl" rows;
 * under-construction cards are pound-tools.json's blocked NFL rows, which already carry
 * their own blocker and minimum path. Neither list is typed into this page, because a
 * hand-written hub list drifts within a month and then advertises something that is not
 * there — the failure test-pound-contracts.js already defends against on the CFB cards.
 *
 * ⚠️ FAILS LOUD. If either file cannot be read the page says so where the cards would be.
 * An empty grid reads as "there is nothing here", which is a different and false claim.
 */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}

  const DOMAIN="nfl", SHELF_DOMAIN="NFL";
  const TIER_LABEL={labs:"Labs",dawg:"Working Dawg",pound:"The DawgHouse"};
  const KIND={json:"JSON",markdown:"Markdown",mcp:"MCP",rest:"REST"};
  /* The collar, identical to arena.html: tier "dawg" is a glyph with an accessible name.
     Criteria in /data/receipts-method.md; without them the mark would be unbacked. */
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

  /* ⚠️ The blocker and the minimum path are the WHOLE POINT of an under-construction card
     here. "Coming soon" is not information; "static Pages cannot run the Python package,
     and the way out is a scheduled precompute job" is. Both come from the file. */
  function ucCard(t){
    return `<article class="tool uc" data-status="under-construction" data-tool="${esc(t.id)}" data-blocked="${esc(t.status)}">`
      + `<span class="uc-art" aria-hidden="true"></span>`
      + `<span class="uc-chip">Under construction</span>`
      + `<span class="status status-${esc(t.status)}">${esc(t.status)}</span>`
      + `<h3>${esc(t.name)}</h3>`
      + `<p>${esc(t.intended_user_value)}</p>`
      + `<p class="block"><b>Blocker:</b> ${esc(t.exact_blocker)}<br><b>Minimum path:</b> ${esc(t.minimum_path_to_completion)}</p>`
      + `<p class="meta-line"><b>Machine surface it would need:</b> <code>${esc(t.machine_readable_requirement)}</code></p>`
      + `</article>`;
  }

  async function load(){
    let rows;
    try{
      const env=await json("/data/surfaces.json");
      if(!env||!Array.isArray(env.data)) throw new Error("surfaces payload is malformed");
      rows=env.data.filter(r=>r.domain===DOMAIN);
      if(!rows.length) throw new Error("the surfaces map has no rows with domain \"nfl\"");
      $("nflCards").innerHTML=rows.map(liveCard).join("");
      $("nflCount").textContent=`${rows.length} NFL ${rows.length===1?"surface":"surfaces"} · from /data/surfaces.json`;
    }catch(err){
      $("nflCards").innerHTML='<div class="p-error">The surfaces map could not be read, so this directory is empty rather than wrong: '+esc(err.message)+'</div>';
      $("nflCount").textContent="directory unavailable";
    }
    try{
      const env=await json("/data/pound-tools.json");
      if(!env||!Array.isArray(env.data)) throw new Error("inventory payload is malformed");
      const blocked=env.data.filter(t=>(t.kind||"tool")==="tool" && t.domain===SHELF_DOMAIN && t.status!=="complete");
      $("nflUcCards").innerHTML = blocked.length ? blocked.map(ucCard).join("")
        : '<div class="p-loading">Nothing in the NFL inventory is blocked right now.</div>';
      $("nflUcCount").textContent = blocked.length
        ? `${blocked.length} blocked · each with its exact blocker` : "nothing blocked";
    }catch(err){
      $("nflUcCards").innerHTML='<div class="p-error">The inventory could not be read, so no blocked work is listed rather than a guessed list: '+esc(err.message)+'</div>';
      $("nflUcCount").textContent="inventory unavailable";
    }
  }
  load();
})();

</script>"""

out = head + shell + MAIN + foot_open + SCRIPT + foot_close

# ---------------------------------------------------------------- guards ----
assert out.count("<main>") == 1 and out.count("</main>") == 1
assert out.count('id="nflCards"') == 1 and out.count('id="nflUcCards"') == 1
assert "toolInventory" not in out, "dawghouse's shelf script came along"
assert out.count('"nfl":"/data/epa-teams.json"') == 1
assert UC_CSS in out and TIER_CSS.rstrip("\n") in out, "the shared component did not travel verbatim"
assert "<canvas" not in out[out.index("<main>"):]
assert "\r" not in out
assert out.endswith("</html>\n") or out.endswith("</html>")

OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name} (+ component from arena.html)")
