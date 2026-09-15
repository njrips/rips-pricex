'use strict';

/**
 * Setup reports theme price selectors from this summary, so the count it
 * carries has to mean "selectors the storefront will actually use". It counted
 * every saved row instead, which told a merchant who had switched four of five
 * rows off that five were still mapped, and left the badge stuck on a warning
 * they had no way to clear.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPriceSurfaceReadinessSummary } = require('../priceSurfaceRegistry');

function row(overrides = {}) {
  return { surface: 'pdp', role: 'regular', selector: '.price', ...overrides };
}

test('counts only the rows the storefront would resolve', () => {
  const summary = buildPriceSurfaceReadinessSummary(
    [],
    [
      row({ surface: 'pdp', selector: '.price--pdp' }),
      row({ surface: 'plp', selector: '.price--plp', enabled: false }),
      row({ surface: 'cart', selector: '.price--cart', enabled: false }),
    ]
  );

  assert.equal(summary.configuredShop, 1);
});

test('a disabled product page row leaves the shop unready, and says so honestly', () => {
  // The row is kept, so the merchant can switch it back on, but a kept row is
  // not a working one: nothing paints while it is off.
  const summary = buildPriceSurfaceReadinessSummary(
    [],
    [row({ surface: 'pdp', selector: '.price--pdp', enabled: false })]
  );

  assert.equal(summary.highSeverityGapCount, 1);
  assert.equal(summary.configuredShop, 0, 'an off row is not a mapping');
});

test('one product page row is a complete mapping', () => {
  // Auto-map proposes several surfaces, and a merchant may want only this one.
  // Keeping fewer rows has to be allowed rather than reported as unfinished.
  const summary = buildPriceSurfaceReadinessSummary([], [row({ selector: '.price--pdp' })]);

  assert.equal(summary.highSeverityGapCount, 0, 'the product page is what a price test needs');
  assert.equal(summary.configuredShop, 1);
});

test('the other surfaces stay optional, and only soften the status', () => {
  const summary = buildPriceSurfaceReadinessSummary([], [row({ selector: '.price--pdp' })]);

  // plp, cart and search are medium gaps: worth mentioning, never blocking.
  assert.ok(summary.actionableGapCount > 0);
  assert.equal(summary.status, 'needs_attention');
  assert.equal(summary.highSeverityGapCount, 0);
});
