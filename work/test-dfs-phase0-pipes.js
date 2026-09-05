const Scr = require("./dfs-contest-screener.js");
const St = require("./dfs-standings-ingest.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
}

const milly = Scr.scoreContest({
  name: "NFL $1.2M Fantasy Football Millionaire [$1M to 1st]",
  buyIn: 20, entryCap: 150, fieldCap: 70588, prizePool: 1200000,
  firstPrize: 1000000, tenthPrize: 5000, minCash: 30, gameType: "Classic"
});
ok("milly maps milly preset", milly.preset.key === "milly");
ok("milly has rank", milly.rank >= 0);

const sd = Scr.scoreContest({ name: "NFL Showdown $10K", buyIn: 5, entryCap: 150, gameType: "Showdown" });
ok("showdown 150 -> wildcat", sd.preset.key === "sd_wildcat");

const cash = Scr.scoreContest({ name: "NFL $5 Double Up", buyIn: 5, entryCap: 1, gameType: "Classic", rake: 0.10, minCash: 10, firstPrize: 10, tenthPrize: 10 });
ok("double up -> cash", cash.preset.key === "cash");

const ranked = Scr.rankContests([milly.contest, sd.contest, cash.contest]);
ok("rankContests returns 3", ranked.length === 3);

const st = St.parseStandingsCsv(
  "Rank,Entry,Points\n1,kap,180.4\n2,other,170.1\n",
  { contestKey: "test-1", week: 1, contestName: "Unit" }
);
ok("standings parse n=2", st.n === 2 && !st.error);
ok("standings keeps week", st.week === 1);

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
