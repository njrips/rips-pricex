const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const { consoleMemberHeaders } = require('../../services/console/consoleInternalAuth');

const SHOP = 'rpx-console-http-test.myshopify.com';
const OWNER = 'rpx-console-http-owner@echologyx.com';
const SUPPORT = 'rpx-console-http-support@echologyx.com';
const NEWBIE = 'rpx-console-http-new@echologyx.com';

function canRun() {
  return Boolean(process.env.DATABASE_URL && process.env.SHOPIFY_API_SECRET);
}

describe('console API over HTTP', { skip: !canRun() }, () => {
  it('lists stores, enforces owner-only support access, and audits every change', async () => {
    const previousDevEntitle = process.env.RIPSPRICEX_DEV_ENTITLE_ALL;
    process.env.RIPSPRICEX_DEV_ENTITLE_ALL = 'false';
    const { query } = require('../../utils/database');
    const cleanup = async () => {
      await query('DELETE FROM console_audit_log WHERE shop_domain = $1 OR actor_email = ANY($2)', [
        SHOP,
        [OWNER, SUPPORT],
      ]);
      await query('DELETE FROM support_access_grants WHERE shop_domain = $1', [SHOP]);
      await query('DELETE FROM shops WHERE shop_domain = $1', [SHOP]);
      await query('DELETE FROM team_members WHERE email = ANY($1)', [[OWNER, SUPPORT, NEWBIE]]);
    };
    await cleanup();
    await query(
      `INSERT INTO team_members (email, role, created_by) VALUES ($1, 'owner', 'test'), ($2, 'support', 'test')`,
      [OWNER, SUPPORT]
    );
    await query(
      `INSERT INTO shops (shop_domain, installed_at, entitlement_status) VALUES ($1, NOW(), 'none')`,
      [SHOP]
    );

    const app = require('../../app');
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/console`;
    const call = async (member, urlPath, { method = 'GET', body } = {}) => {
      const res = await fetch(`${base}${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(member ? consoleMemberHeaders(member) : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };

    try {
      assert.equal((await call(null, '/stores')).status, 401);

      const locked = await call(SUPPORT, `/stores?filter=locked&q=${encodeURIComponent('console-http-test')}`);
      assert.equal(locked.status, 200, locked.data?.error);
      assert.equal(locked.data.stores.length, 1);
      assert.equal(locked.data.stores[0].source, 'none');

      const bySupport = await call(SUPPORT, `/stores/${SHOP}/support-access`, {
        method: 'POST',
        body: { days: 7, reason: 'Support member trying to grant' },
      });
      assert.equal(bySupport.status, 403);

      const tooLong = await call(OWNER, `/stores/${SHOP}/support-access`, {
        method: 'POST',
        body: { days: 90, reason: 'Owner asking for too long' },
      });
      assert.equal(tooLong.status, 400);

      const granted = await call(OWNER, `/stores/${SHOP}/support-access`, {
        method: 'POST',
        body: { days: 3, reason: 'Webhook missed after checkout' },
      });
      assert.equal(granted.status, 201, granted.data?.error);
      const grantId = granted.data.grant.id;

      const supportFilter = await call(SUPPORT, `/stores?filter=support_access&q=console-http-test`);
      assert.equal(supportFilter.data.stores.length, 1);
      assert.equal(supportFilter.data.stores[0].source, 'support_access');

      const detail = await call(SUPPORT, `/stores/${SHOP}`);
      assert.equal(detail.status, 200, detail.data?.error);
      assert.equal(detail.data.access.source, 'support_access');
      assert.equal(detail.data.grants.length, 1);

      const extended = await call(OWNER, `/support-access/${grantId}`, { method: 'PATCH', body: { days: 14 } });
      assert.equal(extended.status, 200, extended.data?.error);

      const revoked = await call(OWNER, `/support-access/${grantId}`, {
        method: 'PATCH',
        body: { revoke: true, reason: 'Shopify caught up' },
      });
      assert.equal(revoked.status, 200, revoked.data?.error);
      assert.equal((await call(SUPPORT, `/stores/${SHOP}`)).data.access.source, 'none');

      const refresh = await call(SUPPORT, `/stores/${SHOP}/refresh`, { method: 'POST', body: {} });
      assert.equal(refresh.status, 400);

      const actions = (await call(SUPPORT, `/stores/${SHOP}`)).data.activity.map((row) => row.action);
      assert.deepEqual(actions.sort(), ['grant.create', 'grant.extend', 'grant.revoke', 'store.refresh'].sort());

      assert.equal((await call(SUPPORT, '/team')).status, 403);
      const added = await call(OWNER, '/team', { method: 'POST', body: { email: NEWBIE, role: 'support' } });
      assert.equal(added.status, 201, added.data?.error);
      assert.equal((await call(OWNER, '/team', { method: 'POST', body: { email: NEWBIE } })).status, 409);
      assert.equal(
        (await call(OWNER, '/team', { method: 'POST', body: { email: 'someone@gmail.com' } })).status,
        400
      );
      const team = await call(OWNER, '/team');
      const ownerRow = team.data.members.find((member) => member.email === OWNER);
      const lastOwner = await call(OWNER, `/team/${ownerRow.id}`, { method: 'PATCH', body: { disabled: true } });
      const otherOwners = team.data.members.filter((m) => m.role === 'owner' && !m.disabled && m.email !== OWNER);
      assert.equal(lastOwner.status, otherOwners.length ? 200 : 400);
    } finally {
      await new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(resolve);
      });
      await cleanup();
      if (previousDevEntitle === undefined) delete process.env.RIPSPRICEX_DEV_ENTITLE_ALL;
      else process.env.RIPSPRICEX_DEV_ENTITLE_ALL = previousDevEntitle;
    }
  });
});
