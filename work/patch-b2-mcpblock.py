#!/usr/bin/env python3
"""
Commit B2, generated half — work/mcp-block.js.

Run from repo root AFTER patch-b2-uidkeys.py:
    python3 work/patch-b2-mcpblock.py && cd work && node assemble.mjs

⚠️ NEVER hand-edit dawg-bot-worker.js between the DD-MCP-BLOCK markers. This file is the
source; assemble.mjs strips and re-injects it, and proves the build is idempotent.

The MCP tools read the same picks and members maps the site does, so they need the same
change: render a leg's name from the leg (`who`), and resolve the caller to a member key
instead of guessing at `encodeURIComponent(name)`.
"""
import sys, io

TARGET = "work/mcp-block.js"
src = io.open(TARGET, encoding="utf8").read()
orig = src

def sub(old, new, label):
    """⚠️ THE APPLIED-CHECK IS `anchor gone`, NOT `replacement present`.
    Two different sites in this file get byte-identical replacement text. Guarding on
    `new in src` made the second one report "already applied" and silently skip -- a
    patch that lies about having run is worse than one that crashes."""
    global src
    if old not in src:
        if new in src:
            print("  = %s already applied" % label); return
        sys.exit("FAIL: anchor not found for %s" % label)
    n = src.count(old)
    if n != 1:
        sys.exit("FAIL: anchor matched %d times for %s" % (n, label))
    src = src.replace(old, new, 1)
    print("  + %s" % label)

# ---- dd_bozo_week: legs render from the leg, not from the key
sub('''        return {
          order: i + 1, player: playerName(k),
          you: me ? playerName(k) === me : undefined,''',
'''        return {
          // ⚠️ `who` is stamped on the leg at submission. Reading the name off the key
          // would print a bare uid; reading it off the members map would go blank for
          // anyone who has since left the league.
          order: i + 1, player: x.who || playerName(k),
          you: me ? (x.who || playerName(k)) === me : undefined,''',
    "dd_bozo_week — legs name the submitter")

sub('''        yourLegIn: me ? keys.some(k => playerName(k) === me) : null,
        stillWaitingOn: Object.keys(lg.members || {}).filter(n => !keys.some(k => playerName(k) === n)),''',
'''        yourLegIn: me ? keys.some(k => (picks[k].who || playerName(k)) === me) : null,
        stillWaitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)),''',
    "dd_bozo_week — waiting list maps keys to names")

# ---- royale surfaces
sub('''          alive: royaleRoster(lg).map(playerName),
          eliminated: Object.entries(royaleStatus(lg)).filter(([, s]) => !s.alive)
            .map(([k, s]) => ({ player: playerName(k), eliminatedWeek: s.eliminatedWeek })),''',
'''          alive: royaleRoster(lg).map(k => memberNameAt(lg, k)),
          eliminated: Object.entries(royaleStatus(lg)).filter(([, s]) => !s.alive)
            .map(([k, s]) => ({ player: memberNameAt(lg, k), eliminatedWeek: s.eliminatedWeek })),''',
    "royale — alive/eliminated read the member label")

sub('''          parachutes: Object.entries(royaleStatus(lg)).filter(([, s]) => s.hasParachute)
            .map(([k]) => playerName(k)),''',
'''          parachutes: Object.entries(royaleStatus(lg)).filter(([, s]) => s.hasParachute)
            .map(([k]) => memberNameAt(lg, k)),''',
    "royale — parachutes read the member label")

# ---- dd_draft_bozo_leg (propose) and dd_submit_bozo_leg (confirm)
# Both the propose tool and the status tool find "my leg" the same way, and both must
# change together -- a split here is how one surface starts reporting no leg while the
# other reports one, for the same person on the same board.
def sub_all(old, new, label, times):
    global src
    if old not in src:
        if new in src:
            print("  = %s already applied" % label); return
        sys.exit("FAIL: anchor not found for %s" % label)
    n = src.count(old)
    if n != times:
        sys.exit("FAIL: anchor matched %d times (expected %d) for %s" % (n, times, label))
    src = src.replace(old, new)
    print("  + %s (x%d)" % (label, times))

sub_all('''      const mine = picks[encodeURIComponent(name)] || picks[name] || null;''',
        '''      const mine = picks[memberKeyOf(lg, caller) || ""] || null;''',
        "propose + status — my leg is found by member key", 2)

sub('''        stillWaitingOn: memberNames(lg).filter(n => !Object.keys(picks).some(k => playerName(k) === n)),''',
'''        stillWaitingOn: memberKeys(lg).filter(k => !picks[k]).map(k => memberNameAt(lg, k)),''',
    "propose — waiting list maps keys to names")

sub('''        const picks = lg.picks || {};
        if (!set.allowEdit && (picks[encodeURIComponent(name)] || picks[name]))
          return toolText({ status: "edits-locked", detail: "This league locks your leg the moment it lands, and yours is already in." });
        if (set.format === "royale" && !royaleAlive(lg, name))
          return toolText({ status: "chopped", detail: "You're out this season — you fund the ticket, you don't have a leg on it." });
        const err = validatePick(pend.p, name, picks, bandOf(lg), set.format);''',
'''        const picks = lg.picks || {};
        // One resolution, reused by every check below and by the write itself, so an
        // MCP leg can never land under a different key than the site form would use.
        const mkey = memberKeyOf(lg, caller);
        if (!mkey)
          return toolText({ status: "not-a-member", detail: "You are not in this league." });
        if (!set.allowEdit && picks[mkey])
          return toolText({ status: "edits-locked", detail: "This league locks your leg the moment it lands, and yours is already in." });
        if (set.format === "royale" && !royaleAliveKey(lg, mkey))
          return toolText({ status: "chopped", detail: "You're out this season — you fund the ticket, you don't have a leg on it." });
        const err = validatePick(pend.p, name, picks, bandOf(lg), set.format, mkey);''',
    "confirm — one member-key resolution for every check")

sub('''        const out = await commitBozoLeg(env, lid, lg, name, pend.p, "mcp");''',
'''        const out = await commitBozoLeg(env, lid, lg, name, pend.p, "mcp", mkey);''',
    "confirm — the write uses the same key")



if src == orig:
    print("no change (already applied)")
else:
    io.open(TARGET, "w", encoding="utf8").write(src)
    print("wrote %s" % TARGET)
