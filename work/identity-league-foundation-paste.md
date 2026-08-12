# Identity / league foundation — paste handoff

Date: 2026-08-12

Payload: `dawg-bot-worker.js` at repository root. It is assembled output; paste the
entire file into Worker `toto`. Do not paste `work/mcp-block.js`, and do not use a
partial Wrangler manifest.

## Build proof

Run the assembler from `work/` (its paths are working-directory-relative):

```powershell
cd work
node assemble.mjs
node assemble.mjs
cd ..
node --check dawg-bot-worker.js
```

Both assembly passes must report `single declarations`, `parses`, `idempotent`, and
`no write calls in the block`. The second pass must not change the Worker SHA-256.

The discovered repository suite is every `work/test-*.(mjs|js)` file. On this payload,
all 44 test programs pass. The focused foundation suite reports 54 assertions; the
legacy identity, email, league join, MCP, connector and nav suites report 128, 74, 47,
376, 35 and 129 assertions respectively.

## Route inventory versus the Worker served on 2026-08-12

No route is removed.

New routes:

| Method | Route | Contract |
|---|---|---|
| `POST` | `/auth/lookup` and `/bozo/lookup` | `{email}` -> `{ok,known}`; intentional enumeration, 60/IP/hour |
| `POST` | `/auth/email-confirm` and `/bozo/email-confirm` | `{token}` proves the new primary email before login changes |
| `GET`, `PUT` | `/auth/draft-state?league_id=...` | UID personal scratch state; 65,536-byte cap and version CAS |
| `GET` | `/league/mine` | authenticated UID member/manager projection; never returns gate code |
| `PUT` | `/league/gate` | manager or `site_admin` changes a universal league gate and appends an event |

Changed routes and transport:

| Route | Change |
|---|---|
| global `OPTIONS` | advertises `GET, POST, PUT, OPTIONS`; exposes only `X-Dawg-Session` |
| `/auth/signup`, `/bozo/signup` | creates immutable `u_...` account, lowercase unique email, non-unique display name; `201` |
| `/auth/login`, `/bozo/login` | UID accounts authorize by email; legacy name records remain compatible; failures bucket by identifier and IP |
| `/auth/passwd` | UID password changes update the private user record and revoke every older session |
| `/auth/email` | UID account keeps its old login until the new inbox consumes `/auth/email-confirm`; legacy branch unchanged until wipe |
| `/auth/verify-request`, `/auth/verify`, `/auth/forgot`, `/auth/reset-password` | accept UID subjects; new mail-token keys are purpose-separated HMACs; one-hour SHA fallback preserves already-sent links |
| `/auth/mcp-token` | UID mint is `403` until email verification; legacy mint remains compatible during transition |
| `/league/create` | bodies with `{game,name,gateCode,settings}` create a universal league with a server-minted `dd_...` ID; old legacy body shape is unchanged |
| `/league/join` | bodies with `{leagueId,gateCode}` join the universal league; old `{code}` join-link flow is unchanged |
| every authenticated route | sessions remain 60 days but a token older than seven days is returned refreshed in `X-Dawg-Session` |

Live fingerprint before paste:

| Probe | Served result |
|---|---|
| `OPTIONS /auth/draft-state` | `200`, but `Access-Control-Allow-Methods: GET, POST, OPTIONS` (no `PUT`) |
| `POST /auth/lookup` | chat fall-through `401` |
| `GET /auth/draft-state?...` | chat fall-through `405` |
| `POST /auth/email-confirm` | chat fall-through `401` |
| `GET /league/mine` | chat fall-through `405` |
| `PUT /league/gate` | chat fall-through `405` |

## Secret changes

No new secret name is introduced. Before paste, confirm these existing encrypted names
remain present: `BOZO_PEPPER`, `BOZO_TOKENS`, `DAWG_PASS`, `DDCC_IMPORT_TOKEN`,
`ELEVEN_KEY`, `FB_SECRET`, `RESEND_KEY`, `SGO_KEY`, `XAI_KEY`. Confirm the `RL` KV
binding and `MAIL_FROM=no-reply@mail.datadawgs216.com` plain variable remain present.

Required value change: rotate the previously exposed `XAI_KEY` in this release. Do not
rotate `BOZO_PEPPER` (that would invalidate passwords, sessions, mail-token hashes and
personal MCP hashes). Do not remove `BOZO_TOKENS` before the approved post-draft wipe.

Exact secret order:

1. Create a new xAI key without revoking the old key yet.
2. Replace Cloudflare Worker secret `XAI_KEY` with the new value.
3. Paste and deploy the complete assembled Worker.
4. Verify chat with the new key and verify the route probes below.
5. Revoke the old xAI key only after those checks pass.

`RESEND_KEY`, `FB_SECRET`, `BOZO_PEPPER`, and every other existing value stay unchanged.

## Firebase preconditions and activation order

Rules precondition: neither `/users`, `/emailIndex`, nor `/leagues` may inherit a public
`.read` or `.write` grant from `/`. They must remain default-deny to browsers; the Worker
uses `FB_SECRET`. Keep the existing public-read/Worker-write policy for `/bozo` and the
auth-free public draft rig. Do not move `/leagues` under `/bozo`, and do not expose a
gate code through a client-readable rule.

Data precondition: `/emailIndex` and `/leagues` may be absent or empty. No migration or
backfill is required: signup scans existing legacy `/users` emails before reserving a
new hash, and every new UID account creates its index row. Do not clear or rewrite
`/bozo`, `/users`, `/bozoauth`, or any draft room. In particular, do not touch
`pepperoninipples`.

Activation order:

1. Confirm the rules precondition, `FB_SECRET`, `RL`, `RESEND_KEY`, `MAIL_FROM`, and the
   unchanged `BOZO_PEPPER` before deploying code.
2. Perform the xAI key steps above, paste the complete Worker, and deploy.
3. Assert the new preflight: `OPTIONS /auth/draft-state` is `200`, Allow-Methods contains
   `PUT`, Allow-Headers contains both session headers, and Expose-Headers is
   `X-Dawg-Session`.
4. Assert signed-out route boundaries: invalid `/auth/lookup` -> `400`; draft-state with
   no session -> `401`; short `/auth/email-confirm` token -> `400`; `/league/mine` with
   no session -> `401`; empty `/league/gate` body -> `400`.
5. Create the real Kap UID account through `/auth/signup`, retain the returned UID, and
   complete `/auth/verify-request` + `/auth/verify` from the Resend email.
6. In Firebase Console, patch only `/users/<returned-uid>/roles/site_admin` to `true`.
   Do this after the account exists; never authorize by the display name `Kap`.
7. Create the first universal league through `/league/create`. The Worker mints the ID;
   never hand-author a different ID shape. For draft, use `game:"draft"`; it is public
   board metadata while personal sync remains available to any authenticated user.
8. Verify `/league/mine`, a second-account join, repeat-join idempotence, and one
   `member_joined_<uid>` event before enabling any UI that depends on the foundation.

No destructive Firebase action is part of this release. The Aug. 19 auction backstop
remains external to this payload: if the enhancement is not green by then, disable it
and ship it post-draft.

## Post-paste curl checks

```powershell
curl.exe -sS -D - -o NUL -X OPTIONS `
  -H "Origin: https://datadawgs216.com" `
  -H "Access-Control-Request-Method: PUT" `
  -H "Access-Control-Request-Headers: content-type,x-dawg-session" `
  -w "HTTP %{http_code}`n" `
  https://toto.jkapcar4.workers.dev/auth/draft-state

curl.exe -sS -X POST `
  -H "Origin: https://datadawgs216.com" `
  -H "Content-Type: application/json" `
  --data-raw '{"email":"not-an-email"}' `
  -w "`nHTTP %{http_code}`n" `
  https://toto.jkapcar4.workers.dev/auth/lookup
```
