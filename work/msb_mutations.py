#!/usr/bin/env python3
"""Stage MS-B mutation proof: break the model board on purpose, one way at a time, and
demand that a named gate goes RED for each.

Run from the REPO ROOT, and run it detached:

    nohup python3 work/msb_mutations.py > /tmp/msb.log 2>&1 &

⚠️ WHY DETACHED. A foreground call is killed at two minutes. Stage MS-A's harness was killed
mid-mutation, restore() never ran, and the NEXT run snapshotted the already-broken file as its
baseline and reported ten confident REDs. It also leaked a node server and the run after that
died EADDRINUSE, which reads like a broken suite rather than a poisoned tree.

⚠️ THREE RULES THIS FILE ENCODES, ALL LEARNED THE HARD WAY:

 1. BASELINE EVERY GATE THE HARNESS WILL GRADE, not a subset. If a gate is not in the
    baseline, damage it alone can see is invisible and its REDs are unattributable.

 2. AN ARTEFACT MUTATION MUST BE MADE SELF-CONSISTENT. data/index.json carries a sha256 per
    data file and validate-data.js checks it, so ANY edit to model-board.json fails the
    manifest check first -- before the assertion under test can fire. A mutation that goes red
    for the wrong reason proves nothing. Every artefact mutation below therefore recomputes
    the manifest entry, so the only thing left broken is the thing being tested.

 3. A BUILDER MUTATION MUST BE GRADED AFTER THE BUILDER RUNS. Editing tools/build-data.js
    changes nothing on disk until it is re-run; the artefact under test is the file already
    published. Builder mutations here rebuild, then grade.

Restore happens after EVERY mutation, not in a finally at the end.
"""
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOARD = ROOT / "data/model-board.json"
INDEX = ROOT / "data/index.json"
BUILDER = ROOT / "tools/build-data.js"
PAGE = ROOT / "receipts.html"

GATES = {
    "validate-data": ["node", "tools/validate-data.js"],
    "receipts-sheets": ["node", "work/test-receipts-sheets.mjs"],
    "machine-surfaces": ["node", "work/test-machine-surfaces.mjs"],
    # ⚠️ IN THE GATE LIST BECAUSE IT CAUGHT A REAL BREAK NO BROWSER SUITE SAW. This stage
    # changed the models table's aria-label, and pound-contracts asserted the OLD label
    # verbatim -- a label that named nfelo and 538 Classic, i.e. a third hidden copy of the
    # hardcoded model list. 232 browser assertions passed over it. Same shape as verify-sw.
    "pound-contracts": ["node", "work/test-pound-contracts.js"],
}
TOUCHED = [BOARD, INDEX, BUILDER, PAGE]


def run(gate):
    r = subprocess.run(GATES[gate], cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.returncode == 0


def snapshot():
    return {p: p.read_text(encoding="utf-8") for p in TOUCHED}


def restore(snap):
    for p, t in snap.items():
        if p.read_text(encoding="utf-8") != t:
            p.write_text(t, encoding="utf-8")


def reseal():
    """Recompute data/index.json's manifest entry for model-board.json.

    This is rule 2. Without it the manifest check fires on every artefact mutation and the
    assertion actually under test is never reached."""
    txt = BOARD.read_text(encoding="utf-8")
    idx = json.loads(INDEX.read_text(encoding="utf-8"))
    for f in idx["data"]["files"]:
        if f["path"] == "/data/model-board.json":
            f["bytes"] = len(txt.encode("utf-8"))
            f["sha256"] = hashlib.sha256(txt.encode("utf-8")).hexdigest()
            break
    else:
        raise SystemExit("manifest has no model-board.json entry — reseal() is now blind")
    INDEX.write_text(json.dumps(idx, indent=1), encoding="utf-8")


def edit_board(fn):
    d = json.loads(BOARD.read_text(encoding="utf-8"))
    fn(d["data"])
    BOARD.write_text(json.dumps(d, indent=1), encoding="utf-8")
    reseal()


def sub(path, old, new, count=1):
    t = path.read_text(encoding="utf-8")
    if t.count(old) < count:
        raise SystemExit(f"anchor not found in {path.name}: {old[:70]!r}")
    path.write_text(t.replace(old, new, count), encoding="utf-8")


def rebuild():
    subprocess.run(["node", "tools/build-data.js"], cwd=ROOT, capture_output=True,
                   text=True, env={"DD_BUILD_DATE": "2026-08-10", "PATH": "/usr/bin:/bin:/usr/local/bin"},
                   timeout=600)


# ---------------------------------------------------------------- the mutations
MUTATIONS = []


def mutation(mid, gate, why):
    def deco(fn):
        MUTATIONS.append((mid, gate, why, fn))
        return fn
    return deco


# ---- artefact mutations, graded by validate-data (each one resealed) ----
@mutation("M1", "validate-data", "a published mean probability is edited after the fact")
def m1():
    def f(d):
        d["models"][0]["mean_home_win_probability"] = round(
            d["models"][0]["mean_home_win_probability"] + 0.01, 6)
    edit_board(f)


@mutation("M2", "validate-data", "the derived correlation stops matching the pre-registered one")
def m2():
    def f(d):
        c = d["panel"]["pre_registration_check"]
        c["derived_logit_correlation"] = round(c["derived_logit_correlation"] - 0.02, 6)
    edit_board(f)


@mutation("M2b", "validate-data", "the same drift, hidden by flipping agrees back to true")
def m2b():
    """⚠️ M2 alone could be caught by the agrees flag rather than by comparing the numbers.
    This makes the artefact SELF-CONSISTENT about its own verdict so only a real recomputation
    against the ledger can catch it."""
    def f(d):
        c = d["panel"]["pre_registration_check"]
        c["derived_logit_correlation"] = round(c["derived_logit_correlation"] - 0.02, 6)
        c["agrees"] = True
    edit_board(f)


@mutation("M3", "validate-data", "the undisplayed linear aggregation is flipped to displayed")
def m3():
    def f(d):
        for m in d["models"]:
            if m["model_id"] == "ddpr-nfl-linear":
                m["displayed"] = True
        d["panel"]["displayed_lines"] = len([m for m in d["models"] if m["displayed"]])
    edit_board(f)


@mutation("M4", "validate-data", "the undisplayed line's probabilities leak into week beliefs")
def m4():
    def f(d):
        g = d["week"]["games"][0]
        g["beliefs"]["ddpr-nfl-linear"] = 0.5
    edit_board(f)


@mutation("M5", "validate-data", "the per-game panel widens to average the ensemble back in")
def m5():
    def f(d):
        ids = [m["model_id"] for m in d["models"] if m["displayed"]]
        for g in d["week"]["games"]:
            g["spread"]["over"] = ids
    edit_board(f)


@mutation("M6", "validate-data", "the board calls every registered line independent evidence")
def m6():
    def f(d):
        d["panel"]["independent_lines"] = d["panel"]["registered_lines"]
        d["panel"]["independent_model_ids"] = [m["model_id"] for m in d["models"]]
    edit_board(f)


@mutation("M7", "validate-data", "a Brier score appears before a single game has kicked off")
def m7():
    def f(d):
        d["models"][0]["brier"] = 0.21
    edit_board(f)


@mutation("M8", "validate-data", "a registered model line is quietly dropped from the board")
def m8():
    def f(d):
        d["models"] = [m for m in d["models"] if m["model_id"] != "538-classic"]
        d["panel"]["registered_lines"] = len(d["models"])
    edit_board(f)


@mutation("M9", "validate-data", "the board is swapped for a copy of the whole ledger")
def m9():
    """The board exists to stop the models sheet fetching 1,354 KB. A 'derived view' that is
    not small has stopped being one, and nothing else on the page would notice."""
    led = json.loads((ROOT / "data/model-receipts.json").read_text(encoding="utf-8"))
    d = json.loads(BOARD.read_text(encoding="utf-8"))
    d["data"]["ledger_inline"] = led["data"]
    BOARD.write_text(json.dumps(d, indent=1), encoding="utf-8")
    reseal()


# ---- builder mutations, graded AFTER a rebuild ----
@mutation("M10", "validate-data", "the BUILDER starts averaging the ensemble into the panel")
def m10():
    sub(BUILDER,
        "const panel = primitiveIds.map(id => beliefs[id]).filter(Number.isFinite).sort((a, b) => a - b);",
        "const panel = Object.values(beliefs).filter(Number.isFinite).sort((a, b) => a - b);")
    rebuild()


@mutation("M11", "validate-data", "the BUILDER stops withholding the undisplayed line")
def m11():
    sub(BUILDER,
        "for (const r of rs) if (displayed.some(m => m.model_id === r.model_id)) beliefs[r.model_id] = r.home_win_probability;",
        "for (const r of rs) beliefs[r.model_id] = r.home_win_probability;")
    rebuild()


@mutation("M12", "machine-surfaces", "the registry drops the board the models sheet fetches")
def m12():
    sub(BUILDER, "{ kind: 'json', url: '/data/model-board.json', status: 'live',",
        "{ kind: 'json', url: '/data/model-board-REMOVED.json', status: 'live',")
    rebuild()


# ---- page mutations, graded by receipts-sheets ----
@mutation("M13", "receipts-sheets", "the page renders every registered line, withheld ones included")
def m13():
    sub(PAGE, "const shown=all.filter(m=>m.displayed!==false);", "const shown=all.slice();")


@mutation("M14", "receipts-sheets", "the week table goes back to a hardcoded two-model header")
def m14():
    sub(PAGE,
        '"<tr><th>Game</th>"+shown.map(m=>`<th>${mdlEsc(m.model_name)}</th>`).join("")+',
        '"<tr><th>Game</th><th>nfelo</th><th>538 Classic</th>"+')


@mutation("M15", "receipts-sheets", "a model count is typed back into the static placeholder")
def m15():
    sub(PAGE, "<div class=\"p-stat\"><b>&mdash;</b><span>registered lines</span></div>",
        "<div class=\"p-stat\"><b>3</b><span>registered lines</span></div>")


@mutation("M16", "receipts-sheets", "an ungraded model renders 0 instead of an em dash")
def m16():
    sub(PAGE, "`<td>${m.brier===null?'<span class=\"mb-null\">&mdash;</span>':mdlEsc(m.brier)}</td>`+",
        "`<td>${m.brier===null?'0':mdlEsc(m.brier)}</td>`+")


@mutation("M17", "receipts-sheets", "the entity-escaping bug returns and prints a literal &times;")
def m17():
    sub(PAGE, '(chk?` The ${chk.models.map(x=>mdlEsc(x)).join(" &times; ")} figure was `+',
        '(chk?` The ${mdlEsc(chk.models.join(" &times; "))} figure was `+')


@mutation("M18", "receipts-sheets", "the correlation table stops filtering the withheld line out")
def m18():
    sub(PAGE, "      .filter(p=>(p.models||[]).every(id=>shown.some(m=>m.model_id===id)))\n", "")


@mutation("M19", "pound-contracts", "the week table loses its accessible name entirely")
def m19():
    """⚠️ THIS PAIR EXISTS BECAUSE THIS STAGE RELAXED AN ASSERTION. pound-contracts used to
    demand a literal aria-label naming two models; it now demands only that the table HAS a
    substantial one. Relaxing an expectation is the easiest way to make a suite stop biting,
    so both halves of the replacement are proved to fail."""
    sub(PAGE, '<table class="p-table" id="scoreTable" aria-label="Week 1 model beliefs by game" hidden>',
        '<table class="p-table" id="scoreTable" hidden>')


@mutation("M19b", "pound-contracts", "the accessible name degrades to a placeholder")
def m19b():
    sub(PAGE, 'id="scoreTable" aria-label="Week 1 model beliefs by game"',
        'id="scoreTable" aria-label="table"')


# ---------------------------------------------------------------- driver
def main():
    dirty = subprocess.run(["git", "status", "--porcelain"] + [str(p) for p in TOUCHED],
                           cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print("Files this harness will mutate, as git sees them now:")
    print("  " + (dirty.replace("\n", "\n  ") if dirty else "(all clean vs the index)"))

    snap = snapshot()
    print("\nBASELINE — every gate this harness grades, not a subset:")
    base = {}
    for g in GATES:
        base[g] = run(g)
        print(f"  {'GREEN' if base[g] else 'RED  '}  {g}")
    if not all(base.values()):
        restore(snap)
        sys.exit("\nSTOP: a gate is red before any mutation. Nothing below would mean anything.")

    print(f"\n{len(MUTATIONS)} mutations\n" + "-" * 78)
    results = []
    for mid, gate, why, fn in MUTATIONS:
        try:
            fn()
            red = not run(gate)
        finally:
            restore(snap)
            # A builder mutation wrote real files; put the tree back the way it was.
            if mid in ("M10", "M11", "M12"):
                rebuild()
                restore(snap)
        results.append((mid, gate, why, red))
        print(f"  {'RED  ' if red else 'GREEN'}  {mid:5s} {gate:16s} {why}")

    # Prove the restore actually worked, or the next run inherits a poisoned baseline.
    print("\nAFTER RESTORE — the gates must be green again:")
    after_ok = True
    for g in GATES:
        v = run(g)
        after_ok &= v
        print(f"  {'GREEN' if v else 'RED  '}  {g}")

    red = sum(1 for *_, r in results if r)
    print("\n" + "=" * 78)
    print(f"MUTATION PROOF: {red} of {len(results)} RED")
    for mid, gate, why, r in results:
        if not r:
            print(f"  ⚠️ SURVIVED: {mid} — {why} (expected {gate} to catch it)")
    if not after_ok:
        print("  ⚠️ THE TREE DID NOT RESTORE CLEANLY. git diff before trusting anything.")
    sys.exit(0 if (red == len(results) and after_ok) else 1)


if __name__ == "__main__":
    main()
