"""
Tests for dd_draft_bozo_leg, added to work/test-mcp.mjs.

    python3 work/patch-test-draft-bozo-leg.py && node work/test-mcp.mjs

⚠️ THE SUITE HAD NO PER-USER CALLER UNTIL NOW. Every existing test hits /mcp/<DAWG_PASS>,
which resolves to {kind:"shared"} — anonymous. dd_draft_bozo_leg refuses that on purpose,
so testing anything past the first guard needs a real per-user token: BOZO_PEPPER in env,
a /users node carrying the token's HMAC, and a request to /mcp/u_<token>. That fixture is
worth having on its own — the identity branch of mcpAuth was previously untested.

⚠️ REFUSALS ARE TESTED BEFORE THE HAPPY PATH, in the order the tool checks them, because
that is the order in which a wrong answer does damage.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
T = ROOT / "work" / "test-mcp.mjs"
s = T.read_text()

if "dd_draft_bozo_leg" in s:
    print("test-mcp.mjs: already patched")
    raise SystemExit(0)

# ---- 1. the tool count ---------------------------------------------------------------
OLD = '  ok(t.length === 42, "forty-two tools listed in the staged Worker source");'
NEW = '  ok(t.length === 43, "forty-three tools listed in the staged Worker source");\n' \
      '  ok(t.some(x => x.name === "dd_draft_bozo_leg" && /READ-ONLY/.test(x.description)),\n' \
      '     "dd_draft_bozo_leg is listed and says in its own description that it writes nothing");'
assert s.count(OLD) == 1, "the tool-count assertion is not where it was"
s = s.replace(OLD, NEW, 1)

# ---- 2. a per-user identity fixture ---------------------------------------------------
ENV_OLD = 'const env = { DAWG_PASS: PASS, RL:'
ENV_NEW = '''/* ⚠️ A REAL PER-USER TOKEN. mcpAuth hashes the supplied token as hmac(BOZO_PEPPER,
   "mcp|" + token) and compares it against every /users row, so the fixture has to carry
   the genuine HMAC — faking the comparison would test nothing. */
const PEPPER = "test-pepper";
const USER_TOKEN = "u_thekid";
const hmacB64u = async (secret, msg) => {
  const te2 = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", te2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, te2.encode(msg));
  return Buffer.from(sig).toString("base64").replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
};
const USERS = {
  "Kap": { mcpToken: await hmacB64u(PEPPER, "mcp|u_kap") },
  "The%20Kid": { mcpToken: await hmacB64u(PEPPER, "mcp|" + USER_TOKEN) },
  "Outsider": { mcpToken: await hmacB64u(PEPPER, "mcp|u_outsider") },
};
const env = { DAWG_PASS: PASS, BOZO_PEPPER: PEPPER, RL:'''
assert s.count(ENV_OLD) == 1, "the env fixture is not where it was"
s = s.replace(ENV_OLD, ENV_NEW, 1)

# the fetch stub has to serve /users
FETCH_OLD = '  if (u.includes("/bozo/leagues/main/ledger")) return J(leagueRec.ledger || null);'
FETCH_NEW = '  if (u.startsWith(FB + "/users.json")) return J(USERS);\n' + FETCH_OLD
assert s.count(FETCH_OLD) == 1, "the ledger stub line is not where it was"
s = s.replace(FETCH_OLD, FETCH_NEW, 1)

# ---- 3. the tests ---------------------------------------------------------------------
TESTS = r'''
/* ------------------------ dd_draft_bozo_leg ------------------------
   ⚠️ It reads the board and runs the server's validator. It submits nothing. The tests
   below go through the refusals in the order the tool checks them, then the happy path. */
const asUser = (name, args, id = 1) =>
  req(call("dd_draft_bozo_leg", args, id), { path: "/mcp/" + name });
const LEG = { sport: "nfl", eventId: "403", game: "SF @ SEA", mkt: "spread", side: "SF", line: -6.5, price: -180, label: "SF -6.5" };

{
  // identity first: the shared connector cannot answer "are you in this league"
  const j = await (await req(call("dd_draft_bozo_leg", LEG))).json();
  ok(j.result.isError === true, "shared connector: dd_draft_bozo_leg refuses");
  ok(/connect\.html/.test(j.result.content[0].text), "…and points at where to mint a personal URL");
}
{
  const j = await (await asUser("u_outsider", LEG)).json();
  ok(j.result.isError === true && /not in main/.test(j.result.content[0].text),
     "a member of nothing is refused before any leg is inspected");
}
{
  leagueRec.status = "placed";
  const d = text(await (await asUser(USER_TOKEN, LEG)).json());
  leagueRec.status = "open";
  ok(d.accepted === false && d.reason === "board-closed", "board locked: refused, with the reason named");
  ok(/lever hierarchy has already been drawn/.test(d.detail), "…and says the draw already happened");
}
{
  leagueRec.allowEdit = false;
  const d = text(await (await asUser("u_kap", LEG)).json());
  leagueRec.allowEdit = undefined;
  ok(d.accepted === false && d.reason === "edits-locked" && d.yourExistingLeg.label === "Over 47.5",
     "a league that locks legs on arrival refuses an edit, and shows what is already in");
}
{
  const d = text(await (await asUser(USER_TOKEN, { ...LEG, price: 150 })).json());
  ok(d.accepted === false && /outside the/.test(d.detail),
     "a price outside the band is refused in the server's own words");
  ok(d.band && d.band.ceil !== undefined, "…and the band is returned so the caller can fix it");
}
{
  // Jeff already has CLE -3.5 on the board and this league does not allow duplicates
  const d = text(await (await asUser(USER_TOKEN, { ...LEG, label: "CLE -3.5" })).json());
  ok(d.accepted === false && /Jeff already has that exact leg/.test(d.detail),
     "a duplicate label is refused and names whose leg it clashes with");
}
{
  const d = text(await (await asUser(USER_TOKEN, { ...LEG, mkt: "other", prop: "" })).json());
  ok(d.accepted === false && /needs to say what it actually is/.test(d.detail),
     "an \"other\" leg with no description is refused");
}
{
  const d = text(await (await asUser(USER_TOKEN, LEG)).json());
  ok(d.accepted === true, "a legal leg is accepted");
  ok(d.you === "The Kid", "the caller is resolved from the per-user token, decoded");
  ok(d.submit.body.league === "main" && d.submit.body.pick.label === "SF -6.5" &&
     d.submit.body.pick.line === -6.5 && d.submit.body.pick.price === -180,
     "the returned body is the exact shape /bozo/pick wants");
  ok(d.willBeStoredAs.priceSource === "self" && /set by the server/.test(String(d.willBeStoredAs.ts)),
     "what the server will store is shown, including that it stamps the time and the price is self-reported");
  ok(d.editingAnExistingLeg === false, "The Kid has no leg in yet");
  // ⚠️ three members, two legs in — The Kid's would be the last one
  ok(d.wouldLockTheBoard === true && /LAST LEG/.test(d.warning) && /never redone/.test(d.warning),
     "it says plainly when submitting would lock the board and draw the hierarchy for everyone");
  ok(Array.isArray(d.stillWaitingOn) && d.stillWaitingOn.length === 1 && d.stillWaitingOn[0] === "The Kid",
     "stillWaitingOn is who has no leg in");
  ok(d.caveats.some(c => /Nothing was submitted/.test(c)), "the payload says nothing was submitted");
  ok(d.caveats.some(c => /self-reported/.test(c)), "…and that the price is unchecked");
}
{
  const d = text(await (await asUser("u_kap", { ...LEG, label: "SF -6.5 (edit)" })).json());
  ok(d.accepted === true && d.editingAnExistingLeg === true && d.editResetsYourClock === true,
     "an edit is allowed by default and says it resets the clock");
  ok(d.wouldLockTheBoard === false,
     "replacing a leg that is already counted does not become the locking leg");
}
{
  // the tool must defer to the enforcer, not carry its own copy of the rules
  const src = readFileSync(resolve(WORK, "mcp-block.js"), "utf8");
  const tool = src.slice(src.indexOf('name: "dd_draft_bozo_leg"'), src.indexOf('name: "dd_draft_board"'));
  ok(/validatePick\(/.test(tool), "dd_draft_bozo_leg calls the server's validatePick");
  ok(!/outside the .* band/.test(tool) && !/Unknown market/.test(tool),
     "…and does not carry its own copy of the rules to drift from");
}
'''

ANCHOR = "\nconsole.log(`\\n${pass} passed, ${fail} failed`);"
assert s.count(ANCHOR) == 1, "the summary line is not where it was"
# put the tests before the source-level assertions block that precedes the summary
SRC_ANCHOR = '\nok(!/fbPut|fbPatch|fbDelete/.test(noComments), "block calls NO Firebase write helper");'
assert s.count(SRC_ANCHOR) == 1, "the read-only source assertions are not where they were"
s = s.replace(SRC_ANCHOR, TESTS + SRC_ANCHOR, 1)

T.write_text(s)
print("test-mcp.mjs: per-user fixture + 20 dd_draft_bozo_leg assertions added")
