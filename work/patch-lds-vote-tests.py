"""
Retarget the receipt assertion, and cover the grading that now exists.

The old assertion pinned copy that was deliberately changed ("DEVICE RECEIPT", "local
only"). It was guarding something real -- that the page never overstates where a vote
lives -- so it is retargeted, not deleted. The device-local caveat still has to be on the
page; what changed is that the vote is now graded, which needs its own coverage.

Fixture: roster 6 is the lowest scorer and dies after week 2, so the derived chop order
starts with roster 6 and must NOT name it twice.

    cd work && py patch-lds-vote-tests.py
"""
import pathlib

NL = chr(10)
REPO = pathlib.Path(__file__).resolve().parent.parent
T = REPO / "work" / "test-guillotine.mjs"
s = T.read_text(encoding="utf-8")

old = ('ok("prediction receipt is explicitly local-device V1",' + NL +
       '  html.includes("DEVICE RECEIPT") && html.includes("local only") && html.includes("not server-persisted"));')
new = ('ok("the vote is still explicitly device-local",' + NL +
       '  html.includes("this device only") && html.includes("not server-persisted")' + NL +
       '  && html.includes("clearing site data clears the record"));' + NL +
       '/* ⚠ The panel may only claim grading because grading exists. If the derivation is' + NL +
       '   ever removed, this pair must fail together rather than leaving the claim standing. */' + NL +
       'ok("it says it is graded, and says what graded means here",' + NL +
       '  html.includes("Graded against the result") && html.includes("graded on this device"));' + NL +
       'ok("the vote question is the heading, not jargon",' + NL +
       '  html.includes("who gets chopped this week") && !html.includes("Weekly chopped-team prediction"));')
assert s.count(old) == 1, "receipt assertion"
s = s.replace(old, new, 1)

anchor = 'ok("Sunday model cannot be presented as live scoring",'
assert s.count(anchor) == 1, "anchor"
block = r'''/* the derived result a vote is graded against */
const CH = (G || {}).chopHistory || [];
ok("the actual chop is derived per week from observed scores", CH.length >= 1, String(CH.length));
ok("the lowest scorer is the one named", CH[0] && String(CH[0].rid) === "6",
  CH[0] && String(CH[0].rid));
// ⚠️ Sleeper keeps reporting an emptied roster for a week or two; without a gone-set the
// same team gets named chopped twice and every later week is wrong.
ok("nobody is chopped twice", new Set(CH.map(c => c.rid)).size === CH.length,
  CH.map(c => c.week + ":" + c.rid).join(" "));
ok("weeks come back in order", CH.every((c, i) => i === 0 || c.week > CH[i - 1].week));
ok("votes are stored per week, not one row that each week overwrites",
  html.includes("byWeek") && html.includes('predKey()'));

'''
s = s.replace(anchor, block + anchor, 1)
T.write_text(s, encoding="utf-8", newline=NL)
print("patch-lds-vote-tests: ok")
