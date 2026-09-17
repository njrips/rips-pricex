'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.resolve(__dirname, '../../../routes');
const BILLING = path.resolve(__dirname, '../../billing');

function read(name, base = ROOT) {
  return fs.readFileSync(path.join(base, name), 'utf8');
}

test('launch and conflict API copy uses test / Priceify vocabulary', () => {
  const audience = read('smartPricingAudienceGoalService.js');
  const priceLaunch = read('planToPriceTestService.js');
  const offerLaunch = read('planToOfferTestService.js');
  const lifecycle = read('smartPricingProductLifecycleService.js');
  const rollout = read('smartPricingRolloutNotifyService.js');

  assert.match(audience, /Another test is already active for this product/);
  assert.doesNotMatch(audience, /Another Smart Pricing plan/i);

  for (const source of [priceLaunch, offerLaunch]) {
    assert.match(source, /Every test variation must receive more than 0% traffic/);
    assert.match(source, /Test variation traffic must total 100%/);
    assert.doesNotMatch(source, /Smart Pricing variation/i);
  }

  assert.match(lifecycle, /Priceify product tests/);
  assert.match(rollout, /your Priceify tests reached a decision/);
  assert.doesNotMatch(rollout, /Smart Pricing tests reached/i);
});

test('billing, routes, and settings install errors use Priceify vocabulary', () => {
  const entitlement = read('entitlementService.js', BILLING);
  const pricingRoutes = read('smartPricingRoutes.js', ROUTES);
  const settingsRoutes = read('settingsRoutes.js', ROUTES);

  assert.match(entitlement, /Priceify requires an active plan/);
  assert.match(pricingRoutes, /Priceify is disabled for this environment/);
  assert.doesNotMatch(pricingRoutes, /Smart Pricing is disabled/i);

  assert.match(settingsRoutes, /Could not install dynamic cart prices for checkout/);
  assert.match(settingsRoutes, /Checkout pricing functions are not available on this shop yet/);
  assert.doesNotMatch(settingsRoutes, /Deploy ripspricex-cart-transform/i);
});

test('launch blockers and checkout discount errors avoid extension deploy jargon', () => {
  const audience = read('smartPricingAudienceGoalService.js');
  const offerDiscount = read('offerCheckoutDiscountService.js');
  const readiness = read('smartPricingCheckoutReadinessService.js');
  const launch = read('smartPricingLaunchService.js');

  for (const source of [audience, offerDiscount, readiness]) {
    assert.doesNotMatch(source, /Deploy ripspricex-checkout-discount/i);
    assert.doesNotMatch(source, /re-check Setup/i);
  }
  assert.match(launch, /Complete Store setup before launching/);
});
