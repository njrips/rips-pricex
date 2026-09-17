import { describe, expect, it } from 'vitest';
import {
  describeSmartPricingLaunchReadiness,
  isCheckoutReady,
  priceSurfacesUnmapped,
  priceSurfaceSummary,
  themeEmbedStatus,
  themeEmbedThemeName,
  unwrapCheckoutReadiness,
} from '../checkoutReadinessClient';
import { isOfferCheckoutReady } from '../../components/SmartPricing/classic/offerSelection';

/**
 * "We could not check" and "you have mapped nothing" look alike in the
 * payload -- both carry `ready: false` and a zero count -- and the setup page
 * turns the difference into either "Checking…" or a warning badge reading
 * "Product page not mapped".
 */
describe('whether the price surface answer is a verdict at all', () => {
  it('reports a real answer as known', () => {
    const summary = priceSurfaceSummary({
      price_surface: { ready: true, status: 'ready', configured_shop: 3 },
    });

    expect(summary).toMatchObject({ known: true, ready: true, configured: 3 });
  });

  it('reports a shop that has mapped nothing as known and unready', () => {
    const summary = priceSurfaceSummary({
      price_surface: { ready: false, status: 'blocked', configured_shop: 0 },
    });

    expect(summary).toMatchObject({ known: true, ready: false });
  });

  it('does not pass a failed lookup off as a verdict', () => {
    // The server answers `unknown` when it could not read the selectors at
    // all. Treated as an answer, it told a merchant whose theme is mapped
    // that their product page is not.
    const summary = priceSurfaceSummary({
      price_surface: {
        ready: false,
        status: 'unknown',
        configured_shop: 0,
        message: 'Could not load theme price selectors.',
      },
    });

    expect(summary.known).toBe(false);
  });

  it('still does not call an unknown answer "unmapped"', () => {
    expect(
      priceSurfacesUnmapped({
        price_surface: { ready: false, status: 'unknown', configured_shop: 0 },
      })
    ).toBe(false);
  });
});

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

  it('surfaces the first failed price-path check instead of a generic cart-transform line', () => {
    const summary = describeSmartPricingLaunchReadiness({
      ready: false,
      live_api_checked: true,
      discount_function_available: true,
      offer_ready: true,
      failed_checks: [
        'Signed assignment verification is required but no signature secret is configured.',
      ],
      price_surface: { ready: true, configured_shop: 22 },
    });
    expect(summary.detail).toMatch(/signature secret/i);
    expect(summary.detail).not.toMatch(/theme price selectors/i);
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
    expect(summary.detail).toMatch(/Checkout pricing functions/i);
  });
});

describe('theme app embed status', () => {
  it('reads the status the server measured from the live theme', () => {
    expect(themeEmbedStatus({ theme_embed: { status: 'enabled' } })).toBe('enabled');
    expect(themeEmbedStatus({ theme_embed: { status: 'disabled' } })).toBe('disabled');
  });

  it('accepts the status nested under summary, as the fallback route sends it', () => {
    expect(themeEmbedStatus({ summary: { theme_embed: 'unknown' } })).toBe('unknown');
    expect(themeEmbedStatus({ summary: { theme_embed: { status: 'enabled' } } })).toBe('enabled');
  });

  it('never invents a verdict from a payload that carries none', () => {
    // Setup shows a green "already enabled" banner off this, so a missing
    // field must not read as enabled.
    expect(themeEmbedStatus(null)).toBe('unknown');
    expect(themeEmbedStatus({})).toBe('unknown');
    expect(themeEmbedStatus({ theme_embed: { reason: 'lookup_failed' } })).toBe('unknown');
  });

  it('names the theme the answer came from, when the server reports one', () => {
    expect(themeEmbedThemeName({ theme_embed: { status: 'enabled', theme_name: 'Dawn' } })).toBe(
      'Dawn'
    );
    expect(themeEmbedThemeName({ theme_embed: { status: 'enabled' } })).toBeNull();
    expect(themeEmbedThemeName({ summary: { theme_embed: 'unknown' } })).toBeNull();
    expect(themeEmbedThemeName(null)).toBeNull();
  });

  describe('priceSurfacesUnmapped', () => {
    it('reports an unmapped shop', () => {
      expect(
        priceSurfacesUnmapped({ price_surface: { status: 'blocked', configured_shop: 0 } })
      ).toBe(true);
    });

    it('stays quiet once a selector is mapped', () => {
      expect(
        priceSurfacesUnmapped({
          price_surface: { status: 'needs_attention', configured_shop: 3, ready: false },
        })
      ).toBe(false);
      expect(
        priceSurfacesUnmapped({ price_surface: { status: 'ready', configured_shop: 8 } })
      ).toBe(false);
    });

    it('does not read a failed lookup as an unmapped shop', () => {
      // When the server cannot load the mappings it answers with a zero count
      // too. Telling a merchant who has mapped their theme that they have
      // mapped nothing would send them to fix something that is not broken.
      expect(
        priceSurfacesUnmapped({
          price_surface: {
            status: 'needs_attention',
            configured_shop: 0,
            ready: false,
            message: 'Could not load theme price selectors.',
          },
        })
      ).toBe(false);
    });

    it('says nothing when readiness has not loaded', () => {
      // The hook holds `readiness` at null while in flight and after an error,
      // so silence is the only honest answer.
      expect(priceSurfacesUnmapped(null)).toBe(false);
      expect(priceSurfacesUnmapped(undefined)).toBe(false);
      expect(priceSurfacesUnmapped({})).toBe(false);
      expect(priceSurfacesUnmapped({ price_surface: null })).toBe(false);
    });
  });
});
