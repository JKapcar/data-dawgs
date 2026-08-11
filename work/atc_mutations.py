#!/usr/bin/env python3
"""Mutation proof for work/test-launcher-overlap.mjs — the Ask Toto launcher guards (Stage ATC).

Run from the REPO ROOT:  python3 work/atc_mutations.py

WHAT CHANGED FROM THE FIRST DRAFT, AND WHY
The original harness decided pass/fail from the suite's PROCESS EXIT CODE alone. That is not a
mutation proof: it cannot tell "the assertion I aimed at went red" from "something unrelated
broke", and a mutation that goes red for the wrong reason proves nothing. Every mutation below
now declares:

  * how many ANCHOR SITES it expects to patch — 0 means the anchor moved and nothing was proved,
    and a wrong count means the edit did not land where it was supposed to;
  * the EXACT failing assertion substrings and how many of each;
  * the TOTAL failure count, so an unrelated assertion going red is itself a failure of the proof.

Every expectation here was OBSERVED FIRST on this tree and then written down. Nothing is guessed:
the unpatched build was run before the patch was applied and produced exactly 1 unreachable
failure at 754 px2 plus 6 "chip leaves while scrolling" failures, and the patched build produces
92 passed / 0 failed.

⚠️ Restores come from bytes held in memory, never from git. `git checkout -- .` destroyed a
finished, fully gated stage on 2026-08-10. `git add -A` is the checkpoint, and the staged index
is what makes this recoverable if the harness is killed mid-run.
⚠️ If this harness is interrupted, run `git diff` BEFORE rerunning it. A killed run leaves a
mutation on disk and the next run snapshots that broken file as its baseline.
"""
import glob, subprocess, sys, re, time

SUITE = ["node", "test-launcher-overlap.mjs"]
CWD = "work"
FAIL_RE = re.compile(r"^\s*FAIL\s+(.*)$")
COUNT_RE = re.compile(r"(\d+)\s+passed,\s+(\d+)\s+failed")

# label, file globs, find, replace, expected anchor sites, expected {substring: count},
# expected total failures, what the expectation MEANS
MUTATIONS = [
    ("M1  guard A removed outright",
     ["bigboard.html"],
     "@media(min-width:420px){.udfoot{padding-bottom:72px}}",
     "",
     1,
     {"nothing unreachable under the launcher": 1},
     1,
     "deleting the rule restores the ORIGINAL geometry, so the failure must carry 754 px2 — "
     "this is the mutation that entitles the commit body to name that number"),

    ("M1b guard A trimmed to the base rule's own 4px",
     ["bigboard.html"],
     "@media(min-width:420px){.udfoot{padding-bottom:72px}}",
     "@media(min-width:420px){.udfoot{padding-bottom:4px}}",
     1,
     {"nothing unreachable under the launcher": 1},
     1,
     "MEASURED: identical to M1, same 754 px2. The base rule is `.udfoot{padding:20px 0 4px}`, so "
     "an override of 4px is a NO-OP and a guard set to it is indistinguishable from no guard at "
     "all. Kept as a standing warning against 'simplifying' guard A to a smaller number — and as "
     "a worked example of a green-for-no-reason mutation, where the 'wrong' value turned out to "
     "be the real one. The first draft of this line claimed it would NOT reproduce 754; that was "
     "written before it was run, and running it proved it wrong"),

    ("M2  guard B away-class removed",
     ["*.html"],
     '        b.classList.add("ddb-away");',
     '        void 0;',
     25,
     {"chip leaves while scrolling": 6,
      "chip leaves on an INNER container scroll": 2},
     8,
     "the chip no longer steps aside for ANY scroll: 3 pages x 2 motion preferences on the window, "
     "plus both inner-container surfaces"),

    ("M3  capture:true -> capture:false",
     ["*.html"],
     '      }, { passive: true, capture: true });',
     '      }, { passive: true, capture: false });',
     25,
     {"chip leaves on an INNER container scroll": 2},
     2,
     "ONLY the inner-container assertions may fail. Scroll events do not bubble, so a window "
     "listener without capture never hears .p-table-wrap or .cfbwrap move — while every "
     "window-scroll assertion stays green, which is what makes this a targeted proof and not "
     "a blunt one. If this comes back GREEN the capture comment is unproven and must be softened"),

    ("M4  reduced-motion override removed",
     ["*.html"],
     "@media (prefers-reduced-motion:reduce){#ddbLaunch.ddb-away{transform:none;transition:none}}",
     "",
     25,
     {},
     0,
     "EXPECTED GREEN, and recorded so nobody later mistakes the reduced-motion block for the fix. "
     "opacity and pointer-events do the hiding; that block only drops the movement"),

    ("M5  auction's own button made fixed bottom-right",
     ["auction.html"],
     '<button class="btn aibtn" id="aiBtn"',
     '<button class="btn aibtn" id="aiBtn" style="position:fixed;right:18px;bottom:18px"',
     1,
     {"ships its own in-flow #aiBtn instead of the fixed launcher": 2},
     2,
     "the one exemption is ASSERTED, not skipped: it cannot hide a launcher-shaped button in the "
     "launcher's corner. Two widths, so two assertions"),
]


def targets(patterns):
    out = []
    for pat in patterns:
        for f in sorted(glob.glob(pat)):
            if pat != "*.html" or "ddbLaunch" in open(f, encoding="utf-8").read():
                out.append(f)
    return out


def run_suite():
    r = subprocess.run(SUITE, cwd=CWD, capture_output=True, text=True, timeout=900)
    fails = [m.group(1).strip() for m in
             (FAIL_RE.match(l) for l in r.stdout.splitlines()) if m]
    m = None
    for m2 in COUNT_RE.finditer(r.stdout):
        m = m2
    return {"rc": r.returncode, "fails": fails, "out": r.stdout,
            "passed": int(m.group(1)) if m else None,
            "failed": int(m.group(2)) if m else None}


def main():
    print("=" * 78)
    print("BASELINE FIRST — a harness that grades an already-red gate produces confident nonsense")
    print("=" * 78)
    base = run_suite()
    print(f"  baseline: {base['passed']} passed, {base['failed']} failed  rc={base['rc']}")
    if base["rc"] != 0:
        print("\n⛔ BASELINE IS RED. Aborting before a single mutation — every result below would\n"
              "   be measured against a broken tree. First three failures:")
        for f in base["fails"][:3]:
            print(f"     {f}")
        sys.exit(2)
    baseline_pass = base["passed"]

    results = []
    for (label, pats, find, repl, want_sites, want_subs, want_total, meaning) in MUTATIONS:
        files = targets(pats)
        original = {f: open(f, encoding="utf-8").read() for f in files}
        sites = sum(original[f].count(find) for f in files)
        hit_files = [f for f in files if find in original[f]]

        print("\n" + "-" * 78)
        print(f"{label}")
        if sites != want_sites:
            print(f"  ⛔ ANCHOR COUNT {sites}, expected {want_sites} — the anchor moved. "
                  f"NOTHING PROVED; not applying.")
            results.append((label, "ANCHOR-MISS", f"{sites} sites vs {want_sites}", meaning, False))
            continue

        for f in hit_files:
            open(f, "w", encoding="utf-8", newline="").write(original[f].replace(find, repl))
        try:
            r = run_suite()
            status = "RED" if r["rc"] else "GREEN"
            got = {}
            for sub in want_subs:
                got[sub] = sum(1 for x in r["fails"] if sub in x)
            unrelated = [x for x in r["fails"]
                         if not any(sub in x for sub in want_subs)]

            ok_subs = all(got[s] == want_subs[s] for s in want_subs)
            ok_total = (r["failed"] or 0) == want_total
            ok_clean = len(unrelated) == 0
            ok_count = r["passed"] is not None and (r["passed"] + (r["failed"] or 0)) == baseline_pass
            good = ok_subs and ok_total and ok_clean and ok_count

            print(f"  sites={sites}  {status}  {r['passed']} passed, {r['failed']} failed")
            for s in want_subs:
                mark = "ok" if got[s] == want_subs[s] else "⛔"
                print(f"    {mark} \"{s}\"  got {got[s]}, expected {want_subs[s]}")
            if not ok_total:
                print(f"    ⛔ total failures {r['failed']}, expected {want_total}")
            if unrelated:
                print(f"    ⛔ {len(unrelated)} UNRELATED assertion(s) also failed — the mutation "
                      f"went red for the wrong reason:")
                for u in unrelated[:4]:
                    print(f"         {u[:130]}")
            if not ok_count:
                print(f"    ⛔ assertion TOTAL moved: {r['passed']}+{r['failed']} != baseline "
                      f"{baseline_pass}. A check stopped running.")
            for f_ in r["fails"][:3]:
                print(f"    · {f_[:150]}")
            results.append((label, status, f"{r['passed']}/{(r['passed'] or 0)+(r['failed'] or 0)}",
                            meaning, good))
        finally:
            # restore after EVERY mutation, not in a trailing cleanup — a later mutation must
            # never run against a tree an earlier one corrupted
            for f in files:
                open(f, "w", encoding="utf-8", newline="").write(original[f])
        time.sleep(2)

    print("\n" + "=" * 78)
    bad = [r for r in results if not r[4]]
    for label, status, counts, meaning, good in results:
        print(f"{'PASS' if good else 'CHECK':5s} {label:40s} {status:12s} {counts}")
        print(f"      {meaning[:150]}")
    print("=" * 78)
    print(f"{len(results) - len(bad)}/{len(results)} mutations matched their expected signature")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
