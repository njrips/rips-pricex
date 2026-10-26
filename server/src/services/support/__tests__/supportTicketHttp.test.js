const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { SUPPORT_INTERNAL_HEADER, supportInternalToken } = require('../supportInternalAuth');
const {
  INTERNAL_HEADER,
  internalServiceToken,
} = require('../../internalServiceAuth');
const { consoleMemberHeaders, CONSOLE_PROOF_HEADER } = require('../../console/consoleInternalAuth');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env') });

const SHOP_A = 'rpx-support-http-a.myshopify.com';
const SHOP_B = 'rpx-support-http-b.myshopify.com';
const MEMBER = 'rpx-http-test-member@echologyx.com';
const DISABLED_MEMBER = 'rpx-http-test-disabled@echologyx.com';

function canRunHttp() {
  return Boolean(process.env.DATABASE_URL && process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}

describe('support ticket HTTP', { skip: !canRunHttp() }, () => {
  it('enforces console 401, shop isolation, and uninstall delete', async () => {
    const previousMailStub = process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
    process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = 'true';
    const { query } = require('../../../utils/database');
    await query(
      `INSERT INTO team_members (email, role, created_by, disabled_at)
       VALUES ($1, 'support', 'test', NULL), ($2, 'support', 'test', NOW())
       ON CONFLICT (email) DO UPDATE SET disabled_at = EXCLUDED.disabled_at`,
      [MEMBER, DISABLED_MEMBER]
    );
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
      const noAuth = await json(`${base}/api/console/tickets`);
      assert.equal(noAuth.status, 401);

      const forged = await json(`${base}/api/console/tickets`, {
        headers: { ...consoleMemberHeaders(MEMBER), [CONSOLE_PROOF_HEADER]: 'f'.repeat(64) },
      });
      assert.equal(forged.status, 401);

      const disabled = await json(`${base}/api/console/tickets`, {
        headers: consoleMemberHeaders(DISABLED_MEMBER),
      });
      assert.equal(disabled.status, 401);

      const oldBearer = await json(`${base}/api/staff/support/tickets`, {
        headers: { Authorization: 'Bearer anything' },
      });
      assert.equal(oldBearer.status, 404);

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

      const memberHeaders = consoleMemberHeaders(MEMBER);
      const staffList = await json(`${base}/api/console/tickets?q=${encodeURIComponent(publicId)}`, {
        headers: memberHeaders,
      });
      assert.equal(staffList.status, 200, staffList.data?.error || 'staff list failed');
      assert.equal(
        (staffList.data?.tickets || []).some((row) => row.public_id === publicId),
        true
      );
      assert.equal(staffList.data?.tickets?.[0]?.id, undefined);
      assert.equal(staffList.data?.tickets?.[0]?.diagnostics, undefined);

      const merchantOnStaff = await json(`${base}/api/console/tickets`, {
        headers: {
          'X-Shopify-Shop-Domain': SHOP_A,
          [SUPPORT_INTERNAL_HEADER]: supportInternalToken(SHOP_A),
        },
      });
      assert.equal(merchantOnStaff.status, 401);

      const staffOnMerchant = await json(`${base}/api/support/tickets`, {
        headers: memberHeaders,
      });
      assert.equal(staffOnMerchant.status, 401);

      const staffMissing = await json(`${base}/api/console/tickets/PX-ZZZZ`, {
        headers: memberHeaders,
      });
      assert.equal(staffMissing.status, 404);

      const staffGet = await json(`${base}/api/console/tickets/${publicId}`, {
        headers: memberHeaders,
      });
      assert.equal(staffGet.status, 200);
      assert.equal(staffGet.data?.ticket?.shop_domain, SHOP_A);
      assert.equal(staffGet.data?.ticket?.id, undefined);
      assert.equal(staffGet.data?.ticket?.diagnostics?.access_token, undefined);

      const staffReply = await json(`${base}/api/console/tickets/${publicId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...memberHeaders,
        },
        body: JSON.stringify({ body: 'Enable the theme app embed, then retry Setup.' }),
      });
      assert.equal(staffReply.status, 201, staffReply.data?.error || 'staff reply failed');

      const staffThread = await json(`${base}/api/console/tickets/${publicId}`, { headers: memberHeaders });
      const reply = (staffThread.data?.ticket?.messages || []).find((row) => row.author === 'staff');
      assert.equal(reply?.author_email, MEMBER);

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
      const merchantReply = (afterStaff.data?.ticket?.messages || []).find((row) => row.author === 'staff');
      assert.equal(merchantReply?.author_email, undefined);

      // Uninstall is driven by our webhook handler, which proves itself with
      // the internal shared secret rather than an App Bridge token.
      const unauthenticatedUninstall = await json(`${base}/api/shops/uninstall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_A,
        },
        body: '{}',
      });
      assert.equal(unauthenticatedUninstall.status, 401);

      const uninstall = await json(`${base}/api/shops/uninstall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Shop-Domain': SHOP_A,
          [INTERNAL_HEADER]: internalServiceToken(SHOP_A),
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

      const staffAfterUninstall = await json(`${base}/api/console/tickets/${publicId}`, {
        headers: memberHeaders,
      });
      assert.equal(staffAfterUninstall.status, 404);
    } finally {
      await new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(resolve);
      });
      await query('DELETE FROM team_members WHERE email = ANY($1)', [[MEMBER, DISABLED_MEMBER]]).catch(() => {});
      if (previousMailStub === undefined) delete process.env.RIPSPRICEX_SUPPORT_MAIL_STUB;
      else process.env.RIPSPRICEX_SUPPORT_MAIL_STUB = previousMailStub;
    }
  });
});
