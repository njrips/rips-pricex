import { formatSplitCountryAudienceLabel, resolveCountryLists } from './countrySelection';
import { parseMinSampleSize } from './classicAudienceEdit';
import { formatVisitorCount } from './estimateSignificanceDuration';
import { formatTrafficPercent } from './variationsStepHelpers';
import { MIN_VISITORS_FOR_REVENUE_GUARDRAIL } from './revenueGuardrail';
import {
  BUILTIN_SECONDARY_METRICS,
  classicSegmentLabel,
  normalizeSecondaryEvents,
  primaryMetricLabel,
  secondaryMetricLabel,
} from '../targeting/smartPricingAudienceHelpers';
import { isOfferExperimentType } from './offerSelection';

const ALL_DEVICES = ['Desktop', 'Mobile', 'Tablet'];
const ALL_SOURCES = ['Direct', 'Search', 'Social', 'Email', 'Paid ads', 'Referral'];

/** Merchant-facing pricing mode labels (Step 5 spec §3.1). */
export function formatReviewPricingModeLabel(mode) {
  if (mode === 'ai') return 'AI suggested prices';
  if (mode === 'bulk') return 'Bulk adjusted prices';
  return 'Manual prices';
}

function pricingModeOverviewText(mode) {
  return formatReviewPricingModeLabel(mode);
}

/** Step 5 Products badge + Test overview line (shared so UI cannot drift). */
export function resolveReviewPricingSummaryText({
  isOfferTest,
  priceMode = 'manual',
  pricingByArm = null,
  variations = [],
}) {
  return resolvePricingOverviewText({
    isOfferTest,
    priceMode,
    pricingByArm,
    variations,
  });
}

function resolvePricingOverviewText({ isOfferTest, priceMode, pricingByArm, variations }) {
  if (isOfferTest) return 'Offers per variation';
  if (pricingByArm && typeof pricingByArm === 'object') {
    const testArms = (variations || []).filter(
      (arm, i) => i > 0 && arm?.id && arm.id !== 'control',
    );
    const modes = testArms.map(arm => {
      const cfg = pricingByArm[arm.id] || {};
      return pricingModeOverviewText(cfg.priceMode || priceMode);
    });
    const unique = [...new Set(modes.filter(Boolean))];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) return 'Mixed pricing per variation';
  }
  return pricingModeOverviewText(priceMode);
}

function formatOverviewTrafficPercent(value) {
  const fixed = formatTrafficPercent(value);
  const n = Number(fixed);
  if (!Number.isFinite(n)) return fixed;
  return Number.isInteger(n) ? String(n) : fixed;
}

function variationOverviewLabel(arm) {
  const letter = String(arm?.letter || '').trim();
  if (letter) return `Var ${letter}`;
  const name = String(arm?.name || '').trim();
  if (/^variation\s+[a-z0-9]+$/i.test(name)) {
    const tail = name.replace(/^variation\s+/i, '').trim();
    return tail ? `Var ${tail.toUpperCase()}` : name;
  }
  return name || 'Variation';
}

function productCountText(selectedCount, plansLength) {
  const count = Number(selectedCount) || Number(plansLength) || 0;
  return `${count} ${count === 1 ? 'product' : 'products'}`;
}

function variationOverviewSummary(variations = []) {
  const parts = (variations || []).map((arm, index) => {
    const isControl = index === 0 || arm?.id === 'control';
    const pct = formatOverviewTrafficPercent(arm?.traffic);
    if (isControl) return `Control ${pct}%`;
    return `${variationOverviewLabel(arm)} ${pct}%`;
  });
  return parts.filter(Boolean).join(' · ');
}

function devicesOverviewText(audience) {
  const mode = audience?.deviceMode === 'exclude' ? 'exclude' : 'include';
  const selected = (Array.isArray(audience?.devices) ? audience.devices : []).filter(Boolean);
  if (!selected.length || selected.length >= ALL_DEVICES.length) return 'All devices';
  if (mode === 'exclude') return `Exclude: ${selected.join(', ')}`;
  if (selected.length === 1) return `${selected[0]} only`;
  return selected.join(' & ');
}

function sourcesOverviewText(audience) {
  const mode = audience?.sourceMode === 'exclude' ? 'exclude' : 'include';
  const selected = (Array.isArray(audience?.sources) ? audience.sources : []).filter(Boolean);
  if (!selected.length || selected.length >= ALL_SOURCES.length) return 'All sources';
  if (mode === 'exclude') return `Exclude: ${selected.join(', ')}`;
  if (selected.length === 1) return `${selected[0]} only`;
  return selected.join(' & ');
}

function countriesOverviewText(audience) {
  const lists = resolveCountryLists(audience);
  return formatSplitCountryAudienceLabel(lists.includeCountries, lists.excludeCountries);
}

/**
 * The guardrail is checked per product and never below its own visitor floor,
 * so a results sample under that floor is not when it starts.
 */
function guardrailOverviewText(audience) {
  const revenueGuardrailRow = (audience?.guardrails || []).find(row => row?.id === 'revenue');
  if (revenueGuardrailRow && revenueGuardrailRow.on === false) {
    return 'Off';
  }
  const thresholdRaw = String(revenueGuardrailRow?.threshold || '-10%').replace(/^-/, '');
  const thresholdPercent = thresholdRaw.replace(/%$/, '') || '10';
  const startsAt = formatVisitorCount(
    Math.max(MIN_VISITORS_FOR_REVENUE_GUARDRAIL, parseMinSampleSize(audience?.minSampleSize))
  );
  return `On · Stop testing a product if revenue per visitor for any variation drops more than ${thresholdPercent}% below the control, after ${startsAt} visitors per variation`;
}

/**
 * Step 5 summary, one section per part of the setup (Google doc Step 5
 * section titles). Rows are label/value pairs; a row with no value is left out.
 * @returns {Array<{ id: string, title: string, rows: Array<{ label: string, value: string }> }>}
 */
export function buildReviewSections({
  name,
  experimentType = 'price_test',
  experimentTypeLabel = 'Price test',
  selectedCount = 0,
  plans = [],
  pickMode = 'manual',
  priceMode = 'manual',
  pricingByArm = null,
  variations = [],
  audience = {},
  significanceEstimate = null,
}) {
  const isOfferTest = isOfferExperimentType(experimentType);
  const typeLabel = experimentTypeLabel || (isOfferTest ? 'Offer test' : 'Price test');
  const pricingText = resolvePricingOverviewText({
    isOfferTest,
    priceMode,
    pricingByArm,
    variations,
  });
  const primaryKey = audience?.primaryCustomGoal ? '' : audience?.primaryMetric;
  // Only the standard metrics: the launch drops anything else Step 4 no
  // longer shows, so the summary must not promise it.
  const secondaryLabels = normalizeSecondaryEvents(audience?.secondaryMetrics)
    .filter(key => BUILTIN_SECONDARY_METRICS.has(key) && key !== primaryKey)
    .map(key => secondaryMetricLabel(key));
  const confidence = significanceEstimate?.confidenceLevel || 90;

  const sections = [
    {
      id: 'basics',
      title: 'Basics',
      rows: [
        { label: 'Test name', value: String(name || '').trim() || 'Untitled test' },
        { label: 'Test type', value: typeLabel },
      ],
    },
    {
      id: 'products',
      title: 'Products & prices',
      rows: [
        { label: 'Products', value: productCountText(selectedCount, plans?.length) },
        { label: 'Selection', value: pickMode === 'all' ? 'All products' : 'Picked products' },
        { label: isOfferTest ? 'Offers' : 'Prices', value: pricingText },
      ],
    },
    {
      id: 'variations',
      title: 'Variations & traffic',
      rows: [
        {
          label: 'Traffic allocation',
          value: `${audience?.trafficAllocation ?? 100}% of eligible visitors`,
        },
        { label: 'Traffic split', value: variationOverviewSummary(variations) },
      ],
    },
    {
      id: 'audience',
      title: 'Audience',
      rows: [
        { label: 'Audience segment', value: classicSegmentLabel(audience?.segment) },
        { label: 'Device type', value: devicesOverviewText(audience) },
        { label: 'Traffic source', value: sourcesOverviewText(audience) },
        { label: 'Countries', value: countriesOverviewText(audience) },
      ],
    },
    {
      id: 'metrics',
      title: 'Metrics & guardrail',
      rows: [
        {
          label: 'Primary success metric',
          value: primaryMetricLabel(audience?.primaryMetric, {
            primaryCustomGoal: audience?.primaryCustomGoal,
          }),
        },
        { label: 'Secondary metrics', value: secondaryLabels.join(', ') },
        { label: 'Confidence level', value: `${confidence}%` },
        {
          label: 'Minimum visitors per variation',
          value: formatVisitorCount(parseMinSampleSize(audience?.minSampleSize)),
        },
        { label: 'Revenue guardrail', value: guardrailOverviewText(audience) },
      ],
    },
  ];
  return sections.map(section => ({
    ...section,
    rows: section.rows.filter(row => String(row.value || '').trim()),
  }));
}
