"""
dd_draft_bozo_leg — check a proposed Bozo leg against the live board, return the exact
submission body, write nothing.

    python3 work/patch-draft-bozo-leg.py && (cd work && node assemble.mjs)

⚠️ WHY THIS TOOL AND NOT submit_bozo_leg. docs/bozo-write-access.md has the argument in
full. The short form: the MCP credential is a URL that mcp-block.js itself refuses to call
security, and a write through it can be the leg that calls placeAndDraw — which locks the
board and draws the lever permutation once, never redraws, and cannot be undone except by
a manager burning the whole week into history. Two-phase confirmation guards against the
model, not against a leaked URL, because both phases carry the same secret. So the half
that can ship safely today is the validation half, and this is it. It is also step one of
whichever confirmation contract Kap picks, so none of it is throwaway.

⚠️ IT CALLS validatePick, IT DOES NOT REIMPLEMENT IT. A second copy of the rules would
drift from the enforcer and start telling people a leg is fine that /bozo/pick then
rejects — or worse, the reverse. The tool is guards + the real validator + a body builder,
and a test asserts it stays that way.

⚠️ IT REFUSES THE SHARED CONNECTOR. Membership, the duplicate check and "do you already
have a leg in" are all questions about WHO is asking. On the legacy DAWG_PASS URL the
server cannot tell one caller from another, so the honest answer is a refusal with a
pointer at /connect.html rather than a guess.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "work" / "mcp-block.js"

TOOL = r'''  {
    name: "dd_draft_bozo_leg",
    description:
      "Check a proposed Bozo leg against the LIVE board and return the exact body /bozo/pick wants, " +
      "or the reason it would be rejected. ⚠️ READ-ONLY: this submits nothing, writes nothing and " +
      "changes nothing. The member still submits it themselves on bozo.html — that is deliberate, not a " +
      "limitation to work around. Runs the server's own validator, so a pass here is a pass there.",
    inputSchema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "nfl | cfb | nba | cbb | mlb | nhl" },
        eventId: { type: "string", description: "The game's id, from dd_scores" },
        game: { type: "string", description: "Human-readable matchup, e.g. \"BUF @ MIA\"" },
        mkt: { type: "string", description: "spread | ml | total | prop | other" },
        side: { type: "string", description: "Team abbreviation, or over / under" },
        line: { type: "number", description: "The number. Required for everything except ml." },
        price: { type: "number", description: "American odds, e.g. -180. Favourites only; the band is league-set." },
        label: { type: "string", description: "How the leg reads on the ticket, e.g. \"BUF -6.5\"" },
        prop: { type: "string", description: "Required when mkt is \"other\": what the bet actually is" },
        league: { type: "string", description: "League id (default: main)" },
      },
      required: ["sport", "eventId", "game", "mkt", "side", "price", "label"],
      additionalProperties: false,
    },
    async run(args, env, caller) {
      // ⚠️ REFUSALS FIRST, and identity before anything else. Membership, the duplicate
      // rule and "have you already got a leg in" are all questions about who is asking.
      if (!caller || caller.kind !== "user")
        return toolErr(
          "This one needs to know who you are, and the shared league connector cannot tell. " +
          "Every check below — are you in this league, do you already have a leg in, has someone " +
          "else taken this exact bet — depends on your name. Mint a personal URL at " +
          SITE + "/connect.html and it works.");
      const name = caller.name;

      const lid = validLeagueId(args.league || DEFAULT_LEAGUE) ? (args.league || DEFAULT_LEAGUE) : null;
      if (!lid) return toolErr("Bad league id.");
      let lg;
      try { lg = await loadLeague(env, lid); }
      catch (e) { return toolErr("Database unreachable: " + e.message); }
      if (!lg) return toolErr("No such league: " + lid);

      if (!isMember(lg, name))
        return toolErr("You are not in " + lid + ", so nothing can go on that board under your name.");

      const status = lg.status || "open";
      if (status !== "open")
        return toolText({
          accepted: false, reason: "board-closed",
          detail: "The ticket is placed and the board is locked — nothing can be added or changed for week " +
                  (lg.week || 1) + ". The lever hierarchy has already been drawn.",
          week: lg.week || 1, status,
        });

      const set = settingsOf(lg);
      const picks = lg.picks || {};
      const mine = picks[encodeURIComponent(name)] || picks[name] || null;
      if (mine && !set.allowEdit)
        return toolText({
          accepted: false, reason: "edits-locked",
          detail: "This league locks your leg the moment it lands, and yours is already in. " +
                  "No edit is possible, by league setting rather than by timing.",
          yourExistingLeg: { label: mine.label, price: mine.price, ts: mine.ts || null },
        });

      // The proposal, shaped the way /bozo/pick reads it.
      const p = {
        sport: String(args.sport || "").toLowerCase(),
        eventId: String(args.eventId || ""),
        game: String(args.game || "").slice(0, 80),
        mkt: String(args.mkt || "").toLowerCase(),
        side: String(args.side || "").slice(0, 40),
        line: args.mkt === "ml" ? 0 : Number(args.line),
        price: Math.round(Number(args.price)),
        label: String(args.label || "").slice(0, 90),
        prop: args.prop ? String(args.prop).slice(0, 80) : null,
      };

      // ⚠️ THE SERVER'S OWN VALIDATOR, not a copy of its rules. A second copy would drift
      // and start passing legs /bozo/pick rejects, which is worse than no check at all.
      const band = bandOf(lg);
      const err = validatePick(p, name, picks, band, set.allowDupes);
      if (err)
        return toolText({
          accepted: false, reason: "rejected-by-the-same-validator-the-server-runs",
          detail: err, band,
          note: "That is the literal string POST /bozo/pick would return. Fix it and ask again.",
        });

      // ⚠️ Say when submitting would END THE WEEK for everyone. The last leg locks the
      // board and draws the lever hierarchy, and there is no undo — the only route back to
      // open advances the week and discards this one. Whoever is about to press the button
      // should know that is what the button does this time.
      const size = memberNames(lg).length;
      const need = set.lockRule === "count" ? Math.min(set.lockCount || size, size || set.lockCount) : size;
      const already = Object.keys(picks).length;
      const wouldBeNth = mine ? already : already + 1;
      const wouldLock = need > 0 && wouldBeNth >= need;

      return toolText({
        accepted: true,
        league: lid, week: lg.week || 1, you: name,
        editingAnExistingLeg: !!mine,
        // ⚠️ Editing resets your clock. The server stamps a fresh ts, and ts is what
        // decides Last In — so an edit is not free even when it is allowed.
        editResetsYourClock: !!mine || undefined,
        submit: {
          how: "POST " + SITE.replace("https://datadawgs216.com", "https://toto.jkapcar4.workers.dev") +
               "/bozo/pick — or just press submit on " + SITE + "/bozo.html, which is the intended path.",
          body: { league: lid, pick: p },
        },
        willBeStoredAs: {
          ...p,
          dir: (p.side === "over" || p.side === "under") ? p.side : "over",
          priceSource: "self",
          ts: "set by the server when you actually submit, not now",
        },
        band,
        legsIn: already, legsNeeded: need,
        stillWaitingOn: memberNames(lg).filter(n => !Object.keys(picks).some(k => playerName(k) === n)),
        wouldLockTheBoard: wouldLock,
        warning: wouldLock
          ? "⚠️ THIS WOULD BE THE LAST LEG. Submitting it places the ticket, locks the board for all " +
            size + " and draws the lever hierarchy. That draw happens once and is never redone; there is " +
            "no undo short of a manager advancing the week, which discards it for everyone."
          : undefined,
        caveats: [
          "Nothing was submitted. This tool cannot submit — it reads the board and runs the validator.",
          "The price is whatever you typed. Nothing here checks it against a book, and it is recorded as self-reported.",
          "A pass here is a pass at this instant. Someone else can take your exact leg, or fill the board, before you press submit.",
        ],
      });
    },
  },
'''

ANCHOR = '''  {
    name: "dd_draft_board",
'''

s = SRC.read_text()
if "dd_draft_bozo_leg" in s:
    print("mcp-block.js: dd_draft_bozo_leg already present")
else:
    assert s.count(ANCHOR) == 1, "the dd_draft_board entry is not unique"
    s = s.replace(ANCHOR, TOOL + ANCHOR, 1)
    SRC.write_text(s)
    print("mcp-block.js: dd_draft_bozo_leg inserted before dd_draft_board")

# ---- prove the read-only invariant is untouched -------------------------------------
s = SRC.read_text()
noc = "\n".join(l for l in s.split("\n") if not l.strip().startswith("//"))
for pat, why in [("fbPut", "Firebase write helper"), ("fbPatch", "Firebase write helper"),
                 ("fbDelete", "Firebase write helper")]:
    assert pat not in noc, "the block now calls %s — the read-only invariant is broken" % why
assert ".put(" not in noc and ".delete(" not in noc, "the block now performs a KV write"
assert "validatePick(" in s, "the tool must call the server's validator, not its own copy"
assert s.count("dd_draft_bozo_leg") == 1
print("ok: still no Firebase write, no KV write, and the tool defers to validatePick")
