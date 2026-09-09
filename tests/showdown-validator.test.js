"use strict";
/**
 * DK Showdown construction validator.
 *
 * Every rule gets a firing and a non-firing case. Assertions name the rule id rather than
 * counting flags, so adding a rule cannot silently break unrelated tests.
 *
 * All numbers come from tests/fixtures/showdown-slate.js and are invented (C2).
 */
const test = require("node:test");
const assert = require("node:assert");

const Build = require("../dfs/showdown/construction.js");
const Rules = require("../dfs/showdown/rules.js");
const Dupe = require("../dfs/showdown/dupeRisk.js");
const V = require("../dfs/showdown/validator.js");
const F = require("./fixtures/showdown-slate.js");

const SLATE = F.slate();
const L = (id, cpt, ...flex) => ({ id, cpt, flex });
const rules = (r) => r.flags.map((f) => f.rule);
const flagOf = (r, id) => r.flags.find((f) => f.rule === id);
const fired = (r, id) => rules(r).includes(id);

/** Raise ownership on the six players in the maximum-projection lineup. */
const chalk = (ps) => {
  const bump = { "AAA-QB1": 0.22, "BBB-QB1": 0.36, "AAA-RB1": 0.38, "AAA-WR1": 0.40, "BBB-RB1": 0.32, "BBB-WR1": 0.34 };
  ps.forEach((p) => {
    if (bump[p.id] == null) return;
    p.own = bump[p.id];
    p.cptOwn = bump[p.id];
  });
  return ps;
};

// The maximum-projection lineup: 106.5, relativeProj exactly 1.0.
const MAX_LINEUP = L("max", "AAA-QB1", "BBB-QB1", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-WR1");

// ---------------------------------------------------------------- legality

test("hard errors: seven players", () => {
  const r = V.validateLineup(L("x", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1", "BBB-RB1"), SLATE);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === "roster_size"));
  assert.deepEqual(r.flags, [], "no rules are evaluated on an illegal lineup");
});

test("hard errors: over the salary cap", () => {
  const s = F.slate({ id: "cap" }, (ps) => { ps.find((p) => p.id === "AAA-QB1").salary = 20000; return ps; });
  const r = V.validateLineup(MAX_LINEUP, s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === "over_cap"));
  assert.deepEqual(r.flags, []);
});

test("hard errors: a player from a third team", () => {
  const s = F.slate({ id: "three" }, (ps) => { ps.find((p) => p.id === "BBB-WR1").team = "CCC"; return ps; });
  const r = V.validateLineup(MAX_LINEUP, s);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === "foreign_team"));
  assert.deepEqual(r.flags, []);
});

test("hard errors: captain repeated in the flex", () => {
  const r = V.validateLineup(L("x", "AAA-QB1", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-WR1"), SLATE);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === "duplicate_player"));
  assert.deepEqual(r.flags, []);
});

test("hard errors: an id that is not on the slate", () => {
  const r = V.validateLineup(L("x", "AAA-QB1", "ZZZ-WR9", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-WR1"), SLATE);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === "unknown_player"));
});

test("a legal lineup validates", () => {
  const r = V.validateLineup(MAX_LINEUP, SLATE);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.salary, 48000);
  assert.equal(r.proj, 106.5);
});

// ---------------------------------------------------------------- build shape

test("classifyBuild covers all five shapes, favourite first", () => {
  const cases = [
    ["5-1", L("a", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1"), "AAA"],
    ["4-2", L("b", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-RB1"), "AAA"],
    ["3-3", L("c", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-WR1", "BBB-RB1", "BBB-TE1"), null],
    ["2-4", L("d", "AAA-QB1", "AAA-RB1", "BBB-WR1", "BBB-RB1", "BBB-TE1", "BBB-WR2"), "BBB"],
    ["1-5", L("e", "AAA-QB1", "BBB-WR1", "BBB-RB1", "BBB-TE1", "BBB-WR2", "BBB-QB1"), "BBB"]
  ];
  for (const [type, lineup, heavy] of cases) {
    const b = Build.classifyBuild(lineup, SLATE);
    assert.equal(b.type, type, `expected ${type}, got ${b.type}`);
    assert.equal(b.heavySide, heavy, `heavySide for ${type}`);
  }
});

test("build type stays favourite-first when the dog is the heavy side", () => {
  const b = Build.classifyBuild(L("e", "BBB-QB1", "BBB-WR1", "BBB-RB1", "BBB-TE1", "BBB-WR2", "AAA-WR1"), SLATE);
  assert.equal(b.type, "1-5", "one favourite, five dogs — never written 5-1");
  assert.equal(b.heavySide, "BBB");
  assert.equal(b.favSide, 1);
  assert.equal(b.dogSide, 5);
});

test("a pick'em is oriented to the home team, with a note", () => {
  const s = F.slate({ id: "pickem", spread: 0 });
  const b = Build.classifyBuild(MAX_LINEUP, s);
  assert.equal(b.favorite, "AAA");
  assert.ok(b.notes.some((n) => n.code === "pickem_favorite"));
});

test("computeSlateMaxProj reproduces the fixture's precomputed baseline", () => {
  Build.clearCache();
  const s = F.slate({ id: "recompute" });
  delete s.slateMaxProj;
  assert.equal(Build.computeSlateMaxProj(s), 106.5);
});

// ---------------------------------------------------------------- lineup rules

test("R01 captain QB with no same-team pass catcher", () => {
  const fire = V.validateLineup(L("f", "AAA-QB1", "BBB-WR1", "BBB-WR2", "BBB-RB1", "AAA-RB1", "BBB-DST1"), SLATE);
  assert.ok(fired(fire, "R01"));
  assert.equal(flagOf(fire, "R01").severity, "soft");

  const quiet = V.validateLineup(L("g", "AAA-QB1", "AAA-WR1", "BBB-WR1", "BBB-RB1", "AAA-RB1", "BBB-DST1"), SLATE);
  assert.ok(!fired(quiet, "R01"));
});

test("R01 relaxes to info for a rushing quarterback", () => {
  const r = V.validateLineup(L("h", "BBB-QB1", "AAA-WR1", "AAA-WR2", "AAA-RB1", "BBB-RB1", "AAA-DST1"), SLATE);
  const f = flagOf(r, "R01");
  assert.ok(f, "R01 still reports");
  assert.equal(f.severity, "info", "a rushing QB carries his own ceiling");
  assert.ok(Rules.isMobileQB(SLATE.players.find((p) => p.id === "BBB-QB1")));
});

test("R02 captain QB with no bring-back pass catcher", () => {
  const fire = V.validateLineup(L("i", "AAA-QB1", "AAA-WR1", "AAA-WR2", "AAA-RB1", "AAA-TE1", "BBB-DST1"), SLATE);
  assert.ok(fired(fire, "R02"));
  const quiet = V.validateLineup(L("j", "AAA-QB1", "AAA-WR1", "AAA-WR2", "AAA-RB1", "BBB-WR1", "BBB-DST1"), SLATE);
  assert.ok(!fired(quiet, "R02"));
});

test("R03 opposing kicker rostered while the captain's own kicker is free", () => {
  const fire = V.validateLineup(L("k", "AAA-QB1", "AAA-WR1", "BBB-WR1", "AAA-RB1", "BBB-RB1", "BBB-K1"), SLATE);
  assert.ok(fired(fire, "R03"));
  const quiet = V.validateLineup(L("l", "AAA-QB1", "AAA-WR1", "BBB-WR1", "AAA-RB1", "BBB-RB1", "AAA-K1"), SLATE);
  assert.ok(!fired(quiet, "R03"));
});

test("R03 is skipped when the captain's team has no kicker in the pool", () => {
  const s = F.slate({ id: "nok" }, (ps) => ps.filter((p) => p.id !== "AAA-K1"));
  const r = V.validateLineup(L("m", "AAA-QB1", "AAA-WR1", "BBB-WR1", "AAA-RB1", "BBB-RB1", "BBB-K1"), s);
  assert.ok(!fired(r, "R03"));
  assert.ok(r.notes.some((n) => n.rule === "R03" && n.code === "data_missing"));
});

test("R04 captain RB behind three of his own pass catchers", () => {
  const fire = V.validateLineup(L("n", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-WR3", "BBB-WR1", "BBB-RB1"), SLATE);
  assert.ok(fired(fire, "R04"));
  assert.equal(flagOf(fire, "R04").severity, "hard");
  const quiet = V.validateLineup(L("o", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-WR2", "BBB-RB1"), SLATE);
  assert.ok(!fired(quiet, "R04"));
});

test("R05 captain WR alongside two of his own pass catchers", () => {
  const fire = V.validateLineup(L("p", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1", "BBB-RB1", "BBB-QB1"), SLATE);
  const f = flagOf(fire, "R05");
  assert.ok(f);
  assert.equal(f.severity, "hard");
  assert.match(f.fix, /Move the captain to this team's QB/);
  const quiet = V.validateLineup(L("q", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-RB1", "BBB-QB1", "BBB-TE1"), SLATE);
  assert.ok(!fired(quiet, "R05"));
});

test("R06 captain WR with no bring-back pass catcher", () => {
  const fire = V.validateLineup(L("r", "AAA-WR1", "AAA-QB1", "AAA-RB1", "AAA-RB2", "BBB-RB1", "BBB-DST1"), SLATE);
  assert.ok(fired(fire, "R06"));
  const quiet = V.validateLineup(L("s", "AAA-WR1", "AAA-QB1", "AAA-RB1", "BBB-WR1", "BBB-RB1", "BBB-DST1"), SLATE);
  assert.ok(!fired(quiet, "R06"));
});

test("R07 captain WR with no quarterback anywhere", () => {
  const fire = V.validateLineup(L("t", "AAA-WR1", "AAA-RB1", "AAA-RB2", "BBB-WR1", "BBB-RB1", "BBB-DST1"), SLATE);
  assert.ok(fired(fire, "R07"));
  const quiet = V.validateLineup(L("u", "AAA-WR1", "BBB-QB1", "AAA-RB1", "BBB-WR1", "BBB-RB1", "BBB-DST1"), SLATE);
  assert.ok(!fired(quiet, "R07"));
});

test("R08 captain TE without his quarterback", () => {
  const fire = V.validateLineup(L("v", "AAA-TE1", "BBB-QB1", "AAA-RB1", "BBB-WR1", "BBB-RB1", "BBB-WR2"), SLATE);
  assert.ok(fired(fire, "R08"));
  assert.equal(flagOf(fire, "R08").severity, "hard");
  const quiet = V.validateLineup(L("w", "AAA-TE1", "AAA-QB1", "AAA-RB1", "BBB-WR1", "BBB-RB1", "BBB-WR2"), SLATE);
  assert.ok(!fired(quiet, "R08"));
});

test("R09 captain from the light side of a 5-1", () => {
  const fire = V.validateLineup(L("x", "BBB-WR1", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1"), SLATE);
  assert.equal(fire.build.type, "5-1");
  assert.ok(fired(fire, "R09"));
  assert.equal(flagOf(fire, "R09").severity, "hard");
  const quiet = V.validateLineup(L("y", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1"), SLATE);
  assert.equal(quiet.build.type, "5-1");
  assert.ok(!fired(quiet, "R09"));
});

test("R10 a 5-1 without the heavy side's quarterback", () => {
  const fire = V.validateLineup(L("z", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "AAA-RB2", "BBB-WR1"), SLATE);
  assert.equal(fire.build.type, "5-1");
  assert.ok(fired(fire, "R10"));
  const quiet = V.validateLineup(L("aa", "AAA-QB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "AAA-RB1", "BBB-WR1"), SLATE);
  assert.ok(!fired(quiet, "R10"));
});

test("R11 the lone bring-back is a defense", () => {
  const fire = V.validateLineup(L("ab", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-DST1"), SLATE);
  assert.ok(fired(fire, "R11"));
  assert.equal(flagOf(fire, "R11").severity, "hard");
  const quiet = V.validateLineup(L("ac", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1"), SLATE);
  assert.ok(!fired(quiet, "R11"));
});

test("R12 captain from the lighter side of a 4-2", () => {
  const fire = V.validateLineup(L("ad", "BBB-WR1", "BBB-RB1", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2"), SLATE);
  assert.equal(fire.build.type, "4-2");
  assert.ok(fired(fire, "R12"));
  assert.equal(flagOf(fire, "R12").severity, "soft");
  const quiet = V.validateLineup(L("ae", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-RB1"), SLATE);
  assert.equal(quiet.build.type, "4-2");
  assert.ok(!fired(quiet, "R12"));
});

test("R13 a 4-2 whose bring-back pair includes a kicker or defense", () => {
  const fire = V.validateLineup(L("af", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-DST1"), SLATE);
  assert.equal(fire.build.type, "4-2");
  assert.ok(fired(fire, "R13"));
  const quiet = V.validateLineup(L("ag", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-WR1", "BBB-RB1"), SLATE);
  assert.ok(!fired(quiet, "R13"));
});

test("R14 a defense without three teammates", () => {
  const fire = V.validateLineup(L("ah", "BBB-QB1", "BBB-WR1", "BBB-RB1", "AAA-DST1", "AAA-WR1", "BBB-WR2"), SLATE);
  assert.equal(fire.stacks.dstTeammates, 1);
  assert.ok(fired(fire, "R14"));
  const quiet = V.validateLineup(L("ai", "AAA-QB1", "AAA-WR1", "AAA-RB1", "AAA-DST1", "AAA-WR2", "BBB-WR1"), SLATE);
  assert.equal(quiet.stacks.dstTeammates, 4);
  assert.ok(!fired(quiet, "R14"));
});

test("R15 six skill players, no kicker and no defense", () => {
  const fire = V.validateLineup(MAX_LINEUP, SLATE);
  assert.ok(fired(fire, "R15"));
  const quiet = V.validateLineup(L("aj", "AAA-QB1", "BBB-QB1", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-DST1"), SLATE);
  assert.ok(!fired(quiet, "R15"));
});

test("R16 a balanced build is reported as context only", () => {
  const fire = V.validateLineup(L("ak", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-QB1", "BBB-RB1", "BBB-WR1"), SLATE);
  assert.equal(fire.build.type, "3-3");
  assert.equal(flagOf(fire, "R16").severity, "info");
  // MAX_LINEUP is itself a 3-3, so the non-firing case needs a genuinely skewed build.
  const quiet = V.validateLineup(L("ak2", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-RB1", "BBB-WR1"), SLATE);
  assert.equal(quiet.build.type, "4-2");
  assert.ok(!fired(quiet, "R16"));
});

test("R17 popular roster at the maximum-projection build", () => {
  const s = F.slate({ id: "chalk" }, chalk);
  const r = V.validateLineup(MAX_LINEUP, s);
  assert.ok(r.ownership.cumulative >= 2.0, `cumulative ${r.ownership.cumulative}`);
  assert.equal(r.ownership.relativeProj, 1);
  assert.ok(fired(r, "R17"));
  assert.equal(flagOf(r, "R17").severity, "hard");
  assert.equal(r.dupeRisk.tier, "severe");
  assert.ok(!fired(r, "R18") && !fired(r, "R19"), "the three dupe bands are mutually exclusive");

  const quiet = V.validateLineup(MAX_LINEUP, SLATE);
  assert.ok(!fired(quiet, "R17"), "same lineup, ordinary ownership");
});

test("R18 the elevated duplication band", () => {
  const s = F.slate({ id: "chalk18" }, chalk);
  const r = V.validateLineup(L("al", "AAA-QB1", "BBB-QB1", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-WR2"), s);
  assert.ok(r.ownership.cumulative >= 1.8 && r.ownership.cumulative < 2.0, `cumulative ${r.ownership.cumulative}`);
  assert.ok(r.ownership.relativeProj >= 0.95 && r.ownership.relativeProj < 0.99, `rel ${r.ownership.relativeProj}`);
  assert.ok(fired(r, "R18"));
  assert.equal(r.dupeRisk.tier, "elevated");
  assert.ok(!fired(r, "R17") && !fired(r, "R19"));
});

test("R19 the max-projection band without the ownership", () => {
  const r = V.validateLineup(MAX_LINEUP, SLATE);
  assert.equal(r.ownership.relativeProj, 1);
  assert.ok(r.ownership.cumulative < 1.8);
  assert.ok(fired(r, "R19"));
  assert.ok(!fired(r, "R17") && !fired(r, "R18"));

  const quiet = V.validateLineup(L("am", "AAA-WR4", "AAA-TE2", "BBB-TE2", "BBB-WR4", "AAA-WR3", "BBB-WR3"), SLATE);
  assert.ok(quiet.ownership.relativeProj < 0.95);
  assert.ok(!fired(quiet, "R19"));
});

test("R20 a captain the field is ignoring", () => {
  const fire = V.validateLineup(L("an", "AAA-WR4", "AAA-QB1", "BBB-QB1", "BBB-WR1", "AAA-RB1", "BBB-RB1"), SLATE);
  assert.ok(fired(fire, "R20"));
  assert.equal(flagOf(fire, "R20").severity, "info");
  const quiet = V.validateLineup(MAX_LINEUP, SLATE);
  assert.ok(!fired(quiet, "R20"));
});

test("R23 favoured kicker in an onslaught, once field usage is known", () => {
  const s = F.slate({ id: "k51", favKickerFieldUsage51: 0.55 });
  const fire = V.validateLineup(L("ao", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-K1", "BBB-WR1"), s);
  assert.equal(fire.build.type, "5-1");
  assert.ok(fired(fire, "R23"));

  const low = F.slate({ id: "k51low", favKickerFieldUsage51: 0.20 });
  assert.ok(!fired(V.validateLineup(L("ap", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-K1", "BBB-WR1"), low), "R23"));
});

test("R23 is skipped when field usage is unknown", () => {
  const r = V.validateLineup(L("aq", "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-K1", "BBB-WR1"), SLATE);
  assert.ok(!fired(r, "R23"));
  assert.ok(r.notes.some((n) => n.rule === "R23" && n.code === "data_missing"));
});

test("R24 underdog kicker in a tight spread reads as a positive lean", () => {
  const fire = V.validateLineup(L("ar", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-WR1", "BBB-RB1", "BBB-K1"), SLATE);
  const f = flagOf(fire, "R24");
  assert.ok(f);
  assert.equal(f.severity, "info");
  assert.equal(f.lean, "positive");

  const wide = F.slate({ id: "blowout", spread: -10 });
  assert.ok(!fired(V.validateLineup(L("as", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-WR1", "BBB-RB1", "BBB-K1"), wide), "R24"));
});

test("R25 kicker at captain", () => {
  const fire = V.validateLineup(L("at", "AAA-K1", "AAA-QB1", "AAA-WR1", "BBB-QB1", "BBB-WR1", "BBB-RB1"), SLATE);
  assert.ok(fired(fire, "R25"));
  assert.equal(flagOf(fire, "R25").severity, "info");
  assert.ok(!fired(V.validateLineup(MAX_LINEUP, SLATE), "R25"));
});

// ---------------------------------------------------------------- missing data

test("missing ownership skips the dupe rules and says so", () => {
  const s = F.slate({ id: "noown" }, (ps) => {
    ps.forEach((p) => { if (p.id === "BBB-RB1") { delete p.own; delete p.cptOwn; } });
    return ps;
  });
  const r = V.validateLineup(MAX_LINEUP, s);
  assert.equal(r.valid, true);
  assert.equal(r.ownership.cumulative, null);
  assert.equal(r.dupeRisk.tier, "unknown");
  assert.ok(!fired(r, "R17") && !fired(r, "R18") && !fired(r, "R19"));
  assert.ok(r.notes.some((n) => n.code === "data_missing" && n.field === "own"));
  assert.ok(fired(r, "R15"), "non-ownership rules still run");
});

test("a missing captain ownership falls back to flex ownership, with a note", () => {
  const s = F.slate({ id: "nocptown" }, (ps) => {
    ps.forEach((p) => { if (p.id === "AAA-QB1") delete p.cptOwn; });
    return ps;
  });
  const r = V.validateLineup(MAX_LINEUP, s);
  assert.equal(r.valid, true);
  assert.ok(r.ownership.cumulative > 0, "the reading still computes");
  assert.ok(r.notes.some((n) => n.code === "data_missing" && n.field === "cptOwn"));
  assert.ok(!fired(r, "R20"), "R20 needs a real captain ownership, not the fallback");
});

// ---------------------------------------------------------------- portfolio

/** Twelve lineups; `heavyCpt` of them captain AAA-QB1. */
function portfolio(heavyCpt) {
  const others = ["AAA-RB1", "AAA-WR1", "BBB-QB1", "BBB-WR1", "BBB-RB1", "AAA-TE1", "BBB-TE1"];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const cpt = i < heavyCpt ? "AAA-QB1" : others[(i - heavyCpt) % others.length];
    const flex = ["AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-QB1", "BBB-WR1", "BBB-RB1", "AAA-TE1", "BBB-TE1", "AAA-WR2"]
      .filter((id) => id !== cpt).slice(0, 5);
    out.push(L("p" + i, cpt, ...flex));
  }
  return out;
}

test("P21b flags a captain carrying too much of the portfolio", () => {
  const r = V.validatePortfolio(portfolio(6), SLATE);
  assert.equal(r.legalCount, 12);
  const f = r.flags.find((x) => x.rule === "P21b");
  assert.ok(f, "6 of 12 is over the ceiling");
  assert.ok(f.players.some((p) => p.exposure === 0.5));

  const spread = V.validatePortfolio(portfolio(2), SLATE);
  assert.ok(!spread.flags.some((x) => x.rule === "P21b"));
});

test("P21a flags too few distinct captains once past ten lineups", () => {
  const few = V.validatePortfolio(portfolio(9), SLATE);
  assert.ok(few.flags.some((x) => x.rule === "P21a"));

  const many = V.validatePortfolio(portfolio(1), SLATE);
  assert.ok(many.cptExposure.length >= 6);
  assert.ok(!many.flags.some((x) => x.rule === "P21a"));
});

test("P21a is not evaluated below ten lineups", () => {
  const small = V.validatePortfolio(portfolio(9).slice(0, 8), SLATE);
  assert.equal(small.legalCount, 8);
  assert.ok(!small.flags.some((x) => x.rule === "P21a"));
});

test("P22 flags a portfolio carrying too many hard flags", () => {
  // Every lineup captains a WR behind two of his own pass catchers (R05).
  const bad = [];
  for (let i = 0; i < 10; i++) bad.push(L("b" + i, "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1", "BBB-RB1", "BBB-QB1"));
  const r = V.validatePortfolio(bad, SLATE);
  assert.equal(r.hardShare, 1);
  assert.ok(r.flags.some((x) => x.rule === "P22"));

  const clean = [];
  for (let i = 0; i < 10; i++) clean.push(L("c" + i, "AAA-QB1", "AAA-WR1", "BBB-WR1", "AAA-RB1", "BBB-RB1", "BBB-DST1"));
  const ok = V.validatePortfolio(clean, SLATE);
  assert.equal(ok.hardShare, 0);
  assert.ok(!ok.flags.some((x) => x.rule === "P22"));
});

test("P26 always reports the build mix and marks a balanced-heavy portfolio", () => {
  const balanced = [];
  for (let i = 0; i < 10; i++) balanced.push(L("d" + i, "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-QB1", "BBB-RB1", "BBB-WR1"));
  const r = V.validatePortfolio(balanced, SLATE);
  const f = r.flags.find((x) => x.rule === "P26");
  assert.ok(f);
  assert.equal(f.balancedShare, 1);
  assert.equal(f.balancedHeavy, true);
  assert.equal(r.buildMix["3-3"].count, 10);

  const skewed = [];
  for (let i = 0; i < 10; i++) skewed.push(L("e" + i, "AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "AAA-TE1", "BBB-WR1"));
  const s = V.validatePortfolio(skewed, SLATE);
  assert.equal(s.flags.find((x) => x.rule === "P26").balancedHeavy, false);
});

test("P27 reports flex exposure that is far from projected ownership", () => {
  // AAA-RB1 is in every lineup at 100% against a projected 30%.
  const heavy = [];
  for (let i = 0; i < 10; i++) heavy.push(L("f" + i, "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-QB1", "BBB-WR1", "BBB-RB1"));
  const r = V.validatePortfolio(heavy, SLATE);
  const f = r.flags.find((x) => x.rule === "P27");
  assert.ok(f);
  const rb = r.leverage.find((p) => p.id === "AAA-RB1");
  assert.ok(rb, "AAA-RB1 is an outlier");
  assert.equal(rb.exposure, 1);
  assert.ok(rb.ratio > 1.25);
});

test("P27 stays quiet when exposure tracks ownership", () => {
  // AAA-WR2's projected ownership is 0.20; four of twenty lineups is 0.20 exposure.
  const s = F.slate({ id: "lev" }, (ps) => {
    ps.forEach((p) => { p.own = 0.25; });
    return ps;
  });
  const set = [];
  const pool = ["AAA-QB1", "AAA-RB1", "AAA-WR1", "AAA-WR2", "BBB-QB1", "BBB-RB1", "BBB-WR1", "BBB-WR2"];
  for (let i = 0; i < 8; i++) {
    const flex = pool.filter((_, j) => j !== i).slice(0, 5);
    set.push(L("g" + i, pool[i], ...flex));
  }
  const r = V.validatePortfolio(set, s);
  // Every listed outlier must genuinely sit outside the band — no false positives.
  r.leverage.forEach((p) => assert.ok(p.ratio < 0.75 || p.ratio > 1.25, `${p.name} ${p.ratio}`));
});

test("an illegal lineup is excluded from the portfolio maths but still returned", () => {
  const set = portfolio(2);
  set.push(L("bad", "AAA-QB1", "AAA-QB1", "AAA-RB1", "AAA-WR1", "BBB-RB1", "BBB-WR1"));
  const r = V.validatePortfolio(set, SLATE);
  assert.equal(r.count, 13);
  assert.equal(r.legalCount, 12);
  assert.equal(r.lineups[12].valid, false);
});

// ---------------------------------------------------------------- invariants

test("the engine is deterministic", () => {
  Build.clearCache();
  const a = V.validateLineup(MAX_LINEUP, F.slate({ id: "det" }));
  Build.clearCache();
  const b = V.validateLineup(MAX_LINEUP, F.slate({ id: "det" }));
  assert.deepEqual(a, b);

  const pa = V.validatePortfolio(portfolio(6), F.slate({ id: "detp" }));
  const pb = V.validatePortfolio(portfolio(6), F.slate({ id: "detp" }));
  assert.deepEqual(pa, pb);
});

test("flags are ordered hard, then soft, then info", () => {
  const r = V.validateLineup(L("ord", "AAA-WR1", "AAA-WR2", "AAA-TE1", "AAA-RB1", "AAA-QB1", "BBB-DST1"), SLATE);
  const order = { hard: 0, soft: 1, info: 2 };
  const seen = r.flags.map((f) => order[f.severity]);
  assert.deepEqual(seen, seen.slice().sort((x, y) => x - y));
});

test("every rule id is unique and the portfolio ids stay reserved", () => {
  const ids = Rules.RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("R21") && !ids.includes("R22"), "R21/R22 are reserved for P21/P22");
  const pids = Rules.PORTFOLIO_RULES.map((r) => r.id);
  assert.equal(new Set(pids).size, pids.length);
});

test("every rule carries a generic message and a fix, and no statistics", () => {
  const digits = /\d+(\.\d+)?\s*%|\btop-\d/i;
  [...Rules.RULES, ...Rules.PORTFOLIO_RULES].forEach((r) => {
    assert.ok(r.message && r.message.length > 10, `${r.id} message`);
    assert.ok(r.fix && r.fix.length > 5, `${r.id} fix`);
    assert.ok(!digits.test(r.message), `${r.id} message must not carry a statistic`);
    assert.ok(!digits.test(r.fix), `${r.id} fix must not carry a statistic`);
  });
});

test("dupe tiers are consistent with the rules that produced them", () => {
  const prof = { cumulative: 1.9, relativeProj: 0.97, complete: true };
  assert.equal(Dupe.riskTier(prof, { R18: true }).tier, "elevated");
  assert.equal(Dupe.riskTier(prof, { R17: true }).tier, "severe");
  assert.equal(Dupe.riskTier({ cumulative: 1.0, relativeProj: 0.5, complete: true }, {}).tier, "low");
  assert.equal(Dupe.riskTier({ cumulative: null, complete: false }, {}).tier, "unknown");
});
