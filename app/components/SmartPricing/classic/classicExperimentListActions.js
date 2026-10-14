import { preserveEmbeddedSearch } from '../../../utils/shopifyEmbeddedSearch';
import { canEditClassicTestSetup } from './classicAudienceEdit';
import { classicCreateStepId } from './classicCreateSteps';
import { getPlanExperimentId, rollupExperimentStatus } from './classicExperimentHelpers';

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
  if (failed <= 0) return `Test ${verb}.`;
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

/**
 * Whether the experiment has never launched: an unfinished wizard draft, or
 * plans saved (or queued as a follow-up round) that no test has run yet.
 * Drafts open in the setup wizard; only launched tests have a details page.
 */
export function isClassicDraftExperiment(experiment) {
  if (experiment?.wizardDraft) return true;
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  if (!plans.length) return false;
  if (experiment?.archived || plans.every(plan => plan?.archived === true)) return false;
  const status = String(rollupExperimentStatus(plans) || '')
    .trim()
    .toLowerCase();
  return status === 'draft' || status === 'queued';
}

export function resolveClassicExperimentMenuActions(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const archived =
    Boolean(experiment?.archived) ||
    (plans.length > 0 && plans.every(p => p.archived === true)) ||
    rollupExperimentStatus(plans) === 'archived';
  const status = String(rollupExperimentStatus(plans) || experiment?.status || '')
    .trim()
    .toLowerCase();
  const testIds = collectExperimentTestIds(plans);

  const isDraft = !archived && (status === 'draft' || status === 'queued');
  const isRunning = !archived && status === 'running';
  const isPaused = !archived && (status === 'paused' || status === 'stopped');
  const isEnded = !archived && isClassicExperimentEnded(status);

  // A draft has never run, so it has no results to view; it opens in the setup
  // wizard, and that is where it is launched from, on the Review step.
  const actions = plans.length && !isDraft ? [{ id: 'view', label: 'View results' }] : [];

  if (isDraft) {
    actions.push({ id: 'edit', label: 'Edit test' });
    actions.push({ id: 'duplicate', label: 'Duplicate' });
  } else if ((isRunning || isPaused) && canEditClassicTestSetup(experiment)) {
    actions.push({ id: 'edit', label: 'Edit test' });
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

  if (!isDraft && plans.length) {
    actions.push({ id: 'duplicate', label: 'Duplicate' });
  }

  if (archived) {
    actions.push({ id: 'restore', label: 'Restore' });
    actions.push({ id: 'delete', label: 'Delete', destructive: true });
  } else if (
    canDeleteClassicExperimentNow({ status, archived, hasLinkedTests: testIds.length > 0 })
  ) {
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
 * Now the path is Stop, then Archive, then Delete. A draft has nothing live to
 * stop and no results, so it keeps Delete straight away.
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
  // Deleting erases results for good, so an experiment that collected any is
  // archived first: Archive is reversible and keeps everything, and Delete is
  // then the deliberate second step. The server enforces the same rule.
  //
  // An experiment marked running with no linked test cannot be paused, stopped
  // or archived, so refusing Delete as well left the merchant a row with no
  // action on it at all. A draft never ran and has no results to lose.
  if (!hasLinkedTests) return true;
  if (archived) return true;
  const key = String(status || '')
    .trim()
    .toLowerCase();
  return key === 'draft' || key === 'queued';
}

export function getClassicExperimentResumeId(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const rep = experiment?.representative || plans[0];
  const groupId = String(experiment?.id || '');
  // `title:` and `plan:` ids are made up by the list to group plans that name
  // no experiment; nothing else knows them, so the wizard is given the plan.
  const synthetic = /^(title|plan):/.test(groupId);
  return getPlanExperimentId(rep) || (synthetic ? '' : groupId) || rep?.id || '';
}

export const CLASSIC_DETAILS_TABS = ['Overview', 'History', 'Settings'];

/** Deep links from the old seven-tab layout (Global naming doc). */
const CLASSIC_DETAILS_TAB_ALIASES = {
  performance: 'Overview',
  variations: 'Overview',
  audience: 'Settings',
  metrics: 'Settings',
  activity: 'History',
};

export function resolveClassicDetailsTab(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (CLASSIC_DETAILS_TAB_ALIASES[key]) return CLASSIC_DETAILS_TAB_ALIASES[key];
  return CLASSIC_DETAILS_TABS.find(id => id.toLowerCase() === key) || 'Overview';
}

/** Sections of the details-page settings editor a link can open it on. */
export const CLASSIC_EDIT_FOCUSES = ['audience', 'metrics', 'guardrail', 'traffic'];

export function resolveClassicEditFocus(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return CLASSIC_EDIT_FOCUSES.includes(key) ? key : '';
}

/**
 * Edit a launched experiment. Its products, prices and arms are fixed once it
 * has shoppers, so editing is the settings editor on its details page -- not
 * the create wizard, which can only build a new experiment.
 */
export function buildClassicExperimentEditPath(planId, focus = 'audience') {
  const params = new URLSearchParams({ tab: 'settings', edit: resolveClassicEditFocus(focus) || 'audience' });
  return preserveEmbeddedSearch(`/app/experiments/${encodeURIComponent(String(planId || '').trim())}?${params}`);
}

/**
 * Edit test on a running or paused experiment: back into the wizard, with the
 * variations, products and prices shoppers are already assigned to locked.
 */
export function buildClassicLiveEditPath(resumeId) {
  const params = new URLSearchParams({ resume: String(resumeId || '').trim(), live: '1' });
  return preserveEmbeddedSearch(`/app/experiments/new?${params}`);
}

/**
 * Where Edit takes an experiment: drafts continue in the create wizard, and
 * running or paused ones go back into it with their arms locked. Anything else
 * that launched opens its settings on the details page.
 *
 * A draft carries its step: the wizard opens at step 1 without it, walking the
 * merchant back through everything they had already answered.
 */
export function buildClassicExperimentEditTarget(experiment) {
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const status = String(rollupExperimentStatus(plans) || experiment?.status || '')
    .trim()
    .toLowerCase();
  // Running or paused is only ever reached by launching, so it is enough on
  // its own: a copy whose test link was lost still opens its editor, not a
  // blank wizard.
  const launched =
    status === 'running' ||
    status === 'paused' ||
    (status !== 'draft' && status !== 'queued' && collectExperimentTestIds(plans).length > 0);
  const planId = experiment?.representative?.id || plans[0]?.id || '';
  const resumeId = getClassicExperimentResumeId(experiment);
  if (
    (status === 'running' || status === 'paused') &&
    resumeId &&
    collectExperimentTestIds(plans).length > 0
  ) {
    return buildClassicLiveEditPath(resumeId);
  }
  if (launched && planId) return buildClassicExperimentEditPath(planId);
  return buildClassicWizardResumePath(
    getClassicExperimentResumeId(experiment),
    classicCreateStepId(experiment?.wizardDraft?.step) || undefined
  );
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
  return preserveEmbeddedSearch(query ? `/app/experiments/new?${query}` : '/app/experiments/new');
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

  // Archived rows show only in the Archived tab, so Archive visibly moves a finished test.
  if (tab === 'archived') return rows.filter(isArchived);

  const live = rows.filter(experiment => !isArchived(experiment));
  if (tab === 'finished' || tab === 'completed') {
    return live.filter(experiment => isClassicExperimentEnded(experiment.status));
  }
  if (tab === 'running') return live.filter(experiment => experiment.status === 'running');
  if (tab === 'draft') {
    return live.filter(experiment => experiment.status === 'draft' || experiment.status === 'queued');
  }
  if (tab === 'paused') {
    return live.filter(experiment => experiment.status === 'paused' || experiment.status === 'stopped');
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
  // Stopping finishes the test, so it leaves the live tabs entirely.
  if (key === 'stop') return 'finished';
  if (key === 'duplicate') return 'draft';
  if (key === 'restore') {
    const plans = (Array.isArray(experiment?.plans) ? experiment.plans : []).map(plan => ({
      ...plan,
      archived: false,
    }));
    return listTabOfClassicStatus(rollupExperimentStatus(plans) || experiment?.status);
  }
  return currentTab || 'all';
}

const LIST_TAB_LABELS = Object.freeze({
  running: 'Running',
  paused: 'Paused',
  finished: 'Finished',
  draft: 'Drafts',
  archived: 'Archived',
});

/** The list tab an experiment with this rollup status appears under. */
export function listTabOfClassicStatus(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  if (key === 'archived') return 'archived';
  if (key === 'running') return 'running';
  if (key === 'paused' || key === 'stopped') return 'paused';
  if (isClassicExperimentEnded(key)) return 'finished';
  if (key === 'draft' || key === 'queued') return 'draft';
  return 'all';
}

/** History detail for an archive, naming the tab the test left. */
export function archiveActivityDetail(experiment, { stoppedCount = 0 } = {}) {
  const stopped = Math.max(0, Number(stoppedCount) || 0);
  if (stopped > 0) {
    return `Moved from Paused to the Archived tab. ${stopped} paused product${stopped === 1 ? ' was' : 's were'} released so other tests can use ${stopped === 1 ? 'it' : 'them'}; Restore brings the test back as Paused.`;
  }
  const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
  const from =
    LIST_TAB_LABELS[listTabOfClassicStatus(rollupExperimentStatus(plans) || experiment?.status)];
  return from && from !== 'Archived'
    ? `Moved from ${from} to the Archived tab.`
    : 'Moved to the Archived tab.';
}

/** History detail for a restore, naming the tab the test returns to. */
export function restoreActivityDetail(experiment) {
  const to = LIST_TAB_LABELS[listTabAfterClassicAction('restore', experiment)];
  return to ? `Moved from Archived back to ${to}.` : 'Moved out of the Archived tab.';
}
