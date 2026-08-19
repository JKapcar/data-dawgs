#!/usr/bin/env python3
"""
patch-bozo-slip.py — the shared DraftKings betslip link.

One link per league per week, posted by ANY member, sitting at the top of the
ticket so seven people do not retype an eight-leg parlay by hand.

Idempotent and anchor-based, per AGENTS.md. Every replacement asserts it matched
exactly once; a file that has drifted fails loudly instead of half-applying.

Two files, one commit:
  dawg-bot-worker.js — requireMember (a power that did not exist), the DK-only
                       validator, POST /league/slip, and the two lines in
                       bozoNext that decide the link's lifetime.
  bozo.html          — the slip bar at the top of the board's ticket, and a
                       read-only line on the hub's house ticket.

⚠️ THE ROLLOVER LINES ARE THE POINT. bozoNext nulls this week's children BY NAME
and lets everything else survive. A `slip` node added without touching it would
leak last week's betslip into the new week, still clickable, pointing at a
settled parlay. `slip: null` in that patch is what clears it, and the copy into
the history row is what keeps it on a graded week.
"""
import sys, pathlib

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
WK   = ROOT / 'dawg-bot-worker.js'
PG   = ROOT / 'bozo.html'

files = {p: p.read_text(encoding='utf-8') for p in (WK, PG)}


def once(p, old, new, what):
    """Replace exactly once. Tests the REPLACEMENT first so a re-run is a no-op
    even where the replacement keeps its own anchor."""
    s = files[p]
    if new in s:
        print('  = %s: already applied' % what)
        return
    n = s.count(old)
    assert n == 1, '%s: expected 1 occurrence of anchor, found %d' % (what, n)
    files[p] = s.replace(old, new, 1)
    print('  + %s' % what)


# ============================================================================
# 1 · Worker — requireMember
# ============================================================================
once(WK, """  return { ...auth, league: lg, lid, siteAdmin };
}""", """  return { ...auth, league: lg, lid, siteAdmin };
}

// Anyone whose name is on THIS league's roster. The betslip link is the first
// write a plain member can make about the WHOLE ticket rather than about their
// own leg, so it needed a power that did not exist yet: not the manager, not the
// site admin, just "you are in this league".
//
// ⚠️ Membership is checked against the STORED roster and identity comes from the
// session. Neither is ever read from the request body — a body that could name
// its own author is a body that can post as anybody.
async function requireMember(request, env, lid) {
  const auth = await sessionAuth(request, env);
  if (auth.err) return auth;
  let lg;
  try { lg = await loadLeague(env, lid); }
  catch (e) { return { err: e.message, code: 502 }; }
  if (!lg) return { err: "No such league.", code: 404 };
  const siteAdmin = env.BOZO_ADMIN && auth.name === env.BOZO_ADMIN;
  if (!siteAdmin && !memberNames(lg).includes(auth.name))
    return { err: "You're not in this league.", code: 403 };
  return { ...auth, league: lg, lid, siteAdmin };
}""", 'worker · requireMember')

# ============================================================================
# 2 · Worker — the DK-only validator and POST /league/slip
# ============================================================================
once(WK, """/* ============================== league join links ==========================""",
     """/* ============================ the betslip link ============================
   One DraftKings link per league per week, posted by any member, so that seven
   people do not retype an eight-leg parlay by hand.

   ⚠️ This is the only place on the site where one member hands the other seven a
   link to click. Two rules follow from that, and neither is negotiable:

   1. DRAFTKINGS HOSTS ONLY, ENFORCED HERE. The page checks too, but the page is a
      convenience and this function is the authority. The league books one place
      and one place only — every pick is written with entryBook "draftkings" — so
      a link pointing anywhere else is either a mistake or an attack, and both get
      the same answer.

   2. SUBDOMAIN-SCOPED, NEVER A WHOLE SHORTENER. `*.draftkings.com` is DraftKings.
      A link shortener is by definition an open redirect: allowlisting one would
      let anybody with an account there aim this button wherever they liked. The
      two share hosts below are pinned as EXACT hosts for exactly that reason.

   ⚠️ Those two share hosts are what the DraftKings app is BELIEVED to emit. They
   have not been checked against a real shared link — no sample was available when
   this shipped. A rejection names the host it saw, so if the app emits something
   else the error message is the bug report: add that exact host to this set. Do
   not answer a rejected paste by loosening the rule. */
const DK_SHARE_HOSTS = new Set(["dksb.sng.link", "draftkings.onelink.me"]);
const MAX_SLIP_URL = 600;

function dkSlipUrl(raw) {
  if (typeof raw !== "string") return { err: "Send the link as text." };
  const s = raw.trim();
  if (!s) return { err: "Paste a link first." };
  if (s.length > MAX_SLIP_URL) return { err: "That link is over " + MAX_SLIP_URL + " characters." };
  let u;
  try { u = new URL(s); } catch { return { err: "That is not a link." }; }
  if (u.protocol !== "https:") return { err: "The link has to be https." };
  // A URL carrying credentials can render as one host and resolve to another.
  if (u.username || u.password) return { err: "That link carries credentials. Paste the plain share link." };
  const host = u.hostname.toLowerCase();
  const dk = host === "draftkings.com" || host.endsWith(".draftkings.com") || DK_SHARE_HOSTS.has(host);
  if (!dk) return { err: "Only DraftKings links go on the ticket — that one points at " + host + "." };
  return { url: u.toString(), host };
}

// POST /league/slip {league, url} — ANY MEMBER. An empty url takes it down.
//
// Deliberately NOT manager-gated. Whoever actually placed the parlay is whoever
// placed it, and making them chase the manager to publish the link is how the
// link never gets published. Attribution is the check instead: the row records
// who put it up and when, and the ticket prints that next to the button.
async function leagueSlip(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body;
  try { body = await readBody(request); }
  catch { return json({ error: "Bad JSON." }, 400, cors); }

  const lid = leagueOf(body);
  if (!lid) return json({ error: "Bad league id." }, 400, cors);
  const auth = await requireMember(request, env, lid);
  if (auth.err) return json({ error: auth.err }, auth.code || 403, cors);

  // ⚠️ A graded week is a record. The link is archived into the history row on
  // rollover, so editing it afterwards rewrites a receipt that is already filed.
  if ((auth.league.status || "open") === "graded")
    return json({ error: "That week is graded. Its ticket is a receipt now." }, 409, cors);

  const raw = body.url == null ? "" : String(body.url);
  if (!raw.trim()) {
    await fbPut(env, LG(lid) + "/slip", null);
    return json({ ok: true, slip: null }, 200, cors);
  }
  const v = dkSlipUrl(raw);
  if (v.err) return json({ error: v.err }, 400, cors);

  // by/ts come from the SESSION and the SERVER, never from the body.
  const slip = { url: v.url, host: v.host, by: auth.name, ts: Date.now() };
  await fbPut(env, LG(lid) + "/slip", slip);
  return json({ ok: true, slip }, 200, cors);
}

/* ============================== league join links ==========================""",
     'worker · dkSlipUrl + /league/slip')

# ============================================================================
# 3 · Worker — route registration and the header route list
# ============================================================================
once(WK, """    if (url.pathname === "/league/lock")   return leagueLock(request, env, cors);""",
     """    if (url.pathname === "/league/lock")   return leagueLock(request, env, cors);
    if (url.pathname === "/league/slip")   return leagueSlip(request, env, cors);""",
     'worker · route registration')

once(WK, """ *   POST /league/lock    — manager: force-place when someone never submits""",
     """ *   POST /league/lock    — manager: force-place when someone never submits
 *   POST /league/slip    — any member: publish the week's DraftKings betslip link""",
     'worker · header route list')

# ============================================================================
# 4 · Worker — the two lines that decide the link's lifetime
# ============================================================================
# Kept on a graded week: the history row is all that survives rollover, so if the
# link is not copied into it the receipt loses the one thing that makes an old
# ticket checkable.
once(WK, """    history.push({ week: state.week || 1, bozo: state.bozo || null });""",
     """    history.push({ week: state.week || 1, bozo: state.bozo || null, slip: state.slip || null });""",
     'worker · keep the link on the graded week')

# Cleared for the new week. See the module header: this patch nulls BY NAME.
once(WK, """      picks: null, order: null, results: null,
      bozo: null, bozoWhy: null, closeTs: null,""",
     """      picks: null, order: null, results: null,
      bozo: null, bozoWhy: null, closeTs: null,
      // ⚠️ Named on purpose. Anything NOT named here survives the rollover, and a
      // betslip link surviving means last week's settled parlay stays on the new
      // week's ticket, still clickable. Archived into `history` just above.
      slip: null,""",
     'worker · clear the link on rollover')

# ============================================================================
# 5 · Page — CSS. The bar is a SLIP, not the bill: mono, boxed, tabular.
# ============================================================================
once(PG, """.sgpwarn{margin-top:12px;""",
     """/* ---- the betslip link, at the top of the ticket ----
   Mono and boxed, because this is the slip speaking. The destination host is
   printed next to the button on purpose: one member posts this and seven click
   it, so "where does this go" is answered before the click, not after. */
.slipbar{margin:0 0 14px}
.slipbar .sb-live{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;
  padding:11px 13px;border:1px solid var(--grid);border-radius:8px}
.slipbar .sb-go{background:var(--accent);color:var(--accent-ink);border-radius:7px;
  padding:9px 15px;text-decoration:none;white-space:nowrap;
  font:800 12px/1 ui-monospace,Menlo,monospace;letter-spacing:1.5px;text-transform:uppercase}
.slipbar .sb-meta{font:600 11px/1.5 ui-monospace,Menlo,monospace;color:var(--ink-3);
  letter-spacing:.6px;min-width:0;word-break:break-word}
.slipbar .sb-meta b{color:var(--ink-2);font-weight:700}
.slipbar .sb-acts{margin-left:auto;display:flex;gap:7px;flex-wrap:wrap}
.slipbar .sb-acts button{background:none;border:1px solid var(--border);border-radius:6px;
  color:var(--ink-3);padding:5px 9px;cursor:pointer;
  font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:1.1px;text-transform:uppercase}
.slipbar .sb-acts button:hover{color:var(--ink-2)}
.slipbar .sb-ask{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 13px;border:1px dashed var(--grid);border-radius:8px;
  font:600 11.5px/1.5 ui-monospace,Menlo,monospace;color:var(--ink-3);letter-spacing:.5px}
.slipbar .sb-ask button{margin-left:auto}
.slipbar .sb-edit{padding:11px 13px;border:1px solid var(--grid);border-radius:8px}
.slipbar .sb-edit label{display:block;font:700 10px/1 ui-monospace,Menlo,monospace;
  letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);margin:0 0 7px}
.slipbar .sb-edit .row{display:flex;gap:8px;flex-wrap:wrap}
.slipbar .sb-edit input{flex:1 1 260px;min-width:0;background:var(--surface-1);
  border:1px solid var(--border);border-radius:7px;color:var(--ink-1);padding:9px 11px;
  font:500 13px/1.3 ui-monospace,Menlo,monospace}
.slipbar .sb-quiet{font:600 11px/1.5 ui-monospace,Menlo,monospace;color:var(--ink-3);
  letter-spacing:.6px;padding:2px 1px}
.slipbar .sb-err{color:var(--bad);font-size:12.5px;font-weight:600;margin:8px 0 0;min-height:16px}
@media(max-width:520px){
  .slipbar .sb-acts{margin-left:0;width:100%}
  .slipbar .sb-go{width:100%;text-align:center}
}
.sgpwarn{margin-top:12px;""",
     'page · slip bar CSS')

# ============================================================================
# 6 · Page — the markup, at the TOP of the ticket
# ============================================================================
once(PG, """  <div class="bz-hdr"><h2 class="bz" style="margin:0">The ticket</h2><span class="tm" id="fill"></span></div>
  <div class="slip" id="board"></div>""",
     """  <div class="bz-hdr"><h2 class="bz" style="margin:0">The ticket</h2><span class="tm" id="fill"></span></div>
  <!-- The shared betslip link. Above the slip because it opens the thing below it. -->
  <div class="slipbar" id="slipBar"></div>
  <div class="slip" id="board"></div>""",
     'page · slip bar markup')

# ============================================================================
# 7 · Page — the JS
# ============================================================================
once(PG, """const kEnc = p => (S.picks && S.picks[p]) ? p : encodeURIComponent(p);

function render(){""",
     r"""const kEnc = p => (S.picks && S.picks[p]) ? p : encodeURIComponent(p);

/* ---------------- the shared betslip link ----------------
   One DraftKings link per league per week, posted by any member.

   ⚠️ THE HOST IS RE-CHECKED HERE, before anything becomes an anchor. The Worker
   validates on write and is the authority, but this node streams straight out of
   RTDB to every reader — so the page never renders a value it has not itself
   checked into a link somebody is going to click. Belt and braces, deliberately:
   the two checks are in different trust domains. */
const DK_SHARE_HOSTS = ['dksb.sng.link','draftkings.onelink.me'];
function dkHostOk(h){
  h = String(h||'').toLowerCase();
  return h==='draftkings.com' || /\.draftkings\.com$/.test(h) || DK_SHARE_HOSTS.indexOf(h)>=0;
}
// Returns a slip only if it still passes, so every caller downstream is safe.
function slipOf(){
  const sl = S.slip;
  if(!sl || typeof sl.url !== 'string') return null;
  let u; try{ u = new URL(sl.url); }catch(e){ return null; }
  if(u.protocol !== 'https:' || !dkHostOk(u.hostname)) return null;
  return {url:u.toString(), host:u.hostname.toLowerCase(), by:sl.by||'', ts:sl.ts||0};
}
let slipEdit = false, slipBusy = false;

function paintSlipBar(){
  const el = document.getElementById('slipBar');
  if(!el) return;
  const sl = slipOf();
  const mine = !!(ME && names().indexOf(ME.name)>=0);
  const graded = (S.status||'open')==='graded';
  const canPost = mine && !graded;

  if(slipEdit && canPost){
    el.innerHTML =
      `<div class="sb-edit">` +
        `<label for="slipUrl">Paste the DraftKings betslip link</label>` +
        `<div class="row">` +
          `<input id="slipUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" ` +
            `placeholder="https://sportsbook.draftkings.com/..." value="${sl?esc(sl.url):''}">` +
          `<button class="btn" data-slip="save"${slipBusy?' disabled':''}>${slipBusy?'Saving…':'Save'}</button>` +
          `<button class="chip" data-slip="cancel">Cancel</button>` +
        `</div>` +
        `<p class="sb-err" id="slipErr"></p>` +
      `</div>`;
    wireSlipBar();
    return;
  }

  if(sl){
    el.innerHTML =
      `<div class="sb-live">` +
        `<a class="sb-go" href="${esc(sl.url)}" target="_blank" rel="noopener noreferrer">Open the betslip &rarr;</a>` +
        `<span class="sb-meta">${esc(sl.host)}<br>posted by <b>${esc(sl.by||'someone')}</b>` +
          (sl.ts?` &middot; ${esc(when(sl.ts))}`:'') + `</span>` +
        (canPost ? `<span class="sb-acts">` +
          `<button data-slip="add">Replace</button>` +
          `<button data-slip="clear">Remove</button></span>` : '') +
      `</div>`;
    wireSlipBar();
    return;
  }

  if(canPost){
    el.innerHTML =
      `<div class="sb-ask"><span>No betslip link yet &mdash; whoever places it can put it here.</span>` +
        `<button class="btn" data-slip="add">Add the link</button></div>`;
    wireSlipBar();
    return;
  }

  // Nothing to show and nothing you could do about it. Say which of the two.
  el.innerHTML = (sl===null && graded)
    ? `<p class="sb-quiet">No betslip link was posted for this week.</p>`
    : `<p class="sb-quiet">No betslip link yet &mdash; anyone in the league can post one.</p>`;
}

function wireSlipBar(){
  const el = document.getElementById('slipBar');
  if(!el || el.dataset.wired) return;
  el.dataset.wired = '1';
  el.addEventListener('click', ev=>{
    const b = ev.target.closest('[data-slip]');
    if(!b) return;
    ev.preventDefault();
    const act = b.getAttribute('data-slip');
    if(act==='add'){ slipEdit = true; paintSlipBar();
      const i = document.getElementById('slipUrl'); if(i){ i.focus(); i.select(); } return; }
    if(act==='cancel'){ slipEdit = false; paintSlipBar(); return; }
    if(act==='save'){ saveSlip(); return; }
    if(act==='clear'){
      if(!confirm('Take the betslip link down?')) return;
      saveSlip('');
    }
  });
  el.addEventListener('keydown', ev=>{
    if(ev.key==='Enter' && ev.target && ev.target.id==='slipUrl'){ ev.preventDefault(); saveSlip(); }
  });
}

async function saveSlip(force){
  const err = document.getElementById('slipErr');
  const inp = document.getElementById('slipUrl');
  const raw = force!==undefined ? force : (inp ? inp.value.trim() : '');
  const say = m => { if(err) err.textContent = m; else alert(m); };

  // Mirror the Worker's rules so the ordinary mistake is answered instantly and
  // without a round trip. The Worker still decides — this only saves a request.
  if(raw){
    let u;
    try{ u = new URL(raw); }catch(e){ return say('That is not a link.'); }
    if(u.protocol !== 'https:') return say('The link has to be https.');
    if(!dkHostOk(u.hostname))
      return say('Only DraftKings links go on the ticket — that one points at ' + u.hostname.toLowerCase() + '.');
  }
  slipBusy = true; paintSlipBar();
  try{
    await wPost('/league/slip', {url: raw});
    slipEdit = false;
    if(raw) S.slip = {url: raw, host: new URL(raw).hostname.toLowerCase(), by: ME?ME.name:'', ts: Date.now()};
    else S.slip = null;
  }catch(e){
    slipBusy = false; paintSlipBar(); say(e.message); return;
  }
  slipBusy = false; paintSlipBar();
}

function render(){""",
     'page · slip bar JS')

once(PG, """  document.getElementById('ticketCard').style.display = onBoard ? '' : 'none';""",
     """  document.getElementById('ticketCard').style.display = onBoard ? '' : 'none';
  if(onBoard) paintSlipBar();""",
     'page · paint the slip bar on every render')

# ============================================================================
# 8 · Page — the hub's house ticket carries the same link, READ-ONLY
# ============================================================================
# Posting belongs on the board, where the ticket is. The bill only advertises.
once(PG, """  slip.innerHTML =
    `<div class="sl-hd"><span class="sl-t">The house ticket</span>` +""",
     """  // The betslip link, read-only here: the hub advertises, the board is where you
  // act. Same slipOf() gate, so the host is checked before this becomes an anchor.
  const hs = slipOf();
  const hubSlip = hs
    ? `<p class="sl-slip"><a href="${esc(hs.url)}" target="_blank" rel="noopener noreferrer">` +
      `Open this ticket at DraftKings &rarr;</a>` +
      `<span>${esc(hs.host)} &middot; posted by ${esc(hs.by||'someone')}</span></p>`
    : '';

  slip.innerHTML =
    `<div class="sl-hd"><span class="sl-t">The house ticket</span>` +""",
     'page · hub house ticket link')

once(PG, """    `<div class="sl-rows">${rowHtml}</div>` + tot + exp +""",
     """    `<div class="sl-rows">${rowHtml}</div>` + tot + exp + hubSlip +""",
     'page · hub link into the slip')

once(PG, """.slipbar .sb-err{""",
     """/* The hub's read-only twin. On the slip stock, like everything else there. */
.sl-slip{margin:12px 0 0;padding:11px 12px;border:1px solid var(--slip-rule);border-radius:7px;
  display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.sl-slip a{font:800 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:1.3px;
  text-transform:uppercase;color:var(--slip-red);text-decoration:none}
.sl-slip a:hover{text-decoration:underline}
.sl-slip span{font:600 10.5px/1.4 ui-monospace,Menlo,monospace;color:var(--slip-ink2);letter-spacing:.5px}
.slipbar .sb-err{""",
     'page · hub link CSS')

for p in (WK, PG):
    p.write_text(files[p], encoding='utf-8', newline=chr(10))
print('\nwrote %s and %s' % (WK.name, PG.name))
