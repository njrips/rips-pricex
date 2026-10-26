/**
 * Classic Smart Pricing: group per-SKU inbox plans into experiment rows.
 */

import { ensureRevenueGuardrailRows } from './revenueGuardrail';

/**
 * How many unfinished experiments the browser keeps.
 *
 * A single slot meant starting a second experiment silently destroyed the
 * first, which autosave turned from a rare accident into the normal outcome.
 */
export const CLASSIC_WIZARD_DRAFT_LIMIT = 5;

export function classicWizardDraftKey(domain) {
  return `ripx_sp_classic_wizard_${String(domain || 'default')}`;
}

function draftIdOf(draft) {
  return String(draft?.experiment_id || '').trim();
}

function savedAtOf(draft) {
  const parsed = Date.parse(draft?.saved_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Unfinished experiments in this browser, most recently saved first. */
export function readClassicWizardDrafts(domain) {
  try {
    const raw = localStorage.getItem(classicWizardDraftKey(domain));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Older builds stored one snapshot under this key rather than a list.
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter(draft => draft && typeof draft === 'object' && draftIdOf(draft))
      .sort((a, b) => savedAtOf(b) - savedAtOf(a));
  } catch {
    return [];
  }
}

/** One saved experiment, or the most recent when no id is given. */
export function readClassicWizardDraft(domain, experimentId) {
  const drafts = readClassicWizardDrafts(domain);
  const id = String(experimentId || '').trim();
  if (!id) return drafts[0] || null;
  return drafts.find(draft => draftIdOf(draft) === id) || null;
}

export function writeClassicWizardDraft(domain, snapshot) {
  const payload = {
    ...(snapshot || {}),
    saved_at: new Date().toISOString(),
  };
  const others = readClassicWizardDrafts(domain).filter(
    draft => draftIdOf(draft) !== draftIdOf(payload)
  );
  let queue = [payload, ...others].slice(0, CLASSIC_WIZARD_DRAFT_LIMIT);
  for (;;) {
    try {
      localStorage.setItem(classicWizardDraftKey(domain), JSON.stringify(queue));
      return payload;
    } catch (err) {
      // A 100-product experiment is a few hundred kilobytes. Give up the
      // oldest draft rather than the one the merchant is editing right now.
      if (queue.length <= 1) throw err;
      queue = queue.slice(0, -1);
    }
  }
}

/** Forget one saved experiment, or all of them when no id is given. */
export function clearClassicWizardDraft(domain, experimentId) {
  const id = String(experimentId || '').trim();
  const remaining = id
    ? readClassicWizardDrafts(domain).filter(draft => draftIdOf(draft) !== id)
    : [];
  try {
    if (!remaining.length) {
      localStorage.removeItem(classicWizardDraftKey(domain));
      return;
    }
    localStorage.setItem(classicWizardDraftKey(domain), JSON.stringify(remaining));
  } catch {
    // Blocked storage must not take down a launch or a delete, both of which
    // clear the draft as their last step.
  }
}

export function getPlanExperimentId(plan) {
  return (
    String(plan?.metadata?.experiment_id || plan?.experiment_id || plan?.batch_id || '').trim() ||
    null
  );
}

export function getPlanExperimentTitle(plan) {
  const metaTitle = String(plan?.metadata?.experiment_title || plan?.experiment_title || '').trim();
  if (metaTitle) return metaTitle;
  const raw = String(plan?.title || '').trim();
  const sep = raw.indexOf(' · ');
  if (sep > 0) return raw.slice(0, sep).trim() || 'Untitled test';
  return raw || 'Untitled test';
}

/**
 * Shopify names the only variant of a product with no options "Default
 * Title". Older launches appended it to the product name; it says nothing.
 */
export function isDefaultVariantTitle(title) {
  return /^default\s*title$/i.test(String(title || '').trim());
}

export function stripDefaultVariantTitle(title) {
  return String(title || '')
    .trim()
    .replace(/\s+[—–-]\s+default\s*title$/i, '')
    .trim();
}

export function getPlanProductTitle(plan) {
  return (
    stripDefaultVariantTitle(plan?.product_title || plan?.metadata?.product_title) ||
    (() => {
      const raw = String(plan?.title || '').trim();
      const sep = raw.indexOf(' · ');
      return stripDefaultVariantTitle(sep > 0 ? raw.slice(sep + 3) : raw);
    })() ||
    'Product'
  );
}

export function normalizePlanStatus(plan = {}) {
  if (plan?.archived) return 'archived';
  const status = String(plan?.status || '')
    .trim()
    .toLowerCase();
  if (status === 'running' || status === 'active') return 'running';
  if (status === 'paused' || status === 'stopped') return 'paused';
  if (status === 'winner_ready') return 'winner_ready';
  if (status === 'applied') return 'applied';
  if (status === 'completed' || status === 'complete' || status === 'ended') {
    return 'completed';
  }
  if (status === 'queued' || status === 'draft') return status || 'draft';
  return status || 'draft';
}

function isLaunchedRound(plan) {
  const status = normalizePlanStatus(plan);
  return Boolean(plan?.test_id) && status !== 'queued' && status !== 'draft';
}

/**
 * Ids of plans that a later round of the same product has replaced. A re-run
 * is queued from a stopped round, so the stopped round is finished with even
 * before the new one launches.
 */
export function supersededRoundPlanIds(plans = []) {
  const rows = Array.isArray(plans) ? plans : [];
  const ids = new Set(rows.map(plan => String(plan?.id || '')).filter(Boolean));
  const superseded = new Set();
  rows.forEach(plan => {
    const parentId = String(plan?.parent_plan_id || '');
    if (plan?.archived || !parentId || !ids.has(parentId)) return;
    superseded.add(parentId);
  });
  return superseded;
}

/**
 * One plan per product: the round that is live or last ran. A queued re-run
 * stays behind its parent until it launches, and is reached from the parent's
 * product panel; once launched it takes the parent's place.
 */
export function currentRoundPlans(plans = []) {
  const rows = Array.isArray(plans) ? plans : [];
  const ids = new Set(rows.map(plan => String(plan?.id || '')).filter(Boolean));
  const hidden = new Set();
  rows.forEach(plan => {
    const parentId = String(plan?.parent_plan_id || '');
    if (plan?.archived || !parentId || !ids.has(parentId)) return;
    hidden.add(isLaunchedRound(plan) ? parentId : String(plan.id));
  });
  return hidden.size ? rows.filter(plan => !hidden.has(String(plan?.id || ''))) : rows;
}

function statusRank(plan) {
  const status = normalizePlanStatus(plan);
  if (status === 'archived') return 0;
  if (status === 'running') return 50;
  if (status === 'winner_ready') return 40;
  if (status === 'applied') return 37;
  if (status === 'completed') return 35;
  if (status === 'paused') return 30;
  if (status === 'queued' || status === 'draft') return 20;
  return 10;
}

export function rollupExperimentStatus(plans = []) {
  const rows = Array.isArray(plans) ? plans : [];
  if (!rows.length) return 'draft';
  if (rows.every(p => p.archived || normalizePlanStatus(p) === 'archived')) return 'archived';
  const statuses = rows.map(normalizePlanStatus);
  if (statuses.some(status => status === 'running')) return 'running';
  if (statuses.some(status => status === 'paused')) return 'paused';
  if (statuses.some(status => status === 'winner_ready')) return 'winner_ready';
  if (statuses.some(status => status === 'applied')) return 'applied';
  if (statuses.some(status => status === 'completed')) return 'completed';
  if (statuses.some(status => status === 'queued' || status === 'draft')) return 'draft';
  return statuses[0] || 'draft';
}

/**
 * Tests with a clear winner: at least one product whose variation beat control
 * past the sample floor, ready to apply or already applied. A test still
 * running its slower products counts once one has won. "Completed" alone does
 * not: it also covers a control win, which kept the price rather than finding
 * a better one.
 */
export function countWinningExperiments(plans = []) {
  const live = (Array.isArray(plans) ? plans : []).filter(plan => plan && !plan.archived);
  return groupPlansIntoExperiments(live).filter(experiment =>
    (experiment.plans || []).some(plan => {
      const status = normalizePlanStatus(plan);
      return status === 'winner_ready' || status === 'applied';
    })
  ).length;
}

/** Short type label for experiment list sublines (Figma: "AB · Owner"). */
export function formatExperimentTypeLabel(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const map = {
    ab: 'AB',
    a_b: 'AB',
    ab_test: 'AB',
    multivariate: 'MULTIVARIATE',
    split_url: 'SPLIT URL',
    feature_flag: 'FEATURE FLAG',
    price_test: 'Price test',
    offer_test: 'Offer test',
    offer: 'Offer test',
    price: 'Price test',
  };
  if (map[key]) return map[key];
  if (!key) return 'Price test';
  return key.replace(/_/g, ' ').toUpperCase();
}

/**
 * The experiment a follow-up round belongs to when it carries no id itself.
 *
 * A round inherits its parent's experiment id when it is queued, so one queued
 * before the parent had an id never got one. Grouped by title instead, it
 * showed as a separate draft test under the parent's name.
 */
function inheritedExperimentId(plan, plansById) {
  const seen = new Set();
  let parentId = String(plan?.parent_plan_id || '').trim();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = plansById.get(parentId);
    if (!parent) return null;
    const id = getPlanExperimentId(parent);
    if (id) return id;
    parentId = String(parent.parent_plan_id || '').trim();
  }
  return null;
}

export function groupPlansIntoExperiments(plans = []) {
  const buckets = new Map();
  const rows = Array.isArray(plans) ? plans : [];
  const plansById = new Map(rows.filter(plan => plan?.id).map(plan => [String(plan.id), plan]));

  rows.forEach(plan => {
    if (!plan?.id) return;
    let experimentId = getPlanExperimentId(plan) || inheritedExperimentId(plan, plansById);
    let title = getPlanExperimentTitle(plan);

    if (!experimentId) {
      const raw = String(plan.title || '').trim();
      const sep = raw.indexOf(' · ');
      if (sep > 0) {
        title = raw.slice(0, sep).trim() || title;
        experimentId = `title:${title.toLowerCase()}`;
      } else {
        experimentId = `plan:${plan.id}`;
        title = raw || title;
      }
    }

    if (!buckets.has(experimentId)) {
      buckets.set(experimentId, {
        id: experimentId,
        title,
        plans: [],
      });
    }
    buckets.get(experimentId).plans.push(plan);
  });

  return Array.from(buckets.values())
    .map(group => {
      const sortedPlans = [...group.plans].sort((a, b) => statusRank(b) - statusRank(a));
      const representative = sortedPlans[0];
      const visitors = sortedPlans.reduce(
        (sum, p) => sum + (Number(p.analytics?.visitors ?? p.visitors) || 0),
        0
      );
      const liftValues = sortedPlans
        .map(p => p.analytics?.lift_pct ?? p.lift_pct)
        .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)))
        .map(Number);
      const confidenceValues = sortedPlans
        .map(p => p.analytics?.confidence_pct ?? p.confidence_pct)
        .filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)))
        .map(Number);
      const lift =
        liftValues.length > 0 ? liftValues.reduce((a, b) => a + b, 0) / liftValues.length : null;
      const confidence = confidenceValues.length > 0 ? Math.max(...confidenceValues) : null;
      const status = rollupExperimentStatus(sortedPlans);
      const primaryMetric =
        representative?.goal?.primary_metric ||
        representative?.objective ||
        representative?.metadata?.audience_ui?.primaryMetric ||
        // Matches the actual default an unspecified goal launches with. This
        // read "Profit per visitor", so the list named a metric no such
        // experiment was ever judged on.
        'Revenue per visitor';

      const typeRaw =
        representative?.experiment_type ||
        representative?.metadata?.experiment_type ||
        representative?.test_type ||
        'price_test';
      const typeLabel = formatExperimentTypeLabel(typeRaw);

      return {
        id: group.id,
        title: group.title || getPlanExperimentTitle(representative),
        plans: sortedPlans,
        productCount: currentRoundPlans(sortedPlans).length,
        status,
        primaryMetric,
        visitors: visitors || null,
        lift,
        confidence,
        representative,
        typeLabel,
        experimentType: typeRaw,
        owner:
          representative?.owner_name ||
          representative?.created_by_name ||
          representative?.owner ||
          'You',
        hypothesis: representative?.hypothesis || representative?.metadata?.hypothesis || '',
        archived: sortedPlans.every(p => p.archived),
      };
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.representative?.updated_at || a.representative?.created_at || 0);
      const bTime = Date.parse(b.representative?.updated_at || b.representative?.created_at || 0);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

/**
 * An unfinished wizard draft, in the shape the experiments table renders.
 *
 * A draft has no per-SKU plans until products are chosen, so it cannot be
 * grouped out of the inbox like every other row. It used to be shown in a
 * separate banner above the tabs for that reason, which split "my drafts" into
 * two places and left the Drafts tab claiming a merchant had none.
 *
 * `plans: []` is what marks it out downstream: the row actions offer Continue
 * setup and Delete draft off the back of it, and nothing that needs a plan is
 * offered at all.
 */
export function wizardDraftAsExperimentRow(draft) {
  const experimentId = String(draft?.experiment_id || '').trim();
  if (!experimentId) return null;
  const experimentType = draft?.experimentType || 'price_test';
  const selected = Array.isArray(draft?.selectedIds) ? draft.selectedIds : [];
  return {
    id: experimentId,
    title: String(draft?.name || '').trim() || 'Untitled test',
    plans: [],
    // What the merchant has picked so far, not what has been built. Reported so
    // a draft abandoned mid-catalogue says how far it got.
    productCount: selected.length,
    status: 'draft',
    primaryMetric: draft?.audience?.primaryMetric || 'Revenue per visitor',
    visitors: null,
    lift: null,
    confidence: null,
    representative: null,
    typeLabel: formatExperimentTypeLabel(experimentType),
    experimentType,
    owner: 'You',
    hypothesis: String(draft?.hypothesis || ''),
    archived: false,
    /** Sorts against the plan-derived rows, which order by their last update. */
    updatedAt: draft?.saved_at || null,
    wizardDraft: draft,
  };
}

/** Most recently touched first, across draft rows and plan-derived rows alike. */
export function sortExperimentRowsByRecency(rows = []) {
  const at = row =>
    Date.parse(
      row?.updatedAt || row?.representative?.updated_at || row?.representative?.created_at || 0
    ) || 0;
  return [...rows].sort((a, b) => at(b) - at(a));
}

export function findExperimentByPlanId(plans, planId) {
  const needle = String(planId || '').trim();
  if (!needle) return null;
  const experiments = groupPlansIntoExperiments(plans);
  return (
    experiments.find(exp => exp.plans.some(p => p.id === needle)) ||
    experiments.find(exp => exp.id === needle) ||
    experiments.find(exp => exp.plans.some(p => String(p.test_id || '').trim() === needle)) ||
    null
  );
}

export function findPlanInCatalog(plans, planId) {
  const needle = String(planId || '').trim();
  if (!needle) return null;
  const list = Array.isArray(plans) ? plans : [];
  return (
    list.find(p => p.id === needle) ||
    list.find(p => String(p.test_id || '').trim() === needle) ||
    null
  );
}

export function formatClassicStatusLabel(status, _experimentType) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  if (key === 'winner_ready' || key === 'applied' || key === 'completed' || key === 'complete' || key === 'ended') {
    return 'Finished';
  }
  if (key === 'running') return 'Running';
  if (key === 'paused') return 'Paused';
  if (key === 'archived') return 'Archived';
  return 'Draft';
}

export function stampClassicExperimentMetadata(
  plans,
  { experimentId, experimentTitle, hypothesis, audienceUi, experimentType }
) {
  const id = String(experimentId || '').trim();
  const title = String(experimentTitle || '').trim();
  const type = String(experimentType || '').trim() || null;
  return (Array.isArray(plans) ? plans : []).map(plan => ({
    ...plan,
    title: title
      ? `${title} · ${getPlanProductTitle(plan)}`.replace(/\s·\s$/, '').trim()
      : plan.title,
    hypothesis: hypothesis ?? plan.hypothesis,
    batch_id: plan.batch_id || id || plan.batch_id,
    experiment_id: id || plan.experiment_id,
    experiment_type: type || plan.experiment_type,
    metadata: {
      ...(plan.metadata || {}),
      classic_wizard: true,
      experiment_id: id || plan.metadata?.experiment_id,
      experiment_title: title || plan.metadata?.experiment_title,
      experiment_type: type || plan.metadata?.experiment_type || plan.experiment_type,
      product_title: getPlanProductTitle(plan),
      hypothesis: hypothesis ?? plan.metadata?.hypothesis,
      audience_ui: audienceUi
        ? { ...audienceUi, guardrails: ensureRevenueGuardrailRows(audienceUi.guardrails) }
        : plan.metadata?.audience_ui,
    },
  }));
}

export function upsertExperimentPlansInInbox(existingPlans, nextPlans, experimentId) {
  const id = String(experimentId || '').trim();
  const nextIds = new Set((nextPlans || []).map(p => p.id).filter(Boolean));
  const kept = (existingPlans || []).filter(plan => {
    if (nextIds.has(plan.id)) return false;
    if (!id) return true;
    return getPlanExperimentId(plan) !== id;
  });
  return [...(nextPlans || []), ...kept];
}
