/* Bozo — playbill header, Royale demoted to the bottom, methodology in drawers.
 *
 * Run: node work/test-bozo-header.mjs      (needs playwright; serves the repo on :8813)
 *
 * ⚠️ WHAT THIS IS ACTUALLY GUARDING.
 * The three changes here are all about WHERE a fact is rendered, and the failure mode
 * for that class of change is not "it looks wrong" — it is "it now renders twice, and
 * the two copies can disagree". So most of what follows counts appearances rather than
 * checking that something exists: the week number belongs to the band and nowhere else,
 * the roster belongs to the cast strip and nowhere else. A test that only asserted the
 * new markup is present would pass with both the old and the new copy on the page.
 *
 * The second thing it guards is what must NOT be behind a click. The demo warning and
 * the coverage counts are claims about the numbers on screen, so they are asserted
 * visible with every <details> still closed.
 *
 * The page is loaded for real against stubbed network — RTDB and the Worker are routed,
 * nothing else is. `page.on('pageerror')` fails the run: that is what catches a handler
 * left bound to a node that was deleted, which is exactly how #meCard could take the
 * whole page down on the way out.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
// ⚠️ The repo installs playwright WITHOUT its browsers and drives the system Chrome
// instead — same resolution helper every other suite here uses.
import { chromiumExecutable } from "./playwright-loader.mjs";

const WORK = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WORK, "..");
const PORT = 8813;
const MEMBERS = ["Butts", "JWhite", "Kap", "Manzeo", "Squatch", "The Kid", "Tony", "Tucholski"];

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name, extra === undefined ? "" : "→ " + extra); }
};

/* A session token the page will accept: base64url(payload) + "." + a signature it never
   checks. Only the Worker can verify one; loadSession only decodes the name and expiry. */
const b64url = o => Buffer.from(JSON.stringify(o)).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const session = name => b64url({ n: name, e: Date.now() + 30 * 86400e3 }) + ".sig";

const legs = () => Object.fromEntries(MEMBERS.map((m, i) => [encodeURIComponent(m), {
  price: -150 - i * 10, sport: "nfl", mkt: "spread", line: -3.5, side: "KC",
  game: "KC vs DEN", eventId: "g" + i, ts: 1759990000000 + i * 1000,
}]));

const STD_SETTINGS = {
  stake: 50, allowEdit: true, lockRule: "all", lockCount: 0, levers: [0, 1, 2, 3],
  format: "standard", buyback: 0, formatLocked: false, synthetic: false,
};

/* ---- a Royale league at week 22: five chopped, two of them re-deployed on the way ----
   ⚠️ `chops` deliberately carries BOTH spellings and a null at index 0. The null is what
   Firebase produces from an object keyed by sequential week numbers, and the old spelling
   is what a chop written before the re-deploy rename looks like. Both are the exact
   shapes the page's guards exist for, so both are in the fixture rather than described
   in a comment. */
const CHOPS = [
  null,                                                                       // ⚠️ Firebase's hole
  { week: 4,  chopped: "Squatch", decidedBy: "Worst Beat", redeployed: false },
  { week: 9,  chopped: "Tony",    decidedBy: "Last In",    boughtBack: true, cost: 25 },
  { week: 14, chopped: "JWhite",  decidedBy: "Worst CLV",  redeployed: false },
  { week: 18, chopped: "The Kid", decidedBy: "Shortest Odds", boughtBack: true, cost: 25 },
  { week: 21, chopped: "Butts",   decidedBy: "Worst Beat", redeployed: false },
];
/* ⚠️ Two shapes here that a hand-written fixture gets wrong and then passes for the
   wrong reason:
   1. `redeployed` is a LIST OF WEEKS, not a boolean — hasChute() reads its length.
   2. royale.status is keyed the way the Worker keys members: encodeURIComponent(name).
      "The Kid" lives under "The%20Kid". A fixture keyed on the display name makes every
      player with a space in it look alive and un-parachuted, which is the exact
      pre-existing board bug kEnc() exists to paper over. */
const STATUS = {
  Squatch:   { alive: false, eliminatedWeek: 4,  redeployed: [], hasParachute: false, redeploysLeft: 1, chopped: [4] },
  JWhite:    { alive: false, eliminatedWeek: 14, redeployed: [], hasParachute: false, redeploysLeft: 1, chopped: [14] },
  Butts:     { alive: false, eliminatedWeek: 21, redeployed: [], hasParachute: false, redeploysLeft: 1, chopped: [21] },
  Tony:      { alive: true,  eliminatedWeek: null, redeployed: [9],  hasParachute: true, redeploysLeft: 0, chopped: [9] },
  "The Kid": { alive: true,  eliminatedWeek: null, redeployed: [18], hasParachute: true, redeploysLeft: 0, chopped: [18] },
};
const royaleStatus = () =>
  Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [encodeURIComponent(k), v]));

const clvPayload = (format, synthetic) => {
  const players = MEMBERS;
  const out = [];
  for (const p of players) {
    for (let w = 1; w <= 14; w++) {
      const noClose = p === "Tony" && w > 12;              // 2 legs with no capturable close
      const push = p === "Kap" && w === 3;                 // 1 push
      out.push({
        player: p, week: w, weekLabel: "Week " + w, sport: "nfl", mkt: "spread",
        line: -3.5, side: "KC", label: "KC -3.5", actual: 6, rank: 1,
        entryPrice: -150, entryPriceOpp: 130,
        closePrice: noClose ? null : -160, closePriceOpp: noClose ? null : 140,
        result: push ? "push" : (w % 3 ? "win" : "loss"),
      });
    }
  }
  return {
    league: "main", leagueName: "Bozo Boyz", season: 2026, format, synthetic,
    devig: "proportional", players, week: 22,
    // ⚠️ `weeks` is not optional. clvWeekLabel does CLV.data.weeks.find(...) on every
    // render, and clvLoad swallows the throw — a payload without it leaves a blank plot
    // and a visible card, which looks like a styling bug rather than a missing field.
    weeks: Array.from({ length: 14 }, (_, i) => ({ week: i + 1, label: "Week " + (i + 1), phase: "regular" })),
    coverage: {
      legs: out.length,
      charted: out.filter(l => l.closePrice != null).length,
      pushes: out.filter(l => l.result === "push").length,
      ungraded: 0,
      noClose: out.filter(l => l.closePrice == null).length,
      noEntryOpp: 0,
    },
    legs: out,
    royale: format === "royale" ? {
      status: royaleStatus(),
      chops: Object.fromEntries(CHOPS.filter(Boolean).map(c => ["w" + c.week, c])),
      survivor: null,
    } : undefined,
  };
};

const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); res.end("no"); return; }
    res.writeHead(200, { "content-type": p.endsWith(".html") ? "text/html" : "text/plain" });
    res.end(b);
  });
});
await new Promise(r => srv.listen(PORT, r));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || chromiumExecutable(chromium),
});

async function open({
  format = "standard", synthetic = false, me = null, theme = "light", width = 1200,
  hash = "", leagues = 1, status = "graded", week = 22,
} = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await ctx.addInitScript(([t, tok]) => {
    try {
      localStorage.setItem("dd-theme2", t);
      localStorage.setItem("dd-theme2-bozo", t);
      if (tok) localStorage.setItem("dd-bozo-sess", tok); else localStorage.removeItem("dd-bozo-sess");
    } catch (e) {}
  }, [theme, me ? session(me) : ""]);

  const scen = {
    season: 2026, week, status, order: [1, 0, 3, 2], closeTs: 1760000000000,
    picks: legs(), bozo: "Manzeo", bozoWhy: "Worst Beat.",
    history: [{ week: 1, bozo: "Manzeo" }],
    results: Object.fromEntries(MEMBERS.map((m, i) => [encodeURIComponent(m), { won: i !== 3, actual: i !== 3 ? 7 : -9 }])),
    ...(format === "royale" ? { royale: { status: royaleStatus(), chops: CHOPS, survivor: null } } : {}),
  };
  const lg = id => ({
    id, name: id === "main" ? "Bozo Boyz" : "Sunday Crew", manager: "Kap", size: 8,
    members: MEMBERS, week, status,
    settings: { ...STD_SETTINGS, format, synthetic, buyback: format === "royale" ? 25 : 0 },
  });

  // ⚠️ Playwright matches the MOST RECENTLY registered route first — catch-alls go on
  // before the specific routes or they swallow them.
  await page.route("**firebaseio.com**", r => r.abort());
  await page.route("**toto.jkapcar4.workers.dev**", r => r.fulfill({ json: {} }));
  await page.route("**/auth/roster*", r => r.fulfill({ json: { players: MEMBERS.map(n => ({ name: n, claimed: true })) } }));
  await page.route("**/league/list*", r => r.fulfill({ json: {
    defaultLeague: "main",
    leagues: leagues > 1 ? [lg("main"), lg("sunday")] : [lg("main")],
  } }));
  await page.route("**/bozo/clv*", r => r.fulfill({ json: clvPayload(format, synthetic) }));
  await page.route("**/bozo/leagues/main.json*", r => r.fulfill({ json: scen }));
  await page.goto(`http://localhost:${PORT}/bozo.html?l=main${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  return { ctx, page, errors };
}

const txt = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, " ").trim();

/* ================= 1. the header renders, and the band owns the week ================= */
for (const theme of ["light", "dark"]) {
  const { ctx, page, errors } = await open({ theme });
  ok(errors.length === 0, `playbill renders without a page error (${theme})`, errors[0]);
  ok(await page.isVisible("#bzHead .eyebrow"), `eyebrow renders (${theme})`);
  ok((await txt(page, "#bzHead h1")).toLowerCase() === "bozo", `wordmark renders (${theme})`);
  // Kap's line, both clauses, unchanged.
  const dek = await txt(page, "#bzHead .dek");
  ok(dek.startsWith("One favorite each, one big parlay.") && dek.includes("funds next week's ticket"),
     `the dek keeps both clauses (${theme})`, dek);

  const band = await txt(page, "#bzBand");
  ok(/week 22/i.test(band), `band prints the week (${theme})`, band);
  ok(/graded/i.test(band), `band prints the status (${theme})`, band);
  ok(/8 dawgs/i.test(band), `band prints the roster count (${theme})`, band);

  /* ⚠️ The point of the band. The week used to be printed twice — once by #statusChip
     and again by #lgSize's "8 players · week 22". Anything outside the band that names
     the week is that bug coming back. */
  const strays = await page.$$eval("#bzHead *", (nodes, ) => nodes
    .filter(n => !n.closest("#bzBand"))
    .filter(n => !n.children.length)
    .map(n => (n.textContent || "").trim())
    .filter(t => /week\s*22/i.test(t)));
  ok(strays.length === 0, `nothing outside the band names the week (${theme})`, strays.join("|"));

  const weekCount = await page.$$eval("#bzBand *", nodes =>
    nodes.filter(n => /week\s*22/i.test(n.textContent || "")).length);
  ok(weekCount === 1, `the week appears exactly once inside the band (${theme})`, String(weekCount));

  // #statusChip's contract is unchanged: render() still writes 'chip '+status to it.
  ok((await page.getAttribute("#statusChip", "class")) === "chip graded",
     `#statusChip keeps its className contract (${theme})`);
  await ctx.close();
}

/* ================= 2. #meCard is gone, #authCard is not ================= */
{
  const { ctx, page, errors } = await open();                       // signed OUT
  ok(await page.$("#meCard") === null, "#meCard does not exist");
  ok(await page.$("#signOut") === null, "the duplicate sign-out button is gone");
  ok(await page.$("#mySheet") === null, "the duplicate my-sheet button is gone");
  ok(await page.isVisible("#authCard"), "#authCard is visible when signed out");
  ok(errors.length === 0, "no page error signed out", errors[0]);
  await ctx.close();
}
{
  const { ctx, page, errors } = await open({ me: "Tucholski" });    // signed IN
  ok(errors.length === 0, "no page error signed in", errors[0]);
  ok(!(await page.isVisible("#authCard")), "#authCard is hidden when signed in");
  ok(await page.$("#meCard") === null, "#meCard still does not exist signed in");
  await ctx.close();
}
{
  // The admin marker survived the card it used to live on, and still keys off isAdmin().
  const { ctx, page } = await open({ me: "Kap", leagues: 2 });
  ok((await txt(page, "#adminBadge")) === "admin", "admin marker moved onto the league line");
  await ctx.close();
}
{
  const { ctx, page } = await open({ me: "Tucholski", leagues: 2 });
  ok((await txt(page, "#adminBadge")) === "", "a non-admin gets no admin marker");
  ok(await page.isVisible("#backHub"), "the back-link survives on the league line");
  await ctx.close();
}

/* ================= 3. the cast strip is one row, and it scrolls ================= */
{
  const { ctx, page, errors } = await open({ me: "Tucholski", width: 390 });
  ok(errors.length === 0, "no page error at 390px", errors[0]);
  const box = await page.$eval("#snav", n => {
    const b = n.querySelector("button");
    return { scrollH: n.scrollHeight, clientH: n.clientHeight,
             btnH: b.offsetHeight, scrollW: n.scrollWidth, clientW: n.clientWidth };
  });
  ok(box.scrollH <= box.btnH + 2, "the strip is ONE row at 390px — no wrap", `${box.scrollH} vs ${box.btnH}`);
  ok(box.scrollW > box.clientW, "the strip scrolls horizontally at 390px", `${box.scrollW} <= ${box.clientW}`);

  // Board pins first, you pin second. The two cells a reader wants must not be off-screen.
  const order = await page.$$eval("#snav button", ns => ns.map(n => n.dataset.v));
  ok(order[0] === "board", "Board pins first", order.slice(0, 3).join(","));
  ok(order[1] === "Tucholski", "your own sheet pins second", order.slice(0, 3).join(","));
  await ctx.close();
}
{
  // Landing on a deep link has to show you the cell you landed on.
  const { ctx, page, errors } = await open({ width: 390, hash: "#s=Tucholski" });
  ok(errors.length === 0, "no page error on a deep-linked sheet", errors[0]);
  const seen = await page.$eval("#snav", n => {
    const on = n.querySelector("button.on");
    const s = n.getBoundingClientRect(), b = on.getBoundingClientRect();
    return { v: on.dataset.v, inside: b.left >= s.left - 1 && b.right <= s.right + 1 };
  });
  ok(seen.v === "Tucholski", "the deep-linked cell is the active one", seen.v);
  ok(seen.inside, "the active cell is scrolled into the visible box");
  await ctx.close();
}

/* ================= 4. mid-drag safety: a no-op repaint must not move the strip ====== */
{
  const { ctx, page } = await open({ width: 390, hash: "#s=Tucholski" });
  // A reader drags the strip somewhere of their own choosing…
  await page.$eval("#snav", n => { n.scrollLeft = 0; });
  // …and a poll repaints it. paintSnav runs on every 15s poll and every hashchange.
  const after = await page.evaluate(() => {
    render();
    location.hash = "#s=Tucholski";              // same view — not a navigation
    return document.getElementById("snav").scrollLeft;
  });
  await page.waitForTimeout(250);
  const settled = await page.$eval("#snav", n => n.scrollLeft);
  ok(after === 0 && settled === 0, "a repaint that does not change the view leaves scroll alone",
     `${after} / ${settled}`);
  // …but an actual navigation still scrolls the new cell in.
  await page.evaluate(() => { location.hash = "#s=Tony"; });
  await page.waitForTimeout(300);
  const moved = await page.$eval("#snav", n => {
    const on = n.querySelector("button.on");
    const s = n.getBoundingClientRect(), b = on.getBoundingClientRect();
    return { v: on.dataset.v, inside: b.left >= s.left - 1 && b.right <= s.right + 1 };
  });
  ok(moved.v === "Tony" && moved.inside, "a real navigation does scroll the new cell in", JSON.stringify(moved));
  await ctx.close();
}

/* ================= 5. Royale: the wall is at the bottom, the roster is the strip ==== */
{
  const { ctx, page, errors } = await open({ format: "royale", me: "Tucholski" });
  ok(errors.length === 0, "royale board renders without a page error", errors[0]);

  const cards = await page.$$eval(".bz > .card, .bz > .verdict", ns =>
    ns.filter(n => getComputedStyle(n).display !== "none").map(n => n.id));
  ok(cards[cards.length - 1] === "royaleCard", "#royaleCard is the LAST card on the board", cards.join(","));
  ok(cards.indexOf("royaleCard") > cards.indexOf("seasonCard"), "#royaleCard sits below the season table",
     cards.join(","));

  ok(await page.$(".rosterline") === null, ".rosterline is gone — the strip is the roster");

  const dead = await page.$$eval("#snav button.dead", ns =>
    ns.map(n => ({ v: n.dataset.v, t: (n.textContent || "").replace(/\s+/g, " ").trim() })));
  ok(dead.length === 3, "three chopped players carry .dead on their cell", dead.map(d => d.v).join(","));
  ok(dead.some(d => d.v === "JWhite" && /wk 14/i.test(d.t)), "a chopped cell prints the elimination week",
     JSON.stringify(dead));
  ok(await page.$eval("#snav button.dead .who", n => getComputedStyle(n).textDecorationLine).then(
       s => s.includes("line-through")), "a chopped name is struck through");
  // Royale counts the ALIVE, not the roster.
  ok(/5 alive/i.test(await txt(page, "#bzBand")), "the band counts who is still alive",
     await txt(page, "#bzBand"));
  await ctx.close();
}

/* ================= 6. the re-deploy banner is news, then it is a receipt ============ */
{
  // The Kid was re-deployed in week 18. The most recent chop is week 21 → history.
  const { ctx, page, errors } = await open({ format: "royale", me: "The Kid" });
  ok(errors.length === 0, "no page error for a re-deployed player", errors[0]);
  ok((await txt(page, "#royaleAlert")) === "", "an older re-deploy does NOT render the banner",
     await txt(page, "#royaleAlert"));
  ok(/week 18/i.test(await txt(page, "#royaleBody")), "…its text is in the bottom card instead",
     await txt(page, "#royaleBody"));
  await ctx.close();
}
{
  /* Same fixture, but the week-21 chop is The Kid's own re-deploy — the most recent
     graded week, so it is a state change the reader has not seen yet. */
  const { ctx, page } = await open({ format: "royale", me: "The Kid" });
  await page.evaluate(() => {
    S.royale.chops = S.royale.chops.map(c =>
      c && c.week === 21 ? { week: 21, chopped: "The Kid", decidedBy: "Worst Beat", boughtBack: true, cost: 25 } : c);
    render();
  });
  ok(/re-deployed/i.test(await txt(page, "#royaleAlert")), "a re-deploy in the most recent graded week DOES render",
     await txt(page, "#royaleAlert"));
  ok(await page.isVisible("#royaleAlert .redeploy"), "the banner sits under the header, uncarded");
  await ctx.close();
}
{
  // A chopped-for-good player gets an epitaph in the bottom card, not at the top.
  const { ctx, page } = await open({ format: "royale", me: "JWhite" });
  ok((await txt(page, "#royaleAlert")) === "", "no banner for a player who is simply out");
  ok(/chopped in week 14/i.test(await txt(page, "#royaleBody")), "the epitaph is in the bottom card",
     await txt(page, "#royaleBody"));
  await ctx.close();
}

/* ================= 7. the chop log survived the move intact ================= */
{
  const { ctx, page, errors } = await open({ format: "royale" });
  ok(errors.length === 0, "a chops array with a null at index 0 renders without throwing", errors[0]);
  const log = await txt(page, "#royaleBody .chops");
  // ⚠️ Tony's week-9 chop is written with the OLD spelling. Reading only `redeployed`
  // would relabel it "out for good", which is a false statement about a real season.
  ok(/week 9 —[^]*?re-deployed/i.test(log), "a `boughtBack` record still reads as re-deployed", log);
  ok(/week 4\b/i.test(log) && /week 21\b/i.test(log), "every chop is in the log", log);
  ok(/out for good/i.test(log), "a final chop still reads as out for good", log);
  // and the rules paragraph came along with it
  ok(/one chop a week/i.test(await txt(page, "#royaleBody")), "the rules paragraph moved with the log");
  await ctx.close();
}

/* ================= 8. drawers closed, claims visible ================= */
{
  const { ctx, page, errors } = await open({ synthetic: true });
  ok(errors.length === 0, "the chart cards render without a page error", errors[0]);

  const drawers = await page.$$eval("details.method", ns => ns.map(n => n.open));
  ok(drawers.length >= 1, "the CLV footnote is a drawer", String(drawers.length));
  ok(drawers.every(o => o === false), "every drawer is closed by default", JSON.stringify(drawers));

  // The live line carries the sample. A drawer that hides it hides it from everyone
  // who does not click.
  const live = await txt(page, "#clvFoot .live");
  ok(/\b2 of 112\b/.test(live), "the live line carries the coverage counts", live);
  ok(/1 push dropped/i.test(live), "the live line carries the pushes", live);
  ok(/luck band n = /.test(live), "the live line carries the luck band's n range", live);
  ok(/self-reported/i.test(live), "the entry-price caveat is on the live line", live);

  /* ⚠️ The demo warning is a truth claim about the numbers on screen. It is asserted
     visible with every drawer still shut, and above the plot, not below it. */
  ok(await page.isVisible("#clvSim"), "the Simulated-league strip is visible without opening anything");
  ok(/simulated league/i.test(await txt(page, "#clvSim")), "…and it says so in as many words");
  const above = await page.evaluate(() => {
    const a = document.getElementById("clvSim").getBoundingClientRect();
    const b = document.getElementById("clvSvg").getBoundingClientRect();
    return a.bottom <= b.top + 1;
  });
  ok(above, "the demo strip sits ABOVE the plot");
  ok(!/simulated league/i.test(await page.$eval("details.method", n => n.textContent)),
     "the demo warning is NOT duplicated inside the drawer");
  await ctx.close();
}
{
  const { ctx, page } = await open({ synthetic: false });
  ok(!(await page.isVisible("#clvSim")), "a real league gets no demo strip");
  // Opening the drawer is what reveals the method, and it is all still there.
  await page.click("details.method > summary");
  const body = await txt(page, "details.method .method-body");
  ok(/de-vigged proportionally/i.test(body), "the method text is intact in the drawer");
  ok(/mixes one checked number with one unchecked one/i.test(body),
     "the full entry-price paragraph is still in the drawer");
  ok(/binomial standard error/i.test(body), "the luck-band derivation is still in the drawer");
  await ctx.close();
}
{
  // The survival card gets the same split, and keeps its own simulation claim visible.
  const { ctx, page } = await open({ format: "royale" });
  ok(await page.isVisible("#survFoot .live"), "the survival card has a live line");
  ok(/simulation, not a forecast/i.test(await txt(page, "#survFoot .live")),
     "…and the simulation claim is on it, not in the drawer");
  ok(await page.$eval("#survFoot details.method", n => n.open) === false,
     "the survival drawer is closed by default");
  await ctx.close();
}

/* ================= 9. the tooltip still lands inside the plot, drawer open ========= */
{
  const { ctx, page, errors } = await open();
  await page.click("#clvFoot details.method > summary");
  await page.waitForTimeout(150);
  /* Aim at the RIGHTMOST dot on purpose. clvShowTip decides which side of the cursor to
     put the tooltip on by comparing against #clvSvg's measured width — the flip is the
     only geometry a drawer under the plot could break, so hover the point that triggers
     it rather than one in the middle where either branch looks fine. */
  // The plot has to be on screen before its client coords mean anything to the mouse.
  await (await page.$("#clvSvg")).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const target = await page.evaluate(() => {
    const svg = document.getElementById("clvSvg");
    const pts = svg.__pts || [];
    if (!pts.length) return null;
    let best = pts[0];
    for (const d of pts) if (d.x > best.x) best = d;
    const r = svg.getBoundingClientRect();
    return { x: r.left + csx(best.x) / 960 * r.width, y: r.top + csy(best.y) / 520 * r.height, n: pts.length };
  });
  ok(target !== null && target.n > 0, "there are dots on the plot to hover");
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(250);
  const geom = await page.evaluate(() => {
    const t = document.getElementById("clvTip").getBoundingClientRect();
    const s = document.getElementById("clvSvg").getBoundingClientRect();
    return { op: +getComputedStyle(document.getElementById("clvTip")).opacity,
             fits: t.left >= s.left - 1 && t.right <= s.right + 1 };
  });
  ok(geom.op > 0, "the tooltip shows with the drawer open");
  ok(geom.fits, "…and it lands inside the plot's width, not off its right edge");
  ok(errors.length === 0, "no page error with the drawer open", errors[0]);
  await ctx.close();
}

await browser.close();
srv.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
