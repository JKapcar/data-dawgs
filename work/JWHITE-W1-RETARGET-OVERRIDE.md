# JWhite Week 1 event retarget — Manager Override clicks

Live board is still **graded**. Name stands: **WBeamen** bozo, **JWhite** won/manual.
No write credentials on the agent box (`FB_SECRET` only on Worker; `/bozo/pick` locked once status ≠ open).
Kap must apply these via **Bozo → Manager Override** path editor (`/bozo/admin`).

Do **NOT** clear `status`, `bozo`, `bozoWhy`, or any `results/*` fields.

## Identity
- Pick key: `u_WhLmntWVKztNQGVQrb9QJ6Wp` (JWhite)
- Ledger key: `2026-w1-u_WhLmntWVKztNQGVQrb9QJ6Wp`
- Keep: `mkt=ml`, `side=PHI`, `label=PHI ML`, result won/manual, bozo=`u_jB8bcHGRWWttcRceQ7szbhRw`

## Before → after
| Field | Before | After |
|---|---|---|
| eventId | `401872939` | `401872929` |
| game | `PHI @ TEN` | `WAS @ PHI` |
| startsAt | `2026-09-20T17:00:00.000Z` | `2026-09-13T20:25:00.000Z` |
| (final) | still pre | WAS 22 @ PHI 24 |

## Exact path writes (Load → edit JSON → Write it)

### Live pick (`picks/…`)
1. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/eventId` → `"401872929"`
2. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/espnEventId` → `"401872929"`
3. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/game` → `"WAS @ PHI"`
4. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/startsAt` → `"2026-09-13T20:25:00.000Z"`
5. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/commenceTime` → `"2026-09-13T20:25:00.000Z"`
6. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/canonicalKey` → `"nfl|philadelphiaeagles~washingtoncommanders|2026-09-13"`
7. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/providerEventIds` → `{"sgo":"xnZBKrx0t2wyONucMxW8"}`
8. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/marketKey` → `"401872929|ml|"`
9. `picks/u_WhLmntWVKztNQGVQrb9QJ6Wp/selectionKey` → `"401872929|ml|PHI||"`

### Permanent receipt (`ledger/…`) — same week already has gradedAt
10. `ledger/2026-w1-u_WhLmntWVKztNQGVQrb9QJ6Wp/eventId` → `"401872929"`
11. `ledger/2026-w1-u_WhLmntWVKztNQGVQrb9QJ6Wp/game` → `"WAS @ PHI"`
12. `ledger/2026-w1-u_WhLmntWVKztNQGVQrb9QJ6Wp/startsAt` → `"2026-09-13T20:25:00.000Z"`
13. `ledger/2026-w1-u_WhLmntWVKztNQGVQrb9QJ6Wp/selectionKey` → `"401872929|ml|PHI||"`

## Verify after
- Board shows JWhite → WAS @ PHI, eventId `401872929`, startsAt 2026-09-13
- `status` still `graded`
- `bozo` still `u_jB8bcHGRWWttcRceQ7szbhRw` (WBeamen)
- `results/u_WhLmntWVKztNQGVQrb9QJ6Wp` still `won` / `resultSource: manual`
