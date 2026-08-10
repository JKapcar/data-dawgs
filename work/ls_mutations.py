#!/usr/bin/env python3
"""Stage LS mutation proof: break the open-books library one way at a time.

Run from the REPO ROOT, detached:

    nohup python3 work/ls_mutations.py > /tmp/ls.log 2>&1 &

⚠️ A foreground call is killed at two minutes and a harness killed mid-mutation leaves a
mutated file on disk, which the NEXT run snapshots as its baseline. See [[stage-ms-spec]].

⚠️ TWO ASSERTIONS WERE CHANGED RATHER THAN ADDED IN THIS STAGE, and both are proved here
rather than taken on trust:
  * the live-region count went 4 -> 3, because #libSpread (the single shared open-book
    container) no longer exists. M6 and M7 prove the remaining three still bite.
  * the deep-link assertion went from "opens the book" to "finds and marks the book",
    because every book is already open. M10 proves the new one bites.
Changing an expectation is the easiest way to stop a suite failing. If you change one, prove
it here or the suite has quietly become decoration.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "data.html"
BUILDER = ROOT / "tools/build-data.js"
SURFACES = ROOT / "data/surfaces.json"
INDEX = ROOT / "data/index.json"

GATES = {
    "data-library": ["node", "work/test-data-library.mjs"],
    "machine-surfaces": ["node", "work/test-machine-surfaces.mjs"],
    "validate-data": ["node", "tools/validate-data.js"],
}
TOUCHED = [PAGE, BUILDER, SURFACES, INDEX]


def run(gate):
    r = subprocess.run(GATES[gate], cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.returncode == 0


def snapshot():
    return {p: p.read_text(encoding="utf-8") for p in TOUCHED}


def restore(snap):
    for p, t in snap.items():
        if p.read_text(encoding="utf-8") != t:
            p.write_text(t, encoding="utf-8")


def sub(path, old, new, count=1):
    t = path.read_text(encoding="utf-8")
    if t.count(old) < count:
        raise SystemExit(f"anchor not found in {path.name}: {old[:70]!r}")
    path.write_text(t.replace(old, new, count), encoding="utf-8")


def rebuild():
    subprocess.run(["node", "tools/build-data.js"], cwd=ROOT, capture_output=True, text=True,
                   env={"DD_BUILD_DATE": "2026-08-10", "PATH": "/usr/bin:/bin:/usr/local/bin"},
                   timeout=600)


MUTATIONS = []


def mutation(mid, gate, why, rebuilds=False):
    def deco(fn):
        MUTATIONS.append((mid, gate, why, fn, rebuilds))
        return fn
    return deco


# ---- the registry key that puts pages on the shelf ----
@mutation("M1", "data-library", "the `reading` key is dropped, so the volumes shelf empties", rebuilds=True)
def m1():
    sub(BUILDER, "    reading: [{ url: '/master.html'", "    _reading: [{ url: '/master.html'")
    sub(BUILDER, "    reading: [{ url: '/strategy.html'", "    _reading: [{ url: '/strategy.html'")
    rebuild()


@mutation("M2", "data-library", "a `reading` url points at a /data/ payload instead of a page", rebuilds=True)
def m2():
    sub(BUILDER, "reading: [{ url: '/strategy.html'", "reading: [{ url: '/data/strategy.md'")
    rebuild()


@mutation("M3", "data-library", "an HTML page leaks into a `machine` array", rebuilds=True)
def m3():
    """⚠️ THE WHOLE REASON `reading` IS A THIRD KEY. `machine` is what llms.txt and
    test-machine-surfaces grade as machine-readable; a page in there is a false claim."""
    sub(BUILDER, "machine: [{ kind: 'markdown', url: '/data/strategy.md', status: 'live' }],",
        "machine: [{ kind: 'markdown', url: '/data/strategy.md', status: 'live' }, { kind: 'json', url: '/strategy.html', status: 'live' }],")
    rebuild()


# ---- the open-book shape ----
@mutation("M4", "data-library", "a book renders one page instead of a two-page spread")
def m4():
    sub(PAGE, '      <div class="lib-page">\n        <p class="lib-side">The record</p>',
        '      <div class="lib-page" hidden>\n        <p class="lib-side">The record</p>')


@mutation("M5", "data-library", "the spread stops collapsing to one page below 480px")
def m5():
    sub(PAGE, "@media(max-width:480px){\n  .books{grid-template-columns:1fr}\n  .book{grid-template-columns:1fr}",
        "@media(max-width:480px){\n  .books{grid-template-columns:1fr}\n  .book{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}")


@mutation("M6", "data-library", "the book count loses its live region")
def m6():
    sub(PAGE, '<div class="p-meta" id="libCount" aria-live="polite">', '<div class="p-meta" id="libCount">')


@mutation("M7", "data-library", "a second count loses its live region")
def m7():
    sub(PAGE, '<div class="p-meta" id="refCount" aria-live="polite">', '<div class="p-meta" id="refCount">')


@mutation("M8", "data-library", "the read control stops being a real button")
def m8():
    sub(PAGE, '<button type="button" class="lib-read" data-read="${esc(b.id)}"',
        '<div role="presentation" class="lib-read" data-read="${esc(b.id)}"')
    sub(PAGE, 'aria-controls="rd-${esc(b.id)}">Read the file</button>',
        'aria-controls="rd-${esc(b.id)}">Read the file</div>')


# ---- the lazy property, which is what makes 42 open books affordable ----
@mutation("M9", "data-library", "every book reads its file at load, so opening the page costs 42 fetches")
def m9():
    sub(PAGE, "    $(\"libShelves\").addEventListener(\"click\", e=>{",
        "    BOOKS.forEach(b=>readBook(b.id));\n    $(\"libShelves\").addEventListener(\"click\", e=>{")


@mutation("M10", "data-library", "a deep link stops marking the book it names")
def m10():
    sub(PAGE, '    el.classList.add("lib-hit");\n', "")


@mutation("M11", "data-library", "a volume offers to read a file it does not have")
def m11():
    """A page has no envelope. Offering "Read the file" on one is a claim the shelf exists
    to refuse: the whole point of the volumes shelf is saying which is which."""
    sub(PAGE, '        <p class="assumption">This is a page, so it carries no envelope',
        '        <button type="button" class="lib-read" data-read="x" aria-expanded="false" aria-controls="x">Read the file</button>\n        <p class="assumption">This is a page, so it carries no envelope')


@mutation("M12", "data-library", "collapsing stops returning focus to the control that was pressed")
def m12():
    sub(PAGE, '    btn.textContent = "Read the file";\n    btn.focus();',
        '    btn.textContent = "Read the file";')


def main():
    snap = snapshot()
    print("BASELINE — every gate this harness grades:")
    base = {g: run(g) for g in GATES}
    for g, v in base.items():
        print(f"  {'GREEN' if v else 'RED  '}  {g}")
    if not all(base.values()):
        restore(snap)
        sys.exit("\nSTOP: a gate is red before any mutation.")

    print(f"\n{len(MUTATIONS)} mutations\n" + "-" * 78)
    results = []
    for mid, gate, why, fn, rebuilds in MUTATIONS:
        try:
            fn()
            red = not run(gate)
        finally:
            restore(snap)
            if rebuilds:
                rebuild()
                restore(snap)
        results.append((mid, red, why, gate))
        print(f"  {'RED  ' if red else 'GREEN'}  {mid:4s} {gate:16s} {why}")

    print("\nAFTER RESTORE — the gates must be green again:")
    after = True
    for g in GATES:
        v = run(g)
        after &= v
        print(f"  {'GREEN' if v else 'RED  '}  {g}")

    red = sum(1 for _, r, *_ in results if r)
    print("\n" + "=" * 78)
    print(f"MUTATION PROOF: {red} of {len(results)} RED")
    for mid, r, why, gate in results:
        if not r:
            print(f"  ⚠️ SURVIVED: {mid} — {why} (expected {gate} to catch it)")
    if not after:
        print("  ⚠️ THE TREE DID NOT RESTORE CLEANLY. git diff before trusting anything.")
    sys.exit(0 if (red == len(results) and after) else 1)


if __name__ == "__main__":
    main()
