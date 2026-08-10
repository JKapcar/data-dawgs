"""
Stamp arena.html out of dawghouse.html — CEP-5A Stage 4.

There is no build system here, so a NEW page is an existing page's head + shell +
footer with the <main> and the page script swapped (build_connect.py -> build_signon.py
precedent). dawghouse.html is the template because it already carries the card CSS
(.tool/.status/.inventory/.machine-box/.p-*) this hub needs and its own <main> is now
small, so the slice is clean.

⚠️ Slice by CONTENT MARKERS, never line numbers.

What Arena is: the surfaces where a PERSON COMPETES AGAINST OTHER PEOPLE. Everything
else on the site is analysis (the NFL and CFB hubs) or raw material (the Data hub).
The card set is NOT typed in here — it is every /data/surfaces.json row with
`domain: "arena"`, read at runtime. A hand-written hub list drifts within a month and
then starts claiming things the validator has never heard of.

This file also builds the reusable UNDER-CONSTRUCTION component once (Kap's ruling,
2026-08-09): .uc-chip + .uc-art + data-status="under-construction". Stages 5 and 6
reuse it from here; do not rebuild it there.

Run:  cd work && python3 build_arena.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "dawghouse.html"
OUT = REPO / "arena.html"

src = TEMPLATE.read_text(encoding="utf-8")


def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {TEMPLATE.name}, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    """String-replace exactly once, with a FUNCTION replacer.

    ⚠️ A plain string replacement expands $$, $&, $` and $' — the same trap that ate
    five bytes of guillotine.html on 8/8. Python's str.replace is literal, but this
    helper keeps the assert-once discipline the repo runs on."""
    n = hay.count(old)
    assert n == 1, f"anchor {what!r} appears {n} times, expected 1"
    return hay.replace(old, new, 1)


# ---------------------------------------------------------------- head ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]

# The 1b hash forwards belong to the DawgHouse's own moved sections. Arena has none.
FWD_START = "<script>/* CEP-5A 1b:"
FWD_END = 'go();addEventListener("hashchange",go);})();</script>\n'
i_fwd = once(head, FWD_START, "1b forward block")
j_fwd = once(head, FWD_END, "1b forward close") + len(FWD_END)
head = head[:i_fwd] + head[j_fwd:]
assert "location.replace" not in head, "arena.html must not inherit a hash forward"

head = re.sub(r"<title>.*?</title>", "<title>Arena · Data Dawgs</title>", head, count=1, flags=re.S)
assert head.count("<title>Arena · Data Dawgs</title>") == 1

# ---- the reusable under-construction component + the data-driven tier chips ----
# Anchored on the .inventory grid rule so the new rules sit with the card CSS they
# extend, and inside the same <style> the 760px breakpoint already governs.
UC_CSS = """.inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT. Built once, here.
   nfl.html (Stage 6) and data.html (Stage 5) reuse these three rules; do not fork them.
   ⚠️ The artwork is a hazard bar at the TOP EDGE of the card, not a wash behind the
   copy. A diagonal wash under text costs contrast in both themes and the ramp-B field
   has none to spare, so the stripes never sit under a glyph. Pure CSS: no image
   request, no canvas, nothing to animate. */
.uc{border-color:color-mix(in srgb,var(--warn) 38%,var(--border))}
.uc-art{display:block;height:9px;margin:-14px -14px 11px;border-radius:10px 10px 0 0;background:repeating-linear-gradient(135deg,var(--warn) 0 8px,transparent 8px 16px);opacity:.5}
.uc-chip{display:inline-flex;border-radius:999px;padding:3px 7px;font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;border:1px solid color-mix(in srgb,var(--warn) 50%,var(--border));color:var(--warn)}
/* Tier chips rendered FROM surfaces.json rather than typed into the page, and the
   collar. ⚠️ tools/build-data.js tierOf() reads a page's HERO chip TEXT to decide that
   page's tier — so the three hero "Dawg" chips (dashboard, nfelo, stats) cannot become
   a glyph until tierOf() changes in the same commit. This collar is card-level only.
   Criteria: /data/receipts-method.md, "Tiers and the collar". */
.status-labs{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 50%,var(--border))}
.status-pound{color:var(--ink-3)}
.collar{display:inline-flex;align-items:center;color:var(--good);vertical-align:middle}
.collar svg{display:block}"""
head = sub1(head,
            ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
            UC_CSS, ".inventory grid rule")

# ---------------------------------------------------------------- shell ----
# </head> through the start of <main>. The nav mount, the shared nav/theme/sync script,
# the Upside Down, Ask Toto and the DDMe chip all ride along untouched.
i_main = once(src, "\n<main>\n", "main open")
shell = src[i_head:i_main]
shell = sub1(shell, 'data-page="pound"', 'data-page="arena"', "page key")
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "const UD = {" in shell, "lost the Upside Down"

# The Upside Down map is keyed by the page's own filename stem, so this key is added
# HERE and nowhere else. A sitewide sweep for it aborts (learned in Stage 2).
shell = sub1(shell,
             '      "dawghouse":"/data/pound-tools.json"\n',
             '      "dawghouse":"/data/pound-tools.json",\n'
             '      "arena":"/data/surfaces.json"\n',
             "UD map tail")

# ---------------------------------------------------------------- footer ----
i_foot = once(src, '\n<footer class="foot">', "footer open")
tail = src[i_foot:]
# drop dawghouse's own inventory script; keep everything structural after it
i_scr = once(tail, "\n<script>\n", "page script open")
j_scr = once(tail, "</script>\n</div>\n</body>", "page script close")
foot_open = tail[:i_scr]
foot_close = tail[j_scr + len("</script>"):]

MAIN = """
<main>
  <header class="p-hero">
    <div class="p-kicker">Arena · the games played against other people · a directory, not a grade</div>
    <h1>Where you play against other people. <a class="tierchip" href="index.html#tiers" title="Why this page is in Labs">Labs</a></h1>
    <p class="p-lead">Bozo, the Guillotine companion, Survivor, the DFS solver and the live draft rig
    all put you across from a person rather than across from a number. This page is the directory to
    them and nothing more: it lists them, links them, and shows each one's own tier and machine
    surfaces read live from <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a>.
    Being listed here is an address, not a verdict — the chip on each card is that surface's claim,
    and this page makes none of its own.</p>
  </header>
  <div class="p-disclosure"><b>No oracle lives here.</b> Every game linked from this page runs on dated
  2026 inputs. Nothing here has established betting profitability, and a tool being live is not the same
  as a tool being right.</div>
  <nav class="p-jump" aria-label="Arena sections">
    <a href="#games">The games</a><a href="#building">Under construction</a><a href="#machines">For machines</a><a href="draft-leagues.html">League setup &rarr;</a>
  </nav>

  <section class="p-section" id="games">
    <header><div><h2>The games</h2><p class="dek">One card per Arena surface in
      <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a>, rendered from the file —
      the count is the file's, not a number typed into this page. A
      <span class="collar"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><ellipse cx="12" cy="9.5" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="2.4"></ellipse><circle cx="12" cy="17.6" r="3.1" fill="currentColor"></circle></svg></span>
      collar means the surface earned one; the criteria are written down in
      <a href="/data/receipts-method.md">receipts-method.md</a>. Creating and joining leagues lives on
      <a href="draft-leagues.html">draft-leagues.html</a>, which owns no machine surface and carries no
      nav, so it is a link here rather than a card.</p></div>
      <div class="p-meta" id="arenaCount" aria-live="polite">reading /data/surfaces.json&hellip;</div></header>
    <div class="inventory" id="arenaCards"><div class="p-loading">Loading the Arena surfaces&hellip;</div></div>
  </section>

  <section class="p-section" id="building">
    <header><div><h2>Under construction</h2><p class="dek">Only what the data already names as
      <code>planned</code>, so no card here can invent a capability. Each one is a surface that is
      written down and <b>not callable</b>. None of them has a button, a form or a link to a dead
      anchor: a card that says it is not built is honest, and a live-looking control that silently
      fails is not.</p></div>
      <div class="p-meta" id="ucCount" aria-live="polite"></div></header>
    <div class="inventory" id="ucCards"></div>
  </section>

  <section class="p-section" id="machines">
    <header><div><h2>The same directory for machines</h2><p class="dek">Assistants should read the map
      rather than scrape the cards above.</p></div></header>
    <div class="machine-box"><ul>
      <li><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> — every surface with its
        page, tier, live machine access and <code>planned</code> list. The Arena rows carry
        <code>domain: "arena"</code>, added 2026-08-09; this page renders exactly those and nothing else.</li>
      <li><a href="/data/league.json"><code>/data/league.json</code></a>,
        <a href="/data/bozo-rules.json"><code>/data/bozo-rules.json</code></a> and
        <a href="/data/survivor.json"><code>/data/survivor.json</code></a> — the configuration, ruleset
        and win probabilities behind three of the cards. Each card links its own files too.</li>
      <li><code>dd_bozo_week</code>, <code>dd_bozo_standings</code>, <code>dd_draft_board</code>,
        <code>dd_survivor_week</code>, <code>dd_survivor_ev</code>,
        <code>dd_optimize_survivor_path</code>, <code>dd_solve_dfs_lineup</code> and
        <code>dd_league_overview</code> — read-only Worker tools behind these games. The map is the
        authority on which are live; this list is a convenience.</li>
    </ul><p class="assumption">Arena is a directory over surfaces that already exist. It owns no data
    file, so it has <b>no row of its own</b> in the map — a hub with a row would be claiming a surface
    that does not exist.</p></div>
  </section>
</main>
"""

SCRIPT = r"""
<script>
/* arena.html — the competition hub.
 *
 * Everything on this page is rendered from /data/surfaces.json. There is no typed card
 * list and no typed count, because a hand-written hub list drifts and then lies: it is
 * the same failure test-pound-contracts.js already defends against on the CFB cards.
 *
 * ⚠️ FAILS LOUD, NEVER QUIET. If the map cannot be read, or carries no arena rows, the
 * page says so where the cards would be. It must never render an empty grid that reads
 * as "there are no games".
 */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}

  const DOMAIN="arena";
  const TIER_LABEL={labs:"Labs",dawg:"Working Dawg",pound:"The DawgHouse"};
  const KIND={json:"JSON",markdown:"Markdown",mcp:"MCP",rest:"REST"};
  /* The collar: tier "dawg" is a glyph with an accessible name, not a word. The criteria
     it stands for are in /data/receipts-method.md — without them the symbol would be an
     unbacked claim. Labs and DawgHouse stay text chips; only the earned tier gets a mark. */
  const COLLAR='<span class="collar" role="img" aria-label="Working Dawg — earned its collar" title="Working Dawg — earned its collar. Criteria: /data/receipts-method.md"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><ellipse cx="12" cy="9.5" rx="7.4" ry="5.4" fill="none" stroke="currentColor" stroke-width="2.4"></ellipse><circle cx="12" cy="17.6" r="3.1" fill="currentColor"></circle></svg></span>';
  const tierMark=t=> t==="dawg" ? COLLAR
    : `<span class="status status-${esc(t)}">${esc(TIER_LABEL[t]||t)}</span>`;

  const machineItem=m=>{
    const what = m.kind==="mcp"
      ? `<code>${esc(m.tool)}</code>`
      : `<a href="${esc(m.url)}"><code>${esc(m.url)}</code></a>`;
    return `<li>${esc(KIND[m.kind]||m.kind)}: ${what}${m.covers?` — ${esc(m.covers)}`:""}</li>`;
  };

  function gameCard(row){
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

  /* One under-construction card per PLANNED entry on an Arena row. The list is the
     file's; this page cannot add to it. No control of any kind goes inside a .uc card.
     ⚠️ THE HEADING IS THE PLANNED SURFACE, NOT THE ROW NAME. Headed by the row name, a
     card for `rest:/api/draft` reads as "the live auction is under construction", which
     is false in the understating direction — the page is live, the extra surface is not.
     Naming the thing that does not exist is the only heading that cannot be misread. */
  function ucCard(row,planned){
    const pageLive=(row.machine||[]).some(m=>m.status==="live");
    return `<article class="tool uc" data-status="under-construction" data-surface="${esc(row.id)}" data-planned="${esc(planned)}">`
      + `<span class="uc-art" aria-hidden="true"></span>`
      + `<span class="uc-chip">Under construction</span>`
      + `<h3><code>${esc(planned)}</code></h3>`
      + `<p class="meta-line">A planned addition to ${esc(row.name)}.</p>`
      + `<p>${pageLive?`That page is already live; <b>this surface is not</b>. It is`:"It is"}
         named <code>planned</code> in the surfaces map and <b>not callable</b>. The card exists so the
         work does not get forgotten, not because any part of it runs yet.</p>`
      + (row.gap?`<p class="block"><b>Why it is not live:</b> ${esc(row.gap)}</p>`:"")
      + `</article>`;
  }

  async function load(){
    let rows;
    try{
      const env=await json("/data/surfaces.json");
      if(!env||!Array.isArray(env.data)) throw new Error("surfaces payload is malformed");
      rows=env.data.filter(r=>r.domain===DOMAIN);
      if(!rows.length) throw new Error("the surfaces map has no rows with domain \"arena\"");
    }catch(err){
      $("arenaCards").innerHTML='<div class="p-error">The surfaces map could not be read, so this directory is empty rather than wrong: '+esc(err.message)+'</div>';
      $("arenaCount").textContent="directory unavailable";
      $("ucCards").innerHTML='<div class="p-error">Planned surfaces unavailable — they are read from the same map.</div>';
      $("ucCount").textContent="";
      return;
    }
    $("arenaCards").innerHTML=rows.map(gameCard).join("");
    $("arenaCount").textContent=`${rows.length} arena ${rows.length===1?"surface":"surfaces"} · from /data/surfaces.json`;

    const uc=rows.flatMap(r=>(r.planned||[]).map(p=>ucCard(r,p)));
    $("ucCards").innerHTML=uc.length?uc.join(""):'<div class="p-loading">Nothing in the Arena is marked planned right now.</div>';
    $("ucCount").textContent=uc.length?`${uc.length} planned ${uc.length===1?"surface":"surfaces"} · not callable`:"none planned";
  }
  load();
})();

</script>"""

out = head + shell + MAIN + foot_open + SCRIPT + foot_close

# ---------------------------------------------------------------- guards ----
assert out.count("<main>") == 1 and out.count("</main>") == 1
assert out.count('id="arenaCards"') == 1 and out.count('id="ucCards"') == 1
assert out.count('id="udBtn"') == 0, "the Upside Down button is injected by the nav script, not typed"
assert "toolInventory" not in out, "dawghouse's shelf script came along"
assert "pound-tools.json" in out, "the UD map lost its dawghouse key"
assert out.count('"arena":"/data/surfaces.json"') == 1
assert out.count(".uc-chip{") == 1 and out.count(".uc-art{") == 1
assert out.endswith("</html>\n") or out.endswith("</html>")
assert "\r" not in out, "CRLF crept in; this repo is all-LF"

OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name}")
