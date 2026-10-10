# GitHub pacer — on-time workflow dispatch from the Worker

GitHub's scheduled workflows are best-effort. On this repository they have been landing
four to seven hours late (2026-10-09: `nfelo-refresh` 14:45 → 19:43 UTC, `nfl-data`
10:17 → 16:59 UTC). That turned the Fourth Down Lab's "every 15 minutes on game days" into
about four runs a day and left NFL finals waiting for the next morning.

The `toto` Worker's five-minute cron is not late, so `runGithubPacer` dispatches the
time-critical workflows itself through `workflow_dispatch`:

| Workflow | When (UTC) |
|---|---|
| `nfl-data.yml` (`mode: full`) | daily 10:17 |
| `nfl-data.yml` (`mode: results`) | within 30 minutes of nflverse publishing a final that `/data/nfl-schedule.json` lacks |
| `fourth-down.yml` | every 15 minutes from 20 minutes before an NFL kickoff to 4.5 hours after; Tue/Wed 12:17 |
| `cfb-data.yml`, `epa-daily.yml`, `fourth-down-rates.yml`, `draft-picks.yml` | daily 11:41, 11:43, 12:23, 12:40 |
| `guillotine-refresh.yml` | daily 14:15; Tue/Wed 08:15 and 11:15 |
| `nfelo-refresh.yml` | 02:45, 08:45, 14:45, 20:45 (the upstream publishes at no fixed hour) |
| `survivor-receipt.yml` | daily 15:00 |
| `bozo-menu-ledger.yml` | daily 06:20 and 13:20 |

The GitHub crons stay as the backup. A duplicate run is a no-op (each job exits clean on
unchanged data), and each workflow's concurrency group queues rather than overlaps. Each
slot is dispatched at most once (KV `gh:pacer:<workflow>:<slot>`); a failed dispatch is
retried on the next tick for 15 minutes. `gh:pacer:last-run` records what the last tick did,
and `gh:pacer:lasterror` any failure. Only HTTP status codes are stored, never a response body.

## Turning it on (one time)

The pacer is inert until the Worker has a token. It is deliberately not in
`wrangler.jsonc`'s required secrets, so deploys never depend on it.

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained
   tokens** → Generate new token.
   - Resource owner: `JKapcar`; Repository access: **Only select repositories** →
     `JKapcar/data-dawgs`.
   - Repository permissions: **Actions: Read and write** (Metadata: Read is added
     automatically). Nothing else.
   - Expiration: your choice; the pacer simply goes quiet when it expires (each failed
     dispatch is recorded as HTTP 401 in `gh:pacer:last-run`).
2. Store it as a Worker secret, from a checkout of this repository:
   `npx wrangler@4 secret put GH_DISPATCH_TOKEN --name toto` and paste the token.
   (Or Cloudflare dashboard → Workers & Pages → `toto` → Settings → Variables and Secrets →
   Add → Secret, name `GH_DISPATCH_TOKEN`.)

No redeploy is needed: the next five-minute tick picks the secret up.

## Turning it off

Delete the `GH_DISPATCH_TOKEN` secret (or revoke the token). The GitHub crons keep running
exactly as before.
