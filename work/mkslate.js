const { rng } = require("./dfs-engine.js").DDFS;
/* Synthetic DK-shaped slate. ⚠️ Salaries are calibrated so a typical 9-man lineup lands
   near $50,000 — an earlier fixture priced players ~10% high, which made almost every
   randomly assembled lineup illegal and looked like a solver/field bug. */
module.exports = function makeSlate(nGames = 13, seed = 7) {
  const rand = rng(seed); const players = [];
  const r100 = v => Math.round(v / 100) * 100;
  const push = (pos, team, opp, gid, sal, proj) =>
    players.push({ pos, team, opp, gid, sal: Math.max(2000, r100(sal)), proj: +Math.max(0.5, proj).toFixed(2) });
  for (let g = 0; g < nGames; g++) {
    const a = "T" + (2 * g), b = "T" + (2 * g + 1);
    for (const [t, o] of [[a, b], [b, a]]) {
      const q = 13 + rand() * 11;                       // QB 13-24 pts
      push("QB", t, o, g, 4200 + q * 190, q);           //     $4.7k - $8.8k
      for (let i = 0; i < 3; i++) { const p = (15 - i * 5) * (0.7 + rand() * 0.6); push("RB", t, o, g, 2800 + p * 320, p); }
      for (let i = 0; i < 5; i++) { const p = (16 - i * 3.1) * (0.7 + rand() * 0.6); push("WR", t, o, g, 2900 + p * 300, p); }
      for (let i = 0; i < 2; i++) { const p = (10 - i * 4.5) * (0.7 + rand() * 0.6); push("TE", t, o, g, 2600 + p * 330, p); }
      push("DST", t, o, g, 2100 + rand() * 1500, 4 + rand() * 6);
    }
  }
  return players;
};
