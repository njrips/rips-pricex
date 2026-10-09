/**
 * Global holdout is intentionally disabled until the product exposes a
 * merchant setting and analytics reporting for it. Export the function the
 * assignment engine calls instead of relying on its exception fallback.
 */
async function getGlobalHoldoutPercent() {
  return 0;
}

module.exports = { getGlobalHoldoutPercent };
