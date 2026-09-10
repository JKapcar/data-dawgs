"""
patch-mcp-honesty.py — say out loud that a personal MCP URL can WRITE.

Why this is a hand-patch and not a page rebuild
-----------------------------------------------
The Connect UI no longer lives on connect.html. connect.html is a redirect stub
(-> signon.html#connect) and the mint/rotate controls are the "Connect Your Dawg"
sheet inside signon.html, per the 8/7 rule that every identity workflow lives on
signon.html and nowhere else.

Both page stampers are stale and MUST NOT be run:
  * build_connect.py stamps connect.html out of strategy.html — running it
    resurrects the retired full page over the redirect stub.
  * build_signon.py stamps signon.html out of connect.html — its markers
    ('  <div class="lab-hd">', '  <footer>') no longer exist in the stub, so it
    cannot run at all, and if it could it would drop every patch-signon-*.py and
    patch-toto-surfaces.py mutation applied since the fold-in.

So this follows AGENTS.md rule 2 instead: a content-marker string replace with
`assert s.count(old) == 1`, which is how a drifted page gets caught.

The gap being closed: a member pasted their /mcp/u_<token> URL into a shared file
believing it was a read-only rankings key. It is not — it authenticates as them and
can commit a Bozo leg via dd_submit_bozo_leg and write SwoleDawg logs via sd_*.
Neither the page copy nor the "Capabilities snapshot" card said the words
"submit your Bozo leg". Now they do.

The blocks land TWICE on purpose — once in #signedOut and once in #pConnect —
because #sMe is hidden until sign-in, so a signed-out reader would otherwise never
see the warning at all. Class only, no ids: this markup exists twice in the DOM.

Run:  cd work && python3 patch-mcp-honesty.py
"""
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
PAGE = REPO / "signon.html"

s = PAGE.read_text(encoding="utf-8")

def once(hay, needle, what):
    n = hay.count(needle)
    assert n == 1, f"marker {what!r} appears {n} times in signon.html, expected 1"

# The copy is verbatim from the brief. Do not soften it: "submit your Bozo leg" is
# the phrase a member has to be able to find, and work/test-connect.mjs asserts it.
HONESTY = """
      <div class="honesty">
        <h3>Before you paste it anywhere</h3>
        <p><b>This URL is you.</b> Anything holding it reads as you and can submit your Bozo leg
        as you. Treat it like a password: never paste it into a file, screenshot, or app you
        share. If it leaks, rotate &mdash; the old URL dies immediately.</p>
      </div>
      <div class="honesty">
        <h3>Building something?</h3>
        <p>You do not need this URL for public data. Everything under
        <a href="/data/">datadawgs216.com/data/</a> is unauthenticated &mdash; start at
        <a href="/data/index.json">data/index.json</a>. The MCP URL is for chat agents, not for
        embedding in code.</p>
      </div>
"""

# ---- 1) signed-in: directly above the card that holds the mint/rotate controls ----
MINT_CARD = '      <div class="card"><h3>Give your AI a line into Data Dawgs</h3>'
once(s, MINT_CARD, "connect sheet mint card")
assert 'id="cMint"' in s and 'id="cRevoke"' in s, "lost the mint/rotate controls"
s = s.replace(MINT_CARD, HONESTY.strip("\n") + "\n" + MINT_CARD, 1)

# ---- 2) signed-out: same truth, before anyone has an account to mint against ----
SIGNED_OUT = """    <p class="lab-sub">One account for the Bozo board, the draft room, and your own AI's connection to the site.</p>
"""
once(s, SIGNED_OUT, "signed-out intro")
s = s.replace(SIGNED_OUT, SIGNED_OUT + "\n" + HONESTY.strip("\n").replace("\n      ", "\n    ") + "\n", 1)

assert s.count('class="honesty"') == 4, "expected two blocks in each of the two states"
assert s.count("submit your Bozo leg") == 2
assert s.count('href="/data/index.json"') >= 2

PAGE.write_text(s, encoding="utf-8")
n_blocks = s.count('class="honesty"')
print(f"signon.html  {len(s):,} bytes  ({n_blocks} honesty blocks)")
