"""Exercise the real rebase/amend/push script against a private temporary Git remote.
No GitHub writes. Uses actual repository validators, manifest and SW stamper.
"""
import json
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

def run(cwd, *args):
    p = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        raise RuntimeError(p.stdout)
    return p.stdout

with tempfile.TemporaryDirectory(prefix="survivor-publish-") as temp:
    t = pathlib.Path(temp)
    run(ROOT, "git", "clone", "--bare", "--shared", str(ROOT), str(t / "remote.git"))
    for name in ["automation", "other"]:
        run(t, "git", "clone", "--shared", str(t / "remote.git"), name)
        run(t / name, "git", "config", "user.name", "Local audit fixture")
        run(t / name, "git", "config", "user.email", "fixture@example.invalid")
    a, b = t / "automation", t / "other"
    # Different HTML edits race on the derived sw.js version, exactly the real hazard.
    for directory, page, marker in [(a, "nfelo.html", "automation-fixture"), (b, "connect.html", "concurrent-fixture")]:
        p = directory / page
        p.write_text(p.read_text() + "\n<!-- " + marker + " -->\n")
        run(directory, "python3", "work/stamp-sw-version.py")
        run(directory, "node", "tools/data-manifest.js")
        run(directory, "git", "add", page, "sw.js", "data/index.json")
        run(directory, "git", "commit", "-m", marker)
    run(b, "git", "push", "origin", "HEAD:main")
    shutil.copyfile(ROOT / "work/publish-survivor-pipeline.sh", a / "work/publish-survivor-pipeline.sh")
    log = run(a, "bash", "work/publish-survivor-pipeline.sh")
    assert "CONFLICT" in log and "sw.js" in log, log
    assert "concurrent-fixture" in (a / "connect.html").read_text()
    assert "automation-fixture" in (a / "nfelo.html").read_text()
    assert (a / "data/survivor-receipts.json").read_bytes() == (ROOT / "data/survivor-receipts.json").read_bytes()
    assert run(a, "git", "rev-parse", "HEAD") == run(a, "git", "rev-parse", "origin/main")
    assert not run(a, "git", "diff", "--name-only").strip()
    print("PASS: forced sw.js rebase conflict; regenerated, amended, validated, pushed; both writers preserved; ledger unchanged")
    print("\n".join(line for line in log.splitlines() if any(x in line for x in ["CONFLICT", "VERSION", "Published commit", "all checks passed"])))
