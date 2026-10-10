"""
Stamp explore.html — the Data Explorer (Lab / Pup) — out of fourth-down.html.

Same technique as build_data_library.py: there is no build system, so a NEW page is an
existing page's head + shared nav/Toto shell with <main> and the page script swapped.
fourth-down.html is the template because it is the newest page that already loads its
behaviour from root *.js files (which sw.js VERSION hashes).

⚠️ Slice by CONTENT MARKERS, never line numbers.
⚠️ Run work/patch-nav-explore.py FIRST so the template already lists explore.html in the
   nav and MAP; this script asserts it.
⚠️ The page script is explore.js. Its ?v= is the first 12 hex of its md5, so a JS-only
   change re-keys the URL as well as sw.js VERSION. Re-run this script after editing it,
   then work/stamp-sw-version.py.

    cd work && python3 build_explore.py && python3 stamp-sw-version.py
"""
import hashlib
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "fourth-down.html"
OUT = REPO / "explore.html"
src = TEMPLATE.read_text(encoding="utf-8")


def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times, expected 1"
    return hay.index(needle)


def sub1(hay, old, new, what):
    once(hay, old, what)
    return hay.replace(old, new, 1)


assert '["explore.html","Data Explorer (Pup)","explore"]' in src, "run patch-nav-explore.py first"

# ---- head ----
i_head = once(src, "</head>", "head close")
head = src[:i_head]
head = re.sub(r"<title>.*?</title>", "<title>Data Explorer · Data Dawgs</title>", head, count=1, flags=re.S)
head = re.sub(r'<meta name="description" content="[^"]*">',
              '<meta name="description" content="Query the public Data Dawgs /data files with SQL in your browser '
              '(DuckDB-Wasm) and turn the result into a cited chart. Lab / Pup: pure query, no forecasts.">',
              head, count=1)
head = sub1(head, '<link rel="stylesheet" href="fourth-down.css?v=e7b0f60025ef">\n', "", "fourth-down css")
assert "fourth-down" not in head.split("</style>")[-1], "a fourth-down asset survived in the head"

CSS = r"""<style>
/* Data Explorer — page-local styles on the shared site variables. */
.dx{max-width:1180px;margin:auto;padding-bottom:40px}
.dx-kicker{font:800 12px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.dx-hero{padding:14px 0 18px}.dx-hero h1{font-size:clamp(36px,5.5vw,64px);line-height:1.02;letter-spacing:-.045em;margin:10px 0 12px;font-weight:900}
.dx-hero h1 span{color:var(--accent)}.dx-hero p{max-width:760px;color:var(--ink-2);margin:0 0 8px;font-size:16px}
.dx-status{font:700 12px/1.6 ui-monospace,monospace;color:var(--ink-2);margin:8px 0 18px}.dx-status.bad{color:var(--bad,#ff6b6b)}
.dx-grid{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:22px;align-items:start}
@media(max-width:900px){.dx-grid{grid-template-columns:1fr}}
.dx-panel{border:1px solid var(--border);background:var(--surface-1);border-radius:12px;padding:14px 16px;margin-bottom:16px}
.dx-panel h2{font-size:17px;margin:0 0 10px}
.dx button{font:inherit;border:1px solid var(--border);background:var(--surface-1);color:var(--ink-1);border-radius:8px;padding:7px 11px;font-weight:700;cursor:pointer;min-height:36px}
.dx button:hover{border-color:var(--accent)}.dx button:disabled{opacity:.55;cursor:not-allowed}
.dx button.dx-primary{background:var(--accent);border-color:var(--accent);color:#1b0f05}
.dx button:focus-visible,.dx textarea:focus-visible,.dx select:focus-visible,.dx input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.dx-starters{list-style:none;margin:0;padding:0;display:grid;gap:6px}.dx-starters button{width:100%;text-align:left;font-size:13px}
.dx-unavail small{display:block;color:var(--ink-3);font-size:12px;margin:4px 2px 0}
.dx-tbl{border-top:1px solid var(--border);padding:6px 0}.dx-tbl summary{cursor:pointer;font-size:13px}.dx-tbl p{font-size:12px;color:var(--ink-2);margin:6px 0}
.dx-cols button{font:600 11px ui-monospace,monospace;padding:2px 6px;min-height:0;margin:2px 0}
.dx-kind{font:700 10px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.dx textarea{width:100%;min-height:210px;font:500 13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--page);color:var(--ink-1);border:1px solid var(--border);border-radius:8px;padding:10px;resize:vertical;tab-size:2}
.dx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
.dx-hint{font:12px ui-monospace,monospace;color:var(--ink-3);min-height:1.2em}
.dx-error{color:var(--bad,#ff6b6b);font:600 13px ui-monospace,monospace;white-space:pre-wrap}
.dx-cite{border-left:3px solid var(--accent);padding:2px 10px;margin:8px 0;font-size:13px}.dx-cite ul{margin:0;padding-left:16px}.dx-cite small{color:var(--ink-3)}
.dx-meta{font:600 12px ui-monospace,monospace;color:var(--ink-2)}
.dx-tablewrap{overflow:auto;max-height:520px;border:1px solid var(--border);border-radius:8px}
.dx table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
.dx th{position:sticky;top:0;background:var(--surface-1);text-align:left}.dx th button{border:0;background:none;padding:6px 8px;min-height:0;font-size:12px;white-space:nowrap}
.dx td{padding:4px 8px;border-top:1px solid var(--border);white-space:nowrap}.dx td.num{text-align:right;font-family:ui-monospace,Menlo,monospace}
.dx-null{color:var(--ink-3);font-style:italic}
.dx canvas{width:100%;height:auto;border:1px solid var(--border);border-radius:8px;display:block}
.dx label{font-size:12px;color:var(--ink-2);display:flex;flex-direction:column;gap:3px}
.dx select,.dx input[type=text],.dx input[type=url]{font:inherit;font-size:13px;background:var(--page);color:var(--ink-1);border:1px solid var(--border);border-radius:6px;padding:5px 7px}
.dx-share-out{width:100%}
.dx-method{font-size:14px;color:var(--ink-2)}.dx-method summary{cursor:pointer;font-weight:800;color:var(--ink-1)}
.dx-fallback{border:2px solid var(--warn,#eda100);border-radius:12px;padding:14px 18px}
</style>
"""
head = head + CSS

# ---- body: keep the shared nav/Toto shell, swap <main> ----
i_body = once(src, "</head>\n<body>\n", "body open") + len("</head>\n")
i_main = once(src, '<main class="fd">', "fd main")
shell = src[i_body:i_main]
shell = sub1(shell, '<script data-page="fourth-down">', '<script data-page="explore">', "nav data-page")

MAIN = r"""<main class="dx" id="dx">
  <header class="dx-hero">
    <div class="dx-kicker">Data Dawgs / Data / Lab</div>
    <h1>Data <span>Explorer.</span> <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Pup — live and useful, not yet validated">Pup</a></h1>
    <p>Ask the public <a href="data.html">/data</a> files a question in SQL, in your own browser, and turn the answer into a chart that says where it came from. Every result cites the file and its <code>as_of</code>. Nothing you type leaves this page.</p>
    <p><b>Pure query, no forecasts.</b> Observed, modelled, market and analyst numbers stay labelled as what they are. Not betting advice.</p>
  </header>
  <div class="dx-status" id="dx-status" role="status" aria-live="polite">Loading…</div>

  <section id="dx-fallback" class="dx-fallback" hidden aria-labelledby="dx-fb-h">
    <h2 id="dx-fb-h">The SQL engine could not load</h2>
    <p>DuckDB-Wasm did not start in this browser (<span id="dx-fb-why"></span>). The files themselves are still public, dated and readable: open them directly, preview the rows below, or read the example chart.</p>
    <ul id="dx-fb-files"></ul>
    <figure><canvas id="dx-fb-canvas" width="1200" height="760" role="img" aria-label="Static example chart"></canvas><figcaption class="dx-meta" id="dx-fb-chart-cap"></figcaption></figure>
  </section>

  <div class="dx-grid" id="dx-app">
    <aside>
      <section class="dx-panel" aria-labelledby="dx-st-h"><h2 id="dx-st-h">Starter queries</h2><ul class="dx-starters" id="dx-starters"></ul></section>
      <section class="dx-panel" aria-labelledby="dx-sc-h"><h2 id="dx-sc-h">Tables</h2><p class="dx-meta">Each table is a row array already inside a /data file, flattened (<code>parent_child</code> names). No column is added or derived.</p><div id="dx-schema"></div></section>
    </aside>
    <div>
      <section class="dx-panel" aria-labelledby="dx-ed-h">
        <h2 id="dx-ed-h">SQL</h2>
        <textarea id="dx-sql" data-ddb-skip spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="SQL query" aria-describedby="dx-hint"></textarea>
        <div class="dx-hint" id="dx-hint">Tab completes table and column names · Ctrl/⌘+Enter runs</div>
        <div class="dx-row"><button type="button" class="dx-primary" id="dx-run" disabled>Run</button></div>
        <div class="dx-error" id="dx-error" role="alert" hidden></div>
      </section>
      <section class="dx-panel" id="dx-results" hidden aria-labelledby="dx-rs-h">
        <h2 id="dx-rs-h">Result</h2>
        <div class="dx-meta" id="dx-meta"></div>
        <div class="dx-cite" id="dx-cite"></div>
        <div class="dx-row"><button type="button" id="dx-csv">CSV (Datawrapper-ready)</button><button type="button" id="dx-csv-cited">CSV + citation</button><button type="button" id="dx-json">JSON + query + sources</button></div>
        <div class="dx-tablewrap"><table id="dx-table"></table></div>
      </section>
      <section class="dx-panel" id="dx-chart" hidden aria-labelledby="dx-ch-h">
        <h2 id="dx-ch-h">Chart this</h2>
        <div class="dx-row">
          <label>Type<select id="dx-ctype"><option value="bar">Sorted bar</option><option value="hbar">Horizontal bar</option><option value="line">Line</option><option value="scatter">Scatter</option><option value="table">Table</option></select></label>
          <label>X / category<select id="dx-cx"></select></label>
          <label>Y / value<select id="dx-cy"></select></label>
          <label>Point label<select id="dx-clabel"></select></label>
          <label>Title<input type="text" id="dx-ctitle" data-ddb-skip placeholder="auto"></label>
        </div>
        <canvas id="dx-canvas" width="1200" height="760" role="img" aria-label="Chart of the current query result"></canvas>
        <div class="dx-row"><button type="button" id="dx-png">Download PNG</button><button type="button" id="dx-share">Copy share link</button><span class="dx-meta" id="dx-share-msg"></span></div>
        <input type="url" id="dx-share-out" class="dx-share-out" readonly hidden aria-label="Share link" data-ddb-skip>
      </section>
    </div>
  </div>

  <details class="dx-panel dx-method" id="dx-method"><summary>Method — what this page does and does not calculate</summary>
    <p>This page loads a curated set of public files from <a href="/data/index.json">/data/</a> into DuckDB-Wasm running in your browser tab. Each table is the row array already published inside one file. The only reshaping: a season-keyed array gets a <code>season</code> column (the key is the published value), nested fields become <code>parent_child</code> columns, and lists are joined with commas. Nothing is imputed: <b>null stays null</b> and is never treated as zero. Two fields are not loaded: <code>pool.silva</code> (a source analyst's rank string) and <code>cfb_market.books</code> (the per-book list).</p>
    <p>Every result and chart names the file(s) it read and each file's <code>as_of</code>. The kind label — observed, modelled descriptive, model forecast, market, model + market backtest, analyst estimate — comes from the file, not from the query. A query can mix kinds; the citation shows each one, so read them before comparing.</p>
    <p>No model runs here. There are no new forecasts, no blends, no hidden calls. Future outcomes in these files are model probabilities and should be read as ranges with their stated assumptions, not as point predictions. <b>Not available in the public data:</b> an independent closing-market line per 2026 NFL game, so "nfelo vs the closing market" cannot be answered here (see the starter list). There is no ADP column in <code>pool</code>.</p>
    <p>The SQL engine is <a href="https://duckdb.org/docs/api/wasm/overview">DuckDB-Wasm</a> 1.32.0, served from this site (<code>/assets/duckdb-wasm/</code>, MIT licence alongside): no third-party CDN. The engine is about 34 MB uncompressed on a first visit and is cached by your browser after that. If it cannot load, the page falls back to plain file links, row previews and a static example chart. Share links keep the query in the URL fragment, which browsers never send to a server.</p>
  </details>
</main>
<footer class="foot">Data Dawgs · Data, Not Dogma · Data Explorer (Pup) · Pure query over public files.</footer>
</div>
"""

js = (REPO / "explore.js").read_bytes().replace(b"\r\n", b"\n")
v = hashlib.md5(js).hexdigest()[:12]
tail = f'<script src="explore.js?v={v}"></script>\n</body></html>\n'
html = head + "</head>\n" + shell + MAIN + tail
assert html.count('data-tier="labs"') == 1 and html.count("window.DD_BOTCTX=") == 0
assert html.count("const MAP = `") == 1 and "explore.html — the Data Explorer" in html
OUT.write_text(html, encoding="utf-8", newline="\n")
print(f"  wrote {OUT.name} ({len(html.encode()):,} bytes), explore.js?v={v}")
