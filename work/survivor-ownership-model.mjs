// A dated cross-pool estimate, never observed ownership for a user's contest.
export function buildOwnership(envelope, games, season) {
  const d = envelope.data;
  if (d.season !== season) throw new Error('Ownership season mismatch');
  const slate = games.filter(g => g.wk === d.week);
  const teams = [...new Set(slate.flatMap(g => [g.h, g.a]))].sort();
  const e = d.espn_percent, x = d.etr_splash_percent;
  const sum = o => Object.values(o).reduce((a,b) => a+b, 0);
  for (const source of [e,x]) {
    if (Object.keys(source).some(t => !teams.includes(t)) ||
        Object.values(source).some(v => !Number.isFinite(v) || v < 0) ||
        Math.abs(sum(source)-100) > 0.2) throw new Error('Invalid ownership source');
  }
  if (teams.some(t => !(t in e))) throw new Error('Incomplete ESPN slate');
  for (const [t,opp] of Object.entries(d.etr_opponents)) {
    if (!slate.some(g => (g.h===t && g.a===opp)||(g.a===t && g.h===opp)))
      throw new Error('ETR matchup mismatch: '+t);
  }
  const weight=d.etr_weight;
  if (!Number.isFinite(weight)||weight<0||weight>1) throw new Error('Invalid blend weight');
  const missing=teams.filter(t => !(t in x));
  const earlyMass=missing.reduce((a,t)=>a+e[t]/sum(e),0);
  const blend = w => Object.fromEntries(teams.map(t => [t, t in x
    ? w*(1-earlyMass)*x[t]/sum(x)+(1-w)*e[t]/sum(e)
    : e[t]/sum(e)]));
  return { [String(d.week)]: {
    season, week:d.week, as_of:envelope.as_of, model_id:'cross-pool-equal-blend-v1',
    label:'ETR/Splash + ESPN blend', observed:false,
    source_file:'/data/survivor-ownership-inputs.json',
    etr_weight:weight, espn_only_teams:missing, shares:blend(weight),
    sensitivity:{etr_25:blend(0.25),etr_75:blend(0.75)},
    note:'ESPN-only teams retain their normalized ESPN share. Remaining mass blends ETR and ESPN equally. Weights are judgmental, uncalibrated; sensitivity scenarios are not confidence intervals. Week-specific; never carried into later weeks.'
  }};
}
