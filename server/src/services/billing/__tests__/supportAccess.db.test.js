const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });

const SHOP = 'rpx-support-access-test.myshopify.com';
const PAID = 'rpx-support-access-paid.myshopify.com';

function canRunDb() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * The access rule against the real schema: Shopify status and support access
 * are stored apart, so a sync from Shopify must never end a grant, and an
 * ended grant must leave the shop exactly where Shopify put it.
 */
describe('support access against the database', { skip: !canRunDb() }, () => {
  let db;
  let entitlement;
  let access;
  let jobs;
  const previousDevEntitle = process.env.RIPSPRICEX_DEV_ENTITLE_ALL;

  async function reset() {
    await db.query('DELETE FROM support_access_grants WHERE shop_domain = ANY($1)', [[SHOP, PAID]]);
    await db.query('DELETE FROM shop_billing_events WHERE shop_domain = ANY($1)', [[SHOP, PAID]]);
    await db.query('DELETE FROM tests WHERE shop_domain = ANY($1)', [[SHOP, PAID]]);
    await db.query('DELETE FROM shops WHERE shop_domain = ANY($1)', [[SHOP, PAID]]);
  }

  before(async () => {
    // The local pilot switch unlocks every shop, which would hide the lock.
    process.env.RIPSPRICEX_DEV_ENTITLE_ALL = 'false';
    db = require('../../../utils/database');
    entitlement = require('../entitlementService');
    access = require('../supportAccessService');
    jobs = require('../../../jobs/backgroundJobs');
    await reset();
    await entitlement.upsertShopInstall(SHOP);
  });

  after(async () => {
    await reset();
    if (previousDevEntitle === undefined) delete process.env.RIPSPRICEX_DEV_ENTITLE_ALL;
    else process.env.RIPSPRICEX_DEV_ENTITLE_ALL = previousDevEntitle;
  });

  it('locks a shop with no plan and no grant', async () => {
    const result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, false);
    assert.equal(result.source, 'none');
  });

  it('refuses a grant without a real reason or an allowed length', async () => {
    await assert.rejects(
      access.createGrant({ shopDomain: SHOP, days: 7, reason: 'short', grantedBy: 'a@echologyx.com' }),
      /at least 10/
    );
    await assert.rejects(
      access.createGrant({ shopDomain: SHOP, days: 45, reason: 'Long enough reason', grantedBy: 'a@echologyx.com' }),
      /Choose/
    );
    await assert.rejects(
      access.createGrant({
        shopDomain: 'nope.myshopify.com',
        days: 7,
        reason: 'Long enough reason',
        grantedBy: 'a@echologyx.com',
      }),
      /Store not found/
    );
  });

  it('unlocks with a grant and survives Shopify saying "not paying"', async () => {
    const grant = await access.createGrant({
      shopDomain: SHOP,
      days: 7,
      reason: 'Webhook missed after checkout',
      grantedBy: 'owner@echologyx.com',
    });
    let result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, true);
    assert.equal(result.shopifyEntitled, false);
    assert.equal(result.source, 'support_access');
    assert.equal(new Date(result.accessEndsAt).getTime(), new Date(grant.expiresAt).getTime());

    await entitlement.setEntitlement(SHOP, { status: 'none', shopifyStatus: 'CANCELLED', source: 'loader' });
    result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, true);
    assert.equal(result.status, 'none');
    assert.ok(result.billing.endedAt, 'a cancelled status records when it ended');

    await assert.rejects(
      access.createGrant({ shopDomain: SHOP, days: 3, reason: 'Second grant attempt', grantedBy: 'x@echologyx.com' }),
      /already has support access/
    );
  });

  it('keeps running tests on a granted shop and pauses them once the grant ends', async () => {
    const { rows } = await db.query(
      `INSERT INTO tests (shop_domain, name, type, status, goal, variants)
       VALUES ($1, 'grant sweep test', 'price', 'running', '{}'::jsonb, '[]'::jsonb)
       RETURNING id`,
      [SHOP]
    );
    const testId = rows[0].id;
    await jobs.pauseStaleRunningOnCancelPolicy();
    let status = await db.query('SELECT status FROM tests WHERE id = $1', [testId]);
    assert.equal(status.rows[0].status, 'running');

    const current = await access.getCurrentGrant(SHOP);
    await access.revokeGrant(current.id, { revokedBy: 'owner@echologyx.com', reason: 'Shopify caught up' });
    const result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, false);
    assert.equal(result.source, 'none');

    await jobs.pauseStaleRunningOnCancelPolicy();
    status = await db.query('SELECT status FROM tests WHERE id = $1', [testId]);
    assert.equal(status.rows[0].status, 'paused');
  });

  it('ignores an expired grant', async () => {
    await db.query(
      `INSERT INTO support_access_grants (shop_domain, reason, starts_at, expires_at, granted_by)
       VALUES ($1, 'Expired long ago grant', NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day', 'a@echologyx.com')`,
      [SHOP]
    );
    const result = await entitlement.getShopEntitlement(SHOP);
    assert.equal(result.entitled, false);
  });

  it('extends a current grant from now and caps it at 30 days', async () => {
    const grant = await access.createGrant({
      shopDomain: SHOP,
      days: 1,
      reason: 'Pre-launch store testing',
      grantedBy: 'owner@echologyx.com',
    });
    const extended = await access.extendGrant(grant.id, { days: 30 });
    const days = (new Date(extended.expiresAt) - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, `expected ~30 days, got ${days}`);
    await assert.rejects(access.extendGrant(grant.id, { days: 60 }), /Choose/);
  });

  it('ends grants when the shop uninstalls', async () => {
    await entitlement.markShopUninstalled(SHOP);
    assert.equal(await access.getCurrentGrant(SHOP), null);
    const { rows } = await db.query(
      "SELECT revoked_by FROM support_access_grants WHERE shop_domain = $1 AND revoked_by = 'system:uninstall'",
      [SHOP]
    );
    assert.equal(rows.length, 1);
  });

  it('stores billing details and a history row only when something changed', async () => {
    const details = {
      shopGid: 'gid://shopify/Shop/1',
      subscriptionGid: 'gid://shopify/AppSubscription/9',
      subscriptionName: 'Pro',
      test: true,
      currentPeriodEnd: '2026-12-01T00:00:00Z',
      price: '29.00',
      currency: 'usd',
      interval: 'EVERY_30_DAYS',
    };
    await entitlement.setEntitlement(PAID, { status: 'ACTIVE', planHandle: 'pro', details, source: 'loader' });
    await entitlement.setEntitlement(PAID, { status: 'ACTIVE', planHandle: 'pro', details, source: 'loader' });
    const result = await entitlement.getShopEntitlement(PAID);
    assert.equal(result.source, 'shopify');
    assert.equal(result.billing.subscriptionGid, details.subscriptionGid);
    assert.equal(result.billing.currency, 'USD');
    assert.equal(result.billing.price, 29);
    assert.equal(result.billing.test, true);
    assert.equal(result.billing.currentPeriodEnd, '2026-12-01T00:00:00.000Z');
    const events = await entitlement.listBillingEvents(PAID);
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'ACTIVE');
    assert.equal(events[0].source, 'loader');

    await entitlement.setEntitlement(PAID, { status: 'none', shopifyStatus: 'none', details: {}, source: 'webhook' });
    const after = await entitlement.getShopEntitlement(PAID);
    assert.equal(after.billing.subscriptionGid, details.subscriptionGid, 'absent details keep the last known value');
    assert.equal((await entitlement.listBillingEvents(PAID)).length, 2);
  });
});
