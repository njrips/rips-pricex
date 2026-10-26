const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireConsoleMember } = require('../middleware/consoleContext');
const { sendError, sendSuccess } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const { query } = require('../utils/database');
const { recordConsoleAction, listConsoleActions } = require('../services/console/consoleAudit');
const { listMembers, addMember, updateMember, getMember } = require('../services/console/teamMembers');
const { revokeAllSessions } = require('../services/console/teamSessions');
const {
  getShopEntitlement,
  listBillingEvents,
  billingDetailsFromRow,
} = require('../services/billing/entitlementService');
const {
  GRANT_DAY_OPTIONS,
  CURRENT_GRANT_SQL,
  presentGrant,
  listGrants,
  getGrant,
  createGrant,
  extendGrant,
  revokeGrant,
} = require('../services/billing/supportAccessService');
const {
  checkShopBilling,
  isPartnerBillingConfigured,
} = require('../services/billing/partnerBillingService');
const { refreshShopPlan } = require('../services/billing/shopPlanService');
const { listStaffTickets } = require('../services/support/supportTicketService');

const router = express.Router();

const ENTITLED = ['ACTIVE', 'active', 'trial', 'TRIAL', 'paid', 'PAID'];
const STORE_FILTERS = ['all', 'locked', 'development', 'support_access', 'trial', 'ending', 'test', 'uninstalled'];
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function shopParam(req) {
  const shop = String(req.params.shop || '').trim().toLowerCase();
  return SHOP_PATTERN.test(shop) ? shop : '';
}

function clientIp(req) {
  return String(req.get('x-priceify-console-ip') || '').slice(0, 64) || null;
}

function handleError(res, err) {
  const status = Number(err.status || err.statusCode || 0);
  if (status >= 400 && status < 500) return sendError(res, status, err.message);
  throw err;
}

function presentStoreRow(row) {
  const installed = !row.uninstalled_at;
  const shopifyEntitled = installed && ENTITLED.includes(String(row.entitlement_status || ''));
  const grant = installed && row.grant_id
    ? presentGrant({
        id: row.grant_id,
        shop_domain: row.shop_domain,
        reason: row.grant_reason,
        starts_at: row.grant_starts_at,
        expires_at: row.grant_expires_at,
        granted_by: row.grant_granted_by,
      })
    : null;
  const developmentStore = installed && row.partner_development === true;
  const source = shopifyEntitled
    ? 'shopify'
    : developmentStore
      ? 'development_store'
      : grant
        ? 'support_access'
        : 'none';
  return {
    shopDomain: row.shop_domain,
    installed,
    installedAt: row.installed_at,
    uninstalledAt: row.uninstalled_at,
    planHandle: row.plan_handle,
    status: row.entitlement_status,
    checkedAt: row.entitlement_checked_at,
    entitled: source !== 'none',
    shopifyEntitled,
    developmentStore,
    source,
    grant,
    billing: billingDetailsFromRow(row),
    runningTests: Number(row.running_tests || 0),
    openTickets: Number(row.open_tickets || 0),
  };
}

const STORE_SELECT = `
  SELECT s.*,
         g.id AS grant_id, g.reason AS grant_reason, g.starts_at AS grant_starts_at,
         g.expires_at AS grant_expires_at, g.granted_by AS grant_granted_by,
         (SELECT COUNT(*) FROM tests t
          WHERE LOWER(TRIM(t.shop_domain)) = s.shop_domain AND t.status = 'running') AS running_tests,
         (SELECT COUNT(*) FROM support_tickets st
          WHERE st.shop_domain = s.shop_domain AND st.status NOT IN ('resolved', 'closed')) AS open_tickets
  FROM shops s
  LEFT JOIN LATERAL (
    SELECT * FROM support_access_grants
    WHERE shop_domain = s.shop_domain AND ${CURRENT_GRANT_SQL}
    ORDER BY expires_at DESC LIMIT 1
  ) g ON TRUE`;

function storeFilterSql(filter) {
  const entitledList = ENTITLED.map((value) => `'${value}'`).join(',');
  switch (filter) {
    case 'locked':
      return `s.uninstalled_at IS NULL AND COALESCE(s.entitlement_status, '') NOT IN (${entitledList})
        AND s.partner_development IS NOT TRUE AND g.id IS NULL`;
    case 'development':
      return 's.uninstalled_at IS NULL AND s.partner_development IS TRUE';
    case 'support_access':
      return 's.uninstalled_at IS NULL AND g.id IS NOT NULL';
    case 'trial':
      return 's.uninstalled_at IS NULL AND s.trial_ends_at > NOW()';
    case 'ending':
      return `s.uninstalled_at IS NULL AND (
        g.expires_at < NOW() + INTERVAL '7 days'
        OR (s.trial_ends_at > NOW() AND s.trial_ends_at < NOW() + INTERVAL '7 days')
      )`;
    case 'test':
      return 's.uninstalled_at IS NULL AND s.subscription_test IS TRUE';
    case 'uninstalled':
      return 's.uninstalled_at IS NOT NULL';
    default:
      return 's.uninstalled_at IS NULL';
  }
}

router.get(
  '/stores',
  requireConsoleMember('support'),
  asyncHandler(async (req, res) => {
    const filter = STORE_FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const params = [];
    let where = storeFilterSql(filter);
    if (q) {
      params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`);
      where += ` AND s.shop_domain LIKE $${params.length}`;
    }
    const { rows } = await query(
      `${STORE_SELECT} WHERE ${where} ORDER BY s.installed_at DESC NULLS LAST LIMIT 500`,
      params
    );
    return sendSuccess(res, HTTP_STATUS.OK, {
      stores: rows.map(presentStoreRow),
      filter,
      q,
      partnerConfigured: isPartnerBillingConfigured(),
    });
  })
);

router.get(
  '/stores/:shop',
  requireConsoleMember('support'),
  asyncHandler(async (req, res) => {
    const shop = shopParam(req);
    if (!shop) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid store');
    const { rows } = await query(`${STORE_SELECT} WHERE s.shop_domain = $1`, [shop]);
    if (!rows[0]) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Store not found');
    const [entitlement, grants, billingEvents, activity, tickets] = await Promise.all([
      getShopEntitlement(shop),
      listGrants(shop),
      listBillingEvents(shop).catch(() => []),
      listConsoleActions({ shopDomain: shop }).catch(() => []),
      listStaffTickets({ shop, status: '' }).catch(() => []),
    ]);
    return sendSuccess(res, HTTP_STATUS.OK, {
      store: presentStoreRow(rows[0]),
      access: { source: entitlement.source, accessEndsAt: entitlement.accessEndsAt },
      grants,
      billingEvents,
      activity,
      tickets: tickets.slice(0, 20),
      grantDayOptions: GRANT_DAY_OPTIONS,
      partnerConfigured: isPartnerBillingConfigured(),
    });
  })
);

const REFRESH_MESSAGES = {
  not_configured:
    'The Partner API keys are not set on this server (SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_TOKEN, SHOPIFY_APP_GID).',
  no_shop_id:
    "This store's Shopify ID is not saved yet. It is saved the next time the merchant opens the app.",
  not_found: 'Store not found',
};

router.post(
  '/stores/:shop/refresh',
  requireConsoleMember('support'),
  asyncHandler(async (req, res) => {
    const shop = shopParam(req);
    if (!shop) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid store');
    const [result, plan] = await Promise.all([
      checkShopBilling(shop, { source: 'console_refresh' }),
      refreshShopPlan(shop, { source: 'console_refresh' }).catch((err) => ({ ok: false, message: err.message })),
    ]);
    const developmentStore = plan.ok ? plan.developmentStore : null;
    await recordConsoleAction({
      actorEmail: req.consoleMember.email,
      action: 'store.refresh',
      shopDomain: shop,
      detail: {
        ok: result.ok,
        reason: result.reason || null,
        hasContract: result.hasContract ?? null,
        developmentStore,
      },
      ip: clientIp(req),
    });
    // The plan check needs only the store's own token, so it still counts as a
    // refresh on a server without Partner API keys.
    if (!result.ok && !(plan.ok && result.reason === 'not_configured')) {
      const message =
        REFRESH_MESSAGES[result.reason] || `Shopify did not answer: ${result.message || 'unknown error'}`;
      return sendError(res, result.reason === 'not_found' ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_REQUEST, message);
    }
    return sendSuccess(res, HTTP_STATUS.OK, {
      hasContract: result.hasContract ?? null,
      details: result.details ?? null,
      developmentStore,
    });
  })
);

router.post(
  '/stores/:shop/support-access',
  requireConsoleMember('owner'),
  asyncHandler(async (req, res) => {
    const shop = shopParam(req);
    if (!shop) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid store');
    try {
      const grant = await createGrant({
        shopDomain: shop,
        days: req.body?.days,
        reason: req.body?.reason,
        grantedBy: req.consoleMember.email,
      });
      await recordConsoleAction({
        actorEmail: req.consoleMember.email,
        action: 'grant.create',
        shopDomain: shop,
        targetId: grant.id,
        detail: { days: Number(req.body?.days), reason: grant.reason, expiresAt: grant.expiresAt },
        ip: clientIp(req),
      });
      return sendSuccess(res, HTTP_STATUS.CREATED, { grant });
    } catch (err) {
      return handleError(res, err);
    }
  })
);

router.patch(
  '/support-access/:id',
  requireConsoleMember('owner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid grant');
    const existing = await getGrant(id);
    if (!existing) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Support access not found');
    try {
      const revoking = req.body?.revoke === true;
      const grant = revoking
        ? await revokeGrant(id, { revokedBy: req.consoleMember.email, reason: req.body?.reason })
        : await extendGrant(id, { days: req.body?.days });
      await recordConsoleAction({
        actorEmail: req.consoleMember.email,
        action: revoking ? 'grant.revoke' : 'grant.extend',
        shopDomain: grant.shopDomain,
        targetId: grant.id,
        detail: revoking
          ? { reason: grant.revokeReason, previousExpiresAt: existing.expiresAt }
          : { days: Number(req.body?.days), expiresAt: grant.expiresAt, previousExpiresAt: existing.expiresAt },
        ip: clientIp(req),
      });
      return sendSuccess(res, HTTP_STATUS.OK, { grant });
    } catch (err) {
      return handleError(res, err);
    }
  })
);

router.get(
  '/me',
  requireConsoleMember('support'),
  asyncHandler(async (req, res) => sendSuccess(res, HTTP_STATUS.OK, { member: req.consoleMember }))
);

router.get(
  '/team',
  requireConsoleMember('owner'),
  asyncHandler(async (req, res) => {
    const [members, activity] = await Promise.all([listMembers(), listConsoleActions({ limit: 50 })]);
    return sendSuccess(res, HTTP_STATUS.OK, { members, activity });
  })
);

router.post(
  '/team',
  requireConsoleMember('owner'),
  asyncHandler(async (req, res) => {
    try {
      const member = await addMember({
        email: req.body?.email,
        role: req.body?.role,
        displayName: req.body?.displayName,
        createdBy: req.consoleMember.email,
      });
      await recordConsoleAction({
        actorEmail: req.consoleMember.email,
        action: 'member.add',
        targetId: member.email,
        detail: { role: member.role },
        ip: clientIp(req),
      });
      return sendSuccess(res, HTTP_STATUS.CREATED, { member });
    } catch (err) {
      return handleError(res, err);
    }
  })
);

router.patch(
  '/team/:id',
  requireConsoleMember('owner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid member');
    try {
      if (req.body?.signOutEverywhere === true) {
        const member = await getMember(id);
        if (!member) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Team member not found');
        const ended = await revokeAllSessions(id);
        await recordConsoleAction({
          actorEmail: req.consoleMember.email,
          action: 'member.sign_out_everywhere',
          targetId: member.email,
          detail: { sessions: ended },
          ip: clientIp(req),
        });
        return sendSuccess(res, HTTP_STATUS.OK, { member, sessionsEnded: ended });
      }
      const member = await updateMember(id, { role: req.body?.role, disabled: req.body?.disabled });
      await recordConsoleAction({
        actorEmail: req.consoleMember.email,
        action: 'member.update',
        targetId: member.email,
        detail: { role: member.role, disabled: member.disabled },
        ip: clientIp(req),
      });
      return sendSuccess(res, HTTP_STATUS.OK, { member });
    } catch (err) {
      return handleError(res, err);
    }
  })
);

module.exports = router;
module.exports.presentStoreRow = presentStoreRow;
module.exports.storeFilterSql = storeFilterSql;
