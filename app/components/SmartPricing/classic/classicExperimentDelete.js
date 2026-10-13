import { apiDelete } from '../../../services';
import {
  deleteSmartPricingExperiment,
  deleteSmartPricingExperimentCompletely,
} from '../../../services/smartPricingApi';
import { readInboxPlans, writeInboxPlans } from '../smartPricingConstants';
import { deletePersistedInboxPlan, persistInboxPlansNow } from '../smartPricingInboxPersistence';
import { collectExperimentTestIds, getClassicExperimentResumeId } from './classicExperimentListActions';
import { clearClassicWizardDraft, getPlanExperimentId } from './classicExperimentHelpers';
import { forgetWizardDraftEverywhere } from './classicWizardDraftSync';

/** Matches the server's purge grace period (TEST_PURGE_GRACE_DAYS in smartPricingDeletionStore). */
const TEST_PURGE_GRACE_DAYS = 7;

const NOTHING_CHANGED_MESSAGE =
  "Couldn't delete this test, and nothing was changed. Check your connection and try again.";

/**
 * What a successful delete tells the merchant, wherever it was started.
 * Only launched tests are kept for the grace period, so only they get the
 * restore hint.
 */
export function deletedTestMessage(result, experiment) {
  if (experiment?.wizardDraft) return 'Draft deleted.';
  const count = Array.isArray(result?.deletedTestIds) ? result.deletedTestIds.length : 0;
  if (!count) return 'Test deleted.';
  return `Test deleted, including results for ${count} product${
    count === 1 ? '' : 's'
  }. You can restore it from Recently deleted for ${TEST_PURGE_GRACE_DAYS} days.`;
}

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
    parts.push(`This removes all ${productCount} products in it.`);
  }
  if (testIds.length) {
    // Launched tests wait out the grace period and can be restored until then.
    // A draft or never-launched plan has nothing kept to restore from.
    parts.push(
      `Also deletes results for ${testIds.length} product${testIds.length === 1 ? '' : 's'}.`
    );
    parts.push(
      `You can restore it from Recently deleted for ${TEST_PURGE_GRACE_DAYS} days. After that it is erased for good.`
    );
  } else {
    parts.push('This cannot be undone.');
  }
  return parts.join(' ');
}

/** The experiment id the server knows this row by, or '' for plans that never had one. */
function serverExperimentId(experiment, planIds, resumeId) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const ids = [...new Set(plans.map(getPlanExperimentId).filter(Boolean))];
  if (ids.length === 1) return ids[0];
  // A draft row has no plans; its id is the experiment's own.
  return planIds.length ? '' : String(resumeId || '');
}

function isMissingRoute(err) {
  const status = Number(err?.response?.status) || 0;
  return status === 404 || status === 405;
}

function forgetLocalCopies(shopDomain, { planIds, experimentId, resumeId }) {
  const planIdSet = new Set(planIds);
  const current = readInboxPlans(shopDomain) || [];
  const remaining = current.filter(
    plan =>
      !planIdSet.has(plan.id) && !(experimentId && getPlanExperimentId(plan) === experimentId)
  );
  if (remaining.length !== current.length) {
    writeInboxPlans(shopDomain, remaining, { persist: false });
  }
  // Only with an id: called without one this clears every draft in the browser.
  [resumeId, experimentId].filter(Boolean).forEach(id => clearClassicWizardDraft(shopDomain, id));
}

/**
 * Remove a classic experiment: its tests, its inbox plans, and its draft.
 *
 * One request, done by the server in one transaction. This used to be a run of
 * separate requests -- local copy, then plans, then tests -- and one lost in
 * between (a deploy restarting the server is enough) left tests running with
 * no plan, which the next list load restored. Now the browser copy is only
 * cleared once the server has confirmed, so a failure changes nothing and the
 * merchant can simply try again.
 */
export async function deleteClassicExperimentSynchronized(
  shopDomain,
  experiment,
  { deleteLinkedTests = true } = {}
) {
  const { planIds, testIds } = getClassicExperimentDeleteTargets(experiment);
  const resumeId = getClassicExperimentResumeId(experiment);
  const experimentId = serverExperimentId(experiment, planIds, resumeId);

  if (deleteLinkedTests && (experimentId || planIds.length || testIds.length)) {
    try {
      const result = await deleteSmartPricingExperimentCompletely(shopDomain, {
        experimentId,
        planIds,
        testIds,
      });
      const deletedPlanIds = [
        ...new Set([...planIds, ...(result?.deleted_plan_ids || [])].map(String)),
      ];
      forgetLocalCopies(shopDomain, { planIds: deletedPlanIds, experimentId, resumeId });
      return {
        ok: true,
        partial: false,
        deletedPlanIds,
        deletedTestIds: (result?.test_ids || result?.archived_test_ids || []).map(String),
        errors: [],
      };
    } catch (err) {
      if (!isMissingRoute(err)) {
        const refusal =
          Number(err?.response?.status) === 409
            ? String(err?.response?.data?.error || err?.message || '').trim()
            : '';
        return {
          ok: false,
          partial: false,
          deletedPlanIds: [],
          deletedTestIds: [],
          errors: [refusal || NOTHING_CHANGED_MESSAGE],
        };
      }
      // A server from before the one-request delete. Fall through to the
      // step-by-step path, which at least archives tests before their plans.
    }
  }

  return deleteClassicExperimentStepwise(shopDomain, experiment, { deleteLinkedTests });
}

async function deleteClassicExperimentStepwise(shopDomain, experiment, { deleteLinkedTests }) {
  const { planIds, testIds } = getClassicExperimentDeleteTargets(experiment);
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
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

  // Tests go first. A running test whose plan is gone is restored by the
  // server on the next list load; a plan whose test is archived is harmless.
  // The plans in this browser are not a complete list of the experiment's
  // tests: a plan can be missing from the local copy while its test runs on.
  // The server is asked for every test in the experiment, so none of them is
  // left running behind a deleted row.
  const experimentIds = [...new Set(plans.map(getPlanExperimentId).filter(Boolean))];
  if (deleteLinkedTests && experimentIds.length === 1) {
    try {
      const swept = await deleteSmartPricingExperiment(shopDomain, experimentIds[0]);
      deletedTestIds.push(...(swept?.archived_test_ids || []));
    } catch (err) {
      errors.push(err?.message || 'Could not delete every product test linked to this test.');
    }
  }

  if (deleteLinkedTests && testIds.length) {
    for (const testId of testIds.filter(id => !deletedTestIds.includes(id))) {
      try {
        await apiDelete(`/tests/${encodeURIComponent(testId)}`);
        deletedTestIds.push(testId);
      } catch (err) {
        errors.push(err?.message || 'Could not delete results for every product in this test.');
      }
    }
  }

  const current = readInboxPlans(shopDomain) || [];
  const remaining = current.filter(plan => !planIdSet.has(plan.id));
  writeInboxPlans(shopDomain, remaining, { persist: false });
  // The wizard keeps its own copy in a separate store, in the browser and on
  // the server both. Left behind, the experiment just deleted would come back
  // as unfinished work on the list.
  await forgetWizardDraftEverywhere(shopDomain, resumeId);

  try {
    await persistInboxPlansNow(shopDomain, remaining, { deletedPlanIds: planIds });
    deletedPlanIds.push(...planIds);
  } catch (persistErr) {
    for (const planId of planIds) {
      const result = await deletePersistedInboxPlan(shopDomain, planId);
      if (result?.ok) {
        deletedPlanIds.push(planId);
      } else {
        errors.push(result?.error || persistErr?.message || 'Could not remove every product from this test.');
      }
    }
  }

  const plansRemoved =
    deletedPlanIds.length === planIds.length &&
    readInboxPlans(shopDomain).every(plan => !planIdSet.has(plan.id));
  const testsRemoved =
    !deleteLinkedTests || testIds.every(id => deletedTestIds.includes(id));

  return {
    ok: plansRemoved && testsRemoved && errors.length === 0,
    partial: deletedPlanIds.length > 0 || deletedTestIds.length > 0,
    deletedPlanIds,
    deletedTestIds,
    errors,
  };
}
