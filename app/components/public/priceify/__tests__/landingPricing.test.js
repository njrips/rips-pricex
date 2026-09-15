import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PRICING_SECTION } from '../landingContent.js';
import { LANDING_BILLING, quoteTierPrice } from '../landingPricing.js';

describe('landingPricing', () => {
  it('quotes monthly and annual tier prices', () => {
    const starter = PRICING_SECTION.tiers[0];
    assert.deepEqual(quoteTierPrice(starter, LANDING_BILLING.annual), {
      price: '$79',
      period: '/ month ~ billed annually',
    });
    assert.deepEqual(quoteTierPrice(starter, LANDING_BILLING.monthly), {
      price: '$99',
      period: '/ month',
    });
  });
});
