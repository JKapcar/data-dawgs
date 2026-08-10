"""
Stage WC-B, part two — work/test-identity.mjs proves the entitlement field.

Five properties, four of them behavioural against the assembled Worker:
 1. an untouched account reads free / none / null, and a MALFORMED one reads the same
    (it fails closed — a garbled record must never read as paid);
 2. signup writes the default, and a signup body CARRYING an entitlement cannot set one;
 3. /auth/roster backfills accounts that predate the field, in the same single PATCH the
    invite reconciliation already uses;
 4. ⚠️ re-inviting an EXISTING member does not overwrite their entitlement, while inviting
    a NEW person does write the default. authInvite is a PATCH and re-invites are ordinary,
    so an unguarded write there would silently downgrade a paying member to free with no
    error anywhere. This is the assertion the guard exists for;
 5. no MCP path writes, and dd_whoami reports the caller's own entitlement while an
    anonymous shared connection is told it has none rather than handed a free-looking one.

Run from the repo root, after the Worker has been reassembled.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUITE = ROOT / "work" / "test-identity.mjs"
src = SUITE.read_text(encoding="utf-8")


def apply(text, edits, label):
    for old, new, *rest in edits:
        n = rest[0] if rest else 1
        found = text.count(old)
        if found != n:
            raise SystemExit(f"ABORT {label}: expected {n}, found {found}: {old[:110]!r}")
        text = text.replace(old, new)
    return text


# 1. The bundle has to expose the roster helpers this stage touches.
src = apply(src, [
    ('export { handleMcp, MCP_TOOLS, mcpAuth, mcpTokenHash, newMcpToken, emailToName, '
     'bozoSignup, bozoLogin, readSession };',
     'export { handleMcp, MCP_TOOLS, mcpAuth, mcpTokenHash, newMcpToken, emailToName, '
     'bozoSignup, bozoLogin, readSession, loadUsers, bozoRoster, authInvite, makeSession, '
     'entitlementOf, freeEntitlement };'),
], "bundle exports")

# 2. The fake network has to apply a DEEP-PATH patch to /users, which is the shape the
#    backfill uses: PATCH /users.json with {"Kap/entitlement": {...}}. Without this the
#    write appears to succeed and changes nothing, and the backfill assertion would be
#    testing the fake rather than the Worker.
src = apply(src, [
    ("""    let m = url.match(/\\/users\\/([^./]+)\\.json/);
    if (m && method === "PATCH") {""",
     """    /* ⚠️ A DEEP-PATH PATCH ON THE COLLECTION, not on one record: fbPatch(env, "/users",
       { "Kap/entitlement": {...} }). Both the invite reconciliation and the entitlement
       backfill write this shape. Without applying it here the write would look like a 200
       and change nothing, and every assertion about the backfill would be green against a
       Worker that had done nothing at all. */
    if (url.startsWith(DB + "/users.json") && method === "PATCH") {
      for (const [p, v] of Object.entries(JSON.parse(opts.body))) {
        const parts = p.split("/");
        const key = parts.shift();
        if (!parts.length) { USERS[key] = { ...(USERS[key] || {}), ...v }; continue; }
        let node = (USERS[key] = USERS[key] || {});
        while (parts.length > 1) node = (node[parts[0]] = node[parts.shift()] || {});
        node[parts[0]] = v;
      }
      return new Response("{}");
    }
    let m = url.match(/\\/users\\/([^./]+)\\.json/);
    if (m && method === "PATCH") {"""),
], "deep-path patch in the fake network")

# 3. The assertions. Appended where the fake network with PUT/PATCH is already installed.
TESTS = '''
/* ======================= the entitlement field on /users ===================== */
/* ⚠️ WHY THE FIELD EXISTS BEFORE ANYONE CAN PAY. An ABSENT entitlement is ambiguous:
   nothing distinguishes a free account from one written before the field existed. Adding it
   after money has changed hands means migrating live accounts. So it goes in now, while
   every account holds the same value and a mistake costs nothing.
   plan: free|member · status: none|active|past_due|canceled|grace · period_end: ms|null */
console.log("\\nentitlement — the read side");
{
  const free = W.freeEntitlement();
  ok("the free default is plan free, status none, no period end",
     free.plan === "free" && free.status === "none" && free.period_end === null, JSON.stringify(free));
  ok("status is NOT a boolean — a lapse needs a state that is neither on nor off",
     typeof free.status === "string");

  const absent = W.entitlementOf({ email: "x@example.com" });
  ok("an account with no entitlement field reads as the free default",
     absent.plan === "free" && absent.status === "none" && absent.period_end === null, JSON.stringify(absent));
  ok("a missing user reads as the free default rather than throwing",
     W.entitlementOf(undefined).plan === "free" && W.entitlementOf(null).plan === "free");

  const real = W.entitlementOf({ entitlement: { plan: "member", status: "active", period_end: 1788000000000 } });
  ok("a real member record passes through untouched",
     real.plan === "member" && real.status === "active" && real.period_end === 1788000000000, JSON.stringify(real));
  const grace = W.entitlementOf({ entitlement: { plan: "member", status: "past_due", period_end: 1788000000000 } });
  ok("past_due survives as its own state — a failed card is not the same as cancelled",
     grace.plan === "member" && grace.status === "past_due");

  /* ⚠️ IT FAILS CLOSED. A record that cannot be understood must not read as a customer,
     because the alternative is a garbled write granting paid access. */
  const junkPlan = W.entitlementOf({ entitlement: { plan: "administrator", status: "active", period_end: 1 } });
  ok("an unrecognised plan degrades to free instead of being passed through",
     junkPlan.plan === "free" && junkPlan.status === "active", JSON.stringify(junkPlan));
  const junkStatus = W.entitlementOf({ entitlement: { plan: "member", status: "definitely-paid" } });
  ok("an unrecognised status degrades to none", junkStatus.status === "none", JSON.stringify(junkStatus));
  const junkEnd = W.entitlementOf({ entitlement: { plan: "member", status: "active", period_end: "soon" } });
  ok("a non-numeric period_end degrades to null, so no comparison can silently succeed",
     junkEnd.period_end === null, JSON.stringify(junkEnd));
  ok("a non-object entitlement reads as the free default",
     W.entitlementOf({ entitlement: "member" }).plan === "free" &&
     W.entitlementOf({ entitlement: true }).plan === "free");
  ok("the plan vocabulary is NOT the tier vocabulary — pup and working_dawg grade tools, not people",
     !/pup|working_dawg|dawghouse/i.test(JSON.stringify([free, real])));
}

console.log("\\nentitlement — signup writes it, the request body cannot");
{
  const r = await W.bozoSignup(signupReq({ name: "Enty", email: "enty@example.com", password: "longenough1" }), ENV, CORS);
  ok("a new signup succeeds", r.status === 200, String(r.status));
  const e = USERS.Enty && USERS.Enty.entitlement;
  ok("…and the account is created carrying the free default",
     !!e && e.plan === "free" && e.status === "none" && e.period_end === null, JSON.stringify(e));

  /* ⚠️ THE WHOLE POINT OF SERVER-SIDE CONSTRUCTION. Entitlement updates will come from the
     Stripe webhook and from nowhere else. This proves the client cannot pre-empt that, and
     it is provable NOW precisely because the webhook does not exist yet. */
  const forged = await W.bozoSignup(signupReq({
    name: "Forger", email: "forger@example.com", password: "longenough1",
    entitlement: { plan: "member", status: "active", period_end: 9999999999999 },
  }), ENV, CORS);
  ok("a signup carrying an entitlement in its body still succeeds", forged.status === 200, String(forged.status));
  const f = USERS.Forger && USERS.Forger.entitlement;
  ok("…and the account it created is FREE — the body was not read",
     !!f && f.plan === "free" && f.status === "none" && f.period_end === null, JSON.stringify(f));
  ok("no request-body key named entitlement is read anywhere in the Worker",
     !/body\\s*(\\.|\\[["']?)entitlement/.test(SRC) && !/\\bentitlement\\b[^\\n]*=\\s*body/.test(SRC));
}

console.log("\\nentitlement — the backfill for accounts that predate the field");
{
  /* Mo has never had one. So does a record written before today. */
  delete USERS.Mo.entitlement;
  USERS.Legacy = { email: "legacy@example.com", src: "seed" };
  USERS.Paid = { email: "paid@example.com", entitlement: { plan: "member", status: "active", period_end: 1788000000000 } };
  const before = WRITES.length;
  const res = await W.bozoRoster(ENV, CORS);
  ok("the roster route still answers", res.status === 200, String(res.status));
  ok("an account written before the field now carries it",
     !!USERS.Legacy.entitlement && USERS.Legacy.entitlement.plan === "free", JSON.stringify(USERS.Legacy));
  ok("…and so does one that only ever had a token", !!USERS.Mo.entitlement);
  ok("⚠️ an existing PAID entitlement is not touched by the backfill",
     USERS.Paid.entitlement.plan === "member" && USERS.Paid.entitlement.status === "active",
     JSON.stringify(USERS.Paid.entitlement));
  const writes = WRITES.slice(before).filter(w => w.startsWith("PATCH /users"));
  ok("the backfill rides ONE patch, not one per account",
     writes.length === 1, writes.join(" | "));

  /* A second call must be a no-op. A migration that rewrites the same records on every
     page load is a write amplification bug that looks like nothing. */
  const beforeAgain = WRITES.length;
  await W.bozoRoster(ENV, CORS);
  ok("a second roster read writes nothing — the backfill is genuinely one-time",
     WRITES.slice(beforeAgain).filter(w => w.startsWith("PATCH /users")).length === 0,
     WRITES.slice(beforeAgain).join(" | "));
}

console.log("\\nentitlement — a re-invite must not downgrade a paying member");
{
  /* ⚠️ THIS IS THE ASSERTION THE isNew GUARD EXISTS FOR. authInvite PATCHes /users/<name>,
     and re-inviting someone who already has an account is ordinary — a lost join link gets
     re-minted. Writing the free default unconditionally there would set a paying member
     back to free, with a 200 and no error, the next time an admin re-sent them a link. */
  /* sessionAuth requires the session to match the password record on file, so the fixture
     needs one. Without it the invite is refused with "your password was reset" and every
     assertion below would be measuring the harness rather than the guard. */
  const pwSetAt = 1786000000000;
  AUTHREC.Kap = { v: 1, salt: "fixture", hash: "fixture", iters: 5000, setAt: pwSetAt };
  const session = await W.makeSession(ENV, "Kap", pwSetAt);
  const inviteAs = (player) => new Request("https://w.example.com/auth/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dawg-Session": session },
    body: JSON.stringify({ league: "main", player }),
  });

  USERS.Paid.entitlement = { plan: "member", status: "active", period_end: 1788000000000 };
  const again = await W.authInvite(inviteAs("Paid"), ENV, CORS);
  const againBody = await jbody(again);
  ok("re-inviting an existing member succeeds", again.status === 200 && againBody.isNew === false,
     again.status + " " + JSON.stringify(againBody));
  ok("⚠️ …and their paid entitlement is UNCHANGED",
     USERS.Paid.entitlement.plan === "member" && USERS.Paid.entitlement.status === "active" &&
     USERS.Paid.entitlement.period_end === 1788000000000, JSON.stringify(USERS.Paid.entitlement));

  const fresh = await W.authInvite(inviteAs("Newcomer"), ENV, CORS);
  const freshBody = await jbody(fresh);
  ok("inviting somebody brand new creates the account", fresh.status === 200 && freshBody.isNew === true,
     fresh.status + " " + JSON.stringify(freshBody));
  ok("…and that account is created carrying the free default, not left undefined",
     !!USERS.Newcomer.entitlement && USERS.Newcomer.entitlement.plan === "free",
     JSON.stringify(USERS.Newcomer && USERS.Newcomer.entitlement));
}

console.log("\\nentitlement — what MCP sees, and what it must not do");
{
  /* ⚠️ THE BACKFILL IS DELIBERATELY NOT IN loadUsers. loadUsers is the funnel every path
     uses, INCLUDING mcpAuth, so a write there would let a read-only MCP tool trigger a
     Firebase write on its first call. "Every tool is read-only, asserted by test against
     the source" is a published claim on connect.html and in surfaces.json; a self-healing
     migration is not a good enough reason to make it need an asterisk. Nothing is lost:
     entitlementOf() defaults on read, so no read is ambiguous before the record catches up. */
  /* ⚠️ THIS HAS TO SET UP ITS OWN CONDITION, AND THE FIRST DRAFT DID NOT. A source-level
     check for "no entitlement write inside loadUsers" was written first and the mutation
     harness walked straight through it: the mutation put fbPatch and the word entitlement on
     different lines, and the regex only looked at one line. It was replaced by this, which
     is behavioural — but a behavioural no-write assertion is only worth anything if a write
     is actually DUE. The earlier /auth/roster assertions have already backfilled every
     record by this point, so asserting "nothing was written" here would pass trivially. The
     field is therefore removed again first, which is the state a real MCP-only caller would
     hit before ever loading the sign-on page. */
  delete USERS.Jeff.entitlement;
  const beforeMcpWrites = WRITES.length;
  const jeff = await tool("dd_whoami", {}, TOK_JEFF);
  ok("an MCP call against an account that still lacks the field reads as free",
     jeff.data && jeff.data.entitlement && jeff.data.entitlement.plan === "free", JSON.stringify(jeff.data));
  ok("⚠️ …and it writes NOTHING — the backfill is deliberately not on the MCP path",
     WRITES.slice(beforeMcpWrites).length === 0, WRITES.slice(beforeMcpWrites).join(" | "));
  ok("…and the stored record was not quietly mutated in memory either",
     USERS.Jeff.entitlement === undefined, JSON.stringify(USERS.Jeff));
  USERS.Jeff.entitlement = W.freeEntitlement();

  USERS.Kap.entitlement = { plan: "member", status: "active", period_end: 1788000000000 };
  const beforeWrites = WRITES.length;
  const mine = await tool("dd_whoami", {}, TOK_KAP);
  ok("dd_whoami reports the caller's own entitlement",
     mine.data && mine.data.entitlement && mine.data.entitlement.plan === "member" &&
     mine.data.entitlement.status === "active", JSON.stringify(mine.data));
  ok("⚠️ …and answering it wrote NOTHING", WRITES.length === beforeWrites,
     WRITES.slice(beforeWrites).join(" | "));

  USERS.Kap.entitlement = { plan: "member", status: "definitely-paid" };
  const degraded = await tool("dd_whoami", {}, TOK_KAP);
  ok("a garbled stored status reaches the caller as none, not as something paid-looking",
     degraded.data.entitlement.status === "none", JSON.stringify(degraded.data.entitlement));
  USERS.Kap.entitlement = W.freeEntitlement();

  const shared = await tool("dd_whoami", {}, ENV.DAWG_PASS);
  ok("an anonymous shared connection is given NO entitlement, not a free-looking one",
     shared.data.entitlement === null, JSON.stringify(shared.data));
  ok("…and is told in words that it has none, so a model cannot describe anyone's plan",
     /no entitlement/i.test(shared.data.note || ""), shared.data.note);
}
'''

ANCHOR = 'console.log("\\nsignup accounts can actually sign in");'
if ANCHOR not in src:
    raise SystemExit("ABORT: anchor for the entitlement section not found")
src = src.replace(ANCHOR, TESTS.strip("\n") + "\n\n" + ANCHOR, 1)

SUITE.write_text(src, encoding="utf-8")
print("work/test-identity.mjs updated: entitlement assertions added")
