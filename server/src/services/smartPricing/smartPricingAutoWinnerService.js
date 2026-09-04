/**
 * Per-product sequential auto-decision for Smart Pricing tests.
 *
 * Each inbox plan is one SKU test. A variation win writes that SKU's price to
 * Shopify. A control win ends that SKU with no catalog change. Sibling products
 * in the same experiment keep running until they have their own sequential call.
 */

const logger = require('../../utils/logger');
const { isSmartPricingTest, isPriceLikeTestType } = require('./smartPricingTestIdentity');

const CONTROL_RETAIN_MODE = 'control';
/** Products a single sweep will evaluate. Which ones is decided by priority, not by list order. */
const SHOP_CAP = 50;

/**
 * Products considered for that ranking.
 *
 * Only ids are read, so this stays cheap. It has to be wider than SHOP_CAP or the
 * ranking would only ever see a pre-truncated slice of a large catalogue.
 */
const CANDIDATE_CAP = 500;

function parseObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function isRunningStatus(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  return key === 'running' || key === 'active';
}

function isOfferLike({ test, plan } = {}) {
  const type = String(test?.type || '')
    .trim()
    .toLowerCase();
  if (type === 'offer') return true;
  const experimentType = String(
    plan?.experiment_type || plan?.experimentType || plan?.metadata?.experiment_type || ''
  )
    .trim()
    .toLowerCase();
  return experimentType === 'offer_test' || experimentType === 'offer';
}

function isSmartPricingLinked({ test, plan } = {}) {
  return isSmartPricingTest(test) || Boolean(plan?.id);
}

function isAutoWinnerEnabled(test = {}) {
  if (test.auto_stop === false) return false;
  const goal = parseObject(test.goal);
  if (goal.auto_stop === false) return false;
  const rails = parseObject(goal.guardrails);
  if (rails.auto_stop === false) return false;
  return true;
}

/**
 * Shop-level consent to unattended catalog writes. Read live rather than
 * stamped at launch: a merchant switching this off expects it to take effect on
 * the tests they already have running, which is the whole point of a kill
 * switch. Absent guardrails mean off.
 */
function isAutoApplyPermitted(guardrails) {
  return parseObject(guardrails).auto_apply_winner === true;
}

function alreadyDecided(test = {}) {
  const goal = parseObject(test.goal);
  const decision = String(goal.auto_decision || '')
    .trim()
    .toLowerCase();
  if (decision === 'control' || decision === 'challenger') return true;
  const mode = String(test.personalization_mode || '')
    .trim()
    .toLowerCase();
  return mode === 'personalized' || mode === 'rollout' || mode === CONTROL_RETAIN_MODE;
}

function isSequentialSignificance(significance = {}) {
  return significance?.sequential === true || String(significance?.method || '') === 'msprt';
}

function resolveChallengerVariantIndex(test = {}, significance = {}) {
  const variants = Array.isArray(test.variants) ? test.variants : [];
  const winnerId = significance?.winnerVariantId;
  if (winnerId !== null && winnerId !== undefined && String(winnerId).trim() !== '') {
    const byId = variants.findIndex(
      variant =>
        String(variant?.id || '') === String(winnerId) ||
        String(variant?.name || '') === String(winnerId)
    );
    if (byId > 0) return byId;
  }
  const winnerFlag = String(significance?.winner || '')
    .trim()
    .toLowerCase();
  if (winnerFlag === 'variantb' && variants.length >= 2) return 1;
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a ready product sits before the app writes its price unattended.
 *
 * The window is measured from when the product first became ready for the
 * merchant, which is also when they were emailed about it. Without it, the
 * first a merchant would know of an automatic price change is seeing it already
 * done, which defeats the point of telling them at all.
 */
function resolveReviewWindow({ guardrails, readiness, now }) {
  const delayDays = Number(parseObject(guardrails).auto_apply_delay_days);
  const days = Number.isFinite(delayDays) && delayDays > 0 ? delayDays : 0;
  if (days <= 0) return { due: true, apply_at: null, delay_days: 0 };
  const readySince = parseObject(readiness).ready_since;
  const startedAt = readySince ? Date.parse(readySince) : NaN;
  if (!Number.isFinite(startedAt)) {
    // Not yet recorded as ready. This is the first look at it, so the window has
    // not started and certainly has not elapsed.
    return { due: false, apply_at: null, delay_days: days };
  }
  const applyAt = startedAt + days * DAY_MS;
  return {
    due: applyAt <= (now instanceof Date ? now.getTime() : Date.now()),
    apply_at: new Date(applyAt).toISOString(),
    delay_days: days,
  };
}

/**
 * Pure decision. Does not stop or publish — callers apply the action.
 */
function resolveAutoWinnerDecision({ test, analytics, plan, guardrails, readiness, now } = {}) {
  if (!test?.id) {
    return { action: 'skip', reason: 'missing_test' };
  }
  if (!isSmartPricingLinked({ test, plan })) {
    return { action: 'skip', reason: 'not_smart_pricing' };
  }
  if (!isAutoWinnerEnabled(test)) {
    return { action: 'skip', reason: 'auto_stop_disabled' };
  }
  if (!isAutoApplyPermitted(guardrails)) {
    return { action: 'skip', reason: 'auto_apply_disabled_for_shop' };
  }
  if (alreadyDecided(test)) {
    return { action: 'skip', reason: 'already_decided' };
  }
  if (!isRunningStatus(test.status)) {
    return { action: 'skip', reason: 'not_running', test_status: test.status };
  }
  const guardrail = parseObject(test.guardrail_config);
  if (guardrail.breached_at) {
    return { action: 'skip', reason: 'guardrail_breached' };
  }

  const significance =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : {};
  if (significance.sampleReady === false) {
    return { action: 'continue', reason: 'sample_not_ready' };
  }
  if (!isSequentialSignificance(significance)) {
    return { action: 'continue', reason: 'waiting_for_sequential_call' };
  }
  const metricFamily = String(significance.family || '')
    .trim()
    .toLowerCase();
  // A mismatched split is checked first because it invalidates the null the
  // exact evidence is built on. Reporting it as merely "unvalidated" would hide
  // a tracking fault behind a statistics message.
  const srm = significance.srm || analytics?.srm || analytics?.sample_ratio_mismatch || {};
  if (srm.detected === true || srm.mismatch === true) {
    return { action: 'continue', reason: 'sample_ratio_mismatch' };
  }
  // Automatic price writes require exact evidence. The aggregate mSPRT
  // estimates variance, so on its own it is directional evidence only.
  if (significance.evidenceValidated !== true) {
    return {
      action: 'continue',
      reason: 'manual_review_required_for_unvalidated_evidence',
      metric_family: metricFamily,
    };
  }
  if (
    String(significance.method || '').toLowerCase() !== 'beta_binomial_cs' ||
    metricFamily !== 'conversion'
  ) {
    return { action: 'continue', reason: 'validated_conversion_evidence_required' };
  }
  if (significance.outcomesMatured !== true) {
    return {
      action: 'continue',
      reason: 'waiting_for_outcome_maturity',
      collection_days: significance.collectionDays ?? null,
      outcome_maturity_days: significance.outcomeMaturityDays ?? null,
    };
  }

  const offer = isOfferLike({ test, plan });
  if (significance.significant === true) {
    const variantIndex = resolveChallengerVariantIndex(test, significance);
    if (variantIndex == null) {
      return { action: 'continue', reason: 'winner_variant_unresolved' };
    }
    const window = resolveReviewWindow({ guardrails, readiness, now });
    if (!window.due) {
      return {
        action: 'continue',
        reason: 'waiting_for_review_window',
        variantIndex,
        auto_apply_at: window.apply_at,
        delay_days: window.delay_days,
      };
    }
    if (offer) {
      return {
        action: 'complete_offer',
        reason: 'challenger_win',
        variantIndex,
        winnerVariantId: test.variants?.[variantIndex]?.id || significance.winnerVariantId || null,
      };
    }
    if (!isPriceLikeTestType(test.type)) {
      return { action: 'skip', reason: 'unsupported_type' };
    }
    return {
      action: 'apply_variation',
      reason: 'challenger_win',
      variantIndex,
      winnerVariantId: test.variants?.[variantIndex]?.id || significance.winnerVariantId || null,
    };
  }

  if (significance.controlWin === true) {
    return {
      action: offer ? 'complete_offer' : 'retain_control',
      reason: 'control_win',
      variantIndex: 0,
      winnerVariantId: test.variants?.[0]?.id || null,
    };
  }

  return { action: 'continue', reason: 'inconclusive' };
}

function mergeGoalDecision(test, patch) {
  const goal = parseObject(test.goal);
  return {
    ...goal,
    ...patch,
  };
}

function loadDeps(overrides = {}) {
  const testModel = require('../../models/test');
  const { getShopSession } = require('../../models/shopSession');
  const { findInboxPlanByTestId, listInboxPlans } = require('../../models/smartPricingInboxStore');
  const analyticsService = require('../analytics');
  const abTestEngine = require('../abTestEngine');
  const { syncSmartPricingInboxForTest } = require('./smartPricingInboxStopSyncService');
  return {
    getTestById: testModel.getTestById,
    updateTest: testModel.updateTest,
    getShopSession,
    getShopSmartPricingGuardrails: (...args) =>
      require('./smartPricingGuardrailsService').getShopSmartPricingGuardrails(...args),
    getShopRolloutReadiness: (...args) =>
      require('./smartPricingRolloutReadinessStore').getShopRolloutReadiness(...args),
    findInboxPlanByTestId,
    listInboxPlans,
    listRunningSmartPricingTests: shop => listRunningSmartPricingTests(shop),
    getTestAnalytics: (...args) => analyticsService.getTestAnalytics(...args),
    stopTest: (...args) => abTestEngine.stopTest(...args),
    applyPersonalization: (...args) =>
      require('../personalizationService').applyPersonalization(...args),
    resolveWinnerVariantForPublish: (...args) =>
      require('../priceTestWinnerPublishService').resolveWinnerVariantForPublish(...args),
    fetchTargetProductsForPublish: (...args) =>
      require('../priceTestWinnerPublishService').fetchTargetProductsForPublish(...args),
    publishWinnerPricesToShopify: (...args) =>
      require('../priceTestWinnerPublishService').publishWinnerPricesToShopify(...args),
    acquireJobLease: (...args) => require('../../utils/jobLease').acquireJobLease(...args),
    releaseJobLease: (...args) => require('../../utils/jobLease').releaseJobLease(...args),
    productRolloutLeaseName: (...args) =>
      require('../../utils/jobLease').productRolloutLeaseName(...args),
    rolloutLeaseSeconds: require('../../utils/jobLease').ROLLOUT_LEASE_SECONDS,
    maybeAutoQueueRound2Plan: (shop, planId) =>
      require('./smartPricingAutoRound2Service').maybeAutoQueueRound2Plan(shop, planId),
    syncSmartPricingInboxForTest,
    logger,
    ...overrides,
  };
}

async function listRunningSmartPricingTests(shopDomain) {
  const { query } = require('../../utils/database');
  const domain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!domain) return [];
  const { rows } = await query(
    `SELECT id
     FROM tests
     WHERE LOWER(TRIM(shop_domain)) = LOWER(TRIM($1))
       AND status IN ('running', 'active')
       AND LOWER(COALESCE(type, '')) IN ('price', 'pricing', 'offer')
       AND (
         name ILIKE 'Smart Pricing ·%'
         OR description ILIKE 'Created from Smart Pricing%'
         OR description ILIKE '%smart_pricing%'
         OR description ILIKE '%smart pricing%'
       )
     ORDER BY updated_at DESC NULLS LAST
     LIMIT $2`,
    [domain, CANDIDATE_CAP]
  ).catch(() => ({ rows: [] }));
  return (rows || []).map(row => String(row.id || '').trim()).filter(Boolean);
}

const inFlight = new Set();

function lockKey(shopDomain, testId) {
  return `${String(shopDomain || '')
    .trim()
    .toLowerCase()}::${String(testId || '').trim()}`;
}

async function evaluateSmartPricingAutoWinner(input = {}, depOverrides = {}) {
  const deps = loadDeps(depOverrides);
  const shopDomain = String(input.shopDomain || '')
    .trim()
    .toLowerCase();
  let test = input.test || null;
  const testId = String(input.testId || test?.id || '').trim();
  if (!shopDomain || !testId) {
    return { skipped: true, reason: 'missing_shop_or_test' };
  }

  const key = lockKey(shopDomain, testId);
  if (inFlight.has(key)) {
    return { skipped: true, reason: 'in_flight', test_id: testId };
  }
  inFlight.add(key);

  // The in-process set above only excludes other auto-winner runs. This takes
  // the same lock a merchant's apply takes, so an unattended write cannot land
  // on top of one someone is making by hand, or from another instance.
  const lease = deps.productRolloutLeaseName(shopDomain, testId);
  const leased = await deps.acquireJobLease(lease, deps.rolloutLeaseSeconds, {
    failClosed: true,
  });
  if (!leased) {
    inFlight.delete(key);
    return { skipped: true, reason: 'rollout_in_progress', test_id: testId };
  }

  try {
    if (!test) {
      test = await deps.getTestById(testId, shopDomain);
    }
    if (!test) {
      return { skipped: true, reason: 'test_not_found', test_id: testId };
    }

    const plan =
      input.plan ||
      (await deps.findInboxPlanByTestId(shopDomain, testId).catch(() => null)) ||
      null;
    let analytics = input.analytics || null;
    if (!analytics) {
      analytics = await deps.getTestAnalytics(testId, shopDomain).catch(() => null);
    }

    const guardrails =
      input.guardrails ||
      (await deps.getShopSmartPricingGuardrails(shopDomain).catch(() => null)) ||
      null;
    // `undefined` means "not supplied"; the shop sweep passes `null` explicitly
    // for a test it has already looked up, so it is not refetched per test.
    const readiness =
      input.readiness !== undefined
        ? input.readiness
        : (await deps.getShopRolloutReadiness(shopDomain).catch(() => ({})))?.[testId] || null;
    const decision = resolveAutoWinnerDecision({
      test,
      analytics,
      plan,
      guardrails,
      readiness,
    });
    if (decision.action === 'skip' || decision.action === 'continue') {
      if (decision.reason === 'already_decided' && deps.syncSmartPricingInboxForTest) {
        await deps
          .syncSmartPricingInboxForTest(shopDomain, testId, { reason: 'already_decided' })
          .catch(() => null);
      }
      return {
        skipped: true,
        enforced: false,
        test_id: testId,
        test_status: test.status,
        ...decision,
      };
    }

    if (decision.action === 'apply_variation') {
      const session = await deps.getShopSession(shopDomain);
      const accessToken = session?.access_token || session?.accessToken || null;
      if (!accessToken) {
        return {
          skipped: true,
          enforced: false,
          test_id: testId,
          reason: 'missing_access_token',
          action: decision.action,
        };
      }

      const stopped = await deps.stopTest(testId, shopDomain);
      test = stopped || (await deps.getTestById(testId, shopDomain));
      const decidedAt = new Date().toISOString();
      try {
        const winnerVariant = await deps.resolveWinnerVariantForPublish(
          test,
          shopDomain,
          decision.variantIndex
        );
        if (!winnerVariant) {
          throw new Error('Could not determine winner variant');
        }
        const preloadedProducts = await deps.fetchTargetProductsForPublish(
          test,
          shopDomain,
          accessToken
        );
        const publish = await deps.publishWinnerPricesToShopify({
          test,
          winnerVariant,
          shopDomain,
          accessToken,
          preloadedProducts,
          dryRun: false,
        });
        // Shopify can refuse individual variants — a deleted SKU, a permission
        // gap, a rate limit — while accepting the rest. That returns normally,
        // so without counting the failures an unattended run records a clean
        // apply over a catalog that is now half at the old price.
        const publishErrors = Number(publish?.summary?.error_count) || 0;
        const publishUpdated = Number(publish?.summary?.updated_count) || 0;
        // Traffic follows the catalog, never leads it. Personalizing onto a
        // winner whose price only partly exists would charge some shoppers the
        // old price with no split left to measure it against.
        if (publishErrors === 0) {
          await deps.applyPersonalization(testId, shopDomain, {
            variantIndex: decision.variantIndex,
          });
        }
        const updated = await deps.updateTest(testId, shopDomain, {
          goal: mergeGoalDecision(test, {
            auto_decision: 'challenger',
            auto_decided_at: decidedAt,
            auto_apply: {
              published: publishErrors === 0,
              published_at: decidedAt,
              winner_variant_id: decision.winnerVariantId,
              updated_count: publishUpdated,
              error_count: publishErrors,
            },
          }),
        });
        if (publishErrors > 0) {
          deps.logger.error(
            'Smart Pricing auto-apply left prices unwritten, so traffic was not personalized',
            {
              shopDomain,
              testId,
              updatedCount: publishUpdated,
              errorCount: publishErrors,
            }
          );
        }
        await deps
          .syncSmartPricingInboxForTest(shopDomain, testId, { reason: 'auto_winner' })
          .catch(() => null);
        let planId = String(plan?.id || '').trim();
        if (!planId && deps.findInboxPlanByTestId) {
          const linked = await deps.findInboxPlanByTestId(shopDomain, testId).catch(() => null);
          planId = String(linked?.id || '').trim();
        }
        if (publish) {
          try {
            const { recordWinnerApplied } = require('./smartPricingProductLifecycleService');
            await recordWinnerApplied({
              shopDomain,
              testId,
              test: updated,
              publish,
              actor: 'auto_winner',
              eventType: 'auto_applied',
            });
          } catch (err) {
            // The catalog has already changed. Without this snapshot there is
            // nothing for Revert to restore, so the failure must not pass in
            // silence even though it is too late to undo the write.
            deps.logger.error('Smart Pricing auto-apply could not save a revert baseline', {
              shopDomain,
              testId,
              error: err?.message,
            });
          }
        }
        if (planId && deps.maybeAutoQueueRound2Plan) {
          await deps.maybeAutoQueueRound2Plan(shopDomain, planId).catch(() => null);
        }
        deps.logger.info('Smart Pricing auto-applied winning price', {
          shopDomain,
          testId,
          variantIndex: decision.variantIndex,
        });
        return {
          skipped: false,
          enforced: true,
          action: 'apply_variation',
          reason: decision.reason,
          test_id: testId,
          test_status: updated?.status || 'stopped',
          published_to_shopify: publishErrors === 0,
          publish_error_count: publishErrors,
          publish,
          variantIndex: decision.variantIndex,
        };
      } catch (error) {
        await deps
          .updateTest(testId, shopDomain, {
            goal: mergeGoalDecision(test, {
              auto_decision: null,
              auto_apply: {
                published: false,
                error: error.message || 'publish_failed',
                failed_at: decidedAt,
              },
            }),
          })
          .catch(() => null);
        await deps
          .syncSmartPricingInboxForTest(shopDomain, testId, { reason: 'auto_winner_failed' })
          .catch(() => null);
        deps.logger.warn('Smart Pricing auto-apply publish failed; left winner_ready', {
          shopDomain,
          testId,
          error: error.message,
        });
        return {
          skipped: false,
          enforced: true,
          action: 'stop_winner_ready',
          reason: 'publish_failed',
          test_id: testId,
          test_status: 'stopped',
          published_to_shopify: false,
          error: error.message,
        };
      }
    }

    const decidedAt = new Date().toISOString();
    await deps.stopTest(testId, shopDomain);
    const isControl = decision.action === 'retain_control' || decision.reason === 'control_win';
    const updated = await deps.updateTest(testId, shopDomain, {
      status: 'completed',
      personalization_mode: isControl ? CONTROL_RETAIN_MODE : test.personalization_mode || null,
      winner_variant_index: isControl ? 0 : decision.variantIndex,
      winner_variant_id: decision.winnerVariantId || null,
      goal: mergeGoalDecision(test, {
        auto_decision: isControl ? 'control' : 'challenger',
        auto_decided_at: decidedAt,
        auto_apply: { published: false },
      }),
    });
    await deps.syncSmartPricingInboxForTest(shopDomain, testId, {
      reason: isControl ? 'auto_control' : 'auto_offer_complete',
    });
    deps.logger.info('Smart Pricing auto-ended product test', {
      shopDomain,
      testId,
      action: decision.action,
    });
    return {
      skipped: false,
      enforced: true,
      action: decision.action,
      reason: decision.reason,
      test_id: testId,
      test_status: updated?.status || 'completed',
      published_to_shopify: false,
    };
  } finally {
    inFlight.delete(key);
    await deps.releaseJobLease(lease);
  }
}

async function evaluateShopAutoWinners(shopDomain, depOverrides = {}) {
  const deps = loadDeps(depOverrides);
  const domain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!domain) {
    return { shop_domain: domain, evaluated: 0, enforced: 0, results: [] };
  }
  const stored = await deps.listInboxPlans(domain, { archived: false });
  const inboxRunning = (stored.plans || []).filter(plan => {
    const status = String(plan?.status || '')
      .trim()
      .toLowerCase();
    return status === 'running' && String(plan?.test_id || '').trim();
  });
  const inboxByTestId = new Map(
    inboxRunning.map(plan => [String(plan.test_id).trim(), plan])
  );
  const dbIds = deps.listRunningSmartPricingTests
    ? await deps.listRunningSmartPricingTests(domain).catch(() => [])
    : [];
  const candidates = [
    ...inboxByTestId.keys(),
    ...(Array.isArray(dbIds) ? dbIds : []).filter(id => !inboxByTestId.has(id)),
  ];

  // One read for the whole sweep: the shop's consent cannot change mid-loop in
  // any way that matters, and a per-test read would multiply DB round trips.
  const guardrails = await deps.getShopSmartPricingGuardrails(domain).catch(() => null);
  const readinessMap = (await deps.getShopRolloutReadiness(domain).catch(() => ({}))) || {};

  // A shop can have more running products than one sweep evaluates, so which
  // ones make the cut matters. Products already known to be waiting go first,
  // longest-waiting ahead of the rest, because they are the only ones this sweep
  // can act on at all. Everything else rotates by how long since it was looked
  // at, so a product cannot be starved out of ever being considered.
  const testIds = [...candidates]
    .sort((a, b) => {
      const left = readinessMap[a]?.ready_since;
      const right = readinessMap[b]?.ready_since;
      if (left && right) return Date.parse(left) - Date.parse(right);
      if (left) return -1;
      if (right) return 1;
      const seenLeft = readinessMap[a]?.last_seen_at;
      const seenRight = readinessMap[b]?.last_seen_at;
      if (!seenLeft && !seenRight) return 0;
      if (!seenLeft) return -1;
      if (!seenRight) return 1;
      return Date.parse(seenLeft) - Date.parse(seenRight);
    })
    .slice(0, SHOP_CAP);

  const results = [];
  let enforced = 0;
  for (const testId of testIds) {
    const result = await evaluateSmartPricingAutoWinner(
      {
        shopDomain: domain,
        testId,
        plan: inboxByTestId.get(testId) || null,
        guardrails,
        readiness: readinessMap[testId] || null,
      },
      depOverrides
    ).catch(error => ({
      skipped: true,
      reason: error.message || 'evaluate_failed',
      test_id: testId,
    }));
    results.push(result);
    if (result?.enforced) enforced += 1;
  }
  return {
    shop_domain: domain,
    evaluated: testIds.length,
    enforced,
    results,
  };
}

module.exports = {
  CONTROL_RETAIN_MODE,
  resolveAutoWinnerDecision,
  evaluateSmartPricingAutoWinner,
  evaluateShopAutoWinners,
  isAutoWinnerEnabled,
  alreadyDecided,
};
