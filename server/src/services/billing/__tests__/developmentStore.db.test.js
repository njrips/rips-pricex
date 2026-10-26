const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });

const SHOP = 'rpx-development-store-test.myshopify.com';

function canRunDb() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Partner development stores use Priceify free for as long as Shopify reports
 * them as one, and go back to needing a plan the moment it says otherwise.
 */
describe('development store access against the database', { skip: !canRunDb() }, () => {
  let db;
  let entitlement;
  let shopPlan;
  let jobs;
  const previousDevEntitle = process.env.RIPSPRICEX_DEV_ENTITLE_ALL;

  async function reset() {
    await db.query('DELETE FROM shop_billing_events WHERE shop_domain = $1', [SHOP]);
    await db.query('DELETE FROM tests WHERE shop_domain = $1', [SHOP]);
    await db.query('DELETE FROM shops WHERE shop_domain = $1', [SHOP]);
  }

  before(async () => {
    process.env.RIPSPRICEX_DEV_ENTITLE_ALL = 'false';
    db = require('../../../utils/database');
    entitlement = require('../entitlementService');
    shopPlan = require('../shopPlanService');
    jobs = require('../../../jobs/backgroundJobs');
    await reset();
    await entitlement.upsertShopInstall(SHOP);
  });

  after(async () => {
    await reset();
    if (previousDevEntitle === undefined) delete process.env.RIPSPRICEX_DEV_ENTITLE_ALL;
    else process.env.RIPSPRICEX_DEV_ENTITLE_ALL = previousDevEntitle;
  });

  it('unlocks a development store without a Priceify plan', async () => {
    let result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, false);

    const { changed } = await shopPlan.recordShopPlan(SHOP, {
      developmentStore: true,
      planName: 'Development',
      source: 'loader',
    });
    assert.equal(changed, true);
    result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, true);
    assert.equal(result.shopifyEntitled, false);
    assert.equal(result.developmentStore, true);
    assert.equal(result.source, 'development_store');
    assert.equal(result.billing.shopPlanName, 'Development');

    const again = await shopPlan.recordShopPlan(SHOP, { developmentStore: true, source: 'daily_check' });
    assert.equal(again.changed, false, 'an unchanged flag adds no history row');
    const { rows } = await db.query('SELECT status FROM shop_billing_events WHERE shop_domain = $1', [SHOP]);
    assert.deepEqual(rows.map((row) => row.status), ['DEVELOPMENT_STORE']);
  });

  it('reports a paid Shopify plan as the reason when both apply', async () => {
    await entitlement.setEntitlement(SHOP, { status: 'ACTIVE', planHandle: 'growth', source: 'loader' });
    const result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.source, 'shopify');
    await entitlement.setEntitlement(SHOP, { status: 'none', shopifyStatus: 'CANCELLED', source: 'loader' });
    assert.equal((await entitlement.getShopEntitlement(SHOP)).source, 'development_store');
  });

  it('keeps a development store running and pauses it once it moves to a paid Shopify plan', async () => {
    const { rows } = await db.query(
      `INSERT INTO tests (shop_domain, name, type, status, goal, variants)
       VALUES ($1, 'development store sweep test', 'price', 'running', '{}'::jsonb, '[]'::jsonb)
       RETURNING id`,
      [SHOP]
    );
    const testId = rows[0].id;
    await jobs.pauseStaleRunningOnCancelPolicy();
    let status = await db.query('SELECT status FROM tests WHERE id = $1', [testId]);
    assert.equal(status.rows[0].status, 'running');

    await shopPlan.recordShopPlan(SHOP, { developmentStore: false, planName: 'Basic', source: 'webhook' });
    const result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, false);
    assert.equal(result.source, 'none');
    const events = await db.query(
      'SELECT status FROM shop_billing_events WHERE shop_domain = $1 ORDER BY id DESC LIMIT 1',
      [SHOP]
    );
    assert.equal(events.rows[0].status, 'PAID_SHOPIFY_PLAN');

    await jobs.pauseStaleRunningOnCancelPolicy();
    status = await db.query('SELECT status FROM tests WHERE id = $1', [testId]);
    assert.equal(status.rows[0].status, 'paused');
  });

  it('ignores an answer without the flag', async () => {
    const before = await entitlement.getShopEntitlement(SHOP);
    await shopPlan.recordShopPlan(SHOP, { developmentStore: undefined, source: 'loader' });
    const after = await entitlement.getShopEntitlement(SHOP);
    assert.equal(after.developmentStore, before.developmentStore);
  });
});
