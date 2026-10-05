# The Bozo Menu

Status: implemented on `feat/bozo-menu`; not deployed or production-verified.

A weekly research library with private drafts on `bozo.html#bozoMenu` and a
separate public published menu linked from `bozo-menu.html`. It reuses
Toto, site sign-in, the personal Data Dawgs connector and existing private Firebase
storage. No new service, subscription or credential is needed. Public feeds are served by
the existing Worker.
The menu is the same across the account's Bozo leagues. It never changes a ticket,
league state, submission time or contest entry. Saving a private draft never publishes it. Kap/the site publisher explicitly
publishes a reviewed weekly snapshot that friends and their AIs can read without
signing in. All viewers receive that same full published menu.

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

## Public readers and publishing

Friends can ask a web-enabled AI: “Read https://datadawgs216.com/bozo-menu.html and
give me the full published Bozo Menu.” The page links to server-rendered HTML and
plain text, so retrieval does not depend on JavaScript execution or installing an
MCP connector. The domain is **datadawgs216.com** (with the final “s”). An AI without
web or connector access cannot retrieve the live menu from the prompt alone.

Public endpoints on `https://toto.jkapcar4.workers.dev`:
- `/bozo/menu` — complete server-rendered HTML, no JavaScript required.
- `/bozo/menu.md` — complete text with every candidate and evidence metadata.
- `/bozo/menu.json` — same snapshot plus `published_weeks` archive metadata.

Omit `week` for latest published; `?week=YYYY-MM-DD` reads a Monday-dated archive.
Latest means the newest published week, not a promise that this week's menu exists.
No published menu returns `status: unpublished`, an empty candidate list and the
archive metadata. Every response identifies the week, revision, publication and
retrieval times. No pagination or silent top-N truncation: up to 200 candidates,
including held/scratched rows, are returned. No authentication is required. CORS is
open for reads, writes return 405 and responses use no-store.

`dd_bozo_menu_public` lets any existing authenticated connector read the same
public snapshot. Shared connectors may use this read tool; personal draft tools
remain private. The MCP endpoint itself still uses its existing credentials.

`dd_bozo_menu_publish` / `POST /api/bozo-menu/publish` require a verified site admin,
resolved with the existing site-admin helper. Public storage is a distinct
`/publishedBozoMenus` collection, accessed only through the Worker. Publishing uses
an explicit complete candidate list and the public week's `expected_revision`;
it replaces that weekly snapshot with CAS protection. No private library is read
by a public request or automatically copied on save. Publisher UID is internal and
never appears in the public output.

The publisher UI prepares an editable public JSON copy. It drops private notes,
source evidence, raw edges, judgment adjustments and probabilities by default.
Kap/the research assistant may add Data Dawgs authored summaries and shareable
derived estimates before publishing. Raw subscription exports must stay private;
source names, dates, weights and HTTPS links may be attributed publicly. The public
schema rejects private notes and provider evidence. The UI is a convenience;
server-side identity checks enforce publication rights for both HTTP and MCP.

The public renderer escapes all HTML. These are research candidates, never contest
submissions. Publication does not make quotes current or bets eligible by itself.

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

The five menu tool names remain in `MCP_STAGED` until Worker deployment. A production
release requires Kap's fresh approval per worker-deploy.md. Deploy/verify the Worker
first, then clear those staged names, regenerate the machine catalog/manifest and
publish the page. Verify authenticated browser and MCP access against the same
private week; do not seed test candidates into Kap's production account.

Local release checks passed: 7 feature cases (including all 200 public rows, anonymous reads and publisher checks); DOM interactions; Worker assembly,
syntax and dry-run; identity (144), MCP (453), SwoleDawg (91), backup (14), CFB
capture (29), shared Sleeper/forecast and data validation. Data validation reports
33 existing warnings. The broader Bozo/service-worker run is 179 passed / 7 failed;
all seven failures reproduce on unchanged base: lever-standings extraction,
period-grade scale, period-capture expectation, and four roster-anytime submission
cases. No unrelated contest behavior was changed to accommodate these tests.
