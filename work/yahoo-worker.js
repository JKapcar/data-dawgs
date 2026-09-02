/* ================= Yahoo public-league Worker adapter ====================
 * The pure HTML parsers above are generated verbatim from work/yahoo-parse.js.
 * This layer owns network I/O, refusal rules, projection joins, caching, and routes.
 * Public Yahoo pages require no cookie; a private league is refused explicitly.
 */
const YAHOO_READ = "https://football.fantasysports.yahoo.com/f1";
const YAHOO_KV_PREFIX = "yahoo:league:";
const YAHOO_SHARE_PREFIX = "yahoo:share:";
const YAHOO_SHARE_OF_PREFIX = "yahoo:shareof:";
const YAHOO_SCHEDULE_PREFIX = "yahoo:schedule:";
const YAHOO_RECORD_TTL = 60 * 60 * 24 * 180;
const YAHOO_MAX_HTML = 2 * 1024 * 1024;
const YAHOO_PROJ_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function yahooKvKey(uid) { return YAHOO_KV_PREFIX + uid; }
function yahooScheduleKey(leagueId, season, weeks) {
  return YAHOO_SCHEDULE_PREFIX + season + ":" + leagueId + ":" + weeks;
}

function yahooShareToken() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  let token = "";
  for (const byte of bytes) token += alphabet[byte % alphabet.length];
  return token;
}

function yahooPrivateReason() {
  return "This Yahoo league is not public. Yahoo must expose it without a sign-in for Data Dawgs to read it.";
}

async function yahooFetchPage(leagueId, suffix, noStore) {
  const url = YAHOO_READ + "/" + encodeURIComponent(leagueId) + String(suffix || "");
  const init = { redirect: "follow", headers: { Accept: "text/html,application/xhtml+xml" } };
  if (noStore) init.cache = "no-store";
  let response;
  try { response = await fetch(url, init); }
  catch { return { ok: false, status: 0, reason: "Yahoo could not be reached from the Worker." }; }
  const finalUrl = String(response.url || url);
  const finalHost = (() => { try { return new URL(finalUrl).hostname; } catch { return ""; } })();
  if (response.status === 401 || response.status === 403 || response.status === 404 ||
      /(^|\.)login\.yahoo\.com$/i.test(finalHost))
    return { ok: false, status: response.status || 403, reason: yahooPrivateReason() };
  if (!response.ok) return { ok: false, status: response.status, reason: "Yahoo answered " + response.status + "." };
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > YAHOO_MAX_HTML)
    return { ok: false, status: 502, reason: "Yahoo's page was too large to parse safely." };
  let html;
  try { html = await response.text(); }
  catch { return { ok: false, status: 502, reason: "Yahoo's page could not be read." }; }
  if (html.length > YAHOO_MAX_HTML)
    return { ok: false, status: 502, reason: "Yahoo's page was too large to parse safely." };
  if (/id=["']login-username["']|name=["']signin["']/i.test(html))
    return { ok: false, status: 403, reason: yahooPrivateReason() };
  return { ok: true, status: response.status, html };
}

/* Slice the one table/module a parser needs before walking rows. Yahoo pages are close to
   1 MB; retaining or repeatedly scanning whole documents would waste the Worker's CPU. */
function yahooTableAround(html, pattern, maxLength) {
  const at = typeof pattern === "string" ? html.indexOf(pattern) : html.search(pattern);
  if (at < 0) return "";
  const start = html.lastIndexOf("<table", at);
  const end = html.indexOf("</table>", at);
  if (start < 0 || end < at) return "";
  const out = html.slice(start, end + 8);
  return out.length <= maxLength ? out : "";
}
function yahooMatchupsModule(html) {
  const start = html.search(/Tst-matchups-body/i);
  if (start < 0) return "";
  const end = html.indexOf("Tst-standings", start);
  const out = html.slice(start, end > start ? end : start + 160000);
  return out.length <= 180000 ? out : "";
}
function yahooRosterModule(html) {
  const first = html.search(/class="[^"]*\bpos\b[^"]*\bheadcol\b/i);
  if (first < 0) return "";
  const start = html.lastIndexOf('<section class="stat-target"', first);
  const last = (() => {
    const matches = [...html.matchAll(/class="[^"]*\bpos\b[^"]*\bheadcol\b/gi)];
    return matches.length ? matches[matches.length - 1].index : first;
  })();
  const end = html.indexOf("</section>", last);
  if (start < 0 || end < last) return "";
  const out = html.slice(start, end + 10);
  return out.length <= 400000 ? out : "";
}

async function yahooCanonicalSettings(leagueId) {
  if (String(leagueId) !== "773763") return null;
  let response;
  try {
    response = await fetch(SITE + "/data/leagues/pepperoninipples.json", {
      headers: { Accept: "application/json" },
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch { return null; }
  if (!response.ok) return null;
  try {
    const body = await response.json();
    return body && body.settings ? body : null;
  } catch { return null; }
}

function yahooReconcileSettings(live, canonical) {
  if (!canonical) return { ok: true, canonical: null };
  const expected = canonical.settings || {};
  const disagreements = [];
  if (Number(live.teams) !== Number(expected.team_count)) disagreements.push("team count");
  if (Number(live.playoffTeams) !== Number(expected.playoff_teams)) disagreements.push("playoff teams");
  if (Number(live.playoffStart) !== Number(expected.playoff_start_week)) disagreements.push("playoff start");
  if (Number(live.rec) !== Number((expected.scoring || {}).ppr)) disagreements.push("reception scoring");
  return disagreements.length
    ? { ok: false, reason: "Yahoo's live settings disagree with the canonical league file: " + disagreements.join(", ") + "." }
    : { ok: true, canonical };
}

function yahooProjectionValue(row, rec, weeks) {
  const stats = row && row.stats || {};
  const key = Number(rec) === 1 ? "pts_ppr" : Number(rec) === 0 ? "pts_std" :
    Number(rec) === 0.5 ? "pts_half_ppr" : null;
  if (!key || !Number.isFinite(Number(stats[key]))) return null;
  const total = Number(stats[key]);
  return Math.round((total / Math.max(1, Number(weeks) || 1)) * 100) / 100;
}

function yahooProjectionIndex(rows, rec, weeks) {
  const by = new Map(), pool = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const player = row && row.player || {};
    const rawPos = String(player.position || "").toUpperCase();
    if (!YAHOO_PROJ_POS.includes(rawPos)) continue;
    const pos = rawPos === "DEF" ? "DST" : rawPos;
    const name = String(player.full_name || ((player.first_name || "") + " " + (player.last_name || "")).trim());
    if (!name) continue;
    const team = player.team ? String(player.team).toUpperCase() : "";
    const key = ddPlayerKey({ name, pos, team });
    if (!key || by.has(key)) continue;
    const item = {
      id: "s:" + String(row.player_id == null ? key : row.player_id),
      sleeperId: row.player_id == null ? null : String(row.player_id),
      name, pos, team, p: yahooProjectionValue(row, rec, weeks), key,
    };
    by.set(key, item);
    /* Null projections are useful only as a join result for a rostered/drafted player.
       They are not a replacement-level pool and would otherwise ship thousands of retired
       Sleeper index rows to the browser as if they were current free agents. */
    if (item.p != null) pool.push(item);
  }
  return { by, pool };
}

async function yahooFetchProjections(season, rec, weeks) {
  const query = "?season_type=regular&order_by=pts_half_ppr" +
    YAHOO_PROJ_POS.map(pos => "&position[]=" + encodeURIComponent(pos)).join("");
  let response;
  try { response = await fetch("https://api.sleeper.app/projections/nfl/" + season + query); }
  catch { return { ok: false, reason: "Sleeper's projection feed could not be reached." }; }
  if (!response.ok) return { ok: false, reason: "Sleeper's projection feed answered " + response.status + "." };
  let rows;
  try { rows = await response.json(); }
  catch { return { ok: false, reason: "Sleeper's projection feed was not JSON." }; }
  return { ok: true, ...yahooProjectionIndex(rows, rec, weeks) };
}

async function yahooReadSchedule(leagueId, season, weeks, teamCount, homeModule, env) {
  const kv = env && env.RL || null;
  const key = yahooScheduleKey(leagueId, season, weeks);
  if (kv) {
    try {
      const cached = JSON.parse((await kv.get(key)) || "null");
      if (cached && cached.teamCount === teamCount && Array.isArray(cached.schedule) &&
          cached.schedule.length === weeks)
        return { ok: true, schedule: cached.schedule, weeksOk: weeks, cached: true };
    } catch { /* a corrupt cache is a miss */ }
  }
  const schedule = [];
  for (let weekNo = 1; weekNo <= weeks; weekNo++) {
    let module = weekNo === 1 ? homeModule : "";
    if (!module) {
      const page = await yahooFetchPage(leagueId, "?week=" + weekNo, true);
      if (!page.ok) return page;
      module = yahooMatchupsModule(page.html);
      page.html = "";
    }
    const parsed = yahooParseWeek(module, leagueId, weekNo);
    if (!parsed.ok || Number(parsed.week) !== weekNo || !yahooWeekIsSane(parsed, teamCount))
      return { ok: false, status: 502, reason: "Yahoo's Week " + weekNo + " matchup page failed its echoed-week or team-count check." };
    schedule.push(parsed.pairs);
  }
  if (kv) {
    try { await kv.put(key, JSON.stringify({ teamCount, schedule }), { expirationTtl: YAHOO_RECORD_TTL }); }
    catch { /* the verified schedule can still be served */ }
  }
  return { ok: true, schedule, weeksOk: weeks, cached: false };
}

async function yahooWarroomFeed(cred, env) {
  const leagueId = String(cred && cred.leagueId || "");
  const season = Number(cred && cred.season) || new Date().getUTCFullYear();
  if (!/^\d{1,12}$/.test(leagueId)) return { ok: false, status: 400, reason: "That does not look like a Yahoo league id." };

  let page = await yahooFetchPage(leagueId, "/settings", false);
  if (!page.ok) return page;
  const settingsTable = yahooTableAround(page.html, "Max Teams", 160000) +
    yahooTableAround(page.html, "Receptions", 160000);
  page.html = "";
  if (!settingsTable) return { ok: false, status: 502, reason: "Yahoo's settings table could not be isolated." };
  const settings = yahooParseSettings(settingsTable);
  if (!settings.teams || settings.rec == null || !settings.playoffTeams || !settings.playoffStart)
    return { ok: false, status: 502, reason: "Yahoo's settings page was incomplete, so this league was not loaded." };
  const canonical = await yahooCanonicalSettings(leagueId);
  const reconciled = yahooReconcileSettings(settings, canonical);
  if (!reconciled.ok) return { ok: false, status: 409, reason: reconciled.reason };

  page = await yahooFetchPage(leagueId, "?week=1", true);
  if (!page.ok) return page;
  const homeModule = yahooMatchupsModule(page.html);
  page.html = "";
  if (!homeModule) return { ok: false, status: 502, reason: "Yahoo's league-home matchup module could not be isolated." };
  const teamResult = yahooParseTeams(homeModule, leagueId);
  if (teamResult.found !== Number(settings.teams))
    return { ok: false, status: 502, reason: "Yahoo returned " + teamResult.found + " teams; settings require " + settings.teams + "." };

  page = await yahooFetchPage(leagueId, "/draftresults", false);
  if (!page.ok) return page;
  const draftTable = yahooTableAround(page.html, /class="player"/i, 400000);
  page.html = "";
  if (!draftTable) return { ok: false, status: 502, reason: "Yahoo's draft-results table could not be isolated." };
  const draft = yahooParseDraft(draftTable);
  if (draft.rows > 0 && draft.found === 0 && draft.empty !== draft.rows)
    return { ok: false, status: 502, reason: "Yahoo lists a drafted league but no draft picks could be read." };

  const rosterReads = [];
  const observedShape = {};
  const unknownSlots = [];
  for (const team of teamResult.teams) {
    page = await yahooFetchPage(leagueId, "/" + encodeURIComponent(team.id), false);
    if (!page.ok) return page;
    const rosterTable = yahooRosterModule(page.html);
    const title = (/<title>[\s\S]*?<\/title>/i.exec(page.html) || [""])[0];
    page.html = "";
    if (!rosterTable) return { ok: false, status: 502, reason: "Yahoo's roster table for team " + team.id + " could not be isolated." };
    const roster = yahooParseRoster(title + rosterTable, team.id);
    if (!roster.found) return { ok: false, status: 502, reason: "Yahoo returned zero readable players for team " + team.id + "." };
    /* Empty IR slots are not rendered, and an occupied IR slot can replace a displayed BN
       row. Merge maxima across teams; the canonical file wins when this is the known room. */
    for (const [slot, count] of Object.entries(roster.shape))
      observedShape[slot] = Math.max(observedShape[slot] || 0, Number(count) || 0);
    unknownSlots.push(...roster.unknownSlots);
    rosterReads.push({ team, roster });
  }

  const regularWeeks = Math.max(1, Number(settings.playoffStart) - 1);
  const scheduleResult = await yahooReadSchedule(leagueId, season, regularWeeks,
    Number(settings.teams), homeModule, env);
  if (!scheduleResult.ok) return scheduleResult;

  const projections = await yahooFetchProjections(season, settings.rec, regularWeeks);
  if (!projections.ok) return { ok: false, status: 502, reason: projections.reason };
  const paidBy = new Map(draft.picks.map(pick => [pick.key, pick.cost]));
  const poolById = new Map(), usedProjectionKeys = new Set();
  const addYahooPlayer = row => {
    const id = String(row.key);
    if (poolById.has(id)) return poolById.get(id);
    const projectionKey = ddPlayerKey({ name: row.name, pos: row.pos, team: row.team });
    const projection = projectionKey ? projections.by.get(projectionKey) : null;
    if (projectionKey) usedProjectionKeys.add(projectionKey);
    const out = { id, yahooId: row.pid || null, name: row.name, pos: row.pos, team: row.team,
      p: projection ? projection.p : null, paid: paidBy.has(row.key) ? paidBy.get(row.key) : null };
    poolById.set(id, out);
    return out;
  };
  const teams = rosterReads.map(({ team, roster }) => {
    const ids = [], starters = [];
    for (const player of roster.players) {
      const row = addYahooPlayer(player);
      ids.push(row.id);
      if (player.starter) starters.push(row.id);
    }
    return { id: String(team.id), name: roster.teamName || team.name,
      owner: null, players: ids, starters };
  });
  for (const pick of draft.picks) addYahooPlayer(pick);
  for (const projection of projections.pool) {
    if (usedProjectionKeys.has(projection.key)) continue;
    poolById.set(projection.id, { id: projection.id, yahooId: null, name: projection.name,
      pos: projection.pos, team: projection.team, p: projection.p, paid: null });
  }
  const shape = canonical && canonical.settings && canonical.settings.roster_slots || observedShape;
  const slots = Object.entries(shape).map(([slot, count]) => ({ slot: slot === "BN" ? "BENCH" : slot, count }));
  const superflex = Number(shape.SUPERFLEX || 0) > 0;
  const scoringMode = superflex ? "sf" : settings.rec === 1 ? "full" : settings.rec === 0.5 ? "half" : settings.rec === 0 ? "std" : "custom";
  const leagueName = rosterReads[0] && rosterReads[0].roster.leagueName ||
    canonical && canonical.name || "Yahoo league";
  return { ok: true, body: {
    league: {
      id: leagueId, name: leagueName, season, size: Number(settings.teams), dynasty: false,
      playoffTeams: Number(settings.playoffTeams), playoffStart: Number(settings.playoffStart),
      scoring: { mode: scoringMode, ppr: Number(settings.rec), superflex }, slots,
      draftType: canonical && canonical.settings && canonical.settings.draft_type || null,
      budget: canonical && canonical.settings && canonical.settings.budget || null,
      keepers: !!(canonical && canonical.settings && canonical.settings.keepers),
    },
    teams, pool: [...poolById.values()], schedule: scheduleResult.schedule,
    diagnostics: {
      teamsFound: teamResult.found, rostersFound: rosterReads.length,
      picksFound: draft.found, weeksOk: scheduleResult.weeksOk,
      unmatched: [...poolById.values()].filter(player => player.p == null).map(player => player.name),
      unknownSlots: [...new Set(unknownSlots)], scheduleCached: scheduleResult.cached,
      canonicalReconciled: !!canonical,
    },
  } };
}

async function yahooStored(kv, uid) {
  try { return JSON.parse((await kv.get(yahooKvKey(uid))) || "null"); }
  catch { return null; }
}

async function handleYahooShareRead(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "share storage is unavailable" }, 503, cors);
  const token = url.pathname.replace(/^\/yahoo\/share\//, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(token)) return json({ error: "That is not a share link." }, 404, cors);
  let link = null;
  try { link = JSON.parse((await kv.get(YAHOO_SHARE_PREFIX + token)) || "null"); } catch { link = null; }
  if (!link || !link.uid) return json({ error: "That share link is not valid, or the league owner revoked it." }, 404, cors);
  const cred = await yahooStored(kv, link.uid);
  if (!cred || String(cred.leagueId) !== String(link.leagueId))
    return json({ error: "The league owner is no longer connected to this Yahoo league." }, 409, cors);
  const result = await yahooWarroomFeed(cred, env);
  if (!result.ok) return json({ error: result.reason }, result.status || 502, cors);
  if (DD_SHARE_INCLUDE) ddDecorateBody(await ddLoadBoard(env, "yahoo", cred.leagueId, "season"), result.body);
  return json({ ok: true, shared: true, readOnly: true, sharedAt: link.at || null, ...result.body }, 200, cors);
}

async function handleYahoo(request, url, env, cors) {
  const kv = env.RL || null;
  if (!kv) return json({ error: "Yahoo connection storage is unavailable" }, 503, cors);
  const auth = await sessionAuth(request, env);
  if (auth.err) return json({ error: auth.err }, auth.code || 401, cors);
  const uid = auth.uid || auth.user && auth.user.uid || null;
  if (!uid) return json({ error: "This account has no durable uid. Sign in again to connect Yahoo." }, 409, cors);
  const path = url.pathname.replace(/^\/yahoo\/?/, "");

  if (path === "connect" && request.method === "DELETE") {
    try { await kv.delete(yahooKvKey(uid)); } catch {}
    try {
      const token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid);
      if (token) await kv.delete(YAHOO_SHARE_PREFIX + token);
      await kv.delete(YAHOO_SHARE_OF_PREFIX + uid);
    } catch {}
    return json({ ok: true, connected: false }, 200, cors);
  }
  if (path === "connect" && request.method === "GET") {
    const cred = await yahooStored(kv, uid);
    return json({ ok: true, connected: !!cred, leagueId: cred && cred.leagueId || null,
      teamId: cred && cred.teamId || null, connectedAt: cred && cred.at || null }, 200, cors);
  }
  if (path === "connect" && request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "Send JSON." }, 400, cors); }
    const leagueId = String(body.leagueId || "").trim();
    const teamId = body.teamId == null || body.teamId === "" ? null : String(body.teamId).trim();
    if (!/^\d{1,12}$/.test(leagueId)) return json({ error: "That does not look like a Yahoo league id." }, 400, cors);
    if (teamId != null && !/^\d{1,4}$/.test(teamId)) return json({ error: "That does not look like a Yahoo team id." }, 400, cors);
    const probe = await yahooFetchPage(leagueId, "?week=1", true);
    if (!probe.ok) return json({ error: probe.reason }, probe.status || 400, cors);
    const module = yahooMatchupsModule(probe.html);
    const teams = yahooParseTeams(module, leagueId).teams;
    if (!teams.length) return json({ error: "Yahoo's public league page contained no readable teams." }, 502, cors);
    if (teamId != null && !teams.some(team => String(team.id) === teamId))
      return json({ error: "That team id is not in this Yahoo league." }, 400, cors);
    const record = { leagueId, teamId, season: new Date().getUTCFullYear(), at: new Date().toISOString() };
    try { await kv.put(yahooKvKey(uid), JSON.stringify(record), { expirationTtl: YAHOO_RECORD_TTL }); }
    catch { return json({ error: "Could not save the Yahoo connection." }, 500, cors); }
    return json({ ok: true, connected: true, public: true, leagueId, teamId,
      teams: teams.map(team => ({ id: team.id, name: team.name })) }, 200, cors);
  }
  if (path === "warroom" && request.method === "GET") {
    const cred = await yahooStored(kv, uid);
    if (!cred) return json({ error: "No Yahoo league connected for this account." }, 404, cors);
    const result = await yahooWarroomFeed(cred, env);
    if (!result.ok) return json({ error: result.reason }, result.status || 502, cors);
    ddDecorateBody(await ddLoadBoard(env, "yahoo", cred.leagueId, "season"), result.body);
    return json({ ok: true, ...result.body }, 200, cors);
  }
  if (path === "share" && request.method === "GET") {
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    return json({ ok: true, shared: !!token,
      url: token ? SITE + "/fantasy-warroom.html?provider=yahoo&share=" + token : null }, 200, cors);
  }
  if (path === "share" && request.method === "POST") {
    const cred = await yahooStored(kv, uid);
    if (!cred) return json({ error: "Connect a Yahoo league before sharing it." }, 404, cors);
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    if (!token) {
      token = yahooShareToken();
      const link = { uid, leagueId: String(cred.leagueId), at: Date.now() };
      await kv.put(YAHOO_SHARE_PREFIX + token, JSON.stringify(link), { expirationTtl: YAHOO_RECORD_TTL });
      await kv.put(YAHOO_SHARE_OF_PREFIX + uid, token, { expirationTtl: YAHOO_RECORD_TTL });
    }
    return json({ ok: true, url: SITE + "/fantasy-warroom.html?provider=yahoo&share=" + token }, 200, cors);
  }
  if (path === "share" && request.method === "DELETE") {
    let token = null;
    try { token = await kv.get(YAHOO_SHARE_OF_PREFIX + uid); } catch { token = null; }
    if (token) { try { await kv.delete(YAHOO_SHARE_PREFIX + token); } catch {} }
    try { await kv.delete(YAHOO_SHARE_OF_PREFIX + uid); } catch {}
    return json({ ok: true, shared: false }, 200, cors);
  }
  return json({ error: "Unknown Yahoo route." }, 404, cors);
}
