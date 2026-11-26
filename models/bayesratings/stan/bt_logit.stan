// Bayesian Bradley-Terry rating model.
// Sport-agnostic: N games, T teams.
//
// The likelihood uses data already on the game row:
//   1. Time-decay weights. A game's likelihood is scaled by time_weight,
//      computed in Python (half-life in days). This is a weighted likelihood,
//      not a new observation model.
//   2. The score. The margin (home minus away) shares the latent matchup
//      edge with the win/loss term, scaled into points by margin_scale.
//      A blowout pulls the rating more than a one-point win. How hard it
//      pulls is learned per fit, so a noisy sport leans on it less.
//      margin_home = 1 gives the margin its own home edge, in points:
//      mu = margin_scale * base + home_margin * (1 - neutral), where base
//      is the edge without the win/loss home advantage. margin_home = 0
//      keeps mu = margin_scale * eta, the shared home edge. Python turns
//      the flag on for MLB only.
//   3. result_weight scales only the win/loss term. It is 1 for every
//      ending, including overtime and shootout (the margin term never
//      used it: a one-goal overtime game is still a close game).
//   4. Back-to-back flags. home_b2b / away_b2b are 1 when that team played
//      on the previous calendar day. Python computes them from earlier
//      games only and passes zeros for leagues that do not use them
//      (MLB, NFL). The two coefficients have their own priors and drop
//      out of the edge when the flags are zero.
//   5. Starter edge. starter_edge is the home starter's team-relative
//      quality minus the away starter's, from earlier games only, and 0
//      when a side is unknown. Python passes zeros for NBA and NFL. The
//      coefficient has its own prior and drops out of the edge when the
//      covariate is zero.
// sigma_scale is the prior scale on the team-rating sd. It is 1 except
// for NHL, where a tighter scale is passed in (and for MLB, if the
// step-2 walk-forward kept the tighter scale).
//
// When margin_home is 0 and starter_edge is 0, the likelihood of the
// shared parameters is the step-1 model. home_margin and starter_coef
// are then sampled from their priors and do not enter a probability.

data {
  int<lower=0> N;                              // number of games
  int<lower=0> T;                              // number of teams
  array[N] int<lower=1, upper=T> home_team;    // home team id per game
  array[N] int<lower=1, upper=T> away_team;    // away team id per game
  array[N] int<lower=0, upper=1> outcome;      // 1 = home win
  array[N] int<lower=0, upper=1> neutral;      // 1 = neutral site: no home edge
  vector<lower=0>[N] time_weight;              // decay weight, 1 = most recent
  vector<lower=0>[N] result_weight;            // win/loss multiplier (1 = full)
  vector[N] margin;                            // home_score - away_score
  vector<lower=0, upper=1>[N] home_b2b;        // 1 = home played the previous day
  vector<lower=0, upper=1>[N] away_b2b;        // 1 = away played the previous day
  vector[N] starter_edge;                      // home rel - away rel; 0 if unused
  int<lower=0, upper=1> margin_home;           // 1 = separate home edge on the margin
  real<lower=0> sigma_scale;                   // prior scale of the rating sd
}
parameters {
  vector[T] rating;                            // latent team strength (logit scale)
  real<lower=0> sigma;                         // rating spread
  real home_adv;                               // home advantage on the win/loss term (logit)
  real b2b_home;                               // edge shift when home is on a back-to-back
  real b2b_away;                               // edge shift when away is on a back-to-back
  real starter_coef;                           // logit per unit of starter edge
  real home_margin;                            // home edge on the margin, in points
  real<lower=0> margin_scale;                  // points per unit of logit edge
  real<lower=0> sigma_margin;                  // noise of a game's margin
}
model {
  rating ~ student_t(3, 0, sigma);
  sigma ~ student_t(3, 0, sigma_scale);
  // weakly informative: the original NFL model used normal(0.2, 0.15),
  // which is too opinionated for a sport-agnostic model (home edge varies
  // by league and era); normal(0, 0.5) lets the games dominate while still
  // regularizing a thin sample
  home_adv ~ normal(0, 0.5);
  b2b_home ~ normal(0, 0.5);
  b2b_away ~ normal(0, 0.5);
  starter_coef ~ normal(0, 0.5);
  home_margin ~ normal(0, 10);
  margin_scale ~ normal(0, 10);
  sigma_margin ~ normal(0, 15);

  for (n in 1:N) {
    real base = rating[home_team[n]] - rating[away_team[n]]
                + b2b_home * home_b2b[n]
                + b2b_away * away_b2b[n]
                + starter_coef * starter_edge[n];
    real eta = base + home_adv * (1 - neutral[n]);
    // margin_home = 0 -> mu = margin_scale * eta (shared home edge).
    // margin_home = 1 -> the margin's home edge is home_margin, in points.
    real mu = margin_scale * (base + (1 - margin_home) * home_adv * (1 - neutral[n]))
              + margin_home * home_margin * (1 - neutral[n]);
    target += time_weight[n] * result_weight[n]
              * bernoulli_logit_lpmf(outcome[n] | eta);
    target += time_weight[n]
              * normal_lpdf(margin[n] | mu, sigma_margin);
  }
}
