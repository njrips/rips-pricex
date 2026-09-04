/**
 * Merchant-configured per-variation floors for calling a result.
 * Only applied when a value was stored on the test or plan — do not invent 5000.
 */

/**
 * Visitors are the wrong unit for deciding whether a price test can be called:
 * the comparison is between conversion rates, so what matters is how many
 * conversions each arm actually produced. The normal approximation behind both
 * the fixed-horizon z-test and the sequential confidence sequence needs roughly
 * this many successes per arm before its variance estimate means anything.
 * Below it a "97% confident" reading is not merely imprecise, it is wrong, so
 * this floor holds even when the merchant asks for less.
 */
const ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION = 10;

function firstPositiveInt(...values) {
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.round(n);
  }
  return null;
}

function resolveStampedSources(test = {}) {
  const meta = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const launchPrefs =
    (meta.launch_preferences && typeof meta.launch_preferences === 'object'
      ? meta.launch_preferences
      : null) ||
    (test?.launch_preferences && typeof test.launch_preferences === 'object'
      ? test.launch_preferences
      : {});
  const audienceUi =
    meta.audience_ui && typeof meta.audience_ui === 'object' ? meta.audience_ui : {};
  const audience = test?.audience && typeof test.audience === 'object' ? test.audience : {};
  const design =
    meta.statistical_design && typeof meta.statistical_design === 'object'
      ? meta.statistical_design
      : {};
  return { launchPrefs, audienceUi, audience, design };
}

function resolveConfiguredMinSampleSize(test = {}, goal = {}) {
  const { launchPrefs, audienceUi, audience } = resolveStampedSources(test);
  return firstPositiveInt(
    goal.min_sample_size,
    goal.minSampleSize,
    launchPrefs.min_sample_size,
    audience.min_sample_size,
    audienceUi.minSampleSize,
    audienceUi.min_sample_size
  );
}

function resolveConfiguredMinConversions(test = {}, goal = {}) {
  const { launchPrefs, audienceUi, audience, design } = resolveStampedSources(test);
  return firstPositiveInt(
    goal.min_conversions_per_variation,
    goal.minConversionsPerVariation,
    launchPrefs.min_conversions_per_variation,
    audience.min_conversions_per_variation,
    audienceUi.minConversionsPerVariation,
    audienceUi.min_conversions_per_variation,
    design.min_conversions_per_variation
  );
}

function lowestArmValue(rows, field) {
  return rows.reduce((min, row) => {
    const n = Number(row?.[field]) || 0;
    return min === null ? n : Math.min(min, n);
  }, null);
}

function applyMinSampleSizeGate(significance, variants = [], minSampleSize, minConversions) {
  const requiredVisitors = firstPositiveInt(minSampleSize);
  const requestedConversions = firstPositiveInt(minConversions);
  const base = significance && typeof significance === 'object' ? { ...significance } : {};
  if (!requiredVisitors && !requestedConversions) return base;

  const requiredConversions = Math.max(
    requestedConversions || 0,
    ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION
  );

  const rows = Array.isArray(variants) ? variants : [];
  const lowestVisitors = lowestArmValue(rows, 'visitors');
  const lowestConversions = lowestArmValue(rows, 'conversions');
  const visitorsReady =
    !requiredVisitors || (lowestVisitors !== null && lowestVisitors >= requiredVisitors);
  const conversionsReady = lowestConversions !== null && lowestConversions >= requiredConversions;
  const gated = {
    ...base,
    ...(requiredVisitors ? { minSampleSize: requiredVisitors } : {}),
    minConversionsPerVariation: requiredConversions,
    lowestArmConversions: lowestConversions || 0,
    sampleReady: rows.length > 0 && visitorsReady && conversionsReady,
  };
  if (gated.sampleReady) return gated;

  return {
    ...gated,
    significant: false,
    controlWin: false,
    winner: null,
    winnerVariantId: null,
    // Withhold the reading itself, not just the verdict. Clearing `significant`
    // alone still published a confidence figure computed from the same sample
    // this floor exists to reject, so a test could show "97%" beside "waiting
    // for 5,000 visitors per variation" — a number that reads as decisive while
    // being, per the note at the top of this file, wrong rather than imprecise.
    // Settings and the merchant guide both promise nothing is calculated until
    // the floors are met; this is what makes that true.
    confidence: null,
    pValue: null,
    evidenceWithheld: true,
    // Name the floor that is actually binding. "Waiting for more data" sends a
    // merchant looking for traffic when the real shortage is orders.
    message: visitorsReady
      ? `Waiting for ${requiredConversions} conversions per variation before calling results (lowest variation has ${lowestConversions || 0}). Below this, a lift reading is noise rather than a price effect.`
      : `Waiting for ${requiredVisitors} visitors per variation before calling results (lowest variation has ${lowestVisitors || 0}).`,
  };
}

module.exports = {
  ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION,
  firstPositiveInt,
  resolveConfiguredMinSampleSize,
  resolveConfiguredMinConversions,
  applyMinSampleSizeGate,
};
