# Claude Code — Build Prompt

Paste this as your first message. Working directory must contain:

| File | Role |
|---|---|
| `SPEC.md` | The build spec. Read it fully before writing code. |
| `program.json` | **Canonical** program — schema 3.0. Seed this into D1. |
| `restrictions.json` | Restriction schema, six kinds, preset catalog, seeded rows. |
| `claude-project-setup.md` | Content for the Settings tab. Verbatim, except `{{MCP_BASE}}` — substitute the deployed worker origin. Never hardcode a workers.dev hostname. |
| `swoledawg-session.html` | Working UI mockup. **Behavioral reference only — see below.** |
| `/radar.html` | Live at the repo root as a Pup (unvalidated). Wire it to `/api/summary`; do not redesign it. |
| week number | Derive from `program.json` `block_start_date` — never read or store a `current_week`. Apply week 1's `sets_override`. |

---

Build SwoleDawg v0.4.0 — a workout logger I drive by talking to Claude.

**Repo context:** this is the Data Dawgs site (datadawgs216.com). SwoleDawg lives at
`/swoledawg.html`. I already run a Cloudflare Worker for the Data Dawgs MCP server; use that
same pattern rather than inventing infrastructure.

**The problem:** SwoleDawg holds state in browser memory and I export JSON by hand. I want to
finish a set, say "bench, 30, 11," and have it write to the live site.

## Deliverables

1. **`sd_*` tools inside the existing `toto` worker** (`dawg-bot-worker.js`) — MCP tools for
   Claude plus a read/write API for the site, with D1 bound in the existing `wrangler.jsonc`.
   **Do not create a second worker.** Identity lives in `toto` — `sessionAuth()`, the hashed
   per-user token store, `/users/{uid}` — and a separate worker cannot see any of it. Reuse the
   Bozo identity pattern exactly: signed in means your own session, writes require
   `caller.kind === "user"`, everything is keyed by uid, and the personal URL the user already
   minted carries the new tools with no second connector. Spec §0–4.

2. **Restrictions engine** — spec §8. This is the architectural core, not a feature. Injuries
   and limitations are user rows matched against exercise tags, never hardcoded. `sd_get_restrictions`
   returns rows plus a server-assembled preamble that every plan-generating path must call
   first. Build this before the plan UI; retrofitting it means auditing every code path twice.

3. **Measurement store** — spec §7. Tagged fields with `direction`, server-side derived values,
   the seven display rules. The direction rule matters most: weight, waist, hips, and body fat
   all decrease on success, and a UI that colors any decrease as regression will report failure
   for six months while the plan works.

4. **Rewritten `swoledawg.html`** — Training tab session logger, live data, stale Data Dawgs
   nav strip removed. Spec §5.

5. **Settings tab** — spec §6. Restrictions panel plus the Claude Project setup docs from
   `claude-project-setup.md`, with copy buttons on the connector URL and both instruction
   blocks. I set this up on a phone; no manual typing.

## About the mockup

`swoledawg-session.html` is **stale on content and correct on behavior.** Its exercise array
predates the current program — it's missing the flye and the curl and still has an overhead
extension on Monday. Take zero exercise data from it. `program.json` is canonical.

Port these behaviors, which are right and were tested:

- Rest duration from the active exercise's `rest_between_sets`; the transition after the last
  set uses `rest_after_exercise`; unilateral lifts use `rest_between_sides`.
- Gauge segments derive from duration: 30s ticks at or above 120s, 15s below.
- Timer counts past zero showing `+0:14` in red; `rest_taken_s` records the real number.
- At zero: two short tones then a longer higher one, screen flash, `navigator.vibrate`.
- `−15 / +15` override with snap-back to recommended; overrides persist per exercise per phase.
- Auto and Alert toggles.

**Two bugs in it to fix during the port:**

1. It counts `setInterval` ticks, so it drifts when the phone screen locks. Derive remaining
   from a `Date.now()` target and request `navigator.wakeLock` during active rest.
2. State is in memory. Every set POSTs to `/api/set`, queued offline and flushed on reconnect —
   a basement gym drops connection.

## Order of work

Worker and schema → seed `program.json` and `restrictions.json` → **a working `sd_log_set`
round-trip** → read path → logger write path → restrictions panel → Settings.

Do not build UI before that round-trip works. If the auth or CORS story is wrong I want to know
in the first hour, not the fourth.

## Ask me before deciding

- D1 schema shape and tool names. I'll be speaking those tool names out loud for the next year;
  renaming later means editing project instructions in three places.
- Anything where the spec and `program.json` appear to disagree. Don't reconcile silently.

## Constraints

No localStorage, no framework, no bundler, no npm on the front end. The site is hand-written
static HTML/CSS/JS and stays that way.

Nothing medical is hardcoded anywhere — not in `program.json`, not in the instruction blocks,
not in the worker. If you find yourself writing an injury into code, that is the restrictions
engine's job and you've taken a wrong turn.
