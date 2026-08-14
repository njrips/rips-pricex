import { getPlanExperimentId, getPlanExperimentTitle } from './classicExperimentHelpers';

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
    if (arms.length < 2) {
      missing.add('pricing');
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
    const id = String(plan?.test_id || '').trim();
    if (id) ids.add(id);
  });
  return [...ids];
}

export function resolveClassicExperimentMenuActions(experiment, { checkoutReady = false } = {}) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const archived = Boolean(experiment?.archived) || plans.every(p => p.archived === true);
  const status = String(experiment?.status || '')
    .trim()
    .toLowerCase();
  const launch = getClassicExperimentLaunchReadiness(experiment);
  const testIds = collectExperimentTestIds(plans);

  const draftLike =
    status === 'draft' ||
    status === 'queued' ||
    plans.some(p => {
      const s = String(p.status || '')
        .trim()
        .toLowerCase();
      return s === 'draft' || s === 'queued';
    });
  const running =
    status === 'running' ||
    plans.some(p => {
      const s = String(p.status || '')
        .trim()
        .toLowerCase();
      return s === 'running' || (p.test_id && s !== 'paused' && s !== 'draft' && s !== 'queued');
    });
  const paused =
    status === 'paused' ||
    plans.some(
      p =>
        String(p.status || '')
          .trim()
          .toLowerCase() === 'paused'
    );
  const winnerReady = status === 'winner_ready';
  const completed = status === 'applied' || status === 'completed';

  const actions = [{ id: 'view', label: 'View details' }];

  if (!archived && draftLike && !launch.ready) {
    actions.push({ id: 'continue', label: 'Continue setup' });
  }

  if (!archived && draftLike && launch.ready && checkoutReady) {
    actions.push({ id: 'launch', label: 'Launch experiment' });
  }

  if (!archived && running && testIds.length) {
    actions.push({ id: 'pause', label: 'Pause' });
  }

  if (!archived && paused && testIds.length) {
    actions.push({ id: 'resume', label: 'Resume' });
  }

  if (testIds.length === 1) {
    actions.push({ id: 'open_test', label: 'Open price test' });
  } else if (testIds.length > 1) {
    actions.push({ id: 'open_test', label: 'Open first test' });
  }

  if (!archived && (running || paused || winnerReady || completed)) {
    actions.push({ id: 'archive', label: 'Archive' });
  }

  if (archived) {
    actions.push({ id: 'restore', label: 'Restore' });
    actions.push({ id: 'delete', label: 'Delete', destructive: true });
  } else if (draftLike && !testIds.length) {
    actions.push({ id: 'delete', label: 'Delete draft', destructive: true });
  }

  return actions;
}

export function getClassicExperimentResumeId(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const rep = experiment?.representative || plans[0];
  return getPlanExperimentId(rep) || experiment?.id || rep?.id || '';
}
