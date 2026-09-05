#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const api = require("./dk-draftables-ingest.js");

const root = path.join(__dirname, "..", "tests", "fixtures");
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

const lobby = JSON.parse(fs.readFileSync(path.join(root, "dk-lobby-nfl-sample.json"), "utf8"));
const groups = api.listNflSalaryDraftGroups(lobby);
assert(groups.length >= 1, "lobby yields salary draft groups");
assert(groups.every(g => g.format === "classic" || g.format === "showdown"), "only classic/showdown");
assert(groups.some(g => g.contestTypeId === 21), "includes classic 21");
assert(groups.some(g => g.contestTypeId === 96), "includes showdown 96");

const classic = JSON.parse(fs.readFileSync(path.join(root, "dk-draftables-classic-sample.json"), "utf8"));
const cr = api.playersFromDraftables(classic, { format: "classic" });
assert(!cr.error, "classic maps without error");
assert(cr.players.length > 10, "classic has players: " + cr.players.length);
assert(!cr.showdown, "classic not showdown");
const ids = new Set(cr.players.map(p => p.dkId));
assert(ids.size === cr.players.length, "classic unique dkIds");
assert(cr.players.every(p => p.sal >= 2000 && p.sal <= 12000), "classic salary range");
assert(cr.players.some(p => p.status === "Q" || p.status === "OUT" || p.status === "IR"), "classic keeps injury status");
assert(cr.players.every(p => ["QB","RB","WR","TE","DST"].includes(p.pos)), "classic positions only");

const show = JSON.parse(fs.readFileSync(path.join(root, "dk-draftables-showdown-sample.json"), "utf8"));
const sr = api.playersFromDraftables(show, { format: "showdown" });
assert(!sr.error, "showdown maps without error");
assert(sr.showdown, "showdown flag");
assert(sr.players.length >= 20, "showdown player count " + sr.players.length);
const withCpt = sr.players.filter(p => p.cptSal > 0 && p.sal > 0);
assert(withCpt.length === sr.players.length, "every showdown player has CPT+FLEX");
let ratioOk = 0;
withCpt.forEach(p => {
  const r = p.cptSal / p.sal;
  if (Math.abs(r - 1.5) < 0.05) ratioOk++;
});
assert(ratioOk >= withCpt.length * 0.9, "CPT ≈ 1.5× FLEX for most (" + ratioOk + "/" + withCpt.length + ")");
assert(sr.players.some(p => p.pos === "K"), "showdown keeps K");
assert(sr.players.some(p => p.status === "OUT" || p.status === "Q" || p.status === "IR"), "showdown statuses");

const jsn = sr.players.find(p => /Smith-Njigba/i.test(p.name));
if (jsn) {
  assert(jsn.sal === 10600 && jsn.cptSal === 15900, "JSN FLEX/CPT salaries " + jsn.sal + "/" + jsn.cptSal);
} else {
  console.log("note: JSN not in fixture slate — skipping named check");
}

console.log(failed ? "\n" + failed + " failed" : "\nall passed");
process.exit(failed ? 1 : 0);
