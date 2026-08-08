#!/usr/bin/env python3
"""bozo.html and connect.html hand their identity cards to signon.html (8/7 rule:
one page owns every identity workflow).

bozo.html: old texted links (bozo.html?join=<tok>) MUST keep working — the page now
forwards the token to signon.html before anything renders. The sign-in and claim
cards go; the signed-out card becomes a pointer. The signed-in strip keeps My sheet
and Sign out (board furniture), loses the change-password box (moved to signon).

connect.html: keeps ONLY connector-URL minting. Sign-in form, email card and the
sign-out button go; signed-out state points at signon.html.

Anchored, assert-guarded, re-run safe (sentinel per file). Run from repo root or work/:
  python3 work/patch-signon-handoff.py
"""
import pathlib, sys

REPO = pathlib.Path(__file__).resolve().parent.parent

def cut(s, start, end, what, keep_end=True, repl=""):
    """Replace [start, end) with repl. Both markers must appear exactly once."""
    for m, nm in ((start, what + " start"), (end, what + " end")):
        n = s.count(m)
        if n != 1: sys.exit(f"FAILED: {nm} appears {n} times, expected 1")
    i, j = s.index(start), s.index(end)
    if not i < j: sys.exit(f"FAILED: {what} markers out of order")
    return s[:i] + repl + (s[j:] if keep_end else s[j + len(end):])

# ------------------------------- bozo.html --------------------------------
f = REPO / "bozo.html"
s = f.read_text(encoding="utf-8")
if "signon.html?next=bozo.html" in s:
    print("  skip bozo.html — already patched")
else:
    n0 = len(s)

    # 1. forward ?join= to signon BEFORE anything renders; old texted links survive
    old = "const SESS_K = 'dd-bozo-sess';"
    s = s.replace(old, old + """
/* Old texted links land here: bozo.html?join=<tok>. The claim card moved to
   signon.html (one page owns every identity workflow, 8/7) — forward the token
   whole; signon burns it out of its own URL the moment it loads. */
(function(){
  const tok = new URLSearchParams(location.search).get('join');
  if (tok) location.replace('signon.html?join=' + encodeURIComponent(tok) + '&next=bozo.html');
})();""")

    # 2. renderAuth: drop the joinTok read (the forward above owns it)
    s = cut(s, "  const joinTok = new URLSearchParams(location.search).get('join');\n",
            "  if(ME){\n    card.style.display='none'", "joinTok read", keep_end=True)

    # 3. renderAuth: delete the whole claim branch
    s = cut(s, "  if(joinTok){", "  document.getElementById('authH').textContent='Sign in';",
            "claim branch", keep_end=True)

    # 4. renderAuth: the sign-in form becomes a pointer to the sign-on page
    s = cut(s, "  document.getElementById('authH').textContent='Sign in';",
            "async function loadRoster(){", "sign-in branch", keep_end=True, repl="""  document.getElementById('authH').textContent='Sign in';
  body.innerHTML = `<div class="auth">
    <p class="bz-sub" style="margin-top:0">Signing in has its own page now — one place for every
    account chore: sign in, create an account, claim a texted invite, recover a password.</p>
    <div class="row"><a class="btn" href="signon.html?next=bozo.html">Sign in / create account</a></div>
    <p class="note">No account needed to watch: the board, the ticket and the season table are public.</p>
  </div>`;
  render();
}

""")

    # 5. signed-in strip: change-password moved to signon
    s = cut(s, '    <button class="btn ghost sm" id="chgPw">Change password</button>\n',
            '    <button class="btn ghost sm" id="signOut">Sign out</button>', "chgPw button")
    s = cut(s, '  <div id="pwBox" style="display:none;margin-top:12px">',
            '    <div class="err" id="pwErr"></div>\n  </div>\n', "pwBox", keep_end=False)

    # 6. wiring for the removed controls
    s = cut(s, "document.getElementById('chgPw').onclick",
            "document.getElementById('fSport').innerHTML", "pw wiring", keep_end=True)

    for gone in ["chgPw", "pwBox", "pwSave", "pwCancel", "pwOld", "pwNew", "'/auth/claim'"]:
        if gone in s: sys.exit(f"FAILED bozo.html: {gone!r} still present")
    for kept in ["signOut", "mySheet", "renderAuth", "'/auth/login'"]:
        # login stays gone too — check below flips expectation for it
        pass
    if "'/auth/login'" in s: sys.exit("FAILED bozo.html: login form still present")
    for kept in ["signOut", "mySheet", "renderAuth", "meCard", "adminBadge"]:
        if kept not in s: sys.exit(f"FAILED bozo.html: lost {kept!r}")
    f.write_text(s, encoding="utf-8")
    print(f"  ok   bozo.html     {(len(s)-n0)/1024:+.1f} KB")

# ------------------------------ connect.html ------------------------------
f = REPO / "connect.html"
s = f.read_text(encoding="utf-8")
if "signon.html?next=connect.html" in s:
    print("  skip connect.html — already patched")
else:
    n0 = len(s)

    # 1. signed-out card: form out, pointer in (cMsg survives — onDDAuth writes to it)
    s = cut(s, '  <div class="card" id="cSignedOut">', '  <div class="card" id="cSignedIn" hidden>',
            "signed-out card", keep_end=True, repl="""  <div class="card" id="cSignedOut">
    <h3>Sign in first</h3>
    <p class="sub">Your connector URL is personal, so this page needs to know who you are.
    Signing in lives on its own page — one place for every account chore.</p>
    <div class="btnrow"><a class="btn" href="signon.html?next=connect.html">Sign in / create account</a></div>
    <p class="note" id="cMsg"></p>
    <p class="note">No account? The join link Kap texted you works there too — or create one.</p>
  </div>

""")

    # 2. email card: moved to signon
    s = cut(s, '    <h3 style="margin-top:24px">Email</h3>',
            '    <p class="note" id="cEmailMsg"></p>\n', "email card", keep_end=False)

    # 3. sign-out row: the banner chip (via signon) owns sign-out now
    s = cut(s, '    <div class="btnrow" style="margin-top:10px">'
               '<button class="btn ghost sm" id="cOut">Sign out</button></div>\n',
            '  </div>\n\n  <div class="card">', "sign-out row")

    # 4. page JS: sign-in, email-save and sign-out handlers go; mint/revoke/copy stay
    line = '    if (email) $("cEmail").value = email;\n'
    if s.count(line) != 1: sys.exit("FAILED: email prefill line count " + str(s.count(line)))
    s = s.replace(line, "")
    s = cut(s, '  $("cGo").addEventListener("click", function () {',
            '  $("cMint").addEventListener("click", function () {', "cGo handler", keep_end=True)
    s = cut(s, '  $("cSaveEmail").addEventListener("click", function () {',
            "  function showSignedOut() {", "cSaveEmail handler", keep_end=True)
    s = cut(s, '  $("cOut").addEventListener("click", function () {',
            "  /* Already signed in from another page?", "cOut handler", keep_end=True)

    for gone in ["cGo", "cPw", "cWho\"", "cSaveEmail", "cEmailMsg", "cOut\"", '"/auth/email"']:
        if gone in s: sys.exit(f"FAILED connect.html: {gone!r} still present")
    # exactly ONE /auth/login call may remain: the dormant DDAuth modal in the nav
    # shell (kept on purpose — its session plumbing is load-bearing). The page's own
    # login form must be gone.
    n_login = s.count('"/auth/login"')
    if n_login != 1:
        sys.exit(f"FAILED connect.html: /auth/login count {n_login}, expected 1 (modal only)")
    for kept in ["cMint", "cRevoke", "cCopy", "cUrlBox", "cSignedOut", "cSignedIn", "cMsg", "showSignedIn", "showSignedOut"]:
        if kept not in s: sys.exit(f"FAILED connect.html: lost {kept!r}")
    f.write_text(s, encoding="utf-8")
    print(f"  ok   connect.html  {(len(s)-n0)/1024:+.1f} KB")
