# Owner-operated Discord connection check

Draft implementation only. No runtime changes, secrets, credentials, command registration, grants or Discord messages are part of this PR. PR #304 remains a separate pending configuration change.

Packaged verification also corrects the existing Discord store constants to `/discord_queue_v1` and `/discord_bridge_v1`: the production `fbUrl` concatenates its base and path directly. Earlier slashless constants produced an incorrect URL; mocked source tests did not exercise that helper. The additive change uses the intended existing store names and does not migrate or delete records. Discord fetches also use `redirect: "manual"` and reject unsuccessful responses: Cloudflare rejects `redirect: "error"`, and credentials must never follow redirects.

## Working path

Open `/research-lab/discord-smoke.html` from Connections using the existing DataDawgs browser sign-in. The server verifies the signed, unrevoked site session with `poundIdentity`, then requires the configured `RESEARCH_OWNER_UID`. Legacy owner keys, MCP keys, bot tokens and `ddq_` tokens cannot authorize this route. No new bearer credential is issued or copied.

The explicit `DISCORD_OWNER_SMOKE_ENABLED` policy grants this browser session only register/read/claim/fixed-answer operations for one smoke job. It does not bypass or modify dedicated queue grants: existing `/discord/queue` and `/mcp/discord-queue` still require `ddq_`, and cannot read smoke jobs. The owner route never reads private RoboKap, BDB, vault or DFS records. It accesses only the existing private `discord_queue_v1` store plus ordinary account verification.

Registration POSTs one guild command named `ask` using the server-side bot secret. It cannot select another application/guild, bulk replace commands, edit permission overrides or return token values. The command defaults to `default_member_permissions: "0"`; Discord administrators can use it, and a non-administrator needs an explicit command permission override. Backend admission still restricts the smoke to the configured user and channel. Registering the same name updates that command’s description, options and default permissions; the UI discloses this before confirmation. Other commands and per-user/role permission overrides are untouched. A durable reservation prevents automatic retry after uncertain registration; manual Discord inspection is required.

The user submits exactly `Reply with pong.`. One atomic admission is retained for this smoke policy; replays of that same interaction return its state, and new interaction IDs are rejected once used. The owner loads it, claims it, then explicitly confirms `pong.`. The server sends a request-correlated thread with a deterministic-smoke label and persists a Discord receipt. Uncertainty never triggers automatic resend. This tests transport, not model execution. There is no model runner or automatic private-data retrieval. Arbitrary/model-authored answers remain on the existing dedicated-client path described in `discord-inbound.md`; this PR does not pretend that such a client is connected.

## Later approval and activation

Before activation: review/merge this draft separately; reconcile PR #304 and the live secret binding without retrieving secret values or copying runtime variables wholesale. Preserve the existing complete manifest and encrypted bot secret. Verify RTDB denies all public/client reads and writes to `discord_queue_v1`. Verify the bot's View Channel, Create Public Threads, and Send Messages in Threads permissions only in the approved channel. Do not add Administrator, Message Content intent, general posting or private-data grants.

Runtime configuration, all requiring later action-time approval:

- Keep existing application, guild and channel IDs. Set `DISCORD_SMOKE_USER_ID` privately to the approved immutable Discord user ID.
- Keep the verified `RESEARCH_OWNER_UID`; no default owner identity is invented.
- Set `DISCORD_SMOKE_WINDOW` to JSON with explicit ISO `starts_at` and `expires_at`, at most 30 minutes apart. Every action and admission checks that window. In-flight reserved network calls may finish after expiry/revocation.
- Enable `DISCORD_OWNER_SMOKE_ENABLED`, `DISCORD_INBOUND_ENABLED`, `DISCORD_QUEUE_ACCESS_ENABLED`, and `DISCORD_QUEUE_DELIVERY_ENABLED` for the test. Keep `DISCORD_BRIDGE_ENABLED=false`, existing general user links empty and dedicated grants unchanged.
- The fixed new namespace is `jason-discord-smoke`; it was not previously configured. No private-project grant is implied.

One bundled approval should cover the reviewed Worker/UI deployment, those exact settings/window, one guild-only command registration (and user command override only if needed), one harmless question and deterministic answer, and disabling the smoke/access/delivery flags after receipt verification. No bot setup or token copying needs repeating. Do not enable before the user is ready to submit within the window.

Retain the harmless question, reply and receipts privately until separately approved cleanup. Current code does not delete or reset smoke history, and deleting it reopens its one-use protection. Discord thread auto-archive is not deletion. Runtime expiry does not remove command registration or Discord messages. If a send is uncertain, inspect the single request thread manually and do not create replacement jobs. This one-use cap applies only to connection verification, not future lineup sharing.

## DFS boundary and separate follow-up

`work/dfs-workspace.js` stores named workspaces beneath authenticated caller identities (`dfsPath`); its HTTP interface requires `sessionAuth`. Portfolio and history operations are private explicit saves/exports. No published-lineup catalog or per-set Discord publication route was found in the inspected DFS implementation/docs. Private export is not permission to publish.

Follow-up design requirement, not implemented or activated here: explicitly selected saved lineup sets may be shared to the Data Dawgs Discord in any number across slates/contests, with bulk selection, unshare, pagination rather than arbitrary lifetime/item caps, exact slate/version/freshness and stale-injury labels, and no private contest history. No existing lineup is published by this PR.
