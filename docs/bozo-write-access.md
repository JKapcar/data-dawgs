# Writes over MCP: the Bozo leg

**Status: specced, not built. No code changed, no invariant removed, nothing armed.**

Kap's 2026-08-08 architecture plan makes writes over MCP the differentiator and moves
the action layer to Phase 2, starting with the Bozo leg. This is the design input for
that phase, plus one finding that changes the contract the plan sketched.

## The finding: two-phase defends against the model, not against the leak

The plan's v1 contract is `dd_propose_bozo_leg` (validate, return a short-lived
single-use token) then `dd_submit_bozo_leg` (redeem the token, write). That is a real
defence against **the agent misfiring** — a model reading "what should I take this week"
as "take it." It should be built.

It does not defend against **a leaked connector URL**, because both calls authenticate
with the same secret. Whoever holds the URL calls step one and then step two. And
`work/mcp-block.js` is explicit about that secret:

> ⚠️ The URL IS the credential either way. Claude's connector UI takes a URL and has no
> field for a custom header, so the secret rides in the path. It leaks through
> screenshots and history. Per-user makes a leak CONTAINABLE — rotate one row, nobody
> else is disturbed — it does not make it secure, and **it must never be described as
> security**.

That is survivable today because nothing writes: a leaked URL exposes league data. It
stops being survivable the moment the same URL can act.

### Why the blast radius is larger than "one bad row"

`bozoPick` is not append-a-row. When the Nth leg lands it calls `placeAndDraw`, which
locks the board and draws the lever permutation once, on purpose:

```js
const cur = await fbGet(env, LG(lid) + "/order", true);
if (cur.data != null) return true;                 // already drawn — never redraw
```

There is no undo. `remove` only works while `status === "open"`, and after the draw it is
not. The only route back to `open` is `/bozo/next`, which requires a manager **and
advances the week**, pushing this one into `history` and nulling `picks`, `order`,
`results`, `bozo`. So a leg submitted at the wrong moment cannot be taken back; the week
can only be abandoned, which costs the other thirteen theirs.

The server also stamps `ts` itself, and `ts` decides Last In — a scored column in the
season ledger. A forged leg does not merely appear; it takes a position in the standings.

## The contract this argues for

Keep the plan's two phases. Change what redeems the token: a **different credential
class**, not a second call on the same one.

| Step | Where | Credential | Effect |
|---|---|---|---|
| 1. `dd_propose_bozo_leg` | MCP | connector URL | validates, stages, returns a code. Board unchanged. |
| 2. confirm | `bozo.html#confirm` | password session | the only call that reaches `/bozo/pick` |

A leaked connector URL then buys an attacker a pending suggestion that the real member
sees and discards. That is containable in the way the per-user token scheme was always
meant to be, and it survives the sentence the file already refuses to walk back.

Cost, stated honestly: staging store with expiry, a confirm card on `bozo.html`, a
confirm route, tests per refusal path, and the `initialize` copy stops being the single
sentence "everything here is read-only." The tool also stops being a submit tool — it
drafts, a human submits — so `dd_submit_bozo_leg` would be a misleading name for it.

**If Kap wants the pure MCP round trip anyway** (Claude proposes, "confirm", Claude
submits, no phone tap), that is a legitimate call to make with the risk on the table
rather than around it. It should then ship with: writes refused for the shared
`DAWG_PASS` connection and for any anonymous path, ever; refusal when the submission
would be the leg that locks the board, so the irreversible event stays human-triggered;
a rate limit per member per week; and `/connect.html` copy that says plainly that the URL
can now act, not just read. That last one is not optional — members minted those tokens
under a read-only promise.

## What is safe today and worth building first

`dd_draft_bozo_leg` — **read-only, zero writes, no invariant touched.** Takes a proposed
leg, answers against live league state whether it would be accepted:

- board `status` is not `open` → say so, and stop
- caller is not a member of that league → say so
- caller is on the shared connector, so identity is unknown → say so, and stop
- price outside `bandOf(state)` → say so, with the band
- unknown sport or market, missing line on a non-ML market, `other` with no `prop`
- identical `label` already on the board and `allowDupes` false → name whose it is
- caller already has a leg and `allowEdit` false → say so
- otherwise: the exact JSON body `/bozo/pick` wants, a plain-language summary, and how
  many legs are still outstanding

That is a straight port of `validatePick` plus the guards at the top of `bozoPick`,
reading the same `loadLeague` state `dd_bozo_week` already reads. It delivers the whole
validation half of the ask, keeps the three source-level assertions in
`work/test-mcp.mjs` exactly as they are, and it is the natural step 1 of either contract
above — so it is not throwaway work whichever way the confirmation question lands.

## Build order

1. `dd_draft_bozo_leg`, read-only. Refusal paths first, happy path last. No invariant
   changes, no `initialize` copy changes.
2. Decide the confirmation question above. It is a product decision about what a leaked
   URL is allowed to do, not an implementation detail.
3. Build the chosen step 2. Whichever it is, the three `test-mcp.mjs` source assertions
   change from "this block never writes" to a narrower, still-mechanical claim — write
   the replacement assertions *before* the code they guard.
4. `/connect.html` copy, in the same commit as the first live write.

## Notes for whoever picks this up

- Edit `work/mcp-block.js`, then `node assemble.mjs` from `work/`. Never hand-edit the
  assembled region of `dawg-bot-worker.js`.
- Worker deploys need Kap's fresh explicit approval, every time.
- Writes never enter the `core` catalog or any directory profile.
- `dd_whoami` already resolves identity from the per-user token; `caller.kind` is
  `"user"` or `"shared"`, and `"shared"` must never be allowed to write.
