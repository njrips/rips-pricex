import { getPlanExperimentId, getPlanExperimentTitle, rollupExperimentStatus } from './classicExperimentHelpers';
import {
  isActionableOfferConfig,
  isOfferExperimentType,
  resolveExperimentType,
} from './offerSelection';

/**
 * Classic wizard completion checks for list-row Launch action.
 * Launch only when setup, products/pricing, and audience are configured on every plan.
 */
export function getClassicExperimentLaunchReadiness(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  if (!plans.length) {
    return { ready: false, missing: ['products'] };
  }

  const title = String(experiment?.title || getPlanExperimentTitle(plans[0]) || '').trim();
  if (!title || title.toLowerCase() === 'untitled experiment') {
    return { ready: false, missing: ['setup'] };
  }

  const missing = new Set();
  for (const plan of plans) {
    if (!String(plan.product_id || '').trim()) {
      missing.add('products');
    }
    const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
    const offerExperiment = isOfferExperimentType(resolveExperimentType(experiment) || resolveExperimentType(plan));
    if (arms.length < 2) {
      missing.add(offerExperiment ? 'offers' : 'pricing');
    } else if (offerExperiment) {
      const hasOffer = arms.some(
        (arm, index) =>
          index > 0 &&
          arm?.role !== 'control' &&
          arm?.id !== 'control' &&
          isActionableOfferConfig(arm.offer)
      );
      if (!hasOffer) missing.add('offers');
    } else if (!arms.every(arm => Number.isFinite(Number(arm?.price)) && Number(arm.price) > 0)) {
      missing.add('pricing');
    }
    const audienceUi =
      plan.metadata?.audience_ui && typeof plan.metadata.audience_ui === 'object'
        ? plan.metadata.audience_ui
        : null;
    const primary =
      audienceUi?.primaryMetric ||
      audienceUi?.primary_metric ||
      plan.goal?.primary_metric ||
      plan.objective;
    if (!String(primary || '').trim()) {
      missing.add('audience');
    }
  }

  const allDraftLike = plans.every(plan => {
    const status = String(plan.status || 'draft')
      .trim()
      .toLowerCase();
    return status === 'draft' || status === 'queued';
  });
  if (!allDraftLike) {
    return { ready: false, missing: ['live'] };
  }

  return { ready: missing.size === 0, missing: [...missing] };
}

export function collectExperimentTestIds(plans = []) {
  const ids = new Set();
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    const id = String(plan?.test_id || plan?.metadata?.test_id || '').trim();
    if (id) ids.add(id);
  });
  return [...ids];
}

export function isClassicExperimentEnded(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  return (
    key === 'winner_ready' ||
    key === 'applied' ||
    key === 'completed' ||
    key === 'complete' ||
    key === 'ended'
  );
}

export function resolveClassicExperimentMenuActions(experiment, { checkoutReady = false } = {}) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const archived =
    Boolean(experiment?.archived) ||
    (plans.length > 0 && plans.every(p => p.archived === true)) ||
    rollupExperimentStatus(plans) === 'archived';
  const status = String(rollupExperimentStatus(plans) || experiment?.status || '')
    .trim()
    .toLowerCase();
  const launch = getClassicExperimentLaunchReadiness(experiment);
  const testIds = collectExperimentTestIds(plans);

  const isDraft = !archived && (status === 'draft' || status === 'queued');
  const isRunning = !archived && status === 'running';
  const isPaused = !archived && (status === 'paused' || status === 'stopped');
  const isEnded = !archived && isClassicExperimentEnded(status);

  const actions = [{ id: 'view', label: 'View details' }];

  if (isDraft && !launch.ready) {
    actions.push({ id: 'continue', label: 'Continue setup' });
  }

  if (isDraft && launch.ready && checkoutReady) {
    actions.push({ id: 'launch', label: 'Launch experiment' });
  }

  if (isRunning && testIds.length) {
    actions.push({ id: 'pause', label: 'Pause' });
  } else if (isPaused && testIds.length) {
    actions.push({ id: 'resume', label: 'Resume' });
  }

  if (isPaused || isEnded) {
    actions.push({ id: 'archive', label: 'Archive' });
  }

  if (archived) {
    actions.push({ id: 'restore', label: 'Restore' });
    actions.push({ id: 'delete', label: 'Delete', destructive: true });
  } else {
    actions.push({
      id: 'delete',
      label: isDraft && !testIds.length ? 'Delete draft' : 'Delete',
      destructive: true,
    });
  }

  return actions;
}

export function getClassicExperimentResumeId(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const rep = experiment?.representative || plans[0];
  return getPlanExperimentId(rep) || experiment?.id || rep?.id || '';
}

export const CLASSIC_DETAILS_TABS = [
  'Overview',
  'Performance',
  'Variations',
  'Audience',
  'Metrics',
  'Activity',
  'Settings',
];

export function resolveClassicDetailsTab(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return CLASSIC_DETAILS_TABS.find(id => id.toLowerCase() === key) || 'Overview';
}

/** Resume the create wizard. `step` is a CLASSIC_CREATE_STEPS id (e.g. audience). */
export function buildClassicWizardResumePath(resumeId, stepId) {
  const params = new URLSearchParams();
  const id = String(resumeId || '').trim();
  if (id) params.set('resume', id);
  const step = String(stepId || '')
    .trim()
    .toLowerCase();
  if (step) params.set('step', step);
  const query = params.toString();
  return query ? `/app/experiments/new?${query}` : '/app/experiments/new';
}

/**
 * Filter grouped experiment rows by the Classic list tab.
 * Uses rollup status so a multi-product experiment stays one row.
 */
export function filterClassicExperimentsByTab(experiments = [], filter = 'all') {
  const rows = Array.isArray(experiments) ? experiments : [];
  const tab = String(filter || 'all')
    .trim()
    .toLowerCase();
  const isArchived = experiment =>
    Boolean(experiment?.archived) || String(experiment?.status || '') === 'archived';

  if (tab === 'archived') {
    return rows.filter(isArchived);
  }

  const live = rows.filter(experiment => !isArchived(experiment));
  if (tab === 'running') return live.filter(experiment => experiment.status === 'running');
  if (tab === 'draft') {
    return live.filter(experiment => experiment.status === 'draft' || experiment.status === 'queued');
  }
  if (tab === 'paused') {
    return live.filter(experiment => experiment.status === 'paused' || experiment.status === 'stopped');
  }
  if (tab === 'completed') {
    return live.filter(experiment => isClassicExperimentEnded(experiment.status));
  }
  return live;
}

/** Which list tab should be selected after a row action so the experiment stays visible. */
export function listTabAfterClassicAction(action, experiment, currentTab = 'all') {
  const key = String(action || '')
    .trim()
    .toLowerCase();
  if (key === 'pause') return 'paused';
  if (key === 'resume' || key === 'launch') return 'running';
  if (key === 'archive') return 'archived';
  if (key === 'restore') {
    const plans = (Array.isArray(experiment?.plans) ? experiment.plans : []).map(plan => ({
      ...plan,
      archived: false,
    }));
    const status = String(rollupExperimentStatus(plans) || experiment?.status || '')
      .trim()
      .toLowerCase();
    if (status === 'running') return 'running';
    if (status === 'paused' || status === 'stopped') return 'paused';
    if (isClassicExperimentEnded(status)) return 'completed';
    if (status === 'draft' || status === 'queued') return 'draft';
    return 'all';
  }
  return currentTab || 'all';
}
