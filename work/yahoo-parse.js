/* ===================== Yahoo public-league HTML adapter ====================
 * Yahoo's Fantasy API is access-gated behind a manual application review with
 * no published turnaround. A PUBLIC Yahoo league renders every input this site
 * needs on pages that require no cookie at all, and the Worker can read them
 * server-side where CORS does not apply. These are the pure parsers over that
 * HTML. Verified against league 773763 on 2026-09-02.
 *
 * ⚠️ THIS IS A SCRAPER AND IT WILL EVENTUALLY BREAK. Yahoo owes us no markup
 * stability. The design premise is that it breaks LOUDLY: every parser reports
 * what it found alongside what it expected, and the feed refuses to serve a
 * partial league. A half-read league that renders anyway is worse than an
 * error — it would put wrong replacement level and wrong money on a page whose
 * entire claim is that its numbers are checkable.
 *
 * Swap target: when the API application is approved only the fetch layer
 * changes. Everything downstream reads the same body shape as espnWarroomFeed.
 *
 * ---- What is and is not available server-side (measured, not assumed) ------
 *  /f1/<lg>/draftresults   210 rows, Pick | Player | Salary | Team.      ✅
 *  /f1/<lg>/<teamId>       lineup table, slot + player, incl. empty slots ✅
 *  /f1/<lg>?week=N         that week's matchups, week echoed in header    ✅
 *  /f1/<lg>/settings       scoring + playoffs + team count                ✅
 *      ⚠️ EXCEPT "Roster Positions", which that page builds in JavaScript and
 *      is therefore absent from the HTML a Worker sees. The lineup shape is
 *      taken from a roster page instead, where it is present as real rows.
 *      Do not "fix" this by adding a settings-page regex; there is nothing
 *      there to match.
 * ========================================================================= */

/* Yahoo slot label -> this site's slot vocabulary (Sleeper's, which the War
   Room speaks everywhere). W/R/T is Yahoo's flex; Q/W/R/T its superflex. */
const YAHOO_SLOT = {
  "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K",
  "DEF": "DST", "D/ST": "DST", "DL": "DL", "LB": "LB", "DB": "DB",
  "W/R": "FLEX", "W/T": "FLEX", "R/W": "FLEX", "W/R/T": "FLEX", "R/W/T": "FLEX",
  "Q/W/R/T": "SUPERFLEX", "QB/WR/RB/TE": "SUPERFLEX",
  "BN": "BN", "IR": "IR", "IR+": "IR", "NA": "IR",
};
const YAHOO_POS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DST", "D/ST": "DST" };

/* ---- tiny HTML helpers ---------------------------------------------------
 * Deliberately NOT a general HTML parser. Each keys off a semantic class token
 * or an href shape Yahoo must keep for its own page to work — a far better bet
 * than nesting depth or attribute order. */
function ydecode(s) {
  return String(s == null ? "" : s)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ").trim();
}
function ystrip(html) { return ydecode(String(html).replace(/<[^>]*>/g, " ")); }
function yrows(html) { return String(html).split(/<tr\b/i).slice(1); }

/* ⚠️ Match the class ATTRIBUTE, then test its tokens. The first version of this
   tried to match the token inside the attribute with a `(?:^|\s|")` prefix and
   silently returned null for `class="player"` — a token with nothing before it —
   while still working for `class="Alt Ta-start player"`. The result was a draft
   page that parsed to zero picks and a roster page that parsed perfectly, which
   is exactly the kind of half-success this file exists to prevent. */
function ycells(rowHtml) {
  const re = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
  const out = [];
  let m;
  while ((m = re.exec(rowHtml))) out.push({ attrs: m[2], html: m[3] });
  return out;
}
function ycell(rowHtml, token) {
  for (const c of ycells(rowHtml)) {
    const cls = (/class="([^"]*)"/i.exec(c.attrs) || [])[1] || "";
    if (cls.split(/\s+/).indexOf(token) >= 0) return c.html;
  }
  return null;
}
/* Every player anchor on every Yahoo fantasy page points at the same canonical
   NFL player page. That numeric id is the most stable identifier on the page.
   Defenses carry no such link — see ynamePos. */
function ypid(fragment) {
  const m = /sports\.yahoo\.com\/nfl\/players\/(\d+)/.exec(String(fragment || ""));
  return m ? m[1] : null;
}
/* "Matthew Stafford (LAR - QB)" / "Ravens (Bal - DEF)" / "--empty-- ( - )" */
function ynamePos(cellHtml) {
  const raw = ystrip(cellHtml);
  const compact = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(raw);
  /* Draft rows use the compact text above. Roster rows wrap the name, status icons,
     opponent, and notes in the same cell; use the canonical name anchor and the explicit
     "TEAM - POS" detail instead of treating all of that chrome as the player's name. */
  const nameAnchor = /<a\b(?=[^>]*class="[^"]*\bname\b)[^>]*>([\s\S]*?)<\/a>/i.exec(String(cellHtml));
  const playerAnchor = /<a\b[^>]*href="https?:\/\/sports\.yahoo\.com\/nfl\/players\/\d+"[^>]*>([\s\S]*?)<\/a>/i.exec(String(cellHtml));
  const name = ydecode(playerAnchor ? ystrip(playerAnchor[1]) : nameAnchor ? ystrip(nameAnchor[1]) : compact ? compact[1] : raw);
  const detail = /\b([A-Za-z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF|D\/ST)\b/i.exec(raw);
  const parts = (compact ? compact[2] : "").split("-").map(s => s.trim());
  const posRaw = detail ? detail[2] : parts.length > 1 ? parts[parts.length - 1] : "";
  const team = detail ? detail[1] : parts.length > 1 ? parts[0] : "";
  return {
    name, team: team.toUpperCase(), posRaw,
    pos: YAHOO_POS[posRaw.toUpperCase()] || "",
    empty: /^--?\s*empty\s*--?$/i.test(name) || /^\(?\s*empty\s*\)?$/i.test(name) || !name,
  };
}
/* The join key the rest of the site uses. Defenses have no Yahoo player id, and
   the site's Market Value table already keys them by team abbreviation, so a
   defense becomes "dst:SEA" on both sides rather than being dropped. */
function yahooPlayerKey(pid, np) {
  if (np.pos === "DST") return np.team ? "dst:" + np.team : null;
  return pid ? "y:" + pid : null;
}

/* ---- team ids and names --------------------------------------------------
 * Team links are /f1/<leagueId>/<teamId>. Yahoo prints each team many times per
 * page (avatar, name, matchup), so order-preserving dedupe is the whole trick.
 * "My Team" is Yahoo's nav label for the viewer's own team, never a team name. */
function yahooTeamIds(html, leagueId) {
  const re = new RegExp('/f1/' + String(leagueId) + '/(\\d+)"', 'g');
  const ids = [];
  let m;
  while ((m = re.exec(html))) if (ids.indexOf(m[1]) < 0) ids.push(m[1]);
  return ids;
}
function yahooParseTeams(html, leagueId) {
  const re = new RegExp('href="(?:https?://[^"]*)?/f1/' + String(leagueId) + '/(\\d+)"[^>]*>([\\s\\S]{0,200}?)</a>', 'gi');
  const byId = new Map();
  let m;
  while ((m = re.exec(html))) {
    const name = ystrip(m[2]);
    if (!name || /^my team$/i.test(name)) continue;
    if (!byId.has(m[1])) byId.set(m[1], name);
  }
  const teams = [...byId.entries()].map(([id, name]) => ({ id, name }))
    .sort((a, b) => Number(a.id) - Number(b.id));
  return { teams, found: teams.length };
}

/* ---- draft results -------------------------------------------------------
 * ⚠️ Undrafted slots render as "--empty-- ( - )" at $0. A $0 here is NOT a
 * price, it is the absence of one, and letting it through would hand a free
 * player to every surplus number on the Money tab. Skipped and counted.
 * Measured on 773763: 210 rows = 149 linked players + defenses + empties. */
function yahooParseDraft(html) {
  const picks = [];
  let empty = 0, unkeyed = 0, ownerless = 0, rows = 0;
  for (const row of yrows(html)) {
    const playerCell = ycell(row, "player");
    const costCell = ycell(row, "cost");
    if (playerCell == null || costCell == null) continue;
    rows++;
    const np = ynamePos(playerCell);
    if (np.empty) { empty++; continue; }
    const key = yahooPlayerKey(ypid(playerCell), np);
    if (!key) { unkeyed++; continue; }
    const teamCell = ycell(row, "team-name");
    const owner = teamCell == null ? null : ystrip(teamCell);
    if (!owner) { ownerless++; continue; }
    const cm = /\$\s*([\d,]+)/.exec(ystrip(costCell));
    picks.push({
      key, pid: ypid(playerCell), name: np.name, pos: np.pos, team: np.team,
      cost: cm ? Number(cm[1].replace(/,/g, "")) : null, owner,
    });
  }
  return { picks, rows, found: picks.length, empty, unkeyed, ownerless };
}

/* ---- one team's roster ---------------------------------------------------
 * ⚠️ The SLOT decides starter vs bench and it is the only place that
 * information exists — a player's own position cannot tell you whether he is
 * starting. BN and IR are the bench; everything else starts.
 * Empty slots are recorded, not skipped: they are how the league's lineup shape
 * is recovered without the settings page (see the header note). */
function yahooParseRoster(html, teamId) {
  const players = [];
  const shape = {};
  const unknownSlots = [];
  let emptySlots = 0;
  for (const row of yrows(html)) {
    const posCell = ycell(row, "pos");
    if (posCell == null) continue;
    const slotRaw = ystrip(posCell).toUpperCase();
    if (!slotRaw || slotRaw === "POS") continue;
    const slot = YAHOO_SLOT[slotRaw];
    if (!slot) { unknownSlots.push(slotRaw); continue; }   // report, never guess
    shape[slot] = (shape[slot] || 0) + 1;
    const playerCell = ycell(row, "player");
    const np = playerCell ? ynamePos(playerCell) : null;
    const key = np ? yahooPlayerKey(ypid(playerCell), np) : null;
    if (!np || np.empty || !key) { emptySlots++; continue; }
    players.push({
      key, pid: ypid(playerCell), name: np.name, pos: np.pos, team: np.team,
      slot, starter: slot !== "BN" && slot !== "IR",
    });
  }
  /* "<league> - <team> | Fantasy Football | Yahoo! Sports" */
  const tm = /<title>\s*(.*?)\s+-\s+(.*?)\s*\|/i.exec(html);
  return {
    teamId: String(teamId),
    leagueName: tm ? ydecode(tm[1]) : "",
    teamName: tm ? ydecode(tm[2]) : "",
    players, shape, unknownSlots,
    found: players.length, emptySlots, slotCount: players.length + emptySlots,
  };
}

/* ---- schedule ------------------------------------------------------------
 * /f1/<lg>?week=N. Team ids appear inside the matchups module in pair order,
 * so distinct-ids-in-document-order chunked by two IS the week's matchups.
 *
 * ⚠️ TWO TRAPS, BOTH OF WHICH PRODUCE CONFIDENT WRONG ANSWERS:
 *  1. The browser will happily serve every ?week=N from cache, making all 17
 *     weeks identical while every sanity check still passes. Fetch with
 *     cache: "no-store", and
 *  2. verify the week Yahoo actually rendered against the week asked for. The
 *     module prints "Week N Matchups"; if that N disagrees, the page is not the
 *     page requested and the week must be discarded, not stored under the
 *     wrong index. */
function yahooParseWeek(html, leagueId, expectWeek) {
  const i = html.search(/Tst-matchups-body/i);
  if (i < 0) return { ok: false, reason: "no-matchups-module", pairs: [] };
  const j = html.indexOf("Tst-standings", i);
  const mod = html.slice(i, j > i ? j : i + 120000);

  const hdr = /Week\s+(\d+)\s+Matchups/i.exec(mod);
  const saw = hdr ? Number(hdr[1]) : null;
  if (expectWeek != null && saw != null && saw !== Number(expectWeek))
    return { ok: false, reason: "week-mismatch", asked: Number(expectWeek), saw, pairs: [] };

  const ids = yahooTeamIds(mod, leagueId);
  const pairs = [];
  for (let k = 0; k + 1 < ids.length; k += 2) pairs.push([ids[k], ids[k + 1]]);
  return { ok: true, week: saw, teams: ids.length, pairs };
}
/* A week is only usable if every team appears exactly once. Anything else means
   the module held something other than a clean round of matchups. */
function yahooWeekIsSane(week, teamCount) {
  if (!week.ok) return false;
  const flat = week.pairs.reduce((a, p) => a.concat(p), []);
  return flat.length === teamCount && new Set(flat).size === teamCount;
}

/* ---- settings ------------------------------------------------------------
 * A plain label/value table plus the stat-modifier rows. Only what the War Room
 * consumes is read; nothing else is half-modelled. Roster Positions is NOT here
 * (see header) — take the shape from yahooParseRoster().shape. */
/* ⚠️ Splitting a row on "</td>" and stripping tags leaves the opening <tr>'s
   own attributes glued to the first cell (" class=\"...\">Max Teams:"), so the
   label never matches and every setting silently reads null — which is how this
   returned an all-null settings object against the real page while looking
   fine. Cells come from ycells(), which matches whole <td>…</td> elements. */
function yahooSettingRow(html, label) {
  const re = new RegExp("^" + label + "\\s*:?$", "i");
  for (const row of yrows(html)) {
    const cells = ycells(row).map(c => ystrip(c.html));
    const first = cells.findIndex(c => c);
    if (first < 0) continue;
    if (re.test(cells[first])) return cells[first + 1] == null ? "" : cells[first + 1];
  }
  return null;
}
function yahooParseSettings(html) {
  const playoffs = yahooSettingRow(html, "Playoffs");
  const maxTeams = yahooSettingRow(html, "Max Teams");
  const fractional = yahooSettingRow(html, "Fractional Points");
  const rec = yahooSettingRow(html, "Receptions");

  /* "6 teams - Week 15, 16 and 17 (ends Monday, Jan 4)" */
  const pt = /(\d+)\s*teams?/i.exec(playoffs || "");
  const pw = /Week\s+(\d+)/i.exec(playoffs || "");
  const recPts = rec == null ? null : Number(String(rec).replace(/[^0-9.]/g, ""));

  return {
    teams: maxTeams ? Number(maxTeams) : null,
    playoffTeams: pt ? Number(pt[1]) : null,
    playoffStart: pw ? Number(pw[1]) : null,
    fractional: fractional == null ? null : /^yes$/i.test(fractional),
    /* reception points is what picks this site's Market Value column */
    rec: Number.isFinite(recPts) ? recPts : null,
    playoffsRaw: playoffs,
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = {
  YAHOO_SLOT, YAHOO_POS, ydecode, ystrip, yrows, ycells, ycell, ypid, ynamePos,
  yahooPlayerKey, yahooTeamIds, yahooParseTeams, yahooParseDraft,
  yahooParseRoster, yahooParseWeek, yahooWeekIsSane, yahooParseSettings,
};
