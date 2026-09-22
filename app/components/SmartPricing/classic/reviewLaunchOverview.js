import { formatSplitCountryAudienceLabel, resolveCountryLists } from './countrySelection';
import { parseMinSampleSize } from './classicAudienceEdit';
import { formatVisitorCount } from './estimateSignificanceDuration';
import { formatTrafficPercent } from './variationsStepHelpers';
import {
  classicSegmentLabel,
  primaryMetricLabel,
} from '../targeting/smartPricingAudienceHelpers';
import { isOfferExperimentType } from './offerSelection';

const ALL_DEVICES = ['Desktop', 'Mobile', 'Tablet'];
const ALL_SOURCES = ['Direct', 'Search', 'Social', 'Email', 'Paid ads', 'Referral'];

/** @type {Array<'test' | 'traffic' | 'audience' | 'results' | 'safety'>} */
export const REVIEW_OVERVIEW_LINE_ORDER = [
  'test',
  'traffic',
  'audience',
  'results',
  'safety',
];

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

function productsOverviewText(selectedCount, plansLength, pickMode) {
  const count = Number(selectedCount) || Number(plansLength) || 0;
  const scope = pickMode === 'all' ? 'All products' : 'Picked products';
  return `${count} products · ${scope}`;
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

function guardrailOverviewText(audience) {
  const revenueGuardrailRow = (audience?.guardrails || []).find(row => row?.id === 'revenue');
  const minVisitors = formatVisitorCount(parseMinSampleSize(audience?.minSampleSize));
  if (revenueGuardrailRow && revenueGuardrailRow.on === false) {
    return 'Guardrail OFF';
  }
  const thresholdRaw = String(revenueGuardrailRow?.threshold || '-10%').replace(/^-/, '');
  const thresholdPercent = thresholdRaw.replace(/%$/, '') || '10';
  return `Guardrail ON · Pause if Rev/visitor drops >${thresholdPercent}% vs control, after ${minVisitors} visitors/variation`;
}

/**
 * Five-line review overview (Google doc Step 5, page 32+).
 * @returns {{ test: string, traffic: string, audience: string, results: string, safety: string }}
 */
export function buildReviewOverviewLines({
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
  const productsText = productsOverviewText(selectedCount, plans?.length, pickMode);
  const pricingText = resolvePricingOverviewText({
    isOfferTest,
    priceMode,
    pricingByArm,
    variations,
  });

  const testTitle = String(name || '').trim() || 'Untitled test';
  const trafficAllocation = audience?.trafficAllocation ?? 100;
  const variationSummary = variationOverviewSummary(variations);
  const primaryLabel = primaryMetricLabel(audience?.primaryMetric, {
    primaryCustomGoal: audience?.primaryCustomGoal,
  });
  const confidence = significanceEstimate?.confidenceLevel || 90;
  const minVisitors = formatVisitorCount(parseMinSampleSize(audience?.minSampleSize));

  return {
    test: `${testTitle} — ${typeLabel} · ${productsText} · ${pricingText}`,
    traffic: `${trafficAllocation}% of eligible visitors · ${variationSummary}`,
    audience: `${classicSegmentLabel(audience?.segment)} · ${devicesOverviewText(
      audience,
    )} · ${sourcesOverviewText(audience)} · ${countriesOverviewText(audience)}`,
    results: `Primary: ${primaryLabel} · ${confidence}% confidence · ${minVisitors} visitors/variation`,
    safety: guardrailOverviewText(audience),
  };
}

export const REVIEW_OVERVIEW_LABELS = {
  test: 'Test',
  traffic: 'Traffic',
  audience: 'Audience',
  results: 'Results',
  safety: 'Safety',
};
