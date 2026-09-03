import { apiDelete } from '../../../services';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { collectExperimentTestIds } from './classicExperimentListActions';

export function getClassicExperimentDeleteTargets(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const planIds = plans.map(plan => String(plan?.id || '').trim()).filter(Boolean);
  const testIds = collectExperimentTestIds(plans);
  return { planIds, testIds };
}

export function buildClassicExperimentDeleteConfirmMessage(experiment) {
  const label = experiment?.title || 'this experiment';
  const { planIds, testIds } = getClassicExperimentDeleteTargets(experiment);
  const productCount = planIds.length;
  const parts = [`Delete ${label}?`];
  if (productCount > 1) {
    parts.push(`This removes ${productCount} inbox plans.`);
  }
  if (testIds.length) {
    parts.push(
      `Also deletes ${testIds.length} linked Pricify test${testIds.length === 1 ? '' : 's'}.`
    );
  }
  parts.push('This cannot be undone.');
  return parts.join(' ');
}

/**
 * Remove a classic experiment from local inbox, server inbox, and linked RipX tests.
 */
export async function deleteClassicExperimentSynchronized(
  shopDomain,
  experiment,
  { deleteLinkedTests = true } = {}
) {
  const { planIds, testIds } = getClassicExperimentDeleteTargets(experiment);
  if (!planIds.length) {
    return {
      ok: false,
      partial: false,
      deletedPlanIds: [],
      deletedTestIds: [],
      errors: ['Nothing to delete for this experiment.'],
    };
  }

  const errors = [];
  const deletedPlanIds = [];
  const deletedTestIds = [];
  const planIdSet = new Set(planIds);

  const current = readInboxPlans(shopDomain) || [];
  const remaining = current.filter(plan => !planIdSet.has(plan.id));
  writeInboxPlans(shopDomain, remaining, { persist: false });

  try {
    await persistInboxPlansNow(shopDomain, remaining);
    deletedPlanIds.push(...planIds);
  } catch (persistErr) {
    for (const planId of planIds) {
      const result = await deletePersistedInboxPlan(shopDomain, planId);
      if (result?.ok) {
        deletedPlanIds.push(planId);
      } else {
        errors.push(result?.error || persistErr?.message || `Could not delete inbox plan ${planId}.`);
      }
    }
  }

  if (deleteLinkedTests && testIds.length) {
    for (const testId of testIds) {
      try {
        await apiDelete(`/tests/${encodeURIComponent(testId)}`);
        deletedTestIds.push(testId);
      } catch (err) {
        errors.push(err?.message || `Could not delete linked test ${testId}.`);
      }
    }
  }

  const plansRemoved =
    deletedPlanIds.length === planIds.length &&
    readInboxPlans(shopDomain).every(plan => !planIdSet.has(plan.id));
  const testsRemoved =
    !deleteLinkedTests || !testIds.length || deletedTestIds.length === testIds.length;

  return {
    ok: plansRemoved && testsRemoved && errors.length === 0,
    partial: deletedPlanIds.length > 0 || deletedTestIds.length > 0,
    deletedPlanIds,
    deletedTestIds,
    errors,
  };
}
