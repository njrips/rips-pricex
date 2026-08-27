import { resolveCountryLists } from './countrySelection';
import { stampClassicExperimentMetadata } from './classicExperimentHelpers';
import { isClassicExperimentEnded } from './classicExperimentListActions';
import { ensureRevenueGuardrailRows } from './revenueGuardrail';
import {
  CLASSIC_DEVICE_OPTIONS,
  CLASSIC_SOURCE_OPTIONS,
  buildClassicGoalPayload,
  classicAudienceToSegments,
  normalizeClassicAudienceTargeting,
  normalizeCustomGoals,
  normalizePrimaryMetric,
  normalizeSecondaryEvents,
} from '../targeting/smartPricingAudienceHelpers';

export function canEditClassicAudienceMetrics(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  if (!key) return true;
  if (key === 'archived') return false;
  return !isClassicExperimentEnded(key);
}

const DEVICE_PILL_BY_KEY = new Map(
  CLASSIC_DEVICE_OPTIONS.map(label => [label.toLowerCase(), label])
);
const SOURCE_PILL_BY_KEY = new Map([
  ...CLASSIC_SOURCE_OPTIONS.map(label => [label.toLowerCase(), label]),
  ['organic_search', 'Search'],
  ['paid_search', 'Search'],
  ['paid', 'Paid ads'],
]);

export function normalizeAudienceSegment(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (key === 'new' || key === 'new_visitors') return 'new_visitors';
  if (key === 'returning' || key === 'returning_visitors') return 'returning';
  return 'all_visitors';
}

function mapPills(list, lookup, fallback) {
  if (!Array.isArray(list) || !list.length) return [...fallback];
  const next = [];
  const seen = new Set();
  for (const item of list) {
    const mapped = lookup.get(
      String(item || '')
        .trim()
        .toLowerCase()
    );
    if (!mapped || seen.has(mapped)) continue;
    seen.add(mapped);
    next.push(mapped);
  }
  return next.length ? next : [...fallback];
}

export function normalizeAudienceDevicePills(list) {
  return mapPills(list, DEVICE_PILL_BY_KEY, CLASSIC_DEVICE_OPTIONS);
}

export function normalizeAudienceSourcePills(list) {
  return mapPills(list, SOURCE_PILL_BY_KEY, CLASSIC_SOURCE_OPTIONS);
}

function baseAudienceUi() {
  return {
    segment: 'all_visitors',
    trafficAllocation: 50,
    primaryMetric: 'revenue_per_visitor',
    primaryCustomGoal: null,
    secondaryMetrics: [],
    customGoals: [],
    guardrails: ensureRevenueGuardrailRows([]),
    minSampleSize: '5000',
    ...normalizeClassicAudienceTargeting({}),
  };
}

export function validateClassicAudienceUi(audienceUi = {}) {
  const traffic = Number(audienceUi.trafficAllocation);
  if (!Number.isFinite(traffic) || traffic < 5 || traffic > 100) {
    return { ok: false, message: 'Traffic allocation must be between 5% and 100%.' };
  }
  const sample = Number(audienceUi.minSampleSize);
  if (!Number.isFinite(sample) || sample < 1) {
    return { ok: false, message: 'Enter a minimum sample size of at least 1 visitor per variation.' };
  }
  const primary = String(
    audienceUi.primaryCustomGoal?.event_name || audienceUi.primaryMetric || ''
  ).trim();
  if (!primary) {
    return { ok: false, message: 'Choose a primary success metric.' };
  }
  return { ok: true };
}

export function mergeInboxPlansById(current = [], updates = []) {
  const byId = new Map(
    (Array.isArray(updates) ? updates : [])
      .filter(row => row?.id)
      .map(row => [String(row.id), row])
  );
  const next = [];
  const seen = new Set();
  for (const row of Array.isArray(current) ? current : []) {
    const id = String(row?.id || '');
    if (id && byId.has(id)) {
      next.push(byId.get(id));
      seen.add(id);
      continue;
    }
    if (row) next.push(row);
    if (id) seen.add(id);
  }
  byId.forEach((plan, id) => {
    if (!seen.has(id)) next.push(plan);
  });
  return next;
}

export function audienceUiFromSummaries(summary = {}, metrics = {}, ui = {}) {
  const stored = ui && typeof ui === 'object' ? ui : {};
  const targeting = normalizeClassicAudienceTargeting({
    ...stored,
    devices: Array.isArray(summary.devices) && summary.devices.length ? summary.devices : stored.devices,
    sources: Array.isArray(summary.sources) && summary.sources.length ? summary.sources : stored.sources,
    deviceMode: summary.deviceMode,
    sourceMode: summary.sourceMode,
    countryMode: summary.countryMode,
    includeCountries: summary.includeCountries,
    excludeCountries: summary.excludeCountries,
    countries: summary.countries,
  });
  const countryLists = resolveCountryLists({ ...stored, ...summary, ...targeting });
  const rawPrimary = stored.primaryMetric || metrics.primaryMetric;
  const catalogPrimary = normalizePrimaryMetric(rawPrimary, 'revenue_per_visitor');
  const storedPrimaryCustom = stored.primaryCustomGoal
    ? normalizeCustomGoals([stored.primaryCustomGoal])[0] || null
    : null;
  const metricCustoms = normalizeCustomGoals(stored.customGoals || metrics.secondary);
  const rawPrimaryKey = String(rawPrimary || '')
    .trim()
    .toLowerCase();
  const primaryCustomGoal =
    storedPrimaryCustom ||
    metricCustoms.find(
      goal =>
        String(goal.event_name || '')
          .trim()
          .toLowerCase() === rawPrimaryKey
    ) ||
    null;
  const primaryMetric = primaryCustomGoal?.event_name || catalogPrimary;
  const primaryKey = String(primaryMetric || '')
    .trim()
    .toLowerCase();

  return {
    ...baseAudienceUi(),
    ...stored,
    ...targeting,
    segment: normalizeAudienceSegment(stored.segment || summary.customer || summary.segment),
    trafficAllocation: Number(summary.trafficAllocation ?? stored.trafficAllocation ?? 50) || 50,
    devices: normalizeAudienceDevicePills(targeting.devices),
    sources: normalizeAudienceSourcePills(targeting.sources),
    includeCountries: countryLists.includeCountries,
    excludeCountries: countryLists.excludeCountries,
    countryMode: countryLists.countryMode,
    primaryMetric,
    primaryCustomGoal,
    secondaryMetrics: normalizeSecondaryEvents(
      stored.secondaryMetrics || metrics.secondaryEvents
    ).filter(key => key !== primaryKey),
    customGoals: metricCustoms.filter(
      goal =>
        String(goal.event_name || '')
          .trim()
          .toLowerCase() !== primaryKey
    ),
    guardrails: ensureRevenueGuardrailRows(stored.guardrails || metrics.guardrails),
    minSampleSize: String(summary.minSampleSize || stored.minSampleSize || '5000'),
  };
}

export function applyAudienceUiToPlans(
  plans,
  audienceUi,
  { experimentId, experimentTitle, hypothesis, experimentType } = {}
) {
  const normalizedUi = {
    ...audienceUi,
    segment: normalizeAudienceSegment(audienceUi.segment),
    devices: normalizeAudienceDevicePills(audienceUi.devices),
    sources: normalizeAudienceSourcePills(audienceUi.sources),
  };
  const goal = buildClassicGoalPayload(normalizedUi);
  const countryLists = resolveCountryLists(normalizedUi);
  const minSampleSize = Number(normalizedUi.minSampleSize);
  const sampleSize = Number.isFinite(minSampleSize) && minSampleSize > 0 ? minSampleSize : null;
  const stamped = stampClassicExperimentMetadata(plans, {
    experimentId,
    experimentTitle,
    hypothesis,
    audienceUi: normalizedUi,
    experimentType,
  });
  return stamped.map(plan => ({
    ...plan,
    goal: {
      ...(plan.goal && typeof plan.goal === 'object' ? plan.goal : {}),
      ...goal,
      guardrails: ensureRevenueGuardrailRows(normalizedUi.guardrails),
      ...(sampleSize ? { min_sample_size: sampleSize } : {}),
    },
    audience: {
      inherit_from_shop_defaults: false,
      ...(plan.audience && typeof plan.audience === 'object' ? plan.audience : {}),
      traffic_allocation: Number(normalizedUi.trafficAllocation) || 50,
      devices: normalizedUi.devices,
      sources: normalizedUi.sources,
      include_countries: countryLists.includeCountries,
      exclude_countries: countryLists.excludeCountries,
      country_mode: countryLists.countryMode,
      device_mode: normalizedUi.deviceMode || 'include',
      source_mode: normalizedUi.sourceMode || 'include',
      ...(sampleSize ? { min_sample_size: sampleSize } : {}),
      segments: classicAudienceToSegments(normalizedUi, plan.audience?.segments),
    },
  }));
}
