// ============================================================
//  /survivor-picks — add to the existing toto Worker.
//  Serves weekly survivor pick popularity to survivor.html.
//
//  ⚠️ READ THIS BEFORE WIRING AN UPSTREAM SCRAPE.
//  The obvious sources (SurvivorGrid, PoolGenius, TeamRankings) are commercial
//  products whose terms may forbid automated collection, and none of them
//  publish a documented API. A scraper against them is both a legal question
//  and a thing that silently breaks the first time they change a class name —
//  and a survivor board running on stale ownership is worse than one that
//  admits it has none.
//
//  So the PRIMARY path here is PUSH, not pull: you POST the week's numbers
//  once (paste, curl, or the board's own paste box), the Worker stores them in
//  KV, and every device reads the same figures. No scraping, no fragility, no
//  terms problem. UPSTREAM below is left unset on purpose — fill it in only if
//  you have a source you are entitled to poll.
// ============================================================

const ALLOW = ['https://datadawgs216.com', 'https://jkapcar.github.io'];
const UPSTREAM = null;          // e.g. 'https://example.com/api/picks?week=' — see note above

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
    'Access-Control-Allow-Headers': 'Content-Type,X-Dawg-Pass',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}
const json = (body, status, origin) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...cors(origin) }
});
const key = (season, week) => `survivor:${season}:${week}`;

// Normalise to { TEAM: share } with shares summing to 1.
// Accepts percents or fractions; rejects the row rather than guessing.
function normalise(raw) {
  const out = {}; const bad = [];
  for (const k of Object.keys(raw || {})) {
    const code = String(k).toUpperCase().replace(/[^A-Z]/g, '');
    const v = Number(raw[k]);
    if (!code || !Number.isFinite(v) || v < 0) { bad.push(k); continue; }
    out[code] = (out[code] || 0) + v;
  }
  let tot = 0; for (const k in out) tot += out[k];
  if (tot <= 0) return { picks: {}, bad, total: 0 };
  for (const k in out) out[k] = out[k] / tot;
  return { picks: out, bad, total: tot };
}

// GET  /survivor-picks?season=2026&week=3
// POST /survivor-picks?season=2026&week=3   body: {"picks":{"KC":21.4,"PHI":15.2}}
//      header X-Dawg-Pass must match env.DAWG_PASS
export async function handleSurvivorPicks(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const season = Number(url.searchParams.get('season')) || new Date().getUTCFullYear();
  const week = Number(url.searchParams.get('week'));
  if (!(week >= 1 && week <= 18)) return json({ error: 'week must be 1-18' }, 400, origin);

  if (request.method === 'POST') {
    // ⚠️ Gated. Without this anyone can rewrite the ownership every device reads,
    // which is a quiet way to make the board recommend whatever they like.
    if (!env.DAWG_PASS || request.headers.get('X-Dawg-Pass') !== env.DAWG_PASS) {
      return json({ error: 'unauthorised' }, 401, origin);
    }
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
    const { picks, bad, total } = normalise(body && body.picks);
    if (!Object.keys(picks).length) return json({ error: 'no usable rows', bad }, 400, origin);
    const rec = { season, week, picks, source: (body && body.source) || 'manual',
                  stored: Date.now(), rows: Object.keys(picks).length, rawTotal: total };
    await env.DD_KV.put(key(season, week), JSON.stringify(rec));
    return json({ ok: true, ...rec, ignored: bad }, 200, origin);
  }

  // --- GET: stored value first
  const hit = await env.DD_KV.get(key(season, week));
  if (hit) {
    const rec = JSON.parse(hit);
    const ageH = (Date.now() - rec.stored) / 3.6e6;
    // Ownership moves all week. Serve it, but never let the page believe a
    // Tuesday number is a Sunday number — the page decides what to do with this.
    return json({ ...rec, ageHours: Math.round(ageH * 10) / 10, stale: ageH > 72 }, 200, origin);
  }

  if (!UPSTREAM) {
    return json({ error: 'no pick data stored for this week',
                  hint: 'POST it to this route, or paste it into the board' }, 404, origin);
  }
  try {
    const r = await fetch(`${UPSTREAM}${week}`, {
      cf: { cacheTtl: 900, cacheEverything: true },
      headers: { 'User-Agent': 'data-dawgs-survivor/1' }
    });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const { picks, bad } = normalise(await r.json());
    if (!Object.keys(picks).length) throw new Error('upstream returned nothing usable');
    const rec = { season, week, picks, source: 'upstream', stored: Date.now(),
                  rows: Object.keys(picks).length, ignored: bad };
    await env.DD_KV.put(key(season, week), JSON.stringify(rec), { expirationTtl: 86400 });
    return json({ ...rec, ageHours: 0, stale: false }, 200, origin);
  } catch (e) {
    // Fail loudly. The board falls back to MODELLED ownership and says so on
    // the page; a 200 with an empty object would hide that.
    return json({ error: 'picks unavailable', detail: String(e) }, 502, origin);
  }
}

// Wire into the Worker's existing fetch handler, beside /scores:
//
//   if (url.pathname === '/survivor-picks') return handleSurvivorPicks(request, env);
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { headers: cors(request.headers.get('Origin') || '') });
//   }
//
// Needs: a KV namespace bound as DD_KV, and a secret DAWG_PASS.
//   wrangler kv:namespace create DD_KV
//   wrangler secret put DAWG_PASS
//
// Push a week from the command line:
//   curl -X POST 'https://toto.datadawgs216.com/survivor-picks?season=2026&week=1' \
//     -H 'X-Dawg-Pass: <secret>' -H 'Content-Type: application/json' \
//     -d '{"picks":{"KC":21.4,"PHI":15.2,"BUF":11.8},"source":"survivorgrid 9/4"}'
