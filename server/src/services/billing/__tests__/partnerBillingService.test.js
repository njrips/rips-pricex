const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  partnerConfig,
  detailsFromActiveSubscription,
  fetchActiveSubscription,
  checkShopBilling,
} = require('../partnerBillingService');

const ENV = {
  SHOPIFY_PARTNER_ORG_ID: '123',
  SHOPIFY_PARTNER_API_TOKEN: 'prtapi_test',
  SHOPIFY_APP_GID: 'gid://shopify/App/456',
};

describe('Partner API billing check', () => {
  it('stays off until every key is set', () => {
    assert.equal(partnerConfig({}), null);
    assert.equal(partnerConfig({ ...ENV, SHOPIFY_APP_GID: '456' }), null);
    assert.deepEqual(partnerConfig(ENV), { orgId: '123', token: 'prtapi_test', appGid: 'gid://shopify/App/456' });
  });

  it('reads trial end, billing cycle and price from an active subscription', () => {
    assert.deepEqual(
      detailsFromActiveSubscription({
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: true,
        trialEndsAt: '2026-11-05T00:00:00Z',
        currentBillingCycle: { startTime: '2026-10-05T00:00:00Z', endTime: '2026-11-04T00:00:00Z' },
        items: [{ handle: 'growth', price: { __typename: 'FlatRatePrice', currency: 'USD', amount: '29.0' } }],
      }),
      {
        planHandle: 'growth',
        trialEndsAt: '2026-11-05T00:00:00Z',
        currentPeriodEnd: '2026-11-04T00:00:00Z',
        interval: 'EVERY_30_DAYS',
        price: '29.0',
        currency: 'USD',
        cancelAtEndOfCycle: true,
      }
    );
    assert.equal(detailsFromActiveSubscription(null), null);
  });

  it('asks the Partner API for the shop with the app id', async () => {
    let sent;
    const result = await fetchActiveSubscription('gid://shopify/Shop/77', {
      env: ENV,
      fetchImpl: async (url, init) => {
        sent = { url, init };
        return { ok: true, status: 200, json: async () => ({ data: { activeSubscription: null } }) };
      },
    });
    assert.deepEqual(result, { ok: true, subscription: null });
    assert.equal(sent.url, 'https://partners.shopify.com/123/api/2026-07/graphql.json');
    assert.equal(sent.init.headers['X-Shopify-Access-Token'], 'prtapi_test');
    assert.deepEqual(JSON.parse(sent.init.body).variables, {
      appId: 'gid://shopify/App/456',
      shopId: 'gid://shopify/Shop/77',
    });
  });

  it('reports why it could not ask', async () => {
    assert.equal((await fetchActiveSubscription('gid://shopify/Shop/1', { env: {} })).reason, 'not_configured');
    assert.equal((await fetchActiveSubscription('', { env: ENV })).reason, 'no_shop_id');
    const errored = await fetchActiveSubscription('gid://shopify/Shop/1', {
      env: ENV,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Access denied' }] }) }),
    });
    assert.deepEqual(errored, { ok: false, reason: 'api_error', message: 'Access denied' });
  });

  it('never revokes: no contract on a paying shop is only recorded', async () => {
    const calls = [];
    const fakeQuery = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) {
        return { rows: [{ shopify_shop_gid: 'gid://shopify/Shop/1', entitlement_status: 'ACTIVE' }] };
      }
      return { rows: [] };
    };
    const result = await checkShopBilling('a.myshopify.com', {
      deps: { query: fakeQuery, fetchActiveSubscription: async () => ({ ok: true, subscription: null }) },
    });
    assert.deepEqual(result, { ok: true, hasContract: false, details: null });
    assert.equal(calls.some((c) => /entitlement_status\s*=/.test(c.sql)), false);
    const event = calls.find((c) => c.sql.includes('shop_billing_events'));
    assert.equal(event.params[1], 'PARTNER_NO_CONTRACT');
  });
});
