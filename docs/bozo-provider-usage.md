# Owner-only SGO usage diagnostic (proposed)

`GET /ops/provider-usage/sgo` performs one on-demand GET to the fixed `https://api.sportsgameodds.com/v2/account/usage` endpoint, using the existing `SGO_KEY` binding. No parameters, request body, alternate host, event fetch, retry, poller, schedule or new credentials are supported.

Authorization is the existing `poundIdentity` signed site-session verifier, including account/revocation verification, followed by exact `RESEARCH_OWNER_UID` equality. No grants or configuration changes. This is not public `/ops/health` and is not a callable MCP tool. Existing MCP credentials are not accepted. A deployed endpoint alone does not make it available in Scout's connector session.

Response fields:

- `provider`: fixed `sgo`; `observedAt`: current successful observation timestamp.
- `active`: provider's boolean `isActive`.
- `scoreEntitlement`: always null; account usage does not establish league or final-score access.
- `limits`: only per-second/minute/hour/day/month; each includes numeric or null `requests`, `objects`, `requestLimit`, `objectLimit`, `requestsRemaining`, `objectsRemaining`; explicit `requestsUnlimited`, `objectsUnlimited` booleans; validated `resetsAt` or null. Unknown values are never zero or unlimited by default.

Responses are private/no-store. Account/key/customer identifiers, plan names, raw notices, arbitrary provider fields, error messages and credentials are dropped. No response or key is cached or persisted; no provider-body logging. Upstream redirects are refused. A four-second deadline includes response parsing. Refusals return fixed `provider_denied` (401/403 upstream), `provider_rate_limited` (429), `provider_unavailable`, `provider_invalid_response` or `provider_timeout` errors, with only HTTP status when applicable.

Official basis: https://sportsgameodds.com/docs/info/rate-limiting and https://sportsgameodds.com/docs/faq. The FAQ says account usage does not count against rate limits. Remaining usage is a prerequisite for considering score polling, not authorization to increase usage or a claim that results are entitled.

Activation requires approved Worker release, then a request through the existing authenticated owner client. No live usage measurement has been made by this draft; it cannot answer the current quota until deployed and called. Keep separate from the already reviewed grading and false-health releases.
