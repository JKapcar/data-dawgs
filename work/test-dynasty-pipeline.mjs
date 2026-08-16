import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL("data/dynasty-ranks.json", root), "utf8"));
const master = fs.readFileSync(new URL("master.html", root), "utf8");
const warroom = fs.readFileSync(new URL("fantasy-warroom.html", root), "utf8");
let n = 0;
const ok = (v, m) => { assert.ok(v, m); n++; };

ok(data.count === 334 && data.data.length === 334, "all supplied dynasty rows are published");
ok(new Set(data.data.map(x => x.name.toLowerCase())).size === 334, "dynasty names are unique");
ok(data.data.every(x => Number.isFinite(x.one_qb_rank) && Number.isFinite(x.sf_te_premium_rank)), "both rank formats are numeric");
ok(data.data.every(x => Number.isFinite(x.one_qb_auction) && Number.isFinite(x.two_qb_auction)), "both auction formats are numeric");
ok(data.source.includes("no publisher or commercial brand claimed"), "provenance avoids a false brand claim");
ok(master.includes('data-view="season"') && master.includes('data-view="dynasty"'), "master data has both horizon views");
ok(master.includes('id="dynastyFormat"'), "master data exposes the format selector");
ok(master.includes("fetch('data/dynasty-ranks.json'"), "master data reads the published dynasty source");
ok(warroom.includes("fetch('data/dynasty-ranks.json'"), "war room reads the same dynasty source");
ok(/function isDynastyLeague\(\).*settings\?\.type\)===2/.test(warroom), "only Sleeper dynasty leagues expose the dynasty horizon");
ok(warroom.includes('data-horizon="season"') && warroom.includes('data-horizon="dynasty"'), "war room exposes both value horizons");
ok(warroom.includes('id="mnHorizon"') && warroom.includes('This season</th><th>Dynasty</th><th>Δ'), "war room renders player-level price differences");
ok(/function usesDynasty\(\).*valueHorizon!==['"]season['"]/.test(warroom), "active horizon controls the war room value source");
ok(/state\.slots\.SUPERFLEX\?row\.two_qb_auction:row\.one_qb_auction/.test(warroom), "war room chooses auction values from actual roster slots");
ok(warroom.includes("Keeper league detected") && warroom.includes("remains this-season market value"), "keeper uncertainty is explicit");

console.log(`dynasty pipeline contract: ${n} passed`);
