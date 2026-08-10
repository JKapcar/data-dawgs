#!/usr/bin/env python3
"""Mutation harness for Stage MS-A — DDPR NFL into the receipt ledger.

Each mutation breaks ONE thing the stage claims to guard and asserts the named gate goes
RED. A mutation that stays green means the assertion it targets is not testing what it
says, and gets rewritten or deleted rather than recorded as a pass.

⚠️ BLAST RADIUS IS RESTORED AFTER EVERY MUTATION, NOT IN A `finally`.
Learned expensively on Stage RI: mutations M6 and M7 rerun a BUILDER, and a builder rewrites
every file it owns. Restoring only at the end means every later mutation runs against a tree
the earlier one corrupted, and the harness then reports confident nonsense. See the
receipts-inventory-spec memory.

⚠️ A BUILDER MUTATION IS A NO-OP UNTIL THE BUILDER RERUNS. M6 and M7 edit
scripts/ddpr_nfl.py, which changes nothing on disk by itself — the gate is grading the
already-published artefact. Both therefore rerun `refresh` as part of the mutation. If one of
them ever comes back green, suspect the rerun before suspecting the assertion.

Run from the repo root:  python3 work/ddpr_mutations.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BAK = ROOT / "work" / ".ddprbak"

sys.path.insert(0, str(ROOT / "scripts"))
import nfl_data_backbone as backbone  # noqa: E402  (for sha256_id, so a mutated artefact
#                                       can be made self-consistent — see M7)

# Every file any mutation below can touch, directly or through a builder rerun.
BLAST = [
    "llms.txt",
    "data/model-receipts.json",
    "data/ddpr-nfl.json",
    "data/receipts-inventory.json",
    "data/index.json",
    "data/surfaces.json",
    "scripts/ddpr_nfl.py",
    "tools/validate-data.js",
    "receipts.html",
]

GATES = {
    "ddpr-validate": [sys.executable, "scripts/ddpr_nfl.py", "validate"],
    "ddpr-refresh": [sys.executable, "scripts/ddpr_nfl.py", "refresh"],
    "validate-data": ["node", "tools/validate-data.js"],
    "machine-surfaces": ["node", "work/test-machine-surfaces.mjs"],
    # ⚠️ Runs from work/, not the repo root. From the root it dies on relative data paths and
    # the error reads like a broken tree.
    "receipts-sheets": ["node", "test-receipts-sheets.mjs"],
}
GATE_CWD = {"receipts-sheets": ROOT / "work"}

results: list[tuple[str, bool, str]] = []


def snapshot() -> None:
    BAK.mkdir(parents=True, exist_ok=True)
    for rel in BLAST:
        dest = BAK / rel.replace("/", "__")
        shutil.copy2(ROOT / rel, dest)


def restore() -> None:
    for rel in BLAST:
        shutil.copy2(BAK / rel.replace("/", "__"), ROOT / rel)


def run(gate: str) -> tuple[int, str]:
    proc = subprocess.run(
        GATES[gate], cwd=GATE_CWD.get(gate, ROOT), capture_output=True, text=True
    )
    return proc.returncode, (proc.stdout + proc.stderr)


def sub(rel: str, old: str, new: str) -> None:
    """Exact single-occurrence text replacement. Refuses to mutate ambiguously."""
    p = ROOT / rel
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"MUTATION TARGET NOT UNIQUE in {rel}: {n} occurrences of {old!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


def edit_json(rel: str, fn) -> None:
    p = ROOT / rel
    doc = json.loads(p.read_text(encoding="utf-8"))
    fn(doc)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def check(name: str, gate: str, expect_text: str | None = None) -> None:
    code, out = run(gate)
    red = code != 0 or "FAIL" in out or " failed" in out and " 0 failed" not in out
    detail = ""
    if red and expect_text and expect_text not in out:
        red = False
        detail = f"went red, but not for the stated reason (wanted {expect_text!r})"
    if not red:
        detail = detail or "STAYED GREEN"
    results.append((f"{name} -> {gate}", red, detail))
    print(f"  {'RED ' if red else 'GREEN'}  {name} -> {gate}  {detail}")


def mutate(name: str, gate: str, apply, expect_text: str | None = None) -> None:
    print(f"[{name}]")
    try:
        apply()
        check(name, gate, expect_text)
    finally:
        restore()


def main() -> None:
    snapshot()
    # ⚠️⚠️ BASELINE EVERY GATE THIS HARNESS WILL USE, not a subset.
    # Cost of learning this, 2026-08-10: an earlier run was killed by an external 2-minute
    # timeout mid-mutation, so `restore()` never ran and receipts.html was left carrying the
    # M11 nowrap mutation. The next run snapshotted that broken file as its baseline and
    # reported ten confident REDs, because `receipts-sheets` — the only gate that could have
    # seen the damage — was not in the baseline list. A harness that baselines a subset of
    # its own gates can be running against a corrupted tree and look immaculate.
    # Corollary: if this harness is ever interrupted, `git diff` before rerunning it.
    print("baseline: every gate must be GREEN before any mutation is believable")
    for gate in GATES:
        if gate == "ddpr-refresh":
            continue          # a builder, not a grader; it writes rather than reports
        print(f"  (baselining {gate})")
        code, out = run(gate)
        green = code == 0 and "FAIL" not in out
        print(f"  {'GREEN' if green else 'RED  '}  baseline {gate}")
        if not green:
            raise SystemExit(f"baseline {gate} is not green; fix that before mutating\n{out}")

    # ---- the llms.txt claims. Each of these three was UNGUARDED before this stage: the
    # suite carried 19 assertions and every one of them stayed green with the file lying.
    mutate("M1 llms.txt understates the ledger (1,088 -> 544)", "machine-surfaces",
           lambda: sub("llms.txt", "1,088 append-only", "544 append-only"),
           "receipt-ledger row count")

    mutate("M2 llms.txt understates the model lines (4 -> 3)", "machine-surfaces",
           lambda: sub("llms.txt", "4 model lines", "3 model lines"),
           "model-line count")

    mutate("M3 llms.txt calls all 4 lines independent evidence", "machine-surfaces",
           lambda: sub("llms.txt", "2 independent", "4 independent"),
           "imply independent evidence")

    # ---- the published ledger rows
    def flip_probability(doc):
        for row in doc["data"]:
            if row["model_id"] == "ddpr-nfl":
                row["home_win_probability"] = round(row["home_win_probability"] + 0.05, 6)
                return
        raise SystemExit("no ddpr-nfl row to flip — the mutation cannot fail, so it is useless")

    mutate("M4 one published DDPR probability is edited after the fact", "ddpr-validate",
           lambda: edit_json("data/model-receipts.json", flip_probability))

    def drop_linear(doc):
        before = len(doc["data"])
        doc["data"] = [r for r in doc["data"] if r["model_id"] != "ddpr-nfl-linear"]
        if len(doc["data"]) == before:
            raise SystemExit("no ddpr-nfl-linear rows to drop — the mutation cannot fail")

    mutate("M5 the undisplayed linear aggregation is quietly dropped", "ddpr-validate",
           lambda: edit_json("data/model-receipts.json", drop_linear))

    # ---- BUILDER mutations. Each rewrites data/, which is why restore() runs after every one.
    def extremize_and_rebuild():
        sub("scripts/ddpr_nfl.py",
            "return q6(inverse_logit(logit_mean)), q6(linear_mean)",
            "return q6(inverse_logit(1.2 * logit_mean)), q6(linear_mean)")
        run("ddpr-refresh")

    mutate("M6 the builder starts extremizing without saying so", "ddpr-validate",
           extremize_and_rebuild, "does not reproduce")

    # ⚠️ M7 WAS FIRST WRITTEN AS A BUILDER MUTATION GRADED BY `ddpr-validate`, AND IT STAYED
    # GREEN. A NEW SHAPE OF THE NO-OP TRAP, worth writing down: the builder REFUSED to publish
    # the switched line, so nothing on disk changed, so the gate that grades the published
    # artefact had nothing to see. A builder that fails closed makes an artefact-level gate
    # blind to the very thing it refused. Two mutations replace it, and they test different
    # surfaces:
    #   M7  the artefact is edited directly and made SELF-CONSISTENT (snapshot recomputed), so
    #       only the displayed-aggregation assertion can catch it.
    #   M10 the builder is mutated, graded by the BUILDER, which must refuse to publish.
    def switch_displayed_line(doc):
        doc["data"]["displayed_aggregation"] = "linear_mean"
        # Recompute the snapshot so the file is internally consistent. Without this the
        # snapshot check fires first and the assertion under test is never reached — a
        # mutation that goes red for the wrong reason proves nothing about the right one.
        doc["integrity"]["snapshot_id"] = backbone.sha256_id(doc["data"])

    mutate("M7 the displayed line is switched to linear in a self-consistent artefact",
           "ddpr-validate",
           lambda: edit_json("data/ddpr-nfl.json", switch_displayed_line),
           "displayed DDPR aggregation")

    def declare_extremized(doc):
        doc["data"]["extremized"] = True
        doc["integrity"]["snapshot_id"] = backbone.sha256_id(doc["data"])

    mutate("M7b a self-consistent artefact admits to extremizing", "ddpr-validate",
           lambda: edit_json("data/ddpr-nfl.json", declare_extremized),
           "must not be extremized")

    def display_linear_in_builder():
        sub("scripts/ddpr_nfl.py",
            '"displayed_aggregation": "logit_mean",',
            '"displayed_aggregation": "linear_mean",')

    mutate("M10 the builder tries to publish the linear average as the displayed line",
           "ddpr-refresh", display_linear_in_builder, "displayed DDPR aggregation")

    # ---- the two repo-side fixes this stage made, proven load-bearing
    mutate("M8 validate-data goes back to naming files instead of asking their shape",
           "validate-data",
           lambda: sub("tools/validate-data.js",
                       "const rowsOf = (file, d) => Array.isArray(d) ? d : (d && d.forecasts);",
                       "const rowsOf = (file, d) => file === '538-classic.json' ? (d.forecasts || []) : d;"),
           "ddpr-nfl.json")

    def stale_the_inventory(doc):
        for led in doc["data"]["ledgers"]:
            if led["id"] == "ddpr-nfl":
                led["registered"] = 999
                return
        raise SystemExit("the inventory carries no ddpr-nfl ledger — the mutation cannot fail")

    mutate("M9 the inventory's DDPR count goes stale", "validate-data",
           lambda: edit_json("data/receipts-inventory.json", stale_the_inventory),
           "ddpr-nfl.json registered")

    # ---- the layout defect this stage exposed. Stage RI shipped the description row without
    # `white-space:normal`, relying on a colspan to wrap that the global td{white-space:nowrap}
    # forbade. Nothing failed for a day because no description was long enough. Removing the
    # declaration must now turn BOTH the scroll-box check and the new line-box check red.
    mutate("M11 the description row goes back to Stage RI's nowrap", "receipts-sheets",
           lambda: sub("receipts.html",
                       "line-height:1.45;overflow-wrap:anywhere;white-space:normal}",
                       "line-height:1.45;overflow-wrap:anywhere}"),
           "inside .inv-wrap")

    # ⚠️ AND the same mutation must break the line-box assertion, not only the scroll box.
    # Asserting the overflow alone would leave "does it actually wrap" untested at any
    # viewport where the sentence happens to fit.
    mutate("M11b the same nowrap is caught by the line-box check, not just the scroll box",
           "receipts-sheets",
           lambda: sub("receipts.html",
                       "line-height:1.45;overflow-wrap:anywhere;white-space:normal}",
                       "line-height:1.45;overflow-wrap:anywhere}"),
           "description row is 1 line")

    print()
    red = sum(1 for _, ok, _ in results if ok)
    print(f"{red} of {len(results)} mutations turned their gate RED")
    for name, ok, detail in results:
        if not ok:
            print(f"  ⚠️ USELESS ASSERTION OR USELESS MUTATION: {name} — {detail}")
    shutil.rmtree(BAK, ignore_errors=True)
    if red != len(results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
