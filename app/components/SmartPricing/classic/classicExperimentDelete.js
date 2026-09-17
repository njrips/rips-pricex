import { apiDelete } from '../../../services';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { collectExperimentTestIds, getClassicExperimentResumeId } from './classicExperimentListActions';
import { forgetWizardDraftEverywhere } from './classicWizardDraftSync';

export function getClassicExperimentDeleteTargets(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const planIds = plans.map(plan => String(plan?.id || '').trim()).filter(Boolean);
  const testIds = collectExperimentTestIds(plans);
  return { planIds, testIds };
}

export function buildClassicExperimentDeleteConfirmMessage(experiment) {
  const label = experiment?.title || 'this test';
  const { planIds, testIds } = getClassicExperimentDeleteTargets(experiment);
  const productCount = planIds.length;
  const parts = [`Delete ${label}?`];
  if (experiment?.wizardDraft) {
    // A draft has no plans to count, so counting them said nothing at all
    // about what was being thrown away. What it does have is however far the
    // merchant got through the wizard.
    const picked = Number(experiment.productCount) || 0;
    parts.push(
      picked > 0
        ? `This throws away the unfinished setup, including ${picked} chosen product${
            picked === 1 ? '' : 's'
          }.`
        : 'This throws away the unfinished setup.'
    );
  } else if (productCount > 1) {
    parts.push(`This removes ${productCount} inbox plans.`);
  }
  if (testIds.length) {
    parts.push(
      `Also deletes ${testIds.length} linked Priceify test${testIds.length === 1 ? '' : 's'}.`
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
  const resumeId = getClassicExperimentResumeId(experiment);
  if (!planIds.length) {
    // An unfinished wizard draft: no plans, no linked tests, so the draft
    // itself is the whole of it. This used to answer "nothing to delete",
    // which was true of the inbox and false of what the merchant was looking
    // at, leaving a row that could not be removed.
    if (resumeId) {
      const forgotten = await forgetWizardDraftEverywhere(shopDomain, resumeId);
      return {
        ok: forgotten,
        partial: !forgotten,
        deletedPlanIds: [],
        deletedTestIds: [],
        errors: forgotten
          ? []
          : ["Couldn't delete this draft — check your connection and try again."],
      };
    }
    return {
      ok: false,
      partial: false,
      deletedPlanIds: [],
      deletedTestIds: [],
      errors: ['Nothing to delete for this test.'],
    };
  }

  const errors = [];
  const deletedPlanIds = [];
  const deletedTestIds = [];
  const planIdSet = new Set(planIds);

  const current = readInboxPlans(shopDomain) || [];
  const remaining = current.filter(plan => !planIdSet.has(plan.id));
  writeInboxPlans(shopDomain, remaining, { persist: false });
  // The wizard keeps its own copy in a separate store, in the browser and on
  // the server both. Left behind, the experiment just deleted would come back
  // as unfinished work on the list.
  await forgetWizardDraftEverywhere(shopDomain, resumeId);

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
