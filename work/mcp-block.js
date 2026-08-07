/* ================================== /mcp ================================== */
// The league's remote MCP server. One URL, pasted once into Claude's custom-
// connector box, gives any leaguemate's own Claude READ access to the league:
//
//   https://toto.jkapcar4.workers.dev/mcp/<DAWG_PASS>
//
// ⚠️ The URL IS the credential. Claude's connector UI takes a URL and has no
// field for a custom header, so the passphrase rides in the path. It leaks
// through screenshots and history, and rotating DAWG_PASS re-onboards all 14
// AND breaks the website's Toto/TTS auth (shared secret). Acceptable for a
// fantasy league over read-only data — never to be described as security.
// Header X-Dawg-Pass and Authorization: Bearer are also accepted for clients
// that can send them (Claude Code, Desktop config).
//
// ⚠️ NOTHING WRITES. No fbPut, no fbPatch, no fbDelete, no KV writes anywhere
// in this block — asserted by test against the source. An agent cannot place a
// Bozo leg, edit a draft or grade a week through this endpoint.
//
// Protocol: JSON-RPC 2.0 over Streamable HTTP, STATELESS — every POST is
// self-contained, no session, no SSE. A Worker is not a long-lived process.
// ⚠️ A notification must return 202 with an EMPTY body. notifications/initialized
//   carries no id; replying with an envelope and a null id breaks strict clients
//   during the handshake.
// ⚠️ Tool failures are results with isError:true, not JSON-RPC errors. A protocol
//   error aborts the turn; a tool error is something the model reads and recovers
//   from. "The draft room is empty" is an answer, not a crash.
// ⚠️ This route is matched BEFORE the Origin-gated handlers. Anthropic calls the
//   Worker server-to-server with no Origin; anything consulting ORIGINS would
//   reject it. /mcp carries its own permissive CORS — the URL secret authorises.

const MCP_PROTOS = ["2025-03-26", "2025-06-18", "2026-07-28"];
const MCP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dawg-Pass, Mcp-Session-Id, MCP-Protocol-Version",
};
const SITE = "https://datadawgs216.com";

// Module-scope caches: the pool and the correlation matrix change on deploy, not
// per request. An hour is generous; a Worker isolate rarely lives that long anyway.
let mcpPoolCache = { at: 0, data: null };
let mcpCorrCache = { at: 0, data: null };

function mcpPassOf(request, url) {
  const seg = url.pathname.split("/").filter(Boolean);          // ["mcp", "<pass>"]
  if (seg.length >= 2) { try { return decodeURIComponent(seg.slice(1).join("/")); } catch { return seg.slice(1).join("/"); } }
  const h = request.headers.get("X-Dawg-Pass");
  if (h) return h;
  const a = request.headers.get("Authorization") || "";
  if (a.startsWith("Bearer ")) return a.slice(7);
  return "";
}

const mcpJson = (obj, status) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json", ...MCP_CORS } });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
const rpcOk  = (id, result) => ({ jsonrpc: "2.0", id, result });
const toolText = obj => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }] });
const toolErr  = msg => ({ content: [{ type: "text", text: msg }], isError: true });

async function handleMcp(request, url, env) {
  if (request.method === "OPTIONS") return new Response(null, { headers: MCP_CORS });
  if (request.method === "GET")
    return mcpJson({ name: "data-dawgs", transport: "streamable-http", hint: "POST JSON-RPC 2.0 here." }, 405);
  if (request.method !== "POST") return mcpJson(rpcErr(null, -32600, "POST only"), 405);

  if (!env.DAWG_PASS)
    return mcpJson(rpcErr(null, -32000, "Worker misconfigured: DAWG_PASS secret not set."), 500);
  const pass = mcpPassOf(request, url);
  if (!pass || !timingSafeEqual(pass, env.DAWG_PASS))
    return mcpJson(rpcErr(null, -32001, "unauthorised"), 401);

  let body;
  try { body = await request.json(); }
  catch { return mcpJson(rpcErr(null, -32700, "Parse error"), 400); }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return mcpJson(rpcErr(null, -32600, "Invalid Request"), 400);

  const replies = [];
  for (const m of msgs) {
    const r = await mcpDispatch(m, env);
    if (r !== undefined) replies.push(r);        // notifications contribute nothing
  }
  if (!replies.length) return new Response(null, { status: 202, headers: MCP_CORS });
  return mcpJson(batch ? replies : replies[0]);
}

async function mcpDispatch(m, env) {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string")
    return rpcErr(m && m.id, -32600, "Invalid Request");
  const id = m.id;
  if (id === undefined) return undefined;        // a notification: acknowledge by silence

  switch (m.method) {
    case "initialize": {
      const want = m.params && m.params.protocolVersion;
      // Echo a known protocolVersion; fall back rather than guess forward.
      const proto = MCP_PROTOS.includes(want) ? want : "2025-06-18";
      return rpcOk(id, {
        protocolVersion: proto,
        capabilities: { tools: {} },
        serverInfo: { name: "data-dawgs", version: "1.0.0" },
      });
    }
    case "ping":
      return rpcOk(id, {});
    case "tools/list":
      return rpcOk(id, { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const name = m.params && m.params.name;
      const tool = MCP_TOOLS.find(t => t.name === name);
      if (!tool) return rpcErr(id, -32602, "Unknown tool: " + name);
      try { return rpcOk(id, await tool.run((m.params && m.params.arguments) || {}, env)); }
      catch (e) { return rpcOk(id, toolErr(String((e && e.message) || e))); }
    }
    default:
      return rpcErr(id, -32601, "Method not found: " + m.method);
  }
}

/* ------------------------------- the tools ------------------------------- */
// All read-only. Data comes from the same Firebase paths, KV keys and published
// pages the site itself uses, so the tools cannot drift from what a human sees.

const MCP_NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

const MCP_TOOLS = [
  {
    name: "dd_league_overview",
    description: "Who is in the Data Dawgs Bozo league, what season/week it is on, and whether the current board is open, placed or graded.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      return toolText({
        id: lid, name: lg.name || lid, manager: lg.manager || null,
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        members: memberNames(lg),
        legsIn: Object.keys(lg.picks || {}).length,
      });
    },
  },
  {
    name: "dd_bozo_week",
    description: "The current Bozo board: every leg IN SUBMISSION ORDER (whoever went last saw every other leg first — that is the social point), plus the drawn lever hierarchy once the ticket is placed. Read the caveats field before analysing.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      const lg = await loadLeague(env, lid);
      if (!lg) return toolErr("No such league: " + lid);
      const picks = lg.picks || {};
      const keys = Object.keys(picks);
      if (!keys.length)
        return toolText({ season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open", legs: [], note: "No legs are in yet this week." });
      // ⚠️ SUBMISSION ORDER, not object-key order.
      keys.sort((a, b) => (picks[a].ts || 0) - (picks[b].ts || 0));
      const legs = keys.map((k, i) => {
        const x = picks[k];
        return {
          order: i + 1, player: playerName(k),
          sport: x.sport, game: x.game, eventId: x.eventId,
          mkt: x.mkt, side: x.side, line: x.mkt === "ml" ? null : x.line,
          price: x.price, priceSource: x.priceSource || "self",
          label: x.label, prop: x.prop || null, ts: x.ts || null,
        };
      });
      return toolText({
        season: lg.season || SEASON, week: lg.week || 1, status: lg.status || "open",
        band: bandOf(lg), legs,
        leverHierarchy: lg.order || null,
        results: lg.results || null, bozo: lg.bozo || null, bozoWhy: lg.bozoWhy || null,
        caveats: [
          "Bozo odds anywhere on the site are simulation output, not market prices.",
          "The simulator draws legs independently; correlated legs (same game, same side of a number) must be flagged by the reader.",
          "The lever hierarchy is a server-side random permutation drawn at lock — it is not chosen by anyone.",
          "Never state anyone's CLV. The site does not compute it and prices are self-reported (priceSource: self).",
        ],
      });
    },
  },
  {
    name: "dd_bozo_standings",
    description: "Season-to-date Bozo ledger summary per player: legs submitted, Last In count, Shortest Odds count, and any graded results present. Early season this will honestly say nothing has resolved.",
    inputSchema: { type: "object", properties: { league: { type: "string", description: "League id (default: main)" } }, additionalProperties: false },
    async run(args, env) {
      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      let ledger;
      try { ledger = (await fbGet(env, LG(lid) + "/ledger")).data || {}; }
      catch (e) { return toolErr("Database unreachable: " + e.message); }
      const rows = Object.values(ledger);
      if (!rows.length) return toolText({ league: lid, note: "The ledger is empty — no week has locked yet." });
      const per = {};
      let graded = 0;
      for (const r of rows) {
        const p = per[r.player] || (per[r.player] = { legs: 0, lastIn: 0, shortestOdds: 0, results: {} });
        p.legs++;
        if (r.shortestOdds) p.shortestOdds++;
        if (r.result !== undefined && r.result !== null) { p.results[String(r.result)] = (p.results[String(r.result)] || 0) + 1; graded++; }
      }
      // Last In = highest rank within each season-week.
      const byWeek = {};
      for (const r of rows) (byWeek[`${r.season}-w${r.week}`] = byWeek[`${r.season}-w${r.week}`] || []).push(r);
      for (const wk of Object.values(byWeek)) {
        const last = wk.reduce((a, b) => (b.rank > a.rank ? b : a));
        if (per[last.player]) per[last.player].lastIn++;
      }
      return toolText({
        league: lid, weeksOnLedger: Object.keys(byWeek).length, gradedRows: graded,
        players: per,
        note: graded ? undefined : "No graded results yet — everything above is bookkeeping, not performance.",
      });
    },
  },
  {
    name: "dd_draft_board",
    description: "Live auction draft state from the league's Firebase mirror: budgets, open roster spots, each team's TRUE max bid (dollars left minus $1 reserved per unfilled slot — reporting raw remaining is the classic auction blunder), who is on the clock, what is on the block, and recent sales.",
    inputSchema: { type: "object", properties: { room: { type: "string", description: "Draft room (default: the league room)" } }, additionalProperties: false },
    async run(args, env) {
      const room = String(args.room || "pepperoninipples").replace(/[.#$\[\]\/]/g, "-");
      let rec;
      try {
        const r = await fetch(`${DB}/drafts/${room}.json`);
        if (!r.ok) return toolErr("Draft mirror unavailable: HTTP " + r.status);
        rec = await r.json();
      } catch (e) { return toolErr("Draft mirror unavailable: " + e.message); }
      if (!rec || !rec.state) return toolErr("The draft room is empty.");
      const st = rec.state, set = st.settings || {};
      const budget = set.budget || 200, spots = set.spots || 15;
      const teams = (set.teams || []).map(t => ({ name: t.name, owner: t.owner || null, spent: 0, count: 0 }));
      const picks = st.picks || [];
      for (const pk of picks) { const t = teams[pk.ti]; if (t) { t.spent += pk.price || 0; t.count++; } }
      for (const t of teams) {
        t.left = budget - t.spent;
        t.openSpots = spots - t.count;
        // $1 must stay reserved for every unfilled slot beyond this one.
        t.maxBid = t.openSpots > 0 ? Math.max(0, t.left - (t.openSpots - 1)) : 0;
      }
      const recent = picks.slice(-10).map(pk => ({
        player: pk.player, pos: pk.pos, price: pk.price,
        team: (teams[pk.ti] || {}).name || null, keeper: !!pk.keeper,
      }));
      return toolText({
        room, as_of: rec.ts || null, scoring: set.scoring || "half",
        budget, rosterSpots: spots,
        onTheClock: (teams[st.nomIdx] || {}).name || null,
        onBlock: st.onBlock || null,
        teams, picksMade: picks.length, recentSales: recent,
      });
    },
  },
  {
    name: "dd_draft_pool",
    description: "The published Market Value (MV) auction-dollar pool the site drafts from, filterable by position. MV is a dated snapshot, NOT a points projection — quote the as_of date out loud when quoting dollars.",
    inputSchema: {
      type: "object",
      properties: {
        pos: { type: "string", enum: ["QB", "RB", "WR", "TE", "K", "DST"], description: "Filter to one position" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Rows to return (default 25)" },
      },
      additionalProperties: false,
    },
    async run(args) {
      if (!mcpPoolCache.data || Date.now() - mcpPoolCache.at > 3600e3) {
        const r = await fetch(`${SITE}/data/pool.json`, { cf: { cacheTtl: 3600, cacheEverything: true } });
        if (!r.ok) return toolErr("pool.json unavailable: HTTP " + r.status);
        mcpPoolCache = { at: Date.now(), data: await r.json() };
      }
      const env2 = mcpPoolCache.data;
      let rows = env2.data || [];
      if (args.pos) rows = rows.filter(p => p.pos === args.pos);
      const limit = Math.min(Math.max(args.limit || 25, 1), 100);
      return toolText({
        as_of: env2.as_of, source: env2.source, note: env2.note,
        scoring_keys: env2.scoring_keys, tier: env2.tier, graded: env2.graded,
        count: rows.length, players: rows.slice(0, limit),
      });
    },
  },
  {
    name: "dd_survivor_week",
    description: "Stored survivor pick-ownership snapshot for a week. Ownership moves all week: a snapshot over 72 hours old is flagged stale and is directional-only.",
    inputSchema: {
      type: "object",
      properties: {
        season: { type: "integer", description: "Season (default: current)" },
        week: { type: "integer", minimum: 1, maximum: 18, description: "NFL week" },
      },
      required: ["week"],
      additionalProperties: false,
    },
    async run(args, env) {
      const kv = env.DD_KV || env.RL;
      if (!kv) return toolErr("No KV namespace bound — survivor data unavailable.");
      const season = args.season || SEASON, week = args.week;
      if (!(week >= 1 && week <= 18)) return toolErr("week must be 1-18");
      const hit = await kv.get(survivorKey(season, week));
      if (!hit) return toolErr("No pick data stored for this week.");
      const rec = JSON.parse(hit);
      const ageH = (Date.now() - rec.stored) / 3.6e6;
      return toolText({ ...rec, ageHours: Math.round(ageH * 10) / 10, stale: ageH > 72,
        note: ageH > 72 ? "Snapshot is over 72h old — treat as directional-only." : undefined });
    },
  },
  {
    name: "dd_scores",
    description: "ESPN scoreboard proxy (sport + optional YYYYMMDD dates). ⚠️ ESPN sometimes refuses Cloudflare egress; if this tool reports unavailable, the scoreboard is still readable in a browser at espn.com.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", enum: ["nfl", "cfb", "nba", "cbb", "mlb", "nhl"], description: "Sport key" },
        dates: { type: "string", description: "YYYYMMDD or YYYYMMDD-YYYYMMDD (optional)" },
      },
      required: ["sport"],
      additionalProperties: false,
    },
    async run(args) {
      if (!LEAGUE[args.sport]) return toolErr("unknown sport");
      // ⚠️ handleScores takes sport and dates via searchParams — not season/week.
      const u = new URL("https://mcp.internal/scores");
      u.searchParams.set("sport", args.sport);
      if (args.dates) u.searchParams.set("dates", args.dates);
      const resp = await handleScores(u, {});
      const data = await resp.json();
      if (!resp.ok) return toolErr("Scores unavailable from this Worker (" + (data.detail || data.error || resp.status) + "). Read the scoreboard directly at espn.com.");
      return toolText(data);
    },
  },
  {
    name: "dd_dfs_correlations",
    description: "The site's within-game DFS correlation structure (same-team and opponent role×role matrices plus CV-by-projection tables), estimated from public nflverse data, 2019-2025 regular seasons. League-average structure — not this specific game.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      if (!mcpCorrCache.data || Date.now() - mcpCorrCache.at > 3600e3) {
        const r = await fetch(`${SITE}/dfs.html`, { cf: { cacheTtl: 3600, cacheEverything: true } });
        if (!r.ok) return toolErr("dfs.html unavailable: HTTP " + r.status);
        const html = await r.text();
        const tag = "const CORR = ";
        const i = html.indexOf(tag);
        if (i < 0) return toolErr("Correlation matrix not found in dfs.html — the page layout changed.");
        const j = html.indexOf("};", i);
        if (j < 0) return toolErr("Correlation matrix not parseable — the page layout changed.");
        let corr;
        try { corr = JSON.parse(html.slice(i + tag.length, j + 1)); }
        catch (e) { return toolErr("Correlation matrix not parseable: " + e.message); }
        mcpCorrCache = { at: Date.now(), data: corr };
      }
      return toolText(mcpCorrCache.data);
    },
  },
  {
    name: "dd_site_map",
    description: "What Data Dawgs publishes, where the machine-readable surfaces live, and — explicitly — what is NOT served here and why.",
    inputSchema: MCP_NO_ARGS,
    async run() {
      return toolText({
        site: SITE,
        machine: {
          index: "/llms.txt",
          surfaces: "/data/surfaces.json — every human page, its machine equivalent, and an honest live|planned|none status. Check it before claiming a route exists.",
          data: ["/data/pool.json", "/data/receipts.json", "/data/models.json", "/data/epa-teams.json", "/data/nfelo.json", "/data/league.json", "/data/bozo-rules.json", "/data/survivor.json", "/data/index.json"],
        },
        pages: {
          "index.html": "Home — what Data Dawgs is and the working-dawg taxonomy (Labs / Dawgs / The Pound).",
          "bigboard.html": "Draft big board over the MV pool.",
          "auction.html": "Auction draft operator (league passphrase gate).",
          "board.html": "Live draft board — mirrors the auction via Firebase.",
          "strategy.html": "Draft strategy digest (dated).",
          "stats.html": "NFL EPA stats explorer.",
          "dataviz.html": "Data visualisations.",
          "bozo.html": "The Bozo weekly parlay game.",
          "survivor.html": "Survivor pool EV tools.",
          "receipts.html": "272 pre-registered 2026 forecasts, SHA-256 locked.",
          "dfs.html": "DFS lineup lab (runs entirely in the browser).",
        },
        notServedHere: {
          dfs_projections_and_ownership: "Never served, by design. The DFS slate lives only in each user's own browser localStorage; there is no server copy, and building an upload path is exactly the invariant the DFS roadmap forbids.",
          epa_stats: "The 2.1MB dataset is embedded in stats.html; parsing it per call is a poor fit for a Worker. Browse the page directly.",
        },
      });
    },
  },
];
