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

/**
 * A product whose price has already been decided and written to Shopify.
 *
 * An experiment covers several products and they finish at different times.
 * Once a winner is applied to one of them, the merchant has committed to that
 * price: re-splitting its traffic would undo the decision, and relabelling it
 * paused or completed erases the record that the price was ever published.
 * The per-product flow refuses to resume one of these; the experiment-level
 * actions have to leave them alone for the same reason.
 */
export function isSettledClassicPlan(plan) {
  const status = String(plan?.status || '')
    .trim()
    .toLowerCase();
  if (status === 'applied') return true;
  const mode = String(plan?.personalization_mode || plan?.metadata?.personalization_mode || '')
    .trim()
    .toLowerCase();
  return mode === 'personalized' || mode === 'rollout';
}

/**
 * The tests an experiment-level action should act on.
 *
 * @param {object[]} plans
 * @param {{ skipSettled?: boolean }} [options] omit products whose price is
 *   already decided and published.
 */
export function collectExperimentTestIds(plans = [], { skipSettled = false } = {}) {
  const ids = new Set();
  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (skipSettled && isSettledClassicPlan(plan)) return;
    const id = String(plan?.test_id || plan?.metadata?.test_id || '').trim();
    if (id) ids.add(id);
  });
  return [...ids];
}

/**
 * Which of a batch of per-product requests actually succeeded.
 *
 * An experiment is one test per product, so Pause and Stop fire several
 * requests. Run under `Promise.all` one refusal rejected the whole batch: the
 * error was shown, the local plans were never updated, and products that had
 * genuinely stopped still read as Running -- so the merchant saw a failure
 * message over a row that was now half stopped, with no way to tell which
 * half. `allSettled` preserves order, which is what lets the outcome be
 * matched back to the product it belongs to.
 *
 * @param {string[]} ids in the order they were requested
 * @param {PromiseSettledResult<unknown>[]} results
 */
export function splitSettledByIds(ids = [], results = []) {
  const succeeded = [];
  const failed = [];
  (Array.isArray(ids) ? ids : []).forEach((id, index) => {
    const row = Array.isArray(results) ? results[index] : null;
    if (row && row.status === 'fulfilled') succeeded.push(id);
    else failed.push({ id, reason: row?.reason });
  });
  return { succeeded, failed };
}

/**
 * What to say when only some of an experiment's products accepted the action.
 *
 * "Experiment paused." over a row where one product is still live is a plain
 * untruth, and the merchant has no way to see which one. Returns '' when
 * nothing succeeded, because then the caller has a real error to show instead.
 *
 * @param {{ verb?: 'paused'|'stopped', done?: number, failed?: number }} outcome
 */
export function classicBatchOutcomeMessage({ verb = 'paused', done = 0, failed = 0 } = {}) {
  if (done <= 0) return '';
  const past = verb === 'stopped' ? 'Stopped' : 'Paused';
  if (failed <= 0) return `Experiment ${verb}.`;
  const products = `${done} product${done === 1 ? '' : 's'}`;
  const rest = failed === 1 ? 'one is' : `${failed} are`;
  return `${past} ${products}, but ${rest} still running. Try again for those.`;
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

  // An unfinished wizard draft has no plan behind it, so there is no detail
  // page to open and offering one led to a menu item that did nothing.
  const actions = plans.length ? [{ id: 'view', label: 'View details' }] : [];

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

  // Pause is a breather; Stop is the decision that the experiment is over. A
  // paused experiment gets it too, because otherwise there is no way to finish
  // one without either resuming it first or hiding it with Archive.
  if ((isRunning || isPaused) && testIds.length) {
    actions.push({ id: 'stop', label: 'Stop' });
  }

  if (isPaused || isEnded) {
    actions.push({ id: 'archive', label: 'Archive' });
  }

  if (archived) {
    actions.push({ id: 'restore', label: 'Restore' });
    actions.push({ id: 'delete', label: 'Delete', destructive: true });
  } else if (canDeleteClassicExperimentNow({ status, hasLinkedTests: testIds.length > 0 })) {
    actions.push({
      id: 'delete',
      label: isDraft && !testIds.length ? 'Delete draft' : 'Delete',
      destructive: true,
    });
  }

  return actions;
}

/**
 * Whether Delete belongs in this experiment's menu at all.
 *
 * A running experiment is pricing shoppers right now and collecting the orders
 * that will decide it. Delete used to be offered anyway, and stopped the live
 * tests silently on the way out -- so one click on a destructive menu item
 * both ended a running price test and threw the results away.
 *
 * Pausing first is the same two steps with the stop made explicit, and a
 * paused experiment offers Archive as well, which is usually what someone
 * reaching for Delete actually wanted. A draft has nothing live to stop, so it
 * keeps Delete straight away.
 *
 * Shared with the experiment detail page, which has its own menu. The two
 * drifted apart once already.
 */
/**
 * The plan status a merchant's Stop leaves behind.
 *
 * Deliberately not `stopped`. The engine writes `stopped` on the test for
 * every way a test leaves the traffic -- Pause, Stop, and an automatic
 * guardrail stop all call `stopTest` -- and a plan left `stopped` is one the
 * product flow still offers to resume. Finishing an experiment has to land
 * somewhere that means finished, so it reads as ended: no Resume, and Archive
 * and Delete offered instead.
 */
export const CLASSIC_STOPPED_PLAN_STATUS = 'completed';

export function canDeleteClassicExperimentNow({
  status = '',
  archived = false,
  hasLinkedTests = true,
} = {}) {
  // Withholding Delete only makes sense when there is something to stop first.
  // An experiment marked running with no linked test cannot be paused, stopped
  // or archived, so refusing Delete as well left the merchant a row with no
  // action on it at all.
  if (!hasLinkedTests) return true;
  if (archived) return true;
  return (
    String(status || '')
      .trim()
      .toLowerCase() !== 'running'
  );
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
  // Stopping finishes the experiment, so it leaves the live tabs entirely.
  if (key === 'stop') return 'completed';
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
