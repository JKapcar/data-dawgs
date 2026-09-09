/**
 * Synthetic DK Showdown slate for the construction validator tests.
 *
 * INVENTED NUMBERS. Salaries, projections and ownership here are made up to exercise the
 * rule table — they are not any provider's data and must never be replaced with real
 * projections or ownership (C2). AAA is the favourite by 4; BBB is the dog.
 *
 * Roster shape matches the work order's fixture spec: 2 QB, 4 RB, 8 WR, 4 TE, 2 K, 2 DST.
 * Salaries are scaled so the maximum-projection lineup is affordable under the cap, which
 * keeps the relative-projection band reachable in tests.
 */
"use strict";

function P(id, team, pos, salary, proj, own, cptOwn, extra) {
  var p = { id: id, name: id.replace("-", " "), team: team, pos: pos, salary: salary, proj: proj, own: own, cptOwn: cptOwn };
  if (extra) for (var k in extra) p[k] = extra[k];
  return p;
}

var players = [
  // ---- AAA, the favourite ----
  P("AAA-QB1", "AAA", "QB", 8000, 20.0, 0.34, 0.14, { rushShare: 0.05 }),
  P("AAA-RB1", "AAA", "RB", 7400, 16.0, 0.30, 0.09),
  P("AAA-RB2", "AAA", "RB", 4600, 9.0, 0.10, 0.03),
  P("AAA-WR1", "AAA", "WR", 7200, 15.0, 0.33, 0.10),
  P("AAA-WR2", "AAA", "WR", 6100, 12.0, 0.20, 0.05),
  P("AAA-WR3", "AAA", "WR", 4200, 8.0, 0.10, 0.02),
  P("AAA-WR4", "AAA", "WR", 3400, 6.0, 0.06, 0.01),
  P("AAA-TE1", "AAA", "TE", 5200, 11.0, 0.18, 0.04),
  P("AAA-TE2", "AAA", "TE", 2600, 4.0, 0.03, 0.01),
  P("AAA-K1",  "AAA", "K",  3800, 8.5, 0.15, 0.02),
  P("AAA-DST1","AAA", "DST",4100, 9.0, 0.20, 0.03),

  // ---- BBB, the dog. BBB-QB1 is the mobile quarterback. ----
  P("BBB-QB1", "BBB", "QB", 7600, 18.0, 0.28, 0.10, { rushShare: 0.25 }),
  P("BBB-RB1", "BBB", "RB", 7000, 14.0, 0.24, 0.07),
  P("BBB-RB2", "BBB", "RB", 4400, 8.0, 0.09, 0.02),
  P("BBB-WR1", "BBB", "WR", 6800, 13.5, 0.27, 0.08),
  P("BBB-WR2", "BBB", "WR", 5600, 11.0, 0.16, 0.04),
  P("BBB-WR3", "BBB", "WR", 4000, 7.5, 0.08, 0.02),
  P("BBB-WR4", "BBB", "WR", 3200, 5.5, 0.05, 0.01),
  P("BBB-TE1", "BBB", "TE", 4900, 10.0, 0.14, 0.03),
  P("BBB-TE2", "BBB", "TE", 2400, 3.5, 0.02, 0.01),
  P("BBB-K1",  "BBB", "K",  3600, 8.0, 0.12, 0.02),
  P("BBB-DST1","BBB", "DST",3900, 8.5, 0.18, 0.03)
];

/**
 * @param {object} over  fields to override on the slate (spread, favorite, ...)
 * @param {function} mutate  optional (players) => players, for per-test pool edits
 */
function slate(over, mutate) {
  var pool = players.map(function (p) { return Object.assign({}, p); });
  if (mutate) pool = mutate(pool) || pool;
  var s = {
    id: "TEST-AAA-BBB" + (over && over.id ? "-" + over.id : ""),
    home: "AAA",
    away: "BBB",
    favorite: "AAA",
    spread: -4,
    total: 46.5,
    players: pool,
    // Precomputed so the tests do not depend on the optimiser to know the baseline.
    // tests/showdown-validator.test.js asserts computeSlateMaxProj() reproduces it.
    slateMaxProj: 106.5,
    favKickerFieldUsage51: null
  };
  if (over) for (var k in over) s[k] = over[k];
  return s;
}

module.exports = { players: players, slate: slate, P: P };
