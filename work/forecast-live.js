/* NFL live contest. Separate from the immutable preseason experiment and from
 * pipeline/ (the Polymarket study). No network or storage in this scoring core. */
const FCL_VERSION = 'nfl-live-1';
const FCL_MODELS = [
  {id:'nfelo', name:'nfelo', kind:'model', displayed:true},
  {id:'538-classic', name:'538 Classic Elo', kind:'model', displayed:true},
  {id:'ddpr-nfl', name:'DDPR NFL (logit mean)', kind:'model', displayed:true},
  {id:'ddpr-nfl-linear', name:'DDPR NFL (linear mean)', kind:'model', displayed:false},
  {id:'toto', name:'Toto', kind:'agent', displayed:true},
  {id:'dd-crowd-nfl', name:'Data Dawgs Crowd', kind:'crowd', displayed:true}
];
const fclProb = p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const fclRound = p => Math.round(p * 1e6) / 1e6;
const fclTeam = t => ({LA:'LAR',OAK:'LV',JAC:'JAX',WSH:'WAS'})[t] || t;
const fclTime = t => typeof t === 'number' ? t : Date.parse(t);
const fclIso = t => new Date(t).toISOString();
const fclModelKey = id => 'model:' + id;
// The existing contest namespace is the unique registered name. Do not split a
// player's older name-keyed entries from newer UID-authenticated submissions.
const fclHumanKey = e => (e.entrant_kind === 'agent' ? 'agent:' : 'human:') + e.entrant;
function fclPublicRow(e) {
  const {idempotency_key,entrant_uid,token_hash,...row}=e;
  return row;
}

function fclRatings(classic, games) {
  // The seed is explicitly the target-season preseason ratings. Replay current
  // season finals once, in order; never re-use the previous run's updated ratings.
  const seed = classic.provenance?.input_material?.target_season_ratings;
  if (!Array.isArray(seed) || seed.length !== 32) throw new Error('538 preseason seed unavailable');
  const ratings = Object.fromEntries(seed.map(t => [t.team,t.elo]));
  if (Object.values(ratings).some(x => !Number.isFinite(x))) throw new Error('Invalid 538 seed');
  for (const g of [...games].sort((a,b)=>a.kickoff_at.localeCompare(b.kickoff_at)||a.game_id.localeCompare(b.game_id))) {
    if (g.status !== 'final' || !Number.isInteger(g.home_score) || !Number.isInteger(g.away_score)) continue;
    const diff = ratings[g.home_team] - ratings[g.away_team] + (g.neutral_site ? 0 : 65);
    const p = 1 / (1 + 10 ** (-diff / 400));
    const margin = g.home_score - g.away_score, r = margin === 0 ? .5 : margin > 0 ? 1 : 0;
    const denominator = r === .5 ? 1 : (r === 1 ? diff : -diff) * .001 + 2.2;
    const mult = Math.log(Math.max(Math.abs(margin),1)+1) * 2.2 / denominator;
    const shift = 20 * mult * (r-p);
    ratings[g.home_team] += shift; ratings[g.away_team] -= shift;
  }
  return ratings;
}

function fclCandidates(game, nfelo, ratings, now, inputId) {
  if (now >= Date.parse(game.kickoff_at) || game.status === 'final') return [];
  const base = {game_id:game.game_id,season:game.season,week:game.week,home_team:game.home_team,
    away_team:game.away_team,kickoff_at:game.kickoff_at,captured_at:fclIso(now),input_snapshot_id:inputId};
  const make = (id,p,version,sourceAt,extra={}) => ({...base,model_id:id,
    model_name:FCL_MODELS.find(m=>m.id===id).name,model_version:version,
    home_win_probability:fclRound(p),source_capture_at:sourceAt,...extra});
  const p538 = 1/(1+10**(-(ratings[game.home_team]-ratings[game.away_team]+(game.neutral_site?0:65))/400));
  const rows = fclProb(p538) ? [make('538-classic',p538,'classic-1.0.0-live',fclIso(now),{source:'538 preseason seed + completed canonical current-season games'})] : [];
  const meta = nfelo.data?.meta || {}, captured = Date.parse(meta.captured_at);
  const source = (nfelo.data?.games || []).find(g=>String(g.id).split('_').map(fclTeam).join('_')===game.game_id);
  // Never silently substitute a preseason number or a market probability for nfelo.
  if (!source || !fclProb(source.hwp) || !Number.isFinite(captured) || captured > now+60000 || now-captured > 36*3600e3) return rows;
  if(fclTeam(source.h)!==game.home_team||fclTeam(source.a)!==game.away_team) return rows;
  rows.unshift(make('nfelo',source.hwp,meta.model_version,meta.captured_at,{source:'Published nfelo probability',source_commit:meta.sha_full||meta.sha}));
  if (fclProb(p538) && source.hwp > 0 && source.hwp < 1 && p538 > 0 && p538 < 1) {
    const z = (Math.log(source.hwp/(1-source.hwp))+Math.log(p538/(1-p538)))/2;
    rows.push(make('ddpr-nfl',1/(1+Math.exp(-z)),'logit-1.0.0-live',meta.captured_at,{ensemble_of:['nfelo','538-classic']}));
    rows.push(make('ddpr-nfl-linear',(source.hwp+p538)/2,'linear-1.0.0-live',meta.captured_at,{ensemble_of:['nfelo','538-classic'],displayed:false}));
  }
  return rows;
}

function fclValidEntry(e,g) {
  return e && e.touched === true && fclProb(e.home_win_probability) &&
    e.game_id === g.game_id && e.home_team === g.home_team && e.away_team === g.away_team &&
    fclTime(e.submitted_at)>0 && fclTime(e.submitted_at)<Date.parse(g.kickoff_at);
}
function fclGrade(lock, game) {
  if (!lock || game.status !== 'final' || !Number.isInteger(game.home_score) || !Number.isInteger(game.away_score)) return [];
  const r = game.home_score === game.away_score ? null : game.home_score > game.away_score ? 1 : 0;
  return lock.forecasts.map(e => {
    const p = e.home_win_probability, b = r===null ? null : (p-r)**2;
    const q = Math.min(1-1e-15,Math.max(1e-15,p));
    return {...fclPublicRow(e),game_id:game.game_id,season:game.season,week:game.week,
      outcome_source:game.source||null,outcome_snapshot_id:game.source_snapshot_id||null,
      outcome:r===null?'void':'final',home_result:r,home_score:game.home_score,away_score:game.away_score,
      points:b===null?null:fclRound(25-100*b),brier:b===null?null:fclRound(b),
      log_loss:r===null?null:fclRound(-(r?Math.log(q):Math.log(1-q)))};
  });
}
function fclBoards(rows, entrants, finalGames) {
  const graded = rows.filter(r=>r.outcome==='final');
  const by = new Map(entrants.map(e=>[e.key,[]]));
  for(const r of graded) { if(!by.has(r.entrant_key))by.set(r.entrant_key,[]); by.get(r.entrant_key).push(r); }
  const total = entrants.map(e=> {
    const a=by.get(e.key)||[], n=a.length;
    return {...e,n,coverage:finalGames?n/finalGames:0,points:fclRound(a.reduce((s,r)=>s+r.points,0)),
      brier:n?fclRound(a.reduce((s,r)=>s+r.brier,0)/n):null,
      log_loss:n?fclRound(a.reduce((s,r)=>s+r.log_loss,0)/n):null};
  }).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
  const active = total.filter(e=>e.n>0 && e.displayed!==false);
  const sets = active.map(e=>new Set((by.get(e.key)||[]).map(r=>r.game_id)));
  const common = sets.length ? [...sets[0]].filter(id=>sets.every(s=>s.has(id))) : [];
  const commonRows = active.map(e=> {
    const a=(by.get(e.key)||[]).filter(r=>common.includes(r.game_id)),n=a.length;
    return {...e,n,coverage:finalGames?n/finalGames:0,points:n?fclRound(a.reduce((s,r)=>s+r.points,0)):null,
      brier:n?fclRound(a.reduce((s,r)=>s+r.brier,0)/n):null,
      log_loss:n?fclRound(a.reduce((s,r)=>s+r.log_loss,0)/n):null};
  }).sort((a,b)=>(a.brier??Infinity)-(b.brier??Infinity));
  return {totals:total,common_sample:{game_ids:common,n_games:common.length,entrant_keys:active.map(e=>e.key),rows:commonRows,
    note:'Only games shared by all displayed entrants with at least one graded forecast. Zero-entry entrants are listed separately; hidden linear control is not in this comparison.'}};
}
