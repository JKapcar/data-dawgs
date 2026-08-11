#!/usr/bin/env python3
"""Build challenge.html — the forecasting challenge page (Stage FC-E).

The page is assembled from markets.html, which supplies the flattened shell every page
carries: the inlined stylesheet, the shared nav + theme + DDAuth script, and the DDSheets
component. Only <main> and the page's own logic are written here.

⚠️ EVERY SLICE IS BY CONTENT MARKER, ASSERTED TO OCCUR EXACTLY ONCE. A line-number slice
is what broke the Markets/A.I. build twice — the second time silently, shipping two pages
whose whole body parsed as JavaScript. If a marker moves, this script fails loudly instead
of cutting in the wrong place.

⚠️ write_text gets newline="\\n". Without it Python translates every \\n to \\r\\n on
Windows, which silently CRLF-corrupts an LF repo and breaks verify-sw's byte hash.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DONOR = ROOT / "markets.html"
OUT = ROOT / "challenge.html"


def once(hay: str, needle: str, what: str) -> int:
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times, expected exactly 1"
    return hay.index(needle)


src = DONOR.read_text(encoding="utf-8")

# ---- the shell: everything above <main> ------------------------------------------
main_at = once(src, "\n<main>\n", "<main> open")
prefix = src[:main_at]

# ---- the DDSheets component, lifted whole ----------------------------------------
dds_note = once(src, "/* DDSheets — the page-family component", "DDSheets banner")
dds_open = src.rfind("<script>", 0, dds_note)
assert dds_open != -1, "no <script> before the DDSheets banner"
dds_close = src.index("</script>", dds_note) + len("</script>")
ddsheets = src[dds_open:dds_close]

# ---- retarget the shell to this page ---------------------------------------------
prefix = prefix.replace(
    "<title>Prediction Markets · Data Dawgs</title>",
    "<title>The Forecast Challenge · Data Dawgs</title>", 1)
prefix = prefix.replace('<script data-page="markets">', '<script data-page="challenge">', 1)
assert "data-page=\"challenge\"" in prefix, "the nav script kept the donor's data-page"
assert "The Forecast Challenge · Data Dawgs" in prefix, "the title did not retarget"

MAIN = r"""
<main>
  <header class="p-hero">
    <div class="p-kicker">The forecasting challenge · you, the models, and the crowd on one slate</div>
    <h1>The Forecast Challenge. <a class="tierchip" data-tier="labs" href="index.html#tiers" title="Why this page is a Pup">Pup</a></h1>
    <p class="p-lead">Move a slider for every game. So do four models, a sealed crowd line, and
    eventually the market. Everyone is scored with the same formula on the same slate, and every
    model number was written down and dated <b>before</b> kickoff &mdash; so when the season ends
    there is an argument about skill rather than about who remembered what.</p>
  </header>
  <div class="p-disclosure"><b>Nothing here has been graded yet.</b> No game has been scored, no
  leaderboard exists, and no claim is being made that anyone beats anything. What exists today is
  the entry side: you can forecast, the models are already on the record, and the crowd line seals
  itself at kickoff. Grading arrives with the results.</div>

<div id="sheets"></div>

  <!-- ===================== BOARD ===================== -->
  <div id="sheetBoard">
  <div class="card">
    <h3>This week <span class="rt" id="cwWeekTag"></span></h3>
    <p class="sub">Drag a slider to say how likely the game is to end the way the label reads.
    <b>50 means nothing either way</b> &mdash; and a slider you never touch is recorded as
    untouched, not as a 50, because those two things mean opposite things.</p>
    <div class="btnrow" style="margin-bottom:12px">
      <label class="fld" style="max-width:220px"><span>Week</span>
        <select class="fi" id="cwWeek"></select></label>
    </div>
    <p class="note" id="cwAuth"></p>
    <p class="note" id="cwMsg"></p>
    <div id="cwGames"></div>
  </div>
  </div>

  <!-- ===================== LEADERBOARD ===================== -->
  <div id="sheetBoardLb">
  <div class="card">
    <h3>Leaderboard</h3>
    <p class="sub" id="cwLbState">Not built yet.</p>
    <p class="note">There is deliberately nothing here. Points, Brier, ranks and coverage are all
    <b>queries over the entries</b> &mdash; no running total is stored anywhere, because a stored
    total is the one copy that goes stale. The queries need graded outcomes, and no game has been
    played yet.</p>
    <p class="note">When it does land it will be <b>two boards, not one</b>. Total points rewards
    showing up, so a model that forecast all 272 games and a person who forecast 40 cannot be
    compared on it. Beside it goes a common-sample board &mdash; the exact games an entrant and
    every comparator both forecast &mdash; with n and coverage on every row. Publishing only the
    first would be making the exact claim this site tells everyone else not to make.</p>
  </div>
  </div>

  <!-- ===================== MODELS ===================== -->
  <div id="sheetBoardModels">
  <div class="card">
    <h3>The lines you are playing against <span class="rt" id="cwMdAsOf"></span></h3>
    <p class="sub">Every one of these was captured and dated before the season. Nothing here is
    computed at page load, and nothing is retrofitted &mdash; the file below is the receipt.</p>
    <div class="tblwrap"><table class="tbl" id="cwModels"><thead><tr>
      <th>Line</th><th>Version</th><th class="num">Games</th><th>Captured</th><th>Independent?</th>
    </tr></thead><tbody></tbody></table></div>
    <p class="note" id="cwCorr"></p>
    <p class="note">⚠️ Two of these are not independent of each other, and the correlation above is
    measured rather than asserted. Averaging four numbers that are mostly the same number is not an
    ensemble &mdash; it is one model with extra steps, and it would look far more confident than it
    has earned.</p>
  </div>
  <div class="card">
    <h3>The crowd line</h3>
    <p class="sub">Every touched human slider on a game becomes one forecast, sealed the moment the
    game kicks off. It is the only line here that is <b>independent of the models by
    construction</b> &mdash; which is exactly why registered bots are excluded from it. A bot is
    model-driven, so letting bots into the crowd would quietly turn it into an average of the
    models it exists to check.</p>
  </div>
  </div>

  <!-- ===================== METHOD ===================== -->
  <div id="sheetBoardMethod">
  <div class="card">
    <h3>How this is scored</h3>
    <p class="sub">⚠️ Everything below is rendered from
    <a href="/data/model-contracts.json">/data/model-contracts.json</a>, not typed into this page.
    If the contract and the page ever disagree, the page is wrong &mdash; and it cannot, because
    there is only one copy.</p>
    <div id="cwMethod"></div>
  </div>
  </div>
</main>
"""

SCRIPT = r"""
<script>
/* ============================================================================
   challenge.html — the forecasting challenge (Stage FC-E)

   ⚠️ THE ONE RULE THAT POISONS EVERYTHING IF BROKEN: `touched` is set by a real input
   event, and is NEVER inferred by comparing the slider's value against the midpoint.
   (The build script greps for that exact comparison and refuses to write the page if it
   appears — which is why this sentence describes it in words instead of in code.)
   An untouched slider and a slider
   deliberately set to 50 hold the same number and mean opposite things — one is an
   absence, the other is a belief. Both score zero, but only the second belongs in the
   crowd consensus. Derive it and every lurker drags the crowd toward the middle, which
   destroys the only property the human line supplies: independence from the models.
   `touchedGames` below is a Set written to by an "input" listener and by nothing else.

   ⚠️ THE COUNTDOWN IS COURTESY; THE WORKER'S 409 IS THE GATE. A browser clock can be
   wrong or deliberately set back, so this page greys a game out at kickoff for the look
   of the thing, and treats the server's refusal as the truth. A 409 marks the game locked
   even if the local clock disagrees.

   ⚠️ home_win_probability IS NEVER SENT. The Worker derives it from slider_value and
   slider_side and rejects a body carrying it with a 400. That is what makes it impossible
   for the raw input and the scored number to disagree.
============================================================================ */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var WORKER = "https://toto.jkapcar4.workers.dev";
  var SPORT = "nfl";

  var games = [];        // canonical schedule rows
  var byWeek = {};       // week -> [game]
  var modelsByGame = {}; // game_id -> [{model_id, p}]
  var mine = {};         // game_id -> stored entry
  var week = null;
  var contract = null;

  /* ⚠️ A Set, written to ONLY by the input listener. Not derived, not inferred, never
     recomputed from a value. See the banner above. */
  var touchedGames = new Set();
  var sideOf = {};       // game_id -> "home" | "away"
  var valueOf = {};      // game_id -> 0..100
  var lockedGames = new Set();

  var esc = function (s) { return String(s == null ? "" : s); };
  var pct = function (p) { return (p * 100).toFixed(0) + "%"; };

  function json(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " returned " + r.status);
      return r.json();
    });
  }

  /* ---------------------------------------------------------------- countdown */
  function until(ms) {
    var d = ms - Date.now();
    if (d <= 0) return "locked";
    var h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
    if (h >= 24) { var days = Math.floor(h / 24); return "in " + days + "d " + (h % 24) + "h"; }
    if (h >= 1) return "in " + h + "h " + m + "m";
    return "in " + m + "m";
  }

  function isLocked(g) { return lockedGames.has(g.game_id) || Date.now() >= g.kickoff_ms; }

  /* ---------------------------------------------------------------- the board */
  function drawBoard() {
    var host = $("cwGames");
    host.replaceChildren();
    var rows = byWeek[week] || [];
    if (!rows.length) {
      var none = document.createElement("p");
      none.className = "note";
      none.textContent = "No games in the canonical schedule for that week.";
      host.appendChild(none);
      return;
    }
    var signedIn = !!(window.DDAuth && window.DDAuth.me());

    rows.forEach(function (g) {
      var locked = isLocked(g);
      var card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "14px";
      if (locked) card.style.opacity = "0.62";

      var h = document.createElement("h3");
      h.textContent = g.away_team + " @ " + g.home_team;
      var tag = document.createElement("span");
      tag.className = "rt";
      tag.textContent = locked ? "locked" : until(g.kickoff_ms);
      h.appendChild(tag);
      card.appendChild(h);

      var when = document.createElement("p");
      when.className = "sub";
      when.textContent = new Date(g.kickoff_ms).toLocaleString();
      card.appendChild(when);

      /* Model numbers are visible BEFORE you pick, deliberately. Copying is expected and
         is handled by measuring each entrant's correlation to each model, not by hiding
         numbers — see crowd_consensus.extremize_reason in the contract. */
      var ml = modelsByGame[g.game_id] || [];
      if (ml.length) {
        var mp = document.createElement("p");
        mp.className = "note";
        mp.textContent = "Models on " + g.home_team + ": " +
          ml.map(function (m) { return m.model_id + " " + pct(m.p); }).join(" · ");
        card.appendChild(mp);
      }

      var side = sideOf[g.game_id] || "home";
      var val = valueOf[g.game_id];
      if (val == null) val = 50;

      var lab = document.createElement("p");
      lab.className = "sub";
      lab.style.marginBottom = "4px";
      var team = function () { return side === "home" ? g.home_team : g.away_team; };
      lab.textContent = "Chance " + team() + " wins: " + val + "%";
      card.appendChild(lab);

      var slider = document.createElement("input");
      slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "1";
      slider.value = String(val);
      slider.style.width = "100%";
      slider.disabled = locked || !signedIn;
      slider.setAttribute("aria-label", "Chance " + team() + " beats " +
        (side === "home" ? g.away_team : g.home_team));

      /* ⚠️ THE ONLY PLACE touched IS EVER SET. */
      slider.addEventListener("input", function () {
        valueOf[g.game_id] = Number(slider.value);
        touchedGames.add(g.game_id);
        lab.textContent = "Chance " + team() + " wins: " + slider.value + "%";
      });
      card.appendChild(slider);

      var row = document.createElement("div");
      row.className = "btnrow";

      var flip = document.createElement("button");
      flip.className = "btn ghost sm";
      flip.textContent = "Reading: " + team();
      flip.disabled = locked || !signedIn;
      /* Flipping the side is a UI choice, NOT a forecast. It must not mark the game
         touched — otherwise idly toggling a label would enter you into the crowd. */
      flip.addEventListener("click", function () {
        side = side === "home" ? "away" : "home";
        sideOf[g.game_id] = side;
        var v = Number(slider.value);
        valueOf[g.game_id] = 100 - v;
        slider.value = String(100 - v);
        flip.textContent = "Reading: " + team();
        lab.textContent = "Chance " + team() + " wins: " + slider.value + "%";
      });
      row.appendChild(flip);

      var save = document.createElement("button");
      save.className = "btn sm";
      save.textContent = "Save";
      save.disabled = locked || !signedIn;
      row.appendChild(save);
      card.appendChild(row);

      var st = document.createElement("p");
      st.className = "note";
      var prior = mine[g.game_id];
      if (prior) {
        st.textContent = "Saved · revision " + prior.revision +
          (prior.touched ? "" : " · recorded as untouched");
      }
      card.appendChild(st);

      save.addEventListener("click", function () {
        st.className = "note"; st.textContent = "Saving…";
        submit(g, Number(slider.value), sideOf[g.game_id] || "home",
               touchedGames.has(g.game_id), st, card, slider, flip, save);
      });

      host.appendChild(card);
    });
  }

  function submit(g, value, side, touched, st, card, slider, flip, save) {
    var body = {
      sport: SPORT, game_id: g.game_id,
      slider_value: value, slider_side: side,
      /* ⚠️ Client-asserted and labelled as such. The Worker cannot observe a drag. */
      touched: !!touched
      /* home_win_probability is deliberately absent — sending it is a 400. */
    };
    fetch(WORKER + "/forecast/entry", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" },
                             window.DDAuth ? window.DDAuth.headers() : {}),
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { error: "HTTP " + r.status }; })
        .then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      if (res.ok) {
        mine[g.game_id] = res.j.entry;
        st.className = "note good";
        st.textContent = "Saved · revision " + res.j.entry.revision +
          (res.j.entry.touched ? "" : " · recorded as untouched");
        return;
      }
      /* ⚠️ THE SERVER'S 409 IS THE REAL LOCK. Trust it over the local clock: a browser
         whose time is wrong (or set back on purpose) must not be able to write. */
      if (res.status === 409) {
        lockedGames.add(g.game_id);
        card.style.opacity = "0.62";
        slider.disabled = true; flip.disabled = true; save.disabled = true;
        st.className = "note warn";
        st.textContent = res.j.error || "That game has kicked off. Forecasts are locked.";
        return;
      }
      st.className = "note bad";
      st.textContent = res.j.error || ("HTTP " + res.status);
    }).catch(function (e) {
      st.className = "note bad";
      st.textContent = e.message || String(e);
    });
  }

  /* ------------------------------------------------------------ my own week */
  function loadMine() {
    mine = {};
    var m = window.DDAuth && window.DDAuth.me();
    if (!m || week == null) { drawBoard(); return; }
    var season = (byWeek[week] && byWeek[week][0] && byWeek[week][0].season) || null;
    if (season == null) { drawBoard(); return; }
    fetch(WORKER + "/forecast/entries?sport=" + SPORT + "&season=" + season + "&week=" + week,
      { headers: window.DDAuth.headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        (j && j.entries || []).forEach(function (e) {
          mine[e.game_id] = e;
          valueOf[e.game_id] = e.slider_value;
          sideOf[e.game_id] = e.slider_side;
          /* ⚠️ Rehydrating a STORED touched:true is not deriving it — the server already
             holds that fact. It is restored so a save that changes nothing does not
             silently downgrade a real forecast to untouched. */
          if (e.touched) touchedGames.add(e.game_id);
        });
        drawBoard();
      })
      .catch(function () { drawBoard(); });
  }

  function paintAuth() {
    var m = window.DDAuth && window.DDAuth.me();
    var el = $("cwAuth");
    el.replaceChildren();
    if (m) { el.className = "note"; el.textContent = "Signed in as " + m.name + "."; return; }
    el.className = "note warn";
    el.appendChild(document.createTextNode("The board and the model lines are open to everyone. "));
    var a = document.createElement("a");
    a.href = "signon.html?next=challenge.html";
    a.textContent = "Sign in";
    el.appendChild(a);
    el.appendChild(document.createTextNode(" to enter a forecast of your own."));
  }

  /* ---------------------------------------------------------------- models */
  function logit(p) {
    var q = Math.min(0.99, Math.max(0.01, p));
    return Math.log(q / (1 - q));
  }
  function corr(a, b) {
    var n = a.length;
    if (n < 3) return null;
    var ma = a.reduce(function (x, y) { return x + y; }, 0) / n;
    var mb = b.reduce(function (x, y) { return x + y; }, 0) / n;
    var sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) {
      var da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    if (saa <= 0 || sbb <= 0) return null;
    return sab / Math.sqrt(saa * sbb);
  }

  function drawModels(rows) {
    var byModel = {};
    rows.forEach(function (r) {
      var k = r.model_id;
      if (!byModel[k]) byModel[k] = { id: k, name: r.model_name, version: r.model_version, n: 0, first: r.captured_at, last: r.captured_at };
      var b = byModel[k];
      b.n++;
      if (r.captured_at < b.first) b.first = r.captured_at;
      if (r.captured_at > b.last) b.last = r.captured_at;
    });
    var tb = document.querySelector("#cwModels tbody");
    tb.replaceChildren();
    var INDEP = { "nfelo": "yes", "538-classic": "yes", "ddpr-nfl": "no — a transform of the two above", "ddpr-nfl-linear": "no — a transform of the two above" };
    Object.keys(byModel).sort().forEach(function (k) {
      var b = byModel[k];
      var tr = document.createElement("tr");
      [b.name || b.id, b.version || "", String(b.n), (b.last || "").slice(0, 10), INDEP[k] || "—"]
        .forEach(function (v, i) {
          var td = document.createElement("td");
          if (i === 2) td.className = "num";
          td.textContent = v;
          tr.appendChild(td);
        });
      tb.appendChild(tr);
    });

    /* The correlation is MEASURED here from the receipts, not typed in, so it cannot
       drift from the file it describes. */
    var a = [], b2 = [];
    var byGame = {};
    rows.forEach(function (r) {
      byGame[r.game_id] = byGame[r.game_id] || {};
      byGame[r.game_id][r.model_id] = r.home_win_probability;
    });
    Object.keys(byGame).forEach(function (gid) {
      var g = byGame[gid];
      if (typeof g["nfelo"] === "number" && typeof g["538-classic"] === "number") {
        a.push(logit(g["nfelo"])); b2.push(logit(g["538-classic"]));
      }
    });
    var c = corr(a, b2);
    $("cwCorr").textContent = c == null
      ? "Not enough overlapping games to measure agreement between the two independent models."
      : "Measured on " + a.length + " shared games, nfelo and 538-classic agree at r = " +
        c.toFixed(3) + " in log-odds. Two lines that agree that closely are close to one line.";
  }

  /* ---------------------------------------------------------------- method */
  function drawMethod(fc) {
    var host = $("cwMethod");
    host.replaceChildren();
    if (!fc) {
      var p = document.createElement("p");
      p.className = "note bad";
      p.textContent = "The contract could not be read, so the method is not shown. " +
        "It is deliberately not restated here from memory.";
      host.appendChild(p);
      return;
    }
    var add = function (title, body) {
      var h = document.createElement("h3"); h.textContent = title; h.style.marginTop = "20px";
      var p = document.createElement("p"); p.className = "sub"; p.textContent = body;
      host.appendChild(h); host.appendChild(p);
    };
    add("The formula", fc.scoring.formula + "  Ceiling " + fc.scoring.ceiling +
        ", floor " + fc.scoring.floor + ". " + fc.scoring.neutral + " " + fc.scoring.equivalence);

    var h = document.createElement("h3"); h.textContent = "Where this deviates from 538";
    h.style.marginTop = "20px"; host.appendChild(h);
    var ul = document.createElement("ul"); ul.className = "sub";
    (fc.scoring.deviations_from_538 || []).forEach(function (d) {
      var li = document.createElement("li"); li.textContent = d; ul.appendChild(li);
    });
    host.appendChild(ul);

    add("Touched is not a value", fc.entry_rules.touched_is_separate);
    add("…and the server cannot see a drag", fc.entry_rules.touched_is_client_asserted);
    add("The number everything scores", fc.entry_rules.canonical_probability);
    add("The lock", fc.entry_rules.lock);
    add("Privacy", fc.entry_rules.privacy);
    add("No running total, anywhere", fc.entry_rules.granularity);
    if (fc.entrants) add("People and bots share one namespace", fc.entrants.one_namespace);
    if (fc.crowd_consensus && fc.crowd_consensus.humans_only)
      add("Why bots are not the crowd", fc.crowd_consensus.humans_only);
    if (fc.crowd_consensus) {
      add("How the crowd line is built", fc.crowd_consensus.formula + " " + fc.crowd_consensus.log_odds_reason);
      add("It is sealed, and never corrected", fc.crowd_consensus.immutability + " " + fc.crowd_consensus.recomputable);
    }
  }

  /* ---------------------------------------------------------------- boot */
  DDSheets({key:"challenge", mount:"#sheets", sheets:[
    {id:"board",       label:"Board",       panel:"#sheetBoard"},
    {id:"leaderboard", label:"Leaderboard", panel:"#sheetBoardLb"},
    {id:"models",      label:"Models",      panel:"#sheetBoardModels"},
    {id:"method",      label:"Method",      panel:"#sheetBoardMethod"}
  ]});

  json("/data/nfl-schedule.json").then(function (env) {
    (env.data.games || []).forEach(function (g) {
      var k = Date.parse(g.kickoff_at);
      if (!isFinite(k)) return;
      var row = { game_id: g.game_id, season: g.season, week: g.week, kickoff_ms: k,
                  home_team: g.home_team, away_team: g.away_team };
      games.push(row);
      (byWeek[g.week] = byWeek[g.week] || []).push(row);
    });
    Object.keys(byWeek).forEach(function (w) {
      byWeek[w].sort(function (a, b) { return a.kickoff_ms - b.kickoff_ms; });
    });
    var weeks = Object.keys(byWeek).map(Number).sort(function (a, b) { return a - b; });
    /* Open on the first week that still has an unlocked game — the one you can act on. */
    var open = weeks.find(function (w) {
      return byWeek[w].some(function (g) { return g.kickoff_ms > Date.now(); });
    });
    week = open != null ? open : weeks[weeks.length - 1];
    var sel = $("cwWeek");
    weeks.forEach(function (w) {
      var o = document.createElement("option");
      o.value = String(w); o.textContent = "Week " + w;
      if (w === week) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { week = Number(sel.value); loadMine(); });
    $("cwWeekTag").textContent = games.length + " games on the canonical schedule";
    paintAuth();
    loadMine();
  }).catch(function (e) {
    $("cwMsg").className = "note bad";
    $("cwMsg").textContent = "The schedule could not be read: " + e.message;
  });

  json("/data/model-receipts.json").then(function (env) {
    var rows = env.data || [];
    rows.forEach(function (r) {
      if (typeof r.home_win_probability !== "number") return;
      (modelsByGame[r.game_id] = modelsByGame[r.game_id] || [])
        .push({ model_id: r.model_id, p: r.home_win_probability });
    });
    $("cwMdAsOf").textContent = "as of " + (env.as_of || "");
    drawModels(rows);
    drawBoard();
  }).catch(function () {
    $("cwCorr").className = "note bad";
    $("cwCorr").textContent = "The model receipts could not be read, so no model line is shown.";
  });

  json("/data/model-contracts.json").then(function (env) {
    contract = env.data && env.data.forecast_challenge_contract;
    drawMethod(contract);
  }).catch(function () { drawMethod(null); });

  /* The banner chip signing in or out repaints the board in the same tick. */
  window.addEventListener("dd-auth", function () { paintAuth(); loadMine(); });

  /* The countdown is courtesy, so a cheap repaint is enough. */
  setInterval(function () { if (games.length) drawBoard(); }, 60000);
})();
</script>
"""

page = prefix + MAIN + "\n" + ddsheets + "\n" + SCRIPT + "\n</body>\n</html>\n"

# ---- guards ----------------------------------------------------------------------
assert page.count("<main>") == 1 and page.count("</main>") == 1, "main is not balanced"
assert page.count("<html") == 1 and page.count("</html>") == 1, "html is not balanced"
assert page.count("<script") == page.count("</script>"), "unbalanced script tags"
assert "\r" not in page, "a CR reached the page before it was even written"
# ⚠️ The one client-side rule that silently poisons the crowd line if it is ever broken.
assert "slider_value !== 50" not in page, "touched must never be derived from the value"
assert "touchedGames.add" in page, "touched is not being set from an input event"
assert '"home_win_probability"' not in SCRIPT, "the client must not send the canonical probability"
assert 'data-tier="labs"' in page, "the tier chip is what build-data reads the tier from"

OUT.write_text(page, encoding="utf-8", newline="\n")
print(f"wrote {OUT.name}: {page.count(chr(10)) + 1} lines, {len(page.encode('utf-8')) / 1024:.1f} KB")
