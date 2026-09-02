import assert from "node:assert/strict";
import fs from "node:fs";

const page=fs.readFileSync(new URL("../fantasy-warroom.html",import.meta.url),"utf8");
const board=JSON.parse(fs.readFileSync(new URL("../data/datadawg-dollars-values.json",import.meta.url),"utf8"));
let checks=0;
const ok=(v,m)=>{assert.ok(v,m);checks++};

assert.equal(board.data.validation.rows,425); checks++;
assert.equal(board.data.players.length,425); checks++;
assert.equal(board.data.players.filter(x=>x.target>0).length,210); checks++;
assert.equal(board.data.players.reduce((a,x)=>a+x.target,0),2800); checks++;
assert.equal(board.tier,"labs"); checks++;
assert.equal(board.graded,false); checks++;

ok(/provider!==\s*'yahoo'\|\|String\(leagueId\)!=='773763'/.test(page),"published board is gated to its exact room");
ok(page.includes("data/datadawg-dollars-values.json"),"page reads the existing board");
ok(/Number\(x&&x\.target\)/.test(page),"target, including zero, is the price field");
ok(/const got=published\|\|\(feed\?ddFromFeed/.test(page),"published board wins over an inline feed or PMV");
ok(page.includes("Pick grade is DataDawg$ minus paid"),"pick grade names its sign");
ok(page.includes("tier labs · graded: false"),"human-facing disclosure carries status");
ok(page.includes("opening-state auction target, not a clearing price and not a max bid"),"human-facing disclosure defines target");
ok(page.includes("conversion-sensitivity bands, not bid ceilings or player-outcome intervals"),"human-facing disclosure defines bands");
ok(page.includes("Keeper inflation is unmodelled (keeper deadline 2026-09-08)"),"human-facing disclosure names keeper limitation and date");
ok(page.includes("A share of the priced board is not a share of what was spent"),"human-facing disclosure distinguishes shares");
ok(page.includes("YAHOO 773763 PRICING uses DataDawg$"),"Toto carries the pricing basis");

console.log(`${checks} Yahoo DataDawg$ assertions passed`);
