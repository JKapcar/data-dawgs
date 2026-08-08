"""
Stamp signon.html out of connect.html.

Same technique as build_connect.py (which stamped connect out of strategy): there is no
page build system, so a NEW page is an existing page's head + shell + footer with the
body and page script swapped. connect.html is the template here because its head
already carries the card/form CSS this page needs.

⚠️ Slice by CONTENT MARKERS, never line numbers (build_connect.py's rule).

This page exists because of the 8/7 house rule: EVERY identity workflow lives here —
sign in, open signup, join-link claim, recovery guidance, password change, email
save — and nowhere else. bozo.html and connect.html hand their auth cards to this
page; the banner chip on every page routes here (work/patch-signon-routing.py).

Run:  cd work && python3 build_signon.py
"""
import pathlib, re

REPO = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "connect.html"
OUT = REPO / "signon.html"

src = TEMPLATE.read_text(encoding="utf-8")

def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in {TEMPLATE.name}, expected 1"
    return hay.index(needle)

# ---- head: everything through </head>, title swapped ----
i_head = once(src, "</head>", "head close") + len("</head>")
head = src[:i_head]
head = re.sub(r"<title>.*?</title>", "<title>Sign in — Data Dawgs</title>", head, count=1, flags=re.S)

# ---- shell: </head> through the last thing before the body content. Everything
# between (nav mount, nav script, later sitewide inserts like DDMe) rides along. ----
i_body = once(src, '  <div class="lab-hd">', "body content start")
shell = src[i_head:i_body]
shell = shell.replace('data-page="connect"', 'data-page="signon"')
assert '<div id="nav"></div>' in shell, "lost the nav mount point"
assert "window.DDAuth" in shell, "nav shell lost DDAuth"

# ---- footer, reused verbatim ----
i_foot = once(src, "  <footer>", "footer open")
foot = src[i_foot:src.index("</footer>", i_foot) + len("</footer>")]

BODY = r"""  <div class="lab-hd"><span class="lab-chip">Members</span></div>
  <h1 style="margin:10px 0 0;font-size:27px;font-weight:800;letter-spacing:-.01em">Sign in</h1>
  <p class="lab-sub">Every account chore lives on this one page — sign in, create an account,
  claim a texted invite, fix a forgotten password. The boards, the pool and the season tables
  stay public either way; an account is for playing.</p>

  <!-- claim a texted join link (?join=<token>) -->
  <div class="card" id="sJoin" hidden>
    <h3>Claim your slot <span class="rt" id="jWho"></span></h3>
    <p class="sub">Kap sent you this link. <b>It works once.</b> Set a password and the slot is
    yours — after that the link is dead, so forwarding it does nothing.</p>
    <div class="grid2">
      <label class="fld"><span>Password <span class="hint">— 8+ characters</span></span>
        <input class="fi" id="jPw" type="password" autocomplete="new-password"></label>
      <label class="fld"><span>Confirm</span>
        <input class="fi" id="jPw2" type="password" autocomplete="new-password"></label>
    </div>
    <label class="fld"><span>Email <span class="hint">— optional. Lets you sign in with it later; nothing is ever sent to it.</span></span>
      <input class="fi" id="jEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <div class="btnrow"><button class="btn" id="jGo">Claim it</button></div>
    <p class="note" id="jMsg"></p>
  </div>

  <!-- sign in -->
  <div class="card" id="sIn">
    <h3>Sign in</h3>
    <p class="sub">One account for the whole site — the Bozo board, the draft, your AI connector.</p>
    <div class="grid2">
      <label class="fld"><span>Name or email</span>
        <input class="fi" id="sWho" list="sRoster" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Jeff, or jeff@example.com"></label>
      <label class="fld"><span>Password</span>
        <input class="fi" id="sPw" type="password" autocomplete="current-password"></label>
    </div>
    <datalist id="sRoster"></datalist>
    <div class="btnrow"><button class="btn" id="sGo">Sign in</button></div>
    <p class="note" id="sMsg"></p>
    <p class="note">Email sign-in works once an email is saved on the account. Older accounts
    never saved one — sign in with your name, add your email below, and the address works from
    then on.</p>
  </div>

  <!-- open signup -->
  <div class="card" id="sNew">
    <h3>Create an account</h3>
    <p class="sub">Open to anyone. Your <b>name</b> is what shows on rosters. Your <b>email</b>
    is just a second way to sign in — <b>nothing is ever sent to it</b> and it is not verified,
    because this site does not send mail, period. An account does not put you in a league:
    seats are invite-only, from the league manager.</p>
    <div class="grid2">
      <label class="fld"><span>Name <span class="hint">— shows on rosters</span></span>
        <input class="fi" id="nName" autocomplete="off" maxlength="40"></label>
      <label class="fld"><span>Email</span>
        <input class="fi" id="nEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
      <label class="fld"><span>Password <span class="hint">— 8+ characters</span></span>
        <input class="fi" id="nPw" type="password" autocomplete="new-password"></label>
      <label class="fld"><span>Confirm</span>
        <input class="fi" id="nPw2" type="password" autocomplete="new-password"></label>
    </div>
    <div class="btnrow"><button class="btn" id="nGo">Create account</button></div>
    <p class="note" id="nMsg"></p>
  </div>

  <!-- recovery, in plain words -->
  <div class="card" id="sHelp">
    <h3>Locked out?</h3>
    <p class="sub" style="margin-bottom:0">
    <b>Forgot your password?</b> Text Kap. He resets your account, and your original join link
    works again — open it and set a new one. There is no reset email, because nothing is ever
    emailed.<br><br>
    <b>Lost the join link too?</b> Also Kap. He mints a fresh one and the old one stops working.<br><br>
    <b>Change your password or email?</b> Sign in above — those controls appear right here.</p>
  </div>

  <!-- signed in -->
  <div class="card" id="sMe" hidden>
    <h3>Your account <span class="rt" id="meName"></span></h3>
    <p class="sub" id="meExp"></p>
    <p class="note warn" id="meJoinWarn" hidden>This device is already signed in. To claim a
    different slot with your join link, sign out first — the link survives until it is used.</p>
    <div class="btnrow">
      <a class="btn sm" id="meBack" href="index.html" hidden>Back to where you were</a>
      <a class="btn ghost sm" href="connect.html">Connect your AI</a>
      <a class="btn ghost sm" href="bozo.html">Bozo board</a>
      <button class="btn ghost sm" id="meOut">Sign out</button>
    </div>

    <h3 style="margin-top:26px">Change password</h3>
    <div class="grid2">
      <label class="fld"><span>Current password</span>
        <input class="fi" id="pOld" type="password" autocomplete="current-password"></label>
      <label class="fld"><span>New password <span class="hint">— 8+ characters</span></span>
        <input class="fi" id="pNew" type="password" autocomplete="new-password"></label>
    </div>
    <div class="btnrow"><button class="btn sm" id="pGo">Change it</button></div>
    <p class="note" id="pMsg"></p>

    <h3 style="margin-top:26px">Email</h3>
    <p class="sub">A second way to sign in, nothing more. <b>Nothing is ever sent to it</b> and
    it is not verified. Clear it and you are back to signing in by name.</p>
    <div class="grid2">
      <label class="fld"><span>Email</span>
        <input class="fi" id="eEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
      <div style="display:flex;align-items:flex-end"><button class="btn sm" id="eGo" style="margin-bottom:11px">Save</button></div>
    </div>
    <p class="note" id="eMsg"></p>
  </div>"""

PAGE_JS = r"""<script>
/* signon.html — the one page that owns every identity workflow (house rule, 8/7).
   Sign in, open signup, join-link claim (+email in the same breath), recovery text,
   password change, email save, sign out, and ?next= return-to.

   ⚠️ Session plumbing goes through DDAuth (inlined in the nav shell above): same
   localStorage key, same X-Bozo-Session header, and the banner chip repaints in the
   same tick. Writing localStorage directly here would work today and desync the
   chip tomorrow. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var msg = function (el, text, kind) {
    var n = $(el); n.textContent = text || "";
    n.className = "note" + (kind ? " " + kind : "");
  };

  /* ---- ?next= and ?join=, both read once ---- */
  var qs = new URLSearchParams(location.search);
  /* ⚠️ next is a same-folder page name or nothing. Anything else (protocol, slash,
     signon itself) is dropped — this must never become an open redirect. */
  var next = qs.get("next") || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(next) || next === "signon.html") next = "";
  var joinTok = qs.get("join") || "";
  if (joinTok) {
    /* Burn the token out of the URL bar and history NOW, exactly as bozo.html did —
       a screenshot or a shared address must not carry a live invite. */
    var clean = location.pathname + (next ? "?next=" + encodeURIComponent(next) : "");
    history.replaceState(null, "", clean);
  }

  var leave = function () {
    if (next) { location.replace(next); return true; }
    return false;
  };

  /* ---- render: exactly one of signed-out / signed-in ---- */
  function render() {
    var m = window.DDAuth ? window.DDAuth.me() : null;
    $("sMe").hidden = !m;
    $("sIn").hidden = !!m;
    $("sNew").hidden = !!m || !!joinTok;   // invited people claim; they don't need signup
    $("sHelp").hidden = !!m;
    $("sJoin").hidden = !!m || !joinTok;
    $("meJoinWarn").hidden = !(m && joinTok);
    if (m) {
      $("meName").textContent = m.name;
      var days = Math.max(0, Math.round((m.expires - Date.now()) / 86400000));
      $("meExp").textContent = "Signed in on this device for about " + days + " more day" + (days === 1 ? "" : "s") + ".";
      var back = $("meBack");
      back.hidden = !next;
      if (next) back.href = next;
    }
  }

  /* ---- roster autocomplete (claimed names only; free text always allowed) ---- */
  (function () {
    if (!window.DDAuth) return;
    fetch("https://toto.jkapcar4.workers.dev/auth/roster?cb=" + Date.now().toString(36))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var dl = $("sRoster"); dl.replaceChildren();
        (j.players || []).filter(function (p) { return p.claimed; }).forEach(function (p) {
          var o = document.createElement("option"); o.value = p.name; dl.appendChild(o);
        });
      }).catch(function () { /* autocomplete only */ });
  })();

  /* ---- sign in ---- */
  function doSignIn() {
    var who = $("sWho").value.trim(), pw = $("sPw").value;
    if (!who || !pw) { msg("sMsg", "Name (or email) and password, both.", "warn"); return; }
    msg("sMsg", "Signing in…");
    /* one field, two identifiers: the Worker resolves an email to a name itself */
    window.DDAuth.post("/auth/login", { name: who, password: pw }).then(function (j) {
      if (!j.session) throw new Error("No session came back.");
      $("sPw").value = "";
      window.DDAuth.set(j.session);
      if (j.email) $("eEmail").value = j.email;
      if (!leave()) { msg("sMsg", ""); render(); }
    }).catch(function (e) { msg("sMsg", e.message || String(e), "bad"); });
  }
  $("sGo").addEventListener("click", doSignIn);
  $("sPw").addEventListener("keydown", function (e) { if (e.key === "Enter") doSignIn(); });

  /* ---- create an account (open signup) ---- */
  $("nGo").addEventListener("click", function () {
    var name = $("nName").value.trim(), email = $("nEmail").value.trim();
    var pw = $("nPw").value, pw2 = $("nPw2").value;
    if (!name) { msg("nMsg", "Pick a name — it's what shows on rosters.", "warn"); return; }
    if (!email) { msg("nMsg", "An email is required — it's your other sign-in.", "warn"); return; }
    if (pw.length < 8) { msg("nMsg", "Password must be at least 8 characters.", "warn"); return; }
    if (pw !== pw2) { msg("nMsg", "Those passwords don't match.", "warn"); return; }
    msg("nMsg", "Creating…");
    window.DDAuth.post("/auth/signup", { name: name, email: email, password: pw }).then(function (j) {
      if (!j.session) throw new Error("No session came back.");
      $("nPw").value = ""; $("nPw2").value = "";
      window.DDAuth.set(j.session);
      $("eEmail").value = j.email || email;
      if (!leave()) { msg("nMsg", ""); render(); }
    }).catch(function (e) { msg("nMsg", e.message || String(e), "bad"); });
  });

  /* ---- claim a join link, email collected in the same breath ---- */
  $("jGo").addEventListener("click", function () {
    var pw = $("jPw").value, pw2 = $("jPw2").value, email = $("jEmail").value.trim();
    if (pw.length < 8) { msg("jMsg", "Password must be at least 8 characters.", "warn"); return; }
    if (pw !== pw2) { msg("jMsg", "Those passwords don't match.", "warn"); return; }
    msg("jMsg", "Claiming…");
    window.DDAuth.post("/auth/claim", { token: joinTok, password: pw }).then(function (j) {
      window.DDAuth.set(j.session);       // signed in from this moment
      $("jWho").textContent = j.name || "";
      var done = function (extra) {
        joinTok = "";
        if (!leave()) { msg("jMsg", "Claimed." + (extra || ""), "good"); render(); }
      };
      if (!email) return done("");
      /* the email rides the brand-new session; a failure here must not undo the claim */
      window.DDAuth.post("/auth/email", { email: email })
        .then(function () { done(" Email saved — you can sign in with it now."); })
        .catch(function (e2) { done(" But the email didn't save: " + e2.message + " — add it below."); });
    }).catch(function (e) { msg("jMsg", e.message || String(e), "bad"); });
  });

  /* ---- change password ---- */
  $("pGo").addEventListener("click", function () {
    var oldPw = $("pOld").value, newPw = $("pNew").value;
    if (newPw.length < 8) { msg("pMsg", "New password must be at least 8 characters.", "warn"); return; }
    msg("pMsg", "Changing…");
    window.DDAuth.post("/auth/passwd", { oldPassword: oldPw, newPassword: newPw }).then(function (j) {
      window.DDAuth.set(j.session);       // the old session died server-side with the old password
      $("pOld").value = ""; $("pNew").value = "";
      msg("pMsg", "Changed.", "good");
    }).catch(function (e) { msg("pMsg", e.message || String(e), "bad"); });
  });

  /* ---- save / change / clear email ---- */
  $("eGo").addEventListener("click", function () {
    var email = $("eEmail").value.trim();
    msg("eMsg", "Saving…");
    window.DDAuth.post("/auth/email", { email: email }).then(function (j) {
      msg("eMsg", j.email ? "Saved. You can sign in with that address now — nothing is sent to it."
                          : "Cleared. You sign in by name now.", "good");
    }).catch(function (e) { msg("eMsg", e.message || String(e), "bad"); });
  });

  /* ---- sign out ---- */
  $("meOut").addEventListener("click", function () {
    window.DDAuth.clear();                // chip flips in the same tick
    msg("sMsg", "Signed out.", "good");
    render();
  });

  /* the banner (or another tab) signing in/out repaints this page */
  window.onDDAuth = function () { render(); };
  render();
})();
</script>"""

out = head + shell + BODY + "\n\n" + foot + "\n</div>\n\n" + PAGE_JS + "\n</body>\n</html>\n"
OUT.write_text(out, encoding="utf-8")

for must in ['id="nav"', "sJoin", "sNew", "nGo", "jGo", "pGo", "eGo", "meOut", "window.DDAuth",
             "/auth/signup", "/auth/claim", "/auth/passwd", "/auth/email", "nothing is ever sent"]:
    assert must in out, f"missing {must}"
assert "<title>Sign in — Data Dawgs</title>" in out, "title not swapped"
assert 'data-page="signon"' in out and 'data-page="connect"' not in out, "page key not swapped"
assert out.count("cMint") == 0 and out.count("cSignedOut") == 0, "connect body leaked through"
print(f"signon.html  {len(out):,} bytes")
