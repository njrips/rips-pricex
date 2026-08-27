const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SUPPORT_INTERNAL_HEADER, supportInternalToken } = require('../supportInternalAuth');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });

const SHOP_A = 'rpx-support-http-a.myshopify.com';
const SHOP_B = 'rpx-support-http-b.myshopify.com';

function canRunHttp() {
  return Boolean(process.env.DATABASE_URL && process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

describe('support ticket HTTP', { skip: !canRunHttp() }, () => {
  it('enforces staff 401, shop isolation, and uninstall delete', async () => {
    const previousStaff = process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
    const previousMailStub = process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
    process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = 'http-test-staff-token';
    process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = 'true';
    const app = require('../../../app');
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const json = async (url, init = {}) => {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    };

    try {
      const noAuth = await json(`${base}/api/staff/support/tickets`);
      assert.equal(noAuth.status, 401);

      const noInternal = await json(`${base}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_A,
        },
        body: JSON.stringify({
          category: 'setup',
          subject: 'Should fail without HMAC',
          body: 'Public /api/support must not accept a shop header alone.',
        }),
      });
      assert.equal(noInternal.status, 401);

      const created = await json(`${base}/api/support/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
        body: JSON.stringify({
          category: 'setup',
          subject: 'HTTP isolation check',
          body: 'Shop A ticket for isolation and uninstall.',
        }),
      });
      assert.equal(created.status, 201, created.data?.error || 'create failed');
      const publicId = created.data?.ticket?.public_id;
      assert.match(String(publicId), /^PX-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
      assert.equal(created.data?.ticket?.id, undefined);
      assert.equal(created.data?.ticket?.shop_domain, undefined);
      assert.equal(created.data?.ticket?.diagnostics, undefined);
      assert.equal(created.data?.ticket?.diagnostics?.access_token, undefined);

      const otherShop = await json(`${base}/api/support/tickets/${publicId}`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_B,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_B),
        },
      });
      assert.equal(otherShop.status, 404);

      const otherList = await json(`${base}/api/support/tickets`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_B,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_B),
        },
      });
      assert.equal(otherList.status, 200);
      assert.equal(
        (otherList.data?.tickets || []).some((row) => row.public_id === publicId),
        false
      );

      const otherReply = await json(`${base}/api/support/tickets/${publicId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_B,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_B),
        },
        body: JSON.stringify({ body: 'Shop B must not reply on Shop A.' }),
      });
      assert.equal(otherReply.status, 404);

      const sameShop = await json(`${base}/api/support/tickets/${publicId}`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
      });
      assert.equal(sameShop.status, 200);
      assert.equal(sameShop.data?.ticket?.public_id, publicId);
      assert.equal(sameShop.data?.ticket?.id, undefined);
      assert.equal(sameShop.data?.ticket?.shop_domain, undefined);
      assert.equal(sameShop.data?.ticket?.diagnostics, undefined);

      const staffToken = process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
      const staffList = await json(`${base}/api/staff/support/tickets?q=${encodeURIComponent(publicId)}`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.equal(staffList.status, 200, staffList.data?.error || 'staff list failed');
      assert.equal(
        (staffList.data?.tickets || []).some((row) => row.public_id === publicId),
        true
      );
      assert.equal(staffList.data?.tickets?.[0]?.id, undefined);
      assert.equal(staffList.data?.tickets?.[0]?.diagnostics, undefined);

      const merchantOnStaff = await json(`${base}/api/staff/support/tickets`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
      });
      assert.equal(merchantOnStaff.status, 401);

      const staffOnMerchant = await json(`${base}/api/support/tickets`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.equal(staffOnMerchant.status, 401);

      const staffMissing = await json(`${base}/api/staff/support/tickets/PX-ZZZZ`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.equal(staffMissing.status, 404);

      const staffGet = await json(`${base}/api/staff/support/tickets/${publicId}`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.equal(staffGet.status, 200);
      assert.equal(staffGet.data?.ticket?.shop_domain, SHOP_A);
      assert.equal(staffGet.data?.ticket?.id, undefined);
      assert.equal(staffGet.data?.ticket?.diagnostics?.access_token, undefined);

      const staffReply = await json(`${base}/api/staff/support/tickets/${publicId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ body: 'Enable the theme app embed, then retry Setup.' }),
      });
      assert.equal(staffReply.status, 201, staffReply.data?.error || 'staff reply failed');

      const afterStaff = await json(`${base}/api/support/tickets/${publicId}`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
      });
      assert.equal(afterStaff.status, 200);
      assert.equal(afterStaff.data?.ticket?.status, 'waiting_merchant');
      const bodies = (afterStaff.data?.ticket?.messages || []).map((row) => row.body);
      assert.equal(bodies.includes('Enable the theme app embed, then retry Setup.'), true);
      assert.equal(afterStaff.data?.ticket?.diagnostics, undefined);

      const uninstall = await json(`${base}/api/shops/uninstall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_A,
        },
        body: '{}',
      });
      assert.equal(uninstall.status, 200);

      const afterUninstall = await json(`${base}/api/support/tickets/${publicId}`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
      });
      assert.equal(afterUninstall.status, 404);

      const staffAfterUninstall = await json(`${base}/api/staff/support/tickets/${publicId}`, {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      assert.equal(staffAfterUninstall.status, 404);
    } finally {
      await new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(resolve);
      });
      if (previousStaff === undefined) delete process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN;
      else process.env.RIPSPRICEX_STAFF_SUPPORT_TOKEN = previousStaff;
      if (previousMailStub === undefined) delete process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
      else process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = previousMailStub;
    }
  });
});
