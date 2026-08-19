import { describe, expect, it } from 'vitest';
import {
  describeSmartPricingLaunchReadiness,
  isCheckoutReady,
  unwrapCheckoutReadiness,
} from '../checkoutReadinessClient';
import { isOfferCheckoutReady } from '../../components/SmartPricing/classic/offerSelection';

describe('checkoutReadinessClient', () => {
  it('unwraps nested readiness payloads', () => {
    expect(unwrapCheckoutReadiness({ success: true, readiness: { ready: true } })).toEqual({
      ready: true,
    });
  });

  it('treats offer-ready shops as launchable even when the price path is red', () => {
    const readiness = {
      ready: false,
      live_api_checked: true,
      discount_function_available: true,
      offer_ready: true,
    };
    expect(isCheckoutReady(readiness)).toBe(false);
    expect(isOfferCheckoutReady(readiness)).toBe(true);
    const summary = describeSmartPricingLaunchReadiness(readiness);
    expect(summary.anyReady).toBe(true);
    expect(summary.offerReady).toBe(true);
    expect(summary.priceReady).toBe(false);
    expect(summary.title).toMatch(/offer tests/i);
  });

  it('does not claim offer launch when live Shopify has no discount function', () => {
    const summary = describeSmartPricingLaunchReadiness({
      ready: true,
      live_api_checked: true,
      discount_function_available: false,
      offer_ready: false,
    });
    expect(summary.offerReady).toBe(false);
    expect(summary.priceReady).toBe(true);
    expect(summary.anyReady).toBe(true);
    expect(summary.detail).toMatch(/checkout discount/i);
  });
});
