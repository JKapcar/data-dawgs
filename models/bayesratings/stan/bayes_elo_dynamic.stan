// Dynamic Bayesian Elo (BSMR chapter 13 made dynamic), the second forecast
// in the published win probability. See bayesratings/bayes_elo.py.
//
// One fit per league. Same model, priors and code for MLB, NBA, NFL, NHL.
// Backtested Oct 2026. This file is that model
// with the per-game generated quantities (p_home, log_lik) dropped, because
// the daily run only needs the final ratings. The model block is unchanged.
//
//   - Elo scale: expected home score = 1 / (1 + 10^(-(diff) / 400))
//   - K is INSIDE the likelihood: ratings update game by game in date order
//     and each game's likelihood uses the PRE-game ratings, so K is learned.
//   - Margin-aware: the update is scaled by a margin multiplier whose
//     strength (lambda) is estimated. lambda = 0 gives plain Elo.
//   - Neutral sites, ties, the same result_weight the logit uses (1 for
//     regulation, overtime, and shootout), season carryover (estimated),
//     teams entering mid-history.
//
// Requires CmdStan >= 2.33 (tuples, array syntax).
functions {
  // Run the Elo recursion over all games in date order.
  // Returns (pre-game Elo edge per game incl. home edge, ratings after last game).
  tuple(vector, vector) elo_filter(vector rating0, real home_adv, real K,
                                   real lambda, real carry, real mbar,
                                   array[] int home, array[] int away,
                                   vector score, vector margin,
                                   array[] int neutral, vector result_weight,
                                   array[] int home_new_season,
                                   array[] int away_new_season) {
    int N = size(home);
    vector[N] edge;
    vector[num_elements(rating0)] r = rating0;
    for (n in 1:N) {
      int h = home[n];
      int a = away[n];
      // season carryover: shrink toward 1500 at a team's first game of a new season
      if (home_new_season[n] == 1) r[h] = 1500 + carry * (r[h] - 1500);
      if (away_new_season[n] == 1) r[a] = 1500 + carry * (r[a] - 1500);
      edge[n] = r[h] - r[a] + home_adv * (1 - neutral[n]);
      real E = inv_logit(log(10) / 400 * edge[n]);   // same as ch13's 10^x form
      // margin multiplier, normalized so a typical margin gives about 1
      real mov = pow((1 + log1p(abs(margin[n]))) / (1 + mbar), lambda);
      real delta = K * result_weight[n] * mov * (score[n] - E);
      r[h] += delta;
      r[a] -= delta;          // zero-sum, as in ch13
    }
    return (edge, r);
  }
}

data {
  int<lower=1> N;                                   // completed games, sorted by start time
  int<lower=2> T;                                   // teams (stable id across relocations/renames)
  array[N] int<lower=1, upper=T> home;
  array[N] int<lower=1, upper=T> away;
  vector<lower=0, upper=1>[N] score;                // 1 home win, 0 home loss, 0.5 tie
  vector[N] margin;                                 // home_score - away_score (games table, OT/SO incl.)
  array[N] int<lower=0, upper=1> neutral;           // 1 = neutral site, no home edge
  vector<lower=0, upper=1>[N] result_weight;        // 1 = full weight, including OT and shootout
  array[N] int<lower=0, upper=1> home_new_season;   // 1 = home team's first game of a season it
  array[N] int<lower=0, upper=1> away_new_season;   //     did not start in (never its first game ever)

  // upcoming games to forecast from the final ratings
  int<lower=0> N_new;
  array[N_new] int<lower=1, upper=T> home_new;
  array[N_new] int<lower=1, upper=T> away_new;
  array[N_new] int<lower=0, upper=1> neutral_new;
  array[N_new] int<lower=0, upper=1> new_season_new; // 1 = game is in a later season than the last fitted game
}

transformed data {
  // typical log-margin in this league, so K keeps the meaning
  // "points of Elo moved per unit surprise in an average game"
  real mbar = mean(log1p(abs(margin)));
  real c = log(10) / 400;
}

parameters {
  // offset/multiplier only rescales the sampler's internal scale; the model is unchanged
  vector<offset=1500, multiplier=50>[T] rating0;  // rating at each team's first game in the data
  real<lower=0> home_adv;                // home edge, Elo points (scale ~50; Stan can't combine lower= with multiplier=)
  real<lower=0> K;                       // update size, Elo points per unit surprise
  real<lower=0> lambda;                  // margin strength (0 = plain win/loss Elo)
  real<lower=0, upper=1> carry;          // share of rating kept across a season break
}

model {
  // priors
  rating0 ~ normal(1500, 50);            // ch13
  home_adv ~ normal(50, 25);             // ch13 (truncated at 0 by the declaration)
  K ~ lognormal(log(20), 1);             // median 20, 95% approx 2.8 to 142 (see README)
  lambda ~ normal(0, 1);                 // half-normal: plain Elo is a plausible answer
  carry ~ beta(6, 3);                    // mean 0.67, about a third regressed each offseason

  // likelihood: each game's result given its PRE-game ratings
  {
    tuple(vector[N], vector[T]) f = elo_filter(rating0, home_adv, K, lambda, carry, mbar,
                                               home, away, score, margin, neutral,
                                               result_weight, home_new_season, away_new_season);
    vector[N] x = c * f.1;
    // weighted Bernoulli on the expected score; a tie (0.5) counts half each way
    target += dot_product(result_weight,
                          score .* log_inv_logit(x) + (1 - score) .* log1m_inv_logit(x));
  }
}

generated quantities {
  vector[T] final_rating;    // ratings after the last fitted game
  vector[N_new] p_new;       // P(home win) for upcoming games (one shared season flag;
                             // bayes_elo.py forecasts per team instead)
  {
    tuple(vector[N], vector[T]) f = elo_filter(rating0, home_adv, K, lambda, carry, mbar,
                                               home, away, score, margin, neutral,
                                               result_weight, home_new_season, away_new_season);
    final_rating = f.2;
    for (m in 1:N_new) {
      real rh = final_rating[home_new[m]];
      real ra = final_rating[away_new[m]];
      if (new_season_new[m] == 1) {
        rh = 1500 + carry * (rh - 1500);
        ra = 1500 + carry * (ra - 1500);
      }
      p_new[m] = inv_logit(c * (rh - ra + home_adv * (1 - neutral_new[m])));
    }
  }
}
