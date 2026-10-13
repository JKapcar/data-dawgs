# Lineup correlation receipt review — 2026-10-13

Scope: builder conditional simulation only. No model coefficients, scoring draws, GP backend, production data or deployment changed.

The collapsed “How this lineup moves together” receipt lists every selected pair after a successful run. It reads the exact Cholesky factor used for sampling, including multiplier and jitter normalization. Historical table cells are separate from applied latent correlations. Changing inputs clears the receipt. The exported private receipt includes these pairs. The diagnostics iframe remains private and outside Toto’s context; no new bot access or claims were added.

## Evidence

`work/dfs-engine.js` exports the runtime table and helpers. `work/estimate_corr.py` describes player-season standardized DK score co-movement, season-usage role assignment, minimum six games per player-season and 400 paired observations. Runtime metadata reports 2019–2025 regular seasons, 1,871 games, 35,587 player-weeks, and no source PSD clipping. Its compact runtime table does not retain pair counts, confidence intervals or a build timestamp.

Bundled same-team QB/WR2 = 0.3134; QB/own DST = -0.1101; QB/RB1 = 0.0642; QB/RB2 = 0.0583. Opposing QB/DST = -0.3114. These are current code values, not newly estimated coefficients. Earlier conversational teaching values are not production inputs.

## Model work recommendation (separate from this UI change)

1. Preserve pair counts, estimation/build date, data version and uncertainty when regenerating the table; validate its scoring against authoritative game-level DK results. Reproduce the source estimates before changing values.
2. Evaluate on held-out seasons with roles assigned from information available before kickoff. Runtime roles use projection rank while the historical estimator uses full-season usage. Quantify that mismatch, missing kicker dependence, shared-depth-role fallback and context sensitivity.
3. Validate the joint fantasy-score distribution, especially tails: using historical score correlations as Gaussian latent correlations does not preserve Pearson correlation after a lognormal transform. Test distribution coverage and lineup threshold calibration, not just simulation repeatability.
4. Model uncertainty in projected means separately from game-outcome randomness, and test field-generation sensitivity. Current Monte Carlo intervals condition on fixed means, assumptions and one sampled opponent field. Additional draws cannot remove these sources of error.
5. Consider a GP only after defining the target, available pregame features, training/validation splits, likelihood/noise model, and an evidence-backed kernel. A role-pair correlation table alone is not a GP kernel design.

## Integration

Reconciled onto main 48d7bcb4 (deployed PR236); originally based on main 9819894f in isolated `codex/dfs-correlation-clarity`. Inspected the pending account-history patch; no history/account checkout was edited. Merge code changes after that work and regenerate `sw.js` from the combined HTML/JS tree rather than copying its hash. Publication approved by Jason on 2026-10-13; use the PR/checks/deployment workflow.
