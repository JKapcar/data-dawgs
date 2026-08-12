import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { validateQuestionBank } from "../scripts/validate-ddcc-questions.mjs";

const require = createRequire(import.meta.url);
const Core = require("./ddcc-core.js");
const bank = JSON.parse(fs.readFileSync(new URL("../private/ddcc-question-library.json", import.meta.url), "utf8"));

function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("question library schema and active counts validate", () => {
  const report = validateQuestionBank(bank);
  assert.deepEqual(report.errors, []);
  assert.equal(Object.values(report.counts).reduce((n, c) => n + c.active, 0), 80);
});

test("question validation fails closed on structural and duplicate defects", () => {
  const broken = bank.map(q => ({ ...q, secondaryTags: [...q.secondaryTags] }));
  broken[1].id = broken[0].id;
  broken[1].claim = "  " + broken[0].claim.replace(/\s+/g, "   ").toUpperCase() + "  ";
  broken[1].sourceUrl = "not a URL";
  broken[1].verified = false;
  const errors = validateQuestionBank(broken).errors.join("\n");
  assert.match(errors, /duplicate id/);
  assert.match(errors, /duplicate normalized claim/);
  assert.match(errors, /sourceUrl must be an absolute/);
  assert.match(errors, /active questions must be verified/);
});

test("selection creates exactly 40 unique questions and two per domain", () => {
  const picked = Core.selectQuestionSet(bank, [], seeded(216));
  assert.equal(picked.length, 40);
  assert.equal(new Set(picked.map(q => q.id)).size, 40);
  for (const domain of Core.DOMAIN_KEYS)
    assert.equal(picked.filter(q => q.domain === domain).length, 2, domain);
  assert.equal(Core.validateAttempt(picked.map(q => q.id), bank), true);
});

test("selection excludes completed questions and is fixed for the same seed", () => {
  const first = Core.selectQuestionSet(bank, [], seeded(11));
  const seen = new Set(first.map(q => q.id));
  const secondA = Core.selectQuestionSet(bank, seen, seeded(12));
  const secondB = Core.selectQuestionSet(bank, seen, seeded(12));
  assert.deepEqual(secondA.map(q => q.id), secondB.map(q => q.id));
  assert.equal(secondA.some(q => seen.has(q.id)), false);
});

test("selection reports domain exhaustion instead of changing composition", () => {
  const sports = bank.filter(q => q.domain === "sports").map(q => q.id).slice(0, 3);
  assert.throws(() => Core.selectQuestionSet(bank, sports, seeded(1)), err =>
    err.code === "DDCC_EXHAUSTED" && err.shortages.some(x => x.domain === "sports" && x.available === 1));
});

test("Brier loss is correct at 0, 50 and 100", () => {
  assert.equal(Core.brierLoss(0, false), 0);
  assert.equal(Core.brierLoss(0, true), 1);
  assert.equal(Core.brierLoss(50, true), 0.25);
  assert.equal(Core.brierLoss(50, false), 0.25);
  assert.equal(Core.brierLoss(100, true), 0);
  assert.equal(Core.brierLoss(100, false), 1);
});

test("bin boundaries map exactly to the five locked ranges", () => {
  const expected = [[0,0],[20,0],[21,1],[40,1],[41,2],[60,2],[61,3],[80,3],[81,4],[100,4]];
  expected.forEach(([p, bin]) => assert.equal(Core.binFor(p), bin, String(p)));
});

test("aggregation uses actual means, omits fabricated empty values, and computes bias", () => {
  const rows = [
    { probability: 0, truthValueSnapshot: false, domainSnapshot: "sports" },
    { probability: 20, truthValueSnapshot: true, domainSnapshot: "sports" },
    { probability: 81, truthValueSnapshot: true, domainSnapshot: "biology" },
    { probability: 100, truthValueSnapshot: false, domainSnapshot: "biology" },
  ];
  const all = Core.aggregate(rows);
  assert.equal(all.responseCount, 4);
  assert.equal(all.meanForecast, 0.5025);
  assert.equal(all.truthRate, 0.5);
  assert.ok(Math.abs(all.calibrationBias - 0.0025) < 1e-12);
  assert.equal(all.bins[0].meanForecast, 0.1);
  assert.equal(all.bins[0].truthRate, 0.5);
  assert.equal(all.bins[1].responseCount, 0);
  assert.equal(all.bins[1].meanForecast, null);
  assert.equal(all.bins[1].truthRate, null);
});

test("domain filtering changes sample count and empty domains stay empty", () => {
  const rows = [
    { probability: 70, truthValueSnapshot: true, domainSnapshot: "sports" },
    { probability: 30, truthValueSnapshot: false, domainSnapshot: "biology" },
  ];
  assert.equal(Core.aggregate(rows, "sports").responseCount, 1);
  const empty = Core.aggregate(rows, "world_history");
  assert.equal(empty.responseCount, 0);
  assert.ok(empty.bins.every(b => b.meanForecast === null && b.truthRate === null));
});

test("50 percent forecasts are omitted from the directional accuracy denominator", () => {
  const got = Core.aggregate([
    { probability: 50, truthValueSnapshot: true, domainSnapshot: "sports" },
    { probability: 60, truthValueSnapshot: true, domainSnapshot: "sports" },
    { probability: 40, truthValueSnapshot: true, domainSnapshot: "sports" },
  ]);
  assert.equal(got.accuracyDenominator, 2);
  assert.equal(got.accuracy, 0.5);
});

test("milestones unlock at or above 40, 100, and 216", () => {
  assert.equal(Core.milestone(39).label, "Profile in progress");
  assert.equal(Core.milestone(40).label, "Initial DDCC Profile");
  assert.equal(Core.milestone(120).label, "Developing DDCC Profile");
  assert.equal(Core.milestone(240).label, "Established DDCC Profile");
});
