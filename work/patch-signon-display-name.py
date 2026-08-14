#!/usr/bin/env python3
"""Give the Account sheet a display-name control, and stop the gate claiming a phantom email.

WHY A RENAME CONTROL. Email is the uniqueness key — one account per address, enforced by
accountsForEmail plus the ETag reservation on /emailIndex. Display names are just labels
and are deliberately NOT unique: test-identity already asserts a duplicate name is allowed
at signup. What was missing was any way to CHANGE one. `leagueTeam` only relabels a member
inside a single league, and its own comment says it is deliberately not a rename.
POST /auth/name is the real thing. This wires the UI half.

WHY THE GATE COPY. render() pointed the confirmation callout at "your stored address" when
there was no stored address, and told the member to open a confirmation nobody had sent.
For an account with no email the honest ask is "add an email", not "confirm one".

NOT IN HERE: a legacy name sign-in. Legacy accounts are being deleted, not rescued.

Anchors must appear EXACTLY once. Sentinel makes re-runs a no-op.
Run from repo root:  python3 work/patch-signon-display-name.py
"""
import sys

PAGE = "signon.html"
SENTINEL = "nameGo"

# ------------------------------------------------- 1. the control, in the Account sheet
A1 = ('<details class="drawer"><summary>Change your password</summary>')
N1 = ('<details class="drawer"><summary>Display name</summary><div class="dbody">'
      '<p class="sub">This is only a label. It is what shows on rosters, boards and the '
      'leaderboard, and it does not have to be unique — your email is what identifies the '
      'account. Change it as often as you like.</p>'
      '<label class="fld"><span>Display name</span>'
      '<input class="fi" id="nameNew" maxlength="60" autocomplete="nickname"></label>'
      '<div class="btnrow"><button class="btn sm" id="nameGo"></button></div>'
      '<p class="note" id="nameMsg"></p>'
      '<p class="note">A name is locked while you have a leg standing on a Bozo board. '
      'Picks are stored under the name that made them, and renaming mid-week would orphan '
      'one.</p></div></details>'
      '<details class="drawer"><summary>Change your password</summary>')

# ---------------------------------------------------------------- 2. the handler + label
A2 = '  $("eEmail").addEventListener("input",refreshEmailAction);'
N2 = ('''  function refreshNameAction(){var entered=$("nameNew").value.trim(),stored=String((profile()||{}).name||"");
    $("nameGo").disabled=!entered||entered===stored;
    $("nameGo").textContent=!entered?"Enter a display name":entered===stored?"That is already your name":"Change my name to "+entered;}
  $("nameNew").addEventListener("input",refreshNameAction);
  $("nameGo").addEventListener("click",async function(){
    var b=this,name=$("nameNew").value.trim();
    b.disabled=true;b.setAttribute("aria-busy","true");msg("nameMsg","Changing\\u2026");
    try{
      var j=await api("/auth/name",{name:name});
      var p=profile()||{};p.name=j.name||name;saveProfile(p);
      msg("nameMsg",j.unchanged?"That was already your name.":"You are now "+(j.name||name)+".","good");
      render();
    }catch(e){msg("nameMsg",e.message,"bad");}
    finally{b.removeAttribute("aria-busy");refreshNameAction();}
  });
''' + A2)

# ------------------------------------------------------ 3. render paints both controls
A3 = ('$("emailGateAddress").textContent=p.email||"your stored address";'
      '$("emailGate").hidden=p.emailVerified===true;')
N3 = ('$("emailGateAddress").textContent=p.email||"";'
      '$("emailGateHead").textContent=p.email?"Confirm your email to connect your AI":"Add an email to your account";'
      '$("emailGateBody").hidden=!p.email;$("emailGateNone").hidden=!!p.email;'
      '$("emailGateGo").textContent=p.email?"Confirm email":"Add email";'
      '$("emailGate").hidden=p.emailVerified===true;'
      '$("nameNew").value=p.name||m.name||"";refreshNameAction();')

# ------------------------------------------------------------ 3b. the gate's own markup
A4 = ('<div class="callout warn" id="emailGate"><b>Confirm your email to connect your AI</b>'
      '<p>Open the confirmation sent to <strong class="mono" id="emailGateAddress"></strong>. '
      'The link works once and expires in an hour.</p>')
N4 = ('<div class="callout warn" id="emailGate"><b id="emailGateHead">Confirm your email to connect your AI</b>'
      '<p id="emailGateBody">Open the confirmation sent to <strong class="mono" id="emailGateAddress"></strong>. '
      'The link works once and expires in an hour.</p>'
      '<p id="emailGateNone" hidden>This account has no email stored. Without one there is no '
      'password reset and no personal connector.</p>')

EDITS = [("display-name control", A1, N1), ("rename handler", A2, N2),
         ("render wiring", A3, N3), ("gate markup", A4, N4)]

s = open(PAGE, encoding="utf-8").read()
if SENTINEL in s:
    print("  skip %s - already patched" % PAGE)
    sys.exit(0)

for label, anchor, new in EDITS:
    n = s.count(anchor)
    if n != 1:
        sys.exit("FAILED %s: anchor for %r appears %d times, expected 1" % (PAGE, label, n))
    s = s.replace(anchor, new)
    print("  ok   %s" % label)

for need in ("nameNew", "nameGo", "nameMsg", "emailGateHead", "emailGateBody", "emailGateNone"):
    if s.count('id="%s"' % need) != 1:
        sys.exit("FAILED %s: id %r is not present exactly once" % (PAGE, need))

open(PAGE, "w", encoding="utf-8").write(s)
print("\npatched %s - remember the sw.js VERSION bump in the same commit" % PAGE)
