# `toto` Worker deployment runbook

`wrangler.jsonc` is the permanent source of truth for the production Worker's
non-secret configuration. It exists because an incomplete temporary manifest can
silently remove a KV binding, cron trigger, plain variable or observability setting.
The file contains secret **names only**. Secret values stay encrypted in Cloudflare.

## Production invariants

- Worker: `toto`; entry point: `dawg-bot-worker.js`.
- Compatibility date: `2026-07-31`.
- Workers.dev enabled; version preview URLs disabled.
- Standard usage model CPU ceiling: 1,000 ms.
- Workers Logs enabled.
- `RL` KV namespace: `ffee9157b0a04cebb796acfa6046880a`.
- Plain variables: `BOZO_ADMIN`, `ELEVEN_VOICE`, `MAIL_FROM`, `MODEL`.
- Required encrypted secrets: `BOZO_PEPPER`, `BOZO_TOKENS`, `DAWG_PASS`,
  `DDCC_IMPORT_TOKEN`, `ELEVEN_KEY`, `FB_SECRET`, `RESEND_KEY`, `SGO_KEY`, `XAI_KEY`.
- Daily `0 9 * * *` trigger: private Firebase disaster-recovery backup.
- Hourly `9 * * * *` trigger: prospective CFB 24-hour market receipts.
- Five-minute `*/5 * * * *` trigger: Bozo close-price capture.

The scheduled handler dispatches by the exact cron expression. An unknown expression
fails closed. Never change the hourly trigger to the daily expression or remove the
dispatch check: running the private full-database backup every hour is unnecessary and
would blur two unrelated operational jobs.

## Build and local verification

Use Wrangler 4.x. The committed Worker is assembled output; edit `work/mcp-block.js`
for MCP code, then rebuild. Non-MCP routes, including the CFB collector, live directly
in `dawg-bot-worker.js` and survive the idempotent assembly process.

```
node work/assemble.mjs
node --check dawg-bot-worker.js
node work/test-cfb-market-capture.mjs
node work/test-backup.mjs
node work/test-identity.mjs
node work/test-mcp.mjs
node tools/validate-data.js
wrangler deploy --dry-run --config wrangler.jsonc
```

The dry run must report the `RL` binding and all four plain variables. It performs no
upload and changes no traffic.

## Safe release sequence

Do not deploy merely because tests pass. Pushing `main` deploys GitHub Pages, and moving
Worker traffic changes a second production system. Both require fresh explicit owner
authorization.

1. Fetch `origin/main`, verify the intended commit and re-run the full test list above.
2. Run `wrangler secret list --name toto` and compare names with
   `secrets.required`; never request or print values.
3. Upload a version without moving traffic:
   `wrangler versions upload --config wrangler.jsonc --message "<commit and purpose>"`.
4. Inspect that version with `wrangler versions view <version-id> --name toto --json`.
   Confirm compatibility date, 1,000 ms CPU, `RL`, plain variables and every secret.
5. Only after explicit approval, move traffic with
   `wrangler versions deploy <version-id>@100% --name toto`.
6. Verify the deployment, then make read-only production calls:
   `GET /mcp` should retain its transport boundary and
   `GET /cfb/market-snapshots?season=2026` should return a dated envelope.
   After the CFB MCP release is approved, `tools/list` must contain
   `dd_cfb_team_profile`, and an exact team call must preserve the registry's
   `as_of`, source, integrity receipt and no-consensus warnings.
7. Check the next expected cron execution in Workers Logs. A successful empty CFB
   window is normal; `cfb:market:24h:lasterror` is not.

Never use `wrangler deploy` with a hand-built partial manifest. Never put a secret value
in this repository, a command-line flag, a URL, a test fixture that resembles a real
credential or a deployment message.
