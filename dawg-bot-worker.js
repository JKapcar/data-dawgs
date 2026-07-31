/**
 * Dawg Bot proxy — Cloudflare Worker
 * ----------------------------------
 * Why this exists: datadawgs216.com is a static site in a PUBLIC repo, so an API key
 * placed in the page is readable by anyone (and harvested by scrapers within hours).
 * This Worker holds the key server-side. The site calls the Worker; the Worker calls xAI.
 * Visitors never see the key and never paste anything except a shared league passphrase.
 *
 * SECRETS TO SET (Cloudflare dashboard → your Worker → Settings → Variables → "Encrypt"):
 *   XAI_KEY    = your xai-... key          (never appears in this file, never in the repo)
 *   DAWG_PASS  = the league passphrase you tell your leaguemates
 * OPTIONAL plain variables:
 *   MODEL      = grok-4-1-fast             (default if unset)
 *   DAILY_CAP  = 400                       (max requests per UTC day across everyone)
 *
 * OPTIONAL but recommended: bind a KV namespace named RL to enable the daily cap.
 * Without it the Worker still runs — it just won't count requests.
 */

const ORIGINS = [
  "https://datadawgs216.com",
  "https://www.datadawgs216.com",
  "https://jkapcar.github.io",
];

const UPSTREAM = "https://api.x.ai/v1/chat/completions";
const MAX_BODY = 24_000;   // bytes — the draft context is ~3KB; this is generous
const MAX_TOKENS = 800;    // hard ceiling regardless of what the client asks for
const MAX_MSGS = 12;       // keep history bounded

function corsFor(origin) {
  const allow = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Content-Type, X-Dawg-Pass",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsFor(origin);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    // Only our own pages may call this. Not a security boundary on its own
    // (Origin is trivially forged outside a browser) — the passphrase is.
    if (!ORIGINS.includes(origin)) return json({ error: "Bad origin." }, 403, cors);

    if (!env.XAI_KEY) return json({ error: "Worker misconfigured: XAI_KEY secret not set." }, 500, cors);
    if (!env.DAWG_PASS) return json({ error: "Worker misconfigured: DAWG_PASS secret not set." }, 500, cors);

    // --- league passphrase ---
    const pass = request.headers.get("X-Dawg-Pass") || "";
    if (!timingSafeEqual(pass, env.DAWG_PASS)) {
      return json({ error: "Wrong league passphrase." }, 401, cors);
    }

    // --- daily cap (only if a KV namespace named RL is bound) ---
    const cap = parseInt(env.DAILY_CAP || "400", 10);
    if (env.RL) {
      const day = new Date().toISOString().slice(0, 10);
      const key = "count:" + day;
      const used = parseInt((await env.RL.get(key)) || "0", 10);
      if (used >= cap) {
        return json(
          { error: `Dawg Bot hit its daily cap (${cap} questions). Resets at midnight UTC.` },
          429, cors
        );
      }
      // expireTtl clears the counter automatically ~2 days out
      await env.RL.put(key, String(used + 1), { expirationTtl: 172800 });
    }

    // --- read and sanity-check the body ---
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: "Request too large." }, 413, cors);

    let body;
    try { body = JSON.parse(raw); }
    catch { return json({ error: "Bad JSON." }, 400, cors); }

    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MSGS) : [];
    if (!messages.length) return json({ error: "No messages." }, 400, cors);

    // Model and token ceiling are pinned HERE, not by the client — otherwise a hostile
    // caller could point your key at an expensive model and run up the bill.
    const payload = {
      model: env.MODEL || "grok-4-1-fast",
      max_tokens: Math.min(MAX_TOKENS, parseInt(body.max_tokens, 10) || 700),
      messages,
    };

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.XAI_KEY,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: "Couldn't reach the AI provider: " + e.message }, 502, cors);
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};

// Constant-time-ish compare so the passphrase can't be guessed a character at a time.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
