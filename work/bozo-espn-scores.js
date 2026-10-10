/* ===================== live finals: ESPN first, the schedule CSVs decide =====================
   The live half of the score feed. It lands a final minutes after the whistle, while
   cfbfastR publishes four times a week and nflverse's games.csv trails by up to a few hours.

   PRECEDENCE, highest first. Every reader keeps this order:
     1. An OFFICIAL final from the schedule feeds: nflverse games.csv (NFL) or cfbfastR
        (CFB). Grading, /scores and the MCP read all take the schedule row first and look
        at a live final only while the schedule row is still not final. When ESPN and an
        official final disagree, the official final wins, and the disagreement is logged
        (`bozo-final-disagreement`) and kept on the ESPN archive (newest 20).
     2. ESPN's public scoreboard (source: "espn"), matched to the scheduled game by its
        ESPN event id. Both schedule feeds carry that id, so no team-name guess is involved.
        Rows the id cannot place fall back to teams plus the nearest kickoff, the same as
        the Odds API rows.
     3. The Odds API archive, now optional. It runs only when ESPN failed on this pass.
        A missing ODDS_API_KEY skips it. A 401 probes once a day and never counts as a failure.

   ⚠️ FINAL MEANS FINAL. A row enters the archive only when ESPN's status reads completed
   and post, and its name is not a cancellation, postponement, suspension or forfeit.
   An in-progress score is counted for the diagnostics and goes nowhere else, so it can
   never grade a leg.

   ⚠️ WORKER EGRESS. docs/bozo-workplan.md D19 (Sept 2026) recorded site.api.espn.com
   returning 403 to Worker egress. So this tries two scoreboard hosts, then the
   sports.core.api.espn.com per-game records, which D19's registry generator could read.
   A host that answers 401/403/451 is skipped for six hours, so a block costs one request
   per sport every six hours, not one per tick. Which path worked is public at
   /scores?sport=nfl → feeds.live.via.

   BUDGET. Cloudflare's free plan allows 50 subrequests per invocation, shared by every job
   on the five-minute tick. Only a sport with a due game spends anything:
     - scoreboard: one request per Eastern date with a due game, at most two dates a tick.
       ESPN rejects date ranges (zero events), so each date is its own request.
     - core fallback: at most BOZO_ESPN_CORE_BUDGET requests per sport per tick. That is one
       status read per unfinished game, plus three more reads when it is final.
     - cadence: every tick (five minutes) while a due game is inside the fast window,
       thirty minutes for long-overdue games, fifteen minutes after a failed pass.
     - a ceiling of BOZO_ESPN_DAILY_CAP requests per sport per UTC day. It stops a bug;
       it is not a working budget. A normal NFL Sunday spends about forty. */
const BOZO_ESPN_LEAGUE = Object.freeze({ nfl: "nfl", cfb: "college-football" });
const BOZO_ESPN_SCOREBOARD_HOSTS = Object.freeze([
  ["site", "https://site.api.espn.com"],
  ["site-web", "https://site.web.api.espn.com"],
]);
const BOZO_ESPN_CORE_HOST = "https://sports.core.api.espn.com";
const bozoEspnArchiveKey = (sport, season) => `bozo:score-espn:${sport}:${season}`;
const BOZO_ESPN_REFRESH_MS = 5 * 60 * 1000;
const BOZO_ESPN_SLOW_MS = 30 * 60 * 1000;
const BOZO_ESPN_RETRY_MS = 15 * 60 * 1000;
const BOZO_ESPN_HOST_BLOCK_MS = 6 * 3600 * 1000;
const BOZO_ESPN_MAX_DATES = 2;
const BOZO_ESPN_CORE_BUDGET = 4;
const BOZO_ESPN_DAILY_CAP = 600;
const BOZO_ESPN_KEEP_MS = 14 * 86400 * 1000;
const BOZO_ESPN_TIMEOUT_MS = 4000;
const BOZO_ESPN_DISAGREEMENTS_KEPT = 20;

// Logging is best-effort: a sandbox without console must not turn a log into a failure.
function bozoEspnLog(tag, detail) {
  try { console.log(tag, JSON.stringify(detail)); } catch { /* no console, no log */ }
}

// Final only when ESPN says completed AND post, and the status is not a stoppage.
function bozoEspnIsFinal(type) {
  if (!type || type.completed !== true || type.state !== "post") return false;
  return !/CANCEL|POSTPON|SUSPEND|FORFEIT|ABANDON|DELAY/i.test(String(type.name || ""));
}

// Scoreboard scores are strings ("24"); core scores are objects ({ value: 24 }).
function bozoEspnScore(value) {
  const n = value && typeof value === "object" ? Number(value.value) : bozoCsvNumber(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// One archive row. The canonicalKey uses the kickoff's UTC date, the same rule as every
// other source, so a Monday-night final at 00:15Z Tuesday keeps Tuesday's UTC date.
function bozoEspnRow(sport, id, date, homeTeam, awayTeam, homeScore, awayScore, observedAt, via) {
  const t = Date.parse(date || "");
  if (!/^\d{1,20}$/.test(String(id || "")) || !Number.isFinite(t) || homeScore === null || awayScore === null) return null;
  if (t > Date.parse(observedAt)) return null;            // a final cannot precede its kickoff
  const team = x => ({ name: String((x && (x.displayName || x.location || x.shortDisplayName)) || ""),
    abbr: String((x && x.abbreviation) || ""), espnId: x && x.id != null ? String(x.id) : null });
  const home = team(homeTeam), away = team(awayTeam);
  if (!home.name || !away.name) return null;
  const startsAt = new Date(t).toISOString();
  return { canonicalKey: bozoCanonicalScheduleKey(sport, away.name, home.name, startsAt),
    providerEventId: String(id), espnEventId: String(id), startsAt, localDate: bozoEasternDate(startsAt),
    completed: true, home, away, homeScore, awayScore,
    source: "espn", scoreSource: "espn", scoreObservedAt: observedAt, via };
}

/* The site scoreboard (both hosts serve the same shape). Returns finals only, plus counts. */
function bozoNormalizeEspnScoreboard(sport, raw, observedAt, via = "site") {
  const events = raw && Array.isArray(raw.events) ? raw.events : null;
  if (!events) throw Object.assign(new Error("ESPN scoreboard has no events array"), { espnKind: "invalid_response" });
  const games = [];
  let inProgress = 0;
  for (const ev of events) {
    const comp = ev && Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    const type = (comp && comp.status && comp.status.type) || (ev && ev.status && ev.status.type) || null;
    if (type && type.state === "in") inProgress++;
    if (!comp || !bozoEspnIsFinal(type)) continue;
    const homes = (comp.competitors || []).filter(c => c && c.homeAway === "home");
    const aways = (comp.competitors || []).filter(c => c && c.homeAway === "away");
    if (homes.length !== 1 || aways.length !== 1) continue;
    const row = bozoEspnRow(sport, ev.id, ev.date || comp.date, homes[0].team, aways[0].team,
      bozoEspnScore(homes[0].score), bozoEspnScore(aways[0].score), observedAt, via);
    if (row) games.push(row);
  }
  return { games, events: events.length, inProgress };
}

// ESPN's own team record by id, never by name: an empty name would match a blank field.
function bozoEspnSeedById(sport, id) {
  if (id == null || id === "") return null;
  const rows = ((typeof BOZO_ESPN_TEAM_SEED !== "undefined" && BOZO_ESPN_TEAM_SEED.sports) || {})[sport] || [];
  return rows.find(t => String(t.id) === String(id)) || null;
}

// Does ESPN competitor `id` name this scheduled team? true / false / null (cannot tell).
function bozoEspnSameTeam(sport, id, team) {
  if (!team || id == null) return null;
  if (team.id != null && team.id !== "") return String(team.id) === String(id);
  const seed = bozoEspnSeedById(sport, id);
  if (!seed) return null;
  const norm = v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return [team.abbr, team.name].some(v => norm(v) && norm(v) === norm(seed.abbreviation));
}

async function bozoEspnGet(fetcher, url, spend) {
  if (!spend()) throw Object.assign(new Error("ESPN request budget spent"), { espnKind: "budget" });
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  try {
    const response = await Promise.race([
      fetcher(url, { headers: { Accept: "application/json" }, signal: controller ? controller.signal : undefined }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(Object.assign(new Error("ESPN timeout"), { espnKind: "timeout" }));
      }, BOZO_ESPN_TIMEOUT_MS); }),
    ]);
    if (!response || !response.ok) {
      const status = response ? response.status : null;
      throw Object.assign(new Error("ESPN HTTP " + status), { espnKind: "http_error", httpStatus: status });
    }
    try { return await response.json(); }
    catch { throw Object.assign(new Error("ESPN invalid JSON"), { espnKind: "invalid_response", httpStatus: response.status }); }
  } catch (e) {
    // Only fixed fields cross: a native fetch error can carry the URL.
    if (e && e.espnKind) throw e;
    throw Object.assign(new Error("ESPN network error"), { espnKind: "network_error" });
  } finally { if (timer) clearTimeout(timer); }
}

const bozoEspnBlockedStatus = s => s === 401 || s === 403 || s === 451;
const bozoEspnDate = iso => (bozoEasternDate(iso) || "").replace(/-/g, "");

// One scheduled game from the core per-game records. Team names come from the schedule,
// and orientation comes from ESPN's homeAway, cross-checked against team ids.
async function bozoEspnCoreFinal(sport, game, fetcher, spend, observedAt) {
  const id = String(game.espnEventId || "");
  if (!/^\d{1,20}$/.test(id)) return { final: false, state: "no_id" };
  const base = `${BOZO_ESPN_CORE_HOST}/v2/sports/football/leagues/${BOZO_ESPN_LEAGUE[sport]}/events/${id}/competitions/${id}`;
  const status = await bozoEspnGet(fetcher, base + "/status", spend);
  const type = status && status.type;
  if (!bozoEspnIsFinal(type)) return { final: false, state: (type && type.state) || null };
  const comp = await bozoEspnGet(fetcher, base, spend);
  const cs = (comp && comp.competitors) || [];
  const homes = cs.filter(c => c && c.homeAway === "home"), aways = cs.filter(c => c && c.homeAway === "away");
  if (homes.length !== 1 || aways.length !== 1) return { final: false, state: "unparsed" };
  const h = homes[0], a = aways[0];
  const straight = [bozoEspnSameTeam(sport, h.id, game.home), bozoEspnSameTeam(sport, a.id, game.away)];
  const crossed = [bozoEspnSameTeam(sport, h.id, game.away), bozoEspnSameTeam(sport, a.id, game.home)];
  let swapped = false;
  if (straight.includes(false)) {
    if (crossed.every(x => x === true)) swapped = true;
    else return { final: false, state: "team_mismatch" };
  }
  const hs = await bozoEspnGet(fetcher, `${base}/competitors/${encodeURIComponent(h.id)}/score`, spend);
  const as = await bozoEspnGet(fetcher, `${base}/competitors/${encodeURIComponent(a.id)}/score`, spend);
  const espnHome = swapped ? game.away : game.home, espnAway = swapped ? game.home : game.away;
  const row = bozoEspnRow(sport, id, (comp && comp.date) || game.startsAt,
    { displayName: espnHome.name, abbreviation: espnHome.abbr, id: h.id },
    { displayName: espnAway.name, abbreviation: espnAway.abbr, id: a.id },
    bozoEspnScore(hs), bozoEspnScore(as), observedAt, "core");
  return row ? { final: true, row } : { final: false, state: "unparsed" };
}

// Official final versus ESPN for the same event id, in the scheduled orientation.
function bozoEspnDisagreement(official, row, sport, registry) {
  if (!official || !official.completed || !row) return null;
  const norm = v => bozoTeamNorm(v, registry);
  const swapped = norm(row.home.name) === norm(official.away.name) && norm(row.away.name) === norm(official.home.name);
  const espn = swapped ? { home: row.awayScore, away: row.homeScore } : { home: row.homeScore, away: row.awayScore };
  if (espn.home === official.homeScore && espn.away === official.awayScore) return null;
  return { sport, espnEventId: row.espnEventId, winner: "official",
    official: { home: official.homeScore, away: official.awayScore }, espn };
}

/* Refresh the ESPN archive for the due games of one sport. Always resolves, never throws:
   a failure is the archive's `error` (a fixed code) and `httpStatus`. */
async function bozoEspnRefresh(env, sport, season, nowMs, dueGames, fetcher, options = {}) {
  const key = bozoEspnArchiveKey(sport, season);
  let previous = null;
  try { previous = await env.RL.get(key, "json"); } catch { previous = null; }
  const nowIso = new Date(nowMs).toISOString(), day = nowIso.slice(0, 10);
  const prev = previous || {};
  const calls = { day, n: prev.calls && prev.calls.day === day ? Number(prev.calls.n) || 0 : 0 };
  const base = { source: "espn", fetchedAt: prev.fetchedAt || null, games: Array.isArray(prev.games) ? prev.games : [],
    hosts: { ...(prev.hosts || {}) }, core: { checked: { ...((prev.core && prev.core.checked) || {}) } },
    dates: { ...(prev.dates || {}) }, disagreements: Array.isArray(prev.disagreements) ? prev.disagreements : [] };
  if (calls.n >= BOZO_ESPN_DAILY_CAP)
    return { ...prev, ...base, calls, skipped: "daily_cap", error: prev.error || null };
  let spent = 0;
  const coreBudget = Number.isFinite(options.coreBudget) ? options.coreBudget : BOZO_ESPN_CORE_BUDGET;
  const spendAny = () => { if (calls.n >= BOZO_ESPN_DAILY_CAP) return false; calls.n++; spent++; return true; };
  const found = [];
  let via = null, error = null, httpStatus = null, events = 0, inProgress = 0, anyOk = false;
  const note = e => { error = e.espnKind === "http_error" && bozoEspnBlockedStatus(e.httpStatus) ? "espn_blocked"
    : "espn_" + (e.espnKind || "error"); httpStatus = Number.isInteger(e.httpStatus) ? e.httpStatus : null; };

  // 1. Scoreboards: the least recently fetched Eastern dates first; among equals the most
  // recent date, where the newest finals are.
  const dates = [...new Set(dueGames.map(g => bozoEspnDate(g.startsAt)).filter(Boolean))]
    .sort((x, y) => (Date.parse(base.dates[x] || "") || 0) - (Date.parse(base.dates[y] || "") || 0) || (x < y ? 1 : -1))
    .slice(0, BOZO_ESPN_MAX_DATES);
  for (const date of dates) {
    for (const [name, host] of BOZO_ESPN_SCOREBOARD_HOSTS) {
      if (Date.parse((base.hosts[name] || {}).blockedUntil || "") > nowMs) continue;
      const url = `${host}/apis/site/v2/sports/football/${BOZO_ESPN_LEAGUE[sport]}/scoreboard?dates=${date}&limit=300`
        + (sport === "cfb" ? "&groups=80" : "");
      try {
        const raw = await bozoEspnGet(fetcher, url, spendAny);
        const parsed = bozoNormalizeEspnScoreboard(sport, raw, nowIso, name);
        found.push(...parsed.games); events += parsed.events; inProgress += parsed.inProgress;
        base.dates[date] = nowIso; via = via || name; anyOk = true;
        delete base.hosts[name];
        break;                                                   // this date is done
      } catch (e) {
        if (e.espnKind === "budget") break;
        note(e);
        if (e.espnKind === "http_error" && bozoEspnBlockedStatus(e.httpStatus))
          base.hosts[name] = { blockedUntil: new Date(nowMs + BOZO_ESPN_HOST_BLOCK_MS).toISOString(), httpStatus: e.httpStatus };
      }
    }
  }

  // 2. Core per-game records, only when no scoreboard answered this pass.
  if (!anyOk) {
    let coreSpent = 0;
    const spendCore = () => coreSpent < coreBudget && spendAny() && ++coreSpent > 0;
    const queue = dueGames.filter(g => /^\d{1,20}$/.test(String(g.espnEventId || "")))
      .sort((x, y) => (Date.parse(base.core.checked[x.espnEventId] || "") || 0) - (Date.parse(base.core.checked[y.espnEventId] || "") || 0));
    for (const game of queue) {
      if (coreSpent >= coreBudget) break;
      try {
        const r = await bozoEspnCoreFinal(sport, game, fetcher, spendCore, nowIso);
        base.core.checked[game.espnEventId] = nowIso;
        anyOk = true; via = "core";
        if (r.final) found.push(r.row);
        else if (r.state === "in") inProgress++;
      } catch (e) {
        if (e.espnKind === "budget") break;
        note(e);
        if (e.espnKind === "http_error" && bozoEspnBlockedStatus(e.httpStatus)) break;   // one refusal is enough
      }
    }
  }

  // Team names map to the canonicalKey through the registry (bozoEspnRow). When the event id
  // places the row on a scheduled game, the schedule's own canonicalKey is adopted: the
  // schedule is the record, and a spelling the registry lacks (nflverse "LA" for the Rams)
  // must not split one game into two keys.
  if (options.scheduleGames) {
    const keyById = new Map(options.scheduleGames.filter(g => g && g.espnEventId && g.canonicalKey)
      .map(g => [String(g.espnEventId), g.canonicalKey]));
    for (const row of found) if (keyById.has(row.espnEventId)) row.canonicalKey = keyById.get(row.espnEventId);
  }

  // Merge finals by event id. A later observation replaces an earlier one (stat corrections).
  const merged = new Map(base.games.map(g => [String(g.providerEventId), g]));
  for (const row of found) merged.set(String(row.providerEventId), row);
  const keepAfter = nowMs - BOZO_ESPN_KEEP_MS;
  const games = [...merged.values()].filter(g => !(Date.parse(g.startsAt || "") < keepAfter));
  for (const id of Object.keys(base.core.checked))
    if (!dueGames.some(g => String(g.espnEventId) === id)) delete base.core.checked[id];
  for (const d of Object.keys(base.dates)) if (Date.parse(base.dates[d]) < keepAfter) delete base.dates[d];

  // Precedence: an official schedule final wins; log every disagreement.
  const disagreements = [...base.disagreements];
  if (options.scheduleGames && found.length) {
    const registry = bozoBuildTeamRegistry(sport).aliases;
    const byId = new Map(options.scheduleGames.filter(g => g && g.espnEventId).map(g => [String(g.espnEventId), g]));
    for (const row of found) {
      const d = bozoEspnDisagreement(byId.get(String(row.espnEventId)), row, sport, registry);
      if (!d) continue;
      bozoEspnLog("bozo-final-disagreement", d);
      disagreements.unshift({ ...d, at: nowIso });
    }
  }
  const next = { ...prev, ...base, games, calls, checkedAt: nowIso,
    fetchedAt: anyOk ? nowIso : base.fetchedAt, via: anyOk ? via : null,
    error: anyOk ? null : (error || (spent ? "espn_error" : "espn_no_request")),
    httpStatus: anyOk ? null : httpStatus, spent,
    counts: { events, finals: found.length, inProgress },
    disagreements: disagreements.slice(0, BOZO_ESPN_DISAGREEMENTS_KEPT) };
  delete next.skipped;
  try { await env.RL.put(key, JSON.stringify(next)); } catch { /* the result below still reports the pass */ }
  return next;
}

/* One index over both live archives. ESPN rows win; an Odds API row for a game ESPN already
   has is dropped, because two equal candidates would make bozoNearestByTeams refuse both. */
function bozoLiveFinalsIndex(espnArchive, oddsArchive, sport) {
  const done = g => g && g.completed === true && g.homeScore != null && g.awayScore != null;
  const espnRows = ((espnArchive && espnArchive.games) || []).filter(done);
  const espnIndex = bozoFinalsIndex({ games: espnRows }, sport);
  const odds = ((oddsArchive && oddsArchive.games) || []).filter(done).filter(f => {
    const twin = bozoNearestByTeams(espnIndex, { startsAt: f.startsAt,
      home: { name: f.home && f.home.name, abbr: f.home && f.home.abbr },
      away: { name: f.away && f.away.name, abbr: f.away && f.away.abbr } });
    return !twin;
  });
  const index = bozoFinalsIndex({ games: [...espnRows, ...odds] }, sport);
  index.byEspnId = new Map(espnRows.map(g => [String(g.espnEventId || g.providerEventId), g]));
  return index;
}

// Event id first (both schedule feeds carry ESPN's id), then teams plus nearest kickoff.
function bozoAttachLiveFinal(index, game) {
  if (!index || !game) return null;
  const row = game.espnEventId && index.byEspnId ? index.byEspnId.get(String(game.espnEventId)) : null;
  if (row) {
    const norm = index.norm;
    const sh = norm(game.home && (game.home.name || game.home.abbr)), sa = norm(game.away && (game.away.name || game.away.abbr));
    const rh = norm(row.home && row.home.name), ra = norm(row.away && row.away.name);
    const rhAbbr = norm(row.home && row.home.abbr), raAbbr = norm(row.away && row.away.abbr);
    const swapped = (rh === sa || rhAbbr === sa) && (ra === sh || raAbbr === sh) && !(rh === sh || rhAbbr === sh);
    return { ...game, completed: true,
      homeScore: swapped ? row.awayScore : row.homeScore, awayScore: swapped ? row.homeScore : row.awayScore,
      scoreSource: row.scoreSource || "espn", source: row.source || row.scoreSource || "espn",
      scoreObservedAt: row.scoreObservedAt || null, providerEventId: row.providerEventId || null };
  }
  const attached = bozoAttachFinal(index, game);
  return attached ? { ...attached, source: attached.scoreSource } : null;
}

async function bozoLoadLiveFinals(env, sport, season) {
  let espn = null, odds = null;
  try { espn = await env.RL.get(bozoEspnArchiveKey(sport, season), "json"); } catch { espn = null; }
  try { odds = await env.RL.get(bozoScoreArchiveKey(sport, season), "json"); } catch { odds = null; }
  return { espn, odds, index: bozoLiveFinalsIndex(espn, odds, sport) };
}

/* The five-minute tick's score job. Reads the scheduled games, decides whether any is due,
   and refreshes the live archives only then. Per sport the result carries `health`, which
   opsOutcome reads:
     ok   — ESPN (or the Odds API) answered this pass, or ESPN failed while the schedule
            feeds are healthy (degraded: grading still lands, later; see `degraded`).
     fail — ESPN failed, the Odds API did not rescue it, AND the schedule feed is failing.
     noop — nothing due, or throttled. */
async function runBozoLiveScores(env, nowMs = Date.now(), season = SEASON,
    fetcher = (typeof fetch === "function" ? fetch : null)) {
  const out = {};
  let scheduleHealth = null;
  try { scheduleHealth = await env.RL.get("ops:health:bozo:schedule", "json"); } catch { scheduleHealth = null; }
  for (const sport of ["nfl", "cfb"]) {
    let doc = null;
    try { doc = await bozoScheduleDoc(env, sport, season); } catch { doc = null; }
    if (!doc || !Array.isArray(doc.games)) { out[sport] = { skipped: "no_schedule" }; continue; }
    const live = await bozoLoadLiveFinals(env, sport, season);
    const dueGames = [];
    let freshest = Infinity;
    for (const game of doc.games) {
      if (!game || game.completed) continue;
      const age = nowMs - Date.parse(game.startsAt || "");
      if (!Number.isFinite(age) || age < BOZO_SCORE_DUE_AFTER_MS || age > BOZO_SCORE_GIVE_UP_MS) continue;
      if (bozoAttachLiveFinal(live.index, game)) continue;
      dueGames.push(game);
      freshest = Math.min(freshest, age);
    }
    const due = dueGames.length;
    if (!due) { out[sport] = { due: 0 }; continue; }
    const scheduleOk = !(scheduleHealth && scheduleHealth.failing === true);
    const nowIso = new Date(nowMs).toISOString();

    // 1. ESPN.
    const espn = { attempted: false, refreshed: false, error: (live.espn && live.espn.error) || null };
    if (!fetcher) espn.error = "espn_unavailable";
    else {
      let interval = freshest >= BOZO_SCORE_DUE_AFTER_MS + BOZO_SCORE_FAST_WINDOW_MS ? BOZO_ESPN_SLOW_MS : BOZO_ESPN_REFRESH_MS;
      if (live.espn && live.espn.error) interval = Math.max(interval, BOZO_ESPN_RETRY_MS);
      const age = nowMs - Date.parse((live.espn && live.espn.checkedAt) || "");
      if (!(age >= 0 && age < interval - 60000)) {
        const next = await bozoEspnRefresh(env, sport, season, nowMs, dueGames, fetcher, { scheduleGames: doc.games });
        espn.attempted = next.checkedAt === nowIso;
        espn.refreshed = espn.attempted;
        espn.error = next.error || (next.skipped ? next.skipped : null);
        espn.via = next.via || null;
        espn.finals = next.counts ? next.counts.finals : 0;
        espn.inProgress = next.counts ? next.counts.inProgress : 0;
        if (next.skipped) espn.skipped = next.skipped;
      }
    }
    const espnOk = espn.attempted && !espn.error;

    // 2. The Odds API: optional, only while ESPN is failing.
    let odds = { skipped: "espn_ok" };
    if (!espnOk && espn.error) {
      const finals = live.odds;
      if (!env.ODDS_API_KEY) odds = { skipped: "no_key" };
      else if (finals && finals.calls && finals.calls.day === nowIso.slice(0, 10) &&
          Number(finals.calls.n) >= BOZO_SCORE_DAILY_CAP) odds = { skipped: "daily_cap" };
      else {
        // Ticks land every five minutes with jitter; a minute of slack keeps a 10-minute
        // cadence from slipping to fifteen.
        const interval = bozoScoreRefreshInterval(finals,
          freshest >= BOZO_SCORE_DUE_AFTER_MS + BOZO_SCORE_FAST_WINDOW_MS);
        const archive = await bozoFallbackScores(env, sport, season, nowMs, { minAgeMs: interval - 60000 });
        const refreshed = archive.checkedAt === nowIso;
        const unauthorized = bozoOddsUnauthorized(archive);
        odds = { refreshed, error: unauthorized ? null : (archive.errorCode || archive.error || null) };
        if (unauthorized) odds.skipped = "unauthorized";
      }
    }
    const oddsOk = odds.refreshed === true && !odds.error && !odds.skipped;
    const oddsTried = odds.refreshed === true && !odds.skipped;

    let health;
    if (espnOk || oddsOk) health = "ok";
    else if (!espn.attempted && !oddsTried) health = "noop";              // throttled pass
    else health = scheduleOk ? "ok" : "fail";
    const result = { due, health, source: espnOk ? "espn" : oddsOk ? "the-odds-api" : null, espn, odds,
      scheduleOk, refreshed: espn.refreshed || oddsTried,
      error: espnOk || oddsOk ? null : (espn.error || odds.error || null) };
    if (!espnOk && !oddsOk && health === "ok") result.degraded = "live_scores_unavailable";
    if (!espnOk && odds.skipped === "daily_cap") result.skipped = "daily_cap";   // the pre-ESPN contract
    if (health === "fail") bozoEspnLog("bozo-scores-all-sources-failed", { sport, espn: espn.error, odds: odds.error || odds.skipped || null });
    out[sport] = result;
  }
  return out;
}

// The Odds API answered 401: a missing, revoked or unsubscribed key, or spent credits.
// Optional now — quiet, never a job failure, and probed once a day (bozoScoreRefreshInterval).
function bozoOddsUnauthorized(archive) {
  return !!(archive && archive.errorCode && archive.diagnostic && archive.diagnostic.httpStatus === 401);
}
