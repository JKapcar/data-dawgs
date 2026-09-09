// Greer's Nfelo.project_game pre-market Elo formula. Published forecasts take priority.
// HFA is already in Elo units; base ratings exclude QB adjustments, avoiding double-counting.
export function seasonProbability(inputs, id) {
  const game = inputs.games[id];
  if (!game) throw new Error(`Missing nfelo season context: ${id}`);
  const home = inputs.ratings[game.home], away = inputs.ratings[game.away];
  const values = [home?.base, away?.base, home?.qb_adj, away?.qb_adj, game.hfa_elo, inputs.qb_weight, inputs.z];
  if (!values.every(Number.isFinite) || inputs.z <= 0) throw new Error(`Invalid nfelo inputs: ${id}`);
  const eloDifference = home.base - away.base + game.hfa_elo + inputs.qb_weight * (home.qb_adj - away.qb_adj);
  return { p: 1 / (1 + 10 ** (-eloDifference / inputs.z)), eloDifference };
}
