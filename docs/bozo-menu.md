# The Bozo Menu

Status: implemented on `feat/bozo-menu`; not deployed or production-verified.

A private, account-scoped weekly research library on `bozo.html#bozoMenu`. It reuses
Toto, site sign-in, the personal Data Dawgs connector and existing private Firebase
storage. No new service, subscription, credential or public research feed is needed.
The menu is the same across the account's Bozo leagues. It never changes a ticket,
league state, submission time or contest entry. This version does not share menus
with other league members automatically.

## User workflow

1. Supply a candidate list in chat and ask: “Save these to The Bozo Menu for the week
   beginning October 5, 2026.” The assistant should read the week before saving it.
2. Open The Bozo Menu on the Bozo page. Select a saved week or open a new Monday date.
3. Filter keep / downgrade / hold / scratch. Expand evidence for provider dates and
   weights. Update a candidate via the JSON editor or through the connector.
4. Download a weekly JSON menu, or import an exported menu / candidate array with
   preview before save. Stable IDs update rows; omitted rows stay. Mark a rejected
   candidate scratch so its reason remains available.

Sources and probabilities are supplied research, not computed or refreshed by this
feature. There is no built-in PFF/SP+ scraper. No historical list is preloaded as if
its quotes were current. Missing fields stay missing. Displayed quote freshness is
a one-hour reminder, not an assurance that any quote is still available. The target
band is inclusive −200 through −500; actual league rules and deadlines still govern.
All displayed schedules and timestamps use Eastern Time.

## Personal connector tools and HTTP API

| Operation | MCP (core and full) | HTTP |
|---|---|---|
| Weekly index | `dd_bozo_menu_list` | `GET /api/bozo-menu/list` |
| Read week | `dd_bozo_menu_get` | `GET /api/bozo-menu/get?week=2026-10-05` |
| Upsert candidates | `dd_bozo_menu_save` | `POST /api/bozo-menu/save` |

HTTP uses existing `X-Bozo-Session` (or `X-Dawg-Session`) authentication. MCP requires
a personal connector; shared connections cannot read or write menus. Never place a
credential in a menu, public example or repository. The server derives ownership
from verified identity, not the request body. Both interfaces use the same schema,
validation and persistence functions in `bozo-menu.mjs`.

Save arguments: `week` (Monday YYYY-MM-DD), `expected_revision` (0 for a new week),
optional `title`, and `candidates` (1–200 complete rows). Each row requires `id`,
`event`, `sport`, `market`, `selection`, `status` and `reason`. `menuSchema('save')`
is the canonical machine-readable schema and is advertised by tools/list.

Optional fields include kickoff, rank, base and alternate quotes, raw and adjusted
edges, sources with dates/weights/evidence/URLs, screening timestamp, probability
with basis, worst acceptable offer, notes and result. Quotes must include line,
American odds, sportsbook and quote timestamp; null line is allowed for moneyline.
Spreads use the printed sign (+7 means receiving seven points), not the contest
Worker's internal inverted sign convention. No automatic conversion or submission
is performed. Edge units and definition are explicit; point edges are never
translated into hit probabilities. Edited rows replace their whole previous row.

Storage: `/users/<verified uid>/bozoMenus`, outside the publicly readable `/bozo`
collection. Responses use no-store. ETag compare-and-set protects the whole library,
and per-week revisions refuse stale edits with HTTP 409. No deletion route; limits
are 104 weeks / 2 MB, 200 rows per week and 250 KB per HTTP import. Server timestamps
record updates. This is a weekly library, not an immutable forecast receipt ledger:
corrections replace rows, and closing prices are not automatically collected.

## Validation and release

Run the feature suites and the standard Worker release checks in worker-deploy.md.
The feature suites (`node --test tests/bozo-menu*.test.mjs` and
`DDFS_JSDOM=<installed jsdom path> node work/test-bozo-menu-ui.mjs`) exercise
DOM import/edit/filter/logout behavior and real API + MCP dispatch with isolated storage, account
isolation, concurrent writes, malformed imports, quote-state boundaries and no
contest writes. Browser rendering still needs visual verification where a preview
browser is available.

The three tool names remain in `MCP_STAGED` until Worker deployment. A production
release requires Kap's fresh approval per worker-deploy.md. Deploy/verify the Worker
first, then clear those staged names, regenerate the machine catalog/manifest and
publish the page. Verify authenticated browser and MCP access against the same
private week; do not seed test candidates into Kap's production account.

Local release checks passed: 6 feature cases; DOM interactions; Worker assembly,
syntax and dry-run; identity (144), MCP (453), SwoleDawg (91), backup (14), CFB
capture (29), shared Sleeper/forecast and data validation. Data validation reports
33 existing warnings. The broader Bozo/service-worker run is 179 passed / 7 failed;
all seven failures reproduce on unchanged base: lever-standings extraction,
period-grade scale, period-capture expectation, and four roster-anytime submission
cases. No unrelated contest behavior was changed to accommodate these tests.
