# DFS Labs Bible

**Repo home:** `docs/DFS_LABS_BIBLE.md` (sits next to `dfs-roadmap.md`; supersedes §1 of the roadmap where they conflict — see §3.3)
**Status:** v1.0, 2026-09-04. Pre-Week-1. Nothing below is calibrated on 2026 data yet.
**Scope:** DraftKings NFL Classic + Showdown. All contest types are in scope (Milly Maker, single-entry, 3-max, 20/150-max, cash, Showdown Wildcat / Field General / single-entry).

This document is the source of truth for *why* the hub is built the way it is. Code implements it; `dfs-roadmap.md` sequences it; this file justifies it. When a number here is contradicted by our own receipts (§9), the receipts win and this file gets edited.

Confidence tags used throughout: **[S]** settled decision · **[E:public]** independently verified public evidence · **[E:etr]** ETR-published, not independently reproduced · **[P]** prior/assumption to be replaced by fit · **[?]** open question

---

## 0. The one-paragraph version

Tournaments are lost to two things: lineups that are bad, and good lineups that too many other people also built. Sims are well calibrated on the first (cash rate, top-10 rate) and blind to the second unless you feed them duplication. Product ownership — not sum ownership — is what predicts duplication, and correlated chalk is co-owned *more* than its marginals imply. So the hub generates candidates along a rarity/projection frontier, prices each candidate's duplication with a co-ownership-corrected joint probability, and then lets the sim's top-10 / top-1% rate make the final pick. Contest selection sets the objective before any of that runs. Every week we ingest standings and grade ourselves publicly.

---

## 1. Invariants (do not violate)

| # | Invariant | Why |
|---|---|---|
| I1 | ETR projections/ownership enter by paste-in or CSV upload only. Never fetched, never stored server-side, never committed, no fixture. Demo slate stays synthetic. | Paid content; repo is public. **[S]** |
| I2 | All solver/sim compute is client-side (Blob-URL Worker). The `toto` Worker is a CORS proxy for DK lobby/draftables and the read-only MCP. It stores nothing. | Keeps I1 enforceable by architecture, not policy. **[S]** |
| I3 | Contest-standings CSVs stay on-device (localStorage/IndexedDB). Only derived aggregates are published. | DK terms restrict redistribution of contest data. **[S]** |
| I4 | Rarity is a candidate generator, never the selection objective. Final selection = sim top-10 / top-1% rate, dupe-adjusted. | §3. This is the single largest latent error in the prior roadmap and the one most likely to recur. **[S]** |
| I5 | Every model-derived axis, band, or score is labelled as a model until it has been graded against ≥3 weeks of realized data. | Ownership projection is the weakest input in the pipeline; everything downstream inherits its error. **[S]** |

---

## 2. What the evidence actually supports

### 2.1 Sims: what they predict and what they don't

Source class: ETR's two post-lock calibration studies (Leone, Game Changer single-entry, n=35 contests; Main, Showdown Wildcat/Field General, n=33 slates, ~49K lineups). Both are single-vendor, single-season-ish, small-n. Treat as strong directional evidence, not constants. **[E:etr]**

- **Cash rate is the cleanest calibrated signal.** Showdown: sim cash buckets 0–15% → 30%+ produced actual cash rates 14.7% → 31.1%, monotone except one dip. If the sim says lineup A cashes more than B, it does.
- **Top-10 rate is the most robust GPP predictor.** Game Changer: the best-simming teams over-performed on cash rate less than on top-10 rate; Leone explicitly ranks top-10 > cash rate. Showdown: 59.2% of top-10 finishers simmed positive vs 50.5% of the field (1.17×); top-10 finishers averaged +6.7% sim ROI vs +1.5% field.
- **Sims do not pick the winner.** Showdown: only 13/33 winners (39.4%) simmed positive — *below* the field rate. Game Changer (smaller field, single-entry): 23/35 (65.7%), 1.65× chance. Field size and multi-entry destroy first-place signal. **Judge lineups on top-10, not first.**
- **Sim ROI is directionally right, inverted in the middle.** Showdown: the −25 to −10% bucket returned +13.8% actual while all three 0–40% buckets were negative. The ≥40% bucket was positive (+11.0%) and the ≤−40% bucket was −42.0%. Cash rate and top-1% rate rise cleanly with sim ROI; realized ROI does not. **Something other than lineup quality suppresses realized return in the middle: dupes (§2.2).**
- **Pre-lock → post-lock ROI regresses ~20 points** because the real field is chalkier and more competitive than the projected field. Track this every week (§9).
- **Not modelled by the sims we're benchmarking against:** late swap, post-lock projection changes, mean-projection error. Same holds for ours until §6 ships.

Outside view: every commercial sim vendor (SaberSim, Stokastic, The Solver) and the open-source chanzer0 sim describe the same calibration shape — good on cash/top-10, noisy at the top. The academic result is stronger: Haugh–Singal found the ex-post best lineup was *never* in their optimal portfolio across 17 weeks of 2017 NFL top-heavy contests. Analogy strength: strong (same problem, different data). **[E:public]**

### 2.2 Duplication is the layer the sim can't see

- **Product ownership predicts dupes; sum ownership doesn't.** Milly Maker top-100 vs field: sum ownership 113.4% vs 113.9% (indistinguishable); product ownership roughly half. Showdown: product ownership ↔ dupe count r²≈0.43, the highest single-variable correlation ETR tracks. **[E:etr]**
- **Dupes are a direct haircut on realized return.** Showdown, cashed lineups only: unique lineups averaged 396% ROI; 11+ dupes averaged 156%. Within the ≥40% sim-ROI bucket, low-dupe lineups returned +19.5%, high-dupe −30%. Low-dupe beat high-dupe in almost every bucket. **[E:etr]** The ~60% haircut figure is the ratio of those two rows; it is not a constant, it is a sample.
- **Dupe count peaks where "theoretically sound" meets "everyone's optimizer agrees":** the 0–10% sim-ROI bucket (4.73 avg dupes) vs the worst bucket (1.79). Sim users and the field converge on the same lineups.
- **Co-ownership exceeds the independence product for correlated chalk.** Completing a CPT WR + QB stack raised expected dupes 5.1 → 10.1 (≈1.98×). Two same-team RBs: 6.6 → 8.5 (≈1.29×). A negative-correlation build (CPT QB vs opposing D/ST) was duped 5.6× vs 15.7× for other top-1% lineups (≈0.36×). Leone's Classic example: a chalk RB combo projected ~15.2% of the field came in ~25.2%. **[E:etr]** This is why `entries × Π own` is wrong on exactly the lineups where it matters.
- **Rarity alone is not quality.** The ≤−25% sim-ROI showdown bucket had the *fewest* dupes and still returned −42% at 16.1% cash. Being unique in a bad lineup is just being bad alone.

### 2.3 Construction (Classic)

Source: Levitan, 2021–22 Milly Maker, top-100 vs field, n=3,234 teams. **[E:etr]**, direction corroborated by FantasyLabs, Roto Street Journal, DFS Army **[E:public]**.

| Feature | Field | Top-100 | Direction |
|---|---|---|---|
| QB double-stack | 30.6% | 35.7% | + |
| Bring-back (any) | 35.3% | 46.0% | + |
| Single-WR bring-back | 29.5% | 40.9% | + |
| Naked QB (top-10 study, n=452) | 17.4% | 6.4% | − (strongest signal) |
| WR in FLEX | 48.2% | 53.3% | + |
| RB in FLEX | 38.7% | 36.0% | − |
| TE in FLEX | 13.2% | 10.7% | − |
| QB $7K+ | 35.8% | 45.6% | + |
| Salary used | $49,874 | $49,894 | none |

**The strongest empirical challenge to all of the above:** the field has adopted these constructions. Double-stack rates went from ~41% (entering 2020) to ~87% among 2020 winners; DFS Army's 2021–25 reviews repeatedly show clean QB+2+bring-back "rarely found near the top" while 4–5-man single-game onslaughts and chalk-heavy builds won; multiple 2025 winners exceeded 130–140% cumulative ownership. **Treat the 2021–22 percentages as directional, not current, and re-measure them every season (§9.4).** Cumulative ownership ceiling is slate-adaptive, not a hard <125%. **[E:public]**

### 2.4 Construction (Showdown)

Source: Main, Showdown 101 + Year-in-Review, DK flagship showdowns since 2020. **[E:etr]** Bring-back rate independently corroborated by FantasyLabs (~88%) **[E:public]**; 5-1/4-2 concept echoed by The Fantasy Footballers **[E:public]**; exact 5-1/4-2 CPT-side rates are ETR-proprietary and unverified.

- CPT on the favored team, especially at spread ≥9 (75.4% of top-1% CPTs).
- CPT QB → 2–3 pass-catchers from the same team.
- Bring-back present in ~88–89% of winning lineups that captained a QB/WR/TE.
- Avoid K and D/ST at CPT (CPT D/ST ownership↔points r²≈0.09).
- Kicker with CPT QB is a mistake: kickers appear in 33.7% of top-1% lineups overall, 19.2% when the CPT is their QB.
- Max 2 of K+DST combined (3+ appear in 1.1% of top-1%).
- If D/ST rostered, max 3 opposing players (88.8% of top-1%).
- 2-4 / 4-2 and 5-1 splits are under-used by the field relative to win rate. Use them for differentiation; they are also the builds most exposed to co-ownership error, so price dupes honestly.
- Sub-$7,500 CPTs that hit beat their median projection by >2.6×; they are shots, not plays.
- 2025 rule change: showdown kicker salary floor $5,000. Kicker win-index compressed toward ~1.02×. **[E:public]** for the floor, **[E:etr]** for the index.
- **Dataset caveat:** 33 slates, ~1,500-entry fields, multi-entry. Every number above should carry a wide interval.

### 2.5 Contest selection

Source: Levitan game-selection, ETR Best Ball 2026 (rake tiers), Fantasy Footballers. **[E:public]**

- Rake: low/micro-stakes DK GPPs 15–16%; ~12% at ~$50 mid-field; ~9–10% at $100+; single-entry double-ups ~13%; Milly Maker 15.0%.
- Payout-shape rule: 10th place ≥10% of 1st; min-cash ≥2× buy-in; flat top preferred unless explicitly hunting first.
- Max-entry players win more because they build better lineups, not only because of volume: in Showdown Wildcat/FG, 31+-entry cohorts simmed +12.0% and realized +8.0%; single-entry cohorts simmed −10.5% and realized −21.6%. 28.5% of single-entry lineups were in the "horrid" (<−30% sim ROI) tier vs 9.3% for maxers. **[E:etr]**
- Tension to hold, not resolve: SaberSim's backtests say low-volume profitable players are ~2× as likely to go broke as multi-enterers; ETR's own bankroll study says single-entry high-stakes is brutal variance. Both are true. **The implication is portfolio sizing (§7), not "never play single-entry."** **[E:public]**

---

## 3. Rarity, the frontier, and the dupe model

### 3.1 Definitions **[S]**

For lineup `L` with players `i`, projected ownership `own_i` (for the selected contest's field tier), and stack shape `s(L)`:

```
rarity(L)   = Σ_i −log(own_i)  +  −log P_field(s(L))
proj(L)     = Σ_i proj_i                               (raw, linear)
J(L)        = Π_i own_i  ×  Π_{pairs (j,k) ⊂ L} c_jk   (joint field probability)
E[dupes](L) = entries × J(L)
```

- `Σ −log(own_i)` is `−log(product ownership)`. It is the additive form of the exact quantity §2.2 shows matters. Keep it additive: it is what makes the frontier exactly solvable.
- `P_field(s)` is the field frequency of the lineup's stack shape (e.g., QB+2+WR-bringback; 4-2 CPT-side; naked QB). Seed from §2.3/§2.4 field columns; refit from standings.
- `c_jk` are pairwise co-ownership multipliers: observed joint frequency of `(j,k)` in the field ÷ `own_j × own_k`. `c_jk > 1` for correlated chalk (QB+WR1 same team; RB+DST same team), `< 1` for anti-correlated pairs (QB vs opposing DST).
- **Expected dupes are labelled in `E[dupes]` units on the x-axis at the selected contest's entry count.** Under the hood the axis is `rarity(L)`.

### 3.2 Priors before we have standings data **[P]**

| Pair class | `c_jk` prior | Source |
|---|---|---|
| CPT WR + same-team QB (showdown) | 1.98 | 5.1 → 10.1 dupes |
| Two same-team RBs | 1.29 | 6.6 → 8.5 dupes |
| QB + opposing D/ST (negative corr) | 0.36 | 5.6 vs 15.7 dupes |
| QB + same-team WR1/TE1 (classic) | 1.5 | interpolated from the showdown figure and Leone's 15.2% → 25.2% chalk-combo example; widest uncertainty |
| RB + same-team D/ST | 1.2 | assumed; weakest prior |
| All other pairs | 1.0 | independence |

These are seeds. **Each is replaced by a fit as soon as we have ≥3 weeks of standings for the relevant contest tier** (§9.2). Log the prior/posterior pair every time one is updated.

### 3.3 Frontier algorithm **[S]** — supersedes roadmap §1 where it differs

1. **Exact frontier per stack shape.** For each admissible shape `s`, the solver carries `Σ −log(own_i)` as a second linear resource and traces the projection-vs-rarity frontier by parametric sweep (or ε-constraint on rarity). Objective is raw projection because it is linear; that is the only reason.
2. **Upper envelope** across shapes gives the global frontier. Points on it are labelled with their shape.
3. **Candidate cloud** (500–1,000 lineups, budgeted) is generated by variance sampling around the frontier and interior. **The cloud is the only thing the sim scores.** Frontier points are candidates too, not winners.
4. **Sim overlay:** for each candidate, P90 score, top-10 rate, top-1% rate, dupe-adjusted EV. Overlay toggles, never the axis.
5. **Selection:** greedy on marginal `P(≥1 entry finishes top-10 or top-1%)`, dupe-adjusted, subject to min-uniques and exposure (§4). This is the Hunter–Vielma–Zaman submodular result: greedy is provably ≥63% of optimal for the P(≥1 wins) objective. **[E:public]**
6. **UI:** click a point → lineup; drag a region → push to the entry set; frontier lineups visually distinguished from cloud.

**Why not P90 on the y-axis:** P90 is a nonlinear function of the lineup (correlation-dependent). You can evaluate it on candidates; you cannot solve for it. Putting it on the axis silently turns the "exact frontier" into a sample. Keep projection on the axis and P90 as overlay.

**Compute budget:** baseline is ~2.7 s in-browser for 20K sims × 3,000-lineup field × 20 own lineups. A 1,000-candidate cloud at 5K sims each is roughly 50× that — chunk it, show progress, cache per slate. The Workers 30 s CPU cap is irrelevant (I2: nothing runs on `toto`).

### 3.4 Dupe-adjusted EV **[S]**

```
EV_adj(L) = Σ_place  P(L at place) × prize(place) / (1 + E[copies of L at place])
```

where `E[copies]` is derived from `E[dupes](L)` conditioned on cashing (dupes of a cashed lineup all cash). This is what makes the middle sim-ROI buckets (§2.1) stop lying.

---

## 4. Contest-aware generation **[S]**

The contest is selected *first*. It sets the objective. Lineups generated under one contest's preset are flagged if submitted to another (§4.3).

### 4.1 Presets

| Contest | Objective | Variance | Exposure method | Min-uniques | Lineups | Leverage param |
|---|---|---|---|---|---|---|
| Cash / DU / 50-50 / H2H | mean points | low | — | — | 1 | 0 |
| Single-entry GPP | top-10 rate, dupe-adjusted | medium | — | — | 1 | low |
| 3-max GPP | greedy P(≥1 top-10) | medium-high | after each lineup | 2–3 | 3 | medium |
| 20-max / 150-max MME | greedy P(≥1 top-1%) | high (ETR-style MME preset) | after each lineup | ≥3 | to cap | high |
| Milly Maker | greedy P(≥1 top-1%), % to first ≈ 30% | high | after each lineup | ≥3 | to cap | highest |
| Showdown Wildcat (150-max) | greedy P(≥1 top-1%), product-own dupe control | high | after each lineup | ≥2 | to cap | high |
| Showdown single-entry / Field General | top-1% rate, dupe-adjusted | high | — | — | 1 | medium |

- **Leverage param** scales the ownership penalty / stacking weight monotonically with payout top-heaviness. This is Haugh–Singal's empirical finding that the fitted stacking parameter is higher in top-heavy contests. **[E:public]**
- **Variance is per-position, not a global randomness knob** (a low-projection WR carries more variance than a QB). Presets: Low / High / MME.
- **Exposure "after each lineup"** (continuous spreading) over "use # of lineups in run" (clumps best plays early). Prefer variance over hard exposure caps; caps are fine as a backstop. Min-exposure is discouraged — use projection boosts instead.
- **Group rules for large-field GPPs:** "at least one player < X% ownership," X set per slate, not fixed.
- **Number of lineups:** >1 for any top-heavy contest, increasing with top-heaviness. Diversification beats replication because opponent-overlap terms are small (Haugh–Singal). **[E:public]**

### 4.2 Construction validators

Run on every generated set; produce pass/warn, never hard-block (the user can override with a logged reason).

**Classic**
- Warn: naked QB (strongest negative signal, §2.3).
- Warn: no bring-back on a double-stack.
- Warn: RB double-stack same team; same-team D/ST vs own stack.
- Info: FLEX position vs top-100 lean; QB salary tier.
- Warn: cumulative ownership above the *slate-adaptive* threshold (threshold = f(projected chalk concentration); default = field mean + 1 SD; never a hard 125%).
- Warn: `E[dupes]` above contest-specific threshold (default: > entries/10,000 for large field; > 3 for small field). **[P]**

**Showdown**
- Detect and label split: 5-1, 4-2, 3-3, and CPT-side.
- Warn: CPT is K or D/ST.
- Warn: CPT QB without ≥2 same-team pass-catchers.
- Warn: no bring-back when CPT is QB/WR/TE.
- Warn: K rostered with CPT QB of the same team.
- Warn: K+DST count ≥3; D/ST with ≥4 opposing players.
- Warn: `E[dupes]` above threshold; show which pair drives it.
- Info: salary left under cap (a legitimate dupe-reduction lever).

### 4.3 Lineup-to-contest fit

Compare the generated set's profile against the selected contest's archetype and flag:
- mean `E[dupes]` vs contest field size;
- variance level vs objective (cash-style lineups in a GPP; MME variance in a cash game);
- stack-shape distribution vs contest tier;
- min-uniques satisfied for the entry cap;
- mean sim top-10 / top-1% within expected band.

Output a single fit score plus the offending dimension. Block export only when the contest type on the DK entries CSV doesn't match the preset the set was built under.

---

## 5. Contest screener **[S]**

Inputs pullable from DK lobby via `toto` (CORS only): buy-in, entry cap, field cap, prize pool, places paid, tier boundaries. Manual: full payout curve for large contests, historical fill rate.

| Signal | Play | Tolerate | Avoid |
|---|---|---|---|
| Rake | < 13% | 15–16% (micro only) | > 16% |
| 10th ÷ 1st | ≥ 10% | 5–10% | < 5% (unless hunting first deliberately) |
| Min-cash ÷ buy-in | ≥ 2× | 1.5–2× | < 1.5× |
| Entry cap | single / 3-max | 20-max | 150-max unless maxing |
| % paid | ≥ 20% | 15–20% | < 15% (unless deliberate) |

Screener output: ranked list with the preset (§4.1) each contest maps to, so "select contest → generate" is one path.

---

## 6. Late swap **[S], ships Phase 3**

- Inputs: DK entries CSV (Entry ID, Contest ID, lineup), per-player kickoff, updated projections/inactives (paste-in — I1), user-entered actuals for completed games.
- Constraints: lock any player whose game has started; DK slot rules; prefer latest-kickoff eligible player in FLEX (preserves optionality).
- Method: re-solve open slots for max top-1%/top-10 given partial actuals; re-sim with played portion fixed and the already-played part of the field held at realized ownership.
- Output: ranked swap list with expected ROI delta per swap.
- **Cannot automate:** live scores and updated projections (paid / real-time). The user enters them. `toto` may refresh OUT/Q flags; never scores.

---

## 7. Bankroll and sizing **[S]**

Source: Leone bankroll study (Game Changer, single-entry, $1,500, ~275 entrants, ~22% paid). Self-described as overfit; treat as model estimates. **[E:etr]**

- Even ~40%+ sim-ROI lineups were ~30% to lose money over five seasons and <50% to have a profitable single season.
- ~39% of profitable seasons for a "solid" lineup came from a single bink (≥$50K week).
- 20× weekly buy-in bankroll → near-binary bust/profit; 40× → sub-10% ruin for good/great lineups.

Implementation:
- Monte-Carlo the season per contest using the lineup's sim cash / top-10 / top-1% and the contest's payout shape. **Do not** use the closed-form poker RoR (`e^(−2·WR·BR/σ²)`); it assumes normality and DFS returns are extreme-right-skewed.
- Weekly portfolio = Milly Maker + single-entry + 3-max + showdown, each its own payout distribution; same-night independent slates count as diversification.
- Sizing: fractional Kelly, capped well below full Kelly (start at ¼), recomputed weekly from the calibrated (not simmed) ROI once §9 has ≥6 weeks.
- The 20×/40× thresholds are contest-specific to Game Changer. Generalize by simulation, not by copying the numbers.

---

## 8. Environment and correlation **[S]**

- Dome / road-outdoor: real but modest (~10% passing fantasy boost indoors in the best public data; PFF frames most of it as a road-outdoor penalty). Small tiebreaker on projections; never a primary driver. "Dome QB" as a player trait is largely a games-played artifact. **[E:public]**
- Correlation matrix is measured (nflverse 2019–2025, 35,587 player-weeks) but league-average. Apply a small multiplicative adjustment keyed on Vegas total / spread / pace (higher total → higher intra-game correlation; large spread → shift RB vs passing weighting) until per-game data justifies more. Log the adjustment used per slate. **[P]**
- Mobile-QB / man-coverage / target-split claims: ETR-proprietary, unverified. Not implemented. **[?]**

---

## 9. Receipts: what we grade every week **[S]**

We have **no 2025 standings**. Calibration starts Week 1 2026. Ingest every contest we enter from Week 1, before any of the models in §3 are trusted.

### 9.1 Ingest
- DK GameCenter → Standings CSV per contest (large contests: top-500 + tier boundaries only, zipped). My Contests → History → Entry History for our own lineups.
- Stored on-device only (I3). Columns retained: rank, entry name (hashed), points, lineup, realized ownership.

### 9.2 Fits that run automatically once data exists
- `c_jk` co-ownership multipliers per contest tier (≥3 weeks).
- `P_field(s)` stack-shape frequencies per tier.
- Per-player ownership-projection error band (projected vs realized), by position and ownership bucket.
- Pre→post sim-ROI regression per week (expect ~−20; a week far outside that is a field-model failure).

### 9.3 Grades (published as aggregates)
- **Ownership-miss modes** (Leone's three): correlated-stack-piece drift; chalk-combo product drift (joint vs product); differentiator drift (intended low-owned pieces came in higher). Each reported as projected → realized.
- **Realized vs projected dupes** per lineup, with the pair that drove the miss.
- **Sim calibration tables** in ETR's bucket format: cash buckets 0–15 / 15–18 / 18–21 / 21–24 / 24–27 / 27–30 / 30%+; ROI buckets ≤−40 / −40–−25 / −25–−10 / −10–0 / 0–10 / 10–25 / 25–40 / ≥40; top-1% buckets. Monotonicity is the pass condition; magnitude is secondary.
- **Contest-choice grade:** realized ROI by contest type vs screener rank.
- **Process grade:** did we submit to the contest the set was built for (§4.3)?

### 9.4 Field-sharpening tracker
Each season: recompute winners'-vs-field gap for every §2.3 / §2.4 feature. If a feature's gap collapses, down-weight its validator and its `P_field(s)` prior. This is how the Bible stops ossifying on 2021–22 numbers.

---

## 10. Build order

**Phase 0 — before Week 1 (this week).** Real DK slate import end-to-end with OUT/Q flags. ETR paste-in through the real parser (never done yet). **Showdown captain merge against a real showdown file — untested and highest-risk.** Contest screener with lobby fields. Standings ingest skeleton so Week 1 data is captured even if nothing consumes it yet.

**Phase 1 — Weeks 1–3.** Contest-aware presets (§4.1). Validators (§4.2). Fit check (§4.3). Dupe estimator on §3.2 priors, labelled as priors (I5). Receipts §9.1–9.3 running on whatever exists.

**Phase 2 — Weeks 3–6, gated on ≥3 weeks of standings.** Ownership calibrator (§9.2). Pareto frontier + candidate cloud + sim overlay (§3.3). Replace §3.2 priors with fits; log prior→posterior.

**Phase 3 — mid-season.** Late swap (§6). Portfolio bankroll (§7). Field-sharpening tracker (§9.4) after the season for the first full recompute.

**Not in scope and why:** a live self-updating field model (no data source), game-specific correlation from scratch (insufficient per-game samples in one season), anything that fetches ETR (I1).

---

## 11. Pre-mortem — how this fails

Ranked by rough probability of being the *primary* cause if the hub loses money it shouldn't have this season:

1. **Ownership projection error dominates everything (40–55%).** Every downstream model inherits it. The Achane+Hall-type miss (15% → 25% joint) is the normal case, not the tail. Mitigation: §9.2 error bands, and no trust in dupe estimates before Week 4. If post-lock audits show this is the dominant term, build a proprietary ownership model before any further sim refinement.
2. **We select on rarity anyway (15–25%).** The frontier is seductive; someone will sort by it. Mitigation: I4 is an invariant; the UI's default sort is dupe-adjusted top-10, and rarity is not offered as a sort key.
3. **Descriptive back-tests mistaken for prediction (10–20%).** All §2.3/§2.4 numbers are winner-sample descriptions of a field that has since adapted. Mitigation: §9.4; validators warn, never block.
4. **Compute budget forces cloud size down until the frontier is cosmetic (5–10%).** Mitigation: budget stated in §3.3; if the cloud drops below ~300, the overlay is disabled rather than shown on a sample too small to mean anything.
5. **Showdown parser fails on a real file in Week 1 (5–10%, but it's the earliest and cheapest to prevent).** Mitigation: Phase 0.

Thresholds that change the plan:
- Realized dupes exceed projected by >50% two consecutive weeks → raise all `c_jk` priors 25% immediately, then refit.
- Frontier-edge lineups consistently sim worse than mid-frontier lineups → expected; confirms I4; reduce the frontier's visual prominence.
- Winners' double-stack rate ≤ field rate in our 2026 sample → drop that validator to Info.
- Winners' cumulative ownership persistently >130–140% → the slate-adaptive threshold is already correct; verify it isn't defaulting to a hard cap.
- Any contest measures >16% rake or 10th < 10% of 1st → off the Play list.

---

## 12. Open questions **[?]**

- Does DK's showdown ownership export distinguish CPT ownership from FLEX ownership in the standings CSV? Determines whether `c_jk` for CPT pairs is fittable or stays a prior.
- What is the minimum standings sample per contest tier before a `c_jk` fit beats the prior? Default ≥3 weeks and ≥1,500 lineups; revisit after Week 4.
- Is the ~20-point pre→post ROI regression stable across contest tiers, or Game-Changer-specific?
- How much of the 2025 field-sharpening signal is real vs winner-sample noise (n=8–35 per source)?

---

## Sources (public)

- Levitan, *How to Win DraftKings' Milly Maker in 2022*; *Winning DraftKings Milly Maker Trends*; *DFS Game Selection: Which Contests To Play* — establishtherun.com
- Main, *NFL Showdown 101*; *Showdown Year in Review*; *NFL Showdown Post-Lock Sims, Part 1* (2026) — establishtherun.com
- Leone, *NFL DFS: Putting the Sims to the Test* (2026) — establishtherun.com
- Hunter, Vielma, Zaman, *Picking Winners in Daily Fantasy Sports Using Integer Programming*, arXiv:1604.01455
- Haugh & Singal, *How to Play Fantasy Sports Strategically (and Win)*, Management Science 67(1), 2021
- FantasyLabs (via The Fantasy Footballers), showdown bring-back and 5-1/4-2 guidance; Roto Street Journal 2020 Milly Maker winners; DFS Army Milly Maker reviews 2021–25; SaberSim / Stokastic / The Solver documentation; chanzer0/NFL-DFS-Tools
- DraftKings Network dome vs outdoor production (2025); PFF road-outdoor analysis (2017)

Internal: `docs/DFS_Bible_validation.md` (the independent-validation document this file distills), `dfs-roadmap.md`, `work/dfs-engine.js`.
