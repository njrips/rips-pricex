/**
 * Tells the merchant when a product's test has finished, and keeps the record
 * of when it finished.
 *
 * Products in one experiment reach a verdict at different times. Without a
 * nudge, a winner that landed on Tuesday sits unnoticed until someone happens to
 * open the experiment, which is lost revenue on a decision the app already made.
 * This sweep is also what starts the clock on unattended apply, so the merchant
 * always hears about a price change before it happens rather than after.
 */

const logger = require('../../utils/logger');
const {
  resolveProductRolloutDecision,
  isReadyState,
  PRODUCT_DECISION_STATE,
} = require('./smartPricingProductDecision');
const {
  getShopRolloutReadiness,
  saveShopRolloutReadiness,
  foldReadiness,
  orderByStaleness,
} = require('./smartPricingRolloutReadinessStore');

/** Products evaluated per sweep. The window rotates, so this bounds work per run, not coverage. */
const SHOP_CAP = 50;

/** Long enough for one shop's window, short enough that a crash costs one cycle. */
const LEASE_SECONDS = 10 * 60;

function loadDeps(overrides = {}) {
  return {
    listInboxPlans: (...args) =>
      require('../../models/smartPricingInboxStore').listInboxPlans(...args),
    getTestById: (...args) => require('../../models/test').getTestById(...args),
    getShopSession: (...args) => require('../../models/shopSession').getShopSession(...args),
    getShopSmartPricingGuardrails: (...args) =>
      require('./smartPricingGuardrailsService').getShopSmartPricingGuardrails(...args),
    buildSmartPricingTestAnalytics: (...args) =>
      require('./smartPricingTestAnalyticsService').buildSmartPricingTestAnalytics(...args),
    requestAdminGraphql: (...args) =>
      require('../shopifyService').requestAdminGraphql(...args),
    sendSupportMail: (...args) => require('../support/supportMailer').sendSupportMail(...args),
    acquireJobLease: (...args) => require('../../utils/jobLease').acquireJobLease(...args),
    releaseJobLease: (...args) => require('../../utils/jobLease').releaseJobLease(...args),
    resolveAppUrl: () =>
      require('../support/supportMailer').firstEnv('SHOPIFY_APP_URL', 'APP_URL') || null,
    logger,
    ...overrides,
  };
}

/**
 * The store's contact address, preferring an explicit override so a merchant can
 * route these to whoever actually manages pricing.
 */
async function resolveNotificationEmail(shopDomain, guardrails, deps) {
  const override = String(guardrails?.notification_email || '').trim();
  if (override) return override;
  const session = await deps.getShopSession(shopDomain).catch(() => null);
  const accessToken = session?.access_token || session?.accessToken || null;
  if (!accessToken) return null;
  try {
    const response = await deps.requestAdminGraphql(
      shopDomain,
      accessToken,
      'query shopContact { shop { email contactEmail } }',
      {}
    );
    const shop = response?.data?.shop || {};
    return String(shop.contactEmail || shop.email || '').trim() || null;
  } catch {
    return null;
  }
}

function productLabel(plan, test, decision) {
  return (
    plan?.metadata?.product_title ||
    plan?.product_title ||
    plan?.title ||
    test?.name ||
    decision?.test_id ||
    'Product'
  );
}

function formatMoney(value, currency) {
  // `Number(null)` is 0, so a missing price would otherwise render as "$0.00".
  // Offer tests carry no prices at all, so this path is the common one.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(
      n
    );
  } catch {
    return `${n.toFixed(2)}`;
  }
}

/**
 * Describes one product, and says per product whether it will be applied for you.
 *
 * A batch is usually mixed: some products have the exact evidence that lets
 * Pricify write the price, others only have directional evidence and will wait
 * however long. A single deadline line at the bottom would tell the merchant the
 * wrong thing about most of the list.
 */
function describeRow(row) {
  const { decision } = row;
  if (decision.state === PRODUCT_DECISION_STATE.READY_CONTROL) {
    return `${row.label} — control held. No price change needed.`;
  }
  const from = formatMoney(decision.winner?.current_price, row.currency);
  const to = formatMoney(decision.winner?.price, row.currency);
  const confidence = Number.isFinite(decision.winner?.confidence)
    ? ` at ${decision.winner.confidence.toFixed(1)}% confidence`
    : '';
  // An offer test proved a discount or bundle, not a list price, so there is no
  // price move to quote and nothing to write to the catalog.
  const move =
    decision.action === 'finish_offer'
      ? `${decision.winner?.label || 'the winning offer'} won`
      : from && to
        ? `${from} → ${to}`
        : 'a new price won';
  const applyAt = decision.auto?.apply_at;
  const fate =
    decision.action === 'finish_offer'
      ? ' Mark it finished when you are ready — no catalog price changes.'
      : applyAt
        ? ` Applied automatically on ${new Date(applyAt).toUTCString()} unless you act first.`
        : ' Waiting for you to apply it.';
  return `${row.label} — ${move}${confidence}.${fate}`;
}

/**
 * Product titles come from the merchant's catalogue, so they contain whatever a
 * real shop contains: ampersands, inch marks, angle brackets. Interpolated raw
 * they break the email's markup, which is why every other value in this app's
 * mail goes through the same helper.
 */
const { escapeHtml } = require('../support/supportMailer');

/** Only http(s) belongs in a mail button; anything else is dropped, not escaped. */
function safeHref(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function winnerReadyEmail({ shopDomain, rows, autoApplyAt, appUrl }) {
  const count = rows.length;
  const noun = count === 1 ? 'product' : 'products';
  const lines = rows.map(row => `• ${describeRow(row)}`);
  const automatic = rows.filter(row => row.decision?.auto?.apply_at).length;
  const deadline = !autoApplyAt
    ? 'These wait for you — Pricify will not change any price on its own.'
    : automatic === count
      ? `If you do nothing, Pricify applies these automatically, starting ${new Date(autoApplyAt).toUTCString()}.`
      : `${automatic} of these will be applied automatically, starting ${new Date(autoApplyAt).toUTCString()}. The rest need you to apply them.`;
  const link = safeHref(appUrl ? `${String(appUrl).replace(/\/+$/, '')}/app/experiments` : '');

  const text = [
    `${count} ${noun} in your Smart Pricing tests reached a decision.`,
    '',
    ...lines,
    '',
    deadline,
    link ? `\nReview them: ${link}` : '',
    '',
    `Store: ${shopDomain}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `${count} ${noun} ready to apply — Pricify`,
    text,
    html: [
      '<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#faf7f2;font-family:Inter,Arial,sans-serif;color:#1c1917;line-height:1.5">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eadfd4;border-radius:16px">',
      '<tr><td style="padding:24px 28px">',
      '<p style="margin:0 0 8px;color:#fc4c02;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Pricify</p>',
      `<p style="margin:0 0 16px;font-size:18px;font-weight:700">${count} ${noun} reached a decision</p>`,
      '<ul style="margin:0 0 16px;padding-left:18px">',
      ...rows.map(row => `<li style="margin:0 0 6px">${escapeHtml(describeRow(row))}</li>`),
      '</ul>',
      `<p style="margin:0 0 16px;color:#57534e">${escapeHtml(deadline)}</p>`,
      link
        ? `<p style="margin:0 0 8px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#fc4c02;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Review and apply</a></p>`
        : '',
      `<p style="margin:16px 0 0;color:#78716c;font-size:12px">Store: ${escapeHtml(shopDomain)}</p>`,
      '</td></tr></table>',
      '</body></html>',
    ].join(''),
  };
}

/**
 * Recomputes every running product's verdict for one shop, stores when each
 * became ready, and emails the ones that just crossed over.
 */
async function sweepShopRolloutReadiness(shopDomain, depOverrides = {}) {
  const deps = loadDeps(depOverrides);
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) return { shop_domain: shop, evaluated: 0, ready: 0, notified: 0 };

  // One sweep per shop at a time. Two overlapping sweeps would each read the
  // same readiness record, both conclude the same products need an email, and
  // both send one — then the second write would drop the first's record of
  // having sent it, so it would happen again next time.
  const acquired = await deps.acquireJobLease(`rollout_readiness.${shop}`, LEASE_SECONDS);
  if (!acquired) {
    return { shop_domain: shop, skipped: 'in_progress', evaluated: 0, ready: 0, notified: 0 };
  }
  try {
    return await runShopRolloutSweep(shop, deps);
  } finally {
    await deps.releaseJobLease(`rollout_readiness.${shop}`);
  }
}

async function runShopRolloutSweep(shop, deps) {
  const guardrails = await deps.getShopSmartPricingGuardrails(shop).catch(() => null);
  const stored = await deps.listInboxPlans(shop, { archived: false }).catch(() => ({ plans: [] }));
  const plans = (stored.plans || []).filter(plan => {
    const status = String(plan?.status || '')
      .trim()
      .toLowerCase();
    return String(plan?.test_id || '').trim() && (status === 'running' || status === 'winner_ready');
  });
  if (plans.length === 0) {
    return { shop_domain: shop, evaluated: 0, ready: 0, notified: 0 };
  }

  const existing = await getShopRolloutReadiness(shop);
  const decisions = {};
  const rowsByTestId = new Map();

  const plansByTestId = new Map(plans.map(plan => [String(plan.test_id).trim(), plan]));
  const knownTestIds = [...plansByTestId.keys()];
  // A shop can have more running products than one run can afford to evaluate,
  // so the window rotates by staleness. Taking the head of the list every time
  // would mean the tail was never evaluated at all: no ready-to-apply email, and
  // no `ready_since`, which is what an auto-apply review window counts from.
  const window = orderByStaleness(existing, knownTestIds).slice(0, SHOP_CAP);

  for (const testId of window) {
    const plan = plansByTestId.get(testId);
    const test = await deps.getTestById(testId, shop).catch(() => null);
    const analytics = test
      ? await deps.buildSmartPricingTestAnalytics(shop, testId).catch(() => null)
      : null;
    if (!test || !analytics) {
      // Still counts as looked at. Otherwise a product that always fails to load
      // stays the stalest entry forever and holds the rotation on itself.
      decisions[testId] = { ready: false, state: 'unavailable' };
      continue;
    }
    const decision = resolveProductRolloutDecision({
      test,
      analytics,
      plan,
      guardrails,
      readiness: existing[testId] || null,
    });
    decisions[testId] = { ready: isReadyState(decision.state), state: decision.state };
    rowsByTestId.set(testId, {
      testId,
      label: productLabel(plan, test, decision),
      currency: analytics.currency || 'USD',
      decision,
    });
  }

  const { map, becameReady } = foldReadiness(existing, decisions, { knownTestIds });

  // Every ready product the merchant has not been told about, not just the ones
  // that crossed over on this run. If the address could not be resolved or the
  // send failed on the run a product became ready, keying off `becameReady`
  // alone would mean it was never mentioned again. `notified_at` is what
  // prevents a sweep running every few minutes becoming a mailing list.
  const toNotify = Object.entries(decisions)
    .filter(([testId, entry]) => entry.ready && !map[testId]?.notified_at)
    .map(([testId]) => testId);
  let notified = 0;
  if (toNotify.length > 0 && guardrails?.winner_ready_notify !== false) {
    const to = await resolveNotificationEmail(shop, guardrails, deps);
    if (to) {
      const rows = toNotify.map(testId => rowsByTestId.get(testId)).filter(Boolean);
      const autoApplyAt =
        guardrails?.auto_apply_winner === true
          ? rows
              .map(row => row.decision.auto?.apply_at)
              .filter(Boolean)
              .sort()[0] || null
          : null;
      const mail = winnerReadyEmail({
        shopDomain: shop,
        rows,
        autoApplyAt,
        appUrl: deps.resolveAppUrl(),
      });
      const result = await deps
        .sendSupportMail({ to, subject: mail.subject, text: mail.text, html: mail.html })
        .catch(error => ({ sent: false, reason: error.message }));
      if (result?.sent) {
        const stamp = new Date().toISOString();
        toNotify.forEach(testId => {
          map[testId] = { ...map[testId], notified_at: stamp, notified_state: map[testId]?.ready_state };
        });
        notified = toNotify.length;
        deps.logger.info('Smart Pricing rollout readiness email sent', {
          shopDomain: shop,
          products: notified,
        });
      }
    }
  }

  await saveShopRolloutReadiness(shop, map).catch(() => null);

  return {
    shop_domain: shop,
    tracked: knownTestIds.length,
    evaluated: Object.keys(decisions).length,
    ready: Object.values(decisions).filter(entry => entry.ready).length,
    became_ready: becameReady.length,
    notified,
  };
}

module.exports = {
  sweepShopRolloutReadiness,
  resolveNotificationEmail,
  winnerReadyEmail,
};
