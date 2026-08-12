#!/usr/bin/env python3
"""Stage TOTO-PAGES, part one — give Toto eyes on every page.

Toto already had a per-page hook (window.DD_BOTCTX), but only eight pages ever set
one. Everywhere else he fell through to SYS_PLAIN, whose literal instruction was to
say he cannot see the page — on two dozen pages that are full of numbers. The chips
under the dock still asked about logging an auction sale on the nfelo page.

This patches the SHARED Toto block, which is copy-pasted into every *.html (two
variants: the draft rig and everything else). It adds:

  * scan()  — a page reader. Walks the rendered DOM in document order and turns it
              into text: headings, prose, form controls, tables with rows trimmed,
              hidden rows skipped, the section the reader is looking at hoisted to
              the front and given twice the budget. Exposed as window.DDBotScan so a
              page's own ctx() can fold it in.
  * SYS_PAGE — replaces SYS_PLAIN. Tells him what that rendering is and is not.
  * MAP     — a site map in the prompt, so a question the page cannot answer gets
              routed to the page that can instead of guessed at.
  * surface() now merges a partial DD_BOTCTX over the base, so a page can supply a
              sys block or chrome alone and still inherit the reader.

Per AGENTS.md rule 2: same edit applied to every file, assert count == 1 each.
"""
import glob
import sys

MARK = "/* ---------- Toto: shared draft assistant"

# ---------------------------------------------------------------- 1. SYS_PLAIN
OLD_SYS = """  // No live state on this page — say so rather than reaching for the draft.
  const SYS_PLAIN = `RIGHT NOW you are on a page that exposes no live game state to you. Answer from the site manual, and when someone asks about data on the page in front of them, say plainly that you cannot see it and name the page that would let you.`;
"""

NEW_SYS = """  /* ⚠️ This used to say "you are on a page that exposes no live game state to you"
     and instruct him to admit he could not see it. That was true of exactly one page
     and false of twenty. Now the fallback hands him a text rendering of the page the
     reader is actually looking at, so the floor everywhere is "he reads what you
     read" — and the honesty constraint moves to what that rendering IS. */
  const SYS_PAGE = `RIGHT NOW you are on a page that has not handed you a curated state block, so what follows is a TEXT RENDERING OF THE PAGE THE READER IS LOOKING AT — its headings, prose, settings and tables, read off the rendered page at the moment they asked.
- It is what is ON SCREEN, not the dataset behind it. Rows that a filter hid are not in it, long tables are cut, and charts are pictures you cannot see. Say which of those is biting when it bites.
- The section marked THE READER IS LOOKING AT is the one on their screen. An unqualified "this" means that section.
- Describe, summarise, compare and explain what is in the rendering. Do not compute new numbers from it beyond arithmetic you can show, and never fill a gap in it from memory of football.
- Numbers on this site carry dates. If the rendering gives a date or an as_of, quote it. If it gives a tier (Pup, Working Dawg, DawgHouse), respect what that tier means.
- If the question needs a page other than this one, answer what you can and name the page from the site map. Routing someone correctly beats guessing at their answer.`;
"""

# ------------------------------------------------------------- 2. CHROME_PLAIN
OLD_CHROME = """  const CHROME_PLAIN = {sub:"ask about the site", ph:"Ask Toto…", chips:[
    ["How do I enter a sale on the auctioneer page?","Log a sale"],
    ["How do I fix a pick I got wrong?","Fix a pick"],
    ["What can you actually see from this page?","What can you see?"]]};
"""

NEW_CHROME = """  /* ⚠️ These chips used to ask about logging an auction sale — on every page that
     had no surface of its own, including pages with no draft anywhere near them.
     The default now asks about the page you are standing on. */
  const CHROME_PLAIN = {sub:"reads this page", ph:"Ask Toto about this page…", chips:[
    ["What is this page for, in plain terms?","What is this?"],
    ["What can you actually see from this page?","What can you see?"],
    ["Where do these numbers come from, and how fresh are they?","Where's it from?"]]};
"""

# ------------------------------------------------------------------ 3. surface
OLD_SURFACE = """  function surface(){
    const h = window.DD_BOTCTX;
    if(h && typeof h.ctx === "function")
      return {sys: h.sys || SYS_PLAIN, label: h.label || "CURRENT PAGE STATE", ctx: h.ctx};
    if(window.DD_POOL && window.DD_POOL.length)
      return {sys: SYS_DRAFT, label: "CURRENT DRAFT STATE", ctx};
    return {sys: SYS_PLAIN, label: "PAGE STATE", ctx: () => "This page exposes no live state."};
  }
"""

NEW_SURFACE = """  function surface(){
    const h = window.DD_BOTCTX;
    const base = (window.DD_POOL && window.DD_POOL.length)
      ? {sys: SYS_DRAFT, label: "CURRENT DRAFT STATE", ctx}
      : {sys: SYS_PAGE, label: "THE PAGE IN FRONT OF THE READER, RENDERED AS TEXT", ctx: scan};
    if(!h) return base;
    /* A partial hook is legal and useful: a page can claim its own voice with sys
       alone, or its own chips with chrome alone, and still inherit the reader below
       it. Only a page that supplies ctx() replaces the state — curated beats
       scraped, and nothing here changes what the draft pages send. */
    return {sys:   h.sys   || base.sys,
            label: h.label || base.label,
            ctx:   typeof h.ctx === "function" ? h.ctx : base.ctx};
  }

  /* ---------- The page reader ------------------------------------------------
     Turns the rendered page into text. Deliberately literal: it reads the DOM after
     the page has drawn it, so it sees the filter the reader set, the sheet they are
     on and the rows they can actually see — and it cannot see a canvas chart, which
     is why SYS_PAGE says so. Exposed as window.DDBotScan(budget) so a page with its
     own curated ctx() can fold the rendering in underneath it. */
  const ddTxt = el => (el.textContent || "").replace(/\\s+/g, " ").trim();

  function ddShown(el){
    if(el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    return el.getClientRects().length > 0;
  }
  function ddInView(el){
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 800);
  }

  function ddTable(tb, rowCap){
    const all = tb.rows, keep = [];
    let total = 0;
    for(let i = 0; i < all.length; i++){
      const tr = all[i];
      if(!ddShown(tr)) continue;
      total++;
      if(keep.length >= rowCap) continue;
      const cells = [];
      for(let c = 0; c < tr.cells.length; c++) cells.push(ddTxt(tr.cells[c]));
      while(cells.length && cells[cells.length - 1] === "") cells.pop();
      if(cells.join("") !== "") keep.push(cells.join(" | "));
    }
    if(!keep.length) return "";
    const cap = tb.caption ? " (" + ddTxt(tb.caption) + ")" : "";
    return "TABLE" + cap + (total > keep.length ? " — first " + keep.length + " of " + total + " rows on screen" : "")
      + ":\\n" + keep.join("\\n");
  }

  /* Settings ARE state on this site: the survivor model, a calculator's dials, a
     filter. textContent cannot see them, so read the controls directly.
     ⚠️ SETTINGS ONLY — dropdowns, checkboxes, numbers, sliders, dates. Free-text
     boxes are deliberately NOT read. A page with a text field has a person typing
     into it, and on signon.html and connect.html what they are typing is a name, an
     email address or a personal connector URL that is itself the credential. None of
     that belongs in a prompt leaving this browser. */
  const DD_READ_TYPE = {number:1, range:1, checkbox:1, radio:1, date:1, month:1, week:1, time:1};
  function ddControl(el){
    const t = (el.type || "").toLowerCase();
    if(el.tagName !== "SELECT" && !DD_READ_TYPE[t]) return "";
    let name = el.getAttribute("aria-label") || el.getAttribute("data-label") || "";
    if(!name && el.id){
      try{ const lb = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
           if(lb) name = ddTxt(lb); }catch(e){}
    }
    /* A wrapping label contains the control, so its textContent includes every
       option in the dropdown — "Week Week 1Week 2Week 3…". Clone it, strip the
       controls out, and what is left is the human label. */
    if(!name && el.closest){
      const lb = el.closest("label");
      if(lb){
        const c = lb.cloneNode(true), kids = c.querySelectorAll("input,select,textarea,option,datalist,button");
        for(let i = 0; i < kids.length; i++) kids[i].remove();
        name = ddTxt(c);
      }
    }
    name = (name || el.placeholder || el.name || el.id || "setting").slice(0, 60);
    let v = el.value;
    if(t === "checkbox" || t === "radio"){ if(!el.checked) return ""; v = "on"; }
    if(el.tagName === "SELECT"){ const o = el.options[el.selectedIndex]; v = o ? o.text : el.value; }
    v = String(v == null ? "" : v).replace(/\\s+/g, " ").trim();
    return v ? "[setting] " + name + ": " + v.slice(0, 80) : "";
  }

  function scan(budget){
    const CAP = budget || 9000;
    const root = document.querySelector("main") || document.querySelector(".wrap") || document.body;
    if(!root) return "This page has not rendered anything readable yet.";
    const SKIP_TAG = {SCRIPT:1, STYLE:1, NOSCRIPT:1, SVG:1, CANVAS:1, IFRAME:1, TEMPLATE:1,
                      NAV:1, FOOTER:1, VIDEO:1, AUDIO:1, BUTTON:1, OPTION:1, PICTURE:1};
    const SKIP_ID  = {nav:1, ddbDock:1, ddbLaunch:1, ddbCSS:1, ddbMsgs:1};
    const secs = [{head:"", lines:[], seen:false}];
    const said = {};
    let cur = secs[0];

    (function walk(node){
      for(let el = node.firstElementChild; el; el = el.nextElementSibling){
        const tag = el.tagName;
        if(SKIP_TAG[tag] || SKIP_ID[el.id]) continue;
        // data-ddb-skip is the page's own opt-out: anything under it is never read.
        if(el.hasAttribute && el.hasAttribute("data-ddb-skip")) continue;
        if(!ddShown(el)) continue;
        if(/^H[1-3]$/.test(tag)){ cur = {head: ddTxt(el).slice(0, 120), lines: [], seen: ddInView(el)}; secs.push(cur); continue; }
        if(/^H[4-6]$/.test(tag)){ cur.lines.push("### " + ddTxt(el)); continue; }
        if(tag === "TABLE"){
          const near = ddInView(el);
          const s = ddTable(el, near ? 24 : 8);
          if(s){ if(near) cur.seen = true; cur.lines.push(s); }
          continue;
        }
        if(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA"){
          const s = ddControl(el); if(s) cur.lines.push(s);
          continue;
        }
        if(tag === "P" || tag === "LI" || tag === "DT" || tag === "DD" || tag === "BLOCKQUOTE"
           || tag === "FIGCAPTION" || tag === "SUMMARY"){
          const s = ddTxt(el);
          if(s && !said[s]){ said[s] = 1; if(ddInView(el)) cur.seen = true;
            cur.lines.push((tag === "LI" ? "- " : "") + (s.length > 420 ? s.slice(0, 420) + "…" : s)); }
          continue;
        }
        // A leaf-ish wrapper — a stat tile, a badge, a figure caption row. Keep it
        // whole so "3.2" stays attached to the word that says what 3.2 is.
        const deeper = el.querySelector
          && el.querySelector("div,section,article,ul,ol,dl,table,form,h1,h2,h3,h4,p,input,select,textarea");
        if(!deeper){
          const s = ddTxt(el);
          if(s && s.length <= 220 && !said[s]){ said[s] = 1; if(ddInView(el)) cur.seen = true; cur.lines.push(s); }
          continue;
        }
        walk(el);
      }
    })(root);

    const live = secs.filter(s => s.lines.length);
    if(!live.length) return "This page has rendered nothing this reader can see yet.";
    const focus = live.filter(s => s.seen)[0] || null;

    /* Budget by ROUND ROBIN, not by fixed share. A fixed share per section starves
       the sections after a long one — on the survivor page the whole equity board
       fell off the end while the intro copy got the room. Every section takes one
       line a round, the section on the reader's screen takes three, and the last
       lines to be dropped are the ones nobody was looking at. */
    const take = live.map(() => 0);
    let used = live.reduce((a, s) => a + (s.head || "").length + 8, 0);
    let cutSome = false, moved = true;
    while(moved){
      moved = false;
      for(let i = 0; i < live.length; i++){
        const s = live[i], quota = (s === focus) ? 3 : 1;
        for(let k = 0; k < quota && take[i] < s.lines.length; k++){
          const ln = s.lines[take[i]];
          if(used + ln.length + 1 > CAP){ cutSome = true; break; }
          take[i]++; used += ln.length + 1; moved = true;
        }
      }
    }

    const order = focus ? [focus].concat(live.filter(s => s !== focus)) : live;
    const out = order.map(s => {
      const i = live.indexOf(s), got = s.lines.slice(0, take[i]), rest = s.lines.length - take[i];
      if(rest > 0){ got.push("[… " + rest + " more line" + (rest > 1 ? "s" : "") + " in this section, not shown]"); cutSome = true; }
      return "## " + (s.head || "(top of the page)") + (s === focus ? "   <-- THE READER IS LOOKING AT THIS SECTION" : "")
        + "\\n" + got.join("\\n");
    });

    const head = ["PAGE: " + (document.title || "") + "  (" + location.pathname.replace(/^\\//, "") + ")",
      "Below is the page as it is drawn right now. Sections are in document order except the one on the reader's screen, which is hoisted to the front. Hidden rows are excluded and long tables are trimmed."];
    if(cutSome) head.push("⚠️ Parts of the page did not fit and were cut. If the answer needs a part that is not here, say the page has more rather than guessing at it.");
    return head.join("\\n") + "\\n\\n" + out.join("\\n\\n");
  }
  window.DDBotScan = scan;   // per-page ctx() blocks fold this in under their own state
"""

# --------------------------------------------------------------- 4. the site map
OLD_HELP_TAIL = """STATE: everything saves in the browser on that device. A different device shows a different draft unless the live mirror is switched on. Pages are cached for offline so the draft survives losing wifi — but Toto itself needs the network, so say so if someone asks for help while offline.`;
"""

NEW_HELP_TAIL = OLD_HELP_TAIL + """
/* The manual above is the draft rig, because that is where how-to questions used to
   come from. This is the rest of the site in one screen: enough for Toto to route a
   question he cannot answer from the page in front of him. Keep it honest — a page
   listed here as empty must stay listed as empty until it isn't. */
const MAP = `SITE MAP — what lives where. Use it to send someone to the right page instead of guessing at their answer.
index.html — the manifesto: what Data Dawgs is for, "Data, not dogma", Bring Your Own Dawg, how the tiers work.
receipts.html — every pre-registered forecast, the grading, calibration, the model scoreboard, 538 Classic, provenance, the tier audit.
dawghouse.html — the shelf: work that was stopped, each item with its blocker and the condition that would reopen it.
arena.html — the hub for games played against other people; links to all of the below.
bozo.html — the weekly one-leg parlay game: board, ledger, closing-line value, standings, the belt.
challenge.html — the Forecast Challenge: put a probability on a game before kickoff, get graded after.
survivor.html — survivor pool: this week's board, pick popularity, an optimal path, a season simulation, model settings.
guillotine.html — guillotine league companion. dfs.html — DFS solver, contest simulator, exposure, bankroll. The projections there are the USER'S OWN.
teamdraft.html — the 32-team wins pool: spin wheel, board, eight rosters, Monte Carlo season sim.
The draft rig: dashboard.html (a drafter's view), auction.html (the operator), board.html (read-only room view), bigboard.html (the projector), dataviz.html and report.html (afterwards), master.html (the player pool and scouting).
strategy.html — the 2026 draft thesis, a dated snapshot of one analyst's argument.
nfl.html — the NFL hub. stats.html — the EPA explorer. nfelo.html — nfelo power ratings and their backtest. calculators.html — ten deterministic calculators, nothing stored.
cfb.html — the College Football lab: 2025 results, one retrodictive Elo, a matchup calculator, the build roadmap.
markets.html — the prediction-markets section. ai.html — the A.I. section. Both are deliberately near-empty and say so above the fold; do not imply either has tools yet.
data.html — the Library: every machine-readable file, shelved by the surface that owns it. connect.html — point your own AI at the site over MCP.
signon.html — sign in, sign up, recover an account; every other page's sign-in chip lands here. dawgs.html — Rollo, the OG Data Dawg.
Machine surfaces: /data/index.json lists every file with its as_of and hash; /llms.txt is the curated index; /data/surfaces.json maps pages to files and MCP tools.
TIERS: Pup = live and useful but not yet validated. Working Dawg = it survived a standard declared in advance. DawgHouse = stopped, with the blocker still attached.`;
"""

# ------------------------------------------------- 5. put the map in the payload
OLD_FRAME = """      const frame = () => JSON.stringify({max_tokens:700, messages:[
        {role:"system",content:SYS+"\\n\\n"+SF.sys},
        {role:"system",content:HELP},
        {role:"system",content:SF.label},
        ...HIST.slice(-8)]}).length;
"""
NEW_FRAME = """      const frame = () => JSON.stringify({max_tokens:700, messages:[
        {role:"system",content:SYS+"\\n\\n"+SF.sys},
        {role:"system",content:HELP},
        {role:"system",content:MAP},
        {role:"system",content:SF.label},
        ...HIST.slice(-8)]}).length;
"""

OLD_PAYLOAD = """        messages:[{role:"system",content:SYS+"\\n\\n"+SF.sys},
                  {role:"system",content:"SITE MANUAL (how the site works — use for how-to questions):\\n"+HELP},
                  {role:"system",content:SF.label+" (regenerated for every question):\\n"+stateTxt},
"""
NEW_PAYLOAD = """        messages:[{role:"system",content:SYS+"\\n\\n"+SF.sys},
                  {role:"system",content:"SITE MANUAL (how the site works — use for how-to questions):\\n"+HELP},
                  {role:"system",content:"SITE MAP (what lives on which page — use it to route):\\n"+MAP},
                  {role:"system",content:SF.label+" (regenerated for every question):\\n"+stateTxt},
"""

EDITS = [
    ("SYS_PLAIN block", OLD_SYS, NEW_SYS),
    ("CHROME_PLAIN chips", OLD_CHROME, NEW_CHROME),
    ("surface() + page reader", OLD_SURFACE, NEW_SURFACE),
    ("site map after the manual", OLD_HELP_TAIL, NEW_HELP_TAIL),
    ("frame() budget", OLD_FRAME, NEW_FRAME),
    ("payload", OLD_PAYLOAD, NEW_PAYLOAD),
]


def main():
    files = [f for f in sorted(glob.glob("*.html")) if MARK in open(f, encoding="utf-8").read()]
    if not files:
        sys.exit("no pages carry the Toto block — wrong directory?")
    print(f"{len(files)} pages carry the Toto block")
    for f in files:
        s = open(f, encoding="utf-8").read()
        for name, old, new in EDITS:
            assert s.count(old) == 1, f"{f}: {name} matched {s.count(old)} times"
            s = s.replace(old, new)
        # SYS_PLAIN is gone; nothing may still reference it
        assert "SYS_PLAIN" not in s, f"{f}: a SYS_PLAIN reference survived"
        open(f, "w", encoding="utf-8").write(s)
        print("  patched", f)


if __name__ == "__main__":
    main()
