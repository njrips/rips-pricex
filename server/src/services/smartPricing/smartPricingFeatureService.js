/**
 * Smart Pricing feature gate — opt out with SMART_PRICING_ENABLED=false.
 */

function isSmartPricingEnabled() {
  return process.env.SMART_PRICING_ENABLED !== 'false';
}

module.exports = {
  isSmartPricingEnabled,
};
