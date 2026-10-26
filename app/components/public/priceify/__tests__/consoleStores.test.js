import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  accessLabel,
  billingEventLabel,
  daysUntil,
  formatConsoleDate,
  nextDate,
  normalizeStoreFilter,
  priceLabel,
  storeHref,
  storesHref,
} from '../consoleStores.js';
import {
  developmentStoreMessage,
  supportAccessMessage,
} from '../../../Settings/sections/SettingsPlanPanel.jsx';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('consoleStores', () => {
  it('builds store links and keeps only known filters', () => {
    assert.equal(storesHref({}), '/console/stores');
    assert.equal(storesHref({ filter: 'locked', q: 'ripx' }), '/console/stores?filter=locked&q=ripx');
    assert.equal(storeHref('ripx-plus.myshopify.com'), '/console/stores/ripx-plus.myshopify.com');
    assert.equal(normalizeStoreFilter('support_access'), 'support_access');
    assert.equal(normalizeStoreFilter('drop table'), 'all');
  });

  it('says why a store has access', () => {
    assert.equal(accessLabel({ installed: false }).text, 'Uninstalled');
    assert.equal(accessLabel({ installed: true, source: 'shopify' }).text, 'Shopify plan');
    assert.equal(accessLabel({ installed: true, source: 'none' }).text, 'Locked');
    assert.equal(
      accessLabel({ installed: true, source: 'development_store' }).text,
      'Development store · free'
    );
    assert.equal(normalizeStoreFilter('development'), 'development');
    assert.equal(billingEventLabel('PAID_SHOPIFY_PLAN'), 'Moved to a paid Shopify plan');
    assert.equal(billingEventLabel('ACTIVE'), 'ACTIVE');
    assert.equal(
      accessLabel(
        { installed: true, source: 'support_access', grant: { expiresAt: new Date(NOW + 5 * DAY).toISOString() } },
        NOW
      ).text,
      'Support access · 5 days left'
    );
  });

  it('picks the next date that matters', () => {
    const grantEnd = new Date(NOW + 3 * DAY).toISOString();
    assert.deepEqual(nextDate({ source: 'support_access', grant: { expiresAt: grantEnd } }), {
      label: 'Support access ends',
      value: grantEnd,
    });
    assert.equal(
      nextDate({ source: 'shopify', shopifyEntitled: true, billing: { currentPeriodEnd: '2026-11-01' } }).label,
      'Renews'
    );
    assert.equal(nextDate({ source: 'none', billing: { endedAt: '2026-10-01' } }).label, 'Ended');
    assert.equal(nextDate({ source: 'none', billing: {} }).value, null);
  });

  it('formats dates and prices the same on server and browser', () => {
    assert.equal(formatConsoleDate('2026-11-12T23:30:00Z'), '12 Nov 2026');
    assert.equal(formatConsoleDate(null), '—');
    assert.equal(daysUntil(new Date(NOW + 2 * DAY).toISOString(), NOW), 2);
    assert.equal(priceLabel({ price: 29, currency: 'USD', interval: 'EVERY_30_DAYS' }), '29.00 USD · Monthly');
    assert.equal(priceLabel({}), '—');
  });
});

describe('merchant support access notice', () => {
  it('appears only during support access, and asks for a plan near the end', () => {
    assert.equal(supportAccessMessage({ source: 'shopify' }, NOW), null);
    const early = supportAccessMessage(
      { source: 'support_access', accessEndsAt: new Date(NOW + 10 * DAY).toISOString() },
      NOW
    );
    assert.equal(early.title, 'Access provided by Priceify Support until 5 Nov 2026');
    assert.match(early.detail, /any time/);
    const late = supportAccessMessage(
      { source: 'support_access', accessEndsAt: new Date(NOW + 2 * DAY).toISOString() },
      NOW
    );
    assert.equal(late.detail, 'Choose a plan to keep using Priceify after that date.');
  });
});

describe('merchant development store notice', () => {
  it('appears only on development stores and says when a plan is needed', () => {
    assert.equal(developmentStoreMessage({ source: 'shopify' }), null);
    assert.equal(developmentStoreMessage({ source: 'support_access' }), null);
    const notice = developmentStoreMessage({ source: 'development_store' });
    assert.equal(notice.title, 'Free on development stores');
    assert.match(notice.detail, /paid Shopify plan/);
  });
});
