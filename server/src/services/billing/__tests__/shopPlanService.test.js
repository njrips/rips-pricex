const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shopPlanFromBody, refreshShopPlan, refreshAllShopPlans } = require('../shopPlanService');

function planBody(partnerDevelopment, publicDisplayName = 'Development') {
  return { data: { shop: { plan: { partnerDevelopment, publicDisplayName } } } };
}

function fakeDb() {
  const calls = [];
  const shops = new Map([['dev.myshopify.com', { partner_development: null }]]);
  return {
    calls,
    shops,
    query: async (sql, params = []) => {
      calls.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.startsWith('SELECT partner_development')) {
        const row = shops.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE shops SET')) {
        shops.set(params[0], { partner_development: params[1] });
        return { rows: [] };
      }
      if (sql.includes('FROM shops WHERE uninstalled_at IS NULL')) {
        return { rows: [...shops.keys()].map((shop_domain) => ({ shop_domain })) };
      }
      return { rows: [] };
    },
  };
}

describe('shop plan check', () => {
  it('reads the development store flag and plan name', () => {
    assert.deepEqual(shopPlanFromBody(planBody(true)), { developmentStore: true, planName: 'Development' });
    assert.deepEqual(shopPlanFromBody(planBody(false, 'Basic')), { developmentStore: false, planName: 'Basic' });
    assert.equal(shopPlanFromBody({ data: { shop: { plan: {} } } }), null);
    assert.equal(shopPlanFromBody({ errors: [{ message: 'nope' }] }), null);
  });

  it('asks Shopify with the stored offline token and records the answer', async () => {
    const db = fakeDb();
    const requests = [];
    const result = await refreshShopPlan('dev.myshopify.com', {
      source: 'console_refresh',
      deps: {
        query: db.query,
        getShopSession: async () => ({ access_token: 'shpat_offline' }),
        shopifyService: {
          requestAdminGraphql: async (shop, token, queryText) => {
            requests.push({ shop, token, queryText });
            return planBody(true);
          },
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.developmentStore, true);
    assert.equal(requests[0].token, 'shpat_offline');
    assert.match(requests[0].queryText, /partnerDevelopment/);
    assert.equal(db.shops.get('dev.myshopify.com').partner_development, true);
    assert.ok(db.calls.some((sql) => sql.startsWith('INSERT INTO shop_billing_events')));
  });

  it('learns nothing without a token or an answer', async () => {
    const db = fakeDb();
    const noToken = await refreshShopPlan('dev.myshopify.com', {
      deps: { query: db.query, getShopSession: async () => null },
    });
    assert.deepEqual(noToken, { ok: false, reason: 'no_answer' });
    assert.equal(db.shops.get('dev.myshopify.com').partner_development, null);
  });

  it('keeps going when one store fails', async () => {
    const db = fakeDb();
    db.shops.set('broken.myshopify.com', { partner_development: null });
    const { checked } = await refreshAllShopPlans({
      query: db.query,
      gapMs: 0,
      getShopSession: async () => ({ access_token: 'shpat_offline' }),
      shopifyService: {
        requestAdminGraphql: async (shop) => {
          if (shop === 'broken.myshopify.com') throw new Error('401');
          return planBody(false, 'Basic');
        },
      },
    });
    assert.equal(checked, 1);
    assert.equal(db.shops.get('dev.myshopify.com').partner_development, false);
  });
});
