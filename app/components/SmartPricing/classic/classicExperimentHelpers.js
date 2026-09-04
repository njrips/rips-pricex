/**
 * Classic Smart Pricing: group per-SKU inbox plans into experiment rows.
 */

import { classicAudienceToSegments } from '../targeting/smartPricingAudienceHelpers';
import { stampStatisticalFields } from './sampleSizePolicy';
import { isOfferExperimentType } from './offerSelection';
import { ensureRevenueGuardrailRows, revenueGuardrailGoalConfig } from './revenueGuardrail';

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
  if (sep > 0) return raw.slice(0, sep).trim() || 'Untitled experiment';
  return raw || 'Untitled experiment';
}

export function getPlanProductTitle(plan) {
  return (
    String(plan?.product_title || plan?.metadata?.product_title || '').trim() ||
    (() => {
      const raw = String(plan?.title || '').trim();
      const sep = raw.indexOf(' · ');
      return sep > 0 ? raw.slice(sep + 3).trim() : raw;
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
    price_test: 'PRICE',
    offer_test: 'OFFER',
    offer: 'OFFER',
    price: 'PRICE',
  };
  if (map[key]) return map[key];
  if (!key) return 'PRICE';
  return key.replace(/_/g, ' ').toUpperCase();
}

export function groupPlansIntoExperiments(plans = []) {
  const buckets = new Map();

  (Array.isArray(plans) ? plans : []).forEach(plan => {
    if (!plan?.id) return;
    let experimentId = getPlanExperimentId(plan);
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
        productCount: sortedPlans.length,
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

/** Map stored Classic audience_ui onto launch payload if plan.audience was never enriched. */
export function enrichInboxPlansForLaunch(plans = [], shopGuardrails = {}) {
  return (Array.isArray(plans) ? plans : []).map(plan => {
    const existingAudience = plan.audience && typeof plan.audience === 'object' ? plan.audience : {};
    const audienceUi =
      plan.metadata?.audience_ui && typeof plan.metadata.audience_ui === 'object'
        ? plan.metadata.audience_ui
        : null;
    const segments = audienceUi
      ? classicAudienceToSegments(audienceUi, existingAudience.segments)
      : existingAudience.segments;
    const experimentType =
      plan.experiment_type ||
      plan.experimentType ||
      plan.metadata?.experiment_type ||
      null;
    const stats = stampStatisticalFields(plan, shopGuardrails);
    const shopRaw =
      shopGuardrails?.guardrails && typeof shopGuardrails.guardrails === 'object'
        ? shopGuardrails.guardrails
        : shopGuardrails;
    const sampleFromUi = Number(audienceUi?.minSampleSize ?? audienceUi?.min_sample_size);
    const sampleFromAudience = Number(existingAudience.min_sample_size);
    const sampleFromShop = Number(shopRaw?.min_sample_size_per_variation);
    const sampleSize = [sampleFromUi, sampleFromAudience, sampleFromShop].find(
      n => Number.isFinite(n) && n >= 1
    );
    const roundedSample = Number.isFinite(sampleSize) ? Math.round(sampleSize) : null;
    return {
      ...plan,
      ...(experimentType ? { experiment_type: experimentType } : {}),
      audience: {
        inherit_from_shop_defaults: false,
        ...existingAudience,
        ...(audienceUi
          ? {
              traffic_allocation:
                audienceUi.trafficAllocation ?? existingAudience.traffic_allocation,
              devices: audienceUi.devices ?? existingAudience.devices,
              sources: audienceUi.sources ?? existingAudience.sources,
              countries: audienceUi.countries ?? existingAudience.countries,
              include_countries:
                audienceUi.includeCountries ??
                audienceUi.include_countries ??
                existingAudience.include_countries,
              exclude_countries:
                audienceUi.excludeCountries ??
                audienceUi.exclude_countries ??
                existingAudience.exclude_countries,
              device_mode: audienceUi.deviceMode || existingAudience.device_mode || 'include',
              source_mode: audienceUi.sourceMode || existingAudience.source_mode || 'include',
              country_mode: audienceUi.countryMode || existingAudience.country_mode || 'include',
              min_sample_size: (() => {
                const n = Number(
                  audienceUi.minSampleSize ??
                    audienceUi.min_sample_size ??
                    existingAudience.min_sample_size
                );
                return Number.isFinite(n) && n >= 1 ? Math.round(n) : existingAudience.min_sample_size;
              })(),
            }
          : {}),
        segments: segments || existingAudience.segments,
      },
      launch_preferences: {
        auto_round2: shopRaw?.auto_round2_default !== false,
        ...(plan.launch_preferences && typeof plan.launch_preferences === 'object'
          ? plan.launch_preferences
          : {}),
        auto_start: true,
        ...(roundedSample ? { min_sample_size: roundedSample } : {}),
      },
      goal: {
        ...(plan.goal && typeof plan.goal === 'object' ? plan.goal : {}),
        analysis_method: stats.analysis_method,
        mde_percent: stats.mde_percent,
        statistical_power: stats.statistical_power,
        significance_level: stats.significance_level,
        guardrails: revenueGuardrailGoalConfig(
          audienceUi?.guardrails,
          Number(shopRaw?.max_revenue_drop_percent)
        ),
        ...(roundedSample ? { min_sample_size: roundedSample } : {}),
      },
      statistical_design: {
        ...(plan.statistical_design && typeof plan.statistical_design === 'object'
          ? plan.statistical_design
          : {}),
        analysis_method: stats.analysis_method,
        mde_percent: stats.mde_percent,
        statistical_power: stats.statistical_power,
        confidence_level: stats.confidence_level,
      },
    };
  });
}

export function formatClassicStatusLabel(status, experimentType) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  if (key === 'winner_ready') {
    return isOfferExperimentType(experimentType) ? 'Result ready' : 'Winner ready';
  }
  if (key === 'applied') {
    return isOfferExperimentType(experimentType) ? 'Completed' : 'Applied';
  }
  if (key === 'completed' || key === 'complete' || key === 'ended') {
    return 'Completed';
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
