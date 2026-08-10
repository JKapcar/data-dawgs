"""
Stamp data.html — THE LIBRARY — out of dawghouse.html. CEP-5A Stage 5.

Same technique as build_arena.py: no build system, so a NEW page is an existing page's
head + shell + footer with <main> and the page script swapped. dawghouse.html is the
template because it already carries the card/section CSS this page extends.

⚠️ Slice by CONTENT MARKERS, never line numbers.

THE SHELF IS RENDERED FROM data/index.json + data/surfaces.json AT RUNTIME. That is the
locked design and the reason this page exists in this shape: a hand-written shelf drifts
inside a month and can end up claiming a dataset validate-data has never heard of.
Everything below follows from it — the book count, the shelf a book sits on, and the
"not claimed by any surface" shelf are all computed, and the page says so out loud.

⚠️ THE UNDER-CONSTRUCTION RULES ARE COPIED OUT OF arena.html BY THIS SCRIPT, not retyped.
Stage 4 built that component once; a second hand-written copy is a fork waiting to
happen. test-data-library.mjs asserts the two blocks are byte-identical.

⚠️ ETR NEVER TOUCHES A SERVER. Reference books link out and nothing more: no fetch, no
proxy, no cache, no preconnect, no prefetch. The suite asserts zero network requests to
any reference-book host.

Run:  cd work && python3 build_data_library.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "dawghouse.html"
ARENA = REPO / "arena.html"
OUT = REPO / "data.html"

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


# ---- lift the under-construction component out of arena.html, verbatim ----
UC_START = "/* CEP-5A Stage 4 — THE REUSABLE UNDER-CONSTRUCTION TREATMENT."
UC_END = "\n/* Tier chips rendered FROM surfaces.json"
i_uc = once(arena, UC_START, "uc block start", "arena.html")
j_uc = once(arena, UC_END, "uc block end", "arena.html")
UC_CSS = arena[i_uc:j_uc]
assert UC_CSS.count(".uc-chip{") == 1 and UC_CSS.count(".uc-art{") == 1 and UC_CSS.count(".uc{") == 1
assert "Stage 6" in UC_CSS, "the component lost its own reuse note"

# ---------------------------------------------------------------- head ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]

FWD_START = "<script>/* CEP-5A 1b:"
FWD_END = 'go();addEventListener("hashchange",go);})();</script>\n'
i_fwd = once(head, FWD_START, "1b forward block")
j_fwd = once(head, FWD_END, "1b forward close") + len(FWD_END)
head = head[:i_fwd] + head[j_fwd:]
assert "location.replace" not in head

head = re.sub(r"<title>.*?</title>", "<title>The Library · Data Dawgs</title>", head, count=1, flags=re.S)

LIB_CSS = """.inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
""" + UC_CSS + """/* CEP-5A Stage 5 — THE LIBRARY. Spines are styled HTML and real <button> elements:
   they carry real text for a screen reader, they tab and they take Enter and Space for
   free. ⚠️ NO CANVAS anywhere on this page — a painted spine is unreadable to assistive
   technology and unselectable to everyone, and a painted "chart" on the right-hand page
   would be a picture of numbers nobody can check. */
.lib-shelf{border:1px solid var(--border);border-radius:12px;background:var(--surface-1);padding:13px 14px;margin:0 0 14px}
.lib-shelf>h3{margin:0 0 3px;font:750 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.lib-shelf>p{margin:0 0 11px;color:var(--ink-3);font-size:12.5px;line-height:1.6;max-width:820px}
.spines{display:flex;flex-wrap:wrap;gap:7px;align-items:stretch}
.spine{display:flex;flex-direction:column;justify-content:space-between;gap:6px;min-width:0;max-width:100%;text-align:left;cursor:pointer;
  border:1px solid var(--grid);border-left:4px solid var(--accent);border-radius:4px;background:var(--page);color:var(--ink-1);
  padding:9px 10px;font:inherit}
.spine:hover{border-color:var(--accent)}
.spine:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.spine[aria-expanded="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--page))}
.spine b{font:700 12.5px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.spine span{font:650 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-transform:uppercase}
.spread{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;border:1px solid var(--border);border-radius:12px;background:var(--surface-1);overflow:hidden;margin:0 0 18px}
.lib-page{padding:16px 18px;min-width:0}
.lib-page+.lib-page{border-left:1px solid var(--grid)}
.lib-page h3{margin:0 0 7px;font-size:16.5px;overflow-wrap:anywhere}
.lib-page p{margin:6px 0;color:var(--ink-2);font-size:13px;line-height:1.6}
.lib-page dl{margin:9px 0 0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:12px}
.lib-page dt{color:var(--ink-3);font:650 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}
.lib-page dd{margin:0;color:var(--ink-1);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.lib-page pre{margin:9px 0 0;padding:10px;border:1px solid var(--grid);border-radius:8px;background:var(--page);color:var(--ink-2);font-size:11.5px;line-height:1.55;overflow-x:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.lib-side{font:650 10.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink-3);text-transform:uppercase;margin:0 0 8px}
.lib-close{border:1px solid var(--border);border-radius:8px;background:var(--page);color:var(--ink-2);padding:6px 10px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer;margin-top:12px}
.lib-close:hover{border-color:var(--accent);color:var(--accent)}
@media(max-width:760px){.spread{grid-template-columns:1fr}.lib-page+.lib-page{border-left:0;border-top:1px solid var(--grid)}.spine{width:100%}}"""

head = sub1(head, ".inventory{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
            LIB_CSS, ".inventory grid rule")

# ---------------------------------------------------------------- shell ----
i_main = once(src, "\n<main>\n", "main open")
shell = src[i_head:i_main]
shell = sub1(shell, 'data-page="pound"', 'data-page="data"', "page key")
assert '<div id="nav"></div>' in shell and "const UD = {" in shell
# keyed by this page's own stem — added HERE and nowhere else (a sitewide sweep aborts)
shell = sub1(shell,
             '      "dawghouse":"/data/pound-tools.json"\n',
             '      "dawghouse":"/data/pound-tools.json",\n'
             '      "data":"/data/index.json"\n',
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
    <div class="p-kicker">The Library · every machine-readable file this site publishes, and the ones it does not</div>
    <h1>The Library. <a class="tierchip" href="index.html#tiers" title="Why this page is in Labs">Labs</a></h1>
    <p class="p-lead">Every file on the shelves below is listed by
    <a href="/data/index.json"><code>/data/index.json</code></a>, the generated manifest, and
    shelved by the surface that owns it in <a href="/data/surfaces.json"><code>/data/surfaces.json</code></a>.
    Nothing here is typed into this page: if a file is not in the manifest it has no spine, and if
    the manifest gains one it appears without anyone editing this page. Open a book and the right-hand
    page shows what is actually in the file — its envelope and its shape, read from the file itself.</p>
  </header>
  <div class="p-disclosure"><b>A catalogue is not a warranty.</b> Every payload carries its own
  <code>as_of</code>; some are weeks old and say so. A file being listed here means it exists and is
  public, not that its numbers are current or that anything built on them has been graded.</div>
  <nav class="p-jump" aria-label="Library sections">
    <a href="#shelves">The shelves</a><a href="#reference">Reference</a><a href="#planned">Under construction</a><a href="#machines">For machines</a>
  </nav>

  <section class="p-section" id="shelves">
    <header><div><h2>The shelves</h2><p class="dek">One spine per file in the manifest, grouped by the
      <code>domain</code> of the surface that publishes it. Click a spine to open the book: the left
      page describes it, the right page shows the real envelope and shape. Nothing is drawn — a
      picture of numbers is not something you can check.</p></div>
      <div class="p-meta" id="libCount" aria-live="polite">reading the manifest&hellip;</div></header>
    <div id="libSpread" aria-live="polite"></div>
    <div id="libShelves"><div class="p-loading">Loading the manifest&hellip;</div></div>
  </section>

  <section class="p-section" id="reference">
    <header><div><h2>Reference books</h2><p class="dek">Sources we read and do not republish, from
      <a href="/data/upstream-models.json"><code>/data/upstream-models.json</code></a>: everything the
      provenance file records as not integrated. These link out and stop there. Nothing of theirs is
      mirrored, proxied or cached, and no request leaves this page for any of their hosts — that is
      the whole point of the shelf, and a test enforces it.</p></div>
      <div class="p-meta" id="refCount" aria-live="polite"></div></header>
    <div class="inventory" id="refBooks"></div>
  </section>

  <section class="p-section" id="planned">
    <header><div><h2>Under construction</h2><p class="dek">Data surfaces the map already names as
      <code>planned</code> — a JSON file or a REST route that is written down and does not exist. No
      card here has a control, because a card that says it is not built is honest and a live-looking
      one that silently fails is not.</p></div>
      <div class="p-meta" id="planCount" aria-live="polite"></div></header>
    <div class="inventory" id="planBooks"></div>
  </section>

  <section class="p-section" id="machines">
    <header><div><h2>The library for machines</h2><p class="dek">An assistant should read the manifest
      directly. It is the same list, without the furniture.</p></div></header>
    <div class="machine-box"><ul>
      <li><a href="/data/index.json"><code>/data/index.json</code></a> — every file with its
        <code>as_of</code>, byte count and SHA-256. Generated; never hand-edited. Start here.</li>
      <li><a href="/data/surfaces.json"><code>/data/surfaces.json</code></a> — which page and which
        <code>domain</code> owns each file, plus what is <code>planned</code> and not callable.</li>
      <li><a href="/data/upstream-models.json"><code>/data/upstream-models.json</code></a> — what we
        consume and under what terms, including the sources we deliberately do not republish.</li>
      <li><a href="/llms.txt"><code>/llms.txt</code></a> — the curated index, if you want the short version.</li>
    </ul><p class="assumption">This hub is a directory over files that already exist. It publishes no
    data of its own, so it has <b>no row</b> in the map.</p></div>
  </section>
</main>
"""

SCRIPT = r"""
<script>
/* data.html — the Library.
 *
 * THE SHELF RENDERS FROM /data/index.json + /data/surfaces.json. There is no typed book
 * list, no typed count and no typed shelf assignment. A hand-written shelf drifts within
 * a month and then advertises a dataset the validator has never heard of.
 *
 * ⚠️ NOTHING IS FETCHED UNTIL A BOOK IS OPENED, and opening a book is the only trigger.
 * There is deliberately no "is it near the viewport" test here: a hidden element's rect
 * is 0x0 AT THE DOCUMENT ORIGIN, so every such test reads true for it and fires on load.
 * That bug cost Stage 3 its whole lazy path (see the CFB Elo loader).
 *
 * ⚠️ REFERENCE BOOKS NEVER TOUCH A SERVER. They are rendered from the provenance file we
 * already publish and link out with rel="noopener noreferrer external". No fetch, no
 * proxy, no cache, no preconnect, no prefetch — for ETR above all, whose content is a
 * paid subscription and is not ours to move.
 */
(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.json()}
  async function text(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} returned ${r.status}`);return r.text()}

  /* Files above this size are catalogued but not opened in the browser. The manifest facts
     shown for them are still real; what is withheld is the shape, and the card says so
     rather than quietly showing less. Pulling 1.9 MB to print six key names is not a
     trade a phone on venue wifi should be asked to make. */
  const OPEN_LIMIT = 250000;
  const SHELF_LABEL = {
    arena:"Arena — the games", nfl:"NFL — analysis", cfb:"College football",
    receipts:"Receipts and method", data:"Draft material", site:"The site itself"
  };
  const SHELF_NOTE = {
    arena:"Configuration, rulesets and win probabilities behind the games people play against each other.",
    nfl:"Aggregates, ratings and the contracts the calculators implement.",
    cfb:"Results, retrodictive ratings, market snapshots and the divergence work.",
    receipts:"Pre-registered calls, the grading method, provenance and the tier audit.",
    data:"The player pool and the draft strategy synthesis.",
    site:"How this site reasons, and the rules it plays by."
  };
  const UNCLAIMED = "__unclaimed";

  let BOOKS=[], OWNER={}, openId=null;
  /* ⚠️ THE ID CARRIES THE EXTENSION. /data/bozo-rules.json and /data/bozo-rules.md are two
     different books and a stem-only id gives them the same one — duplicate DOM ids, and a
     deep link that opens whichever the browser found first. Same for tier-audit. Always
     including the extension keeps every id stable when a file is added, which a
     disambiguate-on-collision scheme would not. */
  const slug = p => p.replace(/^\/data\//,"").replace(/\./g,"-");
  const label = p => p.replace(/^\/data\//,"");
  const kb = b => b >= 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.round(b/1024)+" KB";

  function spine(b){
    return `<button type="button" class="spine" id="sp-${esc(b.id)}" data-book="${esc(b.id)}"
      aria-expanded="false" aria-controls="libSpread">
      <b>${esc(label(b.path))}</b><span>${esc(b.as_of||"undated")} · ${esc(kb(b.bytes))}</span></button>`;
  }

  function shelfBlock(key, books){
    const claimed = key !== UNCLAIMED;
    return `<div class="lib-shelf" data-shelf="${esc(key)}">
      <h3>${esc(claimed ? (SHELF_LABEL[key]||key) : "Not claimed by any surface")}</h3>
      <p>${claimed ? esc(SHELF_NOTE[key]||"") :
        "The map cannot contain itself: <code>/data/surfaces.json</code> is the map, so no row in it owns it. Anything <em>else</em> that appears on this shelf is a real gap — a published file no surface admits to, which is how a dataset goes stale unnoticed."}</p>
      <div class="spines">${books.map(spine).join("")}</div></div>`;
  }

  /* the right-hand page: real envelope + real shape, or a stated refusal. Never a chart. */
  function shapeOf(v, depth){
    if (Array.isArray(v)) {
      const inner = v.length ? shapeOf(v[0], (depth||0)+1) : "empty";
      return `array(${v.length}) of ${inner}`;
    }
    if (v && typeof v === "object") {
      const k = Object.keys(v);
      if ((depth||0) >= 1) return `object{${k.slice(0,8).join(", ")}${k.length>8?", …":""}}`;
      return "object{\n  " + k.map(x => `${x}: ${shapeOf(v[x], (depth||0)+1)}`).join("\n  ") + "\n}";
    }
    return v === null ? "null" : typeof v;
  }

  async function rightPage(b){
    if (b.bytes > OPEN_LIMIT)
      return `<p class="lib-side">Contents</p><p><b>Not opened here.</b> This file is ${esc(kb(b.bytes))};
        loading it to print its key names would cost more than the answer is worth on a phone. The facts
        on the left come from the manifest and are real. Open the file itself if you need the shape:
        <a href="${esc(b.path)}"><code>${esc(b.path)}</code></a>.</p>`;
    if (b.kind === "markdown") {
      const t = await text(b.path);
      const fm = t.match(/^<!--[^>]*-->\s*\n---\n([\s\S]*?)\n---/) || t.match(/^---\n([\s\S]*?)\n---/);
      const h1 = (t.match(/^# (.+)$/m)||[])[1];
      return `<p class="lib-side">Front matter, read from the file</p>`
        + (fm ? `<pre>${esc(fm[1].trim())}</pre>` : `<p>This file carries no front matter.</p>`)
        + (h1 ? `<p><b>Opens with:</b> ${esc(h1)}</p>` : "")
        + `<p>${esc(t.split(/\n/).length)} lines. Read it whole at <a href="${esc(b.path)}"><code>${esc(b.path)}</code></a>.</p>`;
    }
    const env = await json(b.path);
    const body = env && Object.prototype.hasOwnProperty.call(env,"data") ? env.data : env;
    return `<p class="lib-side">Envelope and shape, read from the file</p>`
      + `<dl>`
      + (env.as_of?`<dt>as_of</dt><dd>${esc(env.as_of)}</dd>`:"")
      + (env.source?`<dt>source</dt><dd>${esc(env.source)}</dd>`:"")
      + (env.built?`<dt>built</dt><dd>${esc(env.built)}</dd>`:"")
      + (env.tier?`<dt>tier</dt><dd>${esc(env.tier)}</dd>`:"")
      + (env.graded!==undefined?`<dt>graded</dt><dd>${esc(String(env.graded))}</dd>`:"")
      + `</dl>`
      + `<p class="lib-side" style="margin-top:12px">Shape of <code>data</code></p>`
      + `<pre>${esc(shapeOf(body,0))}</pre>`;
  }

  function closeBook(focusBack){
    openId=null;
    $("libSpread").innerHTML="";
    document.querySelectorAll('.spine[aria-expanded="true"]').forEach(s=>s.setAttribute("aria-expanded","false"));
    if(history.replaceState) history.replaceState(null,"",location.pathname+location.search+"#shelves");
    if(focusBack){const el=document.getElementById("sp-"+focusBack); if(el) el.focus();}
  }

  async function openBook(id, viaHash){
    const b = BOOKS.find(x=>x.id===id);
    if(!b) return;
    openId=id;
    document.querySelectorAll(".spine").forEach(s=>s.setAttribute("aria-expanded", s.dataset.book===id?"true":"false"));
    const own = OWNER[b.path]||[];
    const left = `<div class="lib-page">
        <p class="lib-side">The book</p>
        <h3>${esc(label(b.path))}</h3>
        <p>${b.note?esc(b.note):"The manifest records no note for this file."}</p>
        <dl>
          <dt>path</dt><dd><a href="${esc(b.path)}"><code>${esc(b.path)}</code></a></dd>
          <dt>as_of</dt><dd>${esc(b.as_of||"undated")}</dd>
          <dt>size</dt><dd>${esc(kb(b.bytes))}</dd>
          <dt>sha256</dt><dd><code>${esc((b.sha256||"").slice(0,32))}…</code></dd>
          <dt>${own.length>1?"surfaces":"surface"}</dt><dd>${own.length
            ? own.map(o=>`<a href="${esc(o.page)}">${esc(o.name)}</a>`).join("<br>")
            : "none — see the unclaimed shelf"}</dd>
        </dl>
        <button type="button" class="lib-close" id="libClose">Close the book</button>
      </div>`;
    $("libSpread").innerHTML = `<div class="spread">${left}<div class="lib-page"><p class="p-loading">Reading the file&hellip;</p></div></div>`;
    $("libClose").addEventListener("click",()=>closeBook(id));
    if(history.replaceState) history.replaceState(null,"",location.pathname+location.search+"#book-"+id);
    let right;
    try{ right = await rightPage(b); }
    catch(err){ right = `<p class="lib-side">Contents</p><p class="p-error">This file could not be read: ${esc(err.message)}. The facts on the left come from the manifest and still stand.</p>`; }
    if(openId!==id) return;                       // another book was opened while this loaded
    $("libSpread").querySelector(".lib-page + .lib-page").innerHTML = right;
    if(!viaHash) $("libSpread").querySelector("h3").scrollIntoView({block:"nearest"});
  }

  /* ⚠️ A hash-only navigation does NOT reload the document, so a forward that runs once at
     load never fires again. Listen for hashchange too. */
  function fromHash(){
    const m = /^#book-(.+)$/.exec(location.hash||"");
    if(m) openBook(decodeURIComponent(m[1]), true);
    else if(openId) closeBook(null);
  }

  async function load(){
    let idx, sur;
    try{
      [idx, sur] = await Promise.all([json("/data/index.json"), json("/data/surfaces.json")]);
      if(!idx.data||!Array.isArray(idx.data.files)) throw new Error("the manifest is malformed");
      if(!Array.isArray(sur.data)) throw new Error("the surfaces map is malformed");
    }catch(err){
      $("libShelves").innerHTML='<div class="p-error">The manifest could not be read, so the library is empty rather than wrong: '+esc(err.message)+'</div>';
      $("libCount").textContent="catalogue unavailable";
      $("refBooks").innerHTML='<div class="p-error">Reference books are read from the same provenance file, which was not reached.</div>';
      $("planBooks").innerHTML='<div class="p-error">Planned surfaces are read from the map, which was not reached.</div>';
      return;
    }
    /* ⚠️ A FILE CAN BE CLAIMED BY MORE THAN ONE SURFACE — /data/pound-tools.json is claimed
       by both the DawgHouse shelf and the CFB lab, because the CFB roadmap lives inside it.
       Keep EVERY claimant: last-wins silently shelved it under whichever row happened to be
       later in the map, and the book then named one owner as if it were the only one. The
       shelf is the FIRST claimant in map order (deterministic); the book lists all of them. */
    OWNER={};
    for(const r of sur.data) for(const m of (r.machine||[])) if(m.url) (OWNER[m.url]=OWNER[m.url]||[]).push(r);

    BOOKS = [].concat(
      idx.data.files.map(f=>({...f, kind:"json"})),
      (idx.data.markdown||[]).map(f=>({...f, kind:"markdown"}))
    ).map(f=>({...f, id:slug(f.path)}));

    const groups={};
    for(const b of BOOKS){
      const key = OWNER[b.path] ? OWNER[b.path][0].domain : UNCLAIMED;
      (groups[key]=groups[key]||[]).push(b);
    }
    const order = Object.keys(SHELF_LABEL).filter(k=>groups[k]).concat(groups[UNCLAIMED]?[UNCLAIMED]:[])
      .concat(Object.keys(groups).filter(k=>!SHELF_LABEL[k]&&k!==UNCLAIMED));
    $("libShelves").innerHTML = order.map(k=>shelfBlock(k,groups[k])).join("");
    $("libCount").textContent = `${BOOKS.length} books on ${order.length} shelves · from /data/index.json`;
    $("libShelves").addEventListener("click", e=>{
      const s = e.target.closest(".spine"); if(!s) return;
      s.dataset.book===openId ? closeBook(s.dataset.book) : openBook(s.dataset.book);
    });

    /* reference books: whatever the provenance file says we do not integrate */
    let ref=[];
    try{
      const up = await json("/data/upstream-models.json");
      ref = (up.data||[]).filter(r=>r.integration_mode==="pending"||r.integration_mode==="reference-only");
    }catch(err){ ref=[]; }
    $("refBooks").innerHTML = ref.length ? ref.map(r=>{
      const href = r.homepage || (r.repository?"https://github.com/"+r.repository:null);
      return `<article class="tool" data-ref="${esc(r.id)}" data-integration="${esc(r.integration_mode)}">
        <span class="status status-pound">${esc(r.integration_mode)}</span>
        <h3>${esc(r.creator)}${r.repository?` · <code>${esc(r.repository)}</code>`:""}</h3>
        <p>${esc(r.notes)}</p>
        <p class="meta-line"><b>Licence status:</b> <code>${esc(r.license_status)}</code> · <b>What we publish:</b> ${esc(r.data_status)}</p>
        ${href?`<p class="meta-line"><b>Read it at the source:</b> <a href="${esc(href)}" rel="noopener noreferrer external">${esc(href)}</a></p>`:""}
      </article>`;
    }).join("") : '<div class="p-error">The provenance file could not be read, so no reference book is shown rather than a guessed one.</div>';
    $("refCount").textContent = ref.length ? `${ref.length} sources read, none republished` : "";

    /* under construction: planned DATA surfaces only — a json file or a REST route */
    const plan=[];
    for(const r of sur.data) for(const p of (r.planned||[])){
      const kind=p.split(":")[0];
      if(kind==="json"||kind==="rest") plan.push([r,p]);
    }
    $("planBooks").innerHTML = plan.length ? plan.map(([r,p])=>`
      <article class="tool uc" data-status="under-construction" data-surface="${esc(r.id)}" data-planned="${esc(p)}">
        <span class="uc-art" aria-hidden="true"></span>
        <span class="uc-chip">Under construction</span>
        <h3><code>${esc(p)}</code></h3>
        <p class="meta-line">A planned surface for ${esc(r.name)}.</p>
        <p>Named <code>planned</code> in the map and <b>not published</b>. It has no entry in the
        manifest, so it has no spine on any shelf — which is the point: the shelves show what exists.</p>
        ${r.gap?`<p class="block"><b>Why it is not live:</b> ${esc(r.gap)}</p>`:""}
      </article>`).join("") : '<div class="p-loading">Nothing is marked planned as a data surface right now.</div>';
    $("planCount").textContent = plan.length ? `${plan.length} planned data ${plan.length===1?"surface":"surfaces"} · not published` : "none planned";

    fromHash();
  }
  addEventListener("hashchange", fromHash);
  load();
})();

</script>"""

out = head + shell + MAIN + foot_open + SCRIPT + foot_close

# ---------------------------------------------------------------- guards ----
assert out.count("<main>") == 1 and out.count("</main>") == 1
assert out.count('id="libShelves"') == 1 and out.count('id="libSpread"') == 1
assert out.count('id="refBooks"') == 1 and out.count('id="planBooks"') == 1
assert "toolInventory" not in out, "dawghouse's shelf script came along"
assert out.count('"data":"/data/index.json"') == 1
assert UC_CSS in out, "the under-construction component did not travel verbatim"
assert "<canvas" not in out[out.index("<main>"):], "the library must not paint anything"
assert "establishtherun" not in out, "a reference host is hardcoded; the link comes from the data"
assert "\r" not in out
assert out.endswith("</html>\n") or out.endswith("</html>")

OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(out.encode('utf-8'))} bytes from {TEMPLATE.name} (+ uc component from arena.html)")
