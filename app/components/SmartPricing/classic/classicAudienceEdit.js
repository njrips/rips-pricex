import { resolveCountryLists } from './countrySelection';
import { stampClassicExperimentMetadata } from './classicExperimentHelpers';
import { shopDesignFromGuardrails, stampStatisticalFields } from './sampleSizePolicy';
import { estimateSignificanceDuration } from './estimateSignificanceDuration';
import { isClassicExperimentEnded } from './classicExperimentListActions';
import { ensureRevenueGuardrailRows, revenueGuardrailGoalConfig } from './revenueGuardrail';
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

export const DEFAULT_MIN_SAMPLE_SIZE = 5000;
export const MIN_SAMPLE_SIZE_FLOOR = 1;

export function parseMinSampleSize(raw, fallback = DEFAULT_MIN_SAMPLE_SIZE) {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= MIN_SAMPLE_SIZE_FLOOR) return Math.round(n);
  const fb = Number(fallback);
  if (Number.isFinite(fb) && fb >= MIN_SAMPLE_SIZE_FLOOR) return Math.round(fb);
  return DEFAULT_MIN_SAMPLE_SIZE;
}

export function resolveMinSampleSize(...values) {
  const valid = values
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= MIN_SAMPLE_SIZE_FLOOR)
    .map(Math.round);
  return valid.length ? Math.max(...valid) : DEFAULT_MIN_SAMPLE_SIZE;
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
    minSampleSize: String(DEFAULT_MIN_SAMPLE_SIZE),
    ...normalizeClassicAudienceTargeting({}),
  };
}

export function validateClassicAudienceUi(audienceUi = {}) {
  const traffic = Number(audienceUi.trafficAllocation);
  if (!Number.isFinite(traffic) || traffic < 5 || traffic > 100) {
    return { ok: false, message: 'Traffic allocation must be between 5% and 100%.' };
  }
  // The sample floor is no longer asked for here — it comes from Stat settings
  // and is normalized by parseMinSampleSize on the way to the plan. Rejecting a
  // missing value would block the step with nothing on screen to fix.
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
    minSampleSize: String(
      parseMinSampleSize(summary.minSampleSize || stored.minSampleSize, DEFAULT_MIN_SAMPLE_SIZE)
    ),
  };
}

export function applyAudienceUiToPlans(
  plans,
  audienceUi,
  { experimentId, experimentTitle, hypothesis, experimentType, shopGuardrails } = {}
) {
  const shopRevenueCap = shopGuardrails?.max_revenue_drop_percent;
  const normalizedUi = {
    ...audienceUi,
    segment: normalizeAudienceSegment(audienceUi.segment),
    devices: normalizeAudienceDevicePills(audienceUi.devices),
    sources: normalizeAudienceSourcePills(audienceUi.sources),
    guardrails: ensureRevenueGuardrailRows(audienceUi.guardrails, shopRevenueCap),
  };
  const goal = buildClassicGoalPayload(normalizedUi);
  const countryLists = resolveCountryLists(normalizedUi);
  const sampleSize = parseMinSampleSize(normalizedUi.minSampleSize);
  const stamped = stampClassicExperimentMetadata(plans, {
    experimentId,
    experimentTitle,
    hypothesis,
    audienceUi: normalizedUi,
    experimentType,
  });
  const shopDesign = shopDesignFromGuardrails(shopGuardrails);
  return stamped.map(plan => {
    const stats = stampStatisticalFields(plan, shopGuardrails);
    const variations = (Array.isArray(plan.price_arms) ? plan.price_arms : []).map(
      (arm, index) => ({
        id: arm.id || `arm-${index}`,
        traffic: arm.allocation_percent ?? arm.traffic_percent,
      })
    );
    const durationEstimate = estimateSignificanceDuration({
      plans: [plan],
      variations,
      trafficAllocation: normalizedUi.trafficAllocation,
      minSampleSize: sampleSize,
      minConversionsPerVariation: shopDesign.minConversions,
      mdePercent: stats.mde_percent,
      confidenceLevel: stats.confidence_level,
      power: stats.statistical_power,
    });
    return {
      ...plan,
      statistical_design: {
        ...(plan.statistical_design || {}),
        estimated_duration_days:
          durationEstimate.days ?? plan.statistical_design?.estimated_duration_days ?? null,
        estimate_detail: durationEstimate.detail,
        traffic_allocation: durationEstimate.trafficAllocation,
        duration_feasibility: durationEstimate.durationFeasibility || null,
        practical_duration_range: durationEstimate.practicalDurationRange || null,
        traffic_evidence: durationEstimate.trafficEvidence || null,
        traffic_source: plan.traffic_source || null,
        traffic_confidence: plan.traffic_confidence || null,
        practical_window_min_days: durationEstimate.practicalWindowMinDays || null,
        practical_window_max_days: durationEstimate.practicalWindowMaxDays || null,
        required_daily_visitors_for_practical_window:
          durationEstimate.requiredDailyVisitorsForPracticalWindow || null,
        visitors_per_variant_required:
          durationEstimate.recommendedSampleSize ||
          plan.statistical_design?.visitors_per_variant_required ||
          null,
        mde_percent: stats.mde_percent,
        confidence_level: stats.confidence_level,
        statistical_power: stats.statistical_power,
        analysis_method: stats.analysis_method,
        power_rating: durationEstimate.powerRating || plan.statistical_design?.power_rating,
      },
      goal: {
        ...(plan.goal && typeof plan.goal === 'object' ? plan.goal : {}),
        ...goal,
        guardrails: revenueGuardrailGoalConfig(normalizedUi.guardrails, shopRevenueCap),
        min_sample_size: sampleSize,
        analysis_method: stats.analysis_method,
        mde_percent: stats.mde_percent,
        statistical_power: stats.statistical_power,
        significance_level: stats.significance_level,
        visitors_per_variant_recommended: durationEstimate.recommendedSampleSize || null,
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
        min_sample_size: sampleSize,
        segments: classicAudienceToSegments(normalizedUi, plan.audience?.segments),
      },
      launch_preferences: {
        ...(plan.launch_preferences && typeof plan.launch_preferences === 'object'
          ? plan.launch_preferences
          : {}),
        min_sample_size: sampleSize,
      },
    };
  });
}
