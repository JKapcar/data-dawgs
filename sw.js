// Data Dawgs service worker — draft-night insurance.
// HTML is network-first (so deploys land immediately) with a cache fallback,
// so a dead venue wifi can't take the draft down mid-auction.
const VERSION = "a9c4556212";
const CACHE = "dd-" + VERSION;

// the pages that must survive a network drop (stats.html is 2MB — cached on first visit instead)
const CORE = [
  "/", "/index.html", "/draft-leagues.html", "/draft-league.js", "/draft-providers.js", "/draft-live-sync.js", "/dashboard.html", "/board.html", "/auction.html",
  "/bigboard.html", "/dataviz.html", "/report.html", "/master.html", "/strategy.html",
  // Lab landing pages — small, static, and the nav now points at them
  "/dfs.html", "/connect.html", "/guillotine.html", "/receipts.html", "/nfelo.html", "/survivor.html", "/survivor-settings.html", "/pound.html"
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
    await c.addAll(CORE).catch(()=>{});
    await c.addAll(CORE_MEDIA).catch(()=>{});
    await Promise.all(MEDIA.map(u =>
      fetch(u, {mode:"no-cors"}).then(r=>c.put(u, r)).catch(()=>{})
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

self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  // never cache the live-sync stream or any firebase traffic
  if(/firebaseio\.com$/.test(url.hostname) || url.hostname.endsWith("firebasedatabase.app")) return;
  // Sleeper is a live upstream source. Config and picks belong in DD's local/Firebase
  // state after normalization, never in the service-worker response cache.
  if(url.hostname === "api.sleeper.app") return;
  // ⚠️ Never touch the Worker. POSTs already bypass (the handler ignores non-GET), but
  // GET /tts/voices is an AUTHENTICATED request — the cache-first branch below would
  // store its response under a key with no notion of the passphrase, and keep serving
  // a stale voice list after Kap clones a new voice. Caught 8/4 when the list came back
  // empty on the operator page: the request was being answered by the SW, not the net.
  if(url.hostname === "toto.jkapcar4.workers.dev") return;
  // leave YouTube alone entirely — the player API and its media segments are versioned and
  // range-requested; a cache-first SW in front of them breaks playback in confusing ways.
  if(/(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)$/.test(url.hostname)) return;
  // video is range-requested; a cached full-body response breaks seeking — let it through
  if(url.pathname.endsWith(".mp4") || url.pathname.endsWith(".webm")) return;
  // ⚠️ /data/ is the machine-readable mirror and llms.txt is its index. The catch-all below
  // is cache-first, which would pin a dated snapshot in the browser forever and serve a
  // stale as_of long after the file was rebuilt. Freshness is the whole point of these
  // files — let them go straight to the network. No VERSION bump needed: this path was
  // never cached, so there is nothing stale to evict.
  if(url.pathname.startsWith("/data/") || url.pathname === "/llms.txt") return;

  if(isHTML(req)){
    // network-first, 4s budget, fall back to whatever we cached
    e.respondWith((async()=>{
      try{
        const net = await Promise.race([
          fetch(req),
          new Promise((_,rej)=>setTimeout(()=>rej(new Error("slow")), 4000))
        ]);
        const c = await caches.open(CACHE);
        c.put(new Request(url.pathname), net.clone()).catch(()=>{});
        return net;
      }catch(err){
        const c = await caches.open(CACHE);
        return (await c.match(new Request(url.pathname)))
            || (await c.match(url.pathname))
            || (await c.match("/index.html"))
            || new Response("<h1>Offline</h1><p>This page hasn't been cached yet.</p>",
                            {headers:{"Content-Type":"text/html"}});
      }
    })());
    return;
  }

  // images / fonts / everything else: cache-first, fill the cache in the background
  e.respondWith((async()=>{
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if(hit) return hit;
    try{
      const net = await fetch(req);
      if(net && (net.ok || net.type === "opaque")) c.put(req, net.clone()).catch(()=>{});
      return net;
    }catch(err){
      return hit || Response.error();
    }
  })());
});
