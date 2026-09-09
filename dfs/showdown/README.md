# Showdown construction validator

Judges whether a DK Showdown lineup is *built* like the lineups that win, and how likely
it is to be duplicated. It does not build lineups, score them, or tell you they are good.

Rule thresholds are derived from proprietary research. Messages in this module are
deliberately generic — conditions and severities only, never the underlying statistics.
Do not add source numbers, provider names or article references to any file here.

## Scope

DK Showdown only: 6 roster spots, one CPT at 1.5x salary and 1.5x points, a $50,000 cap,
players from exactly two teams. FanDuel single-game is not supported.

The engine is pure and deterministic — no randomness, no network, no clock — so it runs
headless under Node and inside `dfs.html` from the same source.

## Files

| File | What |
|---|---|
| `validator.js` | `validateLineup`, `validatePortfolio`. Holds no thresholds. |
| `rules.js` | The rule table. Tune a rule here without touching engine logic. |
| `dupeRisk.js` | Cumulative / product ownership, relative projection, the risk tier. |
| `construction.js` | Build shape, stack profile, max-projection baseline. |

Each is a UMD module matching the other DFS modules in `work/`: `require()` it in Node,
or read the global (`DDSDValidator`, `DDSDRules`, `DDSDDupe`, `DDSDBuild`) in the browser.
Load order in a browser is construction → rules → dupeRisk → validator.

## Input

### Player

```js
{ id, name, team, pos, salary, proj, own, cptOwn, rushShare }
```

`own` and `cptOwn` are **fractions, 0–1**. The older DFS ingest (`work/dfs-slate-ingest.js`)
carries ownership on a 0–100 scale — divide at the boundary, not inside a rule. Both are
optional; rules that need them are skipped with a `data_missing` note rather than guessed.
`rushShare` is optional and read only for quarterbacks.

### Lineup

```js
{ id, cpt: "<player id>", flex: ["<id>", "<id>", "<id>", "<id>", "<id>"] }
```

### Slate

```js
{ id, home, away, favorite, spread, total, players: [...], slateMaxProj, favKickerFieldUsage51 }
```

`slateMaxProj` is the projection total of the best legal lineup with the captain at 1.5x.
Leave it out and `construction.js` computes it by brute force over the pool and caches it
per slate id — fine for one game's worth of players. A slate with no `id` is recomputed
every call rather than risk a stale baseline for a changed pool.

`favKickerFieldUsage51` is optional; the rule that needs it is skipped when it is absent.

## Output

`validateLineup` returns `{ lineupId, valid, errors, notes, build, cpt, stacks, salary,
proj, ownership, dupeRisk, flags, score }`.

**Legality is not a rule.** A lineup that is not a legal entry — wrong size, over the cap,
a third team, the captain repeated in the flex, an id not on the slate — comes back
`valid:false` with `errors` populated and **no rules evaluated at all**. Grading the
construction of a roster that cannot be entered is advice about nothing.

Each flag is `{ rule, severity, category, message, fix }`, sorted hard → soft → info.
Severity means:

- **hard** — likely a construction error
- **soft** — deviates from what tends to win
- **info** — context only, no judgement implied

`notes` is the honesty channel: every skipped rule and every fallback lands there, so a
missing ownership column reads as *"this was not checked"* rather than *"this passed"*.

`dupeRisk.tier` is one of `severe`, `elevated`, `moderate`, `low`, `unknown`. Expected dupe
*counts* are deliberately not produced — they depend on field size and entry count this
module does not take, and a modelled count reads too easily as a measured one.

`validatePortfolio(lineups, slate)` returns per-lineup results in input order plus
`cptExposure`, `buildMix`, `leverage`, `hardShare` and portfolio flags. Illegal lineups are
returned but excluded from the portfolio maths.

## Adding a rule

1. Append to `RULES` in `rules.js` with a stable, monotonic id. `R21` and `R22` are
   permanently reserved for the portfolio rules `P21`/`P22`.
2. `when(ctx)` returns truthy to fire, `false` to pass, and **`undefined` to skip** when the
   data it needs is absent. Skipping produces a `data_missing` note; returning `false`
   claims the lineup was checked and passed. The difference matters.
3. Set `needs: "ownership"` if the rule reads `ctx.own`, so it is skipped wholesale when
   ownership is incomplete.
4. Write the message and fix without a statistic. If the rule cannot be explained without
   one, it does not belong in this file.
5. Add a firing and a non-firing case to `tests/showdown-validator.test.js`.

`ctx` is `{ cpt, flex, all, build, stacks, own, slate, pool, fired }`. `fired` is the set of
rule ids already matched this pass, which is how the mutually exclusive duplication bands
stay mutually exclusive.

## Conventions worth knowing

- Build types are written **favourite-first**: `5-1` is five favourite and one dog; `1-5`
  is the reverse. `heavySide` is null for a `3-3`, which has no heavy side.
- WR/TE stack counts are **FLEX-only** and relative to the captain's team, so a captain
  receiver with one teammate receiver reads as `sameTeamWRTE: 1`.
- `dstTeammates` counts the players in front of the rostered defense, captain included; the
  defense is not its own teammate.

## Tests

```
node --test tests/showdown-validator.test.js
```

Fixtures are synthetic. Never replace them with real projections or ownership.
