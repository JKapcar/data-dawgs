# CEP-6 — email verification and password reset

**Status: code shipped, switched OFF. Nothing sends mail and nothing on the site claims
it can.** Four Worker routes exist and refuse with 503 until two values are set. There is
no UI: no page has a "email me a reset link" button, because a button that cannot work is
a claim the system does not support.

## Why it exists

Signup has been open since CEP-5. Someone who signs up, forgets their password and cannot
reach Kap is locked out permanently with their name held. The only recovery today is Kap
running the admin `/auth/reset` by hand, for a person he has no way to identify. That is
the sharpest remaining edge on the site, and it gets worse the more strangers sign up.

## What Kap has to do

Three things. Nothing sends until all three are done, and the code stays inert and safe if
you stop after any of them.

### 1. Resend account and a verified sending domain

- Sign up at resend.com. The free tier is 3,000 messages a month and 100 a day, which is
  far more than the caps below will ever use.
- Add `datadawgs216.com` as a sending domain. **Do not send from a subdomain of a domain
  you also use for anything else you care about** — a shared reputation is the usual way a
  first transactional send lands in spam.
- Resend will show you the exact DNS records for step 2. Use the ones it shows, not the
  ones below, if they differ.

### 2. DNS at the registrar

Resend generates these; the shapes are here so you know what you are looking at.

| Type | Name | Value |
|---|---|---|
| TXT | `send.datadawgs216.com` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey.datadawgs216.com` | the long `p=…` public key Resend shows |
| MX | `send.datadawgs216.com` | `feedback-smtp.<region>.amazonses.com` priority 10 |
| TXT | `_dmarc.datadawgs216.com` | `v=DMARC1; p=none; rua=mailto:you@…` |

- **Start DMARC at `p=none`.** It reports without rejecting. Move to `p=quarantine` only
  after a couple of weeks of clean reports; going straight to `p=reject` on a domain that
  has never sent mail is how you bounce your own password resets.
- ⚠️ **Check whether `datadawgs216.com` already has an SPF record.** A domain may have
  exactly one. If there is one, merge the `include:` into it rather than adding a second —
  two SPF records is a permanent fail, not a warning.
- Propagation is usually minutes. Resend's dashboard verifies each record.

### 3. Two values on the Worker

```
wrangler secret put RESEND_KEY          # the Resend API key, starts re_
```
and one plain-text var, `MAIL_FROM`, in the Worker's settings (or `wrangler.jsonc` `vars`):

```
MAIL_FROM = Data Dawgs <no-reply@send.datadawgs216.com>
```

`MAIL_FROM` is deliberately **not** a secret. It is not sensitive, and keeping it visible
means the config is readable without pulling secrets. The address must be on the domain
verified in step 1 or every send fails.

⚠️ **Both must be present.** `mailReady()` is false unless it sees both, and every route
returns 503 without minting a token, touching the database, or calling out. A key with no
`MAIL_FROM` sends nothing; a `MAIL_FROM` with no key sends nothing.

## What ships the day you set those

| Route | Auth | Does |
|---|---|---|
| `POST /auth/verify-request` | session | Sends a confirmation link to the address already on *your own* account. It cannot be pointed anywhere else. |
| `POST /auth/verify` | the token | Marks that address verified. |
| `POST /auth/forgot` | none | If the address has an account, sends a reset link. Answers identically if it does not. |
| `POST /auth/reset-password` | the token | Sets a new password and ends every other session. |

⚠️ The admin `POST /auth/reset` — the one that clears a hash and re-arms a join link — is
**unchanged and still there**. The email flow is `/auth/reset-password`. Do not rename
either: cached copies of bozo.html and signon.html still call `/auth/reset` expecting the
admin behaviour.

### What defends it

- **Tokens.** 32 random bytes. KV stores only the SHA-256 of the token, so read access to
  KV does not hand over an account. One hour, single use, deleted *before* the work it
  authorizes — a failed database write costs a new link rather than leaving a live reset
  token behind.
- **Caps, checked before any work.** 3 links per address per day, 10 per connection per
  day, 60 seconds between links to one address.
- **No account enumeration.** `/auth/forgot` returns the same status and the same body
  whether or not the address exists, and swallows provider outages into that same
  response. The one exception is "email is not switched on", which says nothing about any
  address.
- **A reset ends every other session.** The new password record gets a fresh `setAt`, and
  session payloads pin to it. Whoever prompted the reset does not keep a stolen session.
- **A moved address kills an outstanding link.** Both consuming routes re-check that the
  account's current address still matches the one the link was sent to.

`node work/test-cep6-email.mjs` — 63 assertions. The first block runs with mail off and
fails the run if anything reaches api.resend.com or writes a token.

## What is NOT done

**The signon.html side.** The Worker will happily accept `/auth/forgot` and
`/auth/reset-password` the moment the secret lands, but no page calls them, so the loop is
open. That is deliberate: shipping the button first would advertise a capability that does
not exist. The remaining work, precisely:

1. On load, read `?reset=<token>` and `?verify=<token>` from the URL. If present, show
   *only* that card. Both tokens are single use, so the card must not fire on render —
   the user has to submit.
2. `?reset=` → a two-field new-password card → `POST /auth/reset-password {token, password}`
   → on success `DDAuth.set(j.session)` and route to `?next=`. The response session is
   already the only valid one; every older session is dead.
3. `?verify=` → a one-button confirm → `POST /auth/verify {token}` → a plain "confirmed".
4. A "Forgot your password?" link on the sign-in card → an address field →
   `POST /auth/forgot {email}` → show the response's `note` **verbatim**. Do not add
   "we sent it" wording of your own: the whole point of that response is that it says the
   same thing whether or not the address exists.
5. ⚠️ **Strip the token from the URL** (`history.replaceState`) once it has been read, so
   it does not sit in the address bar, in history, or in a `Referer` header on the next
   click.
6. Update `/auth/email`'s and `/auth/signup`'s "nothing is ever sent to it" copy. That
   sentence becomes false the moment this is on, and it appears in the Worker's own JSON
   responses as well as on the page.

Item 6 is the one that is easy to miss and is a straight honesty regression if it is.
