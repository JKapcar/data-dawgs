#!/usr/bin/env python3
"""
Commit B5 — league-create form housekeeping.

Idempotent, anchor-based. Run from repo root:  python3 work/patch-b5-create-form.py

Page only. No worker change, no assemble.

TWO REAL DEFECTS, BOTH FOUND BY CREATING A LEAGUE FOR REAL
----------------------------------------------------------
1. `#nlBuyback` shipped `value="25"`. Selecting Bozo Royale revealed a Re-deploy cost
   field PRE-FILLED with 25, so every Royale league created by anyone who did not
   notice would charge a $25 mulligan. That contradicts the rule the settings panel
   states two hundred lines further down -- "Every player gets exactly one re-deploy and
   it fires automatically ... 0 means the re-deploy is free." A default that argues with
   the documented rule is worse than no default.

2. `#nlId` carried no `name` and no `autocomplete`, so Chrome heuristically filled the
   signed-in user's EMAIL ADDRESS into the League ID box. Submitting that returns
   "League id must be 2-24 chars: lowercase letters, numbers and dashes", which points
   nowhere near the actual cause. `#nlPassword` was already safe (`autocomplete=
   "new-password"`); these two were not.

⚠️ THE FIELD IS NOT REMOVED, ON PURPOSE. `demo-royale` is GRADED with buyback 25, and
royaleResolve stamps `rec.cost = settingsOf(state).buyback` onto each chop record. Site
rule: a graded result is never mutated, so the read path has to survive for that league
to keep explaining its own history. Deleting the write path alone would leave a permanent
half-removal. The correct fix is a default of 0, not an amputation.
"""
import sys, io

TARGET = "bozo.html"
src = io.open(TARGET, encoding="utf8").read()
orig = src

def sub(old, new, label):
    """Applied-check is a SENTINEL: the first replacement line absent from the anchor.
    `new in src` false-positives on shared replacement text; `old not in src`
    false-negatives when a replacement re-emits its own anchor. Both have bitten this
    repo. Keep this form."""
    global src
    sentinel = next((ln.strip() for ln in new.split("\n")
                     if ln.strip() and ln.strip() not in old), None)
    if sentinel is None:
        sys.exit("FAIL: no sentinel distinguishes the replacement for %s" % label)
    if sentinel in src:
        print("  = %s already applied" % label); return
    if old not in src:
        sys.exit("FAIL: anchor not found for %s" % label)
    if src.count(old) != 1:
        sys.exit("FAIL: anchor matched %d times for %s" % (src.count(old), label))
    src = src.replace(old, new, 1)
    print("  + %s" % label)

# ------------------------------------------------------------------ 1. the default
sub('''      <div class="f" id="nlBuybackWrap" style="display:none"><label>Re-deploy cost ($)</label>
        <input id="nlBuyback" type="number" min="0" step="5" value="25" placeholder="0 = free"></div>''',
'''      <!-- ⚠️ DEFAULT 0, NOT 25. The re-deploy itself is automatic and unconditional;
           this is only what it costs. A pre-filled 25 quietly turned the league rule
           ("you get one mulligan") into a charge nobody chose. -->
      <div class="f" id="nlBuybackWrap" style="display:none"><label>Re-deploy cost ($) — optional</label>
        <input id="nlBuyback" type="number" min="0" step="5" value="0" placeholder="0 = free"></div>''',
    "re-deploy cost defaults to free")

# ------------------------------------------------------------------ 2. the autofill
sub('''      <div class="f w2"><label>Name</label><input id="nlName" placeholder="Sunday Crew"></div>
      <div class="f"><label>League ID</label><input id="nlId" placeholder="sunday"></div>''',
'''      <!-- ⚠️ autocomplete off + an explicit name on BOTH. Without them Chrome treated the
           bare League ID box as a username field and filled in the signed-in user's email
           address; the resulting "2-24 chars, lowercase letters, numbers and dashes" error
           points nowhere near the cause. #nlPassword already sets autocomplete. -->
      <div class="f w2"><label>Name</label><input id="nlName" name="dd-league-name" autocomplete="off" placeholder="Sunday Crew"></div>
      <div class="f"><label>League ID</label><input id="nlId" name="dd-league-id" autocomplete="off" placeholder="sunday"></div>''',
    "create form no longer autofills")

if src == orig:
    print("no change (already applied)")
else:
    io.open(TARGET, "w", encoding="utf8").write(src)
    print("wrote %s" % TARGET)
