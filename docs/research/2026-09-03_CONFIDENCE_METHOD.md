# Which statistical test computes confidence

Written to answer a direct question from the 2026-09-03 review: *"which statistical
method is being used — Student t-test or other?"*

**Short answer: not a t-test, anywhere.** A live Classic price test is decided by a
**mixture sequential probability ratio test (mSPRT)**. Conversion-rate winners get a
second, exact check from a **beta-binomial confidence sequence** before the app is
allowed to write a price on its own. Revenue and profit per visitor never get that
second check.

## Why not a t-test

A t-test is a *fixed-horizon* test: it assumes you fix the sample size in advance,
look once, and decide. Priceify shows a live confidence figure that a merchant
refreshes whenever they like. Reading a fixed-horizon p-value repeatedly is the
classic way to manufacture false winners — with enough looks, a null test crosses
95% eventually.

The mSPRT exists to make continuous reading safe. Its guarantee is *always valid*:
the type-I error rate holds no matter how many times you look, so there is no
penalty for checking every morning.

The t-distribution's other job — correcting for small samples when the variance is
estimated — is handled here by sample floors instead. Nothing is calculated until
every variation clears the minimum sample size, and no winner is called until every
variation reaches at least 10 conversions. At those counts the normal approximation
and the t-distribution agree to more decimal places than the UI shows.

## The three layers

| Layer | File | Applies to | Method |
| --- | --- | --- | --- |
| Directional (the number on screen) | `server/src/utils/alwaysValidSignificance.js` | every Classic test | mixture SPRT |
| Exact confirmation | `server/src/utils/betaBinomialConfidenceSequence.js` | conversion rate only | beta-binomial confidence sequence |
| Fixed-horizon reference | `server/src/services/analytics.js` | legacy non-Smart-Pricing tests | two-proportion z-test, Fisher's exact below n=30 |

`shouldUseSequentialDecision` in `alwaysValidSignificance.js` routes any Smart
Pricing test to the sequential layer, so the fixed-horizon result is computed but
then overwritten. It survives only as `significance.fixedHorizon` for reference.

## Layer 1: the mixture SPRT

Prior on the true effect is normal, `N(0, τ²)`, with `τ` set to the absolute
minimum detectable effect — the 10% target lift applied to the baseline rate. The
likelihood ratio after `n` effective observations is

```
Λ = sqrt( σ² / (σ² + nτ²) ) · exp( S²τ² / (2σ²(σ² + nτ²)) )
```

where `S = n · (mean_challenger − mean_control)` and `n = n₁n₂/(n₁+n₂)`.

The reported figure is `confidence = (1 − p) × 100`, with `p = exp(−log Λ)` bounded
at 1. It is a sequential p-value transform, not a posterior probability and not a
confidence-interval bound. Ville's inequality is what makes reading it continuously
legitimate.

Reference: Johari, Koomen, Pekelis, Walsh, *Always Valid Inference* (2015/2019),
the method behind Optimizely's Stats Engine.

### What changes for a non-binary goal

Only the variance. The test statistic, the mixture, and the p-value transform are
identical — which is the direct answer to the meeting's point that revenue per
visitor "is a non-binary goal, different formula to conversion rate". The formula
that differs is the variance:

```
conversion:            σ² = p(1 − p)
revenue:               σ² = p(1 − p) · (revenue per order)²
profit:                σ² = p(1 − p) · (profit per order)²
```

`p` is the pooled conversion rate. The per-order value is pooled in the same unit
the goal is measured in: revenue over conversions for a revenue goal, profit over
conversions for a profit goal.

Using one shared revenue figure for both, as this did until 2026-09-04, inflated a
profit test's variance by roughly the inverse margin squared — 16× at a 25% margin
— so a profit test asked for many times the traffic its own numbers justified and
sat on "still collecting" long after the evidence had arrived. Since profit per
visitor is the default goal at launch, that affected most tests.

This models a visitor as a Bernoulli purchase scaled by a *constant* order value.
It is a proxy. Real order values vary around their mean, and that spread is not
measured here, because the app aggregates orders rather than storing per-order
second moments. Writing the true variance out shows what is missing:

```
Var(X) = p(1 − p)·μ²  +  p·σ_Y²
         └── modelled ──┘  └ omitted ┘
```

where μ is the mean order value and σ_Y² its variance among buyers. Dropping the
second term understates variance whenever order values are spread out, which makes
the confidence figure optimistic.

That limitation is why revenue and profit per visitor are marked
`evidenceValidity: 'value_metric_variance_proxy'` and can never trigger an
automatic price write. Conversion rate is marked `'estimated_variance'` and can,
once layer 2 agrees.

## Layer 2: the exact confirmation, conversion only

Conditioning on the total number of conversions turns "which arm wins" into a
single Bernoulli parameter, which admits an exact, non-asymptotic boundary — no
normal approximation at all:

```
Λ_N = [ B(a + x_B, b + x_A) / B(a, b) ] / [ θ₀^x_B · (1 − θ₀)^x_A ]
```

`θ₀` is the share of conversions the challenger would win under the designed
traffic split. Ville's inequality bounds at `α` the probability that `Λ` ever
reaches `1/α`, so this too may be read continuously.

`evidenceValidated: true` is set only when this boundary and the mSPRT name the
same winner. Auto-apply requires it, along with both sample floors, a traffic split
matching the design, no guardrail breach, and 14 days elapsed.

## How the two stat settings interact

- **Minimum sample size per variation** gates the whole calculation.
  `applyMinSampleSizeGate` in `server/src/utils/minSampleSize.js` forces
  `significant: false` and clears any winner until every arm clears both the
  visitor floor and the 10-conversion floor.
- **Confidence level** (90% or 95%) becomes `alpha = 1 − confidence`, Bonferroni-
  adjusted across challengers, and decides when the sequential p-value counts as a
  win.

Both are stamped onto the test at launch, so changing them later never rewrites a
running test's statistics.

## Where planning differs

Sample-size planning in `statisticalDesignService.js` and `sampleSizePolicy.js`
uses the Casagrande–Pike two-proportion formula with normal critical values. That
is a planning estimate for the timeline shown on Review; it does not decide
winners. The two coexist on purpose: the plan says roughly how long this will take,
the mSPRT says whether it is done.
