# Discord useful retrieval (disabled until scoped activation)

The existing six Pack seat tools remain unchanged. Grok receives no private DFS read capability. The Worker handles all lineup selection, projection and delivery deterministically.

## Activation boundary

- `DISCORD_RETRIEVAL_ENABLED=true` enables Ask Grok, Follow up and the public Bozo Menu control.
- `DISCORD_DFS_SHARE_ENABLED=true` additionally permits the currently configured, linked `DISCORD_GROK_USER_ID` to select their own `RESEARCH_OWNER_UID` cloud-saved DFS workspaces and publish selected lineup names, player names/slots and salaries in `DISCORD_CHANNEL_ID` under `DISCORD_GUILD_ID`.
- Both default false. The private grant requires separate action-time confirmation before activation. It lasts until disabled or the owner link expires/is revoked; it never authorizes other users or channels. Existing Grok wake approval expiry remains unchanged.
- No new keys, OAuth scope, schedule or Discord permissions are introduced. Verify existing channel permissions before using the launcher.
- Do not publish the launcher until the parent coordinates the approved destination and purpose. The owner page's **Post Discord buttons** action creates one reserved launcher; uncertain sends are never automatically repeated.

## User flow

**Ask Grok** opens a question modal and reuses Pack admission and the Grok routine. **Follow up** in a Pack thread routes to that thread's existing seat. **Bozo Menu** posts a bounded summary and the full public feed link with actual publication week/time, including hold/scratch statuses. It reads only the published menu, not private research notes. Explicit questions mentioning “Bozo Menu” also receive this bounded public snapshot in Pack job context, with publication time and an untrusted-source label. Quotes are saved snapshots.

**My Lineups** opens an ephemeral workspace picker, followed by an ephemeral paginated lineup picker clearly labelled as a public-post action. The final selection publishes one roster in the configured parent channel. Selection includes workspace ID, revision, kind and index; changed revisions fail closed. Supported saved forms: computed NFL candidates, manual NFL roster, named NHL roster and lineup entries within the current saved portfolio. Archives/history are excluded. No edits, solve, export or contest submission occurs.

Only roster name, workspace ID/site/revision/source date, player names/slots and salaries are projected. Projections, ownership, notes, fees, bankroll, contests, histories, credentials and raw provider content are excluded. No private snapshot is passed to Grok or stored in a Pack job. Interaction tokens remain request-local. Public delivery edits the original interaction response, so replaying the same interaction cannot create another message. A new user selection is a separate explicitly requested publication.

## Readiness tests

Synthetic tests cover owner/channel/flag denial, stale revisions, malformed indices, path traversal, revocation during retrieval, field exclusions, roster variants, long IDs/pagination, existing six-tool isolation, deferred response behavior and launcher concurrency. Production activation/readback and any launcher/test send require coordination; no actual lineup has been fetched or shared during development.
