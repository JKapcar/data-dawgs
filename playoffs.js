/* playoffs.js — Playoff Leverage (Pup). Renders /data/nfl-playoff-leverage.json.
 *
 * Nothing on this page is computed in the browser. The chart, the result switches, the
 * root-for guide and both tables read simulation output the file already carries
 * (tools/build-playoff-leverage.js over work/playoff-leverage-engine.js, rebuilt daily).
 *
 * ⚠️ ONE GAME AT A TIME. A game's "if X wins" numbers hold every other game at its own
 *    simulated result. Two flipped games are not additive and the file never computed
 *    the combination, so setting one switch resets the others instead of implying it.
 * ⚠️ FAILS LOUD. An unreadable or malformed file shows an error where the chart would be;
 *    an empty chart would read as "nothing matters this week", which is a false claim.
 * ⚠️ HONEST ENDS. Values under 0.5% print as "<1" and over 99.5% as ">99": 100,000
 *    seasons cannot tell "very unlikely" from "eliminated", and the fixed-strength model
 *    is overconfident near the ends. Never print a bare 0 or 100 for a simulated share.
 */
(function () {
  "use strict";
  const DATA_URL = "/data/nfl-playoff-leverage.json";
  const COLORS_URL = "/data/nfl-team-colors.json";
  const TEAM_KEY = "dd-playoffs-team";
  const STALE_DAYS = 2;
  const RIPPLE_MIN = 0.002; // probability scale: smaller third-team moves are not listed
  const $ = id => document.getElementById(id);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { env: null, colors: {}, team: "", flip: null, view: "chart", byTeam: new Map(), index: new Map() };

  /* ------------------------------------------------------------ helpers ---- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const pctText = v => {
    const x = v * 100;
    if (x < 0.5) return "<1";
    if (x >= 99.5) return ">99";
    return String(Math.round(x));
  };
  const pct1 = v => (v * 100).toFixed(1);
  const signed = v => {
    const x = v * 100;
    if (Math.abs(x) < 0.05) return "<0.1";
    return (x > 0 ? "+" : "−") + Math.abs(x).toFixed(1);
  };
  const kickoffText = iso => new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(iso)) + " ET";
  const dateText = ymd => new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(ymd + "T00:00:00Z"));
  const team = code => state.byTeam.get(code);
  const nameOf = code => (team(code) ? team(code).name : code);
  const idx = code => state.index.get(code);
  /* white or near-black ink on a team colour, by relative luminance */
  function inkOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "";
    const ch = k => { const c = parseInt(m[1].slice(k, k + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#140a02" : "#ffffff";
  }
  function chip(code) {
    const c = el("span", "pl-chip", code);
    const hex = state.colors[code];
    if (hex) { c.style.background = hex; c.style.color = inkOn(hex); }
    return c;
  }
  async function getJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url} returned ${r.status}`);
    return r.json();
  }
  /* count a readout from one value to another; instant under reduced motion */
  function roll(node, from, to, fmt) {
    if (reduceMotion() || from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 320;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      node.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ----------------------------------------------------------- validate ---- */
  function check(env) {
    const d = env && env.data;
    if (!d || !Array.isArray(d.teams) || d.teams.length !== 32 || !Array.isArray(d.games) || !Array.isArray(d.team_order))
      throw new Error("the file is not the playoff-leverage shape this page reads");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env.as_of || "")) throw new Error("the file carries no as_of date");
    for (const g of d.games) {
      if (!Array.isArray(g.teams) || g.teams.length !== 2 || g.if_home_win.length !== 32 || g.if_away_win.length !== 32)
        throw new Error(`game ${g.game_id} is malformed`);
    }
    return env;
  }

  /* --------------------------------------------------------------- hero ---- */
  function renderHero(env) {
    const d = env.data;
    $("pl-kicker").textContent = d.week == null
      ? `NFL · ${d.season} · regular season complete`
      : `NFL · ${d.season} · Week ${d.week} playoff leverage`;
    $("pl-week").textContent = d.week == null ? "the rest of the season" : `Week ${d.week}`;
    const status = $("pl-status");
    status.textContent = "";
    const short = ymd => dateText(ymd).replace(/, \d{4}$/, "");
    const parts = [
      `Simulation · ${d.sims.toLocaleString("en-US")} seasons`,
      `as of ${short(env.as_of)}`,
      `nfelo of ${env.inputs.probabilities.captured ? short(env.inputs.probabilities.captured) : "unknown date"}`,
    ];
    if (d.last_final) {
      const f = d.last_final;
      const hw = f.home_score >= f.away_score;
      parts.push(`results through ${nameOf(hw ? f.home : f.away)} ${Math.max(f.home_score, f.away_score)}, ` +
        `${nameOf(hw ? f.away : f.home)} ${Math.min(f.home_score, f.away_score)} (${kickoffText(f.kickoff_at).split(" ")[0]})`);
    }
    status.textContent = parts.join(" · ");
    const age = Math.round((Date.now() - Date.parse(env.as_of + "T12:00:00Z")) / 86400000);
    const stale = $("pl-stale");
    if (age > STALE_DAYS) {
      stale.hidden = false;
      stale.textContent = `This snapshot is ${age} days old. The daily rebuild may have stopped; treat every number below as of ${dateText(env.as_of)}.`;
    } else stale.hidden = true;
  }

  /* -------------------------------------------------------------- chart ---- */
  /* One row per team: the bar runs from P(playoffs | loss) to P(playoffs | win), the tick
     marks the unforced estimate. Positions are percentages of the plot, so the layout
     never measures text. */
  function teamRow(g, t) {
    const row = el("div", "pl-row");
    row.dataset.team = t.team;
    row.tabIndex = 0;
    const lo = Math.min(t.if_loss, t.if_win), hi = Math.max(t.if_loss, t.if_win);
    const label = `${nameOf(t.team)}: ${pct1(t.if_loss)}% to make the playoffs with a loss, ${pct1(t.now)}% now, ` +
      `${pct1(t.if_win)}% with a win. Swing ${signed(t.swing)} points.`;
    row.setAttribute("aria-label", label);

    const who = el("div", "pl-team");
    who.append(chip(t.team), el("span", "pl-name", nameOf(t.team)));
    const track = el("div", "pl-track");
    const plot = el("div", "pl-plot");
    const bar = el("span", "pl-bar");
    bar.style.left = `${lo * 100}%`; bar.style.width = `${(hi - lo) * 100}%`;
    if (t.if_win < t.if_loss) bar.classList.add("pl-bar-rev");
    const loss = el("span", "pl-dot pl-loss"); loss.style.left = `${t.if_loss * 100}%`;
    const win = el("span", "pl-dot pl-win"); win.style.left = `${t.if_win * 100}%`;
    const tick = el("span", "pl-tick"); tick.style.left = `${t.now * 100}%`;
    /* labels sit on the OUTSIDE of the pair, so they never collide with each other */
    const loLab = el("span", "pl-lab pl-lab-lo", pctText(lo)); loLab.style.left = `${lo * 100}%`;
    const hiLab = el("span", "pl-lab pl-lab-hi", pctText(hi)); hiLab.style.left = `${hi * 100}%`;
    plot.append(bar, loss, win, tick, loLab, hiLab);
    track.append(plot);
    const sw = el("div", "pl-swing");
    const swv = el("span", "pl-swing-v", signed(t.swing));
    const read = el("span", "pl-read");
    read.setAttribute("aria-live", "polite");
    sw.append(swv, read);
    row.append(who, track, sw);
    row._parts = { tick, read, t };
    return row;
  }

  function switchFor(g) {
    const fs = el("fieldset", "pl-switch");
    fs.dataset.pos = "now";
    fs.append(el("legend", "pl-sr", `Play out ${nameOf(g.away)} at ${nameOf(g.home)}`));
    const opts = [["away", `${g.away} win`], ["now", "Now"], ["home", `${g.home} win`]];
    for (const [value, text] of opts) {
      const lab = el("label", "pl-opt");
      const input = el("input");
      input.type = "radio"; input.name = `pl-sw-${g.game_id}`; input.value = value;
      input.checked = value === "now";
      input.addEventListener("change", () => { if (input.checked) setFlip(g.game_id, value); });
      lab.append(input, el("span", "", text));
      fs.append(lab);
    }
    fs.append(el("i", "pl-thumb"));
    fs.querySelector(".pl-thumb").setAttribute("aria-hidden", "true");
    return fs;
  }

  function gameCard(g) {
    const card = el("article", "pl-game");
    card.id = `g-${g.game_id}`;
    card.dataset.game = g.game_id;
    const head = el("header", "pl-ghead");
    const title = el("h3", "pl-gtitle");
    title.append(document.createTextNode(`${nameOf(g.away)} at ${nameOf(g.home)}`));
    const when = el("span", "pl-when", kickoffText(g.kickoff_at) + (g.neutral_site ? " · neutral site" : ""));
    title.append(when);
    head.append(title, switchFor(g));
    card.append(head);
    if (Date.now() > Date.parse(g.kickoff_at)) {
      card.append(el("p", "pl-kicked", "Kicked off after this snapshot: the result is not in these numbers yet."));
    }
    for (const t of g.teams) card.append(teamRow(g, t));
    const ripple = el("p", "pl-ripple");
    ripple.hidden = true;
    ripple.setAttribute("aria-live", "polite");
    card.append(ripple);
    card._ripple = ripple;
    return card;
  }

  function renderChart(env) {
    const d = env.data;
    const box = $("pl-chart");
    box.textContent = "";
    if (d.week == null || !d.games.length) {
      box.append(el("div", "pl-empty", "The regular season is complete: no unplayed games are left to swing anyone's playoff chances. The table below is the simulated field from the final results."));
      return;
    }
    const axis = el("div", "pl-axis");
    axis.setAttribute("aria-hidden", "true");
    const ap = el("div", "pl-plot");
    for (const v of [0, 20, 40, 60, 80, 100]) {
      const s = el("span", "pl-axis-l", `${v}%`); s.style.left = `${v}%`; ap.append(s);
    }
    const ax = el("div", "pl-track"); ax.append(ap);
    axis.append(el("div", "pl-axis-lead", ""), ax, el("div", "pl-axis-sw", "Swing"));
    box.append(axis);
    for (const g of d.games) box.append(gameCard(g));
    const byes = d.byes || [];
    if (byes.length) box.append(el("p", "pl-byes", `On bye in Week ${d.week}: ${byes.map(nameOf).join(", ")}. Their chances still move with other results — pick one under "Your team".`));
    if (d.week_games && d.week_games.final) {
      box.append(el("p", "pl-byes", `${d.week_games.final} of ${d.week_games.total} Week ${d.week} games are already final and sit in the results, not on this chart.`));
    }
  }

  /* ------------------------------------------------------------ the flip ---- */
  function branchValue(g, code, side) {
    const i = idx(code);
    if (side === "home") return g.if_home_win[i];
    if (side === "away") return g.if_away_win[i];
    return team(code).playoffs;
  }
  function setFlip(gameId, side) {
    state.flip = side === "now" ? null : { gameId, side };
    for (const card of document.querySelectorAll(".pl-game")) {
      const g = state.env.data.games.find(x => x.game_id === card.dataset.game);
      const mine = state.flip && state.flip.gameId === g.game_id;
      const pos = mine ? state.flip.side : "now";
      const fs = card.querySelector(".pl-switch");
      if (fs.dataset.pos !== pos) {
        fs.dataset.pos = pos;
        const input = fs.querySelector(`input[value="${pos}"]`);
        if (input && !input.checked) input.checked = true;
      }
      card.classList.toggle("pl-flipped", Boolean(mine));
      for (const row of card.querySelectorAll(".pl-row")) {
        const { tick, read, t } = row._parts;
        const from = parseFloat(tick.style.left) / 100;
        const to = branchValue(g, t.team, pos);
        tick.style.left = `${to * 100}%`;
        if (pos === "now") { read.textContent = ""; row.classList.remove("pl-moved"); continue; }
        row.classList.add("pl-moved");
        read.textContent = "";
        const now = el("span", "", `${pctText(t.now)} → `), val = el("b", "");
        read.append(now, val);
        roll(val, from, to, v => pctText(v));
      }
      card._ripple.hidden = !mine;
      if (mine) card._ripple.replaceChildren(...rippleNodes(g, pos));
    }
    publishState();
  }
  function rippleNodes(g, side) {
    const winner = side === "home" ? g.home : g.away;
    const own = new Set([g.home, g.away]);
    const moves = state.env.data.team_order.map(code => ({ code, d: branchValue(g, code, side) - team(code).playoffs }))
      .filter(m => !own.has(m.code) && Math.abs(m.d) >= RIPPLE_MIN)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const nodes = [el("b", "", `If the ${nameOf(winner)} win: `)];
    const shown = moves.slice(0, 6);
    if (state.team && !own.has(state.team) && !shown.some(m => m.code === state.team)) {
      const m = { code: state.team, d: branchValue(g, state.team, side) - team(state.team).playoffs };
      shown.push(m);
    }
    if (!shown.length) nodes.push(document.createTextNode("no other club moves by 0.2 points or more."));
    shown.forEach((m, k) => {
      if (k) nodes.push(document.createTextNode(" · "));
      const s = el("span", m.code === state.team ? "pl-mine" : "", `${nameOf(m.code)} ${signed(m.d)}`);
      nodes.push(s);
    });
    if (shown.length) nodes.push(document.createTextNode(" points to make the playoffs, against now."));
    return nodes;
  }

  /* -------------------------------------------------------- root-for guide ---- */
  function renderPicker(env) {
    const sel = $("pl-team");
    sel.textContent = "";
    sel.append(new Option("Pick a team", ""));
    for (const conf of ["AFC", "NFC"]) {
      const og = document.createElement("optgroup");
      og.label = conf;
      env.data.teams.filter(t => t.conf === conf).sort((a, b) => a.name.localeCompare(b.name))
        .forEach(t => og.append(new Option(`${t.name} (${t.team})`, t.team)));
      sel.append(og);
    }
    let saved = "";
    const hash = decodeURIComponent(location.hash.replace(/^#/, "")).toUpperCase();
    if (state.byTeam.has(hash)) saved = hash;
    else { try { saved = localStorage.getItem(TEAM_KEY) || ""; } catch (_) { saved = ""; } }
    if (state.byTeam.has(saved)) { sel.value = saved; state.team = saved; }
    sel.addEventListener("change", () => {
      state.team = sel.value;
      try { state.team ? localStorage.setItem(TEAM_KEY, state.team) : localStorage.removeItem(TEAM_KEY); } catch (_) { /* storage blocked */ }
      renderRoot();
      if (state.flip) setFlip(state.flip.gameId, state.flip.side);
      publishState();
    });
  }
  function renderRoot() {
    const box = $("pl-root");
    box.textContent = "";
    for (const r of document.querySelectorAll(".pl-row, .pl-odds tr[data-team]")) r.classList.toggle("pl-yours", r.dataset.team === state.team);
    const d = state.env.data;
    box.classList.toggle("pl-root-empty", !state.team);
    if (!state.team) { box.append(el("p", "pl-hint", "Pick a team to see which results help it this week, from its own game down to the ones it can only watch.")); return; }
    const me = team(state.team), i = idx(state.team);
    const head = el("p", "pl-root-head");
    head.append(chip(me.team), el("b", "", me.name),
      el("span", "", `${me.w}-${me.l}${me.t ? "-" + me.t : ""} · ${pctText(me.playoffs)}% to make the playoffs now`));
    box.append(head);
    if (d.week == null) { box.append(el("p", "pl-hint", "No games left to root for.")); return; }
    box.append(el("p", "pl-root-unit", `Each line: how many points of playoff chance the better result is worth to the ${me.name}, against the other result.`));
    const rows = d.games.map(g => {
      const hw = g.if_home_win[i], aw = g.if_away_win[i];
      const playing = g.home === state.team || g.away === state.team;
      const pickSide = playing ? (g.home === state.team ? "home" : "away") : (hw >= aw ? "home" : "away");
      return { g, playing, pickSide, gain: Math.abs(hw - aw), hw, aw };
    }).sort((a, b) => (b.playing - a.playing) || (b.gain - a.gain));
    const list = el("ol", "pl-root-list");
    const max = Math.max(...rows.map(r => r.gain), 1e-9);
    let quiet = 0;
    for (const r of rows) {
      if (!r.playing && r.gain < RIPPLE_MIN) { quiet++; continue; }
      const g = r.g, fav = r.pickSide === "home" ? g.home : g.away, other = r.pickSide === "home" ? g.away : g.home;
      const li = el("li", r.playing ? "pl-root-own" : "");
      const text = el("span", "pl-root-text");
      if (r.playing) {
        const t = g.teams.find(x => x.team === state.team);
        text.append(el("b", "", `Win their own game vs ${nameOf(other)}`), document.createTextNode(`: ${pctText(t.if_loss)} → ${pctText(t.if_win)} (${signed(t.swing)})`));
      } else {
        text.append(document.createTextNode("Root for "), el("b", "", nameOf(fav)), document.createTextNode(` over ${nameOf(other)}: ${signed(r.gain)}`));
      }
      const meter = el("span", "pl-root-meter");
      const fill = el("i", ""); fill.style.width = `${Math.max(4, (r.gain / max) * 100)}%`;
      meter.append(fill);
      meter.setAttribute("aria-hidden", "true");
      const go = el("button", "pl-root-go", "Show");
      go.type = "button";
      go.setAttribute("aria-label", `Show ${nameOf(g.away)} at ${nameOf(g.home)} with the ${nameOf(fav)} winning`);
      go.addEventListener("click", () => {
        setFlip(g.game_id, r.pickSide);
        const card = $(`g-${g.game_id}`);
        if (card) {
          card.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
          const input = card.querySelector(`input[value="${r.pickSide}"]`);
          if (input) input.focus({ preventScroll: true });
        }
      });
      li.append(text, meter, go);
      list.append(li);
    }
    box.append(list);
    if ((d.byes || []).includes(state.team)) box.append(el("p", "pl-hint", `The ${me.name} are on bye in Week ${d.week}.`));
    if (quiet) box.append(el("p", "pl-hint", `${quiet} other ${quiet === 1 ? "game moves" : "games move"} the ${me.name} by less than 0.2 points either way.`));
  }

  /* ------------------------------------------------------------- tables ---- */
  function renderChartTable(env) {
    const wrap = $("pl-chart-table");
    wrap.textContent = "";
    const table = el("table", "pl-table");
    table.append(el("caption", "", `Week ${env.data.week} · playoff chances by result · simulated, as of ${env.as_of}`));
    const hr = el("tr", "");
    for (const [full, brief] of [["Game", "Game"], ["Team", "Team"], ["If they lose", "Lose"], ["Now", "Now"], ["If they win", "Win"], ["Swing (pts)", "Swing"], ["± sim. error", "±"]]) {
      const th = el("th", full === "Game" ? "pl-col-game" : "");
      th.append(el("span", "pl-th-l", full), el("span", "pl-th-s", brief));
      hr.append(th);
    }
    const thead = el("thead", ""); thead.append(hr); table.append(thead);
    const body = el("tbody", "");
    for (const g of env.data.games) for (const t of g.teams) {
      const tr = el("tr", "");
      tr.append(el("td", "pl-col-game", `${g.away} at ${g.home}`), el("td", "", nameOf(t.team)),
        el("td", "num", pctText(t.if_loss) + "%"), el("td", "num", pctText(t.now) + "%"), el("td", "num", pctText(t.if_win) + "%"),
        el("td", "num", signed(t.swing)), el("td", "num", (t.swing_se * 100).toFixed(2)));
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
  }
  function renderOdds(env) {
    const wrap = $("pl-odds");
    wrap.textContent = "";
    for (const conf of ["AFC", "NFC"]) {
      const table = el("table", "pl-table pl-odds");
      table.append(el("caption", "", `${conf} · simulated as of ${env.as_of} · records are real results`));
      const hr = el("tr", "");
      /* full and phone headers both in the DOM; CSS shows one, so 390px needs no sideways scroll */
      for (const [full, brief] of [["Team", "Team"], ["Record", "Rec"], ["Playoffs", "PO"], ["Division", "Div"], ["Bye (#1)", "Bye"], ["Avg wins", "W"]]) {
        const th = el("th", "");
        th.append(el("span", "pl-th-l", full), el("span", "pl-th-s", brief));
        if (full !== brief) th.title = full;
        hr.append(th);
      }
      const thead = el("thead", ""); thead.append(hr); table.append(thead);
      const body = el("tbody", "");
      env.data.teams.filter(t => t.conf === conf).sort((a, b) => b.playoffs - a.playoffs || b.wins_mean - a.wins_mean)
        .forEach(t => {
          const tr = el("tr", t.team === state.team ? "pl-yours" : "");
          tr.dataset.team = t.team;
          const who = el("td", "pl-tteam"); who.append(chip(t.team), el("span", "pl-tname", ` ${t.name}`));
          tr.append(who, el("td", "num", `${t.w}-${t.l}${t.t ? "-" + t.t : ""}`), el("td", "num", pctText(t.playoffs) + "%"),
            el("td", "num", pctText(t.division_title) + "%"), el("td", "num", pctText(t.bye) + "%"), el("td", "num", t.wins_mean.toFixed(1)));
          body.append(tr);
        });
      table.append(body);
      wrap.append(table);
    }
  }
  function renderMethod(env) {
    const m = env.method, inp = env.inputs;
    const list = $("pl-inputs");
    list.textContent = "";
    const item = (label, href, text) => {
      const li = el("li", "");
      const a = el("a", "", label); a.href = href;
      li.append(a, document.createTextNode(` — ${text}`));
      list.append(li);
    };
    item("/data/nfl-schedule.json", inp.schedule.url,
      `results: ${inp.schedule.finals} finals, ${inp.schedule.unplayed} games to play; captured ${inp.schedule.captured_at}, snapshot ${inp.schedule.snapshot_id.slice(0, 19)}…`);
    item("/data/survivor.json", inp.probabilities.url,
      `game probabilities: nfelo ${inp.probabilities.nfelo_sha}, captured ${inp.probabilities.captured}. This week: ${inp.probabilities.current_week}. Later weeks: ${inp.probabilities.later_weeks}`);
    item("/data/nfl-playoff-leverage.json", "/data/nfl-playoff-leverage.json",
      `this page's numbers: ${env.data.sims.toLocaleString("en-US")} seasons, seed ${env.data.seed.slice(0, 12)}…, ${m.engine}`);
    const lim = $("pl-limits");
    lim.textContent = "";
    for (const l of m.limits) lim.append(el("li", "", l));
  }

  function setView(view) {
    state.view = view;
    for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
    $("pl-chart").hidden = view !== "chart";
    $("pl-chart-table").hidden = view !== "table";
    publishState();
  }

  /* ------------------------------------------------------------- tooltip ---- */
  function wireTooltip() {
    const tip = $("pl-tip");
    const show = row => {
      const { t } = row._parts;
      tip.replaceChildren();
      tip.append(el("span", "pl-tip-name", nameOf(t.team)));
      const line = (k, v) => { const p = el("span", "pl-tip-line"); p.append(el("b", "", v), document.createTextNode(" " + k)); tip.append(p); };
      line("if they lose", pct1(t.if_loss) + "%");
      line("now", pct1(t.now) + "%");
      line("if they win", pct1(t.if_win) + "%");
      line(`swing, ±${(t.swing_se * 100).toFixed(2)} simulation error`, signed(t.swing) + " pts");
      line(`chance to win this game (nfelo)`, Math.round(t.p_win * 100) + "%");
      tip.hidden = false;
      /* position:fixed, viewport coordinates; flips below the row when there is no room above */
      const r = row.querySelector(".pl-track").getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      const x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), innerWidth - tw - 8);
      const above = r.top - th - 8;
      tip.style.left = `${x}px`;
      tip.style.top = `${above >= 8 ? above : r.bottom + 8}px`;
    };
    const hide = () => { tip.hidden = true; };
    const chart = $("pl-chart");
    chart.addEventListener("pointerover", e => { const row = e.target.closest(".pl-row"); if (row) show(row); });
    chart.addEventListener("pointerout", e => { const row = e.target.closest(".pl-row"); if (row && !row.contains(e.relatedTarget)) hide(); });
    chart.addEventListener("focusin", e => { const row = e.target.closest(".pl-row"); if (row && e.target === row) show(row); });
    chart.addEventListener("focusout", hide);
    addEventListener("scroll", hide, { passive: true });
  }

  /* ---------------------------------------------------------------- Toto ---- */
  function publishState() {
    window.DDPlayoffState = state.env ? {
      file: DATA_URL, as_of: state.env.as_of, view: state.view, team: state.team || null,
      flipped: state.flip ? { game_id: state.flip.gameId, winner: state.flip.side } : null,
    } : null;
  }
  /* ⚠️ COMPACT ON PURPOSE. The Worker caps a request at 24,000 bytes and Toto's frame
     (core prompt, HELP, MAP, history) already spends most of it; a JSON dump of this file
     would be truncated mid-table. Plain lines carry every number on the page in ~2 KB. */
  function spine() {
    const env = state.env;
    if (!env) return `NOT LOADED: ${$("pl-status").textContent || "the simulation file has not loaded"}`;
    const d = env.data, p = v => (v * 100).toFixed(1);
    const lines = [
      `FILE ${DATA_URL} · as_of ${env.as_of} · SIMULATION, ungraded · ${d.sims} seasons · season ${d.season} week ${d.week} · nfelo ${env.inputs.probabilities.nfelo_sha} captured ${env.inputs.probabilities.captured} · schedule captured ${env.inputs.schedule.captured_at}`,
    ];
    /* reader state first: if the request cap truncates, it cuts the all-32 list, not this */
    if (state.flip) {
      const card = $(`g-${state.flip.gameId}`);
      lines.push(`SWITCH SET: ${state.flip.gameId}, ${state.flip.side} team wins. ` + (card && card._ripple ? card._ripple.textContent : ""));
    } else lines.push("SWITCH SET: none (every game at Now)");
    if (state.team) {
      const i = idx(state.team);
      lines.push(`READER'S TEAM ${state.team}: its P(playoffs)% if home wins/if away wins, per game: ` +
        d.games.map(g => `${g.away}@${g.home} ${p(g.if_home_win[i])}/${p(g.if_away_win[i])}`).join(", "));
    }
    if (d.last_final) lines.push(`LAST FINAL ${d.last_final.away} ${d.last_final.away_score} at ${d.last_final.home} ${d.last_final.home_score}`);
    if (d.byes && d.byes.length) lines.push(`BYES ${d.byes.join(" ")}`);
    lines.push("GAMES, by leverage (P(playoffs)% if lose/now/if win, swing pts±sim. error, nfelo win%):");
    for (const g of d.games) lines.push(`${g.away}@${g.home}: ` + g.teams.map(t =>
      `${t.team} ${p(t.if_loss)}/${p(t.now)}/${p(t.if_win)} ${signed(t.swing)}±${p(t.swing_se)} w${Math.round(t.p_win * 100)}`).join("; "));
    lines.push("ALL 32 (record playoffs% division% bye% avg-wins): " + d.teams.slice().sort((a, b) => b.playoffs - a.playoffs)
      .map(t => `${t.team} ${t.w}-${t.l}${t.t ? "-" + t.t : ""} ${p(t.playoffs)} ${p(t.division_title)} ${p(t.bye)} ${t.wins_mean}`).join(", "));
    return lines.join("\n");
  }
  window.DD_BOTCTX = {
    label: "Playoff leverage",
    title: "Ask about this week's playoff leverage",
    chrome: {
      sub: "Playoff leverage · Pup · simulation",
      ph: "Ask about a game or a team…",
      chips: ["Which game matters most this week?", "Who should Browns fans root for?", "How is this calculated?", "Why can these be wrong?"],
    },
    sys: "You are on Playoff Leverage (Lab/Pup). Every number is SIMULATION OUTPUT from /data/nfl-playoff-leverage.json: ungraded, not a forecast receipt, not a consensus, not a betting signal. Quote its as_of date with any number. " +
      "Each simulated season keeps finished games' real results and plays each unplayed game once at its /data/survivor.json home-win probability (published nfelo forecast this week, nfelo season projection later). if_win/if_loss = share of seasons a team makes the playoffs with this week's game forced to a win/loss while every other game keeps its simulated result; now = unforced share; swing = if_win - if_loss; game leverage = both swings summed. " +
      "Say when relevant: team strength is fixed and games independent, so values near 0% and 100% are overconfident (the page prints <1 and >99, never 0 or 100); tie-breakers run through strength of schedule, then a coin toss (points are not simulated); a game that kicked off after the snapshot is still simulated. " +
      "ONE GAME AT A TIME: swings are not additive and no combination or later-week scenario was computed, so never add them or estimate one; say it is not computed. Moves under 0.2 points are noise-level and unlisted. Use only numbers in the state block.",
    ctx: () => spine(),
  };

  /* ---------------------------------------------------------------- boot ---- */
  async function boot() {
    for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
    try {
      const [env, colors] = await Promise.all([
        getJson(DATA_URL).then(check),
        getJson(COLORS_URL).then(c => c.data || {}).catch(() => ({})),
      ]);
      state.env = env; state.colors = colors;
      env.data.teams.forEach(t => state.byTeam.set(t.team, t));
      env.data.team_order.forEach((t, i) => state.index.set(t, i));
      renderHero(env);
      renderPicker(env);
      renderChart(env);
      renderChartTable(env);
      renderOdds(env);
      renderMethod(env);
      renderRoot();
      wireTooltip();
      setView("chart");
      document.body.classList.add("pl-ready");
    } catch (err) {
      $("pl-status").textContent = "Could not load the simulation.";
      $("pl-status").classList.add("bad");
      const box = $("pl-chart");
      box.textContent = "";
      box.append(el("div", "pl-error", `The simulation file could not be read, so nothing is drawn rather than a guess: ${err.message}`));
    }
    publishState();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
