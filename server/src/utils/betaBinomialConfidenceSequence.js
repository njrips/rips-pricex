/**
 * Exact always-valid evidence for a conversion-rate comparison.
 *
 * The mSPRT in alwaysValidSignificance.js estimates variance from running
 * aggregates, which is why it refuses to authorise automatic catalog writes.
 * For binary outcomes that approximation is avoidable entirely.
 *
 * Randomised assignment gives an exact, nuisance-free reduction. If a visitor
 * joins arm B with probability w_B and both arms convert at the same unknown
 * rate p, then any individual conversion came from arm B with probability
 *
 *   θ0 = w_B / (w_A + w_B)
 *
 * which does not involve p at all. Under the null the conversion stream is
 * therefore an exact Bernoulli(θ0) sequence whatever the true conversion rate
 * turns out to be, so nothing has to be estimated.
 *
 * Mixing the alternative over a Beta(a, b) prior on θ gives a likelihood ratio
 * that is a non-negative martingale with expectation 1 under the null:
 *
 *   Λ_N = [B(a + x_B, b + x_A) / B(a, b)] / [θ0^x_B · (1-θ0)^x_A]
 *
 * Ville's inequality bounds the probability of Λ ever reaching 1/α by α, so the
 * evidence may be read continuously without inflating type I error — and that
 * bound is exact and non-asymptotic rather than a large-sample approximation.
 *
 * One condition comes with the reduction: the null is the *designed* split, so
 * the realised split has to match it. Callers must discard this evidence when
 * sample ratio mismatch is detected, because a broken assignment invalidates
 * θ0 itself.
 */

const LANCZOS_G = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Lanczos approximation, accurate to ~15 significant digits for z > 0. */
function logGamma(z) {
  const value = Number(z);
  if (!Number.isFinite(value) || value <= 0) return NaN;
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const x = value - 1;
  const t = x + 7.5;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS_G.length; i += 1) {
    a += LANCZOS_G[i] / (x + i + 1);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logBeta(a, b) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function positive(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(raw) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Share of conversions expected from the challenger under the null. Falls back
 * to the realised visitor split when the design weights are unusable, which
 * keeps a legacy test without stored allocations analysable.
 */
function resolveNullShare({ controlWeight, challengerWeight, controlVisitors, challengerVisitors }) {
  const designed = positive(controlWeight) + positive(challengerWeight);
  if (designed > 0 && positive(challengerWeight) > 0 && positive(controlWeight) > 0) {
    return positive(challengerWeight) / designed;
  }
  const realised = positive(controlVisitors) + positive(challengerVisitors);
  if (realised > 0 && positive(challengerVisitors) > 0 && positive(controlVisitors) > 0) {
    return positive(challengerVisitors) / realised;
  }
  return null;
}

/**
 * Where the challenger's conversion share sits under the target lift. The prior
 * is centred on the null and spread to about that distance, so the test is
 * tuned to the effect the merchant said they care about — the same calibration
 * idea the mSPRT applies to its mixture variance.
 */
function betaPriorForMde(nullShare, mdePercent) {
  const theta0 = Number(nullShare);
  const relative = positive(mdePercent, 10) / 100;
  const controlWeight = 1 - theta0;
  const challengerWeight = theta0;
  const shifted =
    (challengerWeight * (1 + relative)) / (controlWeight + challengerWeight * (1 + relative));
  const spread = Math.max(Math.abs(shifted - theta0), 1e-4);
  const variance = spread * spread;
  const maxVariance = theta0 * (1 - theta0);
  // A Beta cannot hold a variance at or above mean(1-mean); clamp so the prior
  // stays proper, and keep a floor on concentration so a and b stay positive.
  const concentration = Math.max(2, maxVariance / Math.min(variance, maxVariance * 0.9) - 1);
  return { a: theta0 * concentration, b: (1 - theta0) * concentration, theta0, shifted };
}

/**
 * @returns {{ crossed: boolean, pValue: number, logLambda: number, winner: string|null,
 *   conversions: number, nullShare: number, observedShare: number }|null}
 */
function evaluateConversionEvidence({
  control,
  challenger,
  alpha = 0.1,
  mdePercent = 10,
} = {}) {
  const nullShare = resolveNullShare({
    controlWeight: control?.allocation,
    challengerWeight: challenger?.allocation,
    controlVisitors: control?.visitors,
    challengerVisitors: challenger?.visitors,
  });
  if (nullShare === null || !(nullShare > 0) || !(nullShare < 1)) return null;

  const controlConversions = nonNegativeInt(control?.conversions);
  const challengerConversions = nonNegativeInt(challenger?.conversions);
  const total = controlConversions + challengerConversions;
  const level = Math.min(0.5, positive(alpha, 0.1));
  if (total <= 0) {
    return {
      crossed: false,
      pValue: 1,
      logLambda: 0,
      winner: null,
      conversions: 0,
      nullShare,
      observedShare: 0,
    };
  }

  const { a, b } = betaPriorForMde(nullShare, mdePercent);
  const logLambda =
    logBeta(a + challengerConversions, b + controlConversions) -
    logBeta(a, b) -
    (challengerConversions * Math.log(nullShare) +
      controlConversions * Math.log(1 - nullShare));
  const pValue = Number.isFinite(logLambda)
    ? Math.min(1, Math.exp(-logLambda))
    : 1;
  const observedShare = challengerConversions / total;
  const crossed = pValue < level;
  return {
    crossed,
    pValue,
    logLambda,
    // Direction is read from the observed share. The mixture is two-sided, so
    // taking the side afterwards is conservative rather than anti-conservative.
    winner: crossed ? (observedShare > nullShare ? 'challenger' : 'control') : null,
    conversions: total,
    nullShare,
    observedShare,
  };
}

/**
 * Runs the exact evidence for every challenger against control.
 *
 * @returns {{ available: boolean, crossed: boolean, winnerVariantId: string|null,
 *   controlWin: boolean, pValue: number, pairwise: Array }}
 */
function evaluateValidatedConversionEvidence(variants = [], options = {}) {
  const rows = (Array.isArray(variants) ? variants : []).filter(
    row => positive(row?.visitors) > 0
  );
  const blank = {
    available: false,
    crossed: false,
    winnerVariantId: null,
    controlWin: false,
    pValue: 1,
    pairwise: [],
  };
  if (rows.length < 2) return blank;

  const control = rows[0];
  const challengers = rows.slice(1);
  const alpha = positive(options.alpha, 0.1);
  // Bonferroni across challengers, matching the mSPRT layer so the two agree on
  // what a family-wise claim costs.
  const pairAlpha = challengers.length > 1 ? alpha / challengers.length : alpha;
  const pairwise = challengers.map(challenger => ({
    variantId: challenger.id || null,
    variantName: challenger.name || null,
    result: evaluateConversionEvidence({
      control,
      challenger,
      alpha: pairAlpha,
      mdePercent: options.mdePercent,
    }),
  }));
  if (pairwise.some(row => row.result === null)) return blank;

  const winners = pairwise
    .filter(row => row.result.crossed && row.result.winner === 'challenger')
    .sort((a, b) => a.result.pValue - b.result.pValue);
  const controlWins = pairwise.filter(
    row => row.result.crossed && row.result.winner === 'control'
  );
  const best = pairwise.slice().sort((a, b) => a.result.pValue - b.result.pValue)[0];
  return {
    available: true,
    crossed: winners.length > 0,
    winnerVariantId: winners[0]?.variantId || null,
    // One undecided challenger still leaves a price worth testing, so control
    // only wins when every challenger has lost outright.
    controlWin: winners.length === 0 && controlWins.length === pairwise.length,
    pValue: winners[0]?.result.pValue ?? best?.result.pValue ?? 1,
    pairwise: pairwise.map(row => ({
      variantId: row.variantId,
      variantName: row.variantName,
      pValue: Math.round(row.result.pValue * 1e6) / 1e6,
      crossed: row.result.crossed,
      winner: row.result.winner,
      conversions: row.result.conversions,
      nullShare: Math.round(row.result.nullShare * 1e4) / 1e4,
      observedShare: Math.round(row.result.observedShare * 1e4) / 1e4,
    })),
  };
}

/**
 * Conversions are not final the moment they land: an order can be cancelled or
 * refunded, and a single week cannot separate a price effect from day-of-week
 * demand. A price written to the catalog is expensive to undo, so automatic
 * action waits for two full weekly cycles — the same window the planner already
 * treats as the shortest practical test.
 */
const OUTCOME_MATURITY_DAYS = 14;

function resolveCollectionDays(test = {}, now = Date.now()) {
  const started = test?.started_at || test?.startedAt || null;
  const startedAt = started ? Date.parse(started) : NaN;
  if (!Number.isFinite(startedAt)) return null;
  const days = (now - startedAt) / 86400000;
  return days >= 0 ? days : null;
}

function areOutcomesMatured(test = {}, now = Date.now()) {
  const days = resolveCollectionDays(test, now);
  return days !== null && days >= OUTCOME_MATURITY_DAYS;
}

/**
 * Adds exact evidence to a significance object that the mSPRT layer has already
 * filled in. Never loosens the existing read: a claim is promoted only when the
 * exact boundary agrees with the directional one, so this can open the gate for
 * automatic action but can never open it wider than the mSPRT already did.
 */
function applyValidatedConversionEvidence(significance, variants = [], options = {}) {
  const base = significance && typeof significance === 'object' ? { ...significance } : {};
  // Only binary outcomes get the exact treatment. Revenue and profit per
  // visitor still rest on an order-value variance proxy, so they stay manual.
  if (String(base.family || '') !== 'conversion') return base;
  if (base.sampleReady !== true) return base;

  const srm = options.srm && typeof options.srm === 'object' ? options.srm : {};
  if (srm.detected === true || srm.mismatch === true) {
    // The exact null is the designed split. A mismatched realised split means
    // assignment is broken, which invalidates the null rather than weakening it.
    return { ...base, evidenceValidity: 'blocked_sample_ratio_mismatch' };
  }

  const evidence = evaluateValidatedConversionEvidence(variants, {
    alpha: options.alpha,
    mdePercent: base.mdePercent ?? options.mdePercent,
  });
  if (!evidence.available) return base;

  const sameWinner =
    String(evidence.winnerVariantId || '') === String(base.winnerVariantId || '');
  const challengerAgrees = evidence.crossed && base.significant === true && sameWinner;
  const controlAgrees = evidence.controlWin === true && base.controlWin === true;
  const validated = challengerAgrees || controlAgrees;
  const matured = options.outcomesMatured === true;

  return {
    ...base,
    outcomesMatured: matured,
    collectionDays: options.collectionDays ?? null,
    outcomeMaturityDays: OUTCOME_MATURITY_DAYS,
    validatedEvidence: {
      method: 'beta_binomial_cs',
      crossed: evidence.crossed,
      controlWin: evidence.controlWin,
      pValue: Math.round(evidence.pValue * 1e6) / 1e6,
      agreesWithDirectional: validated,
      pairwise: evidence.pairwise,
    },
    ...(validated
      ? {
          method: 'beta_binomial_cs',
          directionalMethod: 'msprt',
          evidenceValidated: true,
          evidenceValidity: 'exact_conditional_bernoulli',
        }
      : {}),
  };
}

module.exports = {
  OUTCOME_MATURITY_DAYS,
  logGamma,
  logBeta,
  resolveNullShare,
  betaPriorForMde,
  resolveCollectionDays,
  areOutcomesMatured,
  evaluateConversionEvidence,
  evaluateValidatedConversionEvidence,
  applyValidatedConversionEvidence,
};
