#!/usr/bin/env python3
"""
Commit B2, page half — bozo.html.

Run from repo root:  python3 work/patch-b2-bozo-page.py

The board works in DISPLAY NAMES throughout -- a dozen call sites do picks[kEnc(name)].
Rather than touch all of them, the two functions that translate between a name and a data
key are changed, and everything above them keeps working unaltered:

  stateMembers()  reads the member row's label instead of decoding the key
  kEnc(name)      resolves a name to its member key (the uid) instead of encoding it

⚠️ Both keep their legacy behaviour as a fallback. The two DEMO leagues and any imported
season are still name-keyed and are never migrated -- they are graded history. A board
that only understood uids would render them as an empty ticket.
"""
import sys, io

TARGET = "bozo.html"
src = io.open(TARGET, encoding="utf8").read()
orig = src

def sub(old, new, label):
    global src
    if old not in src:
        if new in src:
            print("  = %s already applied" % label); return
        sys.exit("FAIL: anchor not found for %s" % label)
    if src.count(old) != 1:
        sys.exit("FAIL: anchor matched %d times for %s" % (src.count(old), label))
    src = src.replace(old, new, 1)
    print("  + %s" % label)

sub('''const stateMembers = () => Object.keys((S&&S.members)||{}).map(k=>{try{return decodeURIComponent(k);}catch(e){return k;}});''',
'''const kDec = k => {try{return decodeURIComponent(k);}catch(e){return k;}};
// A member row is keyed by immutable uid and carries the display name as a label. A row
// that is still `true` (the demo leagues, and any imported season) falls back to the key,
// which is where the name lives in that older shape.
const memberLabel = k => {const v=((S&&S.members)||{})[k]; return (v&&typeof v==='object'&&v.name)?String(v.name):kDec(k);};
const stateMembers = () => Object.keys((S&&S.members)||{}).map(memberLabel);''',
    "stateMembers — names come from the label")

sub('''const kEnc = p => (S.picks && S.picks[p]) ? p : encodeURIComponent(p);''',
'''// ⚠️ THE ONE TRANSLATION POINT. Every board surface works in display names; picks and
// results are keyed by the member's uid. Resolve through the members map first, and only
// then fall back to the encoded name for the legacy/demo leagues that really are
// name-keyed. Reversing that order would make a uid league silently paint an empty board.
const kEnc = p => {
  if (S.picks && S.picks[p]) return p;                      // already a data key
  const ms = (S && S.members) || {};
  for (const k in ms) if (memberLabel(k) === p) return k;
  return encodeURIComponent(p);
};''',
    "kEnc — a name resolves to its member key")

if src == orig:
    print("no change (already applied)")
else:
    io.open(TARGET, "w", encoding="utf8").write(src)
    print("wrote %s" % TARGET)
