#!/usr/bin/env python3
"""Accept only new NFL finals under Kap's 2026-09-04 rule.

All work is rebuilt from a fresh main checkout. A normal, non-force Git merge push
provides an atomic base check: if main moves, regenerate and validate from scratch.
There is no privileged pull_request execution and no receipt rewriting.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone

import nfl_data_backbone as b
import elo_538_classic as elo

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "automation/nfl-results"
FILES = ["data/nfl-schedule.json", "data/538-classic.json", "data/model-receipts.json",
         "data/receipts-inventory.json", "data/index.json"]
RESULT_FIELDS = {"status", "home_score", "away_score"}


def result_candidate(base, upstream, now):
    """Return a main-shaped schedule, accepted IDs, and review-only differences."""
    b.validate_schedule_envelope(base)
    b.validate_schedule_envelope(upstream)
    if base["data"]["season"] != upstream["data"]["season"]:
        raise b.ContractError("Results cannot change season")
    # A loader/source/license change is a policy change, even if games look identical.
    for key in ["loader", "loader_version", "loader_license", "source_repository",
                "source_url", "source_data_license"]:
        if base["provenance"][key] != upstream["provenance"][key]:
            raise b.ContractError("Results cannot change provenance " + key)
    by_id = {g["game_id"]: g for g in upstream["data"]["games"]}
    result = copy.deepcopy(base)
    accepted, review = [], []
    original_ids = {g["game_id"] for g in base["data"]["games"]}
    for gid in sorted(set(by_id) - original_ids):
        review.append(gid + ": new game")
    for game in result["data"]["games"]:
        other = by_id.get(game["game_id"])
        if other is None:
            review.append(game["game_id"] + ": removed game")
            continue
        if game == other:
            continue
        changed = {k for k in set(game) | set(other) if game.get(k) != other.get(k)}
        if set(game) != set(other) or not changed <= RESULT_FIELDS:
            review.append(game["game_id"] + ": structure changed")
            continue
        valid = (game["status"] == "scheduled" and game["home_score"] is None
                 and game["away_score"] is None and other["status"] == "final"
                 and all(type(other[k]) is int and other[k] >= 0 for k in ["home_score", "away_score"])
                 and b.parse_timestamp(game["kickoff_at"], "kickoff") < now)
        if not valid:
            review.append(game["game_id"] + ": result correction or invalid transition")
            continue
        game.update({key: other[key] for key in RESULT_FIELDS})
        accepted.append(game["game_id"])
    if accepted:
        for key in ["as_of", "built", "source"]:
            result[key] = upstream[key]
        for key in ["source_commit", "source_committed_at", "captured_at"]:
            result["provenance"][key] = upstream["provenance"][key]
        result["integrity"]["snapshot_id"] = b.sha256_id(result["data"]["games"])
        b.validate_schedule_envelope(result)
    return result, accepted, review


def verify_candidate(base, upstream, candidate, now):
    expected, ids, _ = result_candidate(base, upstream, now)
    if not ids:
        raise b.ContractError("No new final result; nothing is eligible for auto-merge")
    if candidate != expected:
        raise b.ContractError("Candidate differs from the exact permitted results projection")
    return ids


def check_pr(pr, repository, sha):
    if (pr["state"] != "open" or pr["draft"] or pr["base"]["ref"] != "main"
        or pr["base"]["repo"]["full_name"] != repository
        or pr["head"]["repo"]["full_name"] != repository
        or pr["head"]["ref"] != BRANCH or pr["head"]["sha"] != sha
        or pr["user"]["login"] != "github-actions[bot]"):
        raise b.ContractError("PR identity/head/base does not match trusted results automation")


def run(cwd, *args, check=True):
    p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise b.ContractError(f"{args[0]} failed ({p.returncode}):\n{p.stdout}")
    return p.stdout.strip() if check else p


def api(cwd, endpoint, method="GET", body=None):
    args = ["gh", "api", "--method", method, endpoint]
    if body is None:
        return json.loads(run(cwd, *args))
    # stdin carries JSON, never shell-interpolated text or a command substitution.
    p = subprocess.run(args + ["--input", "-"], input=json.dumps(body), cwd=cwd,
                       text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise b.ContractError(f"GitHub {method} {endpoint} failed: {p.stderr}")
    return json.loads(p.stdout) if p.stdout else {}


def regenerate(work, captured, inputs):
    run(work, "python3", "scripts/elo_538_classic.py", "refresh", "--captured-at", captured,
        "--official-games", str(inputs / "official.csv"), "--official-initial", str(inputs / "initial.csv"),
        "--history-games", str(inputs / "history.csv"))
    run(work, "node", "tools/build-data.js", "receipts-inventory.json")
    run(work, "node", "tools/data-manifest.js")


def accept_results(upstream_path):
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if repository != "JKapcar/data-dawgs" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise b.ContractError("Publication is only enabled in the trusted repository's Actions job")
    upstream = b.read_json(upstream_path)
    # Current source bytes are pinned and checked by the loader before this command.
    with tempfile.TemporaryDirectory(prefix="nfl-results-") as temp:
        temp = Path(temp)
        source_inputs = temp / "inputs"
        source_inputs.mkdir()
        for filename, url in [("official.csv", elo.OFFICIAL_GAMES_URL),
                              ("initial.csv", elo.OFFICIAL_INITIAL_URL),
                              ("history.csv", elo.HISTORY_URL_TEMPLATE.format(commit=upstream["provenance"]["source_commit"]))]:
            (source_inputs / filename).write_bytes(elo.normalize_csv_bytes(elo.download(url)))
        # Prove candidate finals correspond to the cited source commit, not arbitrary JSON.
        source_rows = b.canonicalize_source_rows(elo.csv_rows((source_inputs / "history.csv").read_bytes()), upstream["data"]["season"])
        if source_rows != upstream["data"]["games"]:
            raise b.ContractError("Upstream schedule does not equal its pinned source bytes")
        for attempt in range(3):
            run(ROOT, "git", "fetch", "origin", "main")
            base_sha = run(ROOT, "git", "rev-parse", "origin/main")
            work = temp / f"attempt-{attempt}"
            run(ROOT, "git", "worktree", "add", "--detach", str(work), base_sha)
            base = b.read_json(work / "data/nfl-schedule.json")
            now = datetime.now(timezone.utc)
            candidate, ids, review = result_candidate(base, upstream, now)
            print(json.dumps({"accepted_results": ids, "review_only": review, "base": base_sha}), flush=True)
            if not ids:
                print("No new eligible finals; no results PR or main commit.")
                return
            captured = now.isoformat().replace("+00:00", "Z")
            original_ledger = b.read_json(work / "data/model-receipts.json")
            b.write_json(work / "data/nfl-schedule.json", candidate)
            regenerate(work, captured, source_inputs)
            verify_candidate(base, upstream, b.read_json(work / "data/nfl-schedule.json"), now)
            b.assert_append_only(original_ledger["data"], b.read_json(work / "data/model-receipts.json")["data"])
            # Reproduce the generated tree from the same main, inputs, and timestamp.
            expected = {f: (work / f).read_bytes() for f in FILES}
            run(work, "git", "restore", "--", *FILES)
            b.write_json(work / "data/nfl-schedule.json", candidate)
            regenerate(work, captured, source_inputs)
            if any((work / f).read_bytes() != value for f, value in expected.items()):
                raise b.ContractError("Generated candidate is not reproducible byte-for-byte")
            changed = set(run(work, "git", "diff", "--name-only").splitlines())
            if not changed <= set(FILES):
                raise b.ContractError("Unexpected changed paths: " + repr(changed - set(FILES)))
            for cmd in [
                ["python3", "-m", "unittest", "tests.test_nfl_data_backbone", "tests.test_elo_538_classic", "tests.test_nfl_results_automation"],
                ["python3", "scripts/nfl_data_backbone.py", "validate"],
                ["python3", "scripts/elo_538_classic.py", "validate"],
                ["python3", "scripts/nfl_data_backbone.py", "verify-history", "--base-ref", base_sha],
                ["node", "tools/validate-data.js"],
            ]:
                output = run(work, *cmd)
                print(" ".join(cmd) + "\n" + output[-900:], flush=True)
            run(work, "git", "config", "user.name", "github-actions[bot]")
            run(work, "git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
            run(work, "git", "add", *FILES)
            run(work, "git", "commit", "-m", f"Accept {len(ids)} new NFL final results")
            head = run(work, "git", "rev-parse", "HEAD")
            remote = run(work, "git", "ls-remote", "origin", "refs/heads/" + BRANCH).split()
            lease = remote[0] if remote else ""
            run(work, "git", "push", f"--force-with-lease=refs/heads/{BRANCH}:{lease}", "origin", f"HEAD:refs/heads/{BRANCH}")
            prs = api(work, f"repos/{repository}/pulls?state=open&head=JKapcar:{BRANCH}&base=main")
            if len(prs) > 1:
                raise b.ContractError("Multiple open results PRs")
            if prs:
                pr = prs[0]
            else:
                pr = api(work, f"repos/{repository}/pulls", "POST", {
                    "head": BRANCH, "base": "main", "title": "Accept verified NFL final results",
                    "body": "Approved 2026-09-04 results-only rule. No schedule changes or receipt rewrites.\n\n"
                            + "\n".join("- " + gid for gid in ids) + "\n\nValidated base: " + base_sha,
                })
            pr = api(work, f"repos/{repository}/pulls/{pr['number']}")
            check_pr(pr, repository, head)
            api(work, f"repos/{repository}/statuses/{head}", "POST", {
                "state": "success", "context": "NFL results / verified",
                "description": "Exact result projection, deterministic rebuild, immutable history and tests passed",
                "target_url": f"https://github.com/{repository}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
            })
            run(work, "git", "fetch", "origin", "main")
            if run(work, "git", "rev-parse", "origin/main") != base_sha:
                print("Main advanced; rebuilding candidate and checks.", flush=True)
                continue
            # Merge ancestry closes the PR. No force/admin bypass: repository protections
            # apply to this push, and concurrent main writes reject it atomically.
            run(work, "git", "checkout", "--detach", base_sha)
            run(work, "git", "merge", "--no-ff", head, "-m", f"Merge verified NFL results PR #{pr['number']}")
            pushed = run(work, "git", "push", "origin", "HEAD:main", check=False)
            if pushed.returncode:
                print(pushed.stdout, flush=True)
                run(work, "git", "fetch", "origin", "main")
                if run(work, "git", "rev-parse", "origin/main") == base_sha:
                    raise b.ContractError("Main push was denied; required protections were not bypassed")
                continue
            print(f"Merged {len(ids)} finals via PR #{pr['number']}: {run(work, 'git', 'rev-parse', 'HEAD')}", flush=True)
            return
    raise b.ContractError("Main kept advancing; results not merged after three validated attempts")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, required=True)
    args = parser.parse_args()
    try:
        accept_results(args.upstream)
    finally:
        run(ROOT, "git", "worktree", "prune")
