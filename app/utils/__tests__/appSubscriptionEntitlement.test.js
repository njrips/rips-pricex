import { describe, expect, it } from 'vitest';
import {
  entitlementFromActiveSubscriptions,
  entitlementFromStatus,
  fetchSubscriptionEntitlement,
} from '../appSubscriptionEntitlement.server';

/**
 * Whether the shop is paying.
 *
 * The app previously answered this from its own table alone, and nothing ever
 * wrote a paid status into that table from Shopify, so `none` was terminal in
 * both directions: a merchant who completed checkout stayed locked out, and a
 * merchant who cancelled kept access. These pin the two things that matter
 * about the replacement -- that it can say yes, and that a fault can never
 * make it say no.
 */
describe('reading an entitlement from a subscription status', () => {
  it('treats an active subscription as paying', () => {
    const entitlement = entitlementFromStatus('ACTIVE', 'Priceify Growth');

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.planHandle).toBe('priceify_growth');
  });

  it('does not treat a frozen subscription as paying', () => {
    // Frozen is a shop Shopify has stopped billing, not a paid one.
    expect(entitlementFromStatus('FROZEN').entitled).toBe(false);
    expect(entitlementFromStatus('CANCELLED').entitled).toBe(false);
    expect(entitlementFromStatus('EXPIRED').entitled).toBe(false);
    expect(entitlementFromStatus('PENDING').entitled).toBe(false);
  });

  it('reads the status however it is cased or spaced', () => {
    expect(entitlementFromStatus(' active ').entitled).toBe(true);
  });

  it('carries no plan handle for a shop that is not paying', () => {
    expect(entitlementFromStatus('CANCELLED', 'Priceify Growth').planHandle).toBe(null);
  });

  it('reports a missing status as none rather than guessing', () => {
    expect(entitlementFromStatus(undefined)).toEqual({
      entitled: false,
      status: 'none',
      planHandle: null,
    });
  });
});

describe('reading an entitlement from the active subscription list', () => {
  it('finds the active subscription among others', () => {
    const entitlement = entitlementFromActiveSubscriptions([
      { name: 'Old plan', status: 'CANCELLED' },
      { name: 'Priceify Pro', status: 'ACTIVE' },
    ]);

    expect(entitlement.entitled).toBe(true);
    expect(entitlement.planHandle).toBe('priceify_pro');
  });

  it('treats an empty list as a real answer', () => {
    // This is the case that has to be able to revoke access: the shop has no
    // subscription at all.
    expect(entitlementFromActiveSubscriptions([]).entitled).toBe(false);
  });

  it('reports the status it was given when nothing is active', () => {
    expect(entitlementFromActiveSubscriptions([{ status: 'EXPIRED' }]).status).toBe('EXPIRED');
  });
});

function adminReturning(body) {
  return { graphql: async () => ({ json: async () => body }) };
}

const PAYING = {
  data: { currentAppInstallation: { activeSubscriptions: [{ name: 'Pro', status: 'ACTIVE' }] } },
};

describe('asking Shopify what the shop is paying for', () => {
  it('reports the subscription it found', async () => {
    const entitlement = await fetchSubscriptionEntitlement(adminReturning(PAYING));

    expect(entitlement).toEqual({ entitled: true, status: 'ACTIVE', planHandle: 'pro' });
  });

  it('reports a shop with no subscription as not paying', async () => {
    const entitlement = await fetchSubscriptionEntitlement(
      adminReturning({ data: { currentAppInstallation: { activeSubscriptions: [] } } })
    );

    expect(entitlement?.entitled).toBe(false);
  });

  /**
   * Every one of these has to answer `null`, not `{ entitled: false }`. The
   * caller falls back to its cached value on null, so conflating "we could not
   * find out" with "not paying" would let a blip in the Admin API lock a
   * paying merchant out of their own app.
   */
  it('says nothing when the query times out', async () => {
    const hangs = { graphql: () => new Promise(() => {}) };

    expect(await fetchSubscriptionEntitlement(hangs, { timeoutMs: 10 })).toBe(null);
  });

  it('says nothing when the query throws', async () => {
    const broken = {
      graphql: async () => {
        throw new Error('502 from Shopify');
      },
    };

    expect(await fetchSubscriptionEntitlement(broken)).toBe(null);
  });

  it('says nothing when Shopify answers with GraphQL errors', async () => {
    const entitlement = await fetchSubscriptionEntitlement(
      adminReturning({ errors: [{ message: 'Access denied' }] })
    );

    expect(entitlement).toBe(null);
  });

  it('says nothing when the response has no installation in it', async () => {
    expect(await fetchSubscriptionEntitlement(adminReturning({ data: {} }))).toBe(null);
  });

  it('says nothing when there is no admin client to ask', async () => {
    expect(await fetchSubscriptionEntitlement(null)).toBe(null);
  });
});
