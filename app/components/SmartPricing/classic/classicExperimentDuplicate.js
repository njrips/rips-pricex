/**
 * Duplicate a test setup into a new wizard draft (PDF: "Creates a new Draft with same setup").
 */

import { createDefaultAudienceState } from './AudienceSuccessStepPanel';
import { audienceUiFromSummaries } from './classicAudienceEdit';
import {
  getPlanExperimentTitle,
  readClassicWizardDraft,
} from './classicExperimentHelpers';
import { getClassicExperimentResumeId } from './classicExperimentListActions';
import { offerByArmFromPlanArms, resolveExperimentType } from './offerSelection';
import { variationsFromPlanArms } from './variationsStepHelpers';
import { wizardSnapshotHasMerchantInput } from './classicWizardAutosave';
import { saveWizardDraftEverywhere } from './classicWizardDraftSync';

export function createClassicExperimentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function duplicateDraftName(raw) {
  const base = String(raw || '').trim() || 'Untitled test';
  return /\(\s*copy\s*\)$/i.test(base) ? base : `${base} (copy)`;
}

function clonePlansForDuplicate(plans, experimentId, title) {
  return plans.map(plan => {
    const next = {
      ...plan,
      status: 'draft',
      archived: false,
      metadata: {
        ...(plan.metadata || {}),
        experiment_id: experimentId,
        experiment_title: title,
      },
    };
    delete next.test_id;
    delete next.analytics;
    return next;
  });
}

/** Rebuild a wizard snapshot from inbox plans when no browser draft exists. */
export function buildWizardSnapshotFromExperiment(experiment, experimentId) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans.filter(plan => plan?.id) : [];
  if (!plans.length) return null;

  const first = plans[0];
  const experimentType = resolveExperimentType(experiment) || resolveExperimentType(first);
  const baseName = String(experiment?.title || getPlanExperimentTitle(first) || '').trim();
  if (!baseName || baseName.toLowerCase() === 'untitled test') return null;

  const restoredArms = Array.isArray(first.price_arms) ? first.price_arms : [];
  if (restoredArms.length < 2) return null;

  const hypothesis = String(
    experiment?.hypothesis || first.hypothesis || first.metadata?.hypothesis || ''
  ).trim();
  const selectedIds = [
    ...new Set(
      plans
        .map(plan => String(plan.variant_id || plan.product_id || '').trim())
        .filter(Boolean)
    ),
  ];
  const audienceUi = first.metadata?.audience_ui || {};

  return {
    experiment_id: experimentId,
    step: 0,
    name: baseName,
    hypothesis,
    experimentType,
    variations: variationsFromPlanArms(restoredArms, experimentType),
    selectedIds,
    pickMode: selectedIds.length ? 'manual' : 'all',
    activeArmIndex: 1,
    pricingByArm: {},
    priceOverrides: {},
    offerByArm: offerByArmFromPlanArms(restoredArms),
    scenarioPreset: '',
    audience: {
      ...createDefaultAudienceState(),
      ...audienceUiFromSummaries({}, {}, audienceUi),
    },
    globalAudience: null,
    goalByPlan: {},
    plans: clonePlansForDuplicate(plans, experimentId, baseName),
    autoRound2: false,
  };
}

function resolveDuplicateSource(shopDomain, experiment) {
  const resumeId = getClassicExperimentResumeId(experiment);
  const fromStore =
    readClassicWizardDraft(shopDomain, resumeId) ||
    (experiment?.wizardDraft && typeof experiment.wizardDraft === 'object'
      ? experiment.wizardDraft
      : null);
  if (fromStore && wizardSnapshotHasMerchantInput(fromStore)) {
    return fromStore;
  }
  const experimentId = createClassicExperimentId();
  const fromPlans = buildWizardSnapshotFromExperiment(experiment, experimentId);
  if (fromPlans && wizardSnapshotHasMerchantInput(fromPlans)) {
    return fromPlans;
  }
  return null;
}

/**
 * @returns {Promise<{ ok: true, experimentId: string } | { ok: false, message: string }>}
 */
export async function duplicateClassicExperimentAsDraft(shopDomain, experiment) {
  const source = resolveDuplicateSource(shopDomain, experiment);
  if (!source) {
    return {
      ok: false,
      message:
        'Nothing to duplicate yet. Use Edit test to open the wizard and save your setup first.',
    };
  }

  const experimentId = createClassicExperimentId();
  const snapshot = {
    ...source,
    experiment_id: experimentId,
    name: duplicateDraftName(source.name || experiment?.title),
    step: Number.isInteger(Number(source.step)) ? Number(source.step) : 0,
    plans: Array.isArray(source.plans)
      ? clonePlansForDuplicate(
          source.plans,
          experimentId,
          duplicateDraftName(source.name || experiment?.title)
        )
      : source.plans,
  };

  const saved = await saveWizardDraftEverywhere(shopDomain, snapshot);
  if (saved.skipped) {
    return { ok: false, message: 'Could not duplicate this draft.' };
  }

  return { ok: true, experimentId };
}
