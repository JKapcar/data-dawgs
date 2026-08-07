"""
Stamp connect.html out of an existing page.

There is no page build system in this repo (AGENTS.md): every page is flattened,
self-contained HTML with site.css and nav.js inlined. So a NEW page is made by taking an
existing one's head + nav script + footer and swapping the body — the same technique the
lab pages and the DFS workbench used.

⚠️ Slice by CONTENT MARKERS, never line numbers. The inlined nav grows; a fixed offset
silently shifts and truncates the nav script, and the page still *looks* fine.

Run:  cd work && python3 build_connect.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "strategy.html"
OUT = REPO / "connect.html"

src = TEMPLATE.read_text()

def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {TEMPLATE.name}, expected 1"
    return hay.index(needle)

# ---- head: everything through </head>, with the page title swapped ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]
head = re.sub(r"<title>.*?</title>", "<title>Connect your Claude — Data Dawgs</title>", head, count=1, flags=re.S)

# ---- the shared nav script, byte for byte ----
i_nav_open = once(src, '<script data-page=', "nav script open")
i_nav_close = src.index("\n</script>", i_nav_open) + len("\n</script>")
shell = src[i_head:i_nav_close]
shell = shell.replace('data-page="strategy"', 'data-page="connect"')
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "DDSync" in shell and "DDBot" in shell, "nav script looks truncated"

# ---- footer, reused verbatim ----
i_foot = once(src, "  <footer>", "footer open")
foot = src[i_foot:src.index("</footer>", i_foot) + len("</footer>")]

BODY = r"""
  <div class="lab-hd"><span class="lab-chip">Members</span></div>
  <h1 style="margin:10px 0 0;font-size:27px;font-weight:800;letter-spacing:-.01em">Connect your Claude</h1>
  <p class="lab-sub">Give your own Claude a live line into the league — the Bozo board, the draft, survivor
  odds, the player pool. One URL, pasted once. Nothing to install.</p>

  <div class="card" id="cSignedOut">
    <h3>Sign in</h3>
    <p class="sub">Same login as the Bozo board. Your name or your email, either works.</p>
    <div class="grid2">
      <label class="fld"><span>Name or email</span><input class="fi" id="cWho" autocomplete="username" placeholder="Jeff, or jeff@example.com"></label>
      <label class="fld"><span>Password</span><input class="fi" id="cPw" type="password" autocomplete="current-password"></label>
    </div>
    <div class="btnrow"><button class="btn" id="cGo">Sign in</button></div>
    <p class="note" id="cMsg"></p>
    <p class="note">No password yet? Use the join link Kap sent you, then come back.</p>
  </div>

  <div class="card" id="cSignedIn" hidden>
    <h3>Your connector <span class="rt" id="cWho2"></span></h3>
    <p class="sub">Paste this into Claude &rarr; <b>Settings &rarr; Connectors &rarr; Add custom connector</b>.
    Works on the free plan (one connector), and on Pro, Max, Team and Enterprise.</p>

    <div id="cUrlBox" hidden>
      <label class="fld"><span>Your personal URL <span class="hint">— shown once, save it now</span></span>
        <input class="fi" id="cUrl" readonly style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px"></label>
      <div class="btnrow"><button class="btn sm" id="cCopy">Copy</button></div>
      <div class="banner" style="margin-top:14px"><b>Save this now.</b> Only a fingerprint of it is stored,
      so it can never be shown to you again. Lose it and you make a new one — which is the right trade for
      something that will eventually be able to act on your behalf.</div>
    </div>

    <div class="btnrow" style="margin-top:6px">
      <button class="btn" id="cMint">Create my URL</button>
      <button class="btn ghost sm" id="cRevoke">Turn it off</button>
    </div>
    <p class="note" id="cMintMsg"></p>

    <h3 style="margin-top:24px">Email</h3>
    <p class="sub">Lets you sign in with your address instead of your name.
    <b>Nothing is ever sent to it</b> and it is not verified — we do not run a mail server.</p>
    <div class="grid2">
      <label class="fld"><span>Email</span><input class="fi" id="cEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
      <div style="display:flex;align-items:flex-end"><button class="btn sm" id="cSaveEmail" style="margin-bottom:11px">Save</button></div>
    </div>
    <p class="note" id="cEmailMsg"></p>

    <div class="btnrow" style="margin-top:10px"><button class="btn ghost sm" id="cOut">Sign out</button></div>
  </div>

  <div class="card">
    <h3>What your Claude can do with it</h3>
    <p class="sub">Ask in plain English — it picks the right tool itself.</p>
    <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.9;color:var(--ink-2)">
      <li>&ldquo;What&rsquo;s on the Bozo ticket this week, and who hasn&rsquo;t submitted?&rdquo;</li>
      <li>&ldquo;How much budget do I have left, and what can I actually bid on one player?&rdquo;</li>
      <li>&ldquo;Who has the worst odds in the guillotine league this week?&rdquo;</li>
      <li>&ldquo;What&rsquo;s everyone picking in survivor?&rdquo;</li>
      <li>&ldquo;Why should I stack a quarterback with his own receiver?&rdquo;</li>
    </ul>
    <p class="note" style="margin-top:14px"><b>It can only read.</b> It cannot place your Bozo leg, make a
    draft pick, or change anything. Ask it what your pick <em>should</em> be, then put it in yourself.</p>
  </div>

  <div class="honesty">
    <h3>What this is, and what it isn't</h3>
    <p><b>The URL is the password.</b> There is no second factor and no separate login — anyone holding
    your link can read the league as you. Don&rsquo;t screenshot it, don&rsquo;t paste it in a public
    channel. If it gets out, come back here and make a new one; the old one dies immediately and nobody
    else is disturbed.</p>
    <p style="margin-top:10px">That last part is the whole reason this page exists. The league used to
    share one passphrase, which meant a leak affected all fourteen people and the server had no idea who
    was asking. A personal URL is <em>containable</em> and <em>attributable</em>. It is still a secret in
    a web address, and that is not the same thing as secure.</p>
    <p style="margin-top:10px">Everything reachable through it is league data or public play-by-play.
    <b>No DFS projections or ownership are served here, ever</b> &mdash; those are paid third-party data
    that live only in your own browser.</p>
  </div>
"""

PAGE_JS = r"""
<script>
/* connect.html — sign in, mint a personal MCP URL, set an email.
   ⚠️ The minted token is shown ONCE and never stored client-side beyond the input box.
   Only a hash reaches the server, exactly as invite tokens are handled, so there is no
   "show it again" — losing it means rotating. */
(function () {
  var API = "https://toto.jkapcar4.workers.dev";
  // ⚠️ EXACTLY the key bozo.html uses — "dd-bozo-sess", not "-session". Getting this
  // wrong silently splits the two pages: signing in here would not be seen there, and
  // an existing bozo.html session would not be seen here.
  var SESS = "dd-bozo-sess";
  var $ = function (id) { return document.getElementById(id); };
  var msg = function (el, text, kind) {
    var n = $(el); n.textContent = text || "";
    n.className = "note" + (kind ? " " + kind : "");
  };
  var sess = function () { try { return localStorage.getItem(SESS) || ""; } catch (e) { return ""; } };

  function post(path, body, useSession) {
    var h = { "Content-Type": "application/json" };
    if (useSession) h["X-Dawg-Session"] = sess();
    return fetch(API + path, { method: "POST", headers: h, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function showSignedIn(name, email) {
    $("cSignedOut").hidden = true;
    $("cSignedIn").hidden = false;
    $("cWho2").textContent = name || "";
    if (email) $("cEmail").value = email;
  }

  $("cGo").addEventListener("click", function () {
    var who = $("cWho").value.trim(), pw = $("cPw").value;
    if (!who || !pw) { msg("cMsg", "Name (or email) and password, please.", "warn"); return; }
    msg("cMsg", "Signing in…");
    // The Worker resolves an email to a name itself, so send it in the same field.
    post("/auth/login", { name: who, password: pw }).then(function (r) {
      if (!r.ok || !r.j.session) { msg("cMsg", r.j.error || "That didn't work.", "bad"); return; }
      try { localStorage.setItem(SESS, r.j.session); } catch (e) {}
      msg("cMsg", "");
      $("cPw").value = "";
      showSignedIn(r.j.name || who, r.j.email);   // the Worker returns `name`, not `player`
    }).catch(function (e) { msg("cMsg", "Couldn't reach the server: " + e.message, "bad"); });
  });
  $("cPw").addEventListener("keydown", function (e) { if (e.key === "Enter") $("cGo").click(); });

  $("cMint").addEventListener("click", function () {
    msg("cMintMsg", "Creating…");
    post("/auth/mcp-token", { action: "mint" }, true).then(function (r) {
      if (!r.ok) { msg("cMintMsg", r.j.error || "Couldn't create it.", "bad"); return; }
      $("cUrl").value = r.j.url;
      $("cUrlBox").hidden = false;
      $("cMint").textContent = "Replace it with a new one";
      msg("cMintMsg", "Any URL you made before this one has stopped working.", "warn");
    }).catch(function (e) { msg("cMintMsg", "Couldn't reach the server: " + e.message, "bad"); });
  });

  $("cRevoke").addEventListener("click", function () {
    if (!confirm("Turn off your connector? Your Claude will lose access until you make a new URL.")) return;
    post("/auth/mcp-token", { action: "revoke" }, true).then(function (r) {
      if (!r.ok) { msg("cMintMsg", r.j.error || "Couldn't turn it off.", "bad"); return; }
      $("cUrlBox").hidden = true; $("cUrl").value = "";
      $("cMint").textContent = "Create my URL";
      msg("cMintMsg", "Turned off. Nothing can use that URL now.", "good");
    });
  });

  $("cCopy").addEventListener("click", function () {
    var el = $("cUrl"); el.select(); el.setSelectionRange(0, 99999);
    var done = function () { $("cCopy").textContent = "Copied"; setTimeout(function () { $("cCopy").textContent = "Copy"; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  });

  $("cSaveEmail").addEventListener("click", function () {
    msg("cEmailMsg", "Saving…");
    post("/auth/email", { email: $("cEmail").value.trim() }, true).then(function (r) {
      if (!r.ok) { msg("cEmailMsg", r.j.error || "Couldn't save it.", "bad"); return; }
      msg("cEmailMsg", r.j.email ? "Saved. You can sign in with that address now — nothing is sent to it." : "Cleared.", "good");
    });
  });

  $("cOut").addEventListener("click", function () {
    try { localStorage.removeItem(SESS); } catch (e) {}
    $("cSignedIn").hidden = true; $("cSignedOut").hidden = false;
    $("cUrlBox").hidden = true; $("cUrl").value = "";
    msg("cMsg", "Signed out.");
  });

  // Already signed in from another page? Don't make them do it twice.
  if (sess()) {
    post("/auth/mcp-token", { action: "probe" }, true).then(function (r) {
      // "action must be mint or revoke" means the session was ACCEPTED — auth ran first.
      if (r.j && /action must be/.test(r.j.error || "")) showSignedIn("", "");
    }).catch(function () {});
  }
})();
</script>
"""

CSS = """
/* ---- connect.html ---- */
/* lifted verbatim from guillotine.html — strategy.html (the template) has no lab
   page vocabulary, so the chip and the honesty block rendered unstyled. Found by
   looking at a screenshot. */
.lab-hd{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:4px 0 0}
.lab-chip{font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;
  padding:4px 10px;border-radius:5px;background:var(--surface-1);
  border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent)}
.lab-hd h1{margin:0;font-size:27px;font-weight:800;letter-spacing:-.01em;line-height:1.2}
.lab-sub{font-size:16px;line-height:1.7;color:var(--ink-2);max-width:700px;margin:10px 0 0}
.honesty{border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:12px;
  background:var(--surface-1);padding:16px 20px;margin:0 0 12px}
.honesty h3{margin:0 0 7px;font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;
  color:var(--accent);font-weight:800}
.honesty p{margin:0;font-size:13.5px;line-height:1.68;color:var(--ink-2)}

.card{background:var(--surface-1);border:1px solid var(--border);border-radius:15px;padding:20px 22px;margin:16px 0 0}
.card>h3{margin:0 0 4px;font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-3);font-weight:800}
.card>h3 .rt{float:right;text-transform:none;letter-spacing:0;font-weight:650;color:var(--ink-1)}
.card .sub{margin:0 0 14px;font-size:13px;color:var(--ink-2);line-height:1.6}
.card .sub b{color:var(--ink-1)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 16px}
label.fld{display:block;margin:0 0 11px}
label.fld>span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);font-weight:800;margin-bottom:4px}
label.fld>span .hint{text-transform:none;letter-spacing:0;font-weight:600;opacity:.85}
input.fi{width:100%;box-sizing:border-box;background:var(--page);border:1px solid var(--grid);border-radius:9px;
  color:var(--ink-1);font:inherit;font-size:14px;padding:9px 11px}
input.fi:focus{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:1px}
button.btn{appearance:none;background:var(--accent);color:#fff;border:0;border-radius:10px;font:inherit;
  font-size:14.5px;font-weight:800;padding:11px 20px;cursor:pointer}
button.btn:hover{filter:brightness(1.07)}
button.btn.ghost{background:none;color:var(--ink-2);border:1px solid var(--border);font-weight:700;font-size:13px;padding:9px 14px}
button.btn.ghost:hover{border-color:var(--accent);color:var(--accent);filter:none}
button.btn.sm{font-size:12.5px;padding:7px 12px}
.btnrow{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-top:4px}
.note{font-size:12.5px;line-height:1.6;color:var(--ink-3);margin:9px 0 0}
.note.warn{color:var(--warn)}.note.bad{color:var(--bad)}.note.good{color:var(--good)}
.banner{border:1px solid color-mix(in srgb,var(--warn) 50%,transparent);background:color-mix(in srgb,var(--warn) 11%,transparent);
  border-radius:11px;padding:11px 14px;font-size:13px;line-height:1.6;color:var(--ink-2)}
.banner b{color:var(--warn);font-weight:800}
/* ⚠️ `hidden` is specificity 0,0,1 and loses to any rule setting display. Enumerated,
   because this page hides whole cards and a leak here shows a signed-out user the
   signed-in controls. */
.card[hidden],.banner[hidden],div[hidden],label.fld[hidden]{display:none !important}
"""

head = head.replace("\n</style>", CSS + "\n</style>", 1)

out = head + shell + "\n" + BODY + "\n" + foot + "\n</div>\n" + PAGE_JS + "\n</body>\n</html>\n"
OUT.write_text(out)

for must in ['id="nav"', "cMint", "cUrl", "connect", "DDSync"]:
    assert must in out, f"missing {must}"
# ⚠️ Not a blanket "strategy" search — the nav legitimately links to 2026 Strategy on
# every page. Check the things that actually must have changed.
assert "<title>Connect your Claude" in out, "title not swapped"
assert 'data-page="connect"' in out and 'data-page="strategy"' not in out, "page key not swapped"
print(f"connect.html  {len(out):,} bytes")
