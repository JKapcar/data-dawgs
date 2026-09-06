// Data Dawgs service worker — draft-night insurance.
// VERSION = md5 of every *.html and *.js in the repo root (sw.js itself excluded),
// concatenated in sorted order, first 10 hex. It covers the scripts as well as the
// pages because the draft rig's behaviour lives in draft-*.js: hashing only the HTML
// meant a JS-only fix never invalidated a phone's cache.
// HTML is network-first (so deploys land immediately) with a cache fallback,
// so a dead venue wifi can't take the draft down mid-auction.
const VERSION = "9e18afde05";
// A policy revision also invalidates old caches when only this file changes.
const CACHE = "dd-" + VERSION + "-public-v2";

// the pages that must survive a network drop (stats.html is 2MB — cached on first visit instead)
const CORE = [
  "/", "/index.html", "/draft-leagues.html", "/draft-league.js", "/draft-personal-sync.js", "/draft-providers.js", "/draft-live-sync.js", "/dashboard.html", "/board.html", "/auction.html",
  "/bigboard.html", "/dataviz.html", "/report.html", "/master.html", "/strategy.html",
  // Lab landing pages — small, static, and the nav now points at them
  "/dfs.html", "/signon.html", "/connect.html", "/guillotine.html", "/receipts.html", "/nfelo.html", "/survivor.html", "/survivor-settings.html", "/pound.html", "/dawghouse.html",
  "/cfb.html", "/cfb-power.html", "/calculators.html", "/arena.html", "/fantasy-warroom.html", "/teamdraft.html", "/data.html", "/nfl.html",
  "/dawgs.html", "/swoledawg.html", "/datedawg.html",
  // The challenge board is worth having offline: the schedule and the model lines still
  // render from cache, and a save that cannot reach the Worker fails visibly rather than
  // looking like it worked.
  "/challenge.html",
  // the weekly game and the sign-on helper are opened on phones like everything else
  "/bozo.html", "/dawg-slate.js", "/dd-live-state.js",
  // installed to a home screen, these are what the launcher asks for
  "/manifest.webmanifest", "/assets/icon-192.png", "/assets/icon-512.png", "/assets/icon-180.png"
];
// the horn is precached, not left to cache-first on first play: draft night is the
// first time it ever fires, and a venue wifi hiccup at that exact moment would eat it
const CORE_MEDIA = ["/superbowlsuperbrowns.m4a"];
// celebration photos, so SUPER BOWL SUPER BROWNS still fires offline
const MEDIA = [
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Cleveland%2C_Ohio_Skyline_at_Sunrise_at_Edgewater_Park_%288669269938%29.jpg/960px-Cleveland%2C_Ohio_Skyline_at_Sunrise_at_Edgewater_Park_%288669269938%29.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Cleveland_Browns_Stadium_2012.jpg/960px-Cleveland_Browns_Stadium_2012.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Terminal_Tower_from_Cuyahoga_River_Cropped.jpg/960px-Terminal_Tower_from_Cuyahoga_River_Cropped.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Cleveland_Sign_at_Edgewater_Park_%2827624106630%29.jpg/960px-Cleveland_Sign_at_Edgewater_Park_%2827624106630%29.jpg"
];

self.addEventListener("install", e=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    // core pages must all land; media is best-effort (cross-origin, opaque)
    // addAll is atomic — one bad entry throws away the entire precache with no signal.
    // Per-URL adds mean a typo costs one page instead of the whole offline story.
    const misses = [];
    await Promise.all(CORE.concat(CORE_MEDIA).map(u =>
      fetch(u).then(async r=>{
        if(!canStore(r)) throw new Error("not_public");
        await c.put(u, r);
      }).catch(()=>{ misses.push(u); })
    ));
    if(misses.length) console.warn("[dd-sw] precache missed:", misses);
    await Promise.all(MEDIA.map(u =>
      fetch(u, {mode:"no-cors", credentials:"omit"}).then(r=>{
        if(canStore(r, true)) return c.put(u, r);
      }).catch(()=>{})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("dd-") && k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

const isHTML = req =>
  req.mode === "navigate" ||
  (req.headers.get("accept")||"").includes("text/html");

// CacheStorage does not enforce HTTP cache directives. Check them explicitly, and
// admit public files rather than maintaining a growing denylist of live providers.
function canStore(response, allowOpaque = false){
  if(allowOpaque && response?.type === "opaque") return true;
  if(!response || response.status !== 200 || response.redirected) return false;
  const cc = response.headers.get("cache-control") || "";
  const vary = response.headers.get("vary") || "";
  return !/(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(cc) &&
    !/(?:^|,)\s*(?:\*|authorization|cookie)\s*(?:,|$)/i.test(vary) &&
    !/application\/(?:[^;]+\+)?json|text\/event-stream/i.test(response.headers.get("content-type") || "");
}
function publicRequest(req){
  const url = new URL(req.url);
  if(req.method !== "GET" || req.cache === "no-store" || req.headers.has("authorization") ||
     /no-store|no-cache/i.test(req.headers.get("cache-control") || "")) return false;
  if(req.headers.has("range") && !(url.origin===self.location.origin && CORE_MEDIA.includes(url.pathname))) return false;
  if(url.origin !== self.location.origin) return MEDIA.includes(url.href);
  // Only known non-secret routing/version parameters are admitted. Credential URLs
  // never become keys or overwrite the query-free offline copy of a public page.
  const routing = new Set(["l", "league", "room", "view", "week", "season", "v"]);
  if([...url.searchParams.keys()].some(k=>!routing.has(k))) return false;
  return url.pathname === "/" ||
    /^\/[a-z0-9_-]+\.(?:html|js|css|webmanifest|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|m4a|mp3|ogg)$/i.test(url.pathname) ||
    /^\/assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|m4a|mp3|ogg)$/i.test(url.pathname);
}
async function cached(key){
  try { return await (await caches.open(CACHE)).match(key); }
  catch { return null; } // Storage denied/full must not prevent a network load.
}
async function save(key, response, allowOpaque = false){
  try{
    const c = await caches.open(CACHE);
    if(canStore(response, allowOpaque)) await c.put(key, response.clone());
    else await c.delete(key);
  }catch{ /* Cache quota/privacy restrictions do not fail the page request. */ }
}
async function fetchWithinBudget(req){
  let timer;
  try{
    return await Promise.race([
      fetch(req), new Promise((_, reject)=>{ timer=setTimeout(()=>reject(new Error("slow")), 4000); })
    ]);
  }finally { clearTimeout(timer); }
}
async function savedPage(response){
  const body = await response.text();
  const notice = '<div id="dd-offline-notice" role="status" style="padding:12px 18px;background:#fff1c2;color:#291b00;font:16px/1.4 system-ui">Saved page — the latest page could not be loaded. Live information may be out of date.</div>';
  const html = /<body\b[^>]*>/i.test(body)
    ? body.replace(/<body\b[^>]*>/i, tag=>tag+notice) : notice+body;
  const headers = new Headers(response.headers);
  for(const key of ["content-length", "content-encoding", "etag"]) headers.delete(key);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("x-dd-saved-copy", "1");
  return new Response(html, {status:200, headers});
}
async function coreMediaRange(req){
  // Safari requests even the offline horn in byte ranges. Never cache a 206 or
  // return a complete audio body as a partial response; slice the public precache.
  const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  const hit=match && await cached(new URL(req.url).pathname);
  if(!hit || (!match[1] && !match[2])) return fetch(req);
  const bytes=await hit.arrayBuffer(), length=bytes.byteLength;
  const start=match[1] ? Number(match[1]) : Math.max(0,length-Number(match[2]));
  const end=match[1] && match[2] ? Math.min(length-1,Number(match[2])) : length-1;
  const headers=new Headers(hit.headers);
  headers.delete("content-encoding");
  headers.set("accept-ranges","bytes");
  if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=length){
    headers.set("content-range","bytes */"+length); headers.set("content-length","0");
    return new Response(null,{status:416,headers});
  }
  headers.set("content-range",`bytes ${start}-${end}/${length}`);
  headers.set("content-length",String(end-start+1));
  return new Response(bytes.slice(start,end+1),{status:206,headers});
}
async function networkFirst(req, key){
  let net;
  try{
    net = await fetchWithinBudget(req);
    if(net.status < 500){ await save(key, net); return net; }
  }catch{ /* An interrupted or slow network may use the existing public file. */ }
  const hit = await cached(key);
  if(hit) return isHTML(req) ? savedPage(hit) : hit;
  return net || (isHTML(req)
    ? new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline — Data Dawgs</title><body><h1>This page is unavailable offline</h1><p>Reconnect and reload. No saved copy of this page is available.</p></body></html>',
        {status:503, headers:{"content-type":"text/html; charset=utf-8", "cache-control":"no-store"}})
    : Response.error());
}
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(!publicRequest(req)) return;
  const url = new URL(req.url);
  const documentRequest = isHTML(req);
  const key = documentRequest ? url.origin + url.pathname : req;
  const work = req.headers.has("range") ? coreMediaRange(req)
    : documentRequest || /\.(?:js|css|webmanifest)$/i.test(url.pathname)
    ? networkFirst(req, key)
    : (async()=>{
        const hit = await cached(key);
        if(hit) return hit;
        try{
          const net = await fetch(req);
          await save(key, net, MEDIA.includes(url.href));
          return net;
        }catch{ return Response.error(); }
      })();
  e.respondWith(work);
  // Keep cache writes alive for this fetch; a successful response must not be lost
  // simply because the worker's lifetime ended before a detached put() finished.
  e.waitUntil(work.then(()=>{}, ()=>{}));
});
