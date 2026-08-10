#!/usr/bin/env python3
"""Stage WC mutation proof: break the Worker batch one way at a time.

Run from the REPO ROOT, detached:

    nohup python3 work/wc_mutations.py > /tmp/wc.log 2>&1 &

⚠️ A foreground call is killed at two minutes, and a harness killed mid-mutation leaves a
mutated file on disk which the NEXT run snapshots as its baseline. Never run it in the
foreground.

⚠️ SOME ASSERTIONS IN THIS STAGE WERE CHANGED OR REPLACED RATHER THAN ADDED, and changing
an expectation is the cheapest way to stop a suite failing. Each one is proved here:

  * work/test-mcp.mjs's "purely additive: every non-blank old line survives" READ THE SAME
    FILE TWICE and was true for every possible input. It is replaced by "the assembled
    block contains work/mcp-block.js verbatim". M7 proves the replacement bites by editing
    the registry without reassembling — the exact drift that let mcp-block.js say
    "(Pup / Dawgs / The DawgHouse)" for two stages while the Worker still said
    "(Labs / Dawgs / The Pound)" under 343 green assertions.
  * work/test-machine-surfaces.mjs's CFB count check was `{ 16: /sixteen|\\b16\\b/i }`
    behind `if (cfbNumWords[cfbLive.length])`, so it ran only while the count was 16 and
    silently vanished when this stage made it 14 — 31 passed became 30 passed with zero
    failures. M6 proves the rewritten one bites.
  * every tool-count assertion moved 43 -> 41. M5 proves those still bite by putting one
    of the removed tools back.

⚠️ A MUTATION THAT LEAVES ITS GATE GREEN IS INFORMATION ABOUT THE TEST, not about the code.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BLOCK = ROOT / "work/mcp-block.js"
WORKER = ROOT / "dawg-bot-worker.js"
LLMS = ROOT / "llms.txt"
BUILDER = ROOT / "tools/build-data.js"
SURFACES = ROOT / "data/surfaces.json"
POOLED = ROOT / "data/pound-tools.json"
INDEX = ROOT / "data/index.json"

TOUCHED = [BLOCK, WORKER, LLMS, BUILDER, SURFACES, POOLED, INDEX]

GATES = {
    # ⚠️ these two are named RELATIVE TO work/, because that is where CWD puts them.
    "mcp": ["node", "test-mcp.mjs"],
    "identity": ["node", "test-identity.mjs"],
    "machine-surfaces": ["node", "work/test-machine-surfaces.mjs"],
    "pound-contracts": ["node", "work/test-pound-contracts.js"],
    "build-data": ["node", "tools/build-data.js"],
}
# ⚠️ test-mcp.mjs and test-identity.mjs resolve paths relative to work/, and most of the
# rest relative to the repo root. Running one from the wrong directory dies with ENOENT,
# which reads as a missing file rather than a wrong cwd — and, worse, as a RED gate, which
# would make every mutation look proved.
CWD = {"mcp": ROOT / "work", "identity": ROOT / "work"}


def run(gate):
    r = subprocess.run(GATES[gate], cwd=CWD.get(gate, ROOT), capture_output=True, text=True, timeout=900)
    return r.returncode == 0, (r.stdout + r.stderr)


def snapshot():
    return {p: p.read_text(encoding="utf-8") for p in TOUCHED}


def restore(snap):
    for p, t in snap.items():
        if p.read_text(encoding="utf-8") != t:
            p.write_text(t, encoding="utf-8")


def sub(path, old, new, count=1):
    t = path.read_text(encoding="utf-8")
    if t.count(old) < count:
        raise SystemExit(f"ANCHOR NOT FOUND in {path.name}: {old[:80]!r}")
    path.write_text(t.replace(old, new, count), encoding="utf-8")


def assemble():
    r = subprocess.run(["node", "assemble.mjs"], cwd=ROOT / "work", capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise SystemExit("assemble.mjs failed during a mutation:\n" + r.stdout + r.stderr)


def rebuild():
    subprocess.run(["node", "tools/build-data.js"], cwd=ROOT, capture_output=True, text=True,
                   timeout=900, env={**__import__("os").environ, "DD_BUILD_DATE": "2026-08-10"})


# ---------------------------------------------------------------------------
# Each mutation: (label, gate it must turn RED, a function that applies it, whether the
# Worker must be reassembled, whether data/ must be rebuilt)

def m1():
    """A scope-invalid parameter is IGNORED instead of refused — the dishonest failure this
    whole stage is designed around. The caller gets a plausible answer to a question it did
    not ask, with a 200 and no warning."""
    sub(BLOCK,
        '  if (extra.length)\n'
        '    throw new Error("unsupported field" + (extra.length > 1 ? "s" : "") + " for scope " + scope + ": " + extra.join(", ") +\n'
        '      " (supported: " + allowed.join(", ") + ")");',
        '  // MUTATION: silently drop what the scope does not support\n'
        '  for (const k of extra) delete args[k];')


def m2():
    """The conditional team requirement is dropped, so scope=team-games with no team falls
    through to the parser's generic "team must be a non-empty name or slug" — the error that
    tells a caller nothing about which scope needs it."""
    sub(BLOCK,
        '  if (scope !== "latest-per-team" && args.team === undefined)\n'
        '    throw new Error("team is required when scope is " + scope + "; use scope latest-per-team for bounded cross-team discovery");',
        '  // MUTATION: let the delegated parser produce a scope-blind message')


def m3():
    """The per-scope limit ceiling becomes the union maximum, so team-periods quietly accepts
    26 rows. This is the bound the schema advertises as 50 and the parser has to keep at 25;
    raising it silently is a payload change disguised as a refactor."""
    sub(BLOCK,
        '  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 25)\n'
        '    throw new Error("limit must be a whole number from 1 through 25");\n'
        '  return out;\n'
        '}\n'
        '\n'
        'function mcpCfbTeamPeriodMatch(teams, input) {',
        '  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 50)\n'
        '    throw new Error("limit must be a whole number from 1 through 50");\n'
        '  return out;\n'
        '}\n'
        '\n'
        'function mcpCfbTeamPeriodMatch(teams, input) {')


def m4():
    """The scope argument is echoed at TOP level, where `scope` already means the data
    surface's published coverage string. The argument would overwrite an honesty claim with
    a routing detail, and both fields would read as if they meant the same thing."""
    # ⚠️ the lifted run bodies sit at module level, so these are at FOUR spaces, not the
    # eight they had inside the tool object. Anchoring on the old indentation is how the
    # first run of this harness aborted.
    sub(BLOCK,
        '    query: {\n      scope: input.scope,\n      team: team.team,\n      opponent:',
        '    query: {\n      team: team.team,\n      opponent:')
    sub(BLOCK,
        '    team,\n    season: envelope.data.season,\n    scope: envelope.data.scope,\n'
        '    response_shape: "team-game-rows",',
        '    team,\n    season: envelope.data.season,\n    scope: input.scope,\n'
        '    response_shape: "team-game-rows",')


def m5():
    """One retired tool is put back into the registry. Every count that moved from 43 to 41
    has to notice — the wire list, the source declaration count, the coverage map and the
    Pound surface."""
    sub(BLOCK,
        '  {\n    name: "dd_find_cfb_team_periods",',
        '  {\n    name: "dd_find_cfb_latest_games",\n    title: "CFB latest games",\n'
        '    catalog: "full",\n    readOnlyHint: true,\n'
        '    description: "MUTATION: a tool the consolidation removed, put back.",\n'
        '    inputSchema: { type: "object", properties: {}, additionalProperties: false },\n'
        '    async run(args) {\n      return mcpCfbTeamGamesScoped({ scope: "latest-per-team" });\n    },\n'
        '  },\n  {\n    name: "dd_find_cfb_team_periods",')


def m6():
    """llms.txt goes back to the stale spelled-out CFB count. This is the exact drift the old
    conditional check could not see, because it only ran when the count was already 16."""
    sub(LLMS, "Fourteen production CFB tools", "Sixteen production CFB tools")


def m7():
    """The registry is edited and the Worker is NOT reassembled — a stale committed Worker.
    This is the drift that shipped undetected for two stages: mcp-block.js said
    "(Pup / Dawgs / The DawgHouse)" while the Worker still said "(Labs / Dawgs / The Pound)".
    The assertion that should have caught it read the same file twice."""
    sub(BLOCK,
        '"index.html": "Home — what Data Dawgs is and the working-dawg taxonomy (Pup / Dawgs / The DawgHouse).",',
        '"index.html": "Home — MUTATION: the registry moved and the Worker did not.",')


def m8():
    """The isNew guard comes off authInvite's entitlement write. Re-inviting a paying member
    — which is ordinary, because a lost join link gets re-minted — silently sets them back to
    free. A 200, no error, and a billing bug nobody sees."""
    sub(WORKER,
        '      ...(isNew ? { entitlement: freeEntitlement() } : {}),',
        '      entitlement: freeEntitlement(),   // MUTATION: unconditional')


def m9():
    """Signup reads the entitlement out of the REQUEST BODY. A stranger grants themselves a
    paid plan by typing it into the signup form."""
    sub(WORKER,
        'apps: {}, entitlement: freeEntitlement() });',
        'apps: {}, entitlement: (body && body.entitlement) || freeEntitlement() });')


def m10():
    """entitlementOf stops validating and passes the stored plan through, so a garbled or
    hand-edited record reads as paid instead of failing closed."""
    sub(WORKER,
        '    plan: ENTITLEMENT_PLANS.includes(e.plan) ? e.plan : "free",\n'
        '    status: ENTITLEMENT_STATUSES.includes(e.status) ? e.status : "none",',
        '    plan: e.plan || "free",   // MUTATION: no vocabulary check\n'
        '    status: e.status || "none",')


def m11():
    """The backfill moves into loadUsers, which is the funnel mcpAuth uses — so a read-only
    MCP tool now triggers a Firebase write on its first call, and "every tool is read-only"
    needs an asterisk it does not have."""
    sub(WORKER,
        '  if (users && Object.keys(users).length) return users;',
        '  if (users && Object.keys(users).length) {\n'
        '    const fix = {};   // MUTATION: backfill on the MCP path\n'
        '    for (const [key, u] of Object.entries(users))\n'
        '      if (!u || !u.entitlement) { fix[key + "/entitlement"] = freeEntitlement(); if (u) u.entitlement = freeEntitlement(); }\n'
        '    if (Object.keys(fix).length) { try { await fbPatch(env, "/users", fix); } catch (e) {} }\n'
        '    return users;\n'
        '  }')


def m12():
    """The backfill stops skipping records that already have the field, so every sign-on page
    load rewrites every account. Write amplification that looks like nothing."""
    sub(WORKER,
        '    if (user && typeof user === "object" && user.entitlement && typeof user.entitlement === "object") continue;',
        '    // MUTATION: rewrite it every time')


def m13():
    """An anonymous shared connection is handed the free default instead of null, inviting a
    model to describe somebody's plan over a connection that cannot identify anybody."""
    sub(BLOCK,
        '        // ⚠️ NULL, NOT THE FREE DEFAULT. A shared connection is not an account, so it has\n'
        '        // no entitlement to report. Handing back a free-looking one would invite a model to\n'
        '        // describe somebody\'s plan from a connection that cannot identify anybody.\n'
        '        entitlement: null,',
        '        entitlement: { plan: "free", status: "none", period_end: null },   // MUTATION')


MUTATIONS = [
    ("M1  scope-invalid parameter ignored instead of refused", "mcp", m1, True, False),
    ("M2  conditional team requirement dropped", "mcp", m2, True, False),
    ("M3  team-periods limit ceiling raised to the union maximum", "mcp", m3, True, False),
    ("M4  scope argument overwrites the surface's coverage string", "mcp", m4, True, False),
    ("M5  a retired tool put back in the registry", "mcp", m5, True, False),
    ("M5b the same, graded by the coverage map", "pound-contracts", m5, True, True),
    ("M6  llms.txt back to the stale spelled-out CFB count", "machine-surfaces", m6, False, False),
    ("M7  registry edited, Worker NOT reassembled", "mcp", m7, False, False),
    ("M8  isNew guard removed: a re-invite downgrades a paying member", "identity", m8, False, False),
    ("M9  signup reads the entitlement out of the request body", "identity", m9, False, False),
    ("M10 entitlementOf stops failing closed on a garbled record", "identity", m10, False, False),
    ("M11 backfill moved into loadUsers, onto the MCP read path", "identity", m11, False, False),
    ("M12 backfill rewrites every account on every roster read", "identity", m12, False, False),
    ("M13 anonymous connection handed a free-looking entitlement", "identity", m13, True, False),
]


def main():
    snap = snapshot()
    print("baselining every gate this harness grades")
    for gate in ["mcp", "identity", "machine-surfaces", "pound-contracts"]:
        good, out = run(gate)
        print(f"  baseline {gate:18s} {'GREEN' if good else 'RED'}")
        if not good:
            print(out[-2500:])
            raise SystemExit("ABORT: a gate is red BEFORE any mutation. Nothing below would mean anything.")

    passed = failed = 0
    for label, gate, fn, needs_assemble, needs_rebuild in MUTATIONS:
        restore(snap)
        try:
            fn()
            if needs_assemble:
                assemble()
            if needs_rebuild:
                rebuild()
            good, out = run(gate)
        finally:
            pass
        if good:
            failed += 1
            print(f"  ✗ {label}\n      {gate} stayed GREEN — the assertion does not bite")
        else:
            passed += 1
            first = next((l for l in out.splitlines() if "FAIL" in l or "AssertionError" in l or "not ok" in l), "")
            print(f"  ✓ {label}\n      {gate} went RED  {first.strip()[:130]}")
    restore(snap)
    if needs_assemble_any := any(m[3] for m in MUTATIONS):
        assemble()
    rebuild()

    print(f"\n{passed} mutations caught, {failed} escaped")
    print("verifying the tree is back to its pre-mutation state")
    dirty = [p.name for p, t in snap.items() if p.read_text(encoding="utf-8") != t]
    print("  clean" if not dirty else f"  ⚠️ STILL MUTATED: {dirty}")
    for gate in ["mcp", "identity", "machine-surfaces", "pound-contracts"]:
        good, _ = run(gate)
        print(f"  restored {gate:18s} {'GREEN' if good else 'RED'}")
        if not good:
            failed += 1
    sys.exit(1 if failed or dirty else 0)


if __name__ == "__main__":
    main()
