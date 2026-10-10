/* Data Explorer — DuckDB-Wasm SQL + a small chart builder over the public /data JSON.
   Lab / Pup. Pure query and picture: this file computes no forecast, blends nothing,
   and never makes a network call except GETs of /data/*.json and the pinned DuckDB
   bundle. Nothing typed here leaves the browser.

   ⚠️ TABLES ARE RESHAPES, NEVER INVENTIONS. Each table below is the row array that
   already sits inside a /data envelope. The only transforms are: an array keyed by
   season becomes a `season` column (the key IS the published value), nested objects
   are flattened to parent_child column names, and list fields are joined with ", ".
   No derived, blended or imputed column is added here. If a question needs a field
   the files do not publish, the starter list says "unavailable" — it does not guess.
   null stays null: DuckDB NULL, an empty CSV cell, JSON null. */
(function(){
  "use strict";
  const DUCKDB_VERSION = "1.32.0";
  // Vendored, same origin: no runtime CDN. See assets/duckdb-wasm/README.md.
  const DUCK_DIR = "/assets/duckdb-wasm/";
  const INIT_TIMEOUT_MS = 30000;
  const T0 = performance.now();
  const timings = {};
  const mark = k => { timings[k] = Math.round(performance.now() - T0); };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  /* ---------- the table registry ---------- */
  const KIND = {
    observed: "observed",
    modelled: "modelled descriptive",
    model: "model forecast",
    backtest: "model + market backtest",
    market: "market",
    analyst: "analyst estimate",
  };
  const bySeason = (obj, pick) => Object.keys(obj).sort().flatMap(season =>
    (pick ? pick(obj[season]) : obj[season]).map(r => ({ season: Number(season), ...r })));
  const TABLES = [
    { name: "epa_teams", file: "epa-teams.json", kind: KIND.observed, eager: true,
      note: "Team EPA per play by season, regular season. def_epa_play is EPA ALLOWED: lower is better. 2026 is a partial season.",
      rows: d => bySeason(d.by_season, s => s.teams) },
    { name: "epa_qbs", file: "epa-teams.json", kind: KIND.observed, eager: true,
      note: "QB aggregates by season (per-season dropback minimum; 2026 prorated).",
      rows: d => bySeason(d.by_season, s => s.qbs) },
    { name: "epa_players", file: "epa-players.json", kind: KIND.observed, eager: true,
      note: "Primary ball handler per play (passer on a dropback, carrier on a rush). No receiving EPA.",
      rows: d => bySeason(d.by_season) },
    { name: "nfelo_ratings", file: "nfelo.json", kind: KIND.model, eager: true,
      note: "Current nfelo team ratings: base, qb adjustment, nfelo, pts.",
      rows: d => d.ratings },
    { name: "nfelo_backtest", file: "nfelo.json", kind: KIND.backtest, eager: true,
      note: "Straight-up accuracy by season, 2009-2025: nfelo vs the market. Overlaps nfelo's own optimisation window (in-sample-ish).",
      rows: d => d.seasons },
    { name: "nfl_schedule", file: "nfl-schedule.json", kind: KIND.observed, eager: true,
      note: "2026 schedule and results. Scores are null until a game is final.",
      rows: d => d.games },
    { name: "receipts", file: "receipts.json", kind: KIND.model, eager: true,
      note: "Pre-registered nfelo calls locked 2026-08-06 (p = home win probability). mk is the file's market benchmark where one was carried at lock (51 of 272 rows); null otherwise.",
      rows: d => d },
    { name: "classic_forecasts", file: "538-classic.json", kind: KIND.model, eager: true,
      note: "538 Classic Elo reimplementation: forecasts for games not yet played.",
      rows: d => d.forecasts },
    { name: "classic_teams", file: "538-classic.json", kind: KIND.model, eager: true,
      note: "538 Classic Elo team ratings.", rows: d => d.teams },
    { name: "cfb_efficiency", file: "cfb-efficiency.json", kind: KIND.modelled, eager: true,
      note: "FBS 2025 season team efficiency (cfbfastR). adjusted_* are opponent-adjusted upstream; *_allowed: lower is better.",
      rows: d => d.teams },
    { name: "cfb_teams", file: "cfb-teams.json", kind: KIND.observed, eager: true,
      note: "2025 observed results plus one retrodictive Elo (systems_dd_cfb_elo_*). Not a 2026 forecast.",
      rows: d => d.teams },
    { name: "pool", file: "pool.json", kind: KIND.market, eager: true,
      note: "Player pool, Market Value (MV) auction dollars captured 2026-08-24. MV is dollars, not a points projection. rank = overall rank in this snapshot (no ADP field is published).",
      drop: ["silva"], rows: d => d },
    { name: "dynasty_ranks", file: "dynasty-ranks.json", kind: KIND.analyst, eager: true,
      note: "Independent research ranking: analyst estimates, not observed prices or projections.",
      rows: d => d },
    { name: "cfb_market", file: "cfb-market.json", kind: KIND.market, eager: false,
      note: "2025 CFB historical market medians (devigged). Loaded on first use (1.1 MB). The per-book list is not loaded.",
      drop: ["books"], rows: d => d.games },
    { name: "model_receipts", file: "model-receipts.json", kind: KIND.model, eager: false,
      note: "Append-only multi-model receipt ledger, one row per model per game. Loaded on first use (1.4 MB).",
      rows: d => d },
  ];
  const TABLE = Object.fromEntries(TABLES.map(t => [t.name, t]));

  /* ---------- starter queries ----------
     Every starter names only columns that exist in the files above. The one question
     the brief asked for that the public data cannot answer is listed, disabled, with
     the reason — not approximated. */
  const STARTERS = [
    { id: "epa-top-2325", title: "Top 10 offenses by EPA/play, 2023–25",
      chart: { type: "hbar", x: "team", y: "off_epa_play_mean_2023_25" },
      sql: `-- Observed. Unweighted mean of the three season rates (not a pooled per-play rate).
SELECT team,
       ROUND(AVG(off_epa_play), 4) AS off_epa_play_mean_2023_25,
       COUNT(*) AS seasons
FROM epa_teams
WHERE season BETWEEN 2023 AND 2025
GROUP BY team
ORDER BY off_epa_play_mean_2023_25 DESC
LIMIT 10;` },
    { id: "epa-improvers", title: "Biggest offensive EPA/play improvers, 2024 → 2025",
      chart: { type: "hbar", x: "team", y: "change" },
      sql: `-- Observed. Team EPA is unstable year to year: this describes, it does not project.
SELECT a.team,
       a.off_epa_play AS off_epa_play_2024,
       b.off_epa_play AS off_epa_play_2025,
       ROUND(b.off_epa_play - a.off_epa_play, 4) AS change
FROM epa_teams a
JOIN epa_teams b ON b.team = a.team AND a.season = 2024 AND b.season = 2025
ORDER BY change DESC
LIMIT 10;` },
    { id: "epa-2026", title: "2026 so far: offense vs defense EPA/play",
      chart: { type: "scatter", x: "off_epa_play", y: "def_epa_play", label: "team" },
      sql: `-- Observed, PARTIAL season (see the file's coverage note). def_epa_play is EPA allowed: lower is better.
SELECT team, plays, off_epa_play, def_epa_play
FROM epa_teams
WHERE season = 2026
ORDER BY off_epa_play DESC;` },
    { id: "qb-2025", title: "QBs by EPA per dropback, 2025",
      chart: { type: "hbar", x: "player", y: "epa_per_dropback" },
      sql: `-- Observed. The file applies a 200-dropback minimum per season.
SELECT player, team, dropbacks, epa_per_dropback, cpoe
FROM epa_qbs
WHERE season = 2025
ORDER BY epa_per_dropback DESC
LIMIT 15;` },
    { id: "rush-2025", title: "Ball carriers by EPA per rush, 2025 (75+ rushes)",
      chart: { type: "hbar", x: "player", y: "epa_per_rush" },
      sql: `-- Observed. Primary-ball-handler attribution; no receiving EPA exists in the file.
SELECT player, team, rushes, epa_per_rush, rush_success
FROM epa_players
WHERE season = 2025 AND rushes >= 75
ORDER BY epa_per_rush DESC
LIMIT 15;` },
    { id: "nfelo-now", title: "nfelo ratings now (base + QB adjustment)",
      chart: { type: "bar", x: "team", y: "nfelo" },
      sql: `-- Model. nfelo = base + qb (Elo points); pts is the file's point-scale rating.
SELECT team, base, qb, nfelo, pts
FROM nfelo_ratings
ORDER BY nfelo DESC;` },
    { id: "nfelo-mkt-backtest", title: "nfelo vs market: straight-up accuracy by season (backtest)",
      chart: { type: "line", x: "season", y: "nfelo_minus_mkt" },
      sql: `-- Model + market BACKTEST, 2009-2025. In-sample-ish: overlaps nfelo's optimisation window.
-- nfelo and mkt are the file's straight-up hit rates. Not a forecast, not betting advice.
SELECT season, n,
       ROUND(nfelo, 4) AS nfelo_su,
       ROUND(mkt, 4) AS mkt_su,
       ROUND(nfelo - mkt, 4) AS nfelo_minus_mkt
FROM nfelo_backtest
ORDER BY season;` },
    { id: "model-gap", title: "Where the two registered models disagree: nfelo receipt vs 538 Classic",
      chart: { type: "hbar", x: "game", y: "gap" },
      sql: `-- Model vs model. receipts.p was locked 2026-08-06; classic_forecasts is the current 538 Classic state.
-- Different capture times: the gap mixes model differences with five weeks of results.
SELECT r.id AS game_id, r.wk AS week, r.a || ' @ ' || r.h AS game,
       r.p AS nfelo_locked_p_home,
       ROUND(c.home_win_probability, 4) AS classic_p_home,
       ROUND(r.p - c.home_win_probability, 4) AS gap
FROM receipts r
JOIN classic_forecasts c ON c.game_id = r.id
ORDER BY ABS(gap) DESC
LIMIT 15;` },
    { id: "cfb-net", title: "CFB adjusted net EPA/play leaders, 2025",
      chart: { type: "hbar", x: "team", y: "adjusted_net_epa_play" },
      sql: `-- Modelled descriptive (cfbfastR, opponent-adjusted upstream). A season description, not a forecast.
SELECT team, conference, games, plays,
       adjusted_net_epa_play, adjusted_off_epa_play, adjusted_def_epa_play_allowed
FROM cfb_efficiency
ORDER BY adjusted_net_epa_play DESC
LIMIT 15;` },
    { id: "pool-pos", title: "Player pool by position: count and Market Value",
      chart: { type: "bar", x: "pos", y: "players" },
      sql: `-- Market Value (MV) auction dollars, 12-team half PPR column, captured 2026-08-24.
-- The file publishes no ADP; best_rank is the snapshot's own overall rank.
SELECT pos,
       COUNT(*) AS players,
       ROUND(AVG(half), 1) AS avg_half_mv,
       MAX(half) AS top_half_mv,
       MIN(rank) AS best_rank
FROM pool
GROUP BY pos
ORDER BY players DESC;` },
    { id: "nfl-results", title: "2026 results so far: average home margin by week",
      chart: { type: "line", x: "week", y: "avg_home_margin" },
      sql: `-- Observed. Unplayed games have NULL scores and drop out of the averages; they are not zeros.
SELECT week,
       COUNT(*) AS games,
       COUNT(home_score) AS finals,
       ROUND(AVG(home_score - away_score), 2) AS avg_home_margin
FROM nfl_schedule
GROUP BY week
HAVING COUNT(home_score) > 0
ORDER BY week;` },
    { id: "nfelo-closing", title: "Where does nfelo disagree most with the closing market?",
      unavailable: "Not in the public data. No /data file publishes an independent closing line per 2026 game. " +
        "receipts.mk is a benchmark carried at the 2026-08-06 lock for 51 of 272 games, not a close. " +
        "survivor.json's mk is labelled mk_src = \"nfelo-mirror\" with mk_book null — it is read from nfelo's own output, not a book. " +
        "What IS available: the 2009-2025 straight-up backtest (nfelo_backtest) and nfelo vs 538 Classic (model vs model). " +
        "Open question for Kap." },
  ];

  /* ---------- reshape helpers ---------- */
  function flatten(row, drop) {
    const out = {};
    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        if (!prefix && drop && drop.includes(k)) continue;
        const key = (prefix ? prefix + "_" : "") + k.replace(/[^A-Za-z0-9_]/g, "_");
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
        else if (Array.isArray(v)) out[key] = v.every(x => x === null || typeof x !== "object") ? v.join(", ") : JSON.stringify(v);
        else {
          if (key in out) throw new Error("column collision: " + key);
          out[key] = v === undefined ? null : v;
        }
      }
    };
    walk(row, "");
    return out;
  }
  const fileCache = new Map();
  function fetchFile(file) {
    if (!fileCache.has(file)) fileCache.set(file, fetch("data/" + file).then(r => {
      if (!r.ok) throw new Error(file + " HTTP " + r.status);
      return r.json();
    }).then(env => {
      if (!env.as_of || !env.source) throw new Error(file + " has no as_of/source envelope");
      return env;
    }));
    return fileCache.get(file);
  }
  async function tableRows(t) {
    const env = await fetchFile(t.file);
    const raw = t.rows(env.data) || [];
    // Union of keys so a field missing on some rows becomes NULL, never a guessed value.
    const rows = raw.map(r => flatten(r, t.drop));
    const cols = [];
    const seen = new Set();
    for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    const full = rows.map(r => Object.fromEntries(cols.map(c => [c, c in r ? r[c] : null])));
    t.meta = { file: t.file, as_of: env.as_of, source: env.source, tier: env.tier, graded: env.graded,
               url: "/data/" + t.file, rows: full.length, columns: cols };
    return full;
  }

  /* ---------- DuckDB ---------- */
  let db = null, conn = null, duck = null;
  const loaded = new Set();
  const state = { mode: "loading", error: null, lastResult: null, tables: TABLES };
  window.DDExplore = { state, timings, tables: TABLE, starters: STARTERS, run: null };

  function withTimeout(p, ms, what) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + " timed out after " + ms / 1000 + "s")), ms); })])
      .finally(() => clearTimeout(t));
  }
  async function initDuck() {
    if (typeof WebAssembly !== "object") throw new Error("this browser has no WebAssembly");
    duck = await import(DUCK_DIR + "duckdb-browser.mjs");
    // Only the eh bundle is vendored. A browser without wasm exception handling gets
    // the plain fallback instead of a second 39 MB mvp download.
    const features = await duck.getPlatformFeatures();
    if (!features.wasmExceptions) throw new Error("this browser lacks WebAssembly exception handling, which the vendored DuckDB bundle needs");
    const bundle = { mainModule: DUCK_DIR + "duckdb-eh.wasm", mainWorker: DUCK_DIR + "duckdb-browser-eh.worker.js", pthreadWorker: null };
    // A blocked or missing .wasm makes instantiate() hang inside the worker rather than
    // reject, so check the asset is reachable first and fall back at once if it is not.
    const probe = await fetch(bundle.mainModule, { method: "HEAD" }).catch(e => ({ ok: false, status: e.message }));
    if (!probe.ok) throw new Error("the DuckDB .wasm could not be fetched (" + probe.status + ")");
    const worker = new Worker(bundle.mainWorker);
    // A failed wasm fetch inside the worker can surface only as a worker error event.
    const workerFailed = new Promise((_, rej) => worker.addEventListener("error", e => rej(new Error("DuckDB worker failed: " + (e.message || "error")))));
    const d = new duck.AsyncDuckDB(new duck.VoidLogger(), worker);
    await Promise.race([d.instantiate(bundle.mainModule, bundle.pthreadWorker), workerFailed]);
    db = d;
    conn = await db.connect();
    await conn.query("SELECT 1");
    state.bundle = bundle.mainModule.split("/").pop();
  }
  async function loadTable(name) {
    if (loaded.has(name)) return;
    const t = TABLE[name];
    const rows = await tableRows(t);
    /* ⚠️ Types are set HERE from the JSON values, not inferred by DuckDB. DuckDB's JSON
       readers either autoload the json extension from extensions.duckdb.org (a runtime
       third-party fetch) or guess, e.g. turning "2026-09-13" into a TIMESTAMP and
       re-printing it. An explicit Arrow table keeps strings as the exact published
       strings, keeps file column order, and keeps null as NULL. */
    const A = duck.arrow, vectors = {};
    for (const c of t.meta.columns) {
      let vals = rows.map(r => r[c]);
      const nn = vals.filter(v => v !== null);
      let type;
      if (!nn.length) type = new A.Utf8();
      else if (nn.every(v => typeof v === "boolean")) type = new A.Bool();
      else if (nn.every(v => typeof v === "number")) type = nn.every(v => Number.isInteger(v) && Math.abs(v) < 2 ** 31) ? new A.Int32() : new A.Float64();
      else { type = new A.Utf8(); vals = vals.map(v => v === null ? null : String(v)); }
      vectors[c] = A.vectorFromArray(vals, type);
    }
    await conn.insertArrowTable(new A.Table(vectors), { name, create: true });
    loaded.add(name);
  }
  const referencedTables = sql => {
    const body = sql.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
    return TABLES.filter(t => new RegExp("\\b" + t.name + "\\b", "i").test(body)).map(t => t.name);
  };
  function cell(v, type) {
    if (v === null || v === undefined) return null;
    if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    const ts = String(type);
    if (/^Timestamp/.test(ts) && typeof v === "number") return new Date(v).toISOString();
    if (/^Date/.test(ts) && typeof v === "number") return new Date(v).toISOString().slice(0, 10);
    if (v && typeof v === "object" && typeof v.toJSON === "function") return v.toJSON();
    return v;
  }
  async function run(sql) {
    if (!conn) throw new Error("DuckDB is not ready");
    const names = referencedTables(sql);
    for (const n of names) await loadTable(n);
    const t0 = performance.now();
    const res = await conn.query(sql);
    const ms = performance.now() - t0;
    const fields = res.schema.fields;
    const columns = fields.map(f => f.name);
    const rows = [];
    for (let i = 0; i < res.numRows; i++) {
      const r = res.get(i);
      rows.push(Object.fromEntries(fields.map(f => [f.name, cell(r[f.name], f.type)])));
    }
    const types = Object.fromEntries(fields.map(f => [f.name, String(f.type)]));
    const sources = names.map(n => ({ table: n, kind: TABLE[n].kind, ...TABLE[n].meta }));
    const out = { sql, columns, types, rows, ms: Math.round(ms * 10) / 10, sources };
    state.lastResult = out;
    if (!timings.first_result) mark("first_result");
    return out;
  }
  window.DDExplore.run = run;

  /* ---------- citation ---------- */
  const citeLine = s => `${s.url} · as_of ${s.as_of} · ${s.kind}${s.graded === false ? " · ungraded" : ""}`;
  function citeHtml(sources) {
    if (!sources.length) return '<p class="dx-cite-none">This query reads no /data table, so it has nothing to cite.</p>';
    return "<ul>" + sources.map(s => `<li><b>${esc(s.table)}</b> ← <a href="${esc(s.url)}">${esc(s.url)}</a> · <b>as_of ${esc(s.as_of)}</b> · <span class="dx-kind">${esc(s.kind)}</span>${s.graded === false ? " · ungraded" : ""}<br><small>${esc(s.source)}</small></li>`).join("") + "</ul>";
  }

  /* ---------- results table ---------- */
  const fmt = v => v === null ? '<span class="dx-null">null</span>'
    : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6))) : esc(v);
  let sortState = { col: null, dir: 1 };
  function renderResult(res) {
    const rows = res.rows.slice();
    if (sortState.col && res.columns.includes(sortState.col)) {
      const c = sortState.col, d = sortState.dir;
      rows.sort((a, b) => (a[c] === null) - (b[c] === null) || (a[c] < b[c] ? -d : a[c] > b[c] ? d : 0));
    }
    const shown = rows.slice(0, 1000);
    $("dx-meta").textContent = `${res.rows.length} row${res.rows.length === 1 ? "" : "s"} · ${res.ms} ms in DuckDB-Wasm${res.rows.length > 1000 ? " · showing the first 1,000 (exports carry all)" : ""}`;
    $("dx-cite").innerHTML = citeHtml(res.sources);
    $("dx-table").innerHTML = "<thead><tr>" + res.columns.map(c => `<th scope="col"><button type="button" data-col="${esc(c)}">${esc(c)}${sortState.col === c ? (sortState.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("") + "</tr></thead><tbody>" +
      shown.map(r => "<tr>" + res.columns.map(c => `<td class="${typeof r[c] === "number" ? "num" : ""}">${fmt(r[c])}</td>`).join("") + "</tr>").join("") + "</tbody>";
    $("dx-table").querySelectorAll("th button").forEach(b => b.addEventListener("click", () => {
      sortState = { col: b.dataset.col, dir: sortState.col === b.dataset.col ? -sortState.dir : 1 };
      renderResult(res);
    }));
    $("dx-results").hidden = false;
  }

  /* ---------- exports ---------- */
  const csvCell = v => v === null || v === undefined ? "" : /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const toCsv = res => [res.columns.map(csvCell).join(","), ...res.rows.map(r => res.columns.map(c => csvCell(r[c])).join(","))].join("\n") + "\n";
  const stamp = res => res.sources.length ? res.sources.map(s => s.table + "_" + s.as_of).join("__") : "query";
  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportCsv(withCitation) {
    const res = state.lastResult; if (!res) return;
    let text = toCsv(res);
    if (withCitation) text = ["# Data Dawgs Data Explorer (Pup) — " + location.origin + "/explore.html",
      ...res.sources.map(s => "# source: " + citeLine(s)), "# query: " + res.sql.replace(/\s+/g, " ").trim(), ""].join("\n") + text;
    download(`datadawgs-${stamp(res)}${withCitation ? "-cited" : ""}.csv`, new Blob([text], { type: "text/csv" }));
  }
  function exportJson() {
    const res = state.lastResult; if (!res) return;
    const body = { generated_by: "Data Dawgs Data Explorer (Pup)", page: location.origin + "/explore.html",
      query: res.sql, sources: res.sources.map(s => ({ table: s.table, url: s.url, as_of: s.as_of, source: s.source, kind: s.kind })),
      columns: res.columns, rows: res.rows };
    download(`datadawgs-${stamp(res)}.json`, new Blob([JSON.stringify(body, null, 1)], { type: "application/json" }));
  }

  /* ---------- share URL (hash, so no server ever sees the query) ---------- */
  const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
  function shareUrl() {
    const payload = { sql: $("dx-sql").value, chart: chartConfig() };
    return location.origin + location.pathname + "#q=" + b64u(JSON.stringify(payload));
  }
  function readShare() {
    const m = /[#&]q=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    try { const p = JSON.parse(unb64u(m[1])); return typeof p.sql === "string" ? p : null; } catch { return null; }
  }

  /* ---------- chart builder (canvas, no dependency) ---------- */
  const PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999"]; // Okabe-Ito
  const CHART_TYPES = { bar: "Sorted bar", hbar: "Horizontal bar", line: "Line", scatter: "Scatter", table: "Table" };
  function chartConfig() {
    return { type: $("dx-ctype").value, x: $("dx-cx").value, y: $("dx-cy").value, label: $("dx-clabel").value, title: $("dx-ctitle").value };
  }
  const isNum = (res, c) => res.rows.some(r => typeof r[c] === "number") && res.rows.every(r => r[c] === null || typeof r[c] === "number");
  function fillChartControls(res, preset) {
    const nums = res.columns.filter(c => isNum(res, c));
    const cats = res.columns.filter(c => !nums.includes(c));
    const opt = (cols, sel) => cols.map(c => `<option${c === sel ? " selected" : ""}>${esc(c)}</option>`).join("");
    const p = preset || {};
    const type = p.type && CHART_TYPES[p.type] ? p.type : (cats.length ? "hbar" : "scatter");
    $("dx-ctype").value = type;
    const x = res.columns.includes(p.x) ? p.x : (type === "scatter" ? nums[0] : cats[0] || res.columns[0]);
    const y = res.columns.includes(p.y) ? p.y : (nums.find(c => c !== x) || nums[0] || res.columns[0]);
    $("dx-cx").innerHTML = opt(res.columns, x);
    $("dx-cy").innerHTML = opt(res.columns, y);
    $("dx-clabel").innerHTML = '<option value="">(none)</option>' + opt(res.columns, p.label);
    $("dx-ctitle").value = p.title || "";
  }
  function niceTicks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo, step0 = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  const tickFmt = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(+v.toPrecision(4));
  function drawChart(canvas, cfg, res, scale) {
    const W = 1200, H = 760, s = scale || 2;
    canvas.width = W * s; canvas.height = H * s;
    const g = canvas.getContext("2d");
    g.setTransform(s, 0, 0, s, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (v, f) => (css.getPropertyValue(v) || "").trim() || f;
    const bg = col("--surface-1", "#241c12"), ink = col("--ink-1", "#f5f1ea"), ink2 = col("--ink-2", "#c8c1b4"), ink3 = col("--ink-3", "#8f897d"), accent = col("--accent", "#ff6a02");
    const grid = "rgba(128,128,128,.22)";
    const FONT = "Trebuchet MS, system-ui, sans-serif", MONO = "ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const title = cfg.title || (cfg.type === "table" ? "Query result" : `${cfg.y} by ${cfg.x}`);
    g.fillStyle = ink; g.font = `800 30px ${FONT}`; g.textBaseline = "top";
    g.fillText(title.slice(0, 70), 40, 32);
    g.fillStyle = ink3; g.font = `600 15px ${FONT}`;
    g.fillText(`${CHART_TYPES[cfg.type]} · ${res.rows.length} rows · Data Dawgs Data Explorer (Pup)`, 40, 72);
    // footer: sources + query, always
    const foot = [];
    for (const src of res.sources) foot.push("Source: " + citeLine(src));
    if (!res.sources.length) foot.push("Source: no /data table referenced");
    const q = res.sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
    foot.push("Query: " + (q.length > 128 ? q.slice(0, 125) + "…" : q));
    foot.push("datadawgs216.com/explore.html · pure query over public files · not betting advice");
    const footH = 22 * foot.length + 24;
    g.font = `500 13px ${MONO}`; g.fillStyle = ink2;
    foot.forEach((line, i) => g.fillText(line.length > 134 ? line.slice(0, 133) + "…" : line, 40, H - footH + 12 + i * 22));
    g.strokeStyle = grid; g.beginPath(); g.moveTo(40, H - footH); g.lineTo(W - 40, H - footH); g.stroke();
    const top = 110, bottom = H - footH - 20;
    const notes = [];
    const plot = { l: 40, r: W - 40, t: top, b: bottom };

    if (cfg.type === "table") {
      const cols = res.columns.slice(0, 7), rows = res.rows.slice(0, 20);
      const cw = (plot.r - plot.l) / cols.length, rh = Math.min(28, (plot.b - plot.t) / (rows.length + 1));
      g.font = `700 14px ${FONT}`; g.fillStyle = accent;
      cols.forEach((c, i) => g.fillText(c.slice(0, 22), plot.l + i * cw, plot.t));
      g.font = `500 14px ${MONO}`;
      rows.forEach((r, j) => cols.forEach((c, i) => {
        const v = r[c]; g.fillStyle = v === null ? ink3 : ink;
        const t = v === null ? "null" : typeof v === "number" ? String(+v.toPrecision(5)) : String(v);
        g.fillText(t.slice(0, 22), plot.l + i * cw, plot.t + (j + 1) * rh);
      }));
      if (res.rows.length > 20 || res.columns.length > 7) notes.push(`first ${rows.length} rows × ${cols.length} columns shown`);
    } else {
      const xNum = isNum(res, cfg.x), yNum = isNum(res, cfg.y);
      if (!yNum) { g.fillStyle = ink2; g.font = `600 18px ${FONT}`; g.fillText(`"${cfg.y}" is not numeric — pick a numeric Y column.`, plot.l, plot.t + 20); return; }
      let pts = res.rows.map(r => ({ x: r[cfg.x], y: r[cfg.y], label: cfg.label ? r[cfg.label] : null }));
      const nulls = pts.filter(p => p.y === null || p.x === null).length;
      pts = pts.filter(p => p.y !== null && p.x !== null);
      if (nulls) notes.push(`${nulls} row${nulls === 1 ? "" : "s"} with a null value omitted (null is not zero)`);
      if (cfg.type === "bar" || cfg.type === "hbar") {
        pts.sort((a, b) => b.y - a.y);
        if (pts.length > 40) { notes.push(`top 40 of ${pts.length} shown`); pts = pts.slice(0, 40); }
        const lo = Math.min(0, ...pts.map(p => p.y)), hi = Math.max(0, ...pts.map(p => p.y));
        const ticks = niceTicks(lo, hi, 6), tlo = Math.min(lo, ticks[0]), thi = Math.max(hi, ticks[ticks.length - 1]);
        g.font = `500 13px ${FONT}`;
        if (cfg.type === "hbar") {
          const labW = Math.min(260, Math.max(...pts.map(p => g.measureText(String(p.x)).width)) + 16);
          const L = plot.l + labW, R = plot.r - 80, sx = v => L + (v - tlo) / (thi - tlo) * (R - L);
          const bh = (plot.b - plot.t - 24) / pts.length;
          ticks.forEach(t => { g.strokeStyle = grid; g.beginPath(); g.moveTo(sx(t), plot.t); g.lineTo(sx(t), plot.b - 20); g.stroke(); g.fillStyle = ink3; g.fillText(tickFmt(t), sx(t) - 10, plot.b - 14); });
          pts.forEach((p, i) => {
            const y = plot.t + i * bh, x0 = sx(0), x1 = sx(p.y);
            g.fillStyle = p.y >= 0 ? PALETTE[0] : PALETTE[4];
            g.fillRect(Math.min(x0, x1), y + bh * .15, Math.abs(x1 - x0), bh * .7);
            g.fillStyle = ink; g.textBaseline = "middle"; g.font = `600 ${Math.min(14, bh * .6)}px ${FONT}`;
            g.textAlign = "right"; g.fillText(String(p.x).slice(0, 34), L - 8, y + bh / 2);
            g.textAlign = "left"; g.font = `500 ${Math.min(13, bh * .6)}px ${MONO}`; g.fillStyle = ink2;
            g.fillText(tickFmt(p.y), Math.max(x0, x1) + 6, y + bh / 2);
          });
          g.textAlign = "left"; g.textBaseline = "top";
        } else {
          const L = plot.l + 60, R = plot.r, B = plot.b - 60, sy = v => B - (v - tlo) / (thi - tlo) * (B - plot.t);
          const bw = (R - L) / pts.length;
          ticks.forEach(t => { g.strokeStyle = grid; g.beginPath(); g.moveTo(L, sy(t)); g.lineTo(R, sy(t)); g.stroke(); g.fillStyle = ink3; g.textAlign = "right"; g.fillText(tickFmt(t), L - 8, sy(t) - 7); });
          g.textAlign = "left";
          pts.forEach((p, i) => {
            const x = L + i * bw, y0 = sy(0), y1 = sy(p.y);
            g.fillStyle = p.y >= 0 ? PALETTE[0] : PALETTE[4];
            g.fillRect(x + bw * .12, Math.min(y0, y1), bw * .76, Math.abs(y1 - y0));
            g.save(); g.translate(x + bw / 2, B + 8); g.rotate(pts.length > 12 ? -Math.PI / 4 : 0);
            g.fillStyle = ink; g.font = `600 ${Math.min(13, bw * .8)}px ${FONT}`; g.textAlign = pts.length > 12 ? "right" : "center";
            g.fillText(String(p.x).slice(0, 18), 0, 0); g.restore();
          });
        }
      } else {
        // line + scatter: numeric X required for scale; categorical X keeps row order.
        const xs = xNum ? pts.map(p => p.x) : pts.map((_, i) => i);
        if (cfg.type === "line" && xNum) pts.sort((a, b) => a.x - b.x);
        const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...pts.map(p => p.y)), yhi = Math.max(...pts.map(p => p.y));
        const xt = xNum ? niceTicks(xlo, xhi, 8) : [], yt = niceTicks(ylo, yhi, 6);
        const X0 = xNum ? Math.min(xlo, xt[0]) : xlo, X1 = xNum ? Math.max(xhi, xt[xt.length - 1]) : xhi;
        const Y0 = Math.min(ylo, yt[0]), Y1 = Math.max(yhi, yt[yt.length - 1]);
        const L = plot.l + 70, R = plot.r - 20, B = plot.b - 40;
        const sx = v => L + (X1 === X0 ? .5 : (v - X0) / (X1 - X0)) * (R - L), sy = v => B - (Y1 === Y0 ? .5 : (v - Y0) / (Y1 - Y0)) * (B - plot.t);
        g.font = `500 13px ${FONT}`;
        yt.forEach(t => { g.strokeStyle = grid; g.beginPath(); g.moveTo(L, sy(t)); g.lineTo(R, sy(t)); g.stroke(); g.fillStyle = ink3; g.textAlign = "right"; g.fillText(tickFmt(t), L - 8, sy(t) - 7); });
        g.textAlign = "center";
        if (xNum) xt.forEach(t => { g.fillStyle = ink3; g.fillText(tickFmt(t), sx(t), B + 8); });
        else pts.forEach((p, i) => { if (pts.length <= 20) { g.fillStyle = ink3; g.fillText(String(p.x).slice(0, 12), sx(i), B + 8); } });
        g.fillStyle = ink2; g.font = `700 14px ${FONT}`;
        g.fillText(cfg.x, (L + R) / 2, B + 28); g.save(); g.translate(plot.l + 12, (plot.t + B) / 2); g.rotate(-Math.PI / 2); g.fillText(cfg.y, 0, 0); g.restore();
        g.textAlign = "left";
        const P = pts.map((p, i) => [sx(xNum ? p.x : i), sy(p.y), p]);
        if (cfg.type === "line") {
          g.strokeStyle = PALETTE[0]; g.lineWidth = 3; g.beginPath();
          P.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.lineWidth = 1;
          if (Y0 < 0 && Y1 > 0) { g.strokeStyle = ink3; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(L, sy(0)); g.lineTo(R, sy(0)); g.stroke(); g.setLineDash([]); }
        }
        P.forEach(([x, y, p]) => {
          g.fillStyle = PALETTE[cfg.type === "line" ? 0 : 1]; g.beginPath(); g.arc(x, y, cfg.type === "line" ? 4 : 6, 0, Math.PI * 2); g.fill();
          if (p.label !== null && p.label !== undefined && P.length <= 60) { g.fillStyle = ink; g.font = `600 12px ${FONT}`; g.fillText(String(p.label).slice(0, 16), x + 8, y - 6); }
        });
      }
    }
    if (notes.length) { g.fillStyle = ink3; g.font = `italic 500 13px ${FONT}`; g.textAlign = "right"; g.fillText(notes.join(" · "), W - 40, 72); g.textAlign = "left"; }
  }
  function renderChart() {
    const res = state.lastResult; if (!res) return;
    drawChart($("dx-canvas"), chartConfig(), res, 2);
    $("dx-chart").hidden = false;
  }

  /* ---------- schema browser + completion ---------- */
  function renderSchema() {
    $("dx-schema").innerHTML = TABLES.map(t => {
      const m = t.meta;
      return `<details class="dx-tbl"><summary><code>${t.name}</code> <span class="dx-kind">${esc(t.kind)}</span>${m ? ` <small>${m.rows} rows · as_of ${esc(m.as_of)}</small>` : ` <small>loads on first use</small>`}</summary>
        <p><a href="/data/${esc(t.file)}">/data/${esc(t.file)}</a> — ${esc(t.note)}${t.drop ? ` <em>Not loaded: ${esc(t.drop.join(", "))}.</em>` : ""}</p>
        ${m ? `<p class="dx-cols">${m.columns.map(c => `<button type="button" data-ins="${esc(c)}">${esc(c)}</button>`).join(" ")}</p>` : ""}
        <p><button type="button" data-ins="${t.name}">insert table name</button></p></details>`;
    }).join("");
    $("dx-schema").querySelectorAll("[data-ins]").forEach(b => b.addEventListener("click", () => insertAtCaret(b.dataset.ins)));
  }
  function insertAtCaret(text) {
    const ta = $("dx-sql"), a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length; ta.focus();
  }
  function completions(prefix) {
    const words = new Set(TABLES.map(t => t.name));
    for (const t of TABLES) if (t.meta) t.meta.columns.forEach(c => words.add(c));
    return [...words].filter(w => w.toLowerCase().startsWith(prefix.toLowerCase()) && w !== prefix).sort();
  }
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runFromEditor(); return; }
    if (e.key !== "Tab" || e.shiftKey) return;
    const ta = e.target, pos = ta.selectionStart, m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(ta.value.slice(0, pos));
    if (!m) return; // plain Tab moves focus — the editor never traps the keyboard
    const c = completions(m[0]);
    if (!c.length) return;
    e.preventDefault();
    let common = c[0];
    for (const w of c) while (!w.startsWith(common)) common = common.slice(0, -1);
    const add = (c.length === 1 ? c[0] : common).slice(m[0].length);
    if (add) insertAtCaret(add);
    $("dx-hint").textContent = c.length > 1 ? "Matches: " + c.slice(0, 12).join(", ") + (c.length > 12 ? " …" : "") : "";
  }

  /* ---------- wiring ---------- */
  function setStatus(text, bad) { const el = $("dx-status"); el.textContent = text; el.classList.toggle("bad", !!bad); }
  let pendingChart = null;
  async function runFromEditor() {
    const sql = $("dx-sql").value.trim(); if (!sql) return;
    $("dx-run").disabled = true; setStatus("Running…");
    try {
      const res = await run(sql);
      sortState = { col: null, dir: 1 };
      renderResult(res);
      fillChartControls(res, pendingChart); pendingChart = null;
      renderChart();
      renderSchema();
      setStatus(`Ready · DuckDB-Wasm ${DUCKDB_VERSION} (${state.bundle}) · ${loaded.size} tables loaded`);
      $("dx-error").hidden = true;
    } catch (e) {
      $("dx-error").textContent = "Query error: " + e.message; $("dx-error").hidden = false;
      setStatus("Query failed — the error is below the editor.", true);
    } finally { $("dx-run").disabled = false; }
  }
  function renderStarters() {
    $("dx-starters").innerHTML = STARTERS.map(s => s.unavailable
      ? `<li class="dx-unavail"><button type="button" disabled aria-describedby="dx-un-${s.id}">${esc(s.title)}</button><small id="dx-un-${s.id}"><b>Unavailable.</b> ${esc(s.unavailable)}</small></li>`
      : `<li><button type="button" data-starter="${s.id}">${esc(s.title)}</button></li>`).join("");
    $("dx-starters").querySelectorAll("[data-starter]").forEach(b => b.addEventListener("click", () => {
      const s = STARTERS.find(x => x.id === b.dataset.starter);
      $("dx-sql").value = s.sql; pendingChart = { ...s.chart, title: s.title };
      if (state.mode === "ready") runFromEditor();
    }));
  }

  /* ---------- fallback: no wasm, still useful ---------- */
  async function fallback(err) {
    state.mode = "fallback"; state.error = String(err && err.message || err);
    $("dx-app").hidden = true; $("dx-fallback").hidden = false;
    $("dx-fb-why").textContent = state.error;
    setStatus("DuckDB-Wasm could not load — showing the plain fallback.", true);
    const list = [];
    for (const t of TABLES) {
      try { await tableRows(t); list.push(t); } catch (e) { list.push(Object.assign({}, t, { failed: e.message })); }
    }
    $("dx-fb-files").innerHTML = list.map(t => t.failed
      ? `<li><code>${t.name}</code> — <a href="/data/${esc(t.file)}">/data/${esc(t.file)}</a> (could not read: ${esc(t.failed)})</li>`
      : `<li><code>${t.name}</code> — <a href="/data/${esc(t.file)}">/data/${esc(t.file)}</a> · as_of ${esc(t.meta.as_of)} · ${esc(t.kind)} · ${t.meta.rows} rows <button type="button" data-peek="${t.name}">preview</button></li>`).join("");
    $("dx-fb-files").querySelectorAll("[data-peek]").forEach(b => b.addEventListener("click", async () => {
      const t = TABLE[b.dataset.peek], rows = await tableRows(t);
      const res = { sql: "(preview, first 50 rows — no SQL)", columns: t.meta.columns, rows: rows.slice(0, 50), ms: 0, sources: [{ table: t.name, kind: t.kind, ...t.meta }] };
      state.lastResult = res; renderResult(res);
      $("dx-meta").textContent = `Preview: first ${res.rows.length} of ${t.meta.rows} rows, straight from the file (no SQL).`;
      $("dx-results").hidden = false; $("dx-fallback").appendChild($("dx-results"));
    }));
    // A static example chart, computed in plain JS from the same file — no SQL engine.
    try {
      const t = TABLE.epa_teams, rows = await tableRows(t);
      const yr = Math.max(...rows.filter(r => r.season < 2026).map(r => r.season));
      const top = rows.filter(r => r.season === yr).sort((a, b) => b.off_epa_play - a.off_epa_play).slice(0, 10)
        .map(r => ({ team: r.team, off_epa_play: r.off_epa_play }));
      const res = { sql: `static example: ${yr} epa_teams sorted by off_epa_play, top 10 (plain JS, no SQL)`, columns: ["team", "off_epa_play"], rows: top, ms: 0, sources: [{ table: t.name, kind: t.kind, ...t.meta }] };
      drawChart($("dx-fb-canvas"), { type: "hbar", x: "team", y: "off_epa_play", title: `Top 10 offenses by EPA/play, ${yr} (static example)` }, res, 1.5);
      $("dx-fb-chart-cap").textContent = "Source: " + citeLine(res.sources[0]);
    } catch (e) { $("dx-fb-chart-cap").textContent = "The example chart could not be drawn: " + e.message; }
    mark("fallback_ready");
  }

  async function boot() {
    renderStarters();
    const shared = readShare();
    $("dx-sql").value = shared ? shared.sql : STARTERS[0].sql;
    pendingChart = shared ? shared.chart : { ...STARTERS[0].chart, title: STARTERS[0].title };
    $("dx-sql").addEventListener("keydown", onKey);
    $("dx-run").addEventListener("click", runFromEditor);
    $("dx-csv").addEventListener("click", () => exportCsv(false));
    $("dx-csv-cited").addEventListener("click", () => exportCsv(true));
    $("dx-json").addEventListener("click", exportJson);
    ["dx-ctype", "dx-cx", "dx-cy", "dx-clabel"].forEach(id => $(id).addEventListener("change", renderChart));
    $("dx-ctitle").addEventListener("input", renderChart);
    $("dx-png").addEventListener("click", () => {
      const res = state.lastResult; if (!res) return;
      const c = document.createElement("canvas"); drawChart(c, chartConfig(), res, 2);
      c.toBlob(b => download(`datadawgs-chart-${stamp(res)}.png`, b), "image/png");
    });
    $("dx-share").addEventListener("click", async () => {
      const url = shareUrl(); $("dx-share-out").value = url; $("dx-share-out").hidden = false;
      try { await navigator.clipboard.writeText(url); $("dx-share-msg").textContent = "Copied. The link re-runs this query against the then-current files; check the as_of it shows."; }
      catch { $("dx-share-msg").textContent = "Copy the link above. It re-runs this query against the then-current files."; }
    });
    setStatus("Loading DuckDB-Wasm " + DUCKDB_VERSION + "…");
    try {
      await withTimeout(initDuck(), INIT_TIMEOUT_MS, "DuckDB-Wasm start");
      mark("wasm_ready");
    } catch (e) { return fallback(e); }
    setStatus("DuckDB ready · loading tables…");
    try {
      await Promise.all(TABLES.filter(t => t.eager).map(t => loadTable(t.name)));
      mark("tables_ready");
    } catch (e) { setStatus("A /data file failed to load: " + e.message, true); }
    state.mode = "ready";
    renderSchema();
    $("dx-run").disabled = false;
    await runFromEditor();
  }

  /* Toto's surface. sys carries the limits; ctx is the executed query, its sources and a
     trimmed result — never the editor's unsaved text. */
  window.DD_BOTCTX = {
    label: "Data Explorer", title: "Explain this query",
    chrome: { sub: "Data Explorer · Pup", ph: "Ask about this result…", chips: ["What does this result say?", "Which file and date is this from?", "Suggest a follow-up query"] },
    sys: "You are on the Data Explorer, a Lab/Pup page: DuckDB-Wasm SQL over the public /data JSON files, plus a chart builder. " +
      "It computes NO forecasts and calls no model: every number is a query over a published file. Quote each number with the file and as_of in ctx.sources. " +
      "Keep the kinds separate and labelled: observed, modelled descriptive, model forecast, market, model+market backtest, analyst estimate. Never call a model value observed or a backtest out-of-sample. " +
      "null is missing, never zero. def_epa_play and *_allowed are EPA allowed: lower is better. 2026 EPA is a partial season. " +
      "There is NO public independent closing-market line per 2026 game: receipts.mk is a benchmark carried at the 2026-08-06 lock (51 games) and survivor.json's market column is an nfelo mirror. Do not answer 'nfelo vs the closing market' from either; say it is unavailable. pool.json publishes no ADP. " +
      "For future outcomes give ranges, not point estimates. Nothing here is betting advice. If asked to write SQL, use only the tables and columns in ctx.tables.",
    ctx: () => {
      const r = state.lastResult;
      return JSON.stringify({
        mode: state.mode, error: state.error,
        tables: TABLES.filter(t => t.meta).map(t => ({ name: t.name, file: t.meta.url, as_of: t.meta.as_of, kind: t.kind, columns: t.meta.columns })),
        last: r ? { sql: r.sql, sources: r.sources.map(s => ({ table: s.table, url: s.url, as_of: s.as_of, kind: s.kind })), rows: r.rows.length, sample: r.rows.slice(0, 20) } : null,
      });
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
